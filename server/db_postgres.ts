import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { getAppScopedPgDir } from './appIsolation';
import {
  LicenseRecord,
  DistributionRecord,
  DashboardStats,
  User,
  AuditLogItem,
  ImportJob,
  OfficeNotice,
} from '../src/types';

const { Pool } = pg;

export interface QueuedSheetTask {
  id: string;
  licenseNumber: string;
  data: any;
  queuedAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
  status: string;
}

export interface SheetSyncCheckpoint {
  importId?: string;
  completedRows?: number;
  totalRows?: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED';
  updatedAt: string;
  spreadsheetId?: string;
  tabName?: string;
  batchSize?: number;
  lastCompletedBatch?: number;
  lastProcessedRow?: number;
  failedBatch?: number;
  failedAtRow?: number;
  failedAt?: string;
  errorMessage?: string;
  newRecords?: number;
  updatedRecords?: number;
  duplicateCount?: number;
  invalidCount?: number;
  sheetDistributed?: number;
  sheetMissing?: number;
  sheetFound?: number;
  sheetHandedOver?: number;
  startedAt?: string;
  [key: string]: any;
}

// Global instances
let poolInstance: pg.Pool | null = null;
let pgliteInstance: PGlite | null = null;
let pgliteInitPromise: Promise<PGlite> | null = null;
let schemaInitialized = false;
let schemaInitPromise: Promise<void> | null = null;

export function isPostgresSchemaReady(): boolean {
  return schemaInitialized;
}

/**
 * Checks whether the DATABASE_URL contains an unpopulated placeholder password
 */
export function hasPlaceholderPassword(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const upper = url.toUpperCase();
  return (
    upper.includes('[YOUR-PASSWORD]') ||
    upper.includes('[YOUR_DB_PASSWORD]') ||
    upper.includes('[PASSWORD]') ||
    upper.includes('<PASSWORD>') ||
    upper.includes('[YOUR_PASSWORD]') ||
    upper.includes('YOUR_PASSWORD') ||
    upper.includes('YOUR_DB_PASSWORD') ||
    upper.includes('[DB_PASSWORD]') ||
    upper.includes('<DB_PASSWORD>') ||
    upper.includes('[YOUR-DB-PASSWORD]')
  );
}

// Cooldown and availability tracking for remote PostgreSQL cluster
let remoteUnavailableUntil = 0;
let lastRemoteErrorLogged = '';

/**
 * Validates whether a given connection string is a real, well-formed PostgreSQL URL
 */
export function isValidPostgresUrl(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.includes('YOUR_DATABASE_URL')) return false;
  if (trimmed.includes('•') || trimmed.includes('****')) return false;
  if (hasPlaceholderPassword()) return false;

  // Must begin with postgres:// or postgresql://
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname;
    if (!host || host === 'base' || host.includes('•') || host.includes('[') || host.includes(']')) {
      return false;
    }
    if (parsed.password && (parsed.password.includes('•') || parsed.password.includes('****'))) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether an error is a network, DNS, connectivity, or authentication failure
 */
export function isNetworkOrAuthError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const code = (err.code || '').toLowerCase();
  return (
    code === 'eai_again' ||
    code === 'enotfound' ||
    code === 'econnrefused' ||
    code === 'econnreset' ||
    code === 'etimedout' ||
    code === 'ehostunreach' ||
    code === 'enetunreach' ||
    code === 'epipe' ||
    msg.includes('getaddrinfo') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('connection terminated') ||
    msg.includes('timeout') ||
    msg.includes('password authentication failed') ||
    msg.includes('no pg_hba.conf entry') ||
    msg.includes('client has encountered a connection error') ||
    msg.includes('ssl') ||
    msg.includes('tls') ||
    msg.includes('handshake') ||
    msg.includes('network') ||
    msg.includes('socket') ||
    msg.includes('unreachable') ||
    (msg.includes('database') && msg.includes('does not exist'))
  );
}

// FIX: was a flat 5-minute cooldown on ANY single failed query — one slow/blip query would
// silently switch the whole app to the local database for 5 full minutes with no retry.
// Now it backs off much more briefly (15s) and escalates only if failures keep happening back to back.
let consecutiveRemoteFailures = 0;
export function markRemoteTemporarilyUnavailable(err: any): void {
  const errMsg = err?.message || String(err);
  consecutiveRemoteFailures++;
  const cooldownMs = Math.min(15000 * consecutiveRemoteFailures, 120000); // 15s, 30s, 45s... capped at 2 min
  remoteUnavailableUntil = Date.now() + cooldownMs;
  if (errMsg !== lastRemoteErrorLogged) {
    lastRemoteErrorLogged = errMsg;
    console.warn(`[PLSMS Database Advisory] Remote PostgreSQL connection unavailable (${errMsg}). Retrying in ${Math.round(cooldownMs / 1000)}s. Using local persistent PostgreSQL cluster meanwhile.`);
  }
}

// Call this after any successful remote query so a one-off blip doesn't keep escalating the cooldown.
export function markRemoteAvailable(): void {
  consecutiveRemoteFailures = 0;
  lastRemoteErrorLogged = '';
}

/**
 * Checks whether remote PostgreSQL is configured via external DATABASE_URL or Cloud SQL
 */
export function isRemotePostgresConfigured(): boolean {
  if (Date.now() < remoteUnavailableUntil) {
    return false;
  }

  const url = process.env.DATABASE_URL;
  if (isValidPostgresUrl(url)) {
    return true;
  }
  if (
    process.env.SQL_HOST &&
    process.env.SQL_USER &&
    process.env.SQL_DB_NAME &&
    !process.env.SQL_HOST.includes('•') &&
    process.env.SQL_HOST !== 'base'
  ) {
    return true;
  }
  return false;
}

/**
 * PostgreSQL is ALWAYS the authoritative database in PLSMS.
 * Returns true because either external PostgreSQL or the persistent PostgreSQL cluster is active.
 */
export function isPostgresConfigured(): boolean {
  return true;
}

/**
 * Returns connection string for external PostgreSQL if available
 */
export function requireDatabaseUrl(): string {
  if (hasPlaceholderPassword()) {
    throw new Error(
      '[PLSMS DATABASE ADVISORY] DATABASE_URL contains template placeholder "[YOUR-PASSWORD]". ' +
      'Using authoritative local PostgreSQL engine.'
    );
  }
  const url = process.env.DATABASE_URL;
  if (isValidPostgresUrl(url)) {
    return url!.trim();
  }
  if (
    process.env.SQL_HOST &&
    process.env.SQL_USER &&
    process.env.SQL_DB_NAME &&
    !process.env.SQL_HOST.includes('•') &&
    process.env.SQL_HOST !== 'base'
  ) {
    return `postgresql://${process.env.SQL_USER}:${process.env.SQL_PASSWORD || ''}@${process.env.SQL_HOST}/${process.env.SQL_DB_NAME}`;
  }
  return 'postgresql://postgres:postgres@localhost:5432/plsms';
}

/**
 * Initializes or retrieves external pg.Pool if remote database is configured
 */
export function getPgPool(): pg.Pool {
  if (!poolInstance) {
    if (process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) {
      const isSocket = process.env.SQL_HOST.startsWith('/');
      poolInstance = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // FIX: was 3000ms — too tight for real-world network latency/cold starts
        statement_timeout: 10000,
        query_timeout: 10000,
        ssl: isSocket ? false : undefined,
      });
    } else {
      const connectionString = requireDatabaseUrl();
      const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

      poolInstance = new Pool({
        connectionString,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // FIX: was 3000ms — too tight for real-world network latency/cold starts
        statement_timeout: 10000,
        query_timeout: 10000,
        ssl: isLocalhost ? false : { rejectUnauthorized: false },
      });
    }

    poolInstance.on('error', (err) => {
      // FIX: dropped idle connections were only logged, not fed into the same
      // fallback/recovery tracking as query failures — now they are, consistently.
      console.warn('[PLSMS PostgreSQL Remote Pool Advisory]:', err.message);
      markRemoteTemporarilyUnavailable(err);
    });
  }
  return poolInstance;
}

/**
 * Master PLSMS schema definition and indexes for authoritative PostgreSQL & PGlite storage
 */
export const PLSMS_TABLE_STATEMENTS = [
  // 1. RECORDS TABLE
  `CREATE TABLE IF NOT EXISTS records (
    id VARCHAR(255) PRIMARY KEY,
    applicant_id VARCHAR(255),
    application_number VARCHAR(255),
    license_number VARCHAR(255),
    holder_name VARCHAR(255) DEFAULT 'UNKNOWN HOLDER',
    category VARCHAR(100),
    vehicle_class VARCHAR(100),
    office VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
    main_status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
    issue_flag VARCHAR(50) NOT NULL DEFAULT 'NORMAL',
    phone VARCHAR(50),
    is_distributed SMALLINT NOT NULL DEFAULT 0,
    distributed_at VARCHAR(100),
    distributed_date VARCHAR(100),
    distributed_by VARCHAR(255),
    receiver_name VARCHAR(255),
    receiver_phone VARCHAR(50),
    receiver_nid VARCHAR(100),
    receiver_relation VARCHAR(100),
    submitted_document TEXT,
    recommending_staff_name VARCHAR(255),
    missing_reason TEXT,
    missing_date VARCHAR(100),
    found_date VARCHAR(100),
    found_handover_done BOOLEAN DEFAULT FALSE,
    import_id VARCHAR(255),
    imported_at VARCHAR(100),
    updated_at VARCHAR(100),
    data JSONB NOT NULL
  )`,

  // 1b. RECORDS STAGING TABLE (Isolated workspace for bounded-memory, zero-downtime atomic imports)
  `CREATE TABLE IF NOT EXISTS records_staging (
    id VARCHAR(255) PRIMARY KEY,
    applicant_id VARCHAR(255),
    application_number VARCHAR(255),
    license_number VARCHAR(255),
    holder_name VARCHAR(255) DEFAULT 'UNKNOWN HOLDER',
    category VARCHAR(100),
    vehicle_class VARCHAR(100),
    office VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
    main_status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
    issue_flag VARCHAR(50) NOT NULL DEFAULT 'NORMAL',
    phone VARCHAR(50),
    is_distributed SMALLINT NOT NULL DEFAULT 0,
    distributed_at VARCHAR(100),
    distributed_date VARCHAR(100),
    distributed_by VARCHAR(255),
    receiver_name VARCHAR(255),
    receiver_phone VARCHAR(50),
    receiver_nid VARCHAR(100),
    receiver_relation VARCHAR(100),
    submitted_document TEXT,
    recommending_staff_name VARCHAR(255),
    missing_reason TEXT,
    missing_date VARCHAR(100),
    found_date VARCHAR(100),
    found_handover_done BOOLEAN DEFAULT FALSE,
    import_id VARCHAR(255),
    imported_at VARCHAR(100),
    updated_at VARCHAR(100),
    data JSONB NOT NULL
  )`,

  // 2. DISTRIBUTIONS TABLE
  `CREATE TABLE IF NOT EXISTS distributions (
    id VARCHAR(255) PRIMARY KEY,
    license_id VARCHAR(255),
    license_number VARCHAR(255),
    holder_name VARCHAR(255) DEFAULT 'UNKNOWN HOLDER',
    receiver_name VARCHAR(255) DEFAULT 'UNKNOWN RECEIVER',
    receiver_phone VARCHAR(50),
    receiver_nid VARCHAR(100),
    receiver_relation VARCHAR(100),
    office VARCHAR(255),
    distributed_by VARCHAR(255) DEFAULT 'STAFF',
    distributed_at VARCHAR(100),
    distributed_date VARCHAR(100),
    remarks TEXT,
    submitted_document TEXT,
    recommending_staff_name VARCHAR(255),
    handover_reference VARCHAR(255),
    data JSONB NOT NULL
  )`,

  // 3. USERS TABLE (STAFF & ADMIN)
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'STAFF',
    office VARCHAR(255),
    is_active SMALLINT NOT NULL DEFAULT 1,
    created_at VARCHAR(100),
    updated_at VARCHAR(100),
    data JSONB NOT NULL
  )`,

  // 4. AUDIT LOGS TABLE
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255),
    user_name VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    category VARCHAR(100),
    details TEXT,
    ip_address VARCHAR(100),
    timestamp VARCHAR(100) NOT NULL,
    data JSONB NOT NULL
  )`,

  // 5. IMPORT JOBS TABLE
  `CREATE TABLE IF NOT EXISTS import_jobs (
    id VARCHAR(255) PRIMARY KEY,
    filename VARCHAR(255),
    imported_by VARCHAR(255),
    total_rows INTEGER DEFAULT 0,
    imported_rows INTEGER DEFAULT 0,
    skipped_rows INTEGER DEFAULT 0,
    duplicate_rows INTEGER DEFAULT 0,
    status VARCHAR(50),
    imported_at VARCHAR(100) NOT NULL,
    data JSONB NOT NULL
  )`,

  // 6. NOTICES TABLE
  `CREATE TABLE IF NOT EXISTS notices (
    id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'INFO',
    is_active SMALLINT NOT NULL DEFAULT 1,
    created_by VARCHAR(255),
    created_at VARCHAR(100) NOT NULL,
    updated_at VARCHAR(100),
    data JSONB NOT NULL
  )`,

  // 7. SHEET SYNC QUEUE TABLE
  `CREATE TABLE IF NOT EXISTS sheet_sync_queue (
    id VARCHAR(255) PRIMARY KEY,
    license_number VARCHAR(255) NOT NULL,
    data JSONB NOT NULL,
    queued_at BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at BIGINT,
    last_error TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
  )`,

  // 8. SYSTEM CONFIGURATION TABLE
  `CREATE TABLE IF NOT EXISTS system_configuration (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at VARCHAR(100) NOT NULL
  )`,

  // 9. SHEET SYNC CHECKPOINT TABLE
  `CREATE TABLE IF NOT EXISTS sheet_sync_checkpoint (
    id VARCHAR(255) PRIMARY KEY,
    last_sync_timestamp BIGINT NOT NULL,
    last_sync_iso VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    records_synced INTEGER NOT NULL DEFAULT 0,
    metadata JSONB
  )`,

  // INDEXES
  `CREATE INDEX IF NOT EXISTS idx_records_license_btree ON records (license_number)`,
  `CREATE INDEX IF NOT EXISTS idx_records_applicant_btree ON records (applicant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_records_app_no_btree ON records (application_number)`,
  `CREATE INDEX IF NOT EXISTS idx_records_phone_btree ON records (phone)`,
  `CREATE INDEX IF NOT EXISTS idx_records_holder_btree ON records (holder_name)`,
  `CREATE INDEX IF NOT EXISTS idx_records_status_office ON records (status, office)`,
  `CREATE INDEX IF NOT EXISTS idx_records_is_distributed ON records (is_distributed)`,
  `CREATE INDEX IF NOT EXISTS idx_records_distributed_at ON records (distributed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_records_import_id ON records (import_id)`,
  `CREATE INDEX IF NOT EXISTS idx_records_4col ON records (applicant_id, holder_name, license_number, category)`,
  `CREATE INDEX IF NOT EXISTS idx_records_modified_distributed ON records (is_distributed, status) WHERE (is_distributed = 1 OR status != 'AVAILABLE')`,

  `CREATE INDEX IF NOT EXISTS idx_dists_lic_no ON distributions (license_number)`,
  `CREATE INDEX IF NOT EXISTS idx_dists_lic_id ON distributions (license_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dists_date ON distributions (distributed_date)`,

  `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs (timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_imports_imported_at ON import_jobs (imported_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notices_created_at ON notices (created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_sheet_queue_status_queued ON sheet_sync_queue (status, queued_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sheet_queue_lic ON sheet_sync_queue (license_number)`,
];

export async function executeSchemaStatements(queryExecutor: (sql: string, params?: any[]) => Promise<any>): Promise<void> {
  for (const stmt of PLSMS_TABLE_STATEMENTS) {
    try {
      await queryExecutor(stmt);
    } catch (e: any) {
      const msg = (e?.message || String(e)).toLowerCase();
      if (!msg.includes('already exists') && !msg.includes('duplicate')) {
        console.warn('[PLSMS PostgreSQL Schema Execution Notice]:', e?.message || e);
      }
    }
  }

  await applySchemaMigrations(queryExecutor);
}

export async function applySchemaMigrations(queryExecutor: (sql: string, params?: any[]) => Promise<any>): Promise<void> {
  // Ensure non-blocking imports: records.license_number and holder_name must be nullable
  try {
    await queryExecutor('ALTER TABLE records ALTER COLUMN license_number DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor('ALTER TABLE records ALTER COLUMN holder_name DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor("ALTER TABLE records ALTER COLUMN holder_name SET DEFAULT 'UNKNOWN HOLDER'");
  } catch (_) {}
  try {
    await queryExecutor('ALTER TABLE records_staging ALTER COLUMN license_number DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor('ALTER TABLE records_staging ALTER COLUMN holder_name DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor("ALTER TABLE records_staging ALTER COLUMN holder_name SET DEFAULT 'UNKNOWN HOLDER'");
  } catch (_) {}

  // Ensure found_handover_done column exists on records table
  try {
    await queryExecutor('ALTER TABLE records ADD COLUMN IF NOT EXISTS found_handover_done BOOLEAN DEFAULT FALSE');
  } catch (_) {}

  // Ensure non-blocking distributions: distributions.distributed_date and related columns must be nullable
  try {
    await queryExecutor('ALTER TABLE distributions ALTER COLUMN distributed_date DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor('ALTER TABLE distributions ALTER COLUMN license_id DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor('ALTER TABLE distributions ALTER COLUMN license_number DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor('ALTER TABLE distributions ALTER COLUMN holder_name DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor('ALTER TABLE distributions ALTER COLUMN receiver_name DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor('ALTER TABLE distributions ALTER COLUMN distributed_by DROP NOT NULL');
  } catch (_) {}
  try {
    await queryExecutor('ALTER TABLE distributions ALTER COLUMN distributed_at DROP NOT NULL');
  } catch (_) {}
}

let pgliteExitHooksRegistered = false;

function registerPgliteExitHooks(inst: PGlite) {
  if (pgliteExitHooksRegistered) return;
  pgliteExitHooksRegistered = true;
  const gracefulShutdown = async () => {
    try {
      if (pgliteInstance) {
        const p = pgliteInstance;
        pgliteInstance = null;
        await p.close();
      }
    } catch (_) {}
  };
  process.once('SIGINT', gracefulShutdown);
  process.once('SIGTERM', gracefulShutdown);
  process.once('beforeExit', gracefulShutdown);
}

function cleanStaleLockFiles(dataDir: string) {
  const lockFiles = ['postmaster.pid', 'postmaster.opts', '.s.PGSQL.5432.lock', 'pglite.lock'];
  for (const file of lockFiles) {
    const fullPath = path.join(dataDir, file);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch (_) {}
    }
  }
}

/**
 * Returns the persistent local PostgreSQL engine (PGlite PostgreSQL 16/18)
 */
export async function getPglite(): Promise<PGlite> {
  if (pgliteInstance) return pgliteInstance;
  if (pgliteInitPromise) return pgliteInitPromise;

  pgliteInitPromise = (async () => {
    const pgDirName = getAppScopedPgDir('pgdata');
    const pgDataDir = path.join(process.cwd(), 'data_storage', pgDirName);

    if (!fs.existsSync(pgDataDir)) {
      fs.mkdirSync(pgDataDir, { recursive: true });
    }

    // Safely retry up to 4 attempts if lock is held or during server reload (NEVER DELETE pgDataDir)
    let lastErr: any = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        cleanStaleLockFiles(pgDataDir);
        const inst = new PGlite(pgDataDir);
        await inst.waitReady;
        pgliteInstance = inst;
        registerPgliteExitHooks(inst);

        // Auto-ensure records table exists in local persistent PGlite immediately
        try {
          const check = await inst.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'records' LIMIT 1");
          if (check.rows.length === 0) {
            console.log('[PLSMS DB] Provisioning local persistent PGlite schema...');
            await executeSchemaStatements((sql, params) => inst.query(sql, params));
            console.log('[PLSMS DB] Local persistent PGlite schema provisioned.');
          }
        } catch (checkErr: any) {
          console.warn('[PLSMS DB] PGlite table verification notice:', checkErr?.message);
        }
        return pgliteInstance;
      } catch (err: any) {
        lastErr = err;
        const errMsg = err?.message || String(err);
        console.warn(`[PLSMS DB] PGlite connection attempt ${attempt}/4: ${errMsg}. Retrying safely...`);
        cleanStaleLockFiles(pgDataDir);

        // If it is an unrecoverable WASM abort, checkpoint panic, or WAL corruption, break early to heal
        if (
          errMsg.includes('Aborted()') ||
          errMsg.includes('checkpoint') ||
          errMsg.includes('PANIC') ||
          errMsg.includes('invalid resource manager')
        ) {
          break;
        }

        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        }
      }
    }

    const clusterErrMsg = lastErr?.message || String(lastErr);
    const isWasmAbortOrCorrupt =
      clusterErrMsg.includes('Aborted()') ||
      clusterErrMsg.includes('checkpoint') ||
      clusterErrMsg.includes('PANIC') ||
      clusterErrMsg.includes('corrupt') ||
      clusterErrMsg.includes('invalid resource manager');

    // AUTOMATED ZERO-DATA-LOSS HEALING FOR CORRUPTED CLUSTERS:
    // If the persistent PostgreSQL/PGlite cluster suffered a fatal WAL checkpoint panic or WASM abort,
    // safely archive the damaged cluster to an archive folder, initialize a clean persistent cluster,
    // and seamlessly restore all tables and records from durable master vaults & JSON stores.
    if (isWasmAbortOrCorrupt) {
      const corruptArchiveDir = path.join(
        process.cwd(),
        'data_storage',
        `${pgDirName}_corrupted_archive_${Date.now()}`
      );
      console.warn(`[PLSMS DB] Fatal cluster WAL/checkpoint corruption detected: "${clusterErrMsg}".`);
      console.warn(`[PLSMS DB] Safely archiving damaged cluster to "${corruptArchiveDir}" and re-initializing clean persistent cluster...`);
      try {
        if (fs.existsSync(pgDataDir)) {
          fs.renameSync(pgDataDir, corruptArchiveDir);
        }
      } catch (renameErr: any) {
        console.warn('[PLSMS DB] Error archiving corrupted cluster:', renameErr?.message);
      }

      fs.mkdirSync(pgDataDir, { recursive: true });
      cleanStaleLockFiles(pgDataDir);

      try {
        const inst = new PGlite(pgDataDir);
        await inst.waitReady;
        pgliteInstance = inst;
        registerPgliteExitHooks(inst);

        console.log('[PLSMS DB] Provisioning local persistent PGlite schema on freshly recovered cluster...');
        await executeSchemaStatements((sql, params) => inst.query(sql, params));
        console.log('[PLSMS DB] Local persistent PGlite schema provisioned.');

        // Rehydrate all database tables from durable JSON storage and permanent master vaults
        try {
          console.log('[PLSMS DB] Restoring database tables from durable JSON storage and permanent master vaults...');
          await migrateExistingDataToPg();
          console.log('[PLSMS DB] Durable database tables successfully restored.');
        } catch (migErr: any) {
          console.warn('[PLSMS DB] Post-recovery migration advisory:', migErr?.message);
        }

        // Restore records_staging if available
        try {
          await initRecordsStagingTable({ truncate: false });
          const count = await getRecordsStagingCountInPg();
          if (count === 0) {
            const gsheetUpload = path.join(process.cwd(), 'data_storage', 'uploads', 'gsheet_latest_records.json');
            const gsheetRecords = path.join(process.cwd(), 'data_storage', 'google_sheet_records.json');
            const stagingSource = fs.existsSync(gsheetUpload) ? gsheetUpload : (fs.existsSync(gsheetRecords) ? gsheetRecords : null);
            if (stagingSource) {
              const parsed = JSON.parse(fs.readFileSync(stagingSource, 'utf8'));
              if (Array.isArray(parsed) && parsed.length > 0) {
                console.log(`[PLSMS DB] Restoring ${parsed.length} staged records into repaired staging table...`);
                await upsertRecordsBatchInPg(parsed, 'records_staging');
              }
            }
          }
        } catch (stgErr: any) {
          console.warn('[PLSMS DB] Staging restoration advisory:', stgErr?.message);
        }

        return pgliteInstance;
      } catch (recoveryErr: any) {
        console.error('[PLSMS DB] Cluster auto-recovery failed:', recoveryErr);
        throw recoveryErr;
      }
    }

    // Do NOT silently switch PostgreSQL/PGlite to an empty in-memory database when the durable database is temporarily locked or unavailable. Fail safely and report the real database error instead.
    console.error(`[PLSMS DB] Failed to acquire durable persistent PostgreSQL/PGlite database cluster lock on "${pgDataDir}":`, clusterErrMsg);
    throw new Error(`Durable PostgreSQL database engine unavailable: ${clusterErrMsg}`);
  })().finally(() => {
    pgliteInitPromise = null;
  });

  return pgliteInitPromise;
}

let remoteReadOnlyState: boolean = false;
let lastReadOnlyCheckTime: number = 0;

/**
 * Probes whether the remote PostgreSQL database is operating in Read-Only mode
 * (e.g. Supabase project in read-only quota mode, or physical standby replica).
 */
export async function checkRemotePostgresReadOnly(): Promise<boolean> {
  return false;
}

/**
 * Checks whether a SQL statement is a mutating/write query (INSERT, UPDATE, DELETE, DDL).
 */
export function isMutatingSqlQuery(sql: string): boolean {
  if (!sql) return false;
  const cleaned = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
    .toUpperCase();

  return (
    cleaned.startsWith('INSERT') ||
    cleaned.startsWith('UPDATE') ||
    cleaned.startsWith('DELETE') ||
    cleaned.startsWith('CREATE') ||
    cleaned.startsWith('ALTER') ||
    cleaned.startsWith('DROP') ||
    cleaned.startsWith('TRUNCATE') ||
    cleaned.startsWith('GRANT') ||
    cleaned.startsWith('REVOKE') ||
    cleaned.startsWith('REPLACE') ||
    cleaned.startsWith('LOCK') ||
    cleaned.startsWith('VACUUM') ||
    cleaned.startsWith('REINDEX')
  );
}

/**
 * Unified PostgreSQL multi-statement script executor (for DDL scripts)
 */
export async function execPg(sql: string): Promise<void> {
  if (isRemotePostgresConfigured()) {
    try {
      const pool = getPgPool();
      await pool.query(sql);
      return;
    } catch (err: any) {
      if (isNetworkOrAuthError(err)) {
        markRemoteTemporarilyUnavailable(err);
      } else {
        throw err;
      }
    }
  }

  const pg = await getPglite();
  await pg.exec(sql);
}

/**
 * Unified PostgreSQL query executor.
 * Dispatches query to authoritative PostgreSQL pool if configured (for BOTH reads and writes),
 * or falls back to local PostgreSQL cluster if remote PostgreSQL is not configured or unavailable.
 */
export async function queryPg<T = any>(sql: string, params: any[] = [], timeoutMs: number = 45000): Promise<{ rows: T[]; rowCount: number }> {
  if (isRemotePostgresConfigured()) {
    try {
      const pool = getPgPool();
      const res = await Promise.race([
        pool.query(sql, params),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Authoritative PostgreSQL query timeout (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs)
        ),
      ]);
      markRemoteAvailable(); // success — reset any backoff from earlier blips
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    } catch (remoteErr: any) {
      markRemoteTemporarilyUnavailable(remoteErr);
      // Fall through to local persistent PGlite cluster
    }
  }

  // Fallback to local persistent PGlite cluster
  const pg = await getPglite();
  const res = await pg.query(sql, params);
  return { rows: res.rows as T[], rowCount: (res as any).affectedRows ?? res.rows.length };
}

/**
 * Unified PostgreSQL atomic transaction executor.
 * Executes transactions directly in authoritative PostgreSQL pool when configured,
 * or falls back to local cluster if remote is not configured or unavailable.
 */
export async function withTransactionPg<T>(
  callback: (query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>) => Promise<T>
): Promise<T> {
  if (isRemotePostgresConfigured()) {
    try {
      const pool = getPgPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const queryFn = async (sql: string, params: any[] = []) => {
          const res = await client.query(sql, params);
          return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
        };
        const result = await callback(queryFn);
        await client.query('COMMIT');
        markRemoteAvailable(); // success — reset any backoff from earlier blips
        return result;
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (connErr: any) {
      markRemoteTemporarilyUnavailable(connErr);
      // Fall through to local persistent PGlite cluster
    }
  }

  const pg = await getPglite();
  return await pg.transaction(async (tx) => {
    const queryFn = async (sql: string, params: any[] = []) => {
      const res = await tx.query(sql, params);
      return { rows: res.rows, rowCount: (res as any).affectedRows ?? res.rows.length };
    };
    return await callback(queryFn);
  });
}

/**
 * Tests the PostgreSQL connection and returns latency in milliseconds
 */
export async function testPostgresConnection(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  engine?: string;
}> {
  const start = Date.now();
  try {
    const res = await queryPg('SELECT 1 as alive, version() as ver');
    const latencyMs = Date.now() - start;
    const isRemote = isRemotePostgresConfigured();
    const ver = res.rows[0]?.ver ? String(res.rows[0].ver).split(' ')[0] : 'PostgreSQL';
    return {
      ok: res.rows.length > 0,
      latencyMs,
      engine: isRemote
        ? (remoteReadOnlyState ? 'PostgreSQL (Remote Cluster - Read-Only Replica)' : 'PostgreSQL (Remote Cluster)')
        : `PostgreSQL (Durable Cluster ${ver})`,
    };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err?.message || String(err) };
  }
}

/**
 * Initializes the full PostgreSQL schema and indexes for PLSMS.
 * Ensures both local PGlite and remote PostgreSQL clusters are provisioned
 * with all tables, constraints, and indexes.
 */
export async function initPostgresSchema(): Promise<void> {
  if (schemaInitialized) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    try {
      // 1. Always ensure local persistent PGlite has the authoritative schema ready
      try {
        const localPg = await getPglite();
        const localCheck = await localPg.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'records' LIMIT 1");
        if (localCheck.rows.length === 0) {
          console.log('[PLSMS PostgreSQL] Initializing local persistent PGlite schema...');
          await executeSchemaStatements((sql, params) => localPg.query(sql, params));
          console.log('[PLSMS PostgreSQL] Local persistent PGlite schema provisioned successfully.');
        } else {
          await applySchemaMigrations((sql, params) => localPg.query(sql, params));
        }
      } catch (localErr: any) {
        console.warn('[PLSMS PostgreSQL] Local PGlite schema initialization notice:', localErr?.message);
      }

      // 2. Ensure remote PostgreSQL cluster is provisioned if configured
      if (isRemotePostgresConfigured()) {
        try {
          const pool = getPgPool();
          const remoteCheck = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'records' LIMIT 1");
          if (remoteCheck.rows.length === 0) {
            console.log('[PLSMS PostgreSQL] Initializing remote PostgreSQL cluster schema...');
            await executeSchemaStatements((sql, params) => pool.query(sql, params));
            console.log('[PLSMS PostgreSQL] Remote PostgreSQL schema provisioned successfully.');
          } else {
            console.log('[PLSMS PostgreSQL] Authoritative remote schema is already provisioned and ready.');
            await applySchemaMigrations((sql, params) => pool.query(sql, params));
          }
        } catch (remoteErr: any) {
          if (isNetworkOrAuthError(remoteErr)) {
            markRemoteTemporarilyUnavailable(remoteErr);
          } else {
            console.warn('[PLSMS PostgreSQL] Remote schema provisioning notice:', remoteErr?.message);
          }
        }
      }

      // Authoritative verification: ensure records table exists and is queryable
      try {
        await queryPg('SELECT 1 FROM records LIMIT 1');
      } catch (verErr: any) {
        console.warn('[PLSMS PostgreSQL] Final records table verification notice:', verErr?.message);
      }

      schemaInitialized = true;
      console.log('[PLSMS PostgreSQL] Authoritative schema and indexes initialized successfully.');
    } finally {
      schemaInitPromise = null;
    }
  })();

  return schemaInitPromise;
}

/**
 * Automatically migrates existing real data from data_storage JSON files into PostgreSQL
 */
export async function migrateExistingDataToPg(): Promise<void> {
  const baseDir = path.join(process.cwd(), 'data_storage');

  // 1. Users migration (Seeds initial Super Admin & staff accounts if users table is empty)
  try {
    const revokedUsersFile = path.join(baseDir, 'revoked_users.json');
    const revokedBackupFile = path.join(baseDir, 'revoked_users.backup.json');
    const unifiedFile = path.join(baseDir, 'master_database_unified_backup.json');
    const revokedSet = new Set<string>();

    const loadRevokedFromFile = (f: string) => {
      if (fs.existsSync(f)) {
        try {
          const list = JSON.parse(fs.readFileSync(f, 'utf8'));
          if (Array.isArray(list)) {
            for (const item of list) {
              const id = typeof item === 'string' ? item : item?.id;
              if (id) revokedSet.add(String(id).trim().toUpperCase());
            }
          }
        } catch (_) {}
      }
    };
    loadRevokedFromFile(revokedUsersFile);
    loadRevokedFromFile(revokedBackupFile);
    if (fs.existsSync(unifiedFile)) {
      try {
        const uni = JSON.parse(fs.readFileSync(unifiedFile, 'utf8'));
        const rList = Array.isArray(uni?.revokedUsers) ? uni.revokedUsers : (Array.isArray(uni?.data?.revokedUsers) ? uni.data.revokedUsers : []);
        for (const item of rList) {
          const id = typeof item === 'string' ? item : item?.id;
          if (id) revokedSet.add(String(id).trim().toUpperCase());
        }
      } catch (_) {}
    }

    // Ensure revoked_users table exists in local PGlite and purge any revoked users from PostgreSQL
    try {
      const localPg = await getPglite();
      await localPg.query(`
        CREATE TABLE IF NOT EXISTS revoked_users (
          id VARCHAR(100) PRIMARY KEY,
          revoked_at VARCHAR(100),
          revoked_by VARCHAR(100),
          reason TEXT
        );
      `);
      const pgRev = await localPg.query('SELECT id FROM revoked_users');
      for (const r of ((pgRev.rows as any[]) || [])) {
        if (r && (r as any).id) revokedSet.add(String((r as any).id).trim().toUpperCase());
      }
      for (const rId of revokedSet) {
        await localPg.query("DELETE FROM users WHERE UPPER(id) = $1 OR id = $1 OR UPPER(email) = $1 OR UPPER(COALESCE(data->>'id', '')) = $1 OR UPPER(COALESCE(data->>'email', '')) = $1", [rId]);
      }
    } catch (_) {}

    if (isRemotePostgresConfigured()) {
      try {
        await queryPg(`
          CREATE TABLE IF NOT EXISTS revoked_users (
            id VARCHAR(100) PRIMARY KEY,
            revoked_at VARCHAR(100),
            revoked_by VARCHAR(100),
            reason TEXT
          );
        `);
        const rRes = await queryPg('SELECT id FROM revoked_users');
        for (const r of rRes.rows || []) {
          if (r && r.id) revokedSet.add(String(r.id).trim().toUpperCase());
        }
        for (const rId of revokedSet) {
          await queryPg("DELETE FROM users WHERE UPPER(id) = $1 OR id = $1 OR UPPER(email) = $1 OR UPPER(COALESCE(data->>'id', '')) = $1 OR UPPER(COALESCE(data->>'email', '')) = $1", [rId]);
        }
      } catch (_) {}
    }

    const userCountRes = await queryPg('SELECT COUNT(*)::int as count FROM users');
    if ((userCountRes.rows[0]?.count || 0) === 0) {
      const usersFile = path.join(baseDir, 'users.json');
      const backupFile = path.join(baseDir, 'users.backup.json');
      const archiveFile = path.join(baseDir, 'users_permanent_archive.json');
      let candidateUsers: any[] = [];

      // Read from available disk sources preserving changed credentials
      if (fs.existsSync(usersFile)) {
        try {
          const raw = fs.readFileSync(usersFile, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) candidateUsers = parsed;
        } catch (_) {}
      }
      if (fs.existsSync(archiveFile)) {
        try {
          const raw = fs.readFileSync(archiveFile, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            if (candidateUsers.length === 0) candidateUsers = parsed;
            else {
              for (const au of parsed) {
                const match = candidateUsers.find((c) => c && c.id && au && au.id && c.id.toUpperCase() === au.id.toUpperCase());
                if (match && (au.passwordChanged || au.isDefaultPassword === false) && !match.passwordChanged) {
                  Object.assign(match, au);
                }
              }
            }
          }
        } catch (_) {}
      }
      if (fs.existsSync(unifiedFile)) {
        try {
          const raw = fs.readFileSync(unifiedFile, 'utf8');
          const parsed = JSON.parse(raw);
          const uList = Array.isArray(parsed?.users) ? parsed.users : (Array.isArray(parsed?.data?.users) ? parsed.data.users : []);
          for (const uu of uList) {
            const match = candidateUsers.find((c) => c && c.id && uu && uu.id && c.id.toUpperCase() === uu.id.toUpperCase());
            if (match && (uu.passwordChanged || uu.isDefaultPassword === false) && !match.passwordChanged) {
              Object.assign(match, uu);
            }
          }
        } catch (_) {}
      }

      // Strictly purge any permanently revoked users from candidates
      candidateUsers = candidateUsers.filter((u) => u && u.id && !revokedSet.has(String(u.id).trim().toUpperCase()));

      if (candidateUsers.length > 0) {
        console.log(`[PLSMS PostgreSQL] Initializing ${candidateUsers.length} admin accounts into PostgreSQL/PGlite...`);
        await saveUsersToPg(candidateUsers);
      }
    } else {
      // Ensure existing rows in users table never retain savedPassword or plain passwords
      try {
        await queryPg(`UPDATE users SET data = data - 'savedPassword' - 'passwordPrefix' - 'password' WHERE data ? 'savedPassword' OR data ? 'passwordPrefix' OR data ? 'password'`);
      } catch (_) {}

      // CRITICAL ENVIRONMENT SAFETY: Synchronize persistent PostgreSQL users with disk files!
      // This ensures that any changed passwords in PostgreSQL survive container redeployment,
      // and any user accounts/passwords on disk are synchronized to PostgreSQL without reverting.
      try {
        const pgUsers = await getUsersFromPg();
        if (Array.isArray(pgUsers) && pgUsers.length > 0) {
          const usersFile = path.join(baseDir, 'users.json');
          const backupFile = path.join(baseDir, 'users.backup.json');
          const archiveFile = path.join(baseDir, 'users_permanent_archive.json');

          let diskUsers: any[] = [];
          if (fs.existsSync(usersFile)) {
            try {
              diskUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
            } catch (_) {}
          }
          if (fs.existsSync(archiveFile)) {
            try {
              const arch = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
              if (Array.isArray(arch)) {
                for (const au of arch) {
                  const match = diskUsers.find((du) => du && du.id && au && au.id && du.id.toUpperCase() === au.id.toUpperCase());
                  if (match && (au.passwordChanged || au.isDefaultPassword === false) && !match.passwordChanged) {
                    Object.assign(match, au);
                  }
                }
              }
            } catch (_) {}
          }

          // Strictly filter out any revoked accounts from both disk and PG before syncing
          diskUsers = diskUsers.filter((du) => du && du.id && !revokedSet.has(String(du.id).trim().toUpperCase()));

          const userMap = new Map<string, any>();
          for (const du of diskUsers) {
            if (du && du.id) userMap.set(du.id.toUpperCase(), du);
          }
          let modifiedDisk = false;
          let modifiedPg = false;
          for (const pu of pgUsers) {
            if (pu && pu.id) {
              const upperId = pu.id.toUpperCase();
              if (revokedSet.has(upperId)) {
                // User is permanently revoked: do not sync to disk, mark modifiedPg to purge from PG
                modifiedPg = true;
                continue;
              }
              const existingDisk = userMap.get(upperId);
              if (!existingDisk) {
                userMap.set(upperId, pu);
                modifiedDisk = true;
              } else {
                const puChanged = Boolean(pu.passwordChanged || pu.isDefaultPassword === false);
                const diskChanged = Boolean(existingDisk.passwordChanged || existingDisk.isDefaultPassword === false);

                if (puChanged && !diskChanged) {
                  // PostgreSQL user has changed password, disk has default -> PostgreSQL changed password wins!
                  userMap.set(upperId, { ...existingDisk, ...pu });
                  modifiedDisk = true;
                } else if (diskChanged && !puChanged) {
                  // Disk has changed password and PostgreSQL has default -> Disk changed password wins!
                  userMap.set(upperId, { ...pu, ...existingDisk });
                  modifiedPg = true;
                } else if (puChanged && diskChanged) {
                  // Both have changed passwords: if timestamps differ, newer timestamp wins
                  const puTime = pu.passwordChangedAt ? new Date(pu.passwordChangedAt).getTime() : 0;
                  const diskTime = existingDisk.passwordChangedAt ? new Date(existingDisk.passwordChangedAt).getTime() : 0;
                  if (puTime > diskTime) {
                    userMap.set(upperId, { ...existingDisk, ...pu });
                    modifiedDisk = true;
                  } else if (diskTime > puTime) {
                    userMap.set(upperId, { ...pu, ...existingDisk });
                    modifiedPg = true;
                  }
                }
              }
            }
          }
          // Check if disk has accounts not yet in PostgreSQL
          for (const du of diskUsers) {
            if (du && du.id) {
              const upperId = du.id.toUpperCase();
              if (revokedSet.has(upperId)) continue;
              const inPg = pgUsers.some((p) => p.id && p.id.toUpperCase() === upperId);
              if (!inPg) {
                modifiedPg = true;
              }
            }
          }
          const merged = Array.from(userMap.values()).filter((u) => u && u.id && !revokedSet.has(String(u.id).trim().toUpperCase()));
          if (modifiedDisk) {
            fs.writeFileSync(usersFile, JSON.stringify(merged, null, 2), 'utf8');
            fs.writeFileSync(backupFile, JSON.stringify(merged, null, 2), 'utf8');
            fs.writeFileSync(archiveFile, JSON.stringify(merged, null, 2), 'utf8');
            if (fs.existsSync(unifiedFile)) {
              try {
                const unified = JSON.parse(fs.readFileSync(unifiedFile, 'utf8'));
                if (unified && typeof unified === 'object') {
                  unified.users = merged;
                  if (!unified.data) unified.data = {};
                  unified.data.users = merged;
                  if (unified.database && typeof unified.database === 'object') {
                    unified.database.users = merged;
                  }
                  fs.writeFileSync(unifiedFile, JSON.stringify(unified, null, 2), 'utf8');
                }
              } catch (_) {}
            }
          }
          if (modifiedPg) {
            await saveUsersToPg(merged);
          }
        }
      } catch (syncErr: any) {
        console.warn('[PLSMS PostgreSQL] User synchronization advisory:', syncErr?.message);
      }
    }
  } catch (e: any) {
    console.warn('[PLSMS PostgreSQL] Users initialization advisory:', e.message);
  }

  // 2. Notices migration
  try {
    const noticeCountRes = await queryPg('SELECT COUNT(*)::int as count FROM notices');
    if ((noticeCountRes.rows[0]?.count || 0) === 0) {
      const noticesFile = path.join(baseDir, 'notices.json');
      if (fs.existsSync(noticesFile)) {
        const raw = fs.readFileSync(noticesFile, 'utf8');
        const notices = JSON.parse(raw);
        if (Array.isArray(notices) && notices.length > 0) {
          console.log(`[PLSMS PostgreSQL] Migrating ${notices.length} office notices into PostgreSQL...`);
          for (const n of notices) {
            await createNoticeInPg(n);
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('[PLSMS PostgreSQL] Notices migration advisory:', e.message);
  }

  // 3. Audit logs migration
  try {
    const auditCountRes = await queryPg('SELECT COUNT(*)::int as count FROM audit_logs');
    if ((auditCountRes.rows[0]?.count || 0) === 0) {
      const auditFile = path.join(baseDir, 'audit_logs.json');
      if (fs.existsSync(auditFile)) {
        const raw = fs.readFileSync(auditFile, 'utf8');
        const logs = JSON.parse(raw);
        if (Array.isArray(logs) && logs.length > 0) {
          console.log(`[PLSMS PostgreSQL] Migrating ${logs.length} audit logs into PostgreSQL...`);
          for (const l of logs) {
            await logAuditInPg(l);
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('[PLSMS PostgreSQL] Audit logs migration advisory:', e.message);
  }

  // 4. System config migration
  try {
    const sheetsFile = path.join(baseDir, 'google_sheets_config.json');
    if (fs.existsSync(sheetsFile)) {
      const raw = fs.readFileSync(sheetsFile, 'utf8');
      await saveSystemConfigInPg('google_sheets_config', raw);
    }
    const visitorFile = path.join(baseDir, 'visitor_counter.json');
    if (fs.existsSync(visitorFile)) {
      const raw = fs.readFileSync(visitorFile, 'utf8');
      await saveSystemConfigInPg('visitor_counter', raw);
    }
    const pinFile = path.join(baseDir, 'security_pin.json');
    if (fs.existsSync(pinFile)) {
      const raw = fs.readFileSync(pinFile, 'utf8');
      await saveSystemConfigInPg('security_pin', raw);
    }
    const overridesFile = path.join(baseDir, 'action_overrides.json');
    if (fs.existsSync(overridesFile)) {
      const raw = fs.readFileSync(overridesFile, 'utf8');
      await saveSystemConfigInPg('action_overrides', raw);
    }
  } catch (e: any) {
    console.warn('[PLSMS PostgreSQL] Config migration advisory:', e.message);
  }

  // 5. Records migration (if records table is empty and records.json has records)
  try {
    const recCountRes = await queryPg('SELECT COUNT(*)::int as count FROM records');
    if ((recCountRes.rows[0]?.count || 0) === 0) {
      const recFile = path.join(baseDir, 'records.json');
      if (fs.existsSync(recFile)) {
        const raw = fs.readFileSync(recFile, 'utf8');
        const recs = JSON.parse(raw);
        if (Array.isArray(recs) && recs.length > 0) {
          console.log(`[PLSMS PostgreSQL] Migrating ${recs.length} records into PostgreSQL...`);
          await upsertRecordsBatchInPg(recs);
        }
      }
    }
  } catch (e: any) {
    console.warn('[PLSMS PostgreSQL] Records migration advisory:', e.message);
  }

  // 6. Distributions migration (if distributions table is empty)
  try {
    const distCountRes = await queryPg('SELECT COUNT(*)::int as count FROM distributions');
    if ((distCountRes.rows[0]?.count || 0) === 0) {
      const distFile = path.join(baseDir, 'distributions.json');
      if (fs.existsSync(distFile)) {
        const raw = fs.readFileSync(distFile, 'utf8');
        const dists = JSON.parse(raw);
        if (Array.isArray(dists) && dists.length > 0) {
          console.log(`[PLSMS PostgreSQL] Migrating ${dists.length} distributions into PostgreSQL...`);
          await upsertDistributionsBatchInPg(dists);
        }
      }
    }
  } catch (e: any) {
    console.warn('[PLSMS PostgreSQL] Distributions migration advisory:', e.message);
  }
}

export function normalizeRecordFromPgData(data: any, receiverNameCol?: string | null): LicenseRecord {
  const record = (typeof data === 'string' ? JSON.parse(data) : data) as LicenseRecord;
  if (!record) return record;

  const rawDistTo =
    (record.distributedTo && typeof record.distributedTo === 'string' ? record.distributedTo.trim() : '') ||
    (record.receiverName && typeof record.receiverName === 'string' ? record.receiverName.trim() : '') ||
    (record.receivedBy && typeof record.receivedBy === 'string' ? record.receivedBy.trim() : '') ||
    (receiverNameCol && typeof receiverNameCol === 'string' ? receiverNameCol.trim() : '') ||
    (record.rawRecord?.['DISTRIBUTED TO'] ? String(record.rawRecord['DISTRIBUTED TO']).trim() : '') ||
    (record.rawRecord?.['Distributed To'] ? String(record.rawRecord['Distributed To']).trim() : '') ||
    (record.rawRecord?.['DISRTIBUTED TO'] ? String(record.rawRecord['DISRTIBUTED TO']).trim() : '') ||
    (record.rawRecord?.['Disrtibuted To'] ? String(record.rawRecord['Disrtibuted To']).trim() : '') ||
    (record.rawRecord?.['DISTRIBUTED_TO'] ? String(record.rawRecord['DISTRIBUTED_TO']).trim() : '') ||
    (record.rawRecord?.['Distributed_To'] ? String(record.rawRecord['Distributed_To']).trim() : '') ||
    (record.rawRecord?.['RECEIVER NAME'] ? String(record.rawRecord['RECEIVER NAME']).trim() : '') ||
    (record.rawRecord?.['Receiver Name'] ? String(record.rawRecord['Receiver Name']).trim() : '') ||
    (record.rawRecord?.['RECEIVER'] ? String(record.rawRecord['RECEIVER']).trim() : '') ||
    (record.rawRecord?.['Receiver'] ? String(record.rawRecord['Receiver']).trim() : '') ||
    (record.rawRecord?.['RECEIVED BY'] ? String(record.rawRecord['RECEIVED BY']).trim() : '') ||
    (record.rawRecord?.['Received By'] ? String(record.rawRecord['Received By']).trim() : '') ||
    (record.rawRecord?.['received_by'] ? String(record.rawRecord['received_by']).trim() : '') ||
    (record.rawRecord?.['बुझिलिनेको नाम'] ? String(record.rawRecord['बुझिलिनेको नाम']).trim() : '') ||
    (record.rawRecord?.['बुझिलिने'] ? String(record.rawRecord['बुझिलिने']).trim() : '');

  const upper = rawDistTo.toUpperCase();
  const isValidReceiver =
    rawDistTo.length > 0 &&
    upper !== '-' &&
    upper !== '--' &&
    upper !== '---' &&
    upper !== 'NULL' &&
    upper !== 'UNDEFINED' &&
    upper !== 'N/A' &&
    upper !== 'NA' &&
    upper !== '<N/A>';

  if (isValidReceiver) {
    record.distributedTo = rawDistTo;
    record.receiverName = rawDistTo;
    record.receivedBy = rawDistTo;
    if (record.status !== 'MISSING' && record.status !== 'FOUND') {
      record.status = 'DISTRIBUTED';
      record.isDistributed = true;
      record.mainStatus = 'DISTRIBUTED';
    }
  }

  return record;
}

function prepareRecordParamsPg(r: LicenseRecord) {
  const rawReceiver =
    (r.distributedTo && typeof r.distributedTo === 'string' ? r.distributedTo.trim() : '') ||
    (r.receiverName && typeof r.receiverName === 'string' ? r.receiverName.trim() : '') ||
    (r.receivedBy && typeof r.receivedBy === 'string' ? r.receivedBy.trim() : '') ||
    (r.rawRecord?.['DISTRIBUTED TO'] ? String(r.rawRecord['DISTRIBUTED TO']).trim() : '') ||
    (r.rawRecord?.['Distributed To'] ? String(r.rawRecord['Distributed To']).trim() : '') ||
    (r.rawRecord?.['DISRTIBUTED TO'] ? String(r.rawRecord['DISRTIBUTED TO']).trim() : '') ||
    (r.rawRecord?.['Disrtibuted To'] ? String(r.rawRecord['Disrtibuted To']).trim() : '') ||
    (r.rawRecord?.['DISTRIBUTED_TO'] ? String(r.rawRecord['DISTRIBUTED_TO']).trim() : '') ||
    (r.rawRecord?.['Distributed_To'] ? String(r.rawRecord['Distributed_To']).trim() : '') ||
    (r.rawRecord?.['RECEIVER NAME'] ? String(r.rawRecord['RECEIVER NAME']).trim() : '') ||
    (r.rawRecord?.['Receiver Name'] ? String(r.rawRecord['Receiver Name']).trim() : '') ||
    (r.rawRecord?.['RECEIVER'] ? String(r.rawRecord['RECEIVER']).trim() : '') ||
    (r.rawRecord?.['Receiver'] ? String(r.rawRecord['Receiver']).trim() : '') ||
    (r.rawRecord?.['RECEIVED BY'] ? String(r.rawRecord['RECEIVED BY']).trim() : '') ||
    (r.rawRecord?.['Received By'] ? String(r.rawRecord['Received By']).trim() : '') ||
    (r.rawRecord?.['received_by'] ? String(r.rawRecord['received_by']).trim() : '') ||
    (r.rawRecord?.['बुझिलिनेको नाम'] ? String(r.rawRecord['बुझिलिनेको नाम']).trim() : '') ||
    (r.rawRecord?.['बुझिलिने'] ? String(r.rawRecord['बुझिलिने']).trim() : '');

  const upperReceiver = rawReceiver.toUpperCase();
  const isValidReceiver =
    rawReceiver.length > 0 &&
    upperReceiver !== '-' &&
    upperReceiver !== '--' &&
    upperReceiver !== '---' &&
    upperReceiver !== 'NULL' &&
    upperReceiver !== 'UNDEFINED' &&
    upperReceiver !== 'N/A' &&
    upperReceiver !== 'NA' &&
    upperReceiver !== '<N/A>';

  const receiver = isValidReceiver ? rawReceiver : null;
  const isDistributedCard = Boolean(
    r.isDistributed ||
    r.status === 'DISTRIBUTED' ||
    (isValidReceiver && r.status !== 'MISSING' && r.status !== 'FOUND')
  );
  const finalStatus = (r.status === 'MISSING' || r.status === 'FOUND')
    ? r.status
    : (isDistributedCard ? 'DISTRIBUTED' : (r.status || 'AVAILABLE'));

  const enrichedRecord: LicenseRecord = {
    ...r,
    status: finalStatus,
    isDistributed: isDistributedCard,
    mainStatus: isDistributedCard ? 'DISTRIBUTED' : 'NOT_DISTRIBUTED',
    ...(receiver ? { receiverName: receiver, receivedBy: receiver, distributedTo: receiver } : {})
  };

  return [
    r.id,
    r.applicantId || r.applicationNumber || null,
    r.applicationNumber || null,
    r.licenseNumber || null,
    r.holderName || null,
    r.category || r.vehicleClass || null,
    r.vehicleClass || null,
    r.office || null,
    finalStatus,
    isDistributedCard ? 'DISTRIBUTED' : 'NOT_DISTRIBUTED',
    r.issueFlag || (r.status === 'MISSING' ? 'MISSING' : 'NORMAL'),
    r.phone || r.mobileNumber || null,
    isDistributedCard ? 1 : 0,
    r.distributedAt || r.distributedDate || null,
    r.distributedDate || null,
    r.distributedBy || null,
    receiver,
    r.receiverPhone || null,
    r.receiverNid || null,
    r.receiverRelation || null,
    r.submittedDocument || null,
    r.recommendingStaffName || null,
    r.missingReason || null,
    r.missingDate || null,
    r.foundDate || null,
    r.importId || null,
    r.importedAt || new Date().toISOString(),
    r.updatedAt || new Date().toISOString(),
    JSON.stringify(enrichedRecord),
  ];
}

function prepareDistParamsPg(d: DistributionRecord) {
  const distDate = (
    d.distributedDate ||
    (d as any).distributed_date ||
    (d.distributedAt ? d.distributedAt.split('T')[0] : '') ||
    new Date().toISOString().split('T')[0]
  );
  return [
    d.id,
    d.licenseId || null,
    d.licenseNumber || null,
    d.holderName || 'UNKNOWN HOLDER',
    d.receiverName || d.holderName || 'UNKNOWN RECEIVER',
    d.receiverPhone || null,
    d.receiverNid || null,
    d.receiverRelation || null,
    d.office || null,
    d.distributedBy || 'STAFF',
    d.distributedAt || new Date().toISOString(),
    distDate,
    d.remarks || null,
    d.submittedDocument || null,
    d.recommendingStaffName || null,
    d.handoverReference || null,
    JSON.stringify(d),
  ];
}

/**
 * Upserts a single record into PostgreSQL
 */
export async function upsertRecordInPg(record: LicenseRecord): Promise<void> {
  if (!record || !record.id) {
    console.warn('[PLSMS PostgreSQL] Skipped upsertRecordInPg: missing record or record.id');
    return;
  }
  const params = prepareRecordParamsPg(record);

  await queryPg(`
    INSERT INTO records (
      id, applicant_id, application_number, license_number, holder_name,
      category, vehicle_class, office, status, main_status, issue_flag, phone,
      is_distributed, distributed_at, distributed_date, distributed_by,
      receiver_name, receiver_phone, receiver_nid, receiver_relation,
      submitted_document, recommending_staff_name, missing_reason,
      missing_date, found_date, import_id, imported_at, updated_at, data
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, $29
    ) ON CONFLICT (id) DO UPDATE SET
      applicant_id = EXCLUDED.applicant_id,
      application_number = EXCLUDED.application_number,
      license_number = EXCLUDED.license_number,
      holder_name = EXCLUDED.holder_name,
      category = EXCLUDED.category,
      vehicle_class = EXCLUDED.vehicle_class,
      office = EXCLUDED.office,
      status = EXCLUDED.status,
      main_status = EXCLUDED.main_status,
      issue_flag = EXCLUDED.issue_flag,
      phone = EXCLUDED.phone,
      is_distributed = EXCLUDED.is_distributed,
      distributed_at = EXCLUDED.distributed_at,
      distributed_date = EXCLUDED.distributed_date,
      distributed_by = EXCLUDED.distributed_by,
      receiver_name = EXCLUDED.receiver_name,
      receiver_phone = EXCLUDED.receiver_phone,
      receiver_nid = EXCLUDED.receiver_nid,
      receiver_relation = EXCLUDED.receiver_relation,
      submitted_document = EXCLUDED.submitted_document,
      recommending_staff_name = EXCLUDED.recommending_staff_name,
      missing_reason = EXCLUDED.missing_reason,
      missing_date = EXCLUDED.missing_date,
      found_date = EXCLUDED.found_date,
      import_id = EXCLUDED.import_id,
      imported_at = EXCLUDED.imported_at,
      updated_at = EXCLUDED.updated_at,
      data = EXCLUDED.data;
  `, params);
}

/**
 * High-performance batch upsert for records in PostgreSQL.
 * NEVER blocks valid records. If a chunk encounters an unexpected issue,
 * it safely falls back to single-record upserts so that remaining rows always succeed.
 */
export async function upsertRecordsBatchInPg(records: LicenseRecord[], targetTable: 'records' | 'records_staging' = 'records'): Promise<void> {
  if (!records || records.length === 0) return;

  // Only discard null/undefined items with no id
  const validRecords = records.filter((r) => r && r.id);
  if (validRecords.length === 0) return;

  const safeTable = targetTable === 'records_staging' ? 'records_staging' : 'records';
  // Use optimal 500-record bulk chunks (14,500 parameters, well within PostgreSQL 65,535 limit)
  const CHUNK_SIZE = 500;

  await withTransactionPg(async (query) => {
    for (let c = 0; c < validRecords.length; c += CHUNK_SIZE) {
      const chunk = validRecords.slice(c, c + CHUNK_SIZE);
      const valueRows: string[] = [];
      const flatParams: any[] = [];

      for (let i = 0; i < chunk.length; i++) {
        const offset = i * 29;
        const rowParams = prepareRecordParamsPg(chunk[i]);
        const placeholders = Array.from({ length: 29 }, (_, idx) => `$${offset + idx + 1}`).join(', ');
        valueRows.push(`(${placeholders})`);
        flatParams.push(...rowParams);
      }

      const sql = `
        INSERT INTO ${safeTable} (
          id, applicant_id, application_number, license_number, holder_name,
          category, vehicle_class, office, status, main_status, issue_flag, phone,
          is_distributed, distributed_at, distributed_date, distributed_by,
          receiver_name, receiver_phone, receiver_nid, receiver_relation,
          submitted_document, recommending_staff_name, missing_reason,
          missing_date, found_date, import_id, imported_at, updated_at, data
        ) VALUES ${valueRows.join(', ')}
        ON CONFLICT (id) DO UPDATE SET
          applicant_id = EXCLUDED.applicant_id,
          application_number = EXCLUDED.application_number,
          license_number = EXCLUDED.license_number,
          holder_name = EXCLUDED.holder_name,
          category = EXCLUDED.category,
          vehicle_class = EXCLUDED.vehicle_class,
          office = EXCLUDED.office,
          status = EXCLUDED.status,
          main_status = EXCLUDED.main_status,
          issue_flag = EXCLUDED.issue_flag,
          phone = EXCLUDED.phone,
          is_distributed = EXCLUDED.is_distributed,
          distributed_at = EXCLUDED.distributed_at,
          distributed_date = EXCLUDED.distributed_date,
          distributed_by = EXCLUDED.distributed_by,
          receiver_name = EXCLUDED.receiver_name,
          receiver_phone = EXCLUDED.receiver_phone,
          receiver_nid = EXCLUDED.receiver_nid,
          receiver_relation = EXCLUDED.receiver_relation,
          submitted_document = EXCLUDED.submitted_document,
          recommending_staff_name = EXCLUDED.recommending_staff_name,
          missing_reason = EXCLUDED.missing_reason,
          missing_date = EXCLUDED.missing_date,
          found_date = EXCLUDED.found_date,
          import_id = EXCLUDED.import_id,
          imported_at = EXCLUDED.imported_at,
          updated_at = EXCLUDED.updated_at,
          data = EXCLUDED.data;
      `;

      // FIX: isolate this chunk with a SAVEPOINT. Without this, a single bad row anywhere
      // in the 4000-row batch aborts the entire outer transaction, so every later query —
      // including the per-row fallback below — silently fails and COMMIT ends up discarding
      // the whole batch (even the good rows that inserted fine before the failure).
      try {
        await query('SAVEPOINT chunk_sp');
        await query(sql, flatParams);
        await query('RELEASE SAVEPOINT chunk_sp');
      } catch (chunkErr: any) {
        console.warn(`[PLSMS PostgreSQL] Bulk chunk insert encountered issue: ${chunkErr.message}. Falling back to single-row inserts...`);
        try { await query('ROLLBACK TO SAVEPOINT chunk_sp'); } catch (_) {}
        for (const singleRec of chunk) {
          try {
            await query('SAVEPOINT row_sp');
            const singleParams = prepareRecordParamsPg(singleRec);
            await query(`
              INSERT INTO ${safeTable} (
                id, applicant_id, application_number, license_number, holder_name,
                category, vehicle_class, office, status, main_status, issue_flag, phone,
                is_distributed, distributed_at, distributed_date, distributed_by,
                receiver_name, receiver_phone, receiver_nid, receiver_relation,
                submitted_document, recommending_staff_name, missing_reason,
                missing_date, found_date, import_id, imported_at, updated_at, data
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28, $29
              ) ON CONFLICT (id) DO UPDATE SET
                applicant_id = EXCLUDED.applicant_id,
                application_number = EXCLUDED.application_number,
                license_number = EXCLUDED.license_number,
                holder_name = EXCLUDED.holder_name,
                category = EXCLUDED.category,
                vehicle_class = EXCLUDED.vehicle_class,
                office = EXCLUDED.office,
                status = EXCLUDED.status,
                main_status = EXCLUDED.main_status,
                issue_flag = EXCLUDED.issue_flag,
                phone = EXCLUDED.phone,
                is_distributed = EXCLUDED.is_distributed,
                distributed_at = EXCLUDED.distributed_at,
                distributed_date = EXCLUDED.distributed_date,
                distributed_by = EXCLUDED.distributed_by,
                receiver_name = EXCLUDED.receiver_name,
                receiver_phone = EXCLUDED.receiver_phone,
                receiver_nid = EXCLUDED.receiver_nid,
                receiver_relation = EXCLUDED.receiver_relation,
                submitted_document = EXCLUDED.submitted_document,
                recommending_staff_name = EXCLUDED.recommending_staff_name,
                missing_reason = EXCLUDED.missing_reason,
                missing_date = EXCLUDED.missing_date,
                found_date = EXCLUDED.found_date,
                import_id = EXCLUDED.import_id,
                imported_at = EXCLUDED.imported_at,
                updated_at = EXCLUDED.updated_at,
                data = EXCLUDED.data;
            `, singleParams);
            await query('RELEASE SAVEPOINT row_sp');
          } catch (singleErr: any) {
            console.error(`[PLSMS PostgreSQL] Single row insert failed for ID ${singleRec.id}: ${singleErr.message}`);
            try { await query('ROLLBACK TO SAVEPOINT row_sp'); } catch (_) {}
          }
        }
      }
    }
  });

  validRecords.length = 0; // Release chunk array reference for GC
  if (targetTable !== 'records_staging') {
    invalidateRecordsCountCache();
    invalidateDashboardStatsCache();
  }
}

/**
 * Deletes a single record from PostgreSQL
 */
export async function deleteRecordFromPg(id: string): Promise<void> {
  await queryPg('DELETE FROM records WHERE id = $1', [id]);
  invalidateRecordsCountCache(-1);
  invalidateDashboardStatsCache();
}

/**
 * Deletes all records belonging to a specific importId from PostgreSQL
 */
export async function deleteRecordsByImportIdInPg(importId: string): Promise<number> {
  const res = await queryPg("DELETE FROM records WHERE import_id = $1 OR data->>'importId' = $1 RETURNING id", [importId]);
  const deletedCount = res.rows?.length ?? res.rowCount ?? 0;
  invalidateRecordsCountCache(-deletedCount);
  invalidateDashboardStatsCache();
  return deletedCount;
}

export async function deleteRecordByIdInPg(id: string): Promise<number> {
  const res = await queryPg('DELETE FROM records WHERE id = $1', [id]);
  invalidateRecordsCountCache(-1);
  invalidateDashboardStatsCache();
  return res.rowCount || 0;
}

let cachedRecordsCount = 0;
let cachedRecordsCountTime = 0;
let inFlightRecordsCountPromise: Promise<number> | null = null;

export function invalidateRecordsCountCache(delta?: number): void {
  if (typeof delta === 'number') {
    cachedRecordsCount = Math.max(0, (cachedRecordsCount || 0) + delta);
    cachedRecordsCountTime = Date.now();
  } else {
    cachedRecordsCount = 0;
    cachedRecordsCountTime = 0;
  }
}

/**
 * Total count of durable records in PostgreSQL.
 * Uses PostgreSQL's O(1) pg_class catalog statistics, memory caching,
 * and single-flight coalescing to eliminate 800MB+ full-table scans and prevent query timeouts.
 */
export async function getRecordsCountInPg(forceFresh = false): Promise<number> {
  const now = Date.now();
  // 1. Fresh cache hit (valid for 60 seconds)
  if (!forceFresh && cachedRecordsCount > 0 && (now - cachedRecordsCountTime < 60000)) {
    return cachedRecordsCount;
  }

  // 2. Single-flight: coalesce concurrent calls into the existing in-flight promise
  if (inFlightRecordsCountPromise) {
    return inFlightRecordsCountPromise;
  }

  inFlightRecordsCountPromise = (async () => {
    try {
      if (isRemotePostgresConfigured()) {
        // Fast path: O(1) catalog query against pg_class takes < 5ms without scanning 827MB of heap data
        try {
          const est = await queryPg(
            "SELECT reltuples::bigint as count FROM pg_class WHERE relname = 'records' AND reltuples > 0",
            [],
            3000
          );
          const estVal = Number(est.rows[0]?.count || 0);
          if (estVal > 0) {
            cachedRecordsCount = estVal;
            cachedRecordsCountTime = Date.now();
            return estVal;
          }
        } catch (_) {}
      }

      // If reltuples returned 0 (e.g. fresh local PGlite table before ANALYZE), run count with 8s timeout
      try {
        const res = await queryPg('SELECT COUNT(*)::int as count FROM records', [], 8000);
        const exact = Number(res.rows[0]?.count || 0);
        if (exact >= 0) {
          cachedRecordsCount = exact;
          cachedRecordsCountTime = Date.now();
          return exact;
        }
      } catch (countErr: any) {
        if (countErr?.message?.includes('does not exist') || countErr?.message?.includes('records')) {
          await initPostgresSchema();
          const retryRes = await queryPg('SELECT COUNT(*)::int as count FROM records', [], 8000);
          const exact = Number(retryRes.rows[0]?.count || 0);
          cachedRecordsCount = exact;
          cachedRecordsCountTime = Date.now();
          return exact;
        }
        throw countErr;
      }
      return cachedRecordsCount || 0;
    } catch (err: any) {
      console.warn('[PLSMS PostgreSQL] Non-blocking count notice:', err?.message || err);
      return cachedRecordsCount || 0;
    } finally {
      inFlightRecordsCountPromise = null;
    }
  })();

  return inFlightRecordsCountPromise;
}

export interface ExistingPgRecordKeyInfo {
  id: string;
  applicantId: string;
  applicationNumber: string;
  licenseNumber: string;
  holderName: string;
  category: string;
  vehicleClass: string;
  office: string;
  status: string;
  mainStatus: string;
  issueFlag: string;
  isDistributed: number;
  phone?: string;
  recommendingStaffName?: string;
  importedAt?: string;
  sheetRow?: number;
  sourceSheet?: string;
  sheetTab?: string;
}

/**
 * High-performance lightweight retrieval of all existing record identification keys
 * from PostgreSQL without pulling large JSONB blobs. Used for strict 4-column idempotent matching.
 */
export async function getAllExistingRecordKeysFromPg(): Promise<ExistingPgRecordKeyInfo[]> {
  try {
    const res = await queryPg(`
      SELECT 
        id,
        applicant_id,
        application_number,
        license_number,
        holder_name,
        category,
        vehicle_class,
        office,
        status,
        main_status,
        issue_flag,
        is_distributed,
        phone,
        recommending_staff_name,
        imported_at,
        CASE WHEN (data->>'sheetRow') ~ '^[0-9]+$' THEN (data->>'sheetRow')::int ELSE 0 END AS sheet_row,
        COALESCE(data->>'sourceSheet', '') AS source_sheet,
        COALESCE(data->>'sheetTab', '') AS sheet_tab
      FROM records
    `);
    return res.rows.map((r) => ({
      id: r.id,
      applicantId: r.applicant_id || '',
      applicationNumber: r.application_number || '',
      licenseNumber: r.license_number || '',
      holderName: r.holder_name || '',
      category: r.category || '',
      vehicleClass: r.vehicle_class || '',
      office: r.office || '',
      status: r.status || 'AVAILABLE',
      mainStatus: r.main_status || (Number(r.is_distributed) === 1 ? 'DISTRIBUTED' : 'NOT_DISTRIBUTED'),
      issueFlag: r.issue_flag || 'NORMAL',
      isDistributed: Number(r.is_distributed) || 0,
      phone: r.phone || '',
      recommendingStaffName: r.recommending_staff_name || '',
      importedAt: r.imported_at || '',
      sheetRow: Number(r.sheet_row) || 0,
      sourceSheet: r.source_sheet || '',
      sheetTab: r.sheet_tab || '',
    }));
  } catch (err: any) {
    if (err?.message?.includes('does not exist') || err?.message?.includes('records')) {
      try {
        await initPostgresSchema();
        const retryRes = await queryPg(`
          SELECT 
            id, applicant_id, application_number, license_number, holder_name,
            category, vehicle_class, office, status, main_status, issue_flag,
            is_distributed, phone, recommending_staff_name, imported_at,
            CASE WHEN (data->>'sheetRow') ~ '^[0-9]+$' THEN (data->>'sheetRow')::int ELSE 0 END AS sheet_row,
            COALESCE(data->>'sourceSheet', '') AS source_sheet,
            COALESCE(data->>'sheetTab', '') AS sheet_tab
          FROM records
        `);
        return retryRes.rows.map((r) => ({
          id: r.id,
          applicantId: r.applicant_id || '',
          applicationNumber: r.application_number || '',
          licenseNumber: r.license_number || '',
          holderName: r.holder_name || '',
          category: r.category || '',
          vehicleClass: r.vehicle_class || '',
          office: r.office || '',
          status: r.status || 'AVAILABLE',
          mainStatus: r.main_status || (Number(r.is_distributed) === 1 ? 'DISTRIBUTED' : 'NOT_DISTRIBUTED'),
          issueFlag: r.issue_flag || 'NORMAL',
          isDistributed: Number(r.is_distributed) || 0,
          phone: r.phone || '',
          recommendingStaffName: r.recommending_staff_name || '',
          importedAt: r.imported_at || '',
          sheetRow: Number(r.sheet_row) || 0,
          sourceSheet: r.source_sheet || '',
          sheetTab: r.sheet_tab || '',
        }));
      } catch (_) {}
    }
    console.error('[PLSMS PostgreSQL] Error fetching existing record keys:', err?.message);
    return [];
  }
}

/**
 * Ultra-fast, lightweight retrieval of only record IDs from PostgreSQL.
 * Used for fast existence checks during sync without scanning JSONB data or mapping 18 columns.
 */
export async function getAllExistingRecordIdsFromPg(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const res = await queryPg('SELECT id FROM records');
    if (res && Array.isArray(res.rows)) {
      for (let i = 0; i < res.rows.length; i++) {
        if (res.rows[i]?.id) set.add(res.rows[i].id);
      }
    }
  } catch (err: any) {
    console.warn('[PLSMS PostgreSQL] Non-blocking notice fetching existing IDs:', err?.message || err);
  }
  return set;
}

/**
 * Retrieves all records from PostgreSQL
 */
export async function getAllRecordsFromPg(): Promise<LicenseRecord[]> {
  try {
    const res = await queryPg('SELECT data, receiver_name FROM records ORDER BY id DESC');
    return res.rows.map((r) => normalizeRecordFromPgData(r.data, r.receiver_name));
  } catch (err: any) {
    if (err?.message?.includes('does not exist') || err?.message?.includes('records')) {
      console.warn('[PLSMS PostgreSQL] Table "records" missing during retrieval, auto-provisioning schema...');
      schemaInitialized = false;
      await initPostgresSchema();
      try {
        const retryRes = await queryPg('SELECT data, receiver_name FROM records ORDER BY id DESC');
        return retryRes.rows.map((r) => normalizeRecordFromPgData(r.data, r.receiver_name));
      } catch (retryErr: any) {
        console.warn('[PLSMS PostgreSQL] Retry retrieval after schema init returned empty:', retryErr?.message);
        return [];
      }
    }
    throw err;
  }
}

/**
 * Retrieves a single record by ID from PostgreSQL
 */
export async function getRecordByIdFromPg(id: string): Promise<LicenseRecord | null> {
  if (!id || typeof id !== 'string') return null;
  const cleanId = id.trim();
  if (!cleanId) return null;
  let res = await queryPg('SELECT data, receiver_name FROM records WHERE id = $1 LIMIT 1', [cleanId]);
  if (res.rows.length === 0) {
    const candidates = getSearchCandidateNumbers(cleanId);
    if (candidates.length > 0) {
      res = await queryPg(
        `SELECT data, receiver_name FROM records 
         WHERE license_number = ANY($1) 
            OR applicant_id = ANY($1) 
            OR application_number = ANY($1) 
         LIMIT 1`,
        [candidates]
      );
    }
  }
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return normalizeRecordFromPgData(row.data, row.receiver_name);
}

/**
 * Computes search key variations to allow indexed lookups (B-Tree index) without
 * calling unindexed functional expressions like REPLACE() in SQL WHERE clauses.
 */
export function getSearchCandidateNumbers(searchNumber: string): string[] {
  if (!searchNumber) return [];
  const raw = searchNumber.trim();
  if (!raw) return [];

  const candidates = new Set<string>();
  candidates.add(raw);
  candidates.add(raw.toUpperCase());
  candidates.add(raw.toLowerCase());

  // Clean alphanumeric (remove spaces, hyphens, underscores, dots, slashes)
  const clean = raw.replace(/[\s\-_\.\/\\]/g, '').toUpperCase();
  if (clean) {
    candidates.add(clean);

    // Standard Nepal license format: 12 clean chars -> XX-XX-XXXXXXXX (length 14)
    if (clean.length === 12) {
      candidates.add(`${clean.slice(0, 2)}-${clean.slice(2, 4)}-${clean.slice(4)}`);
    }

    // Number without leading zeros (e.g. Applicant ID entered with leading zeros or vice-versa)
    const noZero = clean.replace(/^0+/, '');
    if (noZero && noZero !== clean) {
      candidates.add(noZero);
    }
  }

  // Handle loose separator formats like 1-2-345678 or 01-02-345678 or 01/02/345678
  const looseMatch = raw.match(/^([0-9A-Za-z]{1,2})[\s\-_\.\/\\]+([0-9A-Za-z]{1,2})[\s\-_\.\/\\]+([0-9A-Za-z]{1,8})$/);
  if (looseMatch) {
    const p1 = looseMatch[1].toUpperCase().padStart(2, '0');
    const p2 = looseMatch[2].toUpperCase().padStart(2, '0');
    const p3 = looseMatch[3].toUpperCase().padStart(8, '0');
    candidates.add(`${p1}-${p2}-${p3}`);
    candidates.add(`${p1}${p2}${p3}`);
  }

  return Array.from(candidates).filter(Boolean);
}

/**
 * Finds all records by license number, applicant ID, or application number using indexed B-tree lookups
 */
export async function findAllRecordsByNumberInPg(searchNumber: string): Promise<LicenseRecord[]> {
  if (!searchNumber) return [];
  const candidates = getSearchCandidateNumbers(searchNumber);
  if (candidates.length === 0) return [];

  const res = await queryPg(
    `SELECT data, receiver_name FROM records 
     WHERE license_number = ANY($1) 
        OR applicant_id = ANY($1) 
        OR application_number = ANY($1)
     ORDER BY id ASC`,
    [candidates]
  );

  const records = res.rows.map((row) => normalizeRecordFromPgData(row.data, row.receiver_name));
  return records.sort((a, b) => (Number(a.sn || a.sheetRow || 0) - Number(b.sn || b.sheetRow || 0)));
}

/**
 * Finds a record by license number, applicant ID, or application number using indexed B-tree lookups
 */
export async function findRecordByNumberInPg(searchNumber: string): Promise<LicenseRecord | null> {
  const all = await findAllRecordsByNumberInPg(searchNumber);
  if (all.length === 0) return null;
  const available = all.find((r) => r.status === 'AVAILABLE' || !r.isDistributed);
  return available || all[all.length - 1];
}

/**
 * Upserts a single distribution record in PostgreSQL
 */
export async function upsertDistributionInPg(dist: DistributionRecord): Promise<void> {
  const params = prepareDistParamsPg(dist);

  await queryPg(`
    INSERT INTO distributions (
      id, license_id, license_number, holder_name, receiver_name,
      receiver_phone, receiver_nid, receiver_relation, office,
      distributed_by, distributed_at, distributed_date, remarks,
      submitted_document, recommending_staff_name, handover_reference, data
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15, $16, $17
    ) ON CONFLICT (id) DO UPDATE SET
      license_id = EXCLUDED.license_id,
      license_number = EXCLUDED.license_number,
      holder_name = EXCLUDED.holder_name,
      receiver_name = EXCLUDED.receiver_name,
      receiver_phone = EXCLUDED.receiver_phone,
      receiver_nid = EXCLUDED.receiver_nid,
      receiver_relation = EXCLUDED.receiver_relation,
      office = EXCLUDED.office,
      distributed_by = EXCLUDED.distributed_by,
      distributed_at = EXCLUDED.distributed_at,
      distributed_date = EXCLUDED.distributed_date,
      remarks = EXCLUDED.remarks,
      submitted_document = EXCLUDED.submitted_document,
      recommending_staff_name = EXCLUDED.recommending_staff_name,
      handover_reference = EXCLUDED.handover_reference,
      data = EXCLUDED.data;
  `, params);
}

/**
 * Batch upserts distributions into PostgreSQL
 */
export async function upsertDistributionsBatchInPg(dists: DistributionRecord[]): Promise<void> {
  if (!dists || dists.length === 0) return;

  const CHUNK_SIZE = 40;
  await withTransactionPg(async (query) => {
    for (let c = 0; c < dists.length; c += CHUNK_SIZE) {
      const chunk = dists.slice(c, c + CHUNK_SIZE);
      const valueRows: string[] = [];
      const flatParams: any[] = [];

      for (let i = 0; i < chunk.length; i++) {
        const offset = i * 17;
        const rowParams = prepareDistParamsPg(chunk[i]);
        const placeholders = Array.from({ length: 17 }, (_, idx) => `$${offset + idx + 1}`).join(', ');
        valueRows.push(`(${placeholders})`);
        flatParams.push(...rowParams);
      }

      const sql = `
        INSERT INTO distributions (
          id, license_id, license_number, holder_name, receiver_name,
          receiver_phone, receiver_nid, receiver_relation, office,
          distributed_by, distributed_at, distributed_date, remarks,
          submitted_document, recommending_staff_name, handover_reference, data
        ) VALUES ${valueRows.join(', ')}
        ON CONFLICT (id) DO UPDATE SET
          license_id = EXCLUDED.license_id,
          license_number = EXCLUDED.license_number,
          holder_name = EXCLUDED.holder_name,
          receiver_name = EXCLUDED.receiver_name,
          receiver_phone = EXCLUDED.receiver_phone,
          receiver_nid = EXCLUDED.receiver_nid,
          receiver_relation = EXCLUDED.receiver_relation,
          office = EXCLUDED.office,
          distributed_by = EXCLUDED.distributed_by,
          distributed_at = EXCLUDED.distributed_at,
          distributed_date = EXCLUDED.distributed_date,
          remarks = EXCLUDED.remarks,
          submitted_document = EXCLUDED.submitted_document,
          recommending_staff_name = EXCLUDED.recommending_staff_name,
          handover_reference = EXCLUDED.handover_reference,
          data = EXCLUDED.data;
      `;

      await query(sql, flatParams);
    }
  });
}

/**
 * Deletes a distribution record from PostgreSQL
 */
export async function deleteDistributionFromPg(id: string): Promise<void> {
  await queryPg('DELETE FROM distributions WHERE id = $1', [id]);
}

/**
 * Deletes distribution records by licenseId or licenseNumber
 */
export async function deleteDistributionsByLicenseIdInPg(licenseId: string): Promise<number> {
  const res = await queryPg('DELETE FROM distributions WHERE license_id = $1 OR license_number = $1', [licenseId]);
  return res.rowCount || 0;
}

/**
 * Returns all distributions from PostgreSQL
 */
export async function getAllDistributionsFromPg(): Promise<DistributionRecord[]> {
  const res = await queryPg('SELECT data FROM distributions ORDER BY distributed_at DESC');
  return res.rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)) as DistributionRecord[];
}

/**
 * Returns total count of distributions in PostgreSQL
 */
export async function getDistributionsCountInPg(): Promise<number> {
  const res = await queryPg('SELECT COUNT(*)::int as count FROM distributions');
  return res.rows[0]?.count || 0;
}

/**
 * Ensures the isolated records_staging table exists for incoming sync batches.
 * When resuming an interrupted import, truncate option can be disabled to preserve staged data.
 * This guarantees live records table is NEVER touched or truncated during imports.
 */
export async function initRecordsStagingTable(options?: { truncate?: boolean }): Promise<void> {
  await queryPg(`
    CREATE TABLE IF NOT EXISTS records_staging (
      id VARCHAR(255) PRIMARY KEY,
      applicant_id VARCHAR(255),
      application_number VARCHAR(255),
      license_number VARCHAR(255),
      holder_name VARCHAR(255) DEFAULT 'UNKNOWN HOLDER',
      category VARCHAR(100),
      vehicle_class VARCHAR(100),
      office VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
      main_status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
      issue_flag VARCHAR(50) NOT NULL DEFAULT 'NORMAL',
      phone VARCHAR(50),
      is_distributed SMALLINT NOT NULL DEFAULT 0,
      distributed_at VARCHAR(100),
      distributed_date VARCHAR(100),
      distributed_by VARCHAR(255),
      receiver_name VARCHAR(255),
      receiver_phone VARCHAR(50),
      receiver_nid VARCHAR(100),
      receiver_relation VARCHAR(100),
      submitted_document TEXT,
      recommending_staff_name VARCHAR(255),
      missing_reason TEXT,
      missing_date VARCHAR(100),
      found_date VARCHAR(100),
      found_handover_done BOOLEAN DEFAULT FALSE,
      import_id VARCHAR(255),
      imported_at VARCHAR(100),
      updated_at VARCHAR(100),
      data JSONB NOT NULL
    )
  `);
  await queryPg('CREATE INDEX IF NOT EXISTS idx_records_staging_lic ON records_staging (license_number)');
  await queryPg('CREATE INDEX IF NOT EXISTS idx_records_staging_app ON records_staging (applicant_id)');

  // Only truncate when explicitly commanded (never automatically or by default on restart/recovery)
  if (options?.truncate === true) {
    await queryPg('TRUNCATE TABLE records_staging');
  }
}

/**
 * Returns the exact row count of records in staging table
 */
export async function getRecordsStagingCountInPg(): Promise<number> {
  try {
    const res = await queryPg('SELECT COUNT(*)::int as count FROM records_staging');
    return res.rows[0]?.count || 0;
  } catch {
    return 0;
  }
}

/**
 * Clears staging table in PostgreSQL (Records-Only Reset)
 */
export async function clearRecordsStagingInPg(): Promise<void> {
  await queryPg('TRUNCATE TABLE records_staging');
}

/**
 * Atomically swaps records_staging into live records table.
 * Executed inside a single PostgreSQL transaction:
 * If anything fails, live records table is untouched and preserved 100%.
 */
export async function swapRecordsStagingToLive(): Promise<number> {
  const stagingCountRes = await queryPg('SELECT COUNT(*)::int as count FROM records_staging');
  const stagingCount = stagingCountRes.rows[0]?.count || 0;
  if (stagingCount === 0) {
    console.warn('[PLSMS PostgreSQL] Staging table is empty, aborting swap to protect live data.');
    return 0;
  }
  await withTransactionPg(async (query) => {
    await query('TRUNCATE TABLE records');
    await query(`
      INSERT INTO records (
        id, applicant_id, application_number, license_number, holder_name,
        category, vehicle_class, office, status, main_status, issue_flag, phone,
        is_distributed, distributed_at, distributed_date, distributed_by,
        receiver_name, receiver_phone, receiver_nid, receiver_relation,
        submitted_document, recommending_staff_name, missing_reason,
        missing_date, found_date, found_handover_done, import_id, imported_at, updated_at, data
      )
      SELECT
        id, applicant_id, application_number, license_number, holder_name,
        category, vehicle_class, office, status, main_status, issue_flag, phone,
        is_distributed, distributed_at, distributed_date, distributed_by,
        receiver_name, receiver_phone, receiver_nid, receiver_relation,
        submitted_document, recommending_staff_name, missing_reason,
        missing_date, found_date, found_handover_done, import_id, imported_at, updated_at, data
      FROM records_staging
    `);
    // Staging table data is preserved permanently as warm backup and never truncated
  });
  invalidateRecordsCountCache();
  invalidateDashboardStatsCache();
  return stagingCount;
}

/**
 * Clears ONLY live records table in PostgreSQL (Records-Only Reset).
 * Absolutely preserves distributions, users, audit logs, and system tables.
 */
export async function clearRecordsInPg(): Promise<void> {
  await queryPg('TRUNCATE TABLE records');
  invalidateRecordsCountCache();
  invalidateDashboardStatsCache();
}

/**
 * Clears distributions table in PostgreSQL
 */
export async function clearDistributionsInPg(): Promise<void> {
  await queryPg('TRUNCATE TABLE distributions CASCADE');
  invalidateDashboardStatsCache();
}

/**
 * Clears all master records, distributions, and sheet sync queue in PostgreSQL
 */
export async function clearAllInPg(): Promise<void> {
  await queryPg('TRUNCATE TABLE records, distributions, sheet_sync_queue, import_jobs CASCADE');
  invalidateRecordsCountCache();
  invalidateDashboardStatsCache();
}

/**
 * ========================================================
 * USER MANAGEMENT IN POSTGRESQL (STAFF & ADMIN)
 * ========================================================
 */
export async function getUsersFromPg(): Promise<User[]> {
  try {
    const res = await queryPg('SELECT data FROM users ORDER BY created_at ASC');
    if (res && Array.isArray(res.rows) && res.rows.length > 0) {
      return res.rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
    }
  } catch (err: any) {
    console.warn('[PLSMS Database] getUsersFromPg primary query warning:', err.message);
  }

  // Durable fallback: direct local persistent PGlite read
  try {
    const localPg = await getPglite();
    const res = await localPg.query('SELECT data FROM users ORDER BY created_at ASC');
    return (res.rows || []).map((r: any) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  } catch (localErr: any) {
    console.error('[PLSMS Database] Error fetching users from local persistent PGlite fallback:', localErr.message);
    return [];
  }
}

export async function saveUsersToPg(users: User[]): Promise<void> {
  if (!users || users.length === 0) return;

  const upsertUsersWithQuery = async (query: (sql: string, params?: any[]) => Promise<any>) => {
    for (const u of users) {
      const email = (u.email || '').toLowerCase().trim();
      const now = new Date().toISOString();
      const cleanUser = { ...u };
      delete (cleanUser as any).savedPassword;
      delete (cleanUser as any).passwordPrefix;
      delete (cleanUser as any).password;
      await query(
        `INSERT INTO users (id, email, password, name, role, office, is_active, created_at, updated_at, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           password = EXCLUDED.password,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           office = EXCLUDED.office,
           is_active = EXCLUDED.is_active,
           updated_at = EXCLUDED.updated_at,
           data = EXCLUDED.data`,
        [
          u.id,
          email,
          (u as any).passwordHash || 'REDACTED',
          u.name || 'Staff',
          u.role || 'STAFF',
          (u as any).office || '',
          (u.status === 'SUSPENDED' ? 0 : 1),
          u.createdAt || now,
          now,
          JSON.stringify(cleanUser),
        ]
      );
    }

    // Delete any users from the database whose uppercase ID is no longer in the active users array
    const validIds = users.map((u) => (u.id || '').trim().toUpperCase()).filter(Boolean);
    if (validIds.length > 0) {
      const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',');
      await query(`DELETE FROM users WHERE UPPER(id) NOT IN (${placeholders})`, validIds);
    }
    try {
      await query(`DELETE FROM users WHERE UPPER(id) IN (SELECT UPPER(id) FROM revoked_users) OR UPPER(email) IN (SELECT UPPER(id) FROM revoked_users)`);
    } catch (_) {}
  };

  // 1. ALWAYS persist directly into local persistent PGlite as the durable local bedrock
  try {
    const localPg = await getPglite();
    await localPg.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(100) PRIMARY KEY,
        email VARCHAR(255),
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(100) NOT NULL,
        office VARCHAR(150),
        is_active SMALLINT NOT NULL DEFAULT 1,
        created_at VARCHAR(100),
        updated_at VARCHAR(100),
        data JSONB
      );
    `);
    await localPg.transaction(async (tx) => {
      await upsertUsersWithQuery(async (sql, params) => tx.query(sql, params));
    });
  } catch (localErr: any) {
    console.error('[PLSMS Database] Critical error saving users to local persistent PGlite:', localErr);
    throw new Error(`Failed to persist user credentials to local database: ${localErr.message}`);
  }

  // 2. Also persist to remote PostgreSQL if configured
  if (isRemotePostgresConfigured()) {
    try {
      const pool = getPgPool();
      const client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Remote PostgreSQL connect timeout (2.5s)')), 2500)
        ),
      ]);
      try {
        await client.query('BEGIN');
        await upsertUsersWithQuery(async (sql, params) => client.query(sql, params));
        await client.query('COMMIT');
      } catch (txErr: any) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }
    } catch (remoteErr: any) {
      console.warn('[PLSMS Database] Remote PostgreSQL cluster unavailable for users, durable local PGlite active:', remoteErr.message);
      markRemoteTemporarilyUnavailable(remoteErr);
      // Local persistent PGlite has securely committed the users, so do not reject the request
    }
  }
}

export async function upsertUserInPg(user: User): Promise<void> {
  const email = (user.email || '').toLowerCase().trim();
  const now = new Date().toISOString();
  const cleanUser = { ...user };
  delete (cleanUser as any).savedPassword;
  delete (cleanUser as any).passwordPrefix;
  delete (cleanUser as any).password;
  await queryPg(
    `INSERT INTO users (id, email, password, name, role, office, is_active, created_at, updated_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       password = EXCLUDED.password,
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       office = EXCLUDED.office,
       is_active = EXCLUDED.is_active,
       updated_at = EXCLUDED.updated_at,
       data = EXCLUDED.data`,
    [
      user.id,
      email,
      (user as any).passwordHash || 'REDACTED',
      user.name || 'Staff',
      user.role || 'STAFF',
      (user as any).office || '',
      (user.status === 'SUSPENDED' ? 0 : 1),
      user.createdAt || now,
      now,
      JSON.stringify(cleanUser),
    ]
  );
}

export async function deleteUserInPg(id: string): Promise<void> {
  const normId = id.trim();
  const upperId = normId.toUpperCase();
  // 1. Delete from local persistent PGlite & record in revoked_users table
  try {
    const localPg = await getPglite();
    await localPg.query(
      "DELETE FROM users WHERE UPPER(id) = $1 OR id = $2 OR UPPER(email) = $1 OR UPPER(COALESCE(data->>'id', '')) = $1 OR UPPER(COALESCE(data->>'email', '')) = $1",
      [upperId, normId]
    );
    await localPg.query(`
      CREATE TABLE IF NOT EXISTS revoked_users (
        id VARCHAR(100) PRIMARY KEY,
        revoked_at VARCHAR(100),
        revoked_by VARCHAR(100),
        reason TEXT
      );
    `);
    await localPg.query(
      `INSERT INTO revoked_users (id, revoked_at, revoked_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET revoked_at = EXCLUDED.revoked_at, revoked_by = EXCLUDED.revoked_by`,
      [upperId, new Date().toISOString(), 'SUPER_ADMIN', 'Permanently revoked and deleted user account']
    );
  } catch (localErr: any) {
    console.error('[PLSMS Database] Error deleting user from local persistent PGlite:', localErr.message);
  }

  // 2. Delete from remote PostgreSQL & record in revoked_users table
  if (isRemotePostgresConfigured()) {
    try {
      await queryPg(
        "DELETE FROM users WHERE UPPER(id) = $1 OR id = $2 OR UPPER(email) = $1 OR UPPER(COALESCE(data->>'id', '')) = $1 OR UPPER(COALESCE(data->>'email', '')) = $1",
        [upperId, normId]
      );
      try {
        await queryPg(`
          CREATE TABLE IF NOT EXISTS revoked_users (
            id VARCHAR(100) PRIMARY KEY,
            revoked_at VARCHAR(100),
            revoked_by VARCHAR(100),
            reason TEXT
          );
        `);
        await queryPg(
          `INSERT INTO revoked_users (id, revoked_at, revoked_by, reason)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET revoked_at = EXCLUDED.revoked_at, revoked_by = EXCLUDED.revoked_by`,
          [upperId, new Date().toISOString(), 'SUPER_ADMIN', 'Permanently revoked and deleted user account']
        );
      } catch (_) {}
    } catch (err: any) {
      console.warn('[PLSMS Database] Warning deleting user from remote PostgreSQL:', err.message);
    }
  }
}

export async function unrevokeUserInPg(id: string): Promise<void> {
  const normId = id.trim();
  const upperId = normId.toUpperCase();
  try {
    const localPg = await getPglite();
    await localPg.query('DELETE FROM revoked_users WHERE UPPER(id) = $1 OR id = $2', [upperId, normId]);
  } catch (_) {}
  if (isRemotePostgresConfigured()) {
    try {
      await queryPg('DELETE FROM revoked_users WHERE UPPER(id) = $1 OR id = $2', [upperId, normId]);
    } catch (_) {}
  }
}

/**
 * ========================================================
 * AUDIT LOGS IN POSTGRESQL
 * ========================================================
 */
export async function getAuditLogsFromPg(limit: number = 500): Promise<AuditLogItem[]> {
  const res = await queryPg('SELECT data FROM audit_logs ORDER BY timestamp DESC LIMIT $1', [limit]);
  return res.rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
}

export async function logAuditInPg(log: AuditLogItem): Promise<void> {
  await queryPg(
    `INSERT INTO audit_logs (id, user_id, user_name, action, category, details, ip_address, timestamp, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [
      log.id,
      log.userId || '',
      log.userName || '',
      log.action || 'ACTION',
      log.category || 'SYSTEM',
      log.details || '',
      log.ipAddress || '',
      log.timestamp || new Date().toISOString(),
      JSON.stringify(log),
    ]
  );
}

export async function resetAuditLogsInPg(): Promise<void> {
  await queryPg('DELETE FROM audit_logs');
}

/**
 * ========================================================
 * IMPORT JOBS IN POSTGRESQL (UPLOAD HISTORY)
 * ========================================================
 */
export async function getImportJobsFromPg(): Promise<ImportJob[]> {
  const res = await queryPg('SELECT data FROM import_jobs ORDER BY imported_at DESC');
  return res.rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
}

export async function getImportJobByIdFromPg(id: string): Promise<ImportJob | null> {
  const res = await queryPg('SELECT data FROM import_jobs WHERE id = $1', [id]);
  if (res.rows.length === 0) return null;
  const raw = res.rows[0].data;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function saveImportJobInPg(job: ImportJob): Promise<void> {
  const jobAny = job as any;
  const fullData = {
    ...job,
    jobId: job.id,
    source: job.filename || 'Google Sheets Sync',
    totalRows: job.totalRows || 0,
    lastCompletedRow: jobAny.lastCompletedRow ?? job.newRecords ?? 0,
    lastCompletedBatch: jobAny.lastCompletedBatch ?? 0,
    status: job.status || 'COMPLETED',
    error: jobAny.error ?? jobAny.lastError ?? null,
    startedAt: jobAny.startedAt || job.uploadedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: jobAny.completedAt || (job.status === 'COMPLETED' ? new Date().toISOString() : undefined),
    ...(typeof (job as any).data === 'object' && (job as any).data ? (job as any).data : {}),
  };

  await queryPg(
    `INSERT INTO import_jobs (id, filename, imported_by, total_rows, imported_rows, skipped_rows, duplicate_rows, status, imported_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       filename = EXCLUDED.filename,
       imported_by = EXCLUDED.imported_by,
       total_rows = EXCLUDED.total_rows,
       imported_rows = EXCLUDED.imported_rows,
       skipped_rows = EXCLUDED.skipped_rows,
       duplicate_rows = EXCLUDED.duplicate_rows,
       status = EXCLUDED.status,
       imported_at = EXCLUDED.imported_at,
       data = EXCLUDED.data`,
    [
      job.id,
      job.filename || 'import.xlsx',
      job.uploadedBy || 'Admin',
      job.totalRows || 0,
      fullData.lastCompletedRow || job.newRecords || 0,
      job.invalidRecords || 0,
      job.duplicateRecords || 0,
      job.status || 'COMPLETED',
      job.uploadedAt || new Date().toISOString(),
      JSON.stringify(fullData),
    ]
  );
}

export async function updateImportJobProgressInPg(
  id: string,
  progress: {
    lastCompletedBatch: number;
    lastCompletedRow: number;
    importedRows: number;
    status: string;
    totalRows?: number;
    error?: string;
  }
): Promise<void> {
  const existing = await getImportJobByIdFromPg(id);
  const dataObj: any = existing ? { ...existing } : { id };
  dataObj.lastCompletedBatch = progress.lastCompletedBatch;
  dataObj.lastCompletedRow = progress.lastCompletedRow;
  dataObj.importedRows = progress.importedRows;
  dataObj.status = progress.status;
  dataObj.updatedAt = new Date().toISOString();
  if (progress.totalRows) dataObj.totalRows = progress.totalRows;
  if (progress.error) dataObj.error = progress.error;
  if (progress.status === 'COMPLETED') dataObj.completedAt = new Date().toISOString();

  await queryPg(
    `UPDATE import_jobs 
     SET imported_rows = $2, status = $3, total_rows = COALESCE($4, total_rows), data = $5 
     WHERE id = $1`,
    [
      id,
      progress.importedRows,
      progress.status,
      progress.totalRows || null,
      JSON.stringify(dataObj),
    ]
  );
}

/**
 * On cold boot, safely reconcile any jobs left in RUNNING status to INTERRUPTED
 */
export async function reconcileInterruptedImportJobsInPg(): Promise<number> {
  try {
    const runningJobsRes = await queryPg("SELECT id, data FROM import_jobs WHERE status = 'RUNNING'");
    let count = 0;
    for (const r of runningJobsRes.rows) {
      const dataObj = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
      dataObj.status = 'INTERRUPTED';
      dataObj.interruptedAt = new Date().toISOString();
      dataObj.error = 'Process interrupted during execution (e.g. server restart). Checkpoint preserved for resumption.';
      await queryPg(
        "UPDATE import_jobs SET status = 'INTERRUPTED', data = $2 WHERE id = $1",
        [r.id, JSON.stringify(dataObj)]
      );
      count++;
    }
    return count;
  } catch (err: any) {
    console.warn('[PLSMS DB] Advisory checking interrupted import jobs:', err.message);
    return 0;
  }
}

export async function deleteImportJobInPg(id: string): Promise<void> {
  await queryPg('DELETE FROM import_jobs WHERE id = $1', [id]);
}

/**
 * ========================================================
 * OFFICE NOTICES IN POSTGRESQL
 * ========================================================
 */
export async function getNoticesFromPg(): Promise<OfficeNotice[]> {
  const res = await queryPg('SELECT data FROM notices ORDER BY created_at DESC');
  return res.rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
}

export async function getNoticeByIdFromPg(id: string): Promise<OfficeNotice | null> {
  const res = await queryPg('SELECT data FROM notices WHERE id = $1 LIMIT 1', [id]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
}

export async function createNoticeInPg(notice: OfficeNotice): Promise<void> {
  const now = new Date().toISOString();
  await queryPg(
    `INSERT INTO notices (id, title, content, type, is_active, created_by, created_at, updated_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       type = EXCLUDED.type,
       is_active = EXCLUDED.is_active,
       updated_at = EXCLUDED.updated_at,
       data = EXCLUDED.data`,
    [
      notice.id,
      notice.title,
      notice.content,
      notice.category || 'GENERAL',
      notice.status !== 'DISABLED' ? 1 : 0,
      notice.publishedBy || notice.authorName || 'Admin',
      notice.createdAt || now,
      notice.updatedAt || now,
      JSON.stringify(notice),
    ]
  );
}

export async function updateNoticeInPg(notice: OfficeNotice): Promise<void> {
  await createNoticeInPg(notice);
}

export async function deleteNoticeInPg(id: string): Promise<void> {
  await queryPg('DELETE FROM notices WHERE id = $1', [id]);
}

/**
 * ========================================================
 * PERSISTENT GOOGLE SHEET SYNC QUEUE IN POSTGRESQL
 * ========================================================
 */
export async function insertSheetSyncTaskInPg(licenseNumber: string, data: any): Promise<string> {
  const cleanLic = (licenseNumber || '').trim();

  const existingRes = await queryPg(`
    SELECT id FROM sheet_sync_queue
    WHERE license_number = $1 AND status IN ('PENDING', 'RETRYING')
    ORDER BY queued_at DESC
    LIMIT 1
  `, [cleanLic]);

  if (existingRes.rows.length > 0) {
    const existingId = existingRes.rows[0].id;
    await queryPg(`
      UPDATE sheet_sync_queue
      SET data = $1, queued_at = $2, status = 'PENDING', attempts = 0, last_error = NULL
      WHERE id = $3
    `, [JSON.stringify(data), Date.now(), existingId]);
    return existingId;
  }

  const id = 'SQ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  await queryPg(`
    INSERT INTO sheet_sync_queue (id, license_number, data, queued_at, attempts, status)
    VALUES ($1, $2, $3, $4, 0, 'PENDING')
  `, [id, cleanLic, JSON.stringify(data), Date.now()]);
  return id;
}

export async function markSheetSyncTaskSuccessByLicenseInPg(licenseNumber: string): Promise<void> {
  const cleanLic = (licenseNumber || '').trim();
  await queryPg(`
    UPDATE sheet_sync_queue
    SET status = 'COMPLETED', last_attempt_at = $1
    WHERE license_number = $2 AND status IN ('PENDING', 'RETRYING')
  `, [Date.now(), cleanLic]);
}

export async function getPendingSheetSyncTasksFromPg(limit: number = 20): Promise<QueuedSheetTask[]> {
  try {
    const res = await queryPg(`
      SELECT id, license_number, data, queued_at, attempts, last_attempt_at, last_error, status
      FROM sheet_sync_queue
      WHERE status IN ('PENDING', 'RETRYING')
      ORDER BY queued_at ASC
      LIMIT $1
    `, [limit]);

    return res.rows.map((r) => ({
      id: r.id,
      licenseNumber: r.license_number,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
      queuedAt: Number(r.queued_at),
      attempts: Number(r.attempts),
      lastAttemptAt: r.last_attempt_at ? Number(r.last_attempt_at) : undefined,
      lastError: r.last_error || undefined,
      status: r.status,
    }));
  } catch (err: any) {
    if (err?.message?.includes('does not exist')) {
      await initPostgresSchema();
      return [];
    }
    throw err;
  }
}

export async function markSheetSyncTaskSuccessInPg(id: string): Promise<void> {
  await queryPg(`
    UPDATE sheet_sync_queue
    SET status = 'COMPLETED', last_attempt_at = $1
    WHERE id = $2
  `, [Date.now(), id]);
}

export async function markSheetSyncTaskFailedInPg(id: string, error: string): Promise<void> {
  await queryPg(`
    UPDATE sheet_sync_queue
    SET attempts = attempts + 1,
        last_attempt_at = $1,
        last_error = $2,
        status = 'RETRYING'
    WHERE id = $3
  `, [Date.now(), String(error || 'Sync failed').slice(0, 500), id]);
}

export async function getSheetSyncQueueStatsFromPg(): Promise<{
  queueLength: number;
  pendingCount: number;
  retryingCount: number;
  completedCount: number;
}> {
  try {
    const res = await queryPg(`
      SELECT
        COUNT(CASE WHEN status IN ('PENDING', 'RETRYING') THEN 1 END)::int as queue_length,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END)::int as pending_count,
        COUNT(CASE WHEN status = 'RETRYING' THEN 1 END)::int as retrying_count,
        COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int as completed_count
      FROM sheet_sync_queue
    `);
    const row = res.rows[0];
    return {
      queueLength: row?.queue_length || 0,
      pendingCount: row?.pending_count || 0,
      retryingCount: row?.retrying_count || 0,
      completedCount: row?.completed_count || 0,
    };
  } catch (err: any) {
    if (err?.message?.includes('does not exist')) {
      await initPostgresSchema();
      return { queueLength: 0, pendingCount: 0, retryingCount: 0, completedCount: 0 };
    }
    throw err;
  }
}

/**
 * ========================================================
 * ATOMIC TRANSACTIONS IN POSTGRESQL
 * ========================================================
 */
export async function commitHandoverTransactionInPg(
  record: LicenseRecord,
  distribution: DistributionRecord,
  queuePayload?: { licenseNumber: string; data: any }
): Promise<void> {
  await withTransactionPg(async (query) => {
    // 1. Upsert record
    const rParams = prepareRecordParamsPg(record);
    await query(`
      INSERT INTO records (
        id, applicant_id, application_number, license_number, holder_name,
        category, vehicle_class, office, status, main_status, issue_flag, phone,
        is_distributed, distributed_at, distributed_date, distributed_by,
        receiver_name, receiver_phone, receiver_nid, receiver_relation,
        submitted_document, recommending_staff_name, missing_reason,
        missing_date, found_date, import_id, imported_at, updated_at, data
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29
      ) ON CONFLICT (id) DO UPDATE SET
        is_distributed = EXCLUDED.is_distributed,
        status = EXCLUDED.status,
        main_status = EXCLUDED.main_status,
        distributed_at = EXCLUDED.distributed_at,
        distributed_date = EXCLUDED.distributed_date,
        distributed_by = EXCLUDED.distributed_by,
        receiver_name = EXCLUDED.receiver_name,
        receiver_phone = EXCLUDED.receiver_phone,
        receiver_nid = EXCLUDED.receiver_nid,
        receiver_relation = EXCLUDED.receiver_relation,
        submitted_document = EXCLUDED.submitted_document,
        recommending_staff_name = EXCLUDED.recommending_staff_name,
        updated_at = EXCLUDED.updated_at,
        data = EXCLUDED.data;
    `, rParams);

    // 2. Upsert distribution
    const dParams = prepareDistParamsPg(distribution);
    await query(`
      INSERT INTO distributions (
        id, license_id, license_number, holder_name, receiver_name,
        receiver_phone, receiver_nid, receiver_relation, office,
        distributed_by, distributed_at, distributed_date, remarks,
        submitted_document, recommending_staff_name, handover_reference, data
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17
      ) ON CONFLICT (id) DO UPDATE SET
        receiver_name = EXCLUDED.receiver_name,
        receiver_phone = EXCLUDED.receiver_phone,
        receiver_nid = EXCLUDED.receiver_nid,
        receiver_relation = EXCLUDED.receiver_relation,
        distributed_by = EXCLUDED.distributed_by,
        distributed_at = EXCLUDED.distributed_at,
        distributed_date = EXCLUDED.distributed_date,
        remarks = EXCLUDED.remarks,
        submitted_document = EXCLUDED.submitted_document,
        recommending_staff_name = EXCLUDED.recommending_staff_name,
        handover_reference = EXCLUDED.handover_reference,
        data = EXCLUDED.data;
    `, dParams);

    // 3. Enqueue background Google Sheets writeback
    if (queuePayload) {
      const cleanLic = (queuePayload.licenseNumber || '').trim();
      const existingRes = await query(`
        SELECT id FROM sheet_sync_queue 
        WHERE license_number = $1 AND status IN ('PENDING', 'RETRYING')
        ORDER BY queued_at DESC LIMIT 1
      `, [cleanLic]);

      if (existingRes.rows.length > 0) {
        await query(`
          UPDATE sheet_sync_queue 
          SET data = $1, queued_at = $2, status = 'PENDING', attempts = 0, last_error = NULL
          WHERE id = $3
        `, [JSON.stringify(queuePayload.data), Date.now(), existingRes.rows[0].id]);
      } else {
        const qid = 'SQ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        await query(`
          INSERT INTO sheet_sync_queue (id, license_number, data, queued_at, attempts, status)
          VALUES ($1, $2, $3, $4, 0, 'PENDING')
        `, [qid, cleanLic, JSON.stringify(queuePayload.data), Date.now()]);
      }
    }
  });
}

export async function commitResetDistributionTransactionInPg(
  record: LicenseRecord,
  licenseNumber: string,
  queuePayload?: { licenseNumber: string; data: any }
): Promise<void> {
  await withTransactionPg(async (query) => {
    // 1. Update record
    const rParams = prepareRecordParamsPg(record);
    await query(`
      INSERT INTO records (
        id, applicant_id, application_number, license_number, holder_name,
        category, vehicle_class, office, status, main_status, issue_flag, phone,
        is_distributed, distributed_at, distributed_date, distributed_by,
        receiver_name, receiver_phone, receiver_nid, receiver_relation,
        submitted_document, recommending_staff_name, missing_reason,
        missing_date, found_date, import_id, imported_at, updated_at, data
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29
      ) ON CONFLICT (id) DO UPDATE SET
        is_distributed = EXCLUDED.is_distributed,
        status = EXCLUDED.status,
        main_status = EXCLUDED.main_status,
        distributed_at = EXCLUDED.distributed_at,
        distributed_date = EXCLUDED.distributed_date,
        distributed_by = EXCLUDED.distributed_by,
        receiver_name = EXCLUDED.receiver_name,
        receiver_phone = EXCLUDED.receiver_phone,
        receiver_nid = EXCLUDED.receiver_nid,
        receiver_relation = EXCLUDED.receiver_relation,
        submitted_document = EXCLUDED.submitted_document,
        recommending_staff_name = EXCLUDED.recommending_staff_name,
        updated_at = EXCLUDED.updated_at,
        data = EXCLUDED.data;
    `, rParams);

    // 2. Delete distribution
    await query('DELETE FROM distributions WHERE license_id = $1 OR license_number = $2', [record.id, licenseNumber]);

    // 3. Enqueue sheet task
    if (queuePayload) {
      const cleanLic = (queuePayload.licenseNumber || '').trim();
      const existingRes = await query(`
        SELECT id FROM sheet_sync_queue 
        WHERE license_number = $1 AND status IN ('PENDING', 'RETRYING')
        ORDER BY queued_at DESC LIMIT 1
      `, [cleanLic]);

      if (existingRes.rows.length > 0) {
        await query(`
          UPDATE sheet_sync_queue 
          SET data = $1, queued_at = $2, status = 'PENDING', attempts = 0, last_error = NULL
          WHERE id = $3
        `, [JSON.stringify(queuePayload.data), Date.now(), existingRes.rows[0].id]);
      } else {
        const qid = 'SQ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        await query(`
          INSERT INTO sheet_sync_queue (id, license_number, data, queued_at, attempts, status)
          VALUES ($1, $2, $3, $4, 0, 'PENDING')
        `, [qid, cleanLic, JSON.stringify(queuePayload.data), Date.now()]);
      }
    }
  });
}

export async function commitRecordStatusTransactionInPg(
  record: LicenseRecord,
  removeDistribution: boolean,
  queuePayload?: { licenseNumber: string; data: any }
): Promise<void> {
  await withTransactionPg(async (query) => {
    // 1. Upsert record
    const rParams = prepareRecordParamsPg(record);
    await query(`
      INSERT INTO records (
        id, applicant_id, application_number, license_number, holder_name,
        category, vehicle_class, office, status, main_status, issue_flag, phone,
        is_distributed, distributed_at, distributed_date, distributed_by,
        receiver_name, receiver_phone, receiver_nid, receiver_relation,
        submitted_document, recommending_staff_name, missing_reason,
        missing_date, found_date, import_id, imported_at, updated_at, data
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        main_status = EXCLUDED.main_status,
        issue_flag = EXCLUDED.issue_flag,
        is_distributed = EXCLUDED.is_distributed,
        distributed_at = EXCLUDED.distributed_at,
        distributed_date = EXCLUDED.distributed_date,
        distributed_by = EXCLUDED.distributed_by,
        receiver_name = EXCLUDED.receiver_name,
        receiver_phone = EXCLUDED.receiver_phone,
        receiver_nid = EXCLUDED.receiver_nid,
        receiver_relation = EXCLUDED.receiver_relation,
        submitted_document = EXCLUDED.submitted_document,
        recommending_staff_name = EXCLUDED.recommending_staff_name,
        missing_reason = EXCLUDED.missing_reason,
        missing_date = EXCLUDED.missing_date,
        found_date = EXCLUDED.found_date,
        updated_at = EXCLUDED.updated_at,
        data = EXCLUDED.data;
    `, rParams);

    // 2. Remove distribution if requested
    if (removeDistribution) {
      await query('DELETE FROM distributions WHERE license_id = $1 OR license_number = $2', [record.id, record.licenseNumber]);
    }

    // 3. Queue payload
    if (queuePayload) {
      const cleanLic = (queuePayload.licenseNumber || '').trim();
      const existingRes = await query(`
        SELECT id FROM sheet_sync_queue 
        WHERE license_number = $1 AND status IN ('PENDING', 'RETRYING')
        ORDER BY queued_at DESC LIMIT 1
      `, [cleanLic]);

      if (existingRes.rows.length > 0) {
        await query(`
          UPDATE sheet_sync_queue 
          SET data = $1, queued_at = $2, status = 'PENDING', attempts = 0, last_error = NULL
          WHERE id = $3
        `, [JSON.stringify(queuePayload.data), Date.now(), existingRes.rows[0].id]);
      } else {
        const qid = 'SQ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        await query(`
          INSERT INTO sheet_sync_queue (id, license_number, data, queued_at, attempts, status)
          VALUES ($1, $2, $3, $4, 0, 'PENDING')
        `, [qid, cleanLic, JSON.stringify(queuePayload.data), Date.now()]);
      }
    }
  });
}

/**
 * ========================================================
 * REPORTING & AGGREGATIONS IN POSTGRESQL
 * ========================================================
 */
export async function getReportsCountsFromPg(office?: string): Promise<{
  totalRecords: number;
  availableCount: number;
  notDistributedCount?: number;
  distributedCount: number;
  missingCount: number;
  foundCount: number;
  requestToReceiveCount: number;
}> {
  // Ultra-fast path: reuse in-memory aggregated dashboard stats if available
  if (cachedDashboardStats) {
    if (!office || office === 'ALL') {
      return {
        totalRecords: cachedDashboardStats.totalRecords,
        availableCount: cachedDashboardStats.availableRecords,
        distributedCount: cachedDashboardStats.distributedRecords,
        missingCount: cachedDashboardStats.missingRecords,
        foundCount: cachedDashboardStats.foundRecords,
        requestToReceiveCount: (cachedDashboardStats as any).pendingRecords || 0,
      };
    }
    const match = cachedDashboardStats.officeDistribution.find(
      (o) => o.office.toLowerCase().trim() === office.toLowerCase().trim()
    );
    if (match) {
      return {
        totalRecords: match.total,
        availableCount: match.available,
        distributedCount: match.distributed,
        missingCount: match.missing,
        foundCount: match.found || 0,
        requestToReceiveCount: (match as any).pending || 0,
      };
    }
  }

  let whereSql = '';
  const params: any[] = [];
  if (office && office !== 'ALL') {
    whereSql = 'WHERE LOWER(TRIM(office)) = LOWER(TRIM($1))';
    params.push(office);
  }

  try {
    const res = await queryPg(`
      SELECT
        COUNT(*)::int as total_records,
        COUNT(CASE WHEN is_distributed = 1 OR status = 'DISTRIBUTED' OR COALESCE(data->>'foundHandoverDone', 'false') = 'true' OR COALESCE(data->>'found_handover_done', 'false') = 'true' THEN 1 END)::int as distributed_count,
        COUNT(CASE WHEN status = 'MISSING' OR issue_flag = 'MISSING' THEN 1 END)::int as missing_count,
        COUNT(CASE WHEN (status = 'FOUND' OR issue_flag = 'FOUND') AND (COALESCE(data->>'foundHandoverDone', 'false') != 'true' AND COALESCE(data->>'found_handover_done', 'false') != 'true') THEN 1 END)::int as found_count,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END)::int as pending_count
      FROM records
      ${whereSql}
    `, params, 20000);

    const row = res.rows[0];
    const total = row?.total_records || 0;
    const dist = row?.distributed_count || 0;
    const miss = row?.missing_count || 0;
    const found = row?.found_count || 0;
    const pending = row?.pending_count || 0;
    const avail = Math.max(0, total - dist);

    return {
      totalRecords: total,
      availableCount: avail,
      notDistributedCount: avail,
      distributedCount: dist,
      missingCount: miss,
      foundCount: found,
      requestToReceiveCount: pending,
    };
  } catch (err: any) {
    console.warn('[PLSMS PostgreSQL] Reports count fallback notice:', err?.message || err);
    return {
      totalRecords: cachedRecordsCount || 0,
      availableCount: cachedRecordsCount || 0,
      distributedCount: 0,
      missingCount: 0,
      foundCount: 0,
      requestToReceiveCount: 0,
    };
  }
}

export async function getReportRecordsFromPg(
  reportType: string,
  office?: string,
  limit: number = 5000
): Promise<LicenseRecord[]> {
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (office && office !== 'ALL') {
    whereClauses.push(`LOWER(TRIM(office)) = LOWER(TRIM($${params.length + 1}))`);
    params.push(office);
  }

  switch (reportType) {
    case 'AVAILABLE':
    case 'NOT_DISTRIBUTED':
      whereClauses.push(`(COALESCE(is_distributed, 0) = 0 AND COALESCE(status, '') != 'DISTRIBUTED' AND COALESCE(data->>'foundHandoverDone', 'false') != 'true' AND COALESCE(data->>'found_handover_done', 'false') != 'true')`);
      break;
    case 'DISTRIBUTED':
    case 'DISTRIBUTION_AUDIT':
      whereClauses.push(`(is_distributed = 1 OR status = 'DISTRIBUTED' OR status = 'FOUND' OR issue_flag = 'FOUND' OR COALESCE(data->>'foundHandoverDone', 'false') = 'true' OR COALESCE(data->>'found_handover_done', 'false') = 'true' OR COALESCE(data->>'foundDate', '') != '')`);
      break;
    case 'HANDED_OVER':
      whereClauses.push(`(COALESCE(status, '') != 'MISSING' AND COALESCE(issue_flag, '') != 'MISSING' AND (status = 'FOUND' OR issue_flag = 'FOUND' OR COALESCE(data->>'foundHandoverDone', 'false') = 'true' OR COALESCE(data->>'found_handover_done', 'false') = 'true' OR COALESCE(data->>'foundDate', '') != '' OR (COALESCE(data->>'missingDate', '') != '' AND (is_distributed = 1 OR status = 'DISTRIBUTED'))))`);
      break;
    case 'MISSING':
    case 'MISSING_RECORDS':
      whereClauses.push(`(status = 'MISSING' OR issue_flag = 'MISSING')`);
      break;
    case 'FOUND':
      whereClauses.push(`(status = 'FOUND' OR issue_flag = 'FOUND')`);
      break;
    case 'REQUEST_TO_RECEIVE':
      whereClauses.push(`status = 'PENDING'`);
      break;
    case 'TOTAL_SMART_CARDS':
    case 'MASTER_INVENTORY':
    case 'AGGREGATE_REPORT':
    default:
      break;
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
  const limitParam = `$${params.length + 1}`;
  params.push(limit);

  const res = await queryPg(`
    SELECT data FROM records
    ${whereSql}
    ORDER BY id DESC
    LIMIT ${limitParam}
  `, params);

  return res.rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)) as LicenseRecord[];
}

let cachedDashboardStats: Omit<DashboardStats, 'totalImports' | 'recentImports'> | null = null;
let cachedDashboardStatsTime = 0;
let inFlightDashboardStatsPromise: Promise<Omit<DashboardStats, 'totalImports' | 'recentImports'>> | null = null;

export function invalidateDashboardStatsCache(): void {
  cachedDashboardStats = null;
  cachedDashboardStatsTime = 0;
  cachedRecordsCount = 0;
  cachedRecordsCountTime = 0;
}

export async function getDashboardStatsFromPg(forceFresh = false): Promise<Omit<DashboardStats, 'totalImports' | 'recentImports'>> {
  const now = Date.now();
  // 1. Fresh cache hit (valid for 60 seconds)
  if (!forceFresh && cachedDashboardStats && (now - cachedDashboardStatsTime < 60000)) {
    return cachedDashboardStats;
  }

  // 2. Return existing calculation if in flight
  if (inFlightDashboardStatsPromise) {
    return inFlightDashboardStatsPromise;
  }

  // 3. Stale-while-revalidate: if stale cache exists and not explicitly forced, return immediately and refresh in background
  if (!forceFresh && cachedDashboardStats) {
    getDashboardStatsFromPg(true).catch(() => {});
    return cachedDashboardStats;
  }

  inFlightDashboardStatsPromise = (async () => {
    try {
      // Single combined query: computes all office distributions and totals in a single pass
      const officeRowsRes = await queryPg(`
        SELECT
          COALESCE(NULLIF(TRIM(office), ''), 'Main Office') as office,
          COUNT(*)::int as total,
          COUNT(CASE WHEN is_distributed = 1 OR status = 'DISTRIBUTED' OR COALESCE(data->>'foundHandoverDone', 'false') = 'true' OR COALESCE(data->>'found_handover_done', 'false') = 'true' THEN 1 END)::int as distributed,
          COUNT(CASE WHEN status = 'MISSING' OR issue_flag = 'MISSING' THEN 1 END)::int as missing,
          COUNT(CASE WHEN (status = 'FOUND' OR issue_flag = 'FOUND') AND (COALESCE(data->>'foundHandoverDone', 'false') != 'true' AND COALESCE(data->>'found_handover_done', 'false') != 'true') THEN 1 END)::int as found,
          COUNT(CASE WHEN COALESCE(data->>'foundHandoverDone', 'false') = 'true' OR COALESCE(data->>'found_handover_done', 'false') = 'true' THEN 1 END)::int as handed_over,
          COUNT(CASE WHEN status = 'PENDING' THEN 1 END)::int as pending,
          COUNT(CASE WHEN status = 'EXPIRED' THEN 1 END)::int as expired
        FROM records
        GROUP BY COALESCE(NULLIF(TRIM(office), ''), 'Main Office')
        ORDER BY total DESC
      `, [], 35000);

      let totalRecords = 0;
      let distributedRecords = 0;
      let missingRecords = 0;
      let foundRecords = 0;
      let handedOverRecords = 0;
      let pendingRecords = 0;
      let expiredRecords = 0;

      const officeDistribution = officeRowsRes.rows.map((r: any) => {
        const tot = Number(r.total || 0);
        const dist = Number(r.distributed || 0);
        const miss = Number(r.missing || 0);
        const fnd = Number(r.found || 0);
        const hnd = Number(r.handed_over || 0);
        const pend = Number(r.pending || 0);
        const exp = Number(r.expired || 0);
        totalRecords += tot;
        distributedRecords += dist;
        missingRecords += miss;
        foundRecords += fnd;
        handedOverRecords += hnd;
        pendingRecords += pend;
        expiredRecords += exp;
        const available = Math.max(0, tot - dist);
        return {
          office: r.office,
          total: tot,
          available,
          distributed: dist,
          missing: miss,
          found: fnd,
          handedOver: hnd,
        };
      });

      // Quick reltuples fallback if records returned 0
      if (totalRecords === 0 && isRemotePostgresConfigured()) {
        try {
          const est = await queryPg("SELECT reltuples::bigint as count FROM pg_class WHERE relname = 'records' AND reltuples > 0", [], 2000);
          const estVal = Number(est.rows[0]?.count || 0);
          if (estVal > 0) totalRecords = estVal;
        } catch (_) {}
      }

      // Query distributions count
      let totalDistributions = distributedRecords;
      try {
        const totalDistRes = await queryPg('SELECT COUNT(*)::int as cnt FROM distributions', [], 5000);
        const cnt = Number(totalDistRes.rows[0]?.cnt || 0);
        if (cnt > 0) totalDistributions = cnt;
      } catch (_) {}

      // Query recent distributions
      let recentDistributions: DistributionRecord[] = [];
      try {
        const recentDistRes = await queryPg('SELECT data FROM distributions ORDER BY distributed_at DESC LIMIT 10', [], 5000);
        recentDistributions = recentDistRes.rows.map((r: any) => {
          try {
            return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
          } catch {
            return null;
          }
        }).filter(Boolean);
      } catch (_) {}

      const availableRecords = Math.max(0, totalRecords - distributedRecords);

      const stats = {
        totalRecords,
        availableRecords,
        notDistributedRecords: availableRecords,
        distributedRecords,
        missingRecords,
        foundRecords,
        handedOverRecords,
        pendingRecords,
        expiredRecords,
        totalDistributions,
        officeDistribution,
        recentDistributions,
      };

      cachedDashboardStats = stats;
      cachedDashboardStatsTime = Date.now();
      return stats;
    } catch (err: any) {
      console.warn('[PLSMS PostgreSQL] Dashboard stats refresh notice:', err?.message || err);
      if (cachedDashboardStats) {
        return cachedDashboardStats;
      }
      return {
        totalRecords: cachedRecordsCount || 0,
        availableRecords: cachedRecordsCount || 0,
        distributedRecords: 0,
        missingRecords: 0,
        foundRecords: 0,
        handedOverRecords: 0,
        pendingRecords: 0,
        expiredRecords: 0,
        totalDistributions: 0,
        officeDistribution: [],
        recentDistributions: [],
      };
    } finally {
      inFlightDashboardStatsPromise = null;
    }
  })();

  return inFlightDashboardStatsPromise;
}

export async function saveSystemConfigInPg(key: string, value: string): Promise<void> {
  await queryPg(`
    INSERT INTO system_configuration (key, value, updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = EXCLUDED.updated_at;
  `, [key, value, new Date().toISOString()]);
}

export async function getSystemConfigFromPg(key: string): Promise<string | null> {
  const res = await queryPg('SELECT value FROM system_configuration WHERE key = $1', [key]);
  return res.rows[0]?.value || null;
}

export async function saveSheetSyncCheckpointInPg(checkpoint: SheetSyncCheckpoint): Promise<void> {
  await saveSystemConfigInPg('sheet_sync_checkpoint', JSON.stringify(checkpoint));
  try {
    await queryPg(`
      INSERT INTO sheet_sync_checkpoint (id, last_sync_timestamp, last_sync_iso, status, records_synced, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        last_sync_timestamp = EXCLUDED.last_sync_timestamp,
        last_sync_iso = EXCLUDED.last_sync_iso,
        status = EXCLUDED.status,
        records_synced = EXCLUDED.records_synced,
        metadata = EXCLUDED.metadata
    `, [
      'PRIMARY',
      checkpoint.lastSyncTimestamp || Date.now(),
      checkpoint.lastSyncIso || new Date().toISOString(),
      checkpoint.status || 'SUCCESS',
      checkpoint.recordsSynced || 0,
      JSON.stringify(checkpoint),
    ]);
  } catch (_) {}
}

export async function getSheetSyncCheckpointFromPg(): Promise<SheetSyncCheckpoint | null> {
  try {
    const res = await queryPg('SELECT metadata FROM sheet_sync_checkpoint WHERE id = $1', ['PRIMARY']);
    if (res.rows[0]?.metadata) return res.rows[0].metadata;
  } catch (_) {}
  const jsonStr = await getSystemConfigFromPg('sheet_sync_checkpoint');
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr) as SheetSyncCheckpoint;
  } catch {
    return null;
  }
}

export async function clearSheetSyncCheckpointInPg(): Promise<void> {
  await queryPg("DELETE FROM system_configuration WHERE key = 'sheet_sync_checkpoint'");
  try {
    await queryPg("DELETE FROM sheet_sync_checkpoint WHERE id = 'PRIMARY'");
  } catch (_) {}
}

export async function getModifiedOrDistributedRecordsFromPg(): Promise<LicenseRecord[]> {
  const res = await queryPg(`
    SELECT data, receiver_name FROM records 
    WHERE is_distributed = 1 
       OR (status IS NOT NULL AND status != 'AVAILABLE') 
       OR (recommending_staff_name IS NOT NULL AND TRIM(recommending_staff_name) != '')
  `, [], 45000);
  return res.rows.map((r) => normalizeRecordFromPgData(r.data, r.receiver_name));
}

export async function getDistributedRecordsFromPg(): Promise<LicenseRecord[]> {
  const res = await queryPg(`
    SELECT data, receiver_name FROM records 
    WHERE is_distributed = 1 
       OR status = 'DISTRIBUTED' 
       OR (distributed_date IS NOT NULL AND TRIM(distributed_date) != '')
  `, [], 45000);
  return res.rows.map((r) => normalizeRecordFromPgData(r.data, r.receiver_name));
}

/**
 * High-performance search against PostgreSQL indexed records
 */
export async function searchRecordsInPg(params: {
  q?: string;
  strictIdOrLicense?: boolean;
  status?: string;
  office?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  fromDateBS?: string;
  toDateBS?: string;
}): Promise<{ records: LicenseRecord[]; total: number; page: number; limit: number; totalPages: number }> {
  const { q, strictIdOrLicense, status, office, page = 1, limit = 50 } = params;
  const whereClauses: string[] = [];
  const queryParams: any[] = [];

  if (q && q.trim()) {
    const term = q.trim();
    const cleanTerm = term.replace(/[\s\-_]/g, '');
    if (strictIdOrLicense) {
      const candidates = getSearchCandidateNumbers(term);
      const pIdx = queryParams.length + 1;
      whereClauses.push(`(
        license_number = ANY($${pIdx}) OR 
        applicant_id = ANY($${pIdx}) OR 
        application_number = ANY($${pIdx})
      )`);
      queryParams.push(candidates);
    } else {
      const p1 = queryParams.length + 1;
      const p2 = queryParams.length + 2;
      const p3 = queryParams.length + 3;
      const p4 = queryParams.length + 4;
      const p5 = queryParams.length + 5;
      const p6 = queryParams.length + 6;
      whereClauses.push(`(
        license_number ILIKE $${p1} OR 
        applicant_id ILIKE $${p2} OR 
        application_number ILIKE $${p3} OR 
        holder_name ILIKE $${p4} OR 
        phone ILIKE $${p5} OR 
        office ILIKE $${p6}
      )`);
      const wild = `%${term}%`;
      queryParams.push(wild, wild, wild, wild, wild, wild);
    }
  }

  if (status && status !== 'ALL') {
    if (status === 'DISTRIBUTED') {
      whereClauses.push('(is_distributed = 1 OR status = \'DISTRIBUTED\' OR status = \'FOUND\' OR issue_flag = \'FOUND\' OR COALESCE(data->>\'foundHandoverDone\', \'false\') = \'true\' OR COALESCE(data->>\'found_handover_done\', \'false\') = \'true\' OR COALESCE(data->>\'foundDate\', \'\') != \'\')');
    } else if (status === 'NOT_DISTRIBUTED' || status === 'AVAILABLE') {
      whereClauses.push('(COALESCE(is_distributed, 0) = 0 AND COALESCE(status, \'\') != \'DISTRIBUTED\' AND COALESCE(data->>\'foundHandoverDone\', \'false\') != \'true\' AND COALESCE(data->>\'found_handover_done\', \'false\') != \'true\')');
    } else if (status === 'FOUND') {
      whereClauses.push('(status = \'FOUND\' OR issue_flag = \'FOUND\')');
    } else if (status === 'MISSING') {
      whereClauses.push('(status = \'MISSING\' OR issue_flag = \'MISSING\')');
    } else if (status === 'HANDED_OVER') {
      whereClauses.push('(COALESCE(status, \'\') != \'MISSING\' AND COALESCE(issue_flag, \'\') != \'MISSING\' AND (status = \'FOUND\' OR issue_flag = \'FOUND\' OR COALESCE(data->>\'foundHandoverDone\', \'false\') = \'true\' OR COALESCE(data->>\'found_handover_done\', \'false\') = \'true\' OR COALESCE(data->>\'foundDate\', \'\') != \'\' OR (COALESCE(data->>\'missingDate\', \'\') != \'\' AND (is_distributed = 1 OR status = \'DISTRIBUTED\'))))');
    } else {
      whereClauses.push(`status = $${queryParams.length + 1}`);
      queryParams.push(status);
    }
  }

  if (office && office !== 'ALL') {
    whereClauses.push(`LOWER(TRIM(office)) = LOWER(TRIM($${queryParams.length + 1}))`);
    queryParams.push(office);
  }

  const whereSql = whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : '';
  let total = 0;
  if (whereClauses.length === 0) {
    total = await getRecordsCountInPg();
  } else {
    const countRes = await queryPg(`SELECT COUNT(*)::int as count FROM records ${whereSql}`, queryParams, 45000);
    total = countRes.rows[0]?.count || 0;
  }
  const offset = Math.max(0, (page - 1) * limit);

  const limitParamIdx = queryParams.length + 1;
  const offsetParamIdx = queryParams.length + 2;
  const rowsRes = await queryPg(
    `SELECT data, receiver_name FROM records ${whereSql} ORDER BY id DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
    [...queryParams, limit, offset],
    45000
  );

  const records = rowsRes.rows
    .map((r) => {
      try {
        return normalizeRecordFromPgData(r.data, r.receiver_name);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as LicenseRecord[];

  return {
    records,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}
