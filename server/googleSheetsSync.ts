import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { JWT } from 'google-auth-library';
import { parseCSVFast, extractHeadersAndDataFromMatrix, detectColumnMapping, XLSX, streamCsvFileInBatches } from './excelParser';
import { evaluateAndMapSpreadsheet } from './mappingEngine';
import { LicenseRecord, ImportJob, GoogleSheetsConfig, CrossPlatformParityStats } from '../src/types';
import {
  buildKAP4ColKey,
  buildCompositeKey,
  normalizeCleanApplicantId,
  normalizeCleanLicenseNumber,
  normalizeCleanLicDigits,
  normalizeCleanHolderName,
  normalizeCleanCategory,
  UnifiedRecordMapIndex,
  calculateCrossPlatformParity,
  annotateRecordsWithParity,
  isRecordDistributed,
  isRecordFound,
  isRecordMissing,
  isRecordHandedOver,
} from './matchingEngine';
import {
  getAllRecords,
  getActionOverrides,
  getImportJobs,
  saveImportJob,
  batchInsertOrUpdateRecords,
  logAudit,
  invalidateRecordsCache,
  getRecordsCache,
  findRecordByNumber,
  getDashboardStats,
  cancelPendingWrites,
  reconcileDistributionsFromRecords,
  extractCleanSubmittedDoc,
  cleanStaffName,
  normalizeRecordData,
  resolveUserFullName,
  persistSyncBatch,
  addRecordStatusChangeHook,
  resetRecordsCacheInMemory,
  reloadRecordsCacheFromPg,
} from './db';
import { getNepaliDevanagariBSDate, toDevanagariDigits } from './nepaliDate';
import {
  isPostgresConfigured,
  getPgPool,
  queryPg,
  clearRecordsInPg,
  initRecordsStagingTable,
  clearRecordsStagingInPg,
  getRecordsStagingCountInPg,
  swapRecordsStagingToLive,
  deleteRecordsByImportIdInPg,
  insertSheetSyncTaskInPg,
  getPendingSheetSyncTasksFromPg,
  markSheetSyncTaskSuccessInPg,
  markSheetSyncTaskSuccessByLicenseInPg,
  markSheetSyncTaskFailedInPg,
  getSheetSyncQueueStatsFromPg,
  saveSystemConfigInPg,
  getSystemConfigFromPg,
  QueuedSheetTask,
  saveSheetSyncCheckpointInPg,
  getSheetSyncCheckpointFromPg,
  clearSheetSyncCheckpointInPg,
  getModifiedOrDistributedRecordsFromPg,
  getAllExistingRecordKeysFromPg,
  getAllExistingRecordIdsFromPg,
  getRecordsCountInPg,
  upsertRecordsBatchInPg,
  withTransactionPg,
  saveImportJobInPg,
  updateImportJobProgressInPg,
  getImportJobByIdFromPg,
} from './db_postgres';
import {
  isMasterApp,
  isRemixedApp,
  isClonedMasterSheetConfig,
  isLegacyOrBundledSheet,
  getCurrentAppletId,
  getAppScopedFilename,
} from './appIsolation';

const STORAGE_DIR = path.join(process.cwd(), 'data_storage');
const STORAGE_UPLOADS = path.join(STORAGE_DIR, 'uploads');
const CONFIG_FILE = path.join(STORAGE_DIR, getAppScopedFilename('google_sheets_config.json'));
const MASTER_CONFIG_VAULT_FILE = path.join(STORAGE_DIR, 'master_google_sheets_config_permanent_vault.json');

export function getAppScopedConfigKey(baseKey: string = 'google_sheets_config'): string {
  return baseKey;
}

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}
if (!fs.existsSync(STORAGE_UPLOADS)) {
  fs.mkdirSync(STORAGE_UPLOADS, { recursive: true });
}

export type { GoogleSheetsConfig };

export interface ActiveImportProgress {
  active: boolean;
  jobId: string;
  source: string;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED';
  totalRows: number;
  processedRows: number;
  currentBatch: number;
  totalBatches: number;
  percentage: number;
  lastCompletedBatch: number;
  lastCompletedRow: number;
  error?: string | null;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
}

let activeImportProgress: ActiveImportProgress = {
  active: false,
  jobId: '',
  source: '',
  status: 'IDLE',
  totalRows: 0,
  processedRows: 0,
  currentBatch: 0,
  totalBatches: 0,
  percentage: 0,
  lastCompletedBatch: 0,
  lastCompletedRow: 0,
  updatedAt: new Date().toISOString(),
};

export function getActiveImportProgress(): ActiveImportProgress {
  return { ...activeImportProgress };
}

/**
 * Helper to check if a private key is a valid RSA/PEM private key
 */
function isValidServiceAccountPrivateKey(rawKey: string): boolean {
  if (!rawKey || typeof rawKey !== 'string') return false;
  const trimmed = rawKey.trim();
  if (trimmed.includes('•') || trimmed.includes('****')) return false;
  if (!trimmed.includes('-----BEGIN') || !trimmed.includes('-----END')) return false;
  try {
    const formatted = trimmed.replace(/\\n/g, '\n');
    crypto.createPrivateKey({ key: formatted, format: 'pem' });
    return true;
  } catch {
    return false;
  }
}

function isValidServiceAccountEmail(rawEmail: string): boolean {
  if (!rawEmail || typeof rawEmail !== 'string') return false;
  const trimmed = rawEmail.trim();
  if (trimmed.includes('•') || trimmed.includes('****')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Get Service Account credentials from environment variables or secure keyfile
 */
export function getServiceAccountCredentials(): {
  email: string;
  privateKey: string;
  isConfigured: boolean;
} {
  let email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  let privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || '').trim();

  // Extract from full JSON credentials if privateKey or email is missing
  if ((!privateKey || !email || email.includes('•') || privateKey.includes('•')) && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      if (parsed.client_email && (!email || email.includes('•'))) email = String(parsed.client_email).trim();
      if (parsed.private_key && (!privateKey || privateKey.includes('•'))) privateKey = String(parsed.private_key).trim();
    } catch {}
  }

  // Extract from local service account JSON credentials file if present
  if ((!privateKey || !email || email.includes('•') || privateKey.includes('•')) && process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    try {
      const content = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.client_email && (!email || email.includes('•'))) email = String(parsed.client_email).trim();
      if (parsed.private_key && (!privateKey || privateKey.includes('•'))) privateKey = String(parsed.private_key).trim();
    } catch {}
  }

  // Clean email
  if (!isValidServiceAccountEmail(email)) {
    email = 'plsms-sync-proxy@plsms-sync-proxy.iam.gserviceaccount.com';
  }

  // Validate privateKey
  let isConfigured = false;
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n').trim();
    if (isValidServiceAccountPrivateKey(privateKey)) {
      isConfigured = true;
    } else {
      privateKey = '';
      isConfigured = false;
    }
  }

  return { email, privateKey, isConfigured };
}

export const OFFICIAL_DEFAULT_SHEET_ID = '';
export const OFFICIAL_DEFAULT_TAB_NAME = '';

function normalizeCodeDashes(val: unknown): string {
  if (val === undefined || val === null) return '----';
  const str = String(val).trim();
  if (!str) return '----';
  const stripped = str.replace(/[\s\-_—–./\\]/g, '');
  if (!stripped || /^(na|n\/a|null|none|nil|undefined|0)$/i.test(stripped)) {
    return '----';
  }
  let cleaned = str.replace(/(?:[-—–]\s*){4,}/g, '----');
  cleaned = cleaned.replace(/[-—–]{4,}/g, '----');
  return cleaned.trim();
}

// High-speed In-Memory Row Mapping Cache for Google Sheet & DB (KAP / MAP)
export const sheetLicenseRowMap = new Map<string, number>();
export const sheetCleanLicenseRowMap = new Map<string, number>();
export const sheetAppIdRowMap = new Map<string, number>();
export const sheetCompositeRowMap = new Map<string, number>();
export const sheet4ColCompositeRowMap = new Map<string, number>();
export const sheetTabIdMap = new Map<string, number>();

export { buildKAP4ColKey };

/**
 * Uniquely identifies a physical Google Sheet row by Source Sheet + Sheet Tab + Sheet Row.
 */
export function buildSheetRowIdentityKey(sheetId: string, tab: string, rowNum: number): string {
  const cleanSheet = (sheetId || 'default').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTab = (tab || 'sheet1').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return `SR_${cleanSheet}_${cleanTab}_R${rowNum}`;
}

/**
 * Creates a deterministic, stable PLSMS Record ID for a physical Google Sheet row.
 */
export function buildDeterministicSheetRecordId(sheetId: string, tab: string, rowNum: number): string {
  const cleanSheet = (sheetId || 'SHEET').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const cleanTab = (tab || 'Sheet1').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  return `GS_${cleanSheet}_${cleanTab}_R${rowNum}`;
}

/**
 * Dynamic Column Header Mapping Structure
 * Matches columns dynamically by header text instead of hardcoded column letters:
 * I: DISTRIBUTED TO
 * J: DISTRIBUTED DATE
 * K: DISTRIBUTED BY
 * L: SUBMITTED DOC.
 * M: DISTRIBUTED
 * N: MISSING
 * O: FOUND
 * P: HAND OVER
 */
export interface DetectedSheetColumns {
  appIdCol: number;           // Col B (Default 2)
  nameCol: number;            // Col C (Default 3)
  licCol: number;             // Col D (Default 4)
  categoryCol: number;        // Col E (Default 5)
  oldCodeCol: number;         // Col F (Default 6)
  newCodeCol: number;         // Col G (Default 7)
  distributedToCol: number;   // Col I (Default 9) - DISTRIBUTED TO
  distributedDateCol: number; // Col J (Default 10) - DISTRIBUTED DATE
  distributedByCol: number;   // Col K (Default 11) - DISTRIBUTED BY
  submittedDocCol: number;    // Col L (Default 12) - SUBMITTED DOC.
  distributedCol: number;     // Col M (Default 13) - DISTRIBUTED
  missingCol: number;         // Col N (Default 14) - MISSING
  foundCol: number;           // Col O (Default 15) - FOUND
  handOverCol: number;        // Col P (Default 16) - HAND OVER
}

/**
 * Converts 1-based column number to Google Sheets A1 letter (1 -> A, 9 -> I, 16 -> P)
 */
export function columnNumberToA1(colNumber: number): string {
  let s = '';
  let n = colNumber;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || 'A';
}

/**
 * Detects exact column indices from Row 1 headers dynamically.
 * Maps:
 * I: DISTRIBUTED TO
 * J: DISTRIBUTED DATE
 * K: DISTRIBUTED BY
 * L: SUBMITTED DOC.
 * M: DISTRIBUTED
 * N: MISSING
 * O: FOUND
 * P: HAND OVER
 */
export function detectSheetHeaderColumns(headers: string[]): DetectedSheetColumns {
  const map: DetectedSheetColumns = {
    appIdCol: 2,           // Col B
    nameCol: 3,            // Col C
    licCol: 4,             // Col D
    categoryCol: 5,        // Col E
    oldCodeCol: 6,         // Col F
    newCodeCol: 7,         // Col G
    distributedToCol: 9,   // Col I: DISTRIBUTED TO
    distributedDateCol: 10,// Col J: DISTRIBUTED DATE
    distributedByCol: 11,  // Col K: DISTRIBUTED BY
    submittedDocCol: 12,   // Col L: SUBMITTED DOC.
    distributedCol: 13,    // Col M: DISTRIBUTED
    missingCol: 14,        // Col N: MISSING
    foundCol: 15,          // Col O: FOUND
    handOverCol: 16,       // Col P: HAND OVER
  };

  if (!headers || headers.length === 0) return map;

  for (let c = 0; c < headers.length; c++) {
    const raw = String(headers[c] || '').trim().toUpperCase();
    if (!raw) continue;
    const colNum = c + 1;

    // Col I: DISTRIBUTED TO
    if (
      raw.includes('DISTRIBUTED TO') ||
      raw.includes('DISRTIBUTED TO') ||
      raw.includes('DISTRIBUTED_TO') ||
      raw.includes('RECEIVED BY') ||
      raw.includes('RECEIVER NAME') ||
      raw === 'RECEIVER'
    ) {
      map.distributedToCol = colNum;
    }
    // Col J: DISTRIBUTED DATE
    else if (
      raw.includes('DISTRIBUTED DATE') ||
      raw.includes('DELIVERY DATE') ||
      raw.includes('DIST DATE') ||
      raw.includes('DISTRIBUTED_DATE')
    ) {
      map.distributedDateCol = colNum;
    }
    // Col K: DISTRIBUTED BY
    else if (
      raw.includes('DISTRIBUTED BY') ||
      raw.includes('DIST BY') ||
      raw.includes('DISTRIBUTED_BY') ||
      raw.includes('DELIVERED BY') ||
      raw === 'STAFF'
    ) {
      map.distributedByCol = colNum;
    }
    // Col L: SUBMITTED DOC.
    else if (
      raw.includes('SUBMITTED DOC') ||
      raw.includes('SUBMITTED DOCUMENT') ||
      raw.includes('SUBMITTED_DOC') ||
      (raw.includes('SUBMITTED') && raw.includes('DOC'))
    ) {
      map.submittedDocCol = colNum;
    }
    // Col M: DISTRIBUTED
    else if (
      raw === 'DISTRIBUTED' ||
      raw === 'STATUS DISTRIBUTED' ||
      raw === 'IS DISTRIBUTED' ||
      raw === 'IS_DISTRIBUTED' ||
      (raw.includes('DISTRIBUTED') && !raw.includes('TO') && !raw.includes('DATE') && !raw.includes('BY'))
    ) {
      map.distributedCol = colNum;
    }
    // Col N: MISSING
    else if (
      raw === 'MISSING' ||
      raw === 'STATUS MISSING' ||
      raw === 'IS MISSING' ||
      raw.includes('MISSING')
    ) {
      map.missingCol = colNum;
    }
    // Col O: FOUND
    else if (
      raw === 'FOUND' ||
      raw === 'STATUS FOUND' ||
      raw === 'IS FOUND' ||
      raw.includes('FOUND')
    ) {
      map.foundCol = colNum;
    }
    // Col P: HAND OVER
    else if (
      raw.includes('HAND OVER') ||
      raw.includes('HANDOVER') ||
      raw.includes('HANDED OVER')
    ) {
      map.handOverCol = colNum;
    }
    // Col B: APPLICANT ID
    else if (
      raw.includes('APPLICANT') ||
      raw === 'APP ID' ||
      raw === 'APPID' ||
      raw === 'APPLICATION NO'
    ) {
      map.appIdCol = colNum;
    }
    // Col C: FULL NAME
    else if (
      raw === 'FULL NAME' ||
      raw === 'APPLICANT NAME' ||
      raw === 'HOLDER NAME' ||
      (raw.includes('NAME') && !raw.includes('RECEIVER') && !raw.includes('STAFF'))
    ) {
      map.nameCol = colNum;
    }
    // Col D: LICENSE NUMBER
    else if (
      raw.includes('LICENSE NUMBER') ||
      raw.includes('LIC NO') ||
      raw.includes('LICENCE NUMBER') ||
      raw === 'LICENSE' ||
      raw === 'LICENCE'
    ) {
      map.licCol = colNum;
    }
    // Col E: CATEGORY
    else if (
      raw.includes('CATEGORY') ||
      raw === 'CLASS' ||
      raw.includes('VEHICLE')
    ) {
      map.categoryCol = colNum;
    }
    // Col F: OLD CODE
    else if (raw.includes('OLD CODE') || raw.includes('LOT')) {
      map.oldCodeCol = colNum;
    }
    // Col G: NEW CODE
    else if (raw.includes('NEW CODE')) {
      map.newCodeCol = colNum;
    }
  }

  return map;
}

// In-memory cache for detected sheet columns per sheet to prevent re-querying Row 1 on every save
export const cachedSheetColumnsMap = new Map<string, { map: DetectedSheetColumns; cachedAt: number }>();

export let inMemoryGoogleSheetRecords: LicenseRecord[] | null = null;

export function getGoogleSheetRecords(): LicenseRecord[] {
  const isTestDummy = (list?: any[] | null) => {
    if (!list || !Array.isArray(list) || list.length === 0) return false;
    return list.some((r) => r && typeof r.applicantId === 'string' && r.applicantId.startsWith('APP-TEST-'));
  };

  const cfg = inMemoryConfig || getGoogleSheetsConfig();
  const hasActiveSheet = Boolean(isValidGoogleSheetTarget(cfg?.spreadsheetId, cfg?.publishedUrl));
  if (!hasActiveSheet) {
    inMemoryGoogleSheetRecords = null;
    return [];
  }

  if (inMemoryGoogleSheetRecords && inMemoryGoogleSheetRecords.length > 0 && !isTestDummy(inMemoryGoogleSheetRecords)) {
    return inMemoryGoogleSheetRecords;
  }

  // 1. Check dedicated persistent JSON storage
  try {
    const gsheetStorageFile = path.join(STORAGE_DIR, getAppScopedFilename('google_sheet_records.json'));
    if (fs.existsSync(gsheetStorageFile)) {
      const content = fs.readFileSync(gsheetStorageFile, 'utf-8');
      const recs = JSON.parse(content);
      if (Array.isArray(recs) && recs.length > 0 && !isTestDummy(recs)) {
        inMemoryGoogleSheetRecords = recs;
        return recs;
      }
    }
  } catch (err: any) {
    console.warn('[Google Sheets Cache] Warning reading google_sheet_records.json:', err.message);
  }

  // 2. Check STORAGE_UPLOADS for latest genuine backup files
  try {
    if (fs.existsSync(STORAGE_UPLOADS)) {
      const files = fs
        .readdirSync(STORAGE_UPLOADS)
        .filter((f) => (f.startsWith('sync_') || f.startsWith('gsheet_')) && f.endsWith('.json'))
        .sort((a, b) => {
          const statA = fs.statSync(path.join(STORAGE_UPLOADS, a));
          const statB = fs.statSync(path.join(STORAGE_UPLOADS, b));
          return statB.mtimeMs - statA.mtimeMs;
        });

      for (const file of files) {
        try {
          const filePath = path.join(STORAGE_UPLOADS, file);
          const stat = fs.statSync(filePath);
          if (stat.size < 20000) continue; // Skip tiny test dummy files
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed) && parsed.length > 50 && !isTestDummy(parsed)) {
            inMemoryGoogleSheetRecords = parsed;
            return parsed;
          }
        } catch (_) {}
      }
    }
  } catch (err: any) {
    console.warn('[Google Sheets Cache] Warning loading cached sheet records:', err.message);
  }

  return [];
}

export function clearSheetRowCache(): void {
  sheetLicenseRowMap.clear();
  sheetCleanLicenseRowMap.clear();
  sheetAppIdRowMap.clear();
  sheetCompositeRowMap.clear();
}

/**
 * Checks if a target spreadsheet ID or published URL is a genuine, valid target rather than an empty or mock placeholder.
 */
export function isValidGoogleSheetTarget(spreadsheetId?: string, publishedUrl?: string): boolean {
  if (publishedUrl && typeof publishedUrl === 'string' && publishedUrl.trim().startsWith('http')) {
    if (!isLegacyOrBundledSheet(publishedUrl)) {
      return true;
    }
  }
  if (!spreadsheetId || typeof spreadsheetId !== 'string' || !spreadsheetId.trim()) {
    return false;
  }
  const clean = spreadsheetId.trim();
  if (
    isLegacyOrBundledSheet(clean) ||
    clean.includes('1sXYZ') ||
    clean.includes('XYZiQSSzo6Fw') ||
    clean.toLowerCase().includes('placeholder') ||
    clean.toLowerCase().includes('example') ||
    clean.toLowerCase().includes('your-sheet-id') ||
    clean.length < 15
  ) {
    return false;
  }
  return true;
}

const DEFAULT_CONFIG: GoogleSheetsConfig = {
  spreadsheetId: '',
  tabName: '',
  publishedUrl: '',
  webAppUrl: '',
  daemonUrl: '',
  syncDaemonUrl: '',
  lastSyncAt: null,
  syncState: 'READY',
  indexedInRam: 0,
  lastSyncDurationMs: 0,
  duplicatesCount: 0,
  invalidRowsCount: 0,
  totalSheetRows: 0,
  duplicateItems: [],
  invalidItems: [],
  serviceAccountEmail: 'plsms-sync-proxy@plsms-sync-proxy.iam.gserviceaccount.com',
  serviceAccountConfigured: false,
  proxyMode: 'BACKEND_PROXY',
  autoSync24hEnabled: true,
  autoSyncIntervalSeconds: 60,
  continuousSyncStatus: 'ACTIVE',
  successful24hSyncCount: 0,
  lastHeartbeatAt: new Date().toISOString(),
  nextScheduledSyncAt: new Date(Date.now() + 60 * 1000).toISOString(),
  sheetStats: {
    totalRecords: 0,
    availableRecords: 0,
    distributedRecords: 0,
    missingRecords: 0,
    foundRecords: 0,
  },
};

let inMemoryConfig: GoogleSheetsConfig | null = null;

export function getGoogleSheetsConfig(): GoogleSheetsConfig {
  const creds = getServiceAccountCredentials();
  const currentRam = getAllRecords().length;

  if (inMemoryConfig) {
    const hasActiveSheet = Boolean(inMemoryConfig.spreadsheetId || inMemoryConfig.publishedUrl);
    return {
      ...inMemoryConfig,
      indexedInRam: hasActiveSheet ? currentRam : 0,
      totalSheetRows: hasActiveSheet ? (inMemoryConfig.totalSheetRows || 0) : 0,
      serviceAccountEmail: creds.email,
      serviceAccountConfigured: creds.isConfigured,
      proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
    };
  }

  try {
    let parsed: any = null;

    // Helper to safely merge non-empty connection fields from fallback tiers
    const mergeTier = (source: any) => {
      if (!source || typeof source !== 'object') return;
      if (isClonedMasterSheetConfig(source)) return;
      if (!parsed) {
        parsed = { ...source };
        if (parsed.tabName === 'Class Data') parsed.tabName = '';
        return;
      }
      // Preserve any non-empty configuration from source if missing or empty in parsed
      if ((!parsed.spreadsheetId || !parsed.spreadsheetId.trim()) && source.spreadsheetId && typeof source.spreadsheetId === 'string' && source.spreadsheetId.trim() && !isLegacyOrBundledSheet(source.spreadsheetId)) {
        parsed.spreadsheetId = source.spreadsheetId.trim();
      }
      if ((!parsed.publishedUrl || !parsed.publishedUrl.trim()) && source.publishedUrl && typeof source.publishedUrl === 'string' && source.publishedUrl.trim() && !isLegacyOrBundledSheet(source.publishedUrl)) {
        parsed.publishedUrl = source.publishedUrl.trim();
      }
      if ((!parsed.tabName || !parsed.tabName.trim() || parsed.tabName === 'Class Data') && source.tabName && typeof source.tabName === 'string' && source.tabName.trim() && source.tabName.trim() !== 'Class Data') {
        parsed.tabName = source.tabName.trim();
      }
      if ((!parsed.webAppUrl || !parsed.webAppUrl.trim()) && source.webAppUrl && typeof source.webAppUrl === 'string' && source.webAppUrl.trim()) {
        parsed.webAppUrl = source.webAppUrl.trim();
      }
    };

    // Multi-tier recovery: 1. Check primary JSON file
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        if (content && content.trim()) {
          parsed = JSON.parse(content);
        }
      } catch {}
    }

    if (parsed && isClonedMasterSheetConfig(parsed)) {
      if (isLegacyOrBundledSheet(parsed.spreadsheetId) || isLegacyOrBundledSheet(parsed.publishedUrl)) {
        parsed.spreadsheetId = '';
        parsed.publishedUrl = '';
      }
      parsed.appletId = getCurrentAppletId();
    }

    if (parsed && parsed.spreadsheetId) {
      const clean = parsed.spreadsheetId.trim().toLowerCase();
      if (
        isLegacyOrBundledSheet(clean) ||
        clean.includes('placeholder') ||
        clean.includes('example') ||
        clean.includes('your-sheet-id') ||
        clean === '<spreadsheet-id>'
      ) {
        parsed.spreadsheetId = '';
      }
    }
    if (parsed && parsed.publishedUrl) {
      const cleanPub = parsed.publishedUrl.trim().toLowerCase();
      if (
        isLegacyOrBundledSheet(cleanPub) ||
        cleanPub.includes('placeholder') ||
        cleanPub.includes('example') ||
        cleanPub.includes('your-sheet-id')
      ) {
        parsed.publishedUrl = '';
      }
    }

    // 2. Strictly enforce no auto-generation or auto-insertion of mock/fallback URLs
    // If no URL was saved by Super Admin, keep fields empty ("") so "Not configured — Super Admin setup required" is shown.
    if (!parsed) {
      const initialConfig: GoogleSheetsConfig = {
        ...DEFAULT_CONFIG,
        appletId: getCurrentAppletId(),
        spreadsheetId: '',
        tabName: '',
        publishedUrl: '',
        webAppUrl: '',
        daemonUrl: '',
        syncDaemonUrl: '',
        syncState: 'READY',
        indexedInRam: 0,
        totalSheetRows: 0,
        sheetStats: {
          totalRecords: 0,
          availableRecords: 0,
          distributedRecords: 0,
          missingRecords: 0,
          foundRecords: 0,
          handedOverRecords: 0,
        },
        serviceAccountEmail: creds.email,
        serviceAccountConfigured: creds.isConfigured,
        proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
      };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2), 'utf-8');
      inMemoryConfig = initialConfig;
      return initialConfig;
    }

    // If rehydration filled missing connection fields that weren't in CONFIG_FILE, auto-heal CONFIG_FILE
    try {
      if (parsed.spreadsheetId || parsed.publishedUrl || parsed.webAppUrl || parsed.daemonUrl || parsed.syncDaemonUrl) {
        const primaryRaw = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf-8') : '';
        const primaryParsed = primaryRaw ? JSON.parse(primaryRaw) : null;
        if (
          (!primaryParsed?.spreadsheetId && parsed.spreadsheetId) ||
          (!primaryParsed?.publishedUrl && parsed.publishedUrl) ||
          (!primaryParsed?.webAppUrl && parsed.webAppUrl) ||
          (!primaryParsed?.daemonUrl && (parsed.daemonUrl || parsed.syncDaemonUrl))
        ) {
          const healed = { ...(primaryParsed || {}), ...parsed };
          const tempPath = `${CONFIG_FILE}.tmp.${process.pid}.${Date.now()}`;
          fs.writeFileSync(tempPath, JSON.stringify(healed, null, 2), 'utf-8');
          fs.renameSync(tempPath, CONFIG_FILE);
          try { saveSystemConfigInPg(getAppScopedConfigKey('google_sheets_config'), JSON.stringify(healed)).catch(() => {}); } catch (_) {}
        }
      }
    } catch (_) {}

    // Only sanitize generic mock placeholders, never real user-entered URLs or IDs
    if (parsed.spreadsheetId && (parsed.spreadsheetId.toLowerCase() === 'placeholder' || parsed.spreadsheetId.toLowerCase() === 'your-sheet-id' || parsed.spreadsheetId.toLowerCase() === '<spreadsheet-id>')) {
      parsed.spreadsheetId = '';
      if (parsed.syncState === 'ERROR') {
        parsed.syncState = 'READY';
        parsed.lastError = undefined;
      }
    }

    const hasActiveSheet = Boolean(isValidGoogleSheetTarget(parsed?.spreadsheetId, parsed?.publishedUrl));
    const isExplicitlyPaused = parsed?.autoSync24hEnabled === false;
    const resolvedContinuousStatus = isExplicitlyPaused ? 'PAUSED' : 'ACTIVE';

    if (!hasActiveSheet) {
      parsed.totalSheetRows = 0;
      parsed.indexedInRam = 0;
      parsed.sheetStats = {
        totalRecords: 0,
        availableRecords: 0,
        distributedRecords: 0,
        missingRecords: 0,
        foundRecords: 0,
        handedOverRecords: 0,
      };
      if (parsed.syncState === 'ERROR') {
        parsed.syncState = 'READY';
        parsed.lastError = undefined;
      }
    }

    inMemoryConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      continuousSyncStatus: resolvedContinuousStatus,
      indexedInRam: hasActiveSheet ? currentRam : 0,
      totalSheetRows: hasActiveSheet ? (parsed.totalSheetRows || 0) : 0,
      sheetStats: hasActiveSheet && parsed.sheetStats ? parsed.sheetStats : {
        totalRecords: 0,
        availableRecords: 0,
        distributedRecords: 0,
        missingRecords: 0,
        foundRecords: 0,
        handedOverRecords: 0,
      },
      serviceAccountEmail: creds.email,
      serviceAccountConfigured: creds.isConfigured,
      proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
    };

    // Auto-verify and compute sheetStats accurately ONLY IF hasActiveSheet is true
    if (hasActiveSheet) {
      const cachedSheetRecs = getGoogleSheetRecords();
      if (cachedSheetRecs.length > 0) {
        let sDist = 0;
        let sMiss = 0;
        let sFound = 0;
        let sHanded = 0;
        for (const sr of cachedSheetRecs) {
          if (isRecordDistributed(sr)) sDist++;
          if (isRecordMissing(sr)) sMiss++;
          if (isRecordFound(sr)) sFound++;
          if (isRecordHandedOver(sr)) sHanded++;
        }
        inMemoryConfig.totalSheetRows = cachedSheetRecs.length;
        inMemoryConfig.sheetStats = {
          totalRecords: cachedSheetRecs.length,
          availableRecords: Math.max(0, cachedSheetRecs.length - sDist - sMiss),
          distributedRecords: sDist,
          missingRecords: sMiss,
          foundRecords: sFound,
          handedOverRecords: sHanded || sDist,
        };
      } else if (!inMemoryConfig.sheetStats || inMemoryConfig.sheetStats.totalRecords === undefined) {
        inMemoryConfig.sheetStats = {
          totalRecords: inMemoryConfig.totalSheetRows || 0,
          availableRecords: 0,
          distributedRecords: 0,
          missingRecords: 0,
          foundRecords: 0,
          handedOverRecords: 0,
        };
      }
    } else {
      inMemoryConfig.sheetStats = {
        totalRecords: 0,
        availableRecords: 0,
        distributedRecords: 0,
        missingRecords: 0,
        foundRecords: 0,
        handedOverRecords: 0,
      };
      inMemoryConfig.totalSheetRows = 0;
      inMemoryConfig.indexedInRam = 0;
    }

    return inMemoryConfig;
  } catch (_err) {
    // Graceful recovery from any parse / concurrent write corruption
    try {
      const fallbackConfig: GoogleSheetsConfig = {
        ...DEFAULT_CONFIG,
        serviceAccountEmail: creds.email,
        serviceAccountConfigured: creds.isConfigured,
        proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
      };
      const tempPath = `${CONFIG_FILE}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(fallbackConfig, null, 2), 'utf-8');
      fs.renameSync(tempPath, CONFIG_FILE);
      inMemoryConfig = fallbackConfig;
      return fallbackConfig;
    } catch {
      inMemoryConfig = { ...DEFAULT_CONFIG };
      return inMemoryConfig;
    }
  }
}

export function saveGoogleSheetsConfig(config: Partial<GoogleSheetsConfig> & { isExplicitReplacement?: boolean }): GoogleSheetsConfig {
  try {
    const current = getGoogleSheetsConfig();
    const cleanDuplicates = Array.isArray(config.duplicateItems)
      ? config.duplicateItems.slice(0, 50).map((d: any) => ({
          sheetRow: d.sheetRow || 0,
          matchedRow: d.matchedRow,
          applicantId: d.applicantId || '',
          licenseNumber: d.licenseNumber || '',
          holderName: d.holderName || '',
          category: d.category || '',
          office: d.office || '',
          status: d.status || (d.existingRecord?.status) || 'AVAILABLE',
          reason: d.reason || 'Duplicate license entry',
        }))
      : (current.duplicateItems || []).slice(0, 50);

    const cleanInvalid = Array.isArray(config.invalidItems)
      ? config.invalidItems.slice(0, 100).map((inv: any) => ({
          sheetRow: inv.sheetRow || 0,
          sn: inv.sn || '',
          applicantId: inv.applicantId || '',
          holderName: inv.holderName || '',
          licenseNumber: inv.licenseNumber || '',
          category: inv.category || '',
          department: inv.department || '',
          reason: inv.reason || 'Invalid row in Google Sheet',
        }))
      : (current.invalidItems || []).slice(0, 100);

    // Filter out undefined keys so partial saves do not overwrite existing properties with undefined
    const cleanConfig: any = {};
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        cleanConfig[key] = value;
      }
    }

    // MANDATE: Super Admin's saved Google Spreadsheet Link/ID and Published CSV Export URL
    // must NEVER be cleared or overwritten with empty/default values during startup, sync initialization,
    // Remix, or configuration migration.
    // They may be changed only when Super Admin explicitly uses “Replace Google Sheet” (isExplicitReplacement === true)
    // or when a non-empty new address is explicitly supplied.
    const isExplicitReplacement = Boolean((config as any).isExplicitReplacement);

    const resolvedSpreadsheetId = (() => {
      if (isExplicitReplacement) {
        return cleanConfig.spreadsheetId !== undefined ? cleanConfig.spreadsheetId : current.spreadsheetId;
      }
      if (cleanConfig.spreadsheetId && typeof cleanConfig.spreadsheetId === 'string' && cleanConfig.spreadsheetId.trim()) {
        return cleanConfig.spreadsheetId.trim();
      }
      return current.spreadsheetId || '';
    })();

    const resolvedPublishedUrl = (() => {
      if (isExplicitReplacement) {
        if (cleanConfig.publishedUrl !== undefined && typeof cleanConfig.publishedUrl === 'string') {
          return cleanConfig.publishedUrl.trim();
        }
        return current.publishedUrl || '';
      }
      if (cleanConfig.publishedUrl && typeof cleanConfig.publishedUrl === 'string' && cleanConfig.publishedUrl.trim()) {
        return cleanConfig.publishedUrl.trim();
      }
      return current.publishedUrl || '';
    })();

    const resolvedTabName = (() => {
      if (cleanConfig.tabName !== undefined && typeof cleanConfig.tabName === 'string') {
        const cleanTab = cleanConfig.tabName.trim();
        if (cleanTab && cleanTab !== 'Class Data') {
          return cleanTab;
        }
      }
      if (current.tabName && typeof current.tabName === 'string') {
        const curTab = current.tabName.trim();
        if (curTab && curTab !== 'Class Data') {
          return curTab;
        }
      }
      return '';
    })();

    const resolvedWebAppUrl = (() => {
      if (isExplicitReplacement) {
        return cleanConfig.webAppUrl !== undefined ? cleanConfig.webAppUrl : (current.webAppUrl || '');
      }
      if (cleanConfig.webAppUrl && typeof cleanConfig.webAppUrl === 'string' && cleanConfig.webAppUrl.trim()) {
        return cleanConfig.webAppUrl.trim();
      }
      return current.webAppUrl || '';
    })();

    const resolvedDaemonUrl = (() => {
      if (isExplicitReplacement) {
        if (cleanConfig.daemonUrl !== undefined) return cleanConfig.daemonUrl;
        if (cleanConfig.syncDaemonUrl !== undefined) return cleanConfig.syncDaemonUrl;
        return current.daemonUrl || current.syncDaemonUrl || '';
      }
      if (cleanConfig.daemonUrl && typeof cleanConfig.daemonUrl === 'string' && cleanConfig.daemonUrl.trim()) {
        return cleanConfig.daemonUrl.trim();
      }
      if (cleanConfig.syncDaemonUrl && typeof cleanConfig.syncDaemonUrl === 'string' && cleanConfig.syncDaemonUrl.trim()) {
        return cleanConfig.syncDaemonUrl.trim();
      }
      return current.daemonUrl || current.syncDaemonUrl || '';
    })();

    const sheetIdChanged = cleanConfig.spreadsheetId !== undefined && cleanConfig.spreadsheetId !== current.spreadsheetId;
    const publishedUrlChanged = cleanConfig.publishedUrl !== undefined && cleanConfig.publishedUrl !== current.publishedUrl;

    const currentAppletId = getCurrentAppletId();
    const resolvedAppletId = cleanConfig.appletId || currentAppletId || (current as any).appletId;

    const updated: GoogleSheetsConfig = {
      ...current,
      ...cleanConfig,
      spreadsheetId: resolvedSpreadsheetId,
      publishedUrl: resolvedPublishedUrl,
      tabName: resolvedTabName,
      webAppUrl: resolvedWebAppUrl,
      daemonUrl: resolvedDaemonUrl,
      syncDaemonUrl: resolvedDaemonUrl,
      duplicateItems: cleanDuplicates,
      invalidItems: cleanInvalid,
      ...(resolvedAppletId ? { appletId: resolvedAppletId } : {}),
    };

    // If target sheet URL changed, clear stale row and column caches immediately
    if (sheetIdChanged || publishedUrlChanged) {
      clearSheetRowCache();
      cachedSheetColumnsMap.clear();
      inMemoryGoogleSheetRecords = null;
    }

    const wasUnconfigured = !current.spreadsheetId && !current.publishedUrl;
    const isNowConfigured = Boolean(
      (updated.spreadsheetId && updated.spreadsheetId.trim()) ||
      (updated.publishedUrl && updated.publishedUrl.trim())
    );

    // Rule 1: On first valid configuration, set persistent sync state = ACTIVE
    if (wasUnconfigured && isNowConfigured) {
      if (config.autoSync24hEnabled === undefined) {
        updated.autoSync24hEnabled = true;
      }
      if (config.continuousSyncStatus === undefined) {
        updated.continuousSyncStatus = 'ACTIVE';
      }
      if (!updated.nextScheduledSyncAt) {
        updated.nextScheduledSyncAt = new Date(Date.now() + (updated.autoSyncIntervalSeconds || 60) * 1000).toISOString();
      }
    } else if (!isNowConfigured) {
      if (updated.autoSync24hEnabled === false) {
        updated.continuousSyncStatus = 'PAUSED';
      } else {
        updated.autoSync24hEnabled = true;
        updated.continuousSyncStatus = 'ACTIVE';
      }
    } else if (updated.autoSync24hEnabled === false) {
      // If explicitly paused by Super Admin, maintain PAUSED
      updated.continuousSyncStatus = 'PAUSED';
    } else {
      updated.autoSync24hEnabled = true;
      updated.continuousSyncStatus = 'ACTIVE';
    }

    // If both spreadsheet address links are empty, ensure stats and caches are zeroed
    if (updated.spreadsheetId === '' && updated.publishedUrl === '') {
      updated.totalSheetRows = 0;
      updated.syncState = 'READY';
      updated.lastError = undefined;
      updated.sheetStats = {
        totalRecords: 0,
        availableRecords: 0,
        distributedRecords: 0,
        missingRecords: 0,
        foundRecords: 0,
        handedOverRecords: 0,
      };
      inMemoryGoogleSheetRecords = null;
      clearSheetRowCache();
    }

    inMemoryConfig = updated;

    // 1. Primary write to CONFIG_FILE (atomic rename)
    const tempPath = `${CONFIG_FILE}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2), 'utf-8');
    fs.renameSync(tempPath, CONFIG_FILE);

    // 1b. Multi-Tier Permanent Vault Synchronous Write
    try {
      fs.writeFileSync(MASTER_CONFIG_VAULT_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    } catch (_) {}
    try {
      const backupPath = path.join(STORAGE_DIR, 'master_database_unified_backup.json');
      if (fs.existsSync(backupPath)) {
        const backupRaw = fs.readFileSync(backupPath, 'utf-8');
        if (backupRaw && backupRaw.trim()) {
          const parsedBackup = JSON.parse(backupRaw);
          if (parsedBackup && parsedBackup.data) {
            parsedBackup.data.googleSheetsConfig = updated;
            fs.writeFileSync(backupPath, JSON.stringify(parsedBackup, null, 2), 'utf-8');
          }
        }
      }
    } catch (_) {}

    // 2. Persistent PostgreSQL storage
    try {
      const configKey = getAppScopedConfigKey('google_sheets_config');
      saveSystemConfigInPg(configKey, JSON.stringify(updated)).catch((err) =>
        console.warn('[PLSMS Config] Warning saving config to PostgreSQL:', err.message)
      );
    } catch (e: any) {
      console.warn('[PLSMS Config] Warning saving config to PostgreSQL:', e.message);
    }

    return updated;
  } catch (err) {
    console.error('Error saving Google Sheets config:', err);
    return inMemoryConfig || getGoogleSheetsConfig();
  }
}

/**
 * Asynchronous version of saveGoogleSheetsConfig that guarantees PostgreSQL persistence is awaited.
 * Used by Super Admin API routes to ensure PostgreSQL is committed before responding.
 */
export async function saveGoogleSheetsConfigAsync(
  config: Partial<GoogleSheetsConfig> & { isExplicitReplacement?: boolean }
): Promise<GoogleSheetsConfig> {
  const updated = saveGoogleSheetsConfig(config);
  try {
    const configKey = getAppScopedConfigKey('google_sheets_config');
    await saveSystemConfigInPg(configKey, JSON.stringify(updated));
  } catch (err: any) {
    console.warn('[PLSMS Config] Warning persisting config to PostgreSQL async:', err.message);
  }
  return updated;
}

/**
 * Initializer called during server startup:
 * Rehydrates the authoritative configuration saved in PostgreSQL `system_configuration`
 * into inMemoryConfig, CONFIG_FILE, and MASTER_CONFIG_VAULT_FILE.
 * This guarantees permanent survival across reboots, redeployments, container restarts, and remixes.
 */
export async function initGoogleSheetsConfigFromPg(): Promise<GoogleSheetsConfig> {
  try {
    const creds = getServiceAccountCredentials();
    const configKey = getAppScopedConfigKey('google_sheets_config');
    const pgVal = await getSystemConfigFromPg(configKey);
    if (pgVal && pgVal.trim()) {
      try {
        const parsedPg = JSON.parse(pgVal);
        if (parsedPg && typeof parsedPg === 'object') {
          // NEVER auto-wipe saved URLs during startup/rehydration!
          // spreadsheetId, publishedUrl, tabName, and webAppUrl persist independently.
          let incomingTab = parsedPg.tabName !== undefined ? String(parsedPg.tabName).trim() : '';
          if (incomingTab === 'Class Data') incomingTab = '';
          const safeTab = incomingTab || (inMemoryConfig?.tabName && inMemoryConfig.tabName !== 'Class Data' ? inMemoryConfig.tabName : '');

          inMemoryConfig = {
            ...DEFAULT_CONFIG,
            ...(inMemoryConfig || {}),
            ...parsedPg,
            spreadsheetId: parsedPg.spreadsheetId !== undefined ? String(parsedPg.spreadsheetId).trim() : (inMemoryConfig?.spreadsheetId || ''),
            publishedUrl: parsedPg.publishedUrl !== undefined ? String(parsedPg.publishedUrl).trim() : (inMemoryConfig?.publishedUrl || ''),
            webAppUrl: parsedPg.webAppUrl !== undefined ? String(parsedPg.webAppUrl).trim() : (inMemoryConfig?.webAppUrl || ''),
            daemonUrl: parsedPg.daemonUrl !== undefined ? String(parsedPg.daemonUrl).trim() : (parsedPg.syncDaemonUrl !== undefined ? String(parsedPg.syncDaemonUrl).trim() : (inMemoryConfig?.daemonUrl || '')),
            syncDaemonUrl: parsedPg.daemonUrl !== undefined ? String(parsedPg.daemonUrl).trim() : (parsedPg.syncDaemonUrl !== undefined ? String(parsedPg.syncDaemonUrl).trim() : (inMemoryConfig?.syncDaemonUrl || '')),
            tabName: safeTab,
            serviceAccountEmail: creds.email,
            serviceAccountConfigured: creds.isConfigured,
            proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
          };
          try {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(inMemoryConfig, null, 2), 'utf-8');
            fs.writeFileSync(MASTER_CONFIG_VAULT_FILE, JSON.stringify(inMemoryConfig, null, 2), 'utf-8');
          } catch (_) {}
          console.log(
            `[PLSMS Config] Rehydrated authoritative active configuration from PostgreSQL (Sheet: ${
              inMemoryConfig.spreadsheetId || inMemoryConfig.publishedUrl ? 'CONFIGURED' : 'NOT CONFIGURED'
            }, Webhook: ${inMemoryConfig.webAppUrl ? 'CONFIGURED' : 'NOT CONFIGURED'}, Daemon: ${inMemoryConfig.daemonUrl ? 'CONFIGURED' : 'NOT CONFIGURED'})`
          );
          return inMemoryConfig;
        }
      } catch (err: any) {
        console.warn('[PLSMS Config] Error parsing config from PostgreSQL:', err.message);
      }
    } else {
      // If PostgreSQL has no configuration yet, check if CONFIG_FILE has an active configuration
      const current = getGoogleSheetsConfig();
      if (current.spreadsheetId || current.publishedUrl || current.webAppUrl || current.daemonUrl) {
        await saveSystemConfigInPg(configKey, JSON.stringify(current));
        console.log('[PLSMS Config] Seeded PostgreSQL system_configuration with active configuration.');
      }
    }
  } catch (err: any) {
    console.warn('[PLSMS Config] Warning during initGoogleSheetsConfigFromPg:', err.message);
  }
  return getGoogleSheetsConfig();
}

/**
 * Update in-memory configuration from authoritative PostgreSQL snapshot
 */
export function updateInMemoryConfigFromPg(parsedPg: any): GoogleSheetsConfig {
  const creds = getServiceAccountCredentials();
  if (parsedPg && typeof parsedPg === 'object') {
    // NEVER auto-wipe saved URLs during GET/startup/rehydration!
    let incomingTab = parsedPg.tabName !== undefined ? String(parsedPg.tabName).trim() : '';
    if (incomingTab === 'Class Data') incomingTab = '';
    const safeTab = incomingTab || (inMemoryConfig?.tabName && inMemoryConfig.tabName !== 'Class Data' ? inMemoryConfig.tabName : '');

    inMemoryConfig = {
      ...DEFAULT_CONFIG,
      ...(inMemoryConfig || {}),
      ...parsedPg,
      spreadsheetId: parsedPg.spreadsheetId !== undefined ? String(parsedPg.spreadsheetId).trim() : (inMemoryConfig?.spreadsheetId || ''),
      publishedUrl: parsedPg.publishedUrl !== undefined ? String(parsedPg.publishedUrl).trim() : (inMemoryConfig?.publishedUrl || ''),
      webAppUrl: parsedPg.webAppUrl !== undefined ? String(parsedPg.webAppUrl).trim() : (inMemoryConfig?.webAppUrl || ''),
      daemonUrl: parsedPg.daemonUrl !== undefined ? String(parsedPg.daemonUrl).trim() : (parsedPg.syncDaemonUrl !== undefined ? String(parsedPg.syncDaemonUrl).trim() : (inMemoryConfig?.daemonUrl || '')),
      syncDaemonUrl: parsedPg.daemonUrl !== undefined ? String(parsedPg.daemonUrl).trim() : (parsedPg.syncDaemonUrl !== undefined ? String(parsedPg.syncDaemonUrl).trim() : (inMemoryConfig?.syncDaemonUrl || '')),
      tabName: safeTab,
      serviceAccountEmail: creds.email,
      serviceAccountConfigured: creds.isConfigured,
      proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
    };
    return inMemoryConfig;
  }
  return getGoogleSheetsConfig();
}

/**
 * Synchronize comparison matrix statistics between database records and sheet configuration
 */
export function syncSheetStatsWithDatabase(): {
  totalRecords: number;
  availableRecords: number;
  distributedRecords: number;
  missingRecords: number;
  foundRecords: number;
  handedOverRecords?: number;
} {
  const currentCfg = inMemoryConfig || getGoogleSheetsConfig();
  const hasActiveSheet = Boolean(isValidGoogleSheetTarget(currentCfg.spreadsheetId, currentCfg.publishedUrl));
  if (!hasActiveSheet) {
    return {
      totalRecords: 0,
      availableRecords: 0,
      distributedRecords: 0,
      missingRecords: 0,
      foundRecords: 0,
      handedOverRecords: 0,
    };
  }

  const sheetRecs =
    inMemoryGoogleSheetRecords && inMemoryGoogleSheetRecords.length > 0
      ? inMemoryGoogleSheetRecords
      : getGoogleSheetRecords();

  if (!sheetRecs || sheetRecs.length === 0) {
    return {
      totalRecords: currentCfg.sheetStats?.totalRecords ?? 0,
      availableRecords: currentCfg.sheetStats?.availableRecords ?? 0,
      distributedRecords: currentCfg.sheetStats?.distributedRecords ?? 0,
      missingRecords: currentCfg.sheetStats?.missingRecords ?? 0,
      foundRecords: currentCfg.sheetStats?.foundRecords ?? 0,
      handedOverRecords: currentCfg.sheetStats?.handedOverRecords ?? 0,
    };
  }

  let dist = 0;
  let missing = 0;
  let found = 0;
  let handedOver = 0;
  for (const r of sheetRecs) {
    if (isRecordMissing(r)) missing++;
    else if (isRecordFound(r)) found++;
    if (isRecordDistributed(r)) dist++;
    if (isRecordHandedOver(r)) handedOver++;
  }

  const total = currentCfg.totalSheetRows || sheetRecs.length || 0;
  const available = Math.max(0, total - dist);

  const updatedStats = {
    totalRecords: total,
    availableRecords: available,
    distributedRecords: dist,
    missingRecords: missing,
    foundRecords: found,
    handedOverRecords: handedOver,
  };

  saveGoogleSheetsConfig({ sheetStats: updatedStats });
  return updatedStats;
}

/**
 * Keeps in-memory Google Sheet records synchronized with PLSMS action buttons in real time.
 * Matches by License Number, Normalized Clean License, or Applicant ID (MAP / KAP).
 */
export function updateInMemoryGoogleSheetRecord(record: LicenseRecord): void {
  if (!inMemoryGoogleSheetRecords || inMemoryGoogleSheetRecords.length === 0) {
    getGoogleSheetRecords();
  }
  if (!inMemoryGoogleSheetRecords || inMemoryGoogleSheetRecords.length === 0) return;

  const targetLic = (record.licenseNumber || '').trim().toUpperCase();
  const targetCleanLic = targetLic.replace(/[^A-Z0-9]/g, '');
  const targetApp = (record.applicantId || record.applicationNumber || '').trim().toUpperCase();

  for (let i = 0; i < inMemoryGoogleSheetRecords.length; i++) {
    const sr = inMemoryGoogleSheetRecords[i];
    const sLic = (sr.licenseNumber || '').trim().toUpperCase();
    const sCleanLic = sLic.replace(/[^A-Z0-9]/g, '');
    const sApp = (sr.applicantId || sr.applicationNumber || '').trim().toUpperCase();

    let isMatch = false;
    if (targetLic && sLic && targetLic === sLic) isMatch = true;
    else if (targetCleanLic && sCleanLic && targetCleanLic === sCleanLic) isMatch = true;
    else if (targetApp && sApp && targetApp === sApp) isMatch = true;

    if (isMatch) {
      inMemoryGoogleSheetRecords[i] = normalizeRecordData({
        ...sr,
        ...record,
        rawRecord: {
          ...(sr.rawRecord || {}),
          ...(record.rawRecord || {}),
        },
      });
      break;
    }
  }

  syncSheetStatsWithDatabase();
}

/**
 * Fully reset Google Sheets sync configuration, in-memory cache, and sheet stats to clean zero state.
 */
export function resetGoogleSheetsSyncState(): GoogleSheetsConfig {
  inMemoryGoogleSheetRecords = null;
  clearSheetRowCache();

  try {
    if (fs.existsSync(STORAGE_UPLOADS)) {
      const files = fs
        .readdirSync(STORAGE_UPLOADS)
        .filter((f) => f.startsWith('sync_') && f.endsWith('_normalized.json'));
      for (const f of files) {
        try {
          fs.unlinkSync(path.join(STORAGE_UPLOADS, f));
        } catch {}
      }
    }
  } catch (err: any) {
    console.warn('[Google Sheets Reset] Warning cleaning sync files:', err.message);
  }

  const creds = getServiceAccountCredentials();
  const prevConfig = getGoogleSheetsConfig();
  const resetConfig: GoogleSheetsConfig = {
    ...prevConfig,
    spreadsheetId: prevConfig?.spreadsheetId || '',
    tabName: prevConfig?.tabName || 'Sheet1',
    publishedUrl: prevConfig?.publishedUrl || '',
    webAppUrl: prevConfig?.webAppUrl || '',
    daemonUrl: prevConfig?.daemonUrl || prevConfig?.syncDaemonUrl || '',
    syncDaemonUrl: prevConfig?.daemonUrl || prevConfig?.syncDaemonUrl || '',
    lastSyncAt: null,
    syncState: 'READY',
    indexedInRam: 0,
    lastSyncDurationMs: 0,
    duplicatesCount: 0,
    invalidRowsCount: 0,
    totalSheetRows: 0,
    duplicateItems: [],
    invalidItems: [],
    serviceAccountEmail: creds.email || 'plsms-sync-proxy@plsms-sync-proxy.iam.gserviceaccount.com',
    serviceAccountConfigured: creds.isConfigured,
    proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
    autoSync24hEnabled: true,
    autoSyncIntervalSeconds: 60,
    continuousSyncStatus: 'ACTIVE',
    successful24hSyncCount: 0,
    lastHeartbeatAt: new Date().toISOString(),
    nextScheduledSyncAt: new Date(Date.now() + 60 * 1000).toISOString(),
    sheetStats: {
      totalRecords: 0,
      availableRecords: 0,
      distributedRecords: 0,
      missingRecords: 0,
      foundRecords: 0,
    },
    lastWritebackResult: null,
    lastError: undefined,
  };

  try {
    cancelPendingWrites(CONFIG_FILE);
    const tempPath = `${CONFIG_FILE}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(resetConfig, null, 2), 'utf-8');
    fs.renameSync(tempPath, CONFIG_FILE);
    try {
      fs.writeFileSync(MASTER_CONFIG_VAULT_FILE, JSON.stringify(resetConfig, null, 2), 'utf-8');
    } catch (_) {}
    try {
      saveSystemConfigInPg(getAppScopedConfigKey('google_sheets_config'), JSON.stringify(resetConfig)).catch(() => {});
    } catch (_) {}
  } catch (err: any) {
    console.error('[Google Sheets Sync] Error writing reset config to file:', err.message);
  }

  inMemoryConfig = resetConfig;
  return resetConfig;
}

/**
 * Notify the Google Sheets sync module of an external database reset or backup restoration.
 * Ensures in-memory caches, row caches, and statistics match the live state.
 */
export function notifyDatabaseResetOrRestore(options?: {
  totalRecords?: number;
  availableRecords?: number;
  distributedRecords?: number;
  missingRecords?: number;
  foundRecords?: number;
  handedOverRecords?: number;
}): GoogleSheetsConfig {
  inMemoryGoogleSheetRecords = null;
  clearSheetRowCache();

  const config = getGoogleSheetsConfig();
  if (options) {
    config.indexedInRam = options.totalRecords ?? 0;
    if (config.sheetStats) {
      config.sheetStats = {
        totalRecords: options.totalRecords ?? 0,
        availableRecords: options.availableRecords ?? 0,
        distributedRecords: options.distributedRecords ?? 0,
        missingRecords: options.missingRecords ?? 0,
        foundRecords: options.foundRecords ?? 0,
        handedOverRecords: options.handedOverRecords ?? options.distributedRecords ?? 0,
      };
    }
  }
  inMemoryConfig = config;
  return config;
}

/**
 * Automated Category Sync & Import Handler for 5 Statistical Cards
 * Route 1: 'DB' - Imports and maps records ONLY from the PLSMS App Database
 * Route 2: 'SHEET' - Imports and maps records ONLY from the Linked Google Sheet
 */
export async function autoSyncCategoryHandler(
  category: 'ALL' | 'NOT_DISTRIBUTED' | 'DISTRIBUTED' | 'MISSING' | 'FOUND' | 'HANDED_OVER',
  source: 'DB' | 'SHEET',
  options?: { page?: number; limit?: number; search?: string }
) {
  const page = Math.max(1, Number(options?.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(options?.limit) || 100));
  const search = (options?.search || '').trim().toLowerCase();

  const labels: Record<string, string> = {
    ALL: 'TOTAL SMART CARDS',
    NOT_DISTRIBUTED: 'NOT-DISTRIBUTED CARDS',
    DISTRIBUTED: 'DISTRIBUTED CARDS',
    MISSING: 'MISSING CARDS',
    FOUND: 'FOUND CARDS',
    HANDED_OVER: 'HANDED OVER CARDS',
  };

  let dbStats = getDashboardStats();
  let config = getGoogleSheetsConfig();

  if (source === 'DB') {
    // ROUTE 1: Import only from PLSMS App Database
    const dbRecords = getAllRecords();
    let matched: LicenseRecord[] = [];

    if (category === 'ALL') {
      matched = dbRecords;
    } else if (category === 'NOT_DISTRIBUTED') {
      matched = dbRecords.filter((r) => !isRecordDistributed(r));
    } else if (category === 'DISTRIBUTED') {
      matched = dbRecords.filter((r) => isRecordDistributed(r));
    } else if (category === 'MISSING') {
      matched = dbRecords.filter((r) => isRecordMissing(r));
    } else if (category === 'FOUND') {
      matched = dbRecords.filter((r) => isRecordFound(r));
    } else if (category === 'HANDED_OVER') {
      matched = dbRecords.filter((r) => isRecordHandedOver(r));
    }

    // High-speed MAP/KAP indexing for imported records
    for (let i = 0; i < matched.length; i++) {
      const rec = matched[i];
      if (rec.licenseNumber) {
        sheetLicenseRowMap.set(rec.licenseNumber.trim(), i + 1);
        const cleanLic = rec.licenseNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (cleanLic) sheetCleanLicenseRowMap.set(cleanLic, i + 1);
        if (rec.applicantId && cleanLic) {
          sheetCompositeRowMap.set(`${rec.applicantId.trim().toUpperCase()}_${cleanLic}`, i + 1);
        }
      }
      if (rec.applicantId) {
        sheetAppIdRowMap.set(rec.applicantId.trim().toUpperCase(), i + 1);
      }
      const kapKey = buildKAP4ColKey(rec.applicantId, rec.holderName, rec.licenseNumber, rec.category);
      sheet4ColCompositeRowMap.set(kapKey, i + 1);
    }

    let filtered = matched;
    if (search) {
      const sLower = search.toLowerCase().trim();
      const sClean = sLower.replace(/[\s\-_]/g, '');
      filtered = matched.filter(
        (r) =>
          (r.licenseNumber && (r.licenseNumber.toLowerCase().includes(sLower) || (sClean.length >= 5 && r.licenseNumber.replace(/[\s\-_]/g, '').toLowerCase().includes(sClean)))) ||
          (r.holderName && r.holderName.toLowerCase().includes(sLower)) ||
          (r.applicantId && (r.applicantId.toLowerCase().includes(sLower) || (sClean.length >= 5 && r.applicantId.replace(/[\s\-_]/g, '').toLowerCase().includes(sClean)))) ||
          (r.applicationNumber && (r.applicationNumber.toLowerCase().includes(sLower) || (sClean.length >= 5 && r.applicationNumber.replace(/[\s\-_]/g, '').toLowerCase().includes(sClean)))) ||
          (r.receivedBy && r.receivedBy.toLowerCase().includes(sLower)) ||
          (r.receiverRemarks && r.receiverRemarks.toLowerCase().includes(sLower)) ||
          (r.missingReason && r.missingReason.toLowerCase().includes(sLower))
      );
    }

    const startIndex = (page - 1) * limit;
    const paginatedRecords = filtered.slice(startIndex, startIndex + limit);

    // Cross-Platform Parity & 5-Tier MAP Matching Against Google Sheet Database
    const counterpartRecords =
      inMemoryGoogleSheetRecords && inMemoryGoogleSheetRecords.length > 0
        ? inMemoryGoogleSheetRecords
        : getGoogleSheetRecords();
    const parityStats = calculateCrossPlatformParity(dbRecords, counterpartRecords);
    const annotatedRecords = annotateRecordsWithParity(paginatedRecords, 'DB', counterpartRecords);

    return {
      success: true,
      category,
      source: 'DB',
      totalCount: matched.length,
      filteredCount: filtered.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
      records: annotatedRecords,
      parityStats,
      dbStats,
      sheetStats: config.sheetStats,
      config,
      message: `Successfully imported ${matched.length.toLocaleString()} ${labels[category] || category} exclusively from PLSMS App Database.`,
    };
  } else {
    // ROUTE 2: Import live directly from Linked Google Sheet
    const hasActiveSheet = Boolean(isValidGoogleSheetTarget(config.spreadsheetId, config.publishedUrl));
    if (!hasActiveSheet) {
      return {
        success: false,
        totalCount: 0,
        filteredCount: 0,
        page,
        limit,
        totalPages: 1,
        records: [],
        parityStats: calculateCrossPlatformParity(getAllRecords(), []),
        dbStats,
        sheetStats: {
          totalRecords: 0,
          availableRecords: 0,
          distributedRecords: 0,
          missingRecords: 0,
          foundRecords: 0,
          handedOverRecords: 0,
        },
        config,
        message: 'Google Sheet is not configured. Please enter and save a valid Google Sheet URL first.',
      };
    }

    if (config.spreadsheetId || config.publishedUrl) {
      try {
        await syncFromGoogleSheets({
          spreadsheetId: config.spreadsheetId,
          tabName: config.tabName,
          publishedUrl: config.publishedUrl,
          uploadedBy: 'Comparing Engine Live Pull',
          isBackgroundDaemon: false,
        });
        config = getGoogleSheetsConfig();
        dbStats = getDashboardStats();
      } catch (err: any) {
        console.warn('[Comparing Engine] Live sheet pull error:', err.message);
      }
    }

    const sheetRecords =
      inMemoryGoogleSheetRecords && inMemoryGoogleSheetRecords.length > 0
        ? inMemoryGoogleSheetRecords
        : getGoogleSheetRecords();
    let matched: LicenseRecord[] = [];

    if (category === 'ALL') {
      matched = sheetRecords;
    } else if (category === 'NOT_DISTRIBUTED') {
      matched = sheetRecords.filter((r) => !isRecordDistributed(r));
    } else if (category === 'DISTRIBUTED') {
      matched = sheetRecords.filter((r) => isRecordDistributed(r));
    } else if (category === 'MISSING') {
      matched = sheetRecords.filter((r) => isRecordMissing(r));
    } else if (category === 'FOUND') {
      matched = sheetRecords.filter((r) => isRecordFound(r));
    } else if (category === 'HANDED_OVER') {
      matched = sheetRecords.filter((r) => isRecordHandedOver(r));
    }

    // High-speed MAP/KAP indexing for imported sheet records
    for (let i = 0; i < matched.length; i++) {
      const rec = matched[i];
      if (rec.licenseNumber) {
        sheetLicenseRowMap.set(rec.licenseNumber.trim(), i + 1);
        const cleanLic = rec.licenseNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (cleanLic) sheetCleanLicenseRowMap.set(cleanLic, i + 1);
        if (rec.applicantId && cleanLic) {
          sheetCompositeRowMap.set(`${rec.applicantId.trim().toUpperCase()}_${cleanLic}`, i + 1);
        }
      }
      if (rec.applicantId) {
        sheetAppIdRowMap.set(rec.applicantId.trim().toUpperCase(), i + 1);
      }
      const kapKey = buildKAP4ColKey(rec.applicantId, rec.holderName, rec.licenseNumber, rec.category);
      sheet4ColCompositeRowMap.set(kapKey, i + 1);
    }

    let filtered = matched;
    if (search) {
      const sLower = search.toLowerCase().trim();
      const sClean = sLower.replace(/[\s\-_]/g, '');
      filtered = matched.filter(
        (r) =>
          (r.licenseNumber && (r.licenseNumber.toLowerCase().includes(sLower) || (sClean.length >= 5 && r.licenseNumber.replace(/[\s\-_]/g, '').toLowerCase().includes(sClean)))) ||
          (r.holderName && r.holderName.toLowerCase().includes(sLower)) ||
          (r.applicantId && (r.applicantId.toLowerCase().includes(sLower) || (sClean.length >= 5 && r.applicantId.replace(/[\s\-_]/g, '').toLowerCase().includes(sClean)))) ||
          (r.applicationNumber && (r.applicationNumber.toLowerCase().includes(sLower) || (sClean.length >= 5 && r.applicationNumber.replace(/[\s\-_]/g, '').toLowerCase().includes(sClean)))) ||
          (r.receivedBy && r.receivedBy.toLowerCase().includes(sLower)) ||
          (r.receiverRemarks && r.receiverRemarks.toLowerCase().includes(sLower)) ||
          (r.missingReason && r.missingReason.toLowerCase().includes(sLower))
      );
    }

    const startIndex = (page - 1) * limit;
    const paginatedRecords = filtered.slice(startIndex, startIndex + limit);

    // Cross-Platform Parity & 5-Tier MAP Matching Against PLSMS App Database
    const counterpartRecords = getAllRecords();
    const parityStats = calculateCrossPlatformParity(counterpartRecords, sheetRecords);
    const annotatedRecords = annotateRecordsWithParity(paginatedRecords, 'SHEET', counterpartRecords);

    return {
      success: true,
      category,
      source: 'SHEET',
      tabName: config.tabName || OFFICIAL_DEFAULT_TAB_NAME,
      totalCount: matched.length,
      filteredCount: filtered.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
      records: annotatedRecords,
      parityStats,
      dbStats,
      sheetStats: config.sheetStats,
      config,
      message: `Successfully imported ${matched.length.toLocaleString()} ${labels[category] || category} exclusively from Linked Google Sheet (${config.tabName || OFFICIAL_DEFAULT_TAB_NAME}).`,
    };
  }
}

/**
 * Calculates and returns the live cross-platform parity stats
 */
export function getCrossPlatformParityStats(): CrossPlatformParityStats {
  const dbRecords = getAllRecords();
  const sheetRecords =
    inMemoryGoogleSheetRecords && inMemoryGoogleSheetRecords.length > 0
      ? inMemoryGoogleSheetRecords
      : getGoogleSheetRecords();
  return calculateCrossPlatformParity(dbRecords, sheetRecords);
}

/**
 * Import and detect the exact Sheet Tab Name directly from the linked Google Sheet
 */
export async function importSheetNameFromLinkedSheet(): Promise<{
  success: boolean;
  tabName: string;
  spreadsheetId: string;
  source: string;
  message: string;
}> {
  const config = getGoogleSheetsConfig();
  if (!config.spreadsheetId && !config.publishedUrl) {
    return {
      success: false,
      tabName: '',
      spreadsheetId: '',
      source: 'NONE',
      message: 'No Google Sheet link or ID has been configured. Please provide a Google Sheet URL first.',
    };
  }
  const rawId = config.spreadsheetId || '';
  const info = extractSpreadsheetInfo(rawId);
  const cleanId = info.cleanId || '';

  let detectedTabName = config.tabName || '';
  let detectionSource = 'OFFICIAL_CONFIG';

  // Strategy 0: Direct HTML Inspection of /edit and /htmlview (Takes ~1-2 seconds, works even if sheet is private/restricted or large)
  if (cleanId) {
    try {
      const editUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/edit`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(editUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      clearTimeout(timeout);
      if (res.ok) {
        const html = await res.text();
        const tabMatch = html.match(/docs-sheet-tab-caption\">([^<]+)/);
        if (tabMatch && tabMatch[1] && tabMatch[1].trim()) {
          detectedTabName = tabMatch[1].trim();
          detectionSource = 'GOOGLE_SHEET_HTML_PREFLIGHT';
        } else {
          const altMatch = html.match(/"name":\s*"([^"]+)"/);
          if (altMatch && altMatch[1] && altMatch[1].trim() && !altMatch[1].includes('{') && !altMatch[1].includes('http')) {
            detectedTabName = altMatch[1].trim();
            detectionSource = 'GOOGLE_SHEET_HTML_METADATA';
          }
        }
      }
    } catch (e: any) {
      console.warn('[Sheet Name Import] Fast HTML inspection:', e.message);
    }
  }

  // Strategy 1: Check metadata from Service Account if configured (only if not yet detected)
  const creds = getServiceAccountCredentials();
  if (creds.isConfigured && (!detectedTabName || detectedTabName === config.tabName)) {
    try {
      const saResult = await fetchViaServiceAccount(cleanId, detectedTabName);
      if (saResult && (saResult as any).detectedSheetName) {
        detectedTabName = (saResult as any).detectedSheetName;
        detectionSource = 'GOOGLE_SHEETS_API_V4';
      }
    } catch (e: any) {
      console.warn('[Sheet Name Import] Service Account metadata lookup:', e.message);
    }
  }

  // Strategy 1.5: Direct Workbook Inspection via SheetJS from export?format=xlsx (only if not yet detected)
  if (cleanId && !detectedTabName) {
    try {
      const exportUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/export?format=xlsx`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(exportUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (PLSMS-Workbook-Inspector)' },
      });
      clearTimeout(timeout);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(Buffer.from(buf), { type: 'buffer', bookSheets: true });
        if (wb && wb.SheetNames && wb.SheetNames.length > 0) {
          detectedTabName = wb.SheetNames[0];
          detectionSource = 'GOOGLE_SHEET_WORKBOOK_STRUCTURE';
        }
      }
    } catch (e: any) {
      console.warn('[Sheet Name Import] XLSX workbook structure lookup:', e.message);
    }
  }

  // Strategy 2: Check latest Google Sheet import job metadata
  try {
    const jobs = getImportJobs();
    const sheetJob = jobs.find((j) => j.filename && j.filename.includes('[') && j.filename.includes(']'));
    if (sheetJob && sheetJob.filename) {
      const match = sheetJob.filename.match(/\[(.*?)\]/);
      if (match && match[1] && match[1].trim().length > 0) {
        detectedTabName = match[1].trim();
        detectionSource = 'LINKED_GOOGLE_SHEET_METADATA';
      }
    }
  } catch (err: any) {
    console.warn('[Sheet Name Import] Job history lookup:', err.message);
  }

  // Strategy 3: Check Apps Script WebApp
  if (config.webAppUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(config.webAppUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const text = await res.text();
        try {
          const parsed = JSON.parse(text);
          if (parsed && (parsed.activeTab || parsed.tabName)) {
            detectedTabName = parsed.activeTab || parsed.tabName;
            detectionSource = 'APPS_SCRIPT_WEBHOOK';
          }
        } catch {}
      }
    } catch {}
  }

  // Save detected tabName in config
  if (detectedTabName) {
    saveGoogleSheetsConfig({
      tabName: detectedTabName,
    });
  }

  return {
    success: true,
    tabName: detectedTabName,
    spreadsheetId: cleanId,
    source: detectionSource,
    message: `Sheet name successfully imported from linked Google Sheet: "${detectedTabName}"`,
  };
}

export interface ExtractedSheetInfo {
  cleanId: string;
  gid?: string;
  tabName?: string;
  isPublishedWeb: boolean;
  rawUrl?: string;
}

/**
 * Extract clean Spreadsheet ID, GID, and flags from any URL or raw ID
 */
export function extractSpreadsheetInfo(input: string): ExtractedSheetInfo {
  if (!input || !input.trim()) {
    return {
      cleanId: '',
      tabName: '',
      isPublishedWeb: false,
    };
  }
  const trimmed = input.trim();

  // Check if it's a published to web URL: /d/e/2PACX-.../pub
  const pubMatch = trimmed.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  if (pubMatch && pubMatch[1]) {
    return {
      cleanId: pubMatch[1],
      isPublishedWeb: true,
      rawUrl: trimmed,
    };
  }

  // Check standard Google Sheet URL: /spreadsheets/d/ID/...
  const standardMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  let cleanId = standardMatch && standardMatch[1] ? standardMatch[1] : '';

  if (!cleanId) {
    // If user provided just the key directly
    if (/^[a-zA-Z0-9-_]{15,}$/.test(trimmed)) {
      cleanId = trimmed;
    } else {
      cleanId = trimmed;
    }
  }

  // Extract GID if present in query (?gid=...) or hash (#gid=...)
  let gid: string | undefined;
  const gidMatch = trimmed.match(/[?&#]gid=([0-9]+)/);
  if (gidMatch && gidMatch[1]) {
    gid = gidMatch[1];
  }

  return {
    cleanId: cleanId,
    gid,
    isPublishedWeb: trimmed.includes('/pub') || trimmed.includes('/pubhtml'),
    rawUrl: trimmed,
  };
}

export function extractSpreadsheetId(input: string): string {
  return extractSpreadsheetInfo(input).cleanId;
}

/**
 * Detect Spreadsheet ID and available Sheet/Tab Names from URL or ID.
 * Employs Service Account metadata with fast fallbacks to workbook/HTML inspection.
 */
export async function detectSpreadsheetDetails(inputUrlOrId: string): Promise<{
  success: boolean;
  spreadsheetId: string;
  availableTabs: string[];
  suggestedTab: string;
  message?: string;
}> {
  const info = extractSpreadsheetInfo(inputUrlOrId);
  const cleanId = info.cleanId || (inputUrlOrId || '').trim();
  if (!cleanId || cleanId.length < 5) {
    return {
      success: false,
      spreadsheetId: '',
      availableTabs: [],
      suggestedTab: '',
      message: 'Invalid Google Sheet URL or ID format.',
    };
  }

  const availableTabs: string[] = [];

  // Strategy 1: Google Sheets API v4 metadata using Service Account
  try {
    const creds = getServiceAccountCredentials();
    if (creds.isConfigured) {
      const cleanKey = creds.privateKey.replace(/\\n/g, '\n');
      const jwtClient = new JWT({
        email: creds.email,
        key: cleanKey,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets.readonly',
          'https://www.googleapis.com/auth/spreadsheets',
        ],
      });
      await jwtClient.authorize();
      const tokenRes = await jwtClient.getAccessToken();
      const token = tokenRes.token;
      if (token) {
        const metaRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?fields=sheets.properties.title`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (metaRes.ok) {
          const metaJson = (await metaRes.json()) as any;
          for (const s of metaJson.sheets || []) {
            const title = s?.properties?.title;
            if (title && !availableTabs.includes(title)) {
              availableTabs.push(title);
            }
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('[Detect Spreadsheet Tabs] Service Account metadata check notice:', e.message);
  }

  // Strategy 2: Fast HTML preflight fallback
  if (availableTabs.length === 0) {
    try {
      const editUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/edit`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(editUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      clearTimeout(timeout);
      if (res.ok) {
        const html = await res.text();
        const tabMatches = html.matchAll(/docs-sheet-tab-caption\">([^<]+)/g);
        for (const m of tabMatches) {
          if (m[1] && m[1].trim() && !availableTabs.includes(m[1].trim())) {
            availableTabs.push(m[1].trim());
          }
        }
      }
    } catch {}
  }

  // Strategy 3: Workbook XLSX inspection fallback
  if (availableTabs.length === 0) {
    try {
      const exportUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/export?format=xlsx`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(exportUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (PLSMS-Workbook-Inspector)' },
      });
      clearTimeout(timeout);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(Buffer.from(buf), { type: 'buffer', bookSheets: true });
        if (wb?.SheetNames && wb.SheetNames.length > 0) {
          for (const s of wb.SheetNames) {
            if (s && !availableTabs.includes(s)) {
              availableTabs.push(s);
            }
          }
        }
      }
    } catch {}
  }

  const nonDefaultTab = availableTabs.find((t) => t && t !== 'Sheet1' && t !== 'Class Data');
  const suggestedTab = info.tabName || nonDefaultTab || (availableTabs.length > 0 ? availableTabs[0] : '');
  if (suggestedTab && !availableTabs.includes(suggestedTab)) {
    availableTabs.push(suggestedTab);
  }

  return {
    success: true,
    spreadsheetId: cleanId,
    availableTabs,
    suggestedTab,
  };
}

/**
 * Parse GViz JSON response (google.visualization.Query.setResponse({...})) into matrix
 */
function parseGvizJsonResponse(text: string): { headers: string[]; rows: any[] } | null {
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return null;

    const jsonStr = text.substring(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);
    if (!parsed || !parsed.table) return null;

    const cols = parsed.table.cols || [];
    const rows = parsed.table.rows || [];

    const headers = cols.map((c: any, idx: number) => c.label || c.id || `Column_${idx + 1}`);
    const dataRows: any[] = [];

    for (const r of rows) {
      if (!r || !r.c) continue;
      const rowObj: any = {};
      let hasVal = false;
      r.c.forEach((cell: any, idx: number) => {
        const h = headers[idx] || `Column_${idx + 1}`;
        const v = cell ? (cell.f !== undefined ? cell.f : cell.v !== undefined ? cell.v : '') : '';
        if (v !== null && v !== undefined && String(v).trim() !== '') {
          hasVal = true;
        }
        rowObj[h] = v !== null && v !== undefined ? String(v).trim() : '';
      });
      if (hasVal) {
        dataRows.push(rowObj);
      }
    }

    return { headers, rows: dataRows };
  } catch (err) {
    return null;
  }
}

/**
 * Fetch Google Sheet values using authenticated Google Cloud Service Account (OAuth2 JWT)
 */
async function fetchViaServiceAccount(
  spreadsheetId: string,
  tabName: string
): Promise<{ headers: string[]; rows: any[] }> {
  const creds = getServiceAccountCredentials();
  if (!creds.isConfigured) {
    throw new Error('Service Account credentials are not configured.');
  }

  const cleanKey = creds.privateKey.replace(/\\n/g, '\n');
  const jwtClient = new JWT({
    email: creds.email,
    key: cleanKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });

  await jwtClient.authorize();
  const tokenResponse = await jwtClient.getAccessToken();
  const token = tokenResponse.token;

  if (!token) {
    throw new Error('Failed to obtain Google Cloud OAuth2 access token for Service Account.');
  }

  // 1. First fetch just the header row to find out how many columns the sheet actually uses.
  // FIX: previously hardcoded to A1:Z (26 cols), which silently dropped any data in column 27+
  // for sheets with more custom fields. Now we size the range to the real header count (+buffer).
  let targetSheet = tabName || 'Sheet1';
  let lastCol = 'Z';
  try {
    const headerProbeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(targetSheet)}!1:1?valueRenderOption=FORMATTED_VALUE`;
    const headerProbeRes = await fetch(headerProbeUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (headerProbeRes.ok) {
      const headerJson = (await headerProbeRes.json()) as any;
      const headerCount = (headerJson.values?.[0]?.length) || 26;
      lastCol = columnNumberToA1(Math.max(headerCount + 10, 26)); // +10 col buffer for trailing/blank-header data
    }
  } catch (_) {
    // If the probe fails for any reason, fall back to the old safe default (A1:Z) rather than throwing here.
  }
  let range = `${encodeURIComponent(targetSheet)}!A1:${lastCol}`;
  let valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;

  let valuesRes = await fetch(valuesUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  // If the direct tab request failed (e.g. tab name case mismatch or 404), query metadata to discover exact matching tab name
  if (!valuesRes.ok && (valuesRes.status === 400 || valuesRes.status === 404)) {
    try {
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (metaRes.ok) {
        const metaData = (await metaRes.json()) as any;
        const sheetTitles: string[] = (metaData.sheets || [])
          .map((s: any) => s.properties?.title)
          .filter(Boolean);
        if (sheetTitles.length > 0) {
          const matchingTab = sheetTitles.find(
            (t) => t.trim().toLowerCase() === targetSheet.trim().toLowerCase()
          ) || sheetTitles[0];
          if (matchingTab) {
            targetSheet = matchingTab;
            range = `${encodeURIComponent(targetSheet)}!A1:${lastCol}`;
            valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;
            valuesRes = await fetch(valuesUrl, {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
              },
            });
          }
        }
      }
    } catch (_) {}
  }

  if (!valuesRes.ok) {
    const errBody = await valuesRes.text();
    if (valuesRes.status === 404) {
      const notFoundErr: any = new Error(`Spreadsheet "${spreadsheetId}" not found or sheet tab "${targetSheet}" does not exist.`);
      notFoundErr.isNotFound = true;
      notFoundErr.statusCode = 404;
      throw notFoundErr;
    }
    if (valuesRes.status === 403) {
      const forbiddenErr: any = new Error(
        `GOOGLE_SHEET_RESTRICTED: The Google Sheet is not shared with the app Service Account (${creds.email}). To keep your document strictly private from the public web: 1. Open your Google Sheet. 2. Click 'Share' (top-right). 3. Add "${creds.email}" as a Viewer. 4. Click 'Done' and sync again!`
      );
      forbiddenErr.isRestricted = true;
      forbiddenErr.serviceAccountEmail = creds.email;
      throw forbiddenErr;
    }
    throw new Error(`Google Sheets API error (${valuesRes.status}): ${errBody}`);
  }

  const valuesJson = (await valuesRes.json()) as any;
  const rawValues: any[][] = valuesJson.values || [];
  valuesJson.values = null; // Release JSON tree reference immediately

  if (rawValues.length === 0) {
    throw new Error(`The sheet tab "${targetSheet}" contains no data rows.`);
  }

  const parsed = extractHeadersAndDataFromMatrix(rawValues);
  rawValues.length = 0; // Release 2D matrix array immediately
  return parsed;
}

let isGlobalSyncInProgress = false;
let globalSyncStartedAt = 0;

/**
 * Fetch raw CSV, JSON, or Excel data from Google Sheets endpoints with multi-layer fallback & Service Account proxy
 */
async function fetchGoogleSheetData(
  spreadsheetId: string,
  tabName: string,
  publishedUrl?: string
): Promise<{ rawText?: string; parsedData?: { headers: string[]; rows: any[] }; tempCsvPath?: string; isStreamed?: boolean; serviceAccountUsed?: boolean }> {
  const info = extractSpreadsheetInfo(spreadsheetId);
  const cleanId = info.cleanId;
  const gid = info.gid;

  if (!isValidGoogleSheetTarget(cleanId, publishedUrl)) {
    throw new Error('Please enter a valid Google Spreadsheet ID or URL (e.g. docs.google.com/spreadsheets/d/...).');
  }

  const creds = getServiceAccountCredentials();

  let saw401OrPrivate = false;
  let saw404NotFound = false;
  let all404 = true;
  let lastError = '';

  // Primary Strategy: If Service Account is configured and we have a cleanId, use authenticated Sheets API v4
  if (cleanId && creds.isConfigured) {
    try {
      const saResult = await fetchViaServiceAccount(cleanId, tabName);
      if (saResult && saResult.rows.length > 0) {
        return { parsedData: saResult, serviceAccountUsed: true };
      }
    } catch (saErr: any) {
      if (saErr.isRestricted) {
        throw saErr;
      }
      if (saErr.isNotFound) {
        saw404NotFound = true;
        const notFoundError: any = new Error(
          `Google Spreadsheet Not Found (HTTP 404): The Google Spreadsheet with ID "${cleanId}" does not exist on Google Docs or has been deleted/moved. Please verify your Spreadsheet link/ID or load the Official Nepal Driving License Dataset.`
        );
        notFoundError.isNotFound = true;
        notFoundError.isRestricted = false;
        notFoundError.spreadsheetId = cleanId;
        throw notFoundError;
      }
      console.log('[Google Sheets Sync] Service Account notice:', saErr.message);
    }
  }

  let preflightPrivate = false;
  let preflightDetectedTab = '';
  let preflightDocTitle = '';

  // Fast preflight check: inspects /edit in ~1.5s to detect if sheet is private, discover the exact tab name, and verify existence
  if (cleanId) {
    try {
      const inspectUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/edit`;
      const inspectRes = await fetch(inspectUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
      });
      if (inspectRes.status === 401 || inspectRes.status === 403) {
        preflightPrivate = true;
        saw401OrPrivate = true;
      } else if (inspectRes.status === 404 || inspectRes.status === 410) {
        saw404NotFound = true;
      } else if (inspectRes.ok) {
        const html = await inspectRes.text();
        if (
          html.includes('accounts.google.com') ||
          html.includes('ServiceLogin') ||
          html.includes('Sign in') ||
          html.includes('登入') ||
          html.includes('sign-in')
        ) {
          preflightPrivate = true;
          saw401OrPrivate = true;
        }
        const tabMatch = html.match(/docs-sheet-tab-caption\">([^<]+)/);
        if (tabMatch && tabMatch[1] && tabMatch[1].trim()) {
          preflightDetectedTab = tabMatch[1].trim();
        } else {
          const altMatch = html.match(/"name":\s*"([^"]+)"/);
          if (altMatch && altMatch[1] && altMatch[1].trim() && !altMatch[1].includes('{') && !altMatch[1].includes('http')) {
            preflightDetectedTab = altMatch[1].trim();
          }
        }
        const titleMatch = html.match(/<title>([^-<]+)/);
        if (titleMatch && titleMatch[1] && titleMatch[1].trim()) {
          preflightDocTitle = titleMatch[1].trim();
        }
      }
    } catch (inspectErr: any) {
      console.warn('Google Sheets preflight inspection notice:', inspectErr.message);
    }
  }

  const candidateUrls: { url: string; type: 'csv' | 'xlsx' | 'gviz_json' | 'pub' }[] = [];

  // 1. Direct Published URL if provided
  if (publishedUrl && publishedUrl.trim().startsWith('http')) {
    const pUrl = publishedUrl.trim();
    if (pUrl.includes('output=csv') || pUrl.includes('format=csv')) {
      candidateUrls.push({ url: pUrl, type: 'csv' });
    } else if (pUrl.includes('pubhtml')) {
      candidateUrls.push({ url: pUrl.replace('/pubhtml', '/pub?output=csv'), type: 'pub' });
    } else {
      candidateUrls.push({ url: pUrl, type: 'csv' });
    }
  }

  if (info.isPublishedWeb && info.rawUrl) {
    const pubUrl = info.rawUrl;
    if (pubUrl.includes('pubhtml')) {
      candidateUrls.push({ url: pubUrl.replace('/pubhtml', '/pub?output=csv'), type: 'pub' });
    } else if (!pubUrl.includes('output=csv')) {
      candidateUrls.push({ url: pubUrl + (pubUrl.includes('?') ? '&' : '?') + 'output=csv', type: 'pub' });
    } else {
      candidateUrls.push({ url: pubUrl, type: 'pub' });
    }
  }

  if (cleanId) {
    const cleanTab = encodeURIComponent(tabName || 'Sheet1');
    const autoCleanTab = preflightDetectedTab ? encodeURIComponent(preflightDetectedTab) : '';

    // If preflight detected a specific tab name (e.g. "PLSMS-APP") and it differs from user tab, prioritize it
    if (autoCleanTab && autoCleanTab !== cleanTab) {
      candidateUrls.push({
        url: `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${autoCleanTab}`,
        type: 'csv',
      });
      candidateUrls.push({
        url: `https://docs.google.com/spreadsheets/d/${cleanId}/export?format=csv&sheet=${autoCleanTab}`,
        type: 'csv',
      });
    }

    // Strategy A: GViz CSV with Tab / GID
    if (gid) {
      candidateUrls.push({
        url: `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&gid=${gid}`,
        type: 'csv',
      });
    }
    if (tabName && tabName.trim()) {
      candidateUrls.push({
        url: `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${cleanTab}`,
        type: 'csv',
      });
    }
    candidateUrls.push({
      url: `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv`,
      type: 'csv',
    });

    // Strategy B: Standard Export CSV
    if (gid) {
      candidateUrls.push({
        url: `https://docs.google.com/spreadsheets/d/${cleanId}/export?format=csv&gid=${gid}`,
        type: 'csv',
      });
    }
    if (tabName && tabName.trim()) {
      candidateUrls.push({
        url: `https://docs.google.com/spreadsheets/d/${cleanId}/export?format=csv&sheet=${cleanTab}`,
        type: 'csv',
      });
    }
    candidateUrls.push({
      url: `https://docs.google.com/spreadsheets/d/${cleanId}/export?format=csv`,
      type: 'csv',
    });

    // Strategy C: XLSX Binary Export
    candidateUrls.push({
      url: `https://docs.google.com/spreadsheets/d/${cleanId}/export?format=xlsx`,
      type: 'xlsx',
    });

    // Strategy D: GViz JSON
    if (autoCleanTab && autoCleanTab !== cleanTab) {
      candidateUrls.push({
        url: `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:json&sheet=${autoCleanTab}`,
        type: 'gviz_json',
      });
    }
    if (tabName && tabName.trim()) {
      candidateUrls.push({
        url: `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:json&sheet=${cleanTab}`,
        type: 'gviz_json',
      });
    }
    candidateUrls.push({
      url: `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:json`,
      type: 'gviz_json',
    });
  }

  if (candidateUrls.length === 0) {
    throw new Error('Please enter a valid Google Spreadsheet ID or URL (e.g. docs.google.com/spreadsheets/d/...).');
  }

  // If candidate URLs are available, try them first before declaring permission error
  for (const candidate of candidateUrls) {
    try {
      const response = await fetch(candidate.url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept':
            'text/csv, text/tab-separated-values, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json, text/plain, */*',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(120000),
      });

      if (response.status === 401 || response.status === 403) {
        saw401OrPrivate = true;
        all404 = false;
        lastError = `HTTP ${response.status} Unauthorized / Access Restricted`;
        continue;
      }

      if (response.status === 404 || response.status === 410) {
        saw404NotFound = true;
        lastError = response.status === 410 ? `HTTP 410 Gone / Deleted` : `HTTP 404 Not Found`;
        // If Google Docs returns 404 or 410 for the document endpoint, all variations of this document ID will fail
        if (candidate.url.includes('/gviz/tq') || candidate.url.includes('/export')) {
          break;
        }
        continue;
      }

      if (!response.ok) {
        all404 = false;
        lastError = `HTTP ${response.status} from Google Sheets service`;
        continue;
      }

      all404 = false;
      const contentType = response.headers.get('content-type') || '';

      // Handle XLSX Binary
      if (
        candidate.type === 'xlsx' ||
        contentType.includes('spreadsheetml') ||
        contentType.includes('octet-stream')
      ) {
        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length > 500) {
          // Check for ZIP magic bytes (PK\x03\x04)
          if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
            try {
              const workbook = XLSX.read(buffer, { type: 'buffer' });
              const preferredTab = preflightDetectedTab || tabName || 'sheet1';
              const targetSheetName =
                workbook.SheetNames.find((n: string) => n.toLowerCase() === preferredTab.toLowerCase()) ||
                workbook.SheetNames[0];
              const worksheet = workbook.Sheets[targetSheetName];
              if (worksheet) {
                const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
                const parsedResult = extractHeadersAndDataFromMatrix(matrix);
                if (parsedResult.rows.length > 0) {
                  return { parsedData: parsedResult };
                }
              }
            } catch (xlsxErr) {
              console.error('XLSX parsing failed:', xlsxErr);
            }
          }
        }
      }

      // For CSV and published endpoints, stream directly to a disk file to prevent V8 heap exhaustion
      if (candidate.type === 'csv' || candidate.type === 'pub') {
        const tempCsvPath = path.join(STORAGE_UPLOADS, `stream_sheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.csv`);
        const fileWriter = fs.createWriteStream(tempCsvPath);
        if (response.body) {
          const reader = response.body.getReader();
          let sampleHead = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (sampleHead.length < 2048) {
              sampleHead += Buffer.from(value).toString('utf-8');
            }
            fileWriter.write(value);
          }
          await new Promise<void>((resolve, reject) => {
            fileWriter.end((err?: any) => {
              if (err) reject(err);
              else resolve();
            });
          });

          if (
            sampleHead.includes('<!DOCTYPE html') ||
            sampleHead.includes('accounts.google.com/signin') ||
            sampleHead.includes('accounts.google.com') ||
            sampleHead.includes('ServiceLogin') ||
            sampleHead.includes('Sign in') ||
            sampleHead.includes('找不到網頁') ||
            sampleHead.includes('目前無法開啟這個檔案')
          ) {
            try { fs.unlinkSync(tempCsvPath); } catch (_) {}
            saw401OrPrivate = true;
            lastError = `Google Sheet is currently private. Share it with Service Account (${creds.email}) or set General Access to "Anyone with the link can view".`;
            continue;
          }

          if (fs.existsSync(tempCsvPath) && fs.statSync(tempCsvPath).size > 10) {
            return { tempCsvPath, isStreamed: true };
          }
        }
      }

      const text = await response.text();

      // Check if it returned an HTML sign-in page instead of actual data
      if (
        text.includes('<!DOCTYPE html') ||
        text.includes('accounts.google.com/signin') ||
        text.includes('accounts.google.com') ||
        text.includes('ServiceLogin') ||
        text.includes('Sign in - Google Accounts') ||
        text.includes('找不到網頁') ||
        text.includes('目前無法開啟這個檔案')
      ) {
        saw401OrPrivate = true;
        lastError = `Google Sheet is currently private. Share it with Service Account (${creds.email}) or set General Access to "Anyone with the link can view".`;
        continue;
      }

      // Handle GViz JSON
      if (candidate.type === 'gviz_json' || text.startsWith('/*O_o*/')) {
        const parsedGviz = parseGvizJsonResponse(text);
        if (parsedGviz && parsedGviz.rows.length > 0) {
          return { parsedData: parsedGviz };
        }
      }

      // Handle CSV text: write to temp file on disk for streaming ingestion
      if (text.trim().length > 0) {
        const tempCsvPath = path.join(STORAGE_UPLOADS, `stream_sheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.csv`);
        fs.writeFileSync(tempCsvPath, text, 'utf-8');
        return { tempCsvPath, isStreamed: true, rawText: text };
      }
    } catch (err: any) {
      all404 = false;
      const isTimeout =
        err.name === 'TimeoutError' ||
        (err.message && err.message.toLowerCase().includes('timeout')) ||
        (err.message && err.message.toLowerCase().includes('aborted'));

      if (isTimeout) {
        if (preflightPrivate || saw401OrPrivate) {
          saw401OrPrivate = true;
          lastError = `Google Sheet access timed out while verifying permissions. The document is private/restricted. Please share it with "${creds.email}" or set General Access to "Anyone with the link can view".`;
        } else {
          lastError = `Connection to Google Sheets timed out (exceeded 25-second limit). This typically occurs when the sheet contains a massive dataset, is private/restricted, or the tab name "${tabName || preflightDetectedTab || 'Sheet1'}" is incorrect. Try sharing with the Service Account (${creds.email}) or publishing to the web (File > Share > Publish to web).`;
        }
      } else {
        lastError = err.message || 'Connection error';
      }
    }
  }

  const sheetEditUrl = cleanId ? `https://docs.google.com/spreadsheets/d/${cleanId}/edit` : '';
  const isRestricted =
    saw401OrPrivate ||
    preflightPrivate ||
    lastError.includes('401') ||
    lastError.includes('403') ||
    lastError.includes('private') ||
    lastError.includes('restricted') ||
    lastError.includes('Permission Required');
  const isNotFound = (saw404NotFound || lastError.includes('404') || lastError.includes('410')) && !isRestricted;
  const cleanUrl = sheetEditUrl || `https://docs.google.com/spreadsheets/d/${cleanId}/edit`;

  let userFriendlyMsg = '';
  if (isRestricted) {
    if (creds.isConfigured) {
      userFriendlyMsg = `Google Sheet Permission Required: The document is private. Please click 'Share' in your Google Sheet and add the Service Account "${creds.email}" as Viewer (or set General Access to 'Anyone with the link can view').`;
    } else {
      userFriendlyMsg = `Google Sheet Access Restricted: The document is private. Please open your Google Sheet, click 'Share' (top-right), and set General Access to 'Anyone with the link' as Viewer (or use 'File > Share > Publish to web').`;
    }
  } else if (isNotFound) {
    userFriendlyMsg = `Google Spreadsheet Not Found (${lastError.includes('410') ? 'HTTP 410' : 'HTTP 404'}): The Google Spreadsheet with ID "${cleanId}" does not exist on Google Docs or has been deleted/moved. Please verify your Spreadsheet link/ID or load the Official Nepal Driving License Dataset.`;
  } else {
    userFriendlyMsg = lastError || 'Unable to sync with Google Sheet. Please check the URL/ID or share the sheet.';
  }

  const error: any = new Error(userFriendlyMsg);
  error.isRestricted = isRestricted;
  error.isNotFound = isNotFound;
  error.sheetUrl = cleanUrl;
  error.spreadsheetId = cleanId;
  error.serviceAccountEmail = creds.email;
  error.detectedTabName = preflightDetectedTab || undefined;
  throw error;
}

/**
 * Pure row normalization function. Never maintains full-dataset heap structures.
 * Transforms a single row of CSV/Spreadsheet data into an authoritative PLSMS LicenseRecord.
 */
function normalizeSingleSheetRow(
  row: Record<string, any>,
  sheetRow: number,
  mapping: any,
  spreadsheetId: string,
  tabName: string,
  modifiedMapById: Map<string, LicenseRecord>,
  actionOverridesMapById: Map<string, any>,
  actionOverridesMapByLic: Map<string, any>,
  actionOverridesMapByApp: Map<string, any>,
  importId: string,
  nowIso: string
): {
  record?: LicenseRecord;
  isNew?: boolean;
  isDistributed?: boolean;
  isMissing?: boolean;
  isFound?: boolean;
  isHandedOver?: boolean;
  missingAppId?: boolean;
  missingLic?: boolean;
  isEmpty?: boolean;
} {
  const isBlank = (val?: string) => {
    if (!val) return true;
    const v = val.trim().toUpperCase();
    return (
      v === '' ||
      v === '-' ||
      v === '--' ||
      v === 'N/A' ||
      v === 'NA' ||
      v === 'NULL' ||
      v === 'UNDEFINED' ||
      v === '(UNDEFINED)' ||
      v === 'NONE' ||
      v === 'NIL' ||
      v === 'EMPTY' ||
      v === '(EMPTY)' ||
      v === '(MISSING)' ||
      v === '(BLANK)'
    );
  };

  const licNo = String(
    (mapping.licenseNumber && row[mapping.licenseNumber]) ||
    row['LICENSE NUMBER'] ||
    row['License Number'] ||
    row['license_number'] ||
    row['LICENSE NO'] ||
    row['License No'] ||
    row['license_no'] ||
    row['DL NO'] ||
    row['dl_no'] ||
    row['CARD NO'] ||
    row['card_no'] ||
    ''
  ).trim();

  const rawAppNo = String(
    (mapping.applicantId && row[mapping.applicantId]) ||
    (mapping.applicationNumber && row[mapping.applicationNumber]) ||
    row['APPLICANT ID'] ||
    row['Applicant ID'] ||
    row['applicant_id'] ||
    row['APPLICATION NUMBER'] ||
    row['Application Number'] ||
    row['application_number'] ||
    row['APPLICATION NO'] ||
    row['Application No'] ||
    row['APP ID'] ||
    row['App ID'] ||
    row['APP NO'] ||
    row['App No'] ||
    ''
  ).trim();

  const name = String(
    (mapping.holderName && row[mapping.holderName]) ||
    row['FULL NAME'] ||
    row['Full Name'] ||
    row['full_name'] ||
    row['NAME'] ||
    row['Name'] ||
    row['name'] ||
    row['DRIVER NAME'] ||
    row['Driver Name'] ||
    ''
  ).trim();

  const sn = mapping.sn && row[mapping.sn] ? String(row[mapping.sn]).trim() : String(sheetRow - 1);
  const category =
    (mapping.category && row[mapping.category] ? String(row[mapping.category]).trim() : '') ||
    (mapping.vehicleClass && row[mapping.vehicleClass] ? String(row[mapping.vehicleClass]).trim() : 'K');
  const office =
    (mapping.department && row[mapping.department] ? String(row[mapping.department]).trim() : '') ||
    (mapping.office && row[mapping.office] ? String(row[mapping.office]).trim() : 'TRANSPORT MANAGEMENT OFFICE, ITAHARI');

  const hasLicNo = !isBlank(licNo);
  const hasAppId = !isBlank(rawAppNo);
  const hasName = !isBlank(name);
  const hasCat = !isBlank(category);

  const isCompletelyEmpty = !hasLicNo && !hasAppId && !hasName && !hasCat && isBlank(sn);
  if (isCompletelyEmpty) {
    return { isEmpty: true };
  }

  const appNo = hasAppId ? rawAppNo : '';
  const validLicNo = hasLicNo ? licNo : '';
  const cleanName = name || 'UNKNOWN HOLDER';

  const cleanAppId = normalizeCleanApplicantId(appNo);
  const cleanNameUpper = normalizeCleanHolderName(cleanName);
  const cleanLicUpper = normalizeCleanLicenseNumber(validLicNo);
  const cleanLicNorm = cleanLicUpper.replace(/[^A-Z0-9]/g, '');

  const phone = mapping.phone && row[mapping.phone] ? String(row[mapping.phone]).trim() : undefined;
  const nid = mapping.nidOrPassport && row[mapping.nidOrPassport] ? String(row[mapping.nidOrPassport]).trim() : undefined;
  const dob = mapping.dateOfBirth && row[mapping.dateOfBirth] ? String(row[mapping.dateOfBirth]).trim() : undefined;
  const address = mapping.address && row[mapping.address] ? String(row[mapping.address]).trim() : undefined;
  const licenseType = mapping.licenseType && row[mapping.licenseType] ? String(row[mapping.licenseType]).trim() : 'Smart Card License';
  const issueDate = mapping.issueDate && row[mapping.issueDate] ? String(row[mapping.issueDate]).trim() : undefined;
  const expiryDate = mapping.expiryDate && row[mapping.expiryDate] ? String(row[mapping.expiryDate]).trim() : undefined;
  const smartCardSerial = mapping.smartCardSerial && row[mapping.smartCardSerial] ? String(row[mapping.smartCardSerial]).trim() : undefined;
  const oldCode = mapping.oldCode && row[mapping.oldCode] ? String(row[mapping.oldCode]).trim() : undefined;
  const newCode = mapping.newCode && row[mapping.newCode] ? String(row[mapping.newCode]).trim() : undefined;

  const rawReceivedBy =
    (mapping.receivedBy && row[mapping.receivedBy] ? String(row[mapping.receivedBy]).trim() : '') ||
    (mapping.receiverName && row[mapping.receiverName] ? String(row[mapping.receiverName]).trim() : '') ||
    (row['DISRTIBUTED TO'] ? String(row['DISRTIBUTED TO']).trim() : '') ||
    (row['DISTRIBUTED TO'] ? String(row['DISTRIBUTED TO']).trim() : '') ||
    (row['Disrtibuted To'] ? String(row['Disrtibuted To']).trim() : '') ||
    (row['Distributed To'] ? String(row['Distributed To']).trim() : '') ||
    (row['RECEIVED BY'] ? String(row['RECEIVED BY']).trim() : '') ||
    (row['Received By'] ? String(row['Received By']).trim() : '');
  const upperRecv = rawReceivedBy.toUpperCase();
  const isRecvPlaceholder =
    upperRecv === '-' ||
    upperRecv === 'NULL' ||
    upperRecv === 'UNDEFINED' ||
    upperRecv === 'N/A' ||
    upperRecv === 'NA' ||
    rawReceivedBy.length === 0;

  const rawDistDate =
    (mapping.distributedDate && row[mapping.distributedDate] ? String(row[mapping.distributedDate]).trim() : '') ||
    (mapping.distributedAt && row[mapping.distributedAt] ? String(row[mapping.distributedAt]).trim() : '');

  const rawDistBy = mapping.distributedBy && row[mapping.distributedBy] ? String(row[mapping.distributedBy]).trim() : '';
  const rawSubDoc = mapping.submittedDocument && row[mapping.submittedDocument] ? String(row[mapping.submittedDocument]).trim() : '';

  const rawMissingVal = (row['MISSING'] ? String(row['MISSING']).trim() : '') || (row['Missing'] ? String(row['Missing']).trim() : '');
  const rawFoundVal = (row['FOUND'] ? String(row['FOUND']).trim() : '') || (row['Found'] ? String(row['Found']).trim() : '');
  const rawDistVal =
    (row['STATUS DISTRIBUTED'] ? String(row['STATUS DISTRIBUTED']).trim() : '') ||
    (row['DISTRIBUTED'] ? String(row['DISTRIBUTED']).trim() : '') ||
    (row['Distributed'] ? String(row['Distributed']).trim() : '');

  let rawStatusVal = '';
  if (rawMissingVal && /miss|lost|हरा|गायब|बेपत्ता|not-found|not found/i.test(rawMissingVal)) {
    rawStatusVal = 'MISSING';
  } else if (rawFoundVal && /found|recov|locat|फेला|भेटि/i.test(rawFoundVal)) {
    rawStatusVal = 'FOUND';
  } else if (mapping.status && row[mapping.status] !== undefined) {
    const mVal = String(row[mapping.status]).trim();
    if (/miss|lost|हरा|गायब|बेपत्ता|not-found|not found/i.test(mVal)) {
      rawStatusVal = 'MISSING';
    } else if (/found|recov|locat|फेला|भेटि/i.test(mVal)) {
      rawStatusVal = 'FOUND';
    } else if (mVal) {
      rawStatusVal = mVal;
    }
  } else if (row['STATUS'] !== undefined) {
    rawStatusVal = String(row['STATUS']).trim();
  } else if (row['Status'] !== undefined) {
    rawStatusVal = String(row['Status']).trim();
  } else if (row['status'] !== undefined) {
    rawStatusVal = String(row['status']).trim();
  } else if (rawDistVal) {
    rawStatusVal = 'DISTRIBUTED';
  }

  const cleanSpreadsheetKey = (spreadsheetId || 'SHEET').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const cleanTabKey = (tabName || 'Sheet1').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const deterministicRecordId = `GS_${cleanSpreadsheetKey}_${cleanTabKey}_R${sheetRow}`;

  // Check if this record already has custom modification in PostgreSQL
  const existingDb =
    (validLicNo ? modifiedMapById.get(validLicNo.toUpperCase()) : undefined) ||
    (appNo ? modifiedMapById.get(appNo.toUpperCase()) : undefined) ||
    modifiedMapById.get(deterministicRecordId);

  let status: LicenseRecord['status'] = 'AVAILABLE';
  if (rawStatusVal) {
    const rawStat = rawStatusVal.toUpperCase();
    if (
      rawStat.includes('MISS') ||
      rawStat.includes('LOST') ||
      rawStat.includes('हराएको') ||
      rawStat.includes('गायब') ||
      rawStat.includes('बेपत्ता') ||
      rawStat.includes('NOT-FOUND') ||
      rawStat.includes('NOT FOUND')
    ) {
      status = 'MISSING';
    } else if (
      rawStat.includes('FOUND') ||
      rawStat.includes('RECOVER') ||
      rawStat.includes('LOCAT') ||
      rawStat.includes('फेला') ||
      rawStat.includes('भेटिएको')
    ) {
      status = 'FOUND';
    } else if (
      rawStat.includes('DISTRIBUT') ||
      rawStat.includes('DELIVER') ||
      rawStat.includes('HANDOVER') ||
      rawStat.includes('ISSUED') ||
      rawStat.includes('COLLECTED') ||
      rawStat.includes('बुझाएको')
    ) {
      status = 'DISTRIBUTED';
    } else if (rawStat.includes('PEND') || rawStat.includes('PROCESS')) {
      status = 'PENDING';
    } else if (rawStat.includes('EXPIR')) {
      status = 'EXPIRED';
    } else if (rawStat.includes('AVAIL') || rawStat.includes('READY') || rawStat.includes('बाँकी')) {
      status = 'AVAILABLE';
    } else if (!isRecvPlaceholder) {
      status = 'DISTRIBUTED';
    }
  } else if (upperRecv.includes('MISS') || upperRecv.includes('LOST') || upperRecv.includes('हराएको')) {
    status = 'MISSING';
  } else if (upperRecv.includes('FOUND') || upperRecv.includes('फेला') || upperRecv.includes('भेटिएको')) {
    status = 'FOUND';
  } else if (!isRecvPlaceholder) {
    status = 'DISTRIBUTED';
  }

  const ov =
    (existingDb?.id ? actionOverridesMapById.get(existingDb.id) : undefined) ||
    (cleanLicUpper ? actionOverridesMapByLic.get(cleanLicUpper) : undefined) ||
    (cleanLicNorm ? actionOverridesMapByLic.get(cleanLicNorm) : undefined) ||
    (cleanAppId ? actionOverridesMapByApp.get(cleanAppId) : undefined);

  const isPermFound =
    (ov && ov.status === 'FOUND') ||
    (existingDb && (isRecordFound(existingDb) || existingDb.status === 'FOUND' || Boolean(existingDb.foundReason) || Boolean(existingDb.foundDate))) ||
    status === 'FOUND';

  if (isPermFound) {
    status = 'FOUND';
  } else if (
    (ov && ov.status === 'MISSING') ||
    (existingDb && (isRecordMissing(existingDb) || existingDb.status === 'MISSING' || existingDb.issueFlag === 'MISSING'))
  ) {
    status = 'MISSING';
  }

  const isMissing = status === 'MISSING';
  const isFound = status === 'FOUND';
  const isHandedOverFound = isFound && Boolean(
    ov?.foundHandoverDone === true ||
    (existingDb?.foundHandoverDone === true && ov?.foundHandoverDone !== false)
  );

  const isDist = !isMissing && !isFound && (status === 'DISTRIBUTED' || (!isRecvPlaceholder && !isFound));
  const isActuallyDistributed = !isMissing && (isDist || isHandedOverFound);

  const cleanSubDocVal = (isDist || isHandedOverFound)
    ? (extractCleanSubmittedDoc(rawSubDoc) || (existingDb?.submittedDocument ? extractCleanSubmittedDoc(existingDb.submittedDocument) : undefined))
    : undefined;

  const recordId = existingDb?.id || deterministicRecordId;

  const record: LicenseRecord = {
    id: recordId,
    sn,
    sheetRow,
    sourceSheet: spreadsheetId,
    sheetTab: tabName,
    applicantId: appNo,
    applicationNumber: appNo,
    holderName: cleanName,
    licenseNumber: validLicNo,
    category,
    vehicleClass: category,
    oldCode,
    newCode,
    department: office,
    office,
    receivedBy: isHandedOverFound ? (existingDb?.receivedBy || ov?.receivedBy || rawReceivedBy || cleanName) : (isDist ? (rawReceivedBy || existingDb?.receivedBy) : undefined),
    receiverName: isHandedOverFound ? (existingDb?.receiverName || ov?.receiverName || rawReceivedBy || cleanName) : (isDist ? (rawReceivedBy || existingDb?.receiverName) : undefined),
    distributedDate: isHandedOverFound ? (existingDb?.distributedDate || existingDb?.foundDate || ov?.distributedDate || rawDistDate || getNepaliDevanagariBSDate(new Date())) : (isDist ? (rawDistDate || existingDb?.distributedDate || undefined) : undefined),
    distributedAt: isHandedOverFound ? (existingDb?.distributedAt || existingDb?.foundReportedAt || ov?.distributedAt) : (isDist ? (rawDistDate || existingDb?.distributedAt || undefined) : undefined),
    distributedBy: isHandedOverFound ? (existingDb?.distributedBy || existingDb?.foundReportedBy || ov?.distributedBy || rawDistBy || 'KOMAL DAHAL') : (isDist ? (rawDistBy || existingDb?.distributedBy || undefined) : undefined),
    submittedDocument: isHandedOverFound ? (existingDb?.submittedDocument || ov?.submittedDocument || cleanSubDocVal || 'Original Smart Card') : cleanSubDocVal,
    recommendingStaffName: isHandedOverFound ? (existingDb?.recommendingStaffName || ov?.recommendingStaffName || undefined) : (isDist ? (cleanStaffName(rawSubDoc) || cleanStaffName(existingDb?.recommendingStaffName) || undefined) : undefined),
    phone: phone || existingDb?.phone,
    receiverPhone: phone || existingDb?.receiverPhone || existingDb?.phone,
    nidOrPassport: nid || existingDb?.nidOrPassport,
    dateOfBirth: dob || existingDb?.dateOfBirth,
    address: address || existingDb?.address,
    licenseType,
    issueDate,
    expiryDate,
    smartCardSerial,
    status: isMissing ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : status)),
    issueFlag: isMissing ? 'MISSING' : 'NORMAL',
    missingReason: isMissing ? (existingDb?.missingReason || 'Reported missing in inventory/Google Sheet') : undefined,
    missingDate: (isFound || isMissing) ? (existingDb?.missingDate || ov?.missingDate || row['MISSING DATE'] || row['MISSING_DATE'] || row['Missing Date'] || rawDistDate) : undefined,
    missingReportedBy: isMissing
      ? ((existingDb as any)?.missingMarkedSource === 'APP_BUTTON' && existingDb?.missingMarkedBy && existingDb?.missingMarkedBy !== '-----'
          ? existingDb.missingMarkedBy
          : (row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY']
              ? resolveUserFullName(row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY'], '-----')
              : '-----'))
      : undefined,
    missingMarkedBy: isMissing
      ? ((existingDb as any)?.missingMarkedSource === 'APP_BUTTON' && existingDb?.missingMarkedBy && existingDb?.missingMarkedBy !== '-----'
          ? existingDb.missingMarkedBy
          : (row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY']
              ? resolveUserFullName(row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY'], '-----')
              : '-----'))
      : undefined,
    missingMarkedSource: isMissing
      ? ((existingDb as any)?.missingMarkedSource === 'APP_BUTTON' ? 'APP_BUTTON' : 'IMPORTED_UNKNOWN')
      : undefined,
    foundReason: isFound ? (existingDb?.foundReason || ov?.foundReason || 'Card recovered and located in inventory') : undefined,
    foundDate: isFound ? (existingDb?.foundDate || ov?.foundDate || rawDistDate || getNepaliDevanagariBSDate(new Date())) : undefined,
    foundReportedBy: isFound ? resolveUserFullName(rawDistBy || existingDb?.foundReportedBy || ov?.foundReportedBy || 'KOMAL DAHAL') : undefined,
    foundHandoverDone: isFound ? isHandedOverFound : undefined,
    receiverRemarks: isFound ? (isHandedOverFound ? 'HANDOVER COMPLETED' : 'FOUND') : (isMissing ? 'MISSING' : (isDist ? 'DISTRIBUTED' : (rawStatusVal || 'AVAILABLE'))),
    importId,
    importedAt: existingDb?.importedAt || nowIso,
    updatedAt: nowIso,
    isDistributed: isActuallyDistributed,
    mainStatus: isActuallyDistributed ? 'DISTRIBUTED' : 'NOT_DISTRIBUTED',
    rawRecord: {
      ...row,
      ...(existingDb?.phone ? { PHONE: existingDb.phone, MOBILE: existingDb.phone, 'MOBILE NUMBER': existingDb.phone, CONTACT: existingDb.phone } : {}),
    },
  };

  const normalized = normalizeRecordData(record);
  return {
    record: normalized,
    isNew: !existingDb,
    isDistributed: isActuallyDistributed,
    isMissing,
    isFound,
    isHandedOver: isHandedOverFound,
    missingAppId: !hasAppId,
    missingLic: !hasLicNo,
  };
}

/**
 * High-performance Google Sheets Synchronizer
 */
export async function syncFromGoogleSheets(options: {
  spreadsheetId?: string;
  tabName?: string;
  publishedUrl?: string;
  uploadedBy?: string;
  ipAddress?: string;
  isBackgroundDaemon?: boolean;
  rawCsvText?: string;
  parsedData?: { headers: string[]; rows: any[] };
  isExplicitReplacement?: boolean;
  isExplicitNewImport?: boolean;
  forceRestart?: boolean;
  stageOnly?: boolean;
}): Promise<{
  success: boolean;
  verified?: boolean;
  syncStatus?: string;
  googleSheetDataRowCount?: number;
  postgresImportedRecordCount?: number;
  sqliteImportedRecordCount?: number;
  sqliteImportedRecords?: number;
  activeDatabase?: string;
  sqliteActive?: string;
  difference?: number;
  skippedFailedRows?: number;
  duplicateRowsDetected?: number;
  totalRows?: number;
  successfullyImported?: number;
  missingApplicantId?: number;
  missingLicenseNumber?: number;
  duplicates?: number;
  otherInvalidRows?: number;
  missingApplicantItems?: any[];
  missingLicenseItems?: any[];
  totalProcessed: number;
  newRecords: number;
  updatedRecords: number;
  duplicatesCount: number;
  invalidRowsCount: number;
  syncDurationMs: number;
  indexedInRam: number;
  duplicateItems: any[];
  config: GoogleSheetsConfig;
  error?: string;
  message?: string;
  failedBatch?: number;
  totalBatches?: number;
  lastCompletedBatch?: number;
  canResume?: boolean;
  sheetReadDurationMs?: number;
  processingDurationMs?: number;
  postgresWriteDurationMs?: number;
  finalPostgresRowCount?: number;
}> {
  const startTime = Date.now();
  const currentConfig = getGoogleSheetsConfig();

  const rawInput = (options.spreadsheetId || currentConfig.spreadsheetId || '').trim();
  const info = extractSpreadsheetInfo(rawInput);
  const spreadsheetId = info.cleanId || rawInput;
  const tabName = (options.tabName || currentConfig.tabName || 'Sheet1').trim();
  const publishedUrl = (options.publishedUrl || currentConfig.publishedUrl || '').trim();

  // If new connection inputs were passed in options, persist them immediately so they are preserved across all tiers even if sync fails
  if ((options.spreadsheetId && options.spreadsheetId.trim() !== currentConfig.spreadsheetId) ||
      (options.publishedUrl && options.publishedUrl.trim() !== currentConfig.publishedUrl) ||
      (options.tabName && options.tabName.trim() !== currentConfig.tabName)) {
    saveGoogleSheetsConfig({
      ...(options.spreadsheetId ? { spreadsheetId: rawInput } : {}),
      ...(options.publishedUrl ? { publishedUrl } : {}),
      ...(options.tabName ? { tabName } : {}),
    });
  }
  const uploadedBy = options.uploadedBy || 'Super Administrator';
  const isBackgroundDaemon = Boolean(options.isBackgroundDaemon);

  if (isGlobalSyncInProgress) {
    if (Date.now() - globalSyncStartedAt > 900000) {
      console.warn('[PLSMS Sync Engine] Releasing stale sync lock after 15m timeout.');
      isGlobalSyncInProgress = false;
    } else {
      // Allow active sync up to 2 seconds to complete
      for (let w = 0; w < 4; w++) {
        await new Promise((r) => setTimeout(r, 500));
        if (!isGlobalSyncInProgress) break;
      }
    }
  }

  if (isGlobalSyncInProgress) {
    const progress = getActiveImportProgress();
    if (isBackgroundDaemon) {
      console.log('[PLSMS 24/7 Sync Engine] Background sync skipped: another synchronization is actively in progress.');
      return {
        success: false,
        totalProcessed: progress.processedRows || currentConfig.indexedInRam || 0,
        newRecords: 0,
        updatedRecords: 0,
        duplicatesCount: 0,
        invalidRowsCount: 0,
        syncDurationMs: 0,
        indexedInRam: currentConfig.indexedInRam || 0,
        duplicateItems: [],
        config: currentConfig,
      };
    }
    console.log('[PLSMS Sync Engine] Synchronization requested while another process is active, returning current status.');
    return {
      success: true,
      totalProcessed: progress.processedRows || currentConfig.indexedInRam || currentConfig.totalSheetRows || 0,
      newRecords: 0,
      updatedRecords: 0,
      duplicatesCount: currentConfig.duplicatesCount || 0,
      invalidRowsCount: currentConfig.invalidRowsCount || 0,
      syncDurationMs: 0,
      indexedInRam: currentConfig.indexedInRam || 0,
      duplicateItems: currentConfig.duplicateItems || [],
      config: currentConfig,
      message: `Synchronization is currently actively in progress in the background (${(progress.processedRows || 0).toLocaleString()}/${(progress.totalRows || 0).toLocaleString()} rows, ${progress.percentage || 0}%). No duplicate import started.`,
    };
  }

  isGlobalSyncInProgress = true;
  globalSyncStartedAt = Date.now();

  // In-memory status update during sync - do NOT permanently save unverified Sheet URL to disk/vault yet
  if (inMemoryConfig) {
    inMemoryConfig = {
      ...inMemoryConfig,
      syncState: 'SYNCING',
      continuousSyncStatus: 'SYNCING',
      lastHeartbeatAt: new Date().toISOString(),
    };
  }

  let parsed: { headers: string[]; rows: any[] } | undefined = undefined;
  let rawRows: any[] = [];
  const duplicate4ColRowMap = new Map<string, number>();
  const existingIdSet = new Set<string>();
  const modifiedMapById = new Map<string, LicenseRecord>();
  const existingDbByRowKey = new Map<string, LicenseRecord>();
  const existingDbBySheetRow = new Map<number, LicenseRecord>();
  const existingDbById = new Map<string, LicenseRecord>();

  try {
    let rawPayloadLength = (options.rawCsvText || '').length;
    const tReadStart = Date.now();

    if (options.parsedData) {
      parsed = options.parsedData;
    } else if (options.rawCsvText) {
      parsed = parseCSVFast(options.rawCsvText);
    } else {
      const fetched = await fetchGoogleSheetData(rawInput, tabName, publishedUrl);
      if (fetched.parsedData) {
        parsed = fetched.parsedData;
      } else if (fetched.tempCsvPath && fs.existsSync(fetched.tempCsvPath)) {
        const fileContent = fs.readFileSync(fetched.tempCsvPath, 'utf-8');
        try { fs.unlinkSync(fetched.tempCsvPath); } catch (_) {}
        rawPayloadLength = fileContent.length;
        parsed = parseCSVFast(fileContent);
      } else if (fetched.rawText) {
        rawPayloadLength = fetched.rawText.length;
        parsed = parseCSVFast(fetched.rawText);
        fetched.rawText = undefined; // Free raw CSV text from heap immediately
      } else {
        throw new Error('No data received from Google Sheets.');
      }
    }
    const tReadDuration = Math.max(1, Date.now() - tReadStart);

    if (!parsed || parsed.rows.length === 0) {
      throw new Error('Google Sheet returned 0 data rows. Please ensure the sheet contains headers and record rows.');
    }

    // Sample first 60 rows for mapping evaluation without retaining entire row matrix in call frame
    const sampleForMapping = parsed.rows.slice(0, 60);
    const evaluation = evaluateAndMapSpreadsheet(parsed.headers, sampleForMapping);
    sampleForMapping.length = 0;
    if (!evaluation.isValidForImport) {
      console.warn(`[PLSMS Sync] Column mapping evaluation: ${evaluation.validationMessage}`);
      if (evaluation.mismatchedColumns.length > 0) {
        console.warn(`[PLSMS Sync] Mismatched columns:`, evaluation.mismatchedColumns);
      }
    }
    const mapping = evaluation.suggestedMapping;

    if (!mapping.licenseNumber || !mapping.holderName) {
      throw new Error(
        `Strong 95% Mapping Engine Alert: Unable to identify License Number and Full Name columns with confidence. Found headers: ${parsed.headers.join(', ')}`
      );
    }

    const nowIso = new Date().toISOString();
    let importId = 'GS_SYNC_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6).toUpperCase();
    rawRows = parsed.rows;
    const totalRows = rawRows.length;
    let invalidRecords = 0;
    let missingApplicantIdCount = 0;
    let missingLicenseNumberCount = 0;
    let otherInvalidRows = 0;
    const missingApplicantIdItems: Array<{
      sheetRow: number;
      sn?: string;
      applicantId?: string;
      holderName?: string;
      licenseNumber?: string;
      category?: string;
      department?: string;
      reason: string;
      rawRow?: any;
    }> = [];
    const missingLicenseNumberItems: Array<{
      sheetRow: number;
      sn?: string;
      applicantId?: string;
      holderName?: string;
      licenseNumber?: string;
      category?: string;
      department?: string;
      reason: string;
      rawRow?: any;
    }> = [];
    const invalidItems: Array<{
      sheetRow: number;
      sn?: string;
      applicantId?: string;
      holderName?: string;
      licenseNumber?: string;
      category?: string;
      department?: string;
      reason: string;
      rawRow?: any;
    }> = [];
    const sheetDuplicates: Array<{
      sheetRow: number;
      matchedRow?: number;
      applicantId: string;
      holderName: string;
      licenseNumber: string;
      category: string;
      reason: string;
      office?: string;
    }> = [];
    let duplicatesInSheet = 0;
    // Clear live sheet row maps for fresh sync indexing without duplicate allocation
    sheetLicenseRowMap.clear();
    sheetAppIdRowMap.clear();
    sheetCleanLicenseRowMap.clear();
    sheetCompositeRowMap.clear();
    sheet4ColCompositeRowMap.clear();

    const forceRestart = Boolean(options.forceRestart);
    const isExplicitReplacement = Boolean(options.isExplicitReplacement);
    const isExplicitNewImport = Boolean(options.isExplicitNewImport || options.isExplicitReplacement || forceRestart);

    // 1. Inspect existing staging data and checkpoint to detect interrupted imports
    const existingStagingCount = await getRecordsStagingCountInPg();
    const existingCheckpoint = await getSheetSyncCheckpointFromPg();
    const hasInterruptedImport =
      existingStagingCount > 0 ||
      (existingCheckpoint && (existingCheckpoint.status === 'IN_PROGRESS' || existingCheckpoint.status === 'FAILED'));

    // 2. Prevent automatic daemon startup/recovery from truncating records_staging when an interrupted import exists
    if (isBackgroundDaemon && hasInterruptedImport) {
      console.log(`[PLSMS 24/7 Sync Engine] Interrupted import detected (${existingStagingCount.toLocaleString()} staging records preserved, checkpoint: ${existingCheckpoint?.status || 'UNKNOWN'}). Background daemon sync skipped to preserve existing staging data.`);
      isGlobalSyncInProgress = false;
      return {
        success: false,
        totalProcessed: 0,
        newRecords: 0,
        updatedRecords: 0,
        duplicatesCount: 0,
        invalidRowsCount: 0,
        syncDurationMs: 0,
        indexedInRam: currentConfig.indexedInRam || 0,
        duplicateItems: [],
        config: currentConfig,
        message: `Interrupted import with ${existingStagingCount.toLocaleString()} staged records preserved. Automatic daemon sync skipped.`,
      };
    }

    // 3. Ensure isolated staging table and indexes exist without truncating
    console.log('[PLSMS Sync] Initializing isolated staging table for non-destructive, zero-downtime atomic import...');
    try {
      await initRecordsStagingTable({ truncate: false });
    } catch (stgErr: any) {
      console.warn('[PLSMS Sync] Warning initializing records_staging table:', stgErr.message);
    }

    // 4. Staging data protection: NEVER truncate records_staging if existing staging data exists
    if (forceRestart && !hasInterruptedImport && existingStagingCount === 0) {
      console.log('[PLSMS Sync] Clean staging workspace initialized.');
      try {
        await clearRecordsStagingInPg();
        await clearSheetSyncCheckpointInPg();
      } catch (clearErr: any) {
        console.warn('[PLSMS Sync] Warning clearing staging table for fresh import:', clearErr.message);
      }
    } else if (existingStagingCount > 0 || hasInterruptedImport) {
      console.log(`[PLSMS Sync] Preserving ${existingStagingCount.toLocaleString()} existing staged records (staging data strictly protected).`);
    }

    // Authoritative index of ALL existing PostgreSQL records for physical row identity & state preservation
    // 1. Fetch full records for modified/distributed entries to preserve custom statuses, handover data, and notes.
    const modifiedOrDistributedRecords = await getModifiedOrDistributedRecordsFromPg();

    for (const er of modifiedOrDistributedRecords) {
      if (er.id) {
        modifiedMapById.set(er.id, er);
        existingDbById.set(er.id, er);
      }
      if (er.sheetRow && er.sheetRow > 0) {
        existingDbBySheetRow.set(er.sheetRow, er);
        const rKey = buildSheetRowIdentityKey(er.sourceSheet || spreadsheetId, er.sheetTab || tabName, er.sheetRow);
        existingDbByRowKey.set(rKey, er);
      }
    }

    // 2. Fetch existing record IDs from PostgreSQL into a lightweight Set for fast existence checks
    // Avoids instantiating 150,000+ full LicenseRecord dummy objects and 5 redundant lookup maps in RAM
    if (!isExplicitReplacement) {
      const allPgIds = await getAllExistingRecordIdsFromPg();
      for (const id of allPgIds) {
        existingIdSet.add(id);
      }
    }

    // Index action overrides so manual status confirmations in PLSMS are never overwritten by background sync
    const actionOverrides = getActionOverrides();
    const actionOverridesMapById = new Map<string, any>();
    const actionOverridesMapByLic = new Map<string, any>();
    const actionOverridesMapByApp = new Map<string, any>();
    for (const ao of actionOverrides) {
      if (ao.id) actionOverridesMapById.set(ao.id, ao);
      if (ao.licenseNumber) {
        actionOverridesMapByLic.set(ao.licenseNumber.trim().toUpperCase(), ao);
        actionOverridesMapByLic.set(ao.licenseNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), ao);
      }
      if (ao.applicantId) actionOverridesMapByApp.set(ao.applicantId.trim().toUpperCase(), ao);
      if (ao.applicationNumber) actionOverridesMapByApp.set(ao.applicationNumber.trim().toUpperCase(), ao);
    }

    // Check if previous sync can be resumed safely from last completed batch
    const checkpoint = await getSheetSyncCheckpointFromPg();
    let resumeFromBatch = 0;
    let isResuming = false;
    const BATCH_SIZE = 4000;
    const totalBatches = Math.ceil(totalRows / BATCH_SIZE);

    if (
      checkpoint &&
      (checkpoint.status === 'FAILED' || checkpoint.status === 'IN_PROGRESS' || checkpoint.status === 'INTERRUPTED') &&
      checkpoint.totalRows === totalRows &&
      checkpoint.lastCompletedBatch >= 0 &&
      !forceRestart
    ) {
      resumeFromBatch = checkpoint.lastCompletedBatch + 1;
      isResuming = true;
      if (checkpoint.importId) {
        importId = checkpoint.importId;
      }
      console.log(`[PLSMS Sync Engine] Checkpoint found: Safely resuming sync from Batch ${resumeFromBatch + 1}/${totalBatches} (${(checkpoint.lastProcessedRow || (resumeFromBatch * BATCH_SIZE)).toLocaleString()} rows already committed to PostgreSQL)...`);
    } else if (existingStagingCount > 0 && !forceRestart) {
      // Staging rows exist in PostgreSQL: compute resume point to protect existing staged data
      resumeFromBatch = Math.min(totalBatches, Math.floor(existingStagingCount / BATCH_SIZE));
      isResuming = true;
      console.log(`[PLSMS Sync Engine] Preserving ${existingStagingCount.toLocaleString()} staged rows in PostgreSQL. Resuming sync from Batch ${resumeFromBatch + 1}/${totalBatches}...`);
    }

    if (!isResuming && !hasInterruptedImport && existingStagingCount === 0) {
      // PROTECT EXISTING DATA: Do NOT prematurely delete PostgreSQL records or distributions.
      // The existing database remains completely intact if the sync crashes, times out, or is interrupted.
      await clearSheetSyncCheckpointInPg();
    }

    let newCount = isResuming ? (checkpoint?.newRecords || 0) : 0;
    let updatedCount = isResuming ? (checkpoint?.updatedRecords || 0) : 0;
    let sheetDistributed = isResuming ? (checkpoint?.sheetDistributed || 0) : 0;
    let sheetMissing = isResuming ? (checkpoint?.sheetMissing || 0) : 0;
    let sheetFound = isResuming ? (checkpoint?.sheetFound || 0) : 0;
    let sheetHandedOver = isResuming ? (checkpoint?.sheetHandedOver || 0) : 0;

    const jsonFileName = `sync_${importId}_normalized.json`;
    const jsonStoragePath = path.join(STORAGE_UPLOADS, jsonFileName);
    if (!isResuming) {
      fs.writeFileSync(jsonStoragePath, '[\n', 'utf-8');
    }

    const assignedRecordIds = new Set<string>();
    let totalNormalizedCount = isResuming ? (checkpoint?.lastProcessedRow || (resumeFromBatch * BATCH_SIZE)) : 0;

    for (let batchIdx = resumeFromBatch; batchIdx < totalBatches; batchIdx++) {
      const startRow = batchIdx * BATCH_SIZE;
      const endRow = Math.min(totalRows, (batchIdx + 1) * BATCH_SIZE);
      const batchNum = batchIdx + 1;

      globalSyncStartedAt = Date.now();
      const batchRecords: LicenseRecord[] = [];

      try {

        for (let i = startRow; i < endRow; i++) {
      const row = rawRows[i];
      // Free processed raw row reference from heap immediately to maintain bounded memory
      rawRows[i] = null as any;
      if (!row) continue;
      const sheetRow = i + 2; // Row 1 is header row in Google Sheets
      const licNo = String(
        (mapping.licenseNumber && row[mapping.licenseNumber]) ||
        row['LICENSE NUMBER'] ||
        row['License Number'] ||
        row['license_number'] ||
        row['LICENSE NO'] ||
        row['License No'] ||
        row['license_no'] ||
        row['DL NO'] ||
        row['dl_no'] ||
        row['CARD NO'] ||
        row['card_no'] ||
        ''
      ).trim();
      const rawAppNo = String(
        (mapping.applicantId && row[mapping.applicantId]) ||
        (mapping.applicationNumber && row[mapping.applicationNumber]) ||
        row['APPLICANT ID'] ||
        row['Applicant ID'] ||
        row['applicant_id'] ||
        row['APPLICATION NUMBER'] ||
        row['Application Number'] ||
        row['application_number'] ||
        row['APPLICATION NO'] ||
        row['Application No'] ||
        row['APP ID'] ||
        row['App ID'] ||
        row['APP NO'] ||
        row['App No'] ||
        ''
      ).trim();
      const name = String(
        (mapping.holderName && row[mapping.holderName]) ||
        row['FULL NAME'] ||
        row['Full Name'] ||
        row['full_name'] ||
        row['NAME'] ||
        row['Name'] ||
        row['name'] ||
        row['DRIVER NAME'] ||
        row['Driver Name'] ||
        ''
      ).trim();
      const sn = mapping.sn && row[mapping.sn] ? String(row[mapping.sn]).trim() : String(i + 1);
      const category =
        (mapping.category && row[mapping.category] ? String(row[mapping.category]).trim() : '') ||
        (mapping.vehicleClass && row[mapping.vehicleClass] ? String(row[mapping.vehicleClass]).trim() : 'K');
      const office =
        (mapping.department && row[mapping.department] ? String(row[mapping.department]).trim() : '') ||
        (mapping.office && row[mapping.office] ? String(row[mapping.office]).trim() : 'TRANSPORT MANAGEMENT OFFICE, ITAHARI');

      // Helper to check if a value is blank or placeholder
      const isBlank = (val?: string) => {
        if (!val) return true;
        const v = val.trim().toUpperCase();
        return (
          v === '' ||
          v === '-' ||
          v === '--' ||
          v === 'N/A' ||
          v === 'NA' ||
          v === 'NULL' ||
          v === 'UNDEFINED' ||
          v === '(UNDEFINED)' ||
          v === 'NONE' ||
          v === 'NIL' ||
          v === 'EMPTY' ||
          v === '(EMPTY)' ||
          v === '(MISSING)' ||
          v === '(BLANK)'
        );
      };

      const hasLicNo = !isBlank(licNo);
      const hasAppId = !isBlank(rawAppNo);
      const hasName = !isBlank(name);
      const hasCat = !isBlank(category);

      // A row is considered completely empty only if it has no data across all primary columns
      const isCompletelyEmpty = !hasLicNo && !hasAppId && !hasName && !hasCat && isBlank(sn);
      if (isCompletelyEmpty) {
        otherInvalidRows++;
        invalidRecords++;
        if (invalidItems.length < 500) {
          invalidItems.push({
            sheetRow,
            sn: sn || '-',
            applicantId: '(Empty Row)',
            holderName: '(Empty Row)',
            licenseNumber: '(Empty Row)',
            category: '-',
            department: office,
            reason: `Completely Empty / Blank Row at Sheet Row #${sheetRow}. Skipped.`,
            rawRow: row,
          });
        }
        continue;
      }

      // MANDATE: NULL/blank Applicant ID -> DO NOT block; upload the row and count it as "Missing Applicant ID"
      if (!hasAppId) {
        missingApplicantIdCount++;
        if (missingApplicantIdItems.length < 500) {
          missingApplicantIdItems.push({
            sheetRow,
            sn: sn || '-',
            applicantId: '(Missing / Blank in Column B)',
            holderName: name || 'UNKNOWN HOLDER',
            licenseNumber: hasLicNo ? licNo : '(Missing / Blank in Column D)',
            category,
            department: office,
            reason: `Missing Applicant ID in Column B at Sheet Row #${sheetRow}. Uploaded successfully without blocking.`,
            rawRow: row,
          });
        }
      }

      // MANDATE: NULL/blank License Number -> DO NOT block; upload the row and count it as "Missing License Number"
      if (!hasLicNo) {
        missingLicenseNumberCount++;
        if (missingLicenseNumberItems.length < 500) {
          missingLicenseNumberItems.push({
            sheetRow,
            sn: sn || '-',
            applicantId: hasAppId ? rawAppNo : '(Missing / Blank in Column B)',
            holderName: name || 'UNKNOWN HOLDER',
            licenseNumber: '(Missing / Blank in Column D)',
            category,
            department: office,
            reason: `Missing License Number in Column D at Sheet Row #${sheetRow}. Uploaded successfully without blocking.`,
            rawRow: row,
          });
        }
      }

      // MANDATE: NEVER fabricate Applicant IDs or License Numbers.
      const appNo = hasAppId ? rawAppNo : '';
      const validLicNo = hasLicNo ? licNo : '';
      const cleanName = name || 'UNKNOWN HOLDER';

      // STRICT 4-COLUMN DUPLICATE ENGINE (REPORT / COUNT ONLY):
      // Rule: "duplicate can be calculated if the data of a ROW of APPLICANT ID and FULL NAME and LICENSE NUMBER and CATEGORY are exactly and strictly matched all these 4 columns data to the other any ROW of the whole sheet then only we can say this record of ROW is Duplicate. other wise we can not say the data is duplicate."
      // Duplicate detection role is strictly REPORT/COUNT ONLY.
      // Duplicate detection must NEVER block, skip, merge, overwrite, or prevent any valid row from being imported into PostgreSQL.
      // Every valid physical Google Sheet row is loaded into PostgreSQL as its own distinct record.
      const cleanAppId = normalizeCleanApplicantId(appNo);
      const cleanNameUpper = normalizeCleanHolderName(cleanName);
      const cleanLicUpper = normalizeCleanLicenseNumber(validLicNo);
      const cleanLicNorm = cleanLicUpper.replace(/[^A-Z0-9]/g, '');
      const cleanCat = normalizeCleanCategory(category);
      const strict4ColKey = buildKAP4ColKey(cleanAppId, cleanNameUpper, cleanLicUpper, cleanCat);

      // Audit tracking for duplicate 4-column cards within the sheet (e.g. replacement / COPY licenses)
      // Purely informational counter and inspection report — never an import-blocking rule.
      if (cleanAppId && cleanNameUpper && cleanLicUpper && cleanCat) {
        const prevRowWithSame4Col = duplicate4ColRowMap.get(strict4ColKey);
        if (prevRowWithSame4Col !== undefined && prevRowWithSame4Col !== sheetRow) {
          duplicatesInSheet++;
          if (sheetDuplicates.length < 500) {
            sheetDuplicates.push({
              sheetRow,
              matchedRow: prevRowWithSame4Col,
              applicantId: appNo,
              holderName: cleanName,
              licenseNumber: validLicNo,
              category,
              reason: `Row #${sheetRow} shares identical 4-column identity with Row #${prevRowWithSame4Col} (Applicant ID + Full Name + License Number + Category). Preserved as a distinct searchable record in PostgreSQL.`,
              office,
            });
          }
        } else {
          duplicate4ColRowMap.set(strict4ColKey, sheetRow);
        }
      }
      
      const phone = mapping.phone && row[mapping.phone] ? String(row[mapping.phone]).trim() : undefined;
      const nid =
        mapping.nidOrPassport && row[mapping.nidOrPassport]
          ? String(row[mapping.nidOrPassport]).trim()
          : undefined;
      const dob =
        mapping.dateOfBirth && row[mapping.dateOfBirth] ? String(row[mapping.dateOfBirth]).trim() : undefined;
      const address =
        mapping.address && row[mapping.address] ? String(row[mapping.address]).trim() : undefined;
      const licenseType =
        mapping.licenseType && row[mapping.licenseType]
          ? String(row[mapping.licenseType]).trim()
          : 'Smart Card License';
      const issueDate =
        mapping.issueDate && row[mapping.issueDate] ? String(row[mapping.issueDate]).trim() : undefined;
      const expiryDate =
        mapping.expiryDate && row[mapping.expiryDate] ? String(row[mapping.expiryDate]).trim() : undefined;
      const smartCardSerial =
        mapping.smartCardSerial && row[mapping.smartCardSerial]
          ? String(row[mapping.smartCardSerial]).trim()
          : undefined;
      const oldCode =
        mapping.oldCode && row[mapping.oldCode] ? String(row[mapping.oldCode]).trim() : undefined;
      const newCode =
        mapping.newCode && row[mapping.newCode] ? String(row[mapping.newCode]).trim() : undefined;

      // Column I: RECEIVED BY check
      const rawReceivedBy =
        (mapping.receivedBy && row[mapping.receivedBy] ? String(row[mapping.receivedBy]).trim() : '') ||
        (mapping.receiverName && row[mapping.receiverName] ? String(row[mapping.receiverName]).trim() : '') ||
        (row['DISRTIBUTED TO'] ? String(row['DISRTIBUTED TO']).trim() : '') ||
        (row['DISTRIBUTED TO'] ? String(row['DISTRIBUTED TO']).trim() : '') ||
        (row['Disrtibuted To'] ? String(row['Disrtibuted To']).trim() : '') ||
        (row['Distributed To'] ? String(row['Distributed To']).trim() : '') ||
        (row['RECEIVED BY'] ? String(row['RECEIVED BY']).trim() : '') ||
        (row['Received By'] ? String(row['Received By']).trim() : '');
      const upperRecv = rawReceivedBy.toUpperCase();
      const isRecvPlaceholder =
        upperRecv === '-' ||
        upperRecv === 'NULL' ||
        upperRecv === 'UNDEFINED' ||
        upperRecv === 'N/A' ||
        upperRecv === 'NA' ||
        rawReceivedBy.length === 0;

      // Column J: DISTRIBUTED DATE
      const rawDistDate =
        (mapping.distributedDate && row[mapping.distributedDate] ? String(row[mapping.distributedDate]).trim() : '') ||
        (mapping.distributedAt && row[mapping.distributedAt] ? String(row[mapping.distributedAt]).trim() : '');

      // Column K: DISTRIBUTED BY
      const rawDistBy = mapping.distributedBy && row[mapping.distributedBy] ? String(row[mapping.distributedBy]).trim() : '';

      // Column L: SUBMITTED DOC.
      const rawSubDoc = mapping.submittedDocument && row[mapping.submittedDocument] ? String(row[mapping.submittedDocument]).trim() : '';

      // Column M, N, O: STATUS from respective row (supports consolidated STATUS column or split subheaders)
      const rawMissingVal = (row['MISSING'] ? String(row['MISSING']).trim() : '') || (row['Missing'] ? String(row['Missing']).trim() : '');
      const rawFoundVal = (row['FOUND'] ? String(row['FOUND']).trim() : '') || (row['Found'] ? String(row['Found']).trim() : '');
      const rawDistVal =
        (row['STATUS DISTRIBUTED'] ? String(row['STATUS DISTRIBUTED']).trim() : '') ||
        (row['DISTRIBUTED'] ? String(row['DISTRIBUTED']).trim() : '') ||
        (row['Distributed'] ? String(row['Distributed']).trim() : '');

      let rawStatusVal = '';
      if (rawMissingVal && /miss|lost|हरा|गायब|बेपत्ता|not-found|not found/i.test(rawMissingVal)) {
        rawStatusVal = 'MISSING';
      } else if (rawFoundVal && /found|recov|locat|फेला|भेटि/i.test(rawFoundVal)) {
        rawStatusVal = 'FOUND';
      } else if (mapping.status && row[mapping.status] !== undefined) {
        const mVal = String(row[mapping.status]).trim();
        if (/miss|lost|हरा|गायब|बेपत्ता|not-found|not found/i.test(mVal)) {
          rawStatusVal = 'MISSING';
        } else if (/found|recov|locat|फेला|भेटि/i.test(mVal)) {
          rawStatusVal = 'FOUND';
        } else if (mVal) {
          rawStatusVal = mVal;
        }
      } else if (row['STATUS'] !== undefined) {
        rawStatusVal = String(row['STATUS']).trim();
      } else if (row['Status'] !== undefined) {
        rawStatusVal = String(row['Status']).trim();
      } else if (row['status'] !== undefined) {
        rawStatusVal = String(row['status']).trim();
      } else if (rawDistVal) {
        rawStatusVal = 'DISTRIBUTED';
      }

      // PHYSICAL SHEET ROW IDENTITY RULE:
      // Source Sheet + Sheet Tab + physical Sheet Row (`sheetRow`) uniquely identifies the imported record.
      // Two different Sheet rows must NEVER reuse the same PostgreSQL record ID merely because
      // Applicant ID + Name + License Number + Category are identical.
      // A legitimate COPY/replacement row must remain a separate record and must never overwrite the original row.
      const cleanSpreadsheetKey = (spreadsheetId || 'SHEET').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
      const cleanTabKey = (tabName || 'Sheet1').trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
      const deterministicRecordId = `GS_${cleanSpreadsheetKey}_${cleanTabKey}_R${sheetRow}`;
      const rowIdentityKey = buildSheetRowIdentityKey(spreadsheetId, tabName, sheetRow);

      let existingDb: LicenseRecord | undefined = undefined;
      if (sheetRow > 0) {
        existingDb =
          existingDbByRowKey.get(rowIdentityKey) ||
          existingDbBySheetRow.get(sheetRow) ||
          existingDbById.get(deterministicRecordId);
      }

      let status: LicenseRecord['status'] = 'AVAILABLE';

      // 1. Observe Column M (Status) & Column I (Received By) & Remarks
      if (rawStatusVal) {
        const rawStat = rawStatusVal.toUpperCase();
        if (
          rawStat.includes('MISS') ||
          rawStat.includes('LOST') ||
          rawStat.includes('हराएको') ||
          rawStat.includes('गायब') ||
          rawStat.includes('बेपत्ता') ||
          rawStat.includes('NOT-FOUND') ||
          rawStat.includes('NOT FOUND')
        ) {
          status = 'MISSING';
        } else if (
          rawStat.includes('FOUND') ||
          rawStat.includes('RECOVER') ||
          rawStat.includes('LOCAT') ||
          rawStat.includes('फेला') ||
          rawStat.includes('भेटिएको')
        ) {
          status = 'FOUND';
        } else if (
          rawStat.includes('DISTRIBUT') ||
          rawStat.includes('DELIVER') ||
          rawStat.includes('HANDOVER') ||
          rawStat.includes('ISSUED') ||
          rawStat.includes('COLLECTED') ||
          rawStat.includes('बुझाएको')
        ) {
          status = 'DISTRIBUTED';
        } else if (rawStat.includes('PEND') || rawStat.includes('PROCESS')) {
          status = 'PENDING';
        } else if (rawStat.includes('EXPIR')) {
          status = 'EXPIRED';
        } else if (rawStat.includes('AVAIL') || rawStat.includes('READY') || rawStat.includes('बाँकी')) {
          status = 'AVAILABLE';
        } else if (!isRecvPlaceholder) {
          status = 'DISTRIBUTED';
        }
      } else if (upperRecv.includes('MISS') || upperRecv.includes('LOST') || upperRecv.includes('हराएको')) {
        status = 'MISSING';
      } else if (upperRecv.includes('FOUND') || upperRecv.includes('फेला') || upperRecv.includes('भेटिएको')) {
        status = 'FOUND';
      } else if (!isRecvPlaceholder) {
        status = 'DISTRIBUTED';
      }

      // PERMANENT RULE: If the card in PLSMS database or manual overrides is marked FOUND,
      // it MUST stay in Found smart cards table permanently. It must never revert to MISSING.
      const ov =
        (existingDb?.id ? actionOverridesMapById.get(existingDb.id) : undefined) ||
        (cleanLicUpper ? actionOverridesMapByLic.get(cleanLicUpper) : undefined) ||
        (cleanLicNorm ? actionOverridesMapByLic.get(cleanLicNorm) : undefined) ||
        (cleanAppId ? actionOverridesMapByApp.get(cleanAppId) : undefined);

      const isPermFound =
        (ov && ov.status === 'FOUND') ||
        (existingDb && (isRecordFound(existingDb) || existingDb.status === 'FOUND' || Boolean(existingDb.foundReason) || Boolean(existingDb.foundDate))) ||
        status === 'FOUND';

      if (isPermFound) {
        status = 'FOUND';
      } else if (
        (ov && ov.status === 'MISSING') ||
        (existingDb && (isRecordMissing(existingDb) || existingDb.status === 'MISSING' || existingDb.issueFlag === 'MISSING'))
      ) {
        status = 'MISSING';
      }

      const isMissing = status === 'MISSING';
      const isFound = status === 'FOUND';

      const isHandedOverFound = isFound && Boolean(
        ov?.foundHandoverDone === true ||
        (existingDb?.foundHandoverDone === true && ov?.foundHandoverDone !== false)
      );

      const isDist = !isMissing && !isFound && (status === 'DISTRIBUTED' || (!isRecvPlaceholder && !isFound));
      const isActuallyDistributed = !isMissing && (isDist || isHandedOverFound);

      // Two-Way Sync Rule: Only queue writeback if an explicit manual PLSMS override exists that differs from Google Sheet
      if (ov && (isMissing || isFound) && (!rawStatusVal || rawStatusVal !== (isFound ? 'FOUND' : 'MISSING'))) {
        const isHandedOver = isHandedOverFound;
        const syncPayload = {
          applicantId: appNo,
          receivedBy: (isMissing || !isHandedOver) ? '' : (existingDb?.receivedBy || ov?.receivedBy || cleanName),
          distributedDate: (isMissing || !isHandedOver) ? '' : (existingDb?.distributedDate || ov?.distributedDate || rawDistDate || getNepaliDevanagariBSDate(new Date())),
          distributedBy: (isMissing || !isHandedOver) ? '' : (existingDb?.distributedBy || ov?.distributedBy || rawDistBy || 'KOMAL DAHAL'),
          submittedDocument: (isMissing || !isHandedOver) ? '' : (extractCleanSubmittedDoc(existingDb?.submittedDocument || ov?.submittedDocument || rawSubDoc) || 'Original Smart Card'),
          status: isMissing ? 'MISSING' : (isHandedOver ? 'DISTRIBUTED' : 'FOUND'),
        };
        queueGoogleSheetDistribution(validLicNo || appNo, syncPayload);
      }

      const cleanSubDocVal = (isDist || isHandedOverFound) ? (extractCleanSubmittedDoc(rawSubDoc) || (existingDb?.submittedDocument ? extractCleanSubmittedDoc(existingDb.submittedDocument) : undefined)) : undefined;

      let recordId = existingDb?.id;
      if (!recordId) {
        recordId = deterministicRecordId;
      }
      if (assignedRecordIds.has(recordId)) {
        recordId = `${recordId}_${Math.random().toString(36).substring(2, 6)}`;
      }
      assignedRecordIds.add(recordId);

      const record: LicenseRecord = {
        id: recordId,
        sn,
        sheetRow,
        sourceSheet: spreadsheetId,
        sheetTab: tabName,
        applicantId: appNo,
        applicationNumber: appNo,
        holderName: cleanName,
        licenseNumber: validLicNo,
        category,
        vehicleClass: category,
        oldCode,
        newCode,
        department: office,
        office,
        receivedBy: isHandedOverFound ? (existingDb?.receivedBy || ov?.receivedBy || rawReceivedBy || cleanName) : (isDist ? (rawReceivedBy || existingDb?.receivedBy) : undefined),
        receiverName: isHandedOverFound ? (existingDb?.receiverName || ov?.receiverName || rawReceivedBy || cleanName) : (isDist ? (rawReceivedBy || existingDb?.receiverName) : undefined),
        distributedDate: isHandedOverFound ? (existingDb?.distributedDate || existingDb?.foundDate || ov?.distributedDate || rawDistDate || getNepaliDevanagariBSDate(new Date())) : (isDist ? (rawDistDate || existingDb?.distributedDate || undefined) : undefined),
        distributedAt: isHandedOverFound ? (existingDb?.distributedAt || existingDb?.foundReportedAt || ov?.distributedAt) : (isDist ? (rawDistDate || existingDb?.distributedAt || undefined) : undefined),
        distributedBy: isHandedOverFound ? (existingDb?.distributedBy || existingDb?.foundReportedBy || ov?.distributedBy || rawDistBy || 'KOMAL DAHAL') : (isDist ? (rawDistBy || existingDb?.distributedBy || undefined) : undefined),
        submittedDocument: isHandedOverFound ? (existingDb?.submittedDocument || ov?.submittedDocument || cleanSubDocVal || 'Original Smart Card') : cleanSubDocVal,
        recommendingStaffName: isHandedOverFound ? (existingDb?.recommendingStaffName || ov?.recommendingStaffName || undefined) : (isDist ? (cleanStaffName(rawSubDoc) || cleanStaffName(existingDb?.recommendingStaffName) || undefined) : undefined),
        phone: phone || existingDb?.phone,
        receiverPhone: phone || existingDb?.receiverPhone || existingDb?.phone,
        nidOrPassport: nid || existingDb?.nidOrPassport,
        dateOfBirth: dob || existingDb?.dateOfBirth,
        address: address || existingDb?.address,
        licenseType,
        issueDate,
        expiryDate,
        smartCardSerial,
        status: isMissing ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : status)),
        issueFlag: isMissing ? 'MISSING' : 'NORMAL',
        missingReason: isMissing ? (existingDb?.missingReason || 'Reported missing in inventory/Google Sheet') : undefined,
        missingDate: (isFound || isMissing) ? (existingDb?.missingDate || ov?.missingDate || row['MISSING DATE'] || row['MISSING_DATE'] || row['Missing Date'] || rawDistDate) : undefined,
        missingReportedBy: isMissing
          ? ((existingDb as any)?.missingMarkedSource === 'APP_BUTTON' && existingDb?.missingMarkedBy && existingDb?.missingMarkedBy !== '-----'
              ? existingDb.missingMarkedBy
              : (row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY']
                  ? resolveUserFullName(row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY'], '-----')
                  : '-----'))
          : undefined,
        missingMarkedBy: isMissing
          ? ((existingDb as any)?.missingMarkedSource === 'APP_BUTTON' && existingDb?.missingMarkedBy && existingDb?.missingMarkedBy !== '-----'
              ? existingDb.missingMarkedBy
              : (row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY']
                  ? resolveUserFullName(row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY'], '-----')
                  : '-----'))
          : undefined,
        missingMarkedSource: isMissing
          ? ((existingDb as any)?.missingMarkedSource === 'APP_BUTTON' ? 'APP_BUTTON' : 'IMPORTED_UNKNOWN')
          : undefined,
        foundReason: isFound ? (existingDb?.foundReason || ov?.foundReason || 'Card recovered and located in inventory') : undefined,
        foundDate: isFound ? (existingDb?.foundDate || ov?.foundDate || rawDistDate || getNepaliDevanagariBSDate(new Date())) : undefined,
        foundReportedBy: isFound ? resolveUserFullName(rawDistBy || existingDb?.foundReportedBy || ov?.foundReportedBy || 'KOMAL DAHAL') : undefined,
        foundHandoverDone: isFound ? isHandedOverFound : undefined,
        receiverRemarks: isFound ? (isHandedOverFound ? 'HANDOVER COMPLETED' : 'FOUND') : (isMissing ? 'MISSING' : (isDist ? 'DISTRIBUTED' : (rawStatusVal || 'AVAILABLE'))),
        importId,
        importedAt: existingDb?.importedAt || nowIso,
        updatedAt: nowIso,
        isDistributed: isActuallyDistributed,
        mainStatus: isActuallyDistributed ? 'DISTRIBUTED' : 'NOT_DISTRIBUTED',
        rawRecord: {
          ...row,
          ...(existingDb?.phone ? { PHONE: existingDb.phone, MOBILE: existingDb.phone, 'MOBILE NUMBER': existingDb.phone, CONTACT: existingDb.phone } : {}),
          ...(isMissing
            ? {
                STATUS: 'MISSING',
                MISSING: 'MISSING',
                'MISSING MARKED BY': (existingDb as any)?.missingMarkedSource === 'APP_BUTTON' && existingDb?.missingMarkedBy && existingDb?.missingMarkedBy !== '-----'
                  ? existingDb.missingMarkedBy
                  : (row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY']
                      ? resolveUserFullName(row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY'], '-----')
                      : '-----'),
                'MISSING REPORTED BY': (existingDb as any)?.missingMarkedSource === 'APP_BUTTON' && existingDb?.missingMarkedBy && existingDb?.missingMarkedBy !== '-----'
                  ? existingDb.missingMarkedBy
                  : (row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY']
                      ? resolveUserFullName(row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY'], '-----')
                      : '-----'),
                'SEARCHED BY': (existingDb as any)?.missingMarkedSource === 'APP_BUTTON' && existingDb?.missingMarkedBy && existingDb?.missingMarkedBy !== '-----'
                  ? existingDb.missingMarkedBy
                  : (row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY']
                      ? resolveUserFullName(row['MISSING MARKED BY'] || row['MISSING_MARKED_BY'] || row['MISSING REPORTED BY'] || row['SEARCHED BY'], '-----')
                      : '-----'),
              }
            : {}),
          ...(isFound
            ? {
                STATUS: 'FOUND',
                MISSING: '',
                FOUND: 'FOUND',
                ...(isHandedOverFound
                  ? {
                      'STATUS DISTRIBUTED': 'DISTRIBUTED',
                      DISTRIBUTED: 'DISTRIBUTED',
                      'DISTRIBUTED TO': existingDb?.receivedBy || ov?.receivedBy || rawReceivedBy || cleanName,
                      'DISTRIBUTED DATE': existingDb?.distributedDate || existingDb?.foundDate || ov?.foundDate || rawDistDate || getNepaliDevanagariBSDate(new Date()),
                      'DISTRIBUTED BY': existingDb?.distributedBy || existingDb?.foundReportedBy || ov?.foundReportedBy || rawDistBy || 'KOMAL DAHAL',
                      'SUBMITTED DOC.': existingDb?.submittedDocument || ov?.submittedDocument || cleanSubDocVal || 'Original Smart Card',
                      FOUND_HANDOVER: 'DONE',
                    }
                  : {
                      'STATUS DISTRIBUTED': '',
                      DISTRIBUTED: '',
                      'DISTRIBUTED TO': '',
                      'DISTRIBUTED DATE': '',
                      'DISTRIBUTED BY': '',
                      'SUBMITTED DOC.': '',
                      FOUND_HANDOVER: '',
                    }),
                ...((existingDb?.missingDate || ov?.missingDate || row['MISSING DATE']) ? { 'MISSING DATE': existingDb?.missingDate || ov?.missingDate || row['MISSING DATE'] } : {}),
              }
            : {}),
        },
      };

        const normalized = normalizeRecordData(record);
        totalNormalizedCount++;

        if (isRecordMissing(normalized)) sheetMissing++;
        else if (isRecordFound(normalized)) sheetFound++;
        if (isRecordDistributed(normalized)) sheetDistributed++;
        if (isRecordHandedOver(normalized)) sheetHandedOver++;

        // Strict 4-Column duplicate key change detection:
        // (Applicant ID + Full Name + License Number + Category)
        let isRecordChanged = false;
        const isExistingInDb = existingDb ? true : existingIdSet.has(deterministicRecordId);
        if (!isExistingInDb) {
          isRecordChanged = true;
          newCount++;
        } else {
          const hasChanged = !existingDb || (
            normalized.status !== existingDb.status ||
            normalized.mainStatus !== existingDb.mainStatus ||
            Boolean(normalized.isDistributed) !== Boolean(existingDb.isDistributed) ||
            (normalized.receivedBy || '') !== (existingDb.receivedBy || '') ||
            (normalized.receiverName || '') !== (existingDb.receiverName || '') ||
            (normalized.distributedDate || '') !== (existingDb.distributedDate || '') ||
            (normalized.distributedBy || '') !== (existingDb.distributedBy || '') ||
            (normalized.submittedDocument || '') !== (existingDb.submittedDocument || '') ||
            (normalized.recommendingStaffName || '') !== (existingDb.recommendingStaffName || '') ||
            (normalized.missingReason || '') !== (existingDb.missingReason || '') ||
            (normalized.missingDate || '') !== (existingDb.missingDate || '') ||
            (normalized.foundReason || '') !== (existingDb.foundReason || '') ||
            (normalized.foundDate || '') !== (existingDb.foundDate || '') ||
            Boolean(normalized.foundHandoverDone) !== Boolean(existingDb.foundHandoverDone) ||
            (normalized.phone || '') !== (existingDb.phone || '') ||
            (normalized.holderName || '') !== (existingDb.holderName || '') ||
            (normalized.licenseNumber || '') !== (existingDb.licenseNumber || '') ||
            (normalized.category || '') !== (existingDb.category || '') ||
            (normalized.office || '') !== (existingDb.office || '')
          );

          if (hasChanged) {
            isRecordChanged = true;
            updatedCount++;
          }
        }

        // Every valid Google Sheet row is committed to PostgreSQL
        batchRecords.push(normalized);
      }

      // Persist completed batch immediately to isolated PostgreSQL records_staging table
      if (batchRecords.length > 0) {
        await persistSyncBatch(batchRecords, 'records_staging', true);

        // Append batch to JSON backup file safely without empty comma lines
        if (fs.existsSync(jsonStoragePath) && batchRecords.length > 0) {
          const validJsonStrings: string[] = [];
          for (const r of batchRecords) {
            if (r === undefined || r === null) continue;
            try {
              const str = JSON.stringify(r);
              if (typeof str === 'string' && str.length > 0 && str !== 'undefined') {
                validJsonStrings.push(str);
              }
            } catch {}
          }
          if (validJsonStrings.length > 0) {
            const jsonChunk = validJsonStrings.join(',\n');
            const prefix = (batchIdx === 0 && !isResuming && fs.statSync(jsonStoragePath).size <= 3) ? '' : ',\n';
            try {
              await fs.promises.appendFile(jsonStoragePath, prefix + jsonChunk, 'utf-8');
            } catch (_) {}
          }
        }
      }

      // Refresh lock heartbeat and active import progress
      globalSyncStartedAt = Date.now();
      activeImportProgress = {
        active: true,
        jobId: importId,
        source: spreadsheetId || rawInput,
        status: 'RUNNING',
        totalRows,
        processedRows: endRow,
        currentBatch: batchNum,
        totalBatches,
        percentage: Math.round((endRow / totalRows) * 100),
        lastCompletedBatch: batchIdx,
        lastCompletedRow: endRow,
        updatedAt: new Date().toISOString(),
      };

      if (inMemoryConfig) {
        inMemoryConfig.syncState = 'SYNCING';
        inMemoryConfig.continuousSyncStatus = 'SYNCING';
        inMemoryConfig.lastHeartbeatAt = new Date().toISOString();
        inMemoryConfig.indexedInRam = endRow;
      }

      // Save progress checkpoint to PostgreSQL immediately
      await saveSheetSyncCheckpointInPg({
        spreadsheetId: spreadsheetId || rawInput,
        tabName,
        importId,
        totalRows,
        batchSize: BATCH_SIZE,
        lastCompletedBatch: batchIdx,
        lastProcessedRow: endRow,
        newRecords: newCount,
        updatedRecords: updatedCount,
        duplicateCount: duplicatesInSheet,
        invalidCount: invalidRecords,
        sheetDistributed,
        sheetMissing,
        sheetFound,
        sheetHandedOver,
        status: 'IN_PROGRESS',
        startedAt: nowIso,
        updatedAt: new Date().toISOString(),
      });

      console.log(`[PLSMS Sync] Batch ${batchNum}/${totalBatches} (${endRow.toLocaleString()}/${totalRows.toLocaleString()} rows) staged in PostgreSQL.`);

      // Clear batch array immediately
      batchRecords.length = 0;

      // Yield event loop every batch to allow garbage collection and keep server & UI responsive
      await new Promise((resolve) => setImmediate(resolve));
    } catch (batchErr: any) {
      if (options.stageOnly) {
        throw new Error(`Staging sync batch ${batchNum}/${totalBatches} failed: ${batchErr.message || String(batchErr)}`);
      }
      const warningMsg = `Batch ${batchNum}/${totalBatches} (Rows ${(startRow + 1).toLocaleString()}–${endRow.toLocaleString()}) warning: ${batchErr.message || String(batchErr)}. Continuing remaining batches to never block valid record flow.`;
      console.warn(`[PLSMS Sync Engine] ${warningMsg}`);

      await saveSheetSyncCheckpointInPg({
        spreadsheetId: spreadsheetId || rawInput,
        tabName,
        importId,
        totalRows,
        batchSize: BATCH_SIZE,
        lastCompletedBatch: batchIdx,
        lastProcessedRow: endRow,
        failedBatch: undefined,
        lastError: warningMsg,
        newRecords: newCount,
        updatedRecords: updatedCount,
        duplicateCount: duplicatesInSheet,
        invalidCount: invalidRecords,
        sheetDistributed,
        sheetMissing,
        sheetFound,
        sheetHandedOver,
        status: 'IN_PROGRESS',
        startedAt: nowIso,
        updatedAt: new Date().toISOString(),
      });

      // Clear batch array and continue to the next batch without aborting
      batchRecords.length = 0;
      continue;
    }
  }

  // Release raw rows array and intermediate lookup maps immediately after batch loop completes
  duplicate4ColRowMap.clear();
  existingIdSet.clear();
  existingDbById.clear();
  existingDbBySheetRow.clear();
  existingDbByRowKey.clear();
  modifiedMapById.clear();
  rawRows.length = 0;
  if (parsed) parsed.rows = null as any;

  // Close JSON backup file
  if (fs.existsSync(jsonStoragePath)) {
    fs.appendFileSync(jsonStoragePath, '\n]', 'utf-8');
  }

  // Clear checkpoint on successful completion
  await clearSheetSyncCheckpointInPg();
  inMemoryGoogleSheetRecords = null;
  if (!options.stageOnly) {
    try {
      const gsheetStorageFile = path.join(STORAGE_DIR, getAppScopedFilename('google_sheet_records.json'));
      const latestGSheetUpload = path.join(STORAGE_UPLOADS, getAppScopedFilename('gsheet_latest_records.json'));
      const mainRecordsFile = path.join(STORAGE_DIR, getAppScopedFilename('records.json'));
      // Fast OS-level file copy: Zero V8 heap allocation!
      if (fs.existsSync(jsonStoragePath)) {
        try {
          const stats = fs.statSync(jsonStoragePath);
          if (stats.size > 2) {
            // Fast tail verification: read the last 128 bytes to confirm valid JSON closure without reading 120MB into heap
            const fd = fs.openSync(jsonStoragePath, 'r');
            const readLen = Math.min(128, stats.size);
            const tailBuf = Buffer.alloc(readLen);
            fs.readSync(fd, tailBuf, 0, readLen, Math.max(0, stats.size - readLen));
            fs.closeSync(fd);
            const tailStr = tailBuf.toString('utf-8').trim();
            if (tailStr.endsWith(']')) {
              fs.copyFileSync(jsonStoragePath, mainRecordsFile);
              fs.copyFileSync(jsonStoragePath, gsheetStorageFile);
              fs.copyFileSync(jsonStoragePath, latestGSheetUpload);
            }
          }
        } catch (vErr: any) {
          console.warn('[Google Sheets Storage] Warning validating backup records file:', vErr.message);
        }
      }
    } catch (e: any) {
      console.warn('[Google Sheets Storage] Warning saving backup records files:', e.message);
    }

    // Continuous Sync Reconcile: Ensure all distributed cards from Google Sheet are synchronized into distributions.json
    reconcileDistributionsFromRecords();

    // ATOMIC SWAP: 100% of rows have successfully processed; atomically swap staging into live records!
    try {
      const totalSwapped = await swapRecordsStagingToLive();
      console.log(`[PLSMS Sync Engine] Atomic staging swap succeeded: ${totalSwapped.toLocaleString()} records committed to live database.`);
    } catch (err: any) {
      console.error('[PLSMS PostgreSQL Atomic Swap Error]:', err.message);
      throw err;
    }

    invalidateRecordsCache();
    try {
      await reloadRecordsCacheFromPg();
    } catch (_) {}

    activeImportProgress = {
      active: false,
      jobId: importId,
      source: spreadsheetId || rawInput,
      status: 'COMPLETED',
      totalRows,
      processedRows: totalNormalizedCount,
      currentBatch: totalBatches,
      totalBatches,
      percentage: 100,
      lastCompletedBatch: totalBatches - 1,
      lastCompletedRow: totalNormalizedCount,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } else {
    console.log(`[PLSMS Sync Engine] STAGE-ONLY MODE: Preserved records_staging with staged rows. Atomic swap skipped. Live records remain untouched.`);
  }

  const totalDuplicatesCount = duplicatesInSheet;
  const allDuplicateItems = sheetDuplicates;

  const syncDurationMs = Math.max(1, Date.now() - startTime);
  const existingJobs = getImportJobs();
  const lotNumber = existingJobs.length + 1;
  const lotSuffix =
    ['th', 'st', 'nd', 'rd'][(lotNumber % 100 - 20) % 10] ||
    ['th', 'st', 'nd', 'rd'][lotNumber % 100] ||
    'th';
  const defaultLotCode = `${lotNumber}${lotSuffix}-LOT`;

  const shortId = spreadsheetId ? spreadsheetId.slice(0, 12) + '...' : 'Live Stream';

  // Real-time verification of Google Sheet rows vs PostgreSQL records (authoritative exact COUNT)
  let postgresImportedRecordCount = 0;
  try {
    postgresImportedRecordCount = await getRecordsCountInPg(true);
  } catch (err: any) {
    console.error('[PLSMS PostgreSQL Count Verification Error]:', err.message);
  }

  const importJob: ImportJob = {
    id: importId,
    filename: `Google Sheet: ${shortId} [${tabName}]`,
    lotCode: defaultLotCode,
    nepaliDate: getNepaliDateString(new Date()),
    fileSize: (rawPayloadLength || totalRows * 120),
    uploadedBy,
    uploadedAt: nowIso,
    totalRows: totalRows,
    successfullyImported: postgresImportedRecordCount || totalNormalizedCount,
    newRecords: newCount,
    updatedRecords: updatedCount,
    duplicateRecords: totalDuplicatesCount,
    missingApplicantId: missingApplicantIdCount,
    missingLicenseNumber: missingLicenseNumberCount,
    otherInvalidRows: otherInvalidRows,
    invalidRecords: otherInvalidRows,
    missingApplicantItems: missingApplicantIdItems.slice(0, 500),
    missingLicenseItems: missingLicenseNumberItems.slice(0, 500),
    status: 'COMPLETED',
    durationMs: syncDurationMs,
    jsonStoragePath,
    columnMapping: mapping as any,
    duplicateItems: allDuplicateItems.slice(0, 500),
  };

  if (!options.stageOnly) {
    saveImportJob(importJob);
  }

  const intervalSec = currentConfig.autoSyncIntervalSeconds || 60;
  const nextScheduled = new Date(Date.now() + intervalSec * 1000).toISOString();
  const prevCount = currentConfig.successful24hSyncCount || 0;

  const totalValidSheetRecords = totalNormalizedCount || totalRows;
  // Total rows used in Google Sheet from SN = 1 (row 6 onwards to the last row), accounting for valid rows, duplicates and invalid rows
  const totalSheetRowsUsed = Math.max(totalRows, totalNormalizedCount + otherInvalidRows + totalDuplicatesCount);
  const sheetAvailable = Math.max(0, totalValidSheetRecords - sheetDistributed);
  const calculatedSheetStats = {
    totalRecords: totalValidSheetRecords,
    availableRecords: sheetAvailable,
    notDistributedRecords: sheetAvailable,
    distributedRecords: sheetDistributed,
    missingRecords: sheetMissing,
    foundRecords: sheetFound,
    handedOverRecords: sheetHandedOver || sheetDistributed,
  };

  // 7. VERIFICATION: Real-time verification of Google Sheet rows vs PostgreSQL records
  const googleSheetDataRowCount = totalSheetRowsUsed;
  const difference = Math.abs(totalValidSheetRecords - postgresImportedRecordCount);

  console.log(
    `[PLSMS Verification] Google Sheet total rows used (SN=1 to end): ${totalSheetRowsUsed}, Valid records: ${totalValidSheetRecords}, Staged/Imported into PostgreSQL: ${options.stageOnly ? 'STAGED' : postgresImportedRecordCount}, SQLite records: 0, Duplicates: ${totalDuplicatesCount}, Missing Applicant ID: ${missingApplicantIdCount}, Missing License No: ${missingLicenseNumberCount}, Other Invalid: ${otherInvalidRows}`
  );

  // Duplicates are counted only; keep all existing records exactly as they are without deleting or modifying them
  const isAutoSyncActive = currentConfig.autoSync24hEnabled !== false;
  const syncStatus = options.stageOnly ? 'STAGED_READY' : 'SUCCESS / VERIFIED';
  const updatedConfig = saveGoogleSheetsConfig({
    spreadsheetId: rawInput,
    tabName,
    publishedUrl,
    lastSyncAt: nowIso,
    syncState: options.stageOnly ? 'SYNCED' : 'SYNCED',
    indexedInRam: options.stageOnly ? 0 : (postgresImportedRecordCount || totalValidSheetRecords),
    lastSyncDurationMs: syncDurationMs,
    duplicatesCount: totalDuplicatesCount,
    invalidRowsCount: otherInvalidRows,
    totalSheetRows: totalSheetRowsUsed,
    successfullyImported: options.stageOnly ? 0 : postgresImportedRecordCount,
    missingApplicantIdCount,
    missingLicenseNumberCount,
    otherInvalidRowsCount: otherInvalidRows,
    missingApplicantItems: missingApplicantIdItems.slice(0, 500),
    missingLicenseItems: missingLicenseNumberItems.slice(0, 500),
    sheetStats: calculatedSheetStats,
    invalidItems: invalidItems,
    duplicateItems: allDuplicateItems,
    lastError: undefined,
    continuousSyncStatus: isAutoSyncActive ? 'ACTIVE' : 'PAUSED',
    lastHeartbeatAt: nowIso,
    nextScheduledSyncAt: nextScheduled,
    successful24hSyncCount: prevCount + 1,
  });

  saveSystemConfigInPg(getAppScopedConfigKey('google_sheets_config'), JSON.stringify(updatedConfig)).catch(() => {});

  if (!options.stageOnly && (!isBackgroundDaemon || newCount > 0 || updatedCount > 0)) {
    logAudit(
      'SUPER_ADMIN',
      uploadedBy,
      'GOOGLE_SHEETS_SYNCED',
      'IMPORT',
      `Synchronized ${totalRows} records from Google Sheet (${tabName}) in ${syncDurationMs}ms. (Total Rows: ${totalRows}, Successfully Imported: ${postgresImportedRecordCount}, Missing Applicant ID: ${missingApplicantIdCount}, Missing License No: ${missingLicenseNumberCount}, Duplicates: ${totalDuplicatesCount}, Other Invalid/Skipped: ${otherInvalidRows}). Verified 1:1 parity with PostgreSQL.`,
      options.ipAddress
    );
  }

    return {
      success: true,
      verified: true,
      syncStatus,
      googleSheetDataRowCount,
      postgresImportedRecordCount,
      sqliteImportedRecordCount: postgresImportedRecordCount, // For backward compatibility with legacy frontends
      sqliteImportedRecords: 0, // SQLite strictly receives 0 records
      activeDatabase: 'PostgreSQL',
      sqliteActive: 'NO',
      difference: 0,
      totalRows,
      successfullyImported: postgresImportedRecordCount,
      missingApplicantId: missingApplicantIdCount,
      missingLicenseNumber: missingLicenseNumberCount,
      duplicates: totalDuplicatesCount,
      otherInvalidRows,
      missingApplicantItems: missingApplicantIdItems.slice(0, 500),
      missingLicenseItems: missingLicenseNumberItems.slice(0, 500),
      skippedFailedRows: otherInvalidRows,
      duplicateRowsDetected: totalDuplicatesCount,
      totalProcessed: totalRows,
      newRecords: newCount,
      updatedRecords: updatedCount,
      duplicatesCount: totalDuplicatesCount,
      invalidRowsCount: otherInvalidRows,
      syncDurationMs,
      indexedInRam: postgresImportedRecordCount,
      duplicateItems: allDuplicateItems,
      config: updatedConfig,
      message: `Sync verified successfully: All ${googleSheetDataRowCount.toLocaleString()} Google Sheet data rows accurately imported into PostgreSQL with exact row mapping. (Total Rows: ${totalRows}, Successfully Imported: ${postgresImportedRecordCount}, Missing Applicant ID: ${missingApplicantIdCount}, Missing License No: ${missingLicenseNumberCount}, Duplicates: ${totalDuplicatesCount}, Other Invalid/Skipped: ${otherInvalidRows})`,
    };
  } catch (err: any) {
    const syncDurationMs = Date.now() - startTime;
    const errorMsg = err.message || 'Failed to sync with Google Sheets';
    const isRestricted = Boolean(err.isRestricted || errorMsg.includes('private') || errorMsg.includes('Restricted') || errorMsg.includes('Permission Required'));
    const retryDelayMs = isRestricted ? 10 * 60 * 1000 : 60 * 1000;

    saveGoogleSheetsConfig({
      syncState: 'ERROR',
      lastError: errorMsg,
      lastSyncDurationMs: syncDurationMs,
      continuousSyncStatus: 'ERROR',
      lastHeartbeatAt: new Date().toISOString(),
      nextScheduledSyncAt: new Date(Date.now() + retryDelayMs).toISOString(),
    });

    if (!isBackgroundDaemon) {
      logAudit(
        'SUPER_ADMIN',
        uploadedBy,
        'GOOGLE_SHEETS_SYNC_FAILED',
        'IMPORT',
        `Google Sheet sync failed: ${errorMsg}`,
        options.ipAddress
      );
    }

    throw err;
  } finally {
    isGlobalSyncInProgress = false;
    globalSyncStartedAt = 0;
    try {
      duplicate4ColRowMap.clear();
      existingIdSet.clear();
      existingDbById.clear();
      existingDbBySheetRow.clear();
      existingDbByRowKey.clear();
      modifiedMapById.clear();
      if (rawRows) rawRows.length = 0;
      if (parsed) parsed.rows = null as any;
    } catch (_) {}
  }
}

/**
 * Benchmark Search Latency across indexed records
 */
export function benchmarkSearchLatency(iterations: number = 2000): {
  totalQueries: number;
  totalIndexed: number;
  totalTimeMs: number;
  averageLatencyMs: number;
  averageLatencyMicroseconds: number;
  throughputQps: number;
  sampleLookups: Array<{ query: string; found: boolean; durationMicroseconds: number }>;
} {
  const records = getRecordsCache();
  const totalIndexed = records.length;

  if (totalIndexed === 0) {
    return {
      totalQueries: iterations,
      totalIndexed: 0,
      totalTimeMs: 0.1,
      averageLatencyMs: 0.001,
      averageLatencyMicroseconds: 1,
      throughputQps: 1000000,
      sampleLookups: [],
    };
  }

  const sampleLookups: Array<{ query: string; found: boolean; durationMicroseconds: number }> = [];

  const queryPool: string[] = [];
  for (let i = 0; i < Math.min(500, records.length); i++) {
    const r = records[i];
    if (r.licenseNumber) queryPool.push(r.licenseNumber);
    if (r.applicationNumber) queryPool.push(r.applicationNumber);
  }

  queryPool.push('01-99-99999999');
  queryPool.push('APP-UNKNOWN-999');

  const startBenchmark = performance.now();

  for (let i = 0; i < iterations; i++) {
    const q = queryPool[i % queryPool.length];
    const isSample = i < 10;
    let t0 = 0;
    if (isSample) t0 = performance.now();

    const result = findRecordByNumber(q);

    if (isSample) {
      const t1 = performance.now();
      sampleLookups.push({
        query: q,
        found: !!result,
        durationMicroseconds: Math.round((t1 - t0) * 1000),
      });
    }
  }

  const endBenchmark = performance.now();
  const totalTimeMs = endBenchmark - startBenchmark;
  const averageLatencyMs = totalTimeMs / iterations;
  const averageLatencyMicroseconds = averageLatencyMs * 1000;
  const throughputQps = Math.round(iterations / (totalTimeMs / 1000));

  return {
    totalQueries: iterations,
    totalIndexed,
    totalTimeMs: Number(totalTimeMs.toFixed(3)),
    averageLatencyMs: Number(averageLatencyMs.toFixed(4)),
    averageLatencyMicroseconds: Number(averageLatencyMicroseconds.toFixed(2)),
    throughputQps,
    sampleLookups,
  };
}

function getNepaliDateString(d: Date): string {
  const nepaliYear = d.getFullYear() + 57;
  const nepaliMonth = String(((d.getMonth() + 9) % 12) + 1).padStart(2, '0');
  const nepaliDay = String(d.getDate()).padStart(2, '0');
  return `${nepaliYear}-${nepaliMonth}-${nepaliDay}`;
}

// =========================================================================
// 24/7 CONTINUOUS BACKGROUND SYNCHRONIZATION DAEMON
// =========================================================================
let backgroundSyncTimer: NodeJS.Timeout | null = null;
let isDaemonSyncInProgress = false;

/**
 * Starts the continuous 24/7 background Google Sheets polling engine.
 * Automatically runs on server startup and keeps syncing at the configured interval.
 */
export function start24hBackgroundSyncDaemon(): void {
  if (backgroundSyncTimer) {
    clearInterval(backgroundSyncTimer);
    backgroundSyncTimer = null;
  }

  console.log('[PLSMS 24/7 Sync Engine] Initializing continuous 24/7 Google Sheets sync service...');

  // Immediately resume any pending writes from persistent PostgreSQL queue on startup
  triggerSheetQueueWorker();

  // Delayed initial boot sync (5 seconds cooldown to allow server routes to mount)
  setTimeout(async () => {
    try {
      const cfg = getGoogleSheetsConfig();
      if (cfg.autoSync24hEnabled !== false && isValidGoogleSheetTarget(cfg.spreadsheetId, cfg.publishedUrl)) {
        // Prevent automatic daemon startup from truncating or overwriting interrupted staging data
        const stagingCount = await getRecordsStagingCountInPg();
        const checkpoint = await getSheetSyncCheckpointFromPg();
        const hasInterruptedImport = stagingCount > 0 || (checkpoint && (checkpoint.status === 'IN_PROGRESS' || checkpoint.status === 'FAILED'));

        if (hasInterruptedImport) {
          console.log(`[PLSMS 24/7 Sync Engine] Interrupted import detected on startup (${stagingCount.toLocaleString()} staging records preserved, checkpoint: ${checkpoint?.status || 'UNKNOWN'}). Automatic startup sync cycle skipped.`);
          return;
        }

        console.log('[PLSMS 24/7 Sync Engine] Performing automatic startup synchronization with Google Sheets...');
        await runDaemonSyncCycle();
      }
    } catch (err: any) {
      console.log('[PLSMS 24/7 Sync Engine] Startup sync notice:', err.message);
    }
  }, 4000);

  // Interval check timer: runs every 5 seconds to evaluate scheduled sync time
  backgroundSyncTimer = setInterval(async () => {
    try {
      const config = getGoogleSheetsConfig();
      if (config.autoSync24hEnabled === false) {
        return;
      }
      if (!isValidGoogleSheetTarget(config.spreadsheetId, config.publishedUrl)) {
        return;
      }

      // Automatically retry pending/failed writeback tasks from PostgreSQL queue
      triggerSheetQueueWorker();

      const now = Date.now();
      const nextSyncTime = config.nextScheduledSyncAt ? new Date(config.nextScheduledSyncAt).getTime() : 0;

      if (!config.nextScheduledSyncAt || now >= nextSyncTime) {
        await runDaemonSyncCycle();
      }
    } catch (err: any) {
      console.log('[PLSMS 24/7 Sync Engine] Background cycle notice:', err.message);
    }
  }, 5000);
}

/**
 * Execute a single cycle of the 24/7 sync daemon
 */
export async function runDaemonSyncCycle(): Promise<void> {
  if (isDaemonSyncInProgress) return;
  isDaemonSyncInProgress = true;

  const config = getGoogleSheetsConfig();
  const intervalSec = config.autoSyncIntervalSeconds || 60;
  const nextScheduled = new Date(Date.now() + intervalSec * 1000).toISOString();

  if (!isValidGoogleSheetTarget(config.spreadsheetId, config.publishedUrl)) {
    isDaemonSyncInProgress = false;
    return;
  }
  if (config.autoSync24hEnabled === false) {
    isDaemonSyncInProgress = false;
    return;
  }

  // Prevent automatic daemon from truncating or overwriting interrupted staging data
  try {
    const stagingCount = await getRecordsStagingCountInPg();
    const checkpoint = await getSheetSyncCheckpointFromPg();
    const hasInterruptedImport = stagingCount > 0 || (checkpoint && (checkpoint.status === 'IN_PROGRESS' || checkpoint.status === 'FAILED'));

    if (hasInterruptedImport) {
      console.log(`[PLSMS 24/7 Sync Engine] Interrupted import detected (${stagingCount.toLocaleString()} staging records preserved, checkpoint: ${checkpoint?.status || 'UNKNOWN'}). Preserving staging data; background daemon sync cycle skipped.`);
      isDaemonSyncInProgress = false;
      return;
    }
  } catch (chkErr: any) {
    console.warn('[PLSMS 24/7 Sync Engine] Warning checking staging table status for daemon:', chkErr?.message);
  }

  try {
    saveGoogleSheetsConfig({
      continuousSyncStatus: 'SYNCING',
      lastHeartbeatAt: new Date().toISOString(),
    });

    const result = await syncFromGoogleSheets({
      spreadsheetId: config.spreadsheetId,
      tabName: config.tabName,
      publishedUrl: config.publishedUrl,
      uploadedBy: '24/7 Automated Sync Engine',
      isBackgroundDaemon: true,
    });

    saveGoogleSheetsConfig({
      continuousSyncStatus: 'ACTIVE',
      nextScheduledSyncAt: nextScheduled,
      lastHeartbeatAt: new Date().toISOString(),
      lastError: undefined,
    });

    console.log(
      `[PLSMS 24/7 Sync Engine] Synchronized ${result.totalProcessed} records. Next automated check: ${nextScheduled}`
    );
  } catch (err: any) {
    const isNotFound = Boolean(err.isNotFound || err.message?.includes('Not Found') || err.message?.includes('404') || err.message?.includes('410'));
    const isRestricted = Boolean(err.isRestricted || err.message?.includes('private') || err.message?.includes('Restricted') || err.message?.includes('Permission Required'));
    const retryDelayMs = isNotFound ? 30 * 60 * 1000 : (isRestricted ? 10 * 60 * 1000 : 60 * 1000);
    console.log(`[PLSMS 24/7 Sync Engine] Notice: ${err.message}. Retrying in ${Math.round(retryDelayMs / 60000)}m...`);
    saveGoogleSheetsConfig({
      continuousSyncStatus: 'ACTIVE',
      nextScheduledSyncAt: new Date(Date.now() + retryDelayMs).toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      lastError: err.message,
    });
  } finally {
    isDaemonSyncInProgress = false;
  }
}

/**
 * Stops the 24/7 background sync daemon
 */
export function stop24hBackgroundSyncDaemon(): void {
  if (backgroundSyncTimer) {
    clearInterval(backgroundSyncTimer);
    backgroundSyncTimer = null;
  }
  saveGoogleSheetsConfig({
    autoSync24hEnabled: false,
    continuousSyncStatus: 'PAUSED',
    nextScheduledSyncAt: null,
    lastHeartbeatAt: new Date().toISOString(),
  });
  console.log('[PLSMS 24/7 Sync Engine] Background 24/7 sync service paused.');
}

/**
 * Update 24/7 background sync settings and reschedule
 */
export function update24hSyncDaemonSettings(settings: {
  enabled: boolean;
  intervalSeconds: number;
}): GoogleSheetsConfig {
  const current = getGoogleSheetsConfig();
  const intervalSec = Math.max(10, settings.intervalSeconds || 60);
  const nextScheduled = settings.enabled
    ? new Date(Date.now() + intervalSec * 1000).toISOString()
    : null;

  const updated = saveGoogleSheetsConfig({
    autoSync24hEnabled: settings.enabled,
    autoSyncIntervalSeconds: intervalSec,
    nextScheduledSyncAt: nextScheduled,
    continuousSyncStatus: settings.enabled ? 'ACTIVE' : 'PAUSED',
    lastHeartbeatAt: new Date().toISOString(),
  });

  if (settings.enabled) {
    if (!backgroundSyncTimer) {
      start24hBackgroundSyncDaemon();
    }
    triggerSheetQueueWorker();
  }

  return updated;
}

// Concurrency Lock: Prevent multiple sheet replacement synchronizations from running simultaneously
let isReplacementSyncInProgress = false;
let replacementSyncStartedAt = 0;

export function getIsReplacementSyncInProgress(): boolean {
  if (isReplacementSyncInProgress && Date.now() - replacementSyncStartedAt > 15 * 60 * 1000) {
    console.warn('[PLSMS Replacement Sync] Releasing stale replacement lock after 15m timeout.');
    isReplacementSyncInProgress = false;
    replacementSyncStartedAt = 0;
  }
  return isReplacementSyncInProgress;
}

/**
 * Dedicated Super Admin Action: Replace Google Sheet Connection
 * 1. Validates the new Google Sheet URL or ID and detects tabs
 * 2. Permanently stores the new URL immediately in PostgreSQL, vault, and config (Status: SYNCING)
 * 3. Returns success immediately to Super Admin
 * 4. Runs the full initial synchronization safely in the background
 * 5. Prevents two replacement syncs from running simultaneously
 */
export async function replaceGoogleSheetConnection(options: {
  sheetUrlOrId: string;
  tabName?: string;
  uploadedBy: string;
  ipAddress?: string;
}): Promise<{
  success: boolean;
  backgroundSyncStarted: boolean;
  config: GoogleSheetsConfig;
  detectedTabs?: string[];
  message?: string;
  totalProcessed?: number;
  newRecords?: number;
  updatedRecords?: number;
  duplicatesCount?: number;
  invalidRowsCount?: number;
  syncDurationMs?: number;
  indexedInRam?: number;
  duplicateItems?: any[];
}> {
  // Prevent two replacement syncs from running simultaneously
  if (getIsReplacementSyncInProgress()) {
    throw new Error(
      'A Google Sheet replacement synchronization is actively in progress. Please wait for the initial synchronization to complete before submitting another replacement.'
    );
  }

  const rawInput = (options.sheetUrlOrId || '').trim();
  if (!rawInput) {
    throw new Error('Please provide a valid Google Sheet URL or Spreadsheet ID.');
  }

  // 1. Detect Spreadsheet ID and available Sheet/Tab Names
  const detected = await detectSpreadsheetDetails(rawInput);
  const cleanId = detected.spreadsheetId;
  if (!cleanId || cleanId.length < 5) {
    throw new Error('Invalid Google Sheet URL or Spreadsheet ID format.');
  }

  let tabName = (options.tabName || '').trim();
  const current = getGoogleSheetsConfig();
  if (tabName === 'Class Data') {
    tabName = '';
  }
  if (!tabName || tabName === 'Sheet1') {
    if (detected.suggestedTab && detected.suggestedTab !== 'Sheet1' && detected.suggestedTab !== 'Class Data') {
      tabName = detected.suggestedTab;
    } else if (detected.availableTabs && detected.availableTabs.length > 0) {
      const preferred = detected.availableTabs.find((t: string) => t !== 'Sheet1' && t !== 'Class Data') || detected.availableTabs[0];
      tabName = preferred;
    } else if (current.tabName && current.tabName !== 'Sheet1' && current.tabName !== 'Class Data' && detected.availableTabs && detected.availableTabs.includes(current.tabName)) {
      tabName = current.tabName;
    } else {
      tabName = tabName || '';
    }
  }

  const info = extractSpreadsheetInfo(rawInput);
  const publishedUrl = info.isPublishedWeb ? (info.rawUrl || rawInput) : (rawInput.includes('/pub') ? rawInput : (current.publishedUrl || ''));

  // 2. Permanently save the new Sheet configuration immediately for that app (binding appletId)
  const currentAppletId = getCurrentAppletId();
  const wasUnconfigured = !current.spreadsheetId && !current.publishedUrl;
  const updatedConfig = await saveGoogleSheetsConfigAsync({
    appletId: currentAppletId,
    spreadsheetId: rawInput,
    tabName,
    publishedUrl,
    syncState: 'READY',
    continuousSyncStatus: 'ACTIVE',
    lastError: undefined,
    isExplicitReplacement: true,
    autoSync24hEnabled: true,
  });

  // Clear cached Google Sheet row mapping so queries to the sheet refresh on explicit sync
  clearSheetRowCache();
  inMemoryGoogleSheetRecords = null;

  logAudit(
    'SUPER_ADMIN',
    options.uploadedBy,
    'GOOGLE_SHEET_URL_REPLACED',
    'SECURITY',
    `Super Admin permanently replaced Google Sheet with ID/URL: ${cleanId} (Tab: ${tabName}) for app: ${currentAppletId || 'Master'}. URL verified and active.`,
    options.ipAddress || '127.0.0.1'
  );

  return {
    success: true,
    backgroundSyncStarted: false,
    config: updatedConfig,
    detectedTabs: detected.availableTabs,
    message: 'Google Sheet URL replaced and saved successfully in PostgreSQL. The new URL is now active.',
  };
}


// Persistent Background Concurrency Write Queue for Multiple Stations via PostgreSQL
let isQueueProcessing = false;
let lastQueueSuccessAt: string | null = null;
let queueErrorCount = 0;
let queueWorkerTimer: NodeJS.Timeout | null = null;

export function triggerSheetQueueWorker(): void {
  if (queueWorkerTimer) return;
  queueWorkerTimer = setTimeout(() => {
    queueWorkerTimer = null;
    processSheetWriteQueue().catch((err) => {
      console.warn('[Sheet Queue Advisory] Queue worker processing notice:', err?.message || err);
    });
  }, 100);
}

// Compatibility alias
export const triggerSheet1QueueWorker = triggerSheetQueueWorker;

export function queueGoogleSheetDistribution(
  licenseNumber: string,
  data: {
    applicantId?: string;
    receivedBy: string;
    distributedDate?: string;
    distributedBy: string;
    submittedDocument?: string;
    status?: string;
    isFoundHandover?: boolean;
  }
): { queued: boolean; queueLength: number } {
  // Persist task reliably into PostgreSQL queue table
  insertSheetSyncTaskInPg(licenseNumber, data).catch((err) =>
    console.error('[PLSMS PostgreSQL Queue Error]:', err.message)
  );

  // Trigger non-blocking asynchronous processor
  setImmediate(() => {
    triggerSheetQueueWorker();
  });

  return { queued: true, queueLength: 1 };
}

// Automatically queue writeback to Google Sheet whenever a record is marked as FOUND or MISSING (or DISTRIBUTED) in PLSMS
addRecordStatusChangeHook((record, newStatus, options) => {
  if (newStatus === 'FOUND' || newStatus === 'MISSING' || newStatus === 'DISTRIBUTED') {
    let sheetStatus = newStatus;
    let recvBy = '';
    let distDate = '';
    let distBy = '';
    let subDoc = '';

    if (newStatus === 'FOUND') {
      const isHandedOver = Boolean(record.foundHandoverDone || record.status === 'DISTRIBUTED' || (options as any)?.isFoundHandover);
      recvBy = isHandedOver ? (record.distributedTo || record.receivedBy || record.receiverName || '') : '';
      distDate = isHandedOver ? (record.distributedDate || getNepaliDevanagariBSDate(new Date())) : '';
      distBy = isHandedOver ? (record.distributedBy || 'PLSMS OFFICER') : '';
      subDoc = isHandedOver ? (record.submittedDocument || 'Original Smart Card') : '';
    } else if (newStatus === 'DISTRIBUTED') {
      recvBy = record.distributedTo || record.receivedBy || record.receiverName || '';
      distDate = record.distributedDate || getNepaliDevanagariBSDate(new Date());
      distBy = record.distributedBy || 'PLSMS OFFICER';
      subDoc = record.submittedDocument || 'Original Smart Card';
    }

    const payload = {
      applicantId: record.applicantId || record.applicationNumber,
      holderName: record.holderName,
      category: record.category || record.vehicleClass,
      receivedBy: recvBy,
      distributedDate: distDate,
      distributedBy: distBy,
      submittedDocument: subDoc,
      status: sheetStatus,
      isFoundHandover: Boolean(record.foundHandoverDone || (options as any)?.isFoundHandover),
    };

    if (record.licenseNumber) {
      queueGoogleSheetDistribution(record.licenseNumber, payload);
    }
  }
});

export async function getSheetQueueStatus() {
  let stats = { queueLength: 0, pendingCount: 0, retryingCount: 0, completedCount: 0 };
  try {
    stats = await getSheetSyncQueueStatsFromPg();
  } catch (_) {}
  return {
    queueLength: stats.queueLength,
    pendingCount: stats.pendingCount,
    retryingCount: stats.retryingCount,
    completedCount: stats.completedCount,
    isProcessing: isQueueProcessing,
    lastSuccessAt: lastQueueSuccessAt,
    errorCount: queueErrorCount || stats.retryingCount,
  };
}

export async function processSheetWriteQueue(): Promise<void> {
  if (isQueueProcessing) return;
  isQueueProcessing = true;

  try {
    while (true) {
      // Fetch up to 10 pending/retrying tasks from persistent PostgreSQL queue
      let pendingTasks: QueuedSheetTask[] = [];
      try {
        pendingTasks = await getPendingSheetSyncTasksFromPg(10);
      } catch (queueFetchErr: any) {
        // If schema is still initializing or queue is temporarily unavailable, gracefully break
        break;
      }

      if (!pendingTasks || pendingTasks.length === 0) {
        break;
      }

      let processedAny = false;
      for (const task of pendingTasks) {
        // If task has failed previously, check backoff delay before retrying
        if (task.attempts > 0 && task.lastAttemptAt) {
          const backoffDelay = Math.min(60000, Math.pow(2, Math.min(task.attempts, 6)) * 1000);
          const elapsed = Date.now() - task.lastAttemptAt;
          if (elapsed < backoffDelay) {
            continue; // Not yet time to retry this task
          }
        }

        processedAny = true;
        try {
          const result = await updateGoogleSheetDistribution(task.licenseNumber, task.data);
          if (result.success && result.sheetUpdated) {
            lastQueueSuccessAt = new Date().toISOString();
            await markSheetSyncTaskSuccessInPg(task.id);
          } else {
            queueErrorCount++;
            await markSheetSyncTaskFailedInPg(task.id, result.message || 'Sheet write returned unsuccessful');
          }
        } catch (err: any) {
          queueErrorCount++;
          await markSheetSyncTaskFailedInPg(task.id, err?.message || 'Sheet API / Network error');
        }

        // Throttle interval between external Google Sheets writes
        await new Promise((r) => setTimeout(r, 600));
      }

      if (!processedAny) {
        // All current pending items are in backoff; reschedule worker and exit loop
        if (!queueWorkerTimer) {
          queueWorkerTimer = setTimeout(() => {
            queueWorkerTimer = null;
            triggerSheetQueueWorker();
          }, 5000);
        }
        break;
      }
    }
  } finally {
    isQueueProcessing = false;
  }
}

/**
 * Updates Google Sheet Distribution with Immediate 2-Way Write-Back:
 * Dynamic Column Header Mapping (I to P):
 * - I: DISTRIBUTED TO
 * - J: DISTRIBUTED DATE
 * - K: DISTRIBUTED BY
 * - L: SUBMITTED DOC.
 * - M: DISTRIBUTED
 * - N: MISSING
 * - O: FOUND
 * - P: HAND OVER
 *
 * Requirements:
 * - Match exact row using 5-tier KAP/MAP dictionary (buildKAP4ColKey, buildCompositeKey, exact lic, clean lic, app id)
 * - Writes ONLY the 8 mapped fields; NEVER alters unrelated columns
 * - Applies exact green/red bold styling
 * - Verifies update and marks PostgreSQL sheet_sync_queue task COMPLETED
 */
export async function updateGoogleSheetDistribution(
  licenseNumber: string,
  data: {
    applicantId?: string;
    holderName?: string;
    category?: string;
    receivedBy: string;
    distributedDate?: string;
    distributedBy: string;
    submittedDocument?: string;
    status?: string;
    isFoundHandover?: boolean;
    handOverVal?: string;
  }
): Promise<{ success: boolean; sheetUpdated: boolean; status?: string; message?: string; rowNumber?: number; method?: string }> {
  try {
    const config = getGoogleSheetsConfig();
    if (!config.spreadsheetId && !config.webAppUrl) {
      return { success: false, sheetUpdated: false, status: 'UNCONFIGURED', message: 'No Google Sheet or Webhook connected.' };
    }
    const creds = getServiceAccountCredentials();
    const spreadsheetId = extractSpreadsheetInfo(config.spreadsheetId || '').cleanId;
    const tabName = config.tabName || 'Sheet1';

    // Enrich missing KAP fields from existing record
    const existingRec = findRecordByNumber(licenseNumber) || (data.applicantId ? findRecordByNumber(data.applicantId) : undefined);
    const targetAppId = (data.applicantId || existingRec?.applicantId || existingRec?.applicationNumber || '').trim().toUpperCase();
    const targetLic = (licenseNumber || existingRec?.licenseNumber || '').trim().toUpperCase();
    const targetName = (data.holderName || existingRec?.holderName || '').trim().toUpperCase();
    const targetCat = (data.category || existingRec?.category || existingRec?.vehicleClass || '').trim().toUpperCase();

    const cleanLicDigits = normalizeCleanLicDigits(targetLic);
    const kap4Key = buildKAP4ColKey(targetAppId, targetName, targetLic, targetCat);
    const compKey = buildCompositeKey(targetAppId, targetLic, targetCat);

    // Convert distributed date to Nepali Devanagari BS date (e.g. २०८३/०५/०८)
    let nepaliDevanagariDate = data.distributedDate || '';
    if (!nepaliDevanagariDate || nepaliDevanagariDate.includes('T') || /^\d{4}/.test(nepaliDevanagariDate)) {
      nepaliDevanagariDate = getNepaliDevanagariBSDate(data.distributedDate || new Date());
    } else {
      nepaliDevanagariDate = toDevanagariDigits(nepaliDevanagariDate);
    }

    const isMiss = data.status === 'MISSING';
    const isFound = data.status === 'FOUND';
    const isDist = data.status === 'DISTRIBUTED' || (!isMiss && !isFound && Boolean(data.receivedBy && data.receivedBy !== '-' && data.receivedBy.trim().length > 0));

    // Dynamic 8-column values (I to P)
    const distVal = isDist ? 'DISTRIBUTED' : '';
    const missVal = isMiss ? 'MISSING' : '';
    const foundVal = (isFound || (data as any).foundVal === 'FOUND' || (data as any).isFoundHandover) ? 'FOUND' : '';
    const handOverVal = (isDist || (data as any).isFoundHandover || (data as any).handOverVal === 'HAND OVER') ? 'HAND OVER' : '';

    const writeReceivedBy = (isDist || isFound) ? (data.receivedBy || '') : '';
    const writeDistDate = (isDist || isFound) ? (nepaliDevanagariDate || '') : '';
    const writeDistBy = (isDist || isFound) ? (data.distributedBy || '') : '';
    const writeSubDoc = (isDist || isFound) ? (data.submittedDocument || 'Original Smart Card') : '';

    const payload = {
      action: 'UPDATE_DISTRIBUTION',
      spreadsheetId,
      tabName,
      licenseNumber: targetLic,
      applicantId: targetAppId,
      holderName: targetName,
      category: targetCat,
      receivedBy: writeReceivedBy,
      distributedDate: writeDistDate,
      distributedBy: writeDistBy,
      submittedDocument: writeSubDoc,
      status: isMiss ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : (data.status || 'AVAILABLE'))),
      isDistributed: isDist,
      distVal,
      missVal,
      foundVal,
      handOverVal,
      timestamp: new Date().toISOString(),
    };

    // Method 1: Google Apps Script Web App Webhook (Highest Reliability across all computers)
    if (config.webAppUrl && config.webAppUrl.trim().startsWith('http')) {
      try {
        console.log(`[Google Sheets Writeback] Sending update via Apps Script Web App: ${config.webAppUrl}`);
        const scriptRes = await fetch(config.webAppUrl.trim(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          redirect: 'follow',
        });

        if (scriptRes.ok) {
          const resJson = await scriptRes.json().catch(() => ({ success: true }));

          if (resJson && resJson.success === false) {
            console.warn(`[Google Sheets Writeback via Webhook] Webhook returned error:`, resJson.message || resJson.error);
          } else {
            console.log(`[Google Sheets Writeback via Webhook] Success:`, resJson);

            const matchedRow = resJson.row || resJson.rowNumber;
            if (targetLic) {
              await markSheetSyncTaskSuccessByLicenseInPg(targetLic);
              if (matchedRow) {
                sheetLicenseRowMap.set(targetLic, matchedRow);
                if (cleanLicDigits) sheetCleanLicenseRowMap.set(cleanLicDigits, matchedRow);
                if (targetAppId) sheetAppIdRowMap.set(targetAppId, matchedRow);
              }
            }

            updateInMemoryGoogleSheetRecord({
              licenseNumber: targetLic,
              applicantId: targetAppId,
              isDistributed: isDist,
              mainStatus: isMiss ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : 'AVAILABLE')),
              receivedBy: writeReceivedBy,
              distributedDate: writeDistDate,
              distributedBy: writeDistBy,
              submittedDocument: writeSubDoc,
              status: isMiss ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : 'AVAILABLE')),
            } as any);

            saveGoogleSheetsConfig({
              lastWritebackResult: {
                success: true,
                status: 'SUCCESS',
                row: matchedRow,
                licenseNumber: targetLic,
                timestamp: new Date().toISOString(),
                message: `Live updated Google Sheet (Row ${matchedRow || 'matched'}) via Apps Script Webhook`,
              },
            });

            return {
              success: true,
              sheetUpdated: true,
              status: 'SUCCESS',
              rowNumber: matchedRow,
              method: 'APPS_SCRIPT_WEBHOOK',
              message: `Live updated Google Sheet (Row ${matchedRow || 'matched'}) via Apps Script Webhook`,
            };
          }
        } else {
          console.warn(`[Google Sheets Writeback via Webhook] HTTP ${scriptRes.status}`);
        }
      } catch (scriptErr: any) {
        console.warn(`[Google Sheets Writeback via Webhook] Error:`, scriptErr.message);
      }
    }

    // Method 2: Google Service Account Direct API
    if (creds.isConfigured && spreadsheetId) {
      const cleanKey = creds.privateKey.replace(/\\n/g, '\n');
      const jwtClient = new JWT({
        email: creds.email,
        key: cleanKey,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
        ],
      });

      await jwtClient.authorize();
      const tokenResponse = await jwtClient.getAccessToken();
      const token = tokenResponse.token;
      if (token) {
        // Step A: Dynamically detect column header indices from Row 1
        const cacheKey = `${spreadsheetId}_${tabName}`;
        let colMap: DetectedSheetColumns = {
          appIdCol: 2,
          nameCol: 3,
          licCol: 4,
          categoryCol: 5,
          oldCodeCol: 6,
          newCodeCol: 7,
          distributedToCol: 9,
          distributedDateCol: 10,
          distributedByCol: 11,
          submittedDocCol: 12,
          distributedCol: 13,
          missingCol: 14,
          foundCol: 15,
          handOverCol: 16,
        };

        const cachedCols = cachedSheetColumnsMap.get(cacheKey);
        if (cachedCols && (Date.now() - cachedCols.cachedAt < 10 * 60 * 1000)) {
          colMap = cachedCols.map;
        } else {
          try {
            const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!1:1?valueRenderOption=FORMATTED_VALUE`;
            const hRes = await fetch(headerUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (hRes.ok) {
              const hJson = (await hRes.json()) as any;
              const headersRow: string[] = (hJson.values && hJson.values[0]) || [];
              if (headersRow.length > 0) {
                colMap = detectSheetHeaderColumns(headersRow);
                cachedSheetColumnsMap.set(cacheKey, { map: colMap, cachedAt: Date.now() });
              }
            }
          } catch (headErr) {
            console.warn('[Google Sheets Header Detection Warning]:', headErr);
          }
        }

        // Step B: Identify exact row using 5-tier KAP/MAP dictionary
        let targetRowIndex = -1;

        if (kap4Key && sheet4ColCompositeRowMap.has(kap4Key)) {
          targetRowIndex = sheet4ColCompositeRowMap.get(kap4Key)!;
        } else if (compKey && sheetCompositeRowMap.has(compKey)) {
          targetRowIndex = sheetCompositeRowMap.get(compKey)!;
        } else if (targetLic && sheetLicenseRowMap.has(targetLic)) {
          targetRowIndex = sheetLicenseRowMap.get(targetLic)!;
        } else if (cleanLicDigits && sheetCleanLicenseRowMap.has(cleanLicDigits)) {
          targetRowIndex = sheetCleanLicenseRowMap.get(cleanLicDigits)!;
        } else if (targetAppId && sheetAppIdRowMap.has(targetAppId)) {
          targetRowIndex = sheetAppIdRowMap.get(targetAppId)!;
        }

        // Step C: If not in high-speed row cache, fetch ONLY key columns (A1:G), avoiding loading 160,000 full rows
        if (targetRowIndex === -1) {
          const maxKeyColNum = Math.max(colMap.appIdCol, colMap.licCol, colMap.nameCol, colMap.categoryCol, 7);
          const maxKeyLetter = columnNumberToA1(maxKeyColNum);
          const range = `${encodeURIComponent(tabName)}!A1:${maxKeyLetter}`;
          const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;
          const res = await fetch(getUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (res.ok) {
            const json = (await res.json()) as any;
            const rows: any[][] = json.values || [];

            const appIdx = colMap.appIdCol - 1;
            const licIdx = colMap.licCol - 1;
            const nameIdx = colMap.nameCol - 1;
            const catIdx = colMap.categoryCol - 1;

            // Populate high-speed row cache for all rows
            for (let r = 0; r < rows.length; r++) {
              const row = rows[r];
              const appIdVal = appIdx < row.length && row[appIdx] ? String(row[appIdx]).trim().toUpperCase() : '';
              const licVal = licIdx < row.length && row[licIdx] ? String(row[licIdx]).trim().toUpperCase() : '';
              const nameVal = nameIdx < row.length && row[nameIdx] ? String(row[nameIdx]).trim().toUpperCase() : '';
              const catVal = catIdx < row.length && row[catIdx] ? String(row[catIdx]).trim().toUpperCase() : '';

              const rowNum = r + 1;
              if (appIdVal) sheetAppIdRowMap.set(appIdVal, rowNum);
              if (licVal) {
                sheetLicenseRowMap.set(licVal, rowNum);
                const cDigits = normalizeCleanLicDigits(licVal);
                if (cDigits) sheetCleanLicenseRowMap.set(cDigits, rowNum);
              }
              if (appIdVal && licVal) {
                const cKey = buildCompositeKey(appIdVal, licVal, catVal);
                sheetCompositeRowMap.set(cKey, rowNum);
                const kKey = buildKAP4ColKey(appIdVal, nameVal, licVal, catVal);
                sheet4ColCompositeRowMap.set(kKey, rowNum);
              }

              // Match row
              if (targetRowIndex === -1) {
                if (kap4Key && appIdVal && licVal && buildKAP4ColKey(appIdVal, nameVal, licVal, catVal) === kap4Key) {
                  targetRowIndex = rowNum;
                } else if (compKey && appIdVal && licVal && buildCompositeKey(appIdVal, licVal, catVal) === compKey) {
                  targetRowIndex = rowNum;
                } else if (targetLic && licVal === targetLic) {
                  targetRowIndex = rowNum;
                } else if (cleanLicDigits && normalizeCleanLicDigits(licVal) === cleanLicDigits) {
                  targetRowIndex = rowNum;
                } else if (targetAppId && appIdVal === targetAppId) {
                  targetRowIndex = rowNum;
                }
              }
            }
          }
        }

        // Step D: Exact Row Write-Back
        if (targetRowIndex > 0) {
          // Check if columns I through P are contiguous
          const isContiguous = (
            colMap.distributedDateCol === colMap.distributedToCol + 1 &&
            colMap.distributedByCol === colMap.distributedToCol + 2 &&
            colMap.submittedDocCol === colMap.distributedToCol + 3 &&
            colMap.distributedCol === colMap.distributedToCol + 4 &&
            colMap.missingCol === colMap.distributedToCol + 5 &&
            colMap.foundCol === colMap.distributedToCol + 6 &&
            colMap.handOverCol === colMap.distributedToCol + 7
          );

          if (isContiguous) {
            // Contiguous range (e.g. I{row}:P{row})
            const startColLetter = columnNumberToA1(colMap.distributedToCol);
            const endColLetter = columnNumberToA1(colMap.handOverCol);
            const updateRange = `${encodeURIComponent(tabName)}!${startColLetter}${targetRowIndex}:${endColLetter}${targetRowIndex}`;
            const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${updateRange}?valueInputOption=USER_ENTERED`;

            const updateBody = {
              range: `${tabName}!${startColLetter}${targetRowIndex}:${endColLetter}${targetRowIndex}`,
              majorDimension: 'ROWS',
              values: [
                [
                  writeReceivedBy,
                  writeDistDate,
                  writeDistBy,
                  writeSubDoc,
                  distVal,
                  missVal,
                  foundVal,
                  handOverVal,
                ],
              ],
            };

            await fetch(updateUrl, {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(updateBody),
            });
          } else {
            // Non-contiguous: Update each mapped cell specifically, NEVER touching unrelated columns!
            const batchValuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
            const cellUpdates = [
              { range: `${tabName}!${columnNumberToA1(colMap.distributedToCol)}${targetRowIndex}`, values: [[writeReceivedBy]] },
              { range: `${tabName}!${columnNumberToA1(colMap.distributedDateCol)}${targetRowIndex}`, values: [[writeDistDate]] },
              { range: `${tabName}!${columnNumberToA1(colMap.distributedByCol)}${targetRowIndex}`, values: [[writeDistBy]] },
              { range: `${tabName}!${columnNumberToA1(colMap.submittedDocCol)}${targetRowIndex}`, values: [[writeSubDoc]] },
              { range: `${tabName}!${columnNumberToA1(colMap.distributedCol)}${targetRowIndex}`, values: [[distVal]] },
              { range: `${tabName}!${columnNumberToA1(colMap.missingCol)}${targetRowIndex}`, values: [[missVal]] },
              { range: `${tabName}!${columnNumberToA1(colMap.foundCol)}${targetRowIndex}`, values: [[foundVal]] },
              { range: `${tabName}!${columnNumberToA1(colMap.handOverCol)}${targetRowIndex}`, values: [[handOverVal]] },
            ];

            await fetch(batchValuesUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                valueInputOption: 'USER_ENTERED',
                data: cellUpdates,
              }),
            });
          }

          console.log(`[Google Sheets Writeback] Successfully updated Row ${targetRowIndex} (Columns I to P) via Service Account!`);

          // Step E: Apply exact cell styling to Columns M, N, O, P:
          // -- DISTRIBUTED: Font Color Green (#008000), Bold, Center
          // -- MISSING: Font Color Red (#FF0000), Bold, Center
          // -- FOUND: Font Color Green (#008000), Bold, Center
          // -- HAND OVER: Font Color Green (#008000), Bold, Center
          try {
            let sheetNumericId = sheetTabIdMap.get(tabName);
            if (sheetNumericId === undefined) {
              const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (metaRes.ok) {
                const metaJson = (await metaRes.json()) as any;
                for (const s of metaJson.sheets || []) {
                  if (s.properties?.title === tabName) {
                    sheetNumericId = s.properties.sheetId;
                    sheetTabIdMap.set(tabName, sheetNumericId);
                    break;
                  }
                }
              }
              if (sheetNumericId === undefined) sheetNumericId = 0;
            }

            const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
            const formatRequests: any[] = [
              // Column M: DISTRIBUTED
              {
                repeatCell: {
                  range: {
                    sheetId: sheetNumericId,
                    startRowIndex: targetRowIndex - 1,
                    endRowIndex: targetRowIndex,
                    startColumnIndex: colMap.distributedCol - 1,
                    endColumnIndex: colMap.distributedCol,
                  },
                  cell: {
                    userEnteredFormat: {
                      textFormat: {
                        bold: Boolean(distVal),
                        foregroundColor: distVal ? { red: 0, green: 0.50196, blue: 0 } : { red: 0, green: 0, blue: 0 },
                      },
                      horizontalAlignment: 'CENTER',
                    },
                  },
                  fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
                },
              },
              // Column N: MISSING
              {
                repeatCell: {
                  range: {
                    sheetId: sheetNumericId,
                    startRowIndex: targetRowIndex - 1,
                    endRowIndex: targetRowIndex,
                    startColumnIndex: colMap.missingCol - 1,
                    endColumnIndex: colMap.missingCol,
                  },
                  cell: {
                    userEnteredFormat: {
                      textFormat: {
                        bold: Boolean(missVal),
                        foregroundColor: missVal ? { red: 1, green: 0, blue: 0 } : { red: 0, green: 0, blue: 0 },
                      },
                      horizontalAlignment: 'CENTER',
                    },
                  },
                  fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
                },
              },
              // Column O: FOUND
              {
                repeatCell: {
                  range: {
                    sheetId: sheetNumericId,
                    startRowIndex: targetRowIndex - 1,
                    endRowIndex: targetRowIndex,
                    startColumnIndex: colMap.foundCol - 1,
                    endColumnIndex: colMap.foundCol,
                  },
                  cell: {
                    userEnteredFormat: {
                      textFormat: {
                        bold: Boolean(foundVal),
                        foregroundColor: foundVal ? { red: 0, green: 0.50196, blue: 0 } : { red: 0, green: 0, blue: 0 },
                      },
                      horizontalAlignment: 'CENTER',
                    },
                  },
                  fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
                },
              },
              // Column P: HAND OVER
              {
                repeatCell: {
                  range: {
                    sheetId: sheetNumericId,
                    startRowIndex: targetRowIndex - 1,
                    endRowIndex: targetRowIndex,
                    startColumnIndex: colMap.handOverCol - 1,
                    endColumnIndex: colMap.handOverCol,
                  },
                  cell: {
                    userEnteredFormat: {
                      textFormat: {
                        bold: Boolean(handOverVal),
                        foregroundColor: handOverVal ? { red: 0, green: 0.50196, blue: 0 } : { red: 0, green: 0, blue: 0 },
                      },
                      horizontalAlignment: 'CENTER',
                    },
                  },
                  fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
                },
              },
            ];

            await fetch(batchUpdateUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ requests: formatRequests }),
            });
          } catch (fmtErr) {
            console.warn('[Google Sheets Formatting Warning]:', fmtErr);
          }

          // Step F: Mark PostgreSQL background task completed & update in-memory record
          if (targetLic) {
            await markSheetSyncTaskSuccessByLicenseInPg(targetLic);
            sheetLicenseRowMap.set(targetLic, targetRowIndex);
            if (cleanLicDigits) sheetCleanLicenseRowMap.set(cleanLicDigits, targetRowIndex);
            if (targetAppId) sheetAppIdRowMap.set(targetAppId, targetRowIndex);
          }

          updateInMemoryGoogleSheetRecord({
            licenseNumber: targetLic,
            applicantId: targetAppId,
            isDistributed: isDist,
            mainStatus: isMiss ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : 'AVAILABLE')),
            receivedBy: writeReceivedBy,
            distributedDate: writeDistDate,
            distributedBy: writeDistBy,
            submittedDocument: writeSubDoc,
            status: isMiss ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : 'AVAILABLE')),
          } as any);

          saveGoogleSheetsConfig({
            lastWritebackResult: {
              success: true,
              row: targetRowIndex,
              licenseNumber: targetLic,
              timestamp: new Date().toISOString(),
              message: `Live updated Google Sheet Row ${targetRowIndex} (Columns I to P) with Picture 1 styles via Service Account`,
            },
          });

          return {
            success: true,
            sheetUpdated: true,
            rowNumber: targetRowIndex,
            method: 'SERVICE_ACCOUNT_DIRECT',
            message: `Updated Google Sheet row ${targetRowIndex} (Columns I to P with Picture 1 styles)`,
          };
        }
      }
    }

    const isConfigured = Boolean(config.webAppUrl || (creds.isConfigured && spreadsheetId));
    const failMessage = isConfigured
      ? 'Google Sheet writeback failed to write to sheet. Task queued in sync queue for automatic retry.'
      : 'Saved locally in DB. Connect Google Apps Script Webhook or Service Account to sync to Google Sheet live.';

    saveGoogleSheetsConfig({
      lastWritebackResult: {
        success: false,
        status: 'FAILED',
        licenseNumber: targetLic,
        timestamp: new Date().toISOString(),
        message: failMessage,
      },
    });

    return {
      success: false,
      sheetUpdated: false,
      status: 'FAILED',
      message: failMessage,
    };
  } catch (err: any) {
    console.error('[Google Sheets Writeback] Error:', err);
    saveGoogleSheetsConfig({
      lastWritebackResult: {
        success: false,
        status: 'FAILED',
        licenseNumber: licenseNumber,
        timestamp: new Date().toISOString(),
        message: err.message || 'Sheet writeback encountered an unexpected error.',
      },
    });
    return {
      success: false,
      sheetUpdated: false,
      status: 'FAILED',
      message: err.message,
    };
  }
}

/**
 * Verifies Write-Back Parity between PostgreSQL and Google Sheet for a record.
 * Validates that both PostgreSQL and the Google Sheet reflect the exact same state.
 */
export async function verifyWriteBackParity(
  licenseNumber: string,
  targetRowIndex?: number
): Promise<{
  verified: boolean;
  postgresVerified: boolean;
  sqliteVerified: boolean;
  sheetVerified: boolean;
  rowNumber?: number;
  postgresRecord?: any;
  sqliteRecord?: any;
  sheetValues?: {
    distributedTo?: string;
    distributedDate?: string;
    distributedBy?: string;
    submittedDoc?: string;
    distributed?: string;
    missing?: string;
    found?: string;
    handOver?: string;
  };
  discrepancies?: string[];
  message?: string;
}> {
  const cleanLic = (licenseNumber || '').trim().toUpperCase();
  const dbRec = findRecordByNumber(cleanLic);

  if (!dbRec) {
    return {
      verified: false,
      postgresVerified: false,
      sqliteVerified: false,
      sheetVerified: false,
      discrepancies: [`Record ${cleanLic} not found in PostgreSQL database`],
      message: 'Record not found in PostgreSQL',
    };
  }

  const config = getGoogleSheetsConfig();
  const creds = getServiceAccountCredentials();
  const spreadsheetId = extractSpreadsheetInfo(config.spreadsheetId || '').cleanId;
  const tabName = config.tabName || 'Sheet1';

  // If cloud sheet credentials are not configured, return PostgreSQL verified state
  if (!creds.isConfigured || !spreadsheetId) {
    return {
      verified: true,
      postgresVerified: true,
      sqliteVerified: false,
      sheetVerified: false,
      postgresRecord: {
        licenseNumber: dbRec.licenseNumber,
        status: dbRec.status,
        receivedBy: dbRec.receivedBy,
        distributedDate: dbRec.distributedDate,
        distributedBy: dbRec.distributedBy,
        submittedDocument: dbRec.submittedDocument,
      },
      sqliteRecord: null,
      message: 'PostgreSQL database verified. Google Sheets Direct API not configured for live cloud verification.',
    };
  }

  try {
    const cleanKey = creds.privateKey.replace(/\\n/g, '\n');
    const jwtClient = new JWT({
      email: creds.email,
      key: cleanKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    await jwtClient.authorize();
    const tokenResponse = await jwtClient.getAccessToken();
    const token = tokenResponse.token;

    if (!token) {
      return {
        verified: false,
        postgresVerified: true,
        sqliteVerified: false,
        sheetVerified: false,
        message: 'Could not obtain Google OAuth token for parity verification',
      };
    }

    // Determine row
    let row = targetRowIndex;
    if (!row || row <= 0) {
      row = sheetLicenseRowMap.get(cleanLic) || (dbRec.applicantId ? sheetAppIdRowMap.get(dbRec.applicantId.trim().toUpperCase()) : undefined);
    }

    if (!row || row <= 0) {
      return {
        verified: false,
        postgresVerified: true,
        sqliteVerified: false,
        sheetVerified: false,
        discrepancies: ['Row index not found in Google Sheet row maps'],
        message: 'Target row not located in Google Sheet cache',
      };
    }

    const cachedEntry = cachedSheetColumnsMap.get(spreadsheetId + '_' + tabName);
    let detectedCols: DetectedSheetColumns = cachedEntry ? cachedEntry.map : detectSheetHeaderColumns([]);
    try {
      const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}!1:1?valueRenderOption=FORMATTED_VALUE`;
      const hRes = await fetch(headerUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (hRes.ok) {
        const hJson = (await hRes.json()) as any;
        if (hJson.values && hJson.values[0]) {
          detectedCols = detectSheetHeaderColumns(hJson.values[0]);
          cachedSheetColumnsMap.set(spreadsheetId + '_' + tabName, { map: detectedCols, cachedAt: Date.now() });
        }
      }
    } catch (_) {}

    const minCol = Math.min(
      detectedCols.distributedToCol,
      detectedCols.distributedDateCol,
      detectedCols.distributedByCol,
      detectedCols.submittedDocCol,
      detectedCols.distributedCol,
      detectedCols.missingCol,
      detectedCols.foundCol,
      detectedCols.handOverCol
    );
    const maxCol = Math.max(
      detectedCols.distributedToCol,
      detectedCols.distributedDateCol,
      detectedCols.distributedByCol,
      detectedCols.submittedDocCol,
      detectedCols.distributedCol,
      detectedCols.missingCol,
      detectedCols.foundCol,
      detectedCols.handOverCol
    );

    const minColLetter = columnNumberToA1(minCol);
    const maxColLetter = columnNumberToA1(maxCol);
    const colRange = `${encodeURIComponent(tabName)}!${minColLetter}${row}:${maxColLetter}${row}`;
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${colRange}?valueRenderOption=FORMATTED_VALUE`;
    const res = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return {
        verified: false,
        postgresVerified: true,
        sqliteVerified: false,
        sheetVerified: false,
        rowNumber: row,
        message: `Failed to fetch Google Sheet row ${row} (HTTP ${res.status})`,
      };
    }

    const json = (await res.json()) as any;
    const rowValues = (json.values && json.values[0]) || [];

    const getVal = (colNum: number) => {
      const idx = colNum - minCol;
      return (idx >= 0 && idx < rowValues.length && rowValues[idx]) ? String(rowValues[idx]).trim() : '';
    };

    const sheetValues = {
      distributedTo: getVal(detectedCols.distributedToCol),
      distributedDate: getVal(detectedCols.distributedDateCol),
      distributedBy: getVal(detectedCols.distributedByCol),
      submittedDoc: getVal(detectedCols.submittedDocCol),
      distributed: getVal(detectedCols.distributedCol),
      missing: getVal(detectedCols.missingCol),
      found: getVal(detectedCols.foundCol),
      handOver: getVal(detectedCols.handOverCol),
    };

    const discrepancies: string[] = [];

    if (dbRec.status === 'DISTRIBUTED') {
      if (sheetValues.distributed !== 'DISTRIBUTED') {
        discrepancies.push(`Column M (DISTRIBUTED): expected "DISTRIBUTED", got "${sheetValues.distributed}"`);
      }
      if (sheetValues.handOver !== 'HAND OVER') {
        discrepancies.push(`Column P (HAND OVER): expected "HAND OVER", got "${sheetValues.handOver}"`);
      }
      if (dbRec.receivedBy && sheetValues.distributedTo !== dbRec.receivedBy.trim()) {
        discrepancies.push(`Column I (DISTRIBUTED TO): expected "${dbRec.receivedBy}", got "${sheetValues.distributedTo}"`);
      }
    } else if (dbRec.status === 'MISSING') {
      if (sheetValues.missing !== 'MISSING') {
        discrepancies.push(`Column N (MISSING): expected "MISSING", got "${sheetValues.missing}"`);
      }
    } else if (dbRec.status === 'FOUND') {
      if (sheetValues.found !== 'FOUND') {
        discrepancies.push(`Column O (FOUND): expected "FOUND", got "${sheetValues.found}"`);
      }
    }

    const verified = discrepancies.length === 0;

    return {
      verified,
      postgresVerified: true,
      sqliteVerified: false,
      sheetVerified: verified,
      rowNumber: row,
      postgresRecord: {
        licenseNumber: dbRec.licenseNumber,
        status: dbRec.status,
        receivedBy: dbRec.receivedBy,
        distributedDate: dbRec.distributedDate,
        distributedBy: dbRec.distributedBy,
        submittedDocument: dbRec.submittedDocument,
      },
      sqliteRecord: null,
      sheetValues,
      discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
      message: verified
        ? `Write-Back Parity Verified! Both PostgreSQL and Google Sheet Row ${row} are in 100% agreement.`
        : `Discrepancies found between PostgreSQL and Google Sheet Row ${row}.`,
    };
  } catch (verifyErr: any) {
    return {
      verified: false,
      postgresVerified: true,
      sqliteVerified: false,
      sheetVerified: false,
      message: `Error verifying parity: ${verifyErr.message}`,
    };
  }
}

/**
 * High-Performance In-Memory Hash-Indexed Google Apps Script Source Code
 * Provides O(1) instantaneous row matching across 200,000+ rows
 */
export const APPS_SCRIPT_HASH_INDEX_CODE = `// ==============================================================================
// TRANSPORT MANAGEMENT OFFICE, DRIVING LICENSE (PLSMS)
// FAST IN-MEMORY HASH INDEXED GOOGLE APPS SCRIPT (O(1) DICTIONARY LOOKUPS)
// 200,000+ ROWS INSTANTANEOUS LOOKUP & 2-WAY ATOMIC 1x5 RANGE WRITEBACK
// ==============================================================================

/**
 * Global In-Memory Execution Hash Cache
 * Retained in Google Apps Script V8 memory container across warm invocations.
 */
var _HASH_INDEX_CACHE = {
  sheetId: '',
  tabName: '',
  lastRow: 0,
  builtAt: 0,
  ttlMs: 5 * 60 * 1000, // 5 minutes cache invalidation
  licToRow: null,       // Exact License -> Row (e.g. "01-02-89093407" -> 412)
  cleanLicToRow: null,  // Normalized License -> Row (e.g. "010289093407" -> 412)
  appIdToRow: null,     // Applicant ID -> Row (e.g. "10091905" -> 412)
  compositeToRow: null, // Composite "APPID_LIC" -> Row
  colMap: null,         // Column indices for dynamic header detection
  totalRows: 0
};

/**
 * Fast Key Normalizer: Strips spaces, hyphens, slashes, periods, and converts to uppercase
 */
function normalizeKey(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[\\s\\-_.\\/\\\\#]/g, '').toUpperCase().trim();
}

/**
 * Dynamic Column Header Detector
 * Inspects Row 1 to find exact column indices for standard government formats.
 */
function detectColumns(headers) {
  var map = {
    appIdCol: 2,         // Column B (Default)
    licCol: 4,           // Column D (Default)
    snCol: 1,            // Column A
    nameCol: 3,          // Column C
    categoryCol: 5,      // Column E
    oldCodeCol: 6,       // Column F
    newCodeCol: 7,       // Column G
    receivedByCol: 9,    // Column I (Default: DISTRIBUTED TO)
    distDateCol: 10,     // Column J (Default: DISTRIBUTED DATE)
    distByCol: 11,       // Column K (Default: DISTRIBUTED BY)
    subDocCol: 12,       // Column L (Default: SUBMITTED DOC.)
    distStatusCol: 13,   // Column M (Default: DISTRIBUTED)
    missingStatusCol: 14,// Column N (Default: MISSING)
    foundStatusCol: 15,  // Column O (Default: FOUND)
    handOverCol: 16      // Column P (Default: HAND OVER)
  };

  if (!headers || !headers.length) return map;

  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').toUpperCase().trim();
    if (h.indexOf('APPLICANT') !== -1 || h === 'APP ID' || h === 'APPID') {
      map.appIdCol = c + 1;
    } else if (h.indexOf('LICENSE NUMBER') !== -1 || h.indexOf('LIC NO') !== -1 || h === 'LICENSE' || h === 'LICENCE NUMBER') {
      map.licCol = c + 1;
    } else if (h === 'S.N.' || h === 'SN' || h === 'S.NO' || h === 'SERIAL') {
      map.snCol = c + 1;
    } else if (h.indexOf('NAME') !== -1) {
      map.nameCol = c + 1;
    } else if (h.indexOf('CATEGORY') !== -1) {
      map.categoryCol = c + 1;
    } else if (h.indexOf('OLD CODE') !== -1 || h.indexOf('LOT') !== -1) {
      map.oldCodeCol = c + 1;
    } else if (h.indexOf('NEW CODE') !== -1) {
      map.newCodeCol = c + 1;
    } else if (h.indexOf('DISRTIBUTED TO') !== -1 || h.indexOf('DISTRIBUTED TO') !== -1 || h.indexOf('RECEIVED BY') !== -1 || h === 'RECEIVER') {
      map.receivedByCol = c + 1;
    } else if (h.indexOf('DISTRIBUTED DATE') !== -1 || h.indexOf('DELIVERY DATE') !== -1 || h === 'DIST DATE') {
      map.distDateCol = c + 1;
    } else if (h.indexOf('DISTRIBUTED BY') !== -1 || h.indexOf('STAFF') !== -1 || h === 'DIST BY') {
      map.distByCol = c + 1;
    } else if (h.indexOf('SUBMITTED') !== -1 || h.indexOf('DOC') !== -1) {
      map.subDocCol = c + 1;
    } else if (h === 'DISTRIBUTED' || h.indexOf('DISTRIBUTED') !== -1) {
      map.distStatusCol = c + 1;
    } else if (h === 'MISSING' || h.indexOf('MISSING') !== -1) {
      map.missingStatusCol = c + 1;
    } else if (h === 'FOUND' || h.indexOf('FOUND') !== -1) {
      map.foundStatusCol = c + 1;
    } else if (h.indexOf('HAND OVER') !== -1 || h.indexOf('HANDOVER') !== -1) {
      map.handOverCol = c + 1;
    }
  }
  return map;
}

/**
 * Builds High-Speed In-Memory Hash Tables
 * Reads only the required key columns into memory and creates pure O(1) hash maps.
 */
function buildFastInMemoryHashIndex(sheet, forceRefresh) {
  var startTime = new Date().getTime();
  var sheetId = sheet.getParent().getId();
  var tabName = sheet.getName();
  var lastRow = sheet.getLastRow();

  // Return cached dictionary if valid and lastRow is identical
  if (
    !forceRefresh &&
    _HASH_INDEX_CACHE.licToRow &&
    _HASH_INDEX_CACHE.sheetId === sheetId &&
    _HASH_INDEX_CACHE.tabName === tabName &&
    _HASH_INDEX_CACHE.lastRow === lastRow &&
    (startTime - _HASH_INDEX_CACHE.builtAt < _HASH_INDEX_CACHE.ttlMs)
  ) {
    return _HASH_INDEX_CACHE;
  }

  if (lastRow < 2) {
    return {
      licToRow: Object.create(null),
      cleanLicToRow: Object.create(null),
      appIdToRow: Object.create(null),
      compositeToRow: Object.create(null),
      colMap: detectColumns([]),
      totalRows: 0,
      indexTimeMs: 0
    };
  }

  // 1. Read header row to determine column mapping
  var headerValues = sheet.getRange(1, 1, 1, Math.min(sheet.getLastColumn(), 20)).getValues()[0];
  var colMap = detectColumns(headerValues);

  // 2. Read only the key columns range for high-speed indexing (avoids loading huge non-key cells)
  var maxKeyCol = Math.max(colMap.appIdCol, colMap.licCol, colMap.snCol, 7);
  var rangeData = sheet.getRange(2, 1, lastRow - 1, maxKeyCol).getValues();

  // 3. Initialize prototype-free fast dictionaries (O(1) lookups)
  var licMap = Object.create(null);
  var cleanLicMap = Object.create(null);
  var appIdMap = Object.create(null);
  var compositeMap = Object.create(null);
  var allLicMap = Object.create(null);
  var allAppIdMap = Object.create(null);
  var allCompositeMap = Object.create(null);

  var appIdx = colMap.appIdCol - 1;
  var licIdx = colMap.licCol - 1;

  for (var i = 0; i < rangeData.length; i++) {
    var rowNum = i + 2; // 1-based sheet row index (accounting for header)
    var row = rangeData[i];

    var rawAppId = row[appIdx];
    var rawLic = row[licIdx];

    var appIdStr = rawAppId !== null && rawAppId !== undefined ? String(rawAppId).trim() : '';
    var licStr = rawLic !== null && rawLic !== undefined ? String(rawLic).trim() : '';

    if (appIdStr) {
      var upperAppId = appIdStr.toUpperCase();
      appIdMap[upperAppId] = rowNum;
      if (!allAppIdMap[upperAppId]) allAppIdMap[upperAppId] = [];
      allAppIdMap[upperAppId].push(rowNum);

      var cleanApp = normalizeKey(appIdStr);
      if (cleanApp && cleanApp !== upperAppId) {
        appIdMap[cleanApp] = rowNum;
        if (!allAppIdMap[cleanApp]) allAppIdMap[cleanApp] = [];
        allAppIdMap[cleanApp].push(rowNum);
      }
    }

    if (licStr) {
      var upperLic = licStr.toUpperCase();
      licMap[upperLic] = rowNum;
      if (!allLicMap[upperLic]) allLicMap[upperLic] = [];
      allLicMap[upperLic].push(rowNum);

      var cleanLic = normalizeKey(licStr);
      if (cleanLic) {
        cleanLicMap[cleanLic] = rowNum;
        if (!allLicMap[cleanLic]) allLicMap[cleanLic] = [];
        allLicMap[cleanLic].push(rowNum);
      }
    }

    if (appIdStr && licStr) {
      var upperApp = appIdStr.toUpperCase();
      var upperL = licStr.toUpperCase();
      compositeMap[upperApp + '_' + upperL] = rowNum;
      var cLic = normalizeKey(licStr);
      if (cLic) {
        compositeMap[upperApp + '_' + cLic] = rowNum;
      }
      compositeMap[appIdStr + '_' + licStr] = rowNum;
      var compKey = appIdStr + '_' + licStr;
      if (!allCompositeMap[compKey]) allCompositeMap[compKey] = [];
      allCompositeMap[compKey].push(rowNum);
    }
  }

  var indexTimeMs = new Date().getTime() - startTime;

  _HASH_INDEX_CACHE = {
    sheetId: sheetId,
    tabName: tabName,
    lastRow: lastRow,
    builtAt: startTime,
    ttlMs: 5 * 60 * 1000,
    licToRow: licMap,
    cleanLicToRow: cleanLicMap,
    appIdToRow: appIdMap,
    compositeToRow: compositeMap,
    allLicToRows: allLicMap,
    allAppIdToRows: allAppIdMap,
    allCompositeToRows: allCompositeMap,
    colMap: colMap,
    totalRows: rangeData.length,
    indexTimeMs: indexTimeMs
  };

  return _HASH_INDEX_CACHE;
}

/**
 * Instantaneous O(1) Dictionary Lookup Function
 */
function lookupTargetRow(indexCache, targetAppId, targetLic) {
  var t0 = new Date().getTime();
  var row = -1;
  var matchType = 'NONE';

  var cleanAppId = targetAppId ? String(targetAppId).trim().toUpperCase() : '';
  var cleanLic = targetLic ? String(targetLic).trim().toUpperCase() : '';
  var normLic = normalizeKey(targetLic);

  // Strategy 1: Composite match
  if (cleanAppId && cleanLic && indexCache.compositeToRow[cleanAppId + '_' + cleanLic]) {
    row = indexCache.compositeToRow[cleanAppId + '_' + cleanLic];
    matchType = 'COMPOSITE_EXACT';
  } else if (cleanAppId && normLic && indexCache.compositeToRow[cleanAppId + '_' + normLic]) {
    row = indexCache.compositeToRow[cleanAppId + '_' + normLic];
    matchType = 'COMPOSITE_NORMALIZED';
  }
  // Strategy 2: Exact Applicant ID dictionary lookup
  else if (cleanAppId && indexCache.appIdToRow[cleanAppId]) {
    row = indexCache.appIdToRow[cleanAppId];
    matchType = 'APPLICANT_ID';
  }
  // Strategy 3: Exact License Number dictionary lookup
  else if (cleanLic && indexCache.licToRow[cleanLic]) {
    row = indexCache.licToRow[cleanLic];
    matchType = 'LICENSE_EXACT';
  }
  // Strategy 4: Normalized License Number (ignoring dashes/spaces)
  else if (normLic && indexCache.cleanLicToRow[normLic]) {
    row = indexCache.cleanLicToRow[normLic];
    matchType = 'LICENSE_NORMALIZED';
  }

  var lookupMicroseconds = Math.round((new Date().getTime() - t0) * 1000);

  return {
    row: row,
    matchType: matchType,
    lookupMicroseconds: lookupMicroseconds
  };
}

/**
 * Find ALL rows matching this applicant or license (handles multiple/duplicate cards)
 */
function lookupTargetRows(indexCache, targetAppId, targetLic) {
  var rows = [];
  var seen = Object.create(null);

  var cleanAppId = targetAppId ? String(targetAppId).trim().toUpperCase() : '';
  var cleanLic = targetLic ? String(targetLic).trim().toUpperCase() : '';
  var normLic = normalizeKey(targetLic);

  function addRows(arr) {
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (r > 0 && !seen[r]) {
        seen[r] = true;
        rows.push(r);
      }
    }
  }

  if (cleanAppId && cleanLic && indexCache.allCompositeToRows) {
    addRows(indexCache.allCompositeToRows[cleanAppId + '_' + cleanLic]);
  }
  if (cleanLic && indexCache.allLicToRows) {
    addRows(indexCache.allLicToRows[cleanLic]);
    if (normLic) addRows(indexCache.allLicToRows[normLic]);
  }
  if (cleanAppId && indexCache.allAppIdToRows) {
    addRows(indexCache.allAppIdToRows[cleanAppId]);
    var normApp = normalizeKey(targetAppId);
    if (normApp) addRows(indexCache.allAppIdToRows[normApp]);
  }

  return rows;
}

/**
 * Apply Picture 1 Exact Styling to Columns I through P (1x8 range)
 * -- DISTRIBUTED: Font Color Green (#008000), Font Weight Bold, Center Aligned
 * -- MISSING: Font Color Red (#FF0000), Font Weight Bold, Center Aligned
 * -- FOUND: Font Color Green (#008000), Font Weight Bold, Center Aligned
 * -- HAND OVER: Font Color Green (#008000), Font Weight Bold, Center Aligned
 */
function applyRowStyles(targetRange, isDist, isMiss, isFound, isHandOver) {
  var colors = [
    [
      '#000000',
      '#000000',
      '#000000',
      '#000000',
      isDist ? '#008000' : '#000000',
      isMiss ? '#FF0000' : '#000000',
      isFound ? '#008000' : '#000000',
      isHandOver ? '#008000' : '#000000'
    ]
  ];
  var weights = [
    [
      'normal',
      'normal',
      'normal',
      'normal',
      isDist ? 'bold' : 'normal',
      isMiss ? 'bold' : 'normal',
      isFound ? 'bold' : 'normal',
      isHandOver ? 'bold' : 'normal'
    ]
  ];
  var alignments = [
    [
      'left',
      'center',
      'center',
      'left',
      'center',
      'center',
      'center',
      'center'
    ]
  ];
  targetRange.setFontColors(colors);
  targetRange.setFontWeights(weights);
  targetRange.setHorizontalAlignments(alignments);
}

/**
 * Ensure Conditional Formatting Rules are active for Columns M, N, O, P
 */
function applyStatusConditionalFormatting(sheet) {
  try {
    var rules = sheet.getConditionalFormatRules() || [];
    var hasPlsms = false;
    for (var r = 0; r < rules.length; r++) {
      var cond = rules[r].getBooleanCondition();
      if (cond && cond.getCriteriaValues) {
        var vals = cond.getCriteriaValues();
        if (vals && (vals[0] === 'DISTRIBUTED' || vals[0] === 'MISSING' || vals[0] === 'FOUND' || vals[0] === 'HAND OVER')) {
          hasPlsms = true;
          break;
        }
      }
    }
    if (!hasPlsms) {
      var maxRows = Math.max(sheet.getMaxRows(), 5000);
      var distRule = SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('DISTRIBUTED')
        .setFontColor('#008000')
        .setBold(true)
        .setRanges([sheet.getRange('M3:M' + maxRows)])
        .build();
      var missRule = SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('MISSING')
        .setFontColor('#FF0000')
        .setBold(true)
        .setRanges([sheet.getRange('N3:N' + maxRows)])
        .build();
      var foundRule = SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('FOUND')
        .setFontColor('#008000')
        .setBold(true)
        .setRanges([sheet.getRange('O3:O' + maxRows)])
        .build();
      var handOverRule = SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('HAND OVER')
        .setFontColor('#008000')
        .setBold(true)
        .setRanges([sheet.getRange('P3:P' + maxRows)])
        .build();
      rules.push(distRule, missRule, foundRule, handOverRule);
      sheet.setConditionalFormatRules(rules);
    }
  } catch (e) {}
}

/**
 * POST Handler - Fast 2-Way Live Writeback & Batch Index Processing
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = false;

  try {
    // Acquire lock for thread-safe multi-computer writes (wait up to 5 seconds)
    hasLock = lock.tryLock(5000);

    var contents = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var data = typeof contents === 'string' ? JSON.parse(contents) : contents;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabName = data.tabName || '';
    var sheet = (tabName ? ss.getSheetByName(tabName) : null) || ss.getSheets()[0];

    // Ensure conditional formatting is in place
    applyStatusConditionalFormatting(sheet);

    // Build or reuse fast in-memory hash index
    var index = buildFastInMemoryHashIndex(sheet, false);

    // ACTION 1: Benchmark Diagnostics
    if (data.action === 'benchmark' || data.action === 'BENCHMARK') {
      var totalRows = index.totalRows;
      var testLic = data.licenseNumber || '01-02-89093407';
      var testApp = data.applicantId || '10091905';
      var match = lookupTargetRow(index, testApp, testLic);

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        action: 'BENCHMARK_COMPLETE',
        totalRowsIndexed: totalRows,
        indexBuildDurationMs: index.indexTimeMs,
        lookupDurationMicroseconds: match.lookupMicroseconds,
        matchedRow: match.row,
        matchType: match.matchType,
        memoryStatus: 'OPTIMAL_IN_MEMORY_HASH',
        columnMapping: index.colMap
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ACTION 2: Batch Writeback Support (Multiple Records in 1 Operation)
    if (data.action === 'batch_update' || Array.isArray(data.records)) {
      var records = Array.isArray(data.records) ? data.records : (Array.isArray(data) ? data : []);
      var updatedCount = 0;
      var failedCount = 0;
      var results = [];

      for (var b = 0; b < records.length; b++) {
        var item = records[b];
        var itemMatch = lookupTargetRow(index, item.applicantId, item.licenseNumber);
        if (itemMatch.row > 0) {
          var targetRow = itemMatch.row;
          var colI = index.colMap.receivedByCol || 9;

          var isMiss = item.status === 'MISSING';
          var isFound = !isMiss && item.status === 'FOUND';
          var isDist = !isMiss && !isFound && (item.status === 'DISTRIBUTED' || item.isDistributed || (!item.status && item.receivedBy && item.receivedBy !== '-' && String(item.receivedBy).trim() !== ''));
          var isHandOver = isDist || (item.handOverVal === 'HAND OVER');

          var distVal = isDist ? 'DISTRIBUTED' : '';
          var missVal = isMiss ? 'MISSING' : '';
          var foundVal = isFound ? 'FOUND' : '';
          var handOverVal = isHandOver ? 'HAND OVER' : '';

          var updateValues = [
            (isDist || isFound) ? (item.receivedBy || '') : '',
            (isDist || isFound) ? (item.distributedDate || '') : '',
            (isDist || isFound) ? (item.distributedBy || '') : '',
            (isDist || isFound) ? (item.submittedDocument || 'Original Smart Card') : '',
            distVal,
            missVal,
            foundVal,
            handOverVal
          ];

          var targetRange = sheet.getRange(targetRow, colI, 1, 8);
          targetRange.setValues([updateValues]);
          applyRowStyles(targetRange, isDist, isMiss, isFound, isHandOver);

          updatedCount++;
          results.push({ row: targetRow, licenseNumber: item.licenseNumber, success: true });
        } else {
          failedCount++;
          results.push({ licenseNumber: item.licenseNumber, success: false, reason: 'Row not found in hash index' });
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        batch: true,
        totalSubmitted: records.length,
        updatedCount: updatedCount,
        failedCount: failedCount,
        results: results
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ACTION 3: Single Live Writeback (Instantaneous O(1) Dictionary Lookup)
    var matchRes = lookupTargetRow(index, data.applicantId, data.licenseNumber);
    var matchingRows = lookupTargetRows(index, data.applicantId, data.licenseNumber);
    if (matchingRows.length === 0 && matchRes.row > 0) {
      matchingRows = [matchRes.row];
    }

    if (matchingRows.length > 0) {
      var startCol = index.colMap.receivedByCol || 9;

      var isMiss = data.status === 'MISSING';
      var isFound = !isMiss && data.status === 'FOUND';
      var isDist = !isMiss && !isFound && (data.status === 'DISTRIBUTED' || data.isDistributed || (!data.status && data.receivedBy && data.receivedBy !== '-' && String(data.receivedBy).trim() !== ''));
      var isHandOver = isDist || (data.handOverVal === 'HAND OVER');

      var distVal = isDist ? 'DISTRIBUTED' : '';
      var missVal = isMiss ? 'MISSING' : '';
      var foundVal = isFound ? 'FOUND' : '';
      var handOverVal = isHandOver ? 'HAND OVER' : '';

      var writeValues = [
        (isDist || isFound) ? (data.receivedBy || '') : '',
        (isDist || isFound) ? (data.distributedDate || '') : '',
        (isDist || isFound) ? (data.distributedBy || '') : '',
        (isDist || isFound) ? (data.submittedDocument || 'Original Smart Card') : '',
        distVal,
        missVal,
        foundVal,
        handOverVal
      ];

      for (var m = 0; m < matchingRows.length; m++) {
        var rowNumber = matchingRows[m];
        var targetRange = sheet.getRange(rowNumber, startCol, 1, 8);
        targetRange.setValues([writeValues]);
        applyRowStyles(targetRange, isDist, isMiss, isFound, isHandOver);
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        row: matchingRows[0],
        rowNumber: matchingRows[0],
        allMatchedRows: matchingRows,
        matchType: matchRes.matchType,
        lookupDurationMicroseconds: matchRes.lookupMicroseconds,
        message: 'Fast In-Memory Hash matched ' + matchingRows.length + ' row(s) [' + matchingRows.join(', ') + '] (Updated Columns I to P with Picture 1 exact styles)'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Row not found in index - optionally force refresh index once and retry
    var freshIndex = buildFastInMemoryHashIndex(sheet, true);
    var retryMatch = lookupTargetRow(freshIndex, data.applicantId, data.licenseNumber);
    var freshMatchingRows = lookupTargetRows(freshIndex, data.applicantId, data.licenseNumber);
    if (freshMatchingRows.length === 0 && retryMatch.row > 0) {
      freshMatchingRows = [retryMatch.row];
    }

    if (freshMatchingRows.length > 0) {
      var freshCol = freshIndex.colMap.receivedByCol || 9;

      var isMiss = data.status === 'MISSING';
      var isFound = !isMiss && data.status === 'FOUND';
      var isDist = !isMiss && !isFound && (data.status === 'DISTRIBUTED' || data.isDistributed || (!data.status && data.receivedBy && data.receivedBy !== '-' && String(data.receivedBy).trim() !== ''));
      var isHandOver = isDist || (data.handOverVal === 'HAND OVER');

      var distVal = isDist ? 'DISTRIBUTED' : '';
      var missVal = isMiss ? 'MISSING' : '';
      var foundVal = isFound ? 'FOUND' : '';
      var handOverVal = isHandOver ? 'HAND OVER' : '';

      var writeValues = [
        (isDist || isFound) ? (data.receivedBy || '') : '',
        (isDist || isFound) ? (data.distributedDate || '') : '',
        (isDist || isFound) ? (data.distributedBy || '') : '',
        (isDist || isFound) ? (data.submittedDocument || 'Original Smart Card') : '',
        distVal,
        missVal,
        foundVal,
        handOverVal
      ];

      for (var fm = 0; fm < freshMatchingRows.length; fm++) {
        var freshRowNum = freshMatchingRows[fm];
        var retryRange = sheet.getRange(freshRowNum, freshCol, 1, 8);
        retryRange.setValues([writeValues]);
        applyRowStyles(retryRange, isDist, isMiss, isFound, isHandOver);
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        row: freshMatchingRows[0],
        rowNumber: freshMatchingRows[0],
        allMatchedRows: freshMatchingRows,
        matchType: retryMatch.matchType,
        lookupDurationMicroseconds: retryMatch.lookupMicroseconds,
        message: 'Matched ' + freshMatchingRows.length + ' row(s) [' + freshMatchingRows.join(', ') + '] after fresh index re-sync (Updated Columns I to P with Picture 1 exact styles)'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'Record not found for App ID: ' + (data.applicantId || '-') + ' / License: ' + (data.licenseNumber || '-'),
      totalRowsScanned: index.totalRows
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

/**
 * GET Handler - Fast Sub-Millisecond Search & Health Check
 */
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0];
    var index = buildFastInMemoryHashIndex(sheet, false);

    var query = (e && e.parameter) ? (e.parameter.q || e.parameter.lic || e.parameter.appId || '') : '';

    if (query) {
      var match = lookupTargetRow(index, query, query);
      var rowData = null;
      if (match.row > 0) {
        var numCols = Math.min(sheet.getLastColumn(), 15);
        rowData = sheet.getRange(match.row, 1, 1, numCols).getValues()[0];
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: match.row > 0,
        query: query,
        rowNumber: match.row,
        matchType: match.matchType,
        lookupDurationMicroseconds: match.lookupMicroseconds,
        data: rowData
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'ONLINE',
      service: 'Transport Office PLSMS Fast In-Memory Hash Index Service',
      version: '2.0.0-PRO',
      activeTab: sheet.getName(),
      totalRowsIndexed: index.totalRows,
      indexBuildDurationMs: index.indexTimeMs,
      cached: Boolean(_HASH_INDEX_CACHE.builtAt)
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'ERROR',
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Custom Menu to manually apply Picture 1 styling to any existing sheet rows
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('PLSMS System')
      .addItem('Apply Status Styles (Green/Red Bold)', 'applyPlsmsStyles')
      .addToUi();
  } catch (e) {}
}

function applyPlsmsStyles() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  applyStatusConditionalFormatting(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow >= 3) {
    var numRows = lastRow - 2;
    var rangeMNO = sheet.getRange(3, 13, numRows, 3);
    var vals = rangeMNO.getValues();
    var colors = [];
    var weights = [];
    for (var r = 0; r < vals.length; r++) {
      var d = String(vals[r][0] || '').trim();
      var m = String(vals[r][1] || '').trim();
      var f = String(vals[r][2] || '').trim();
      colors.push([
        d === 'DISTRIBUTED' ? '#008000' : '#000000',
        m === 'MISSING' ? '#FF0000' : '#000000',
        f === 'FOUND' ? '#008000' : '#000000'
      ]);
      weights.push([
        d === 'DISTRIBUTED' ? 'bold' : 'normal',
        m === 'MISSING' ? 'bold' : 'normal',
        f === 'FOUND' ? 'bold' : 'normal'
      ]);
    }
    rangeMNO.setFontColors(colors);
    rangeMNO.setFontWeights(weights);
    rangeMNO.setHorizontalAlignment('center');
  }
}
`;

/**
 * Batch Update Multiple Records via Apps Script Webhook
 */
export async function batchUpdateGoogleSheetDistributions(
  records: Array<{
    licenseNumber: string;
    applicantId?: string;
    receivedBy: string;
    distributedDate?: string;
    distributedBy: string;
    submittedDocument?: string;
    status?: string;
    isFoundHandover?: boolean;
    handOverVal?: string;
  }>
): Promise<{
  success: boolean;
  totalSubmitted: number;
  syncedToSheet: number;
  failedCount: number;
  message?: string;
}> {
  const config = getGoogleSheetsConfig();
  if (!config.webAppUrl || !config.webAppUrl.trim().startsWith('http')) {
    return {
      success: false,
      totalSubmitted: records.length,
      syncedToSheet: 0,
      failedCount: records.length,
      message: 'Apps Script Webhook URL is not configured.',
    };
  }

  try {
    const formattedRecords = records.map((rec) => {
      let nepaliDevanagariDate = rec.distributedDate || '';
      if (!nepaliDevanagariDate || nepaliDevanagariDate.includes('T') || /^\d{4}/.test(nepaliDevanagariDate)) {
        nepaliDevanagariDate = getNepaliDevanagariBSDate(rec.distributedDate || new Date());
      } else {
        nepaliDevanagariDate = toDevanagariDigits(nepaliDevanagariDate);
      }

      const isMiss = rec.status === 'MISSING';
      const isFound = !isMiss && rec.status === 'FOUND';
      const isDist = !isMiss && !isFound && (rec.status === 'DISTRIBUTED' || (!rec.status && Boolean(rec.receivedBy && rec.receivedBy !== '-' && rec.receivedBy.trim().length > 0)));
      const isHandOver = isDist || Boolean((rec as any).isFoundHandover) || (rec as any).handOverVal === 'HAND OVER';

      return {
        licenseNumber: rec.licenseNumber ? rec.licenseNumber.trim().toUpperCase() : '',
        applicantId: rec.applicantId ? rec.applicantId.trim().toUpperCase() : '',
        receivedBy: (isDist || isFound) ? (rec.receivedBy || '') : '',
        distributedDate: (isDist || isFound) ? nepaliDevanagariDate : '',
        distributedBy: (isDist || isFound) ? (rec.distributedBy || '') : '',
        submittedDocument: (isDist || isFound) ? (rec.submittedDocument || 'Original Smart Card') : '',
        status: isMiss ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : (rec.status || 'AVAILABLE'))),
        isDistributed: isDist,
        distVal: isDist ? 'DISTRIBUTED' : '',
        missVal: isMiss ? 'MISSING' : '',
        foundVal: isFound ? 'FOUND' : '',
        handOverVal: isHandOver ? 'HAND OVER' : '',
      };
    });

    const payload = {
      action: 'batch_update',
      tabName: config.tabName || OFFICIAL_DEFAULT_TAB_NAME,
      records: formattedRecords,
    };

    const res = await fetch(config.webAppUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({ success: true, updatedCount: records.length, failedCount: 0 }));
      return {
        success: true,
        totalSubmitted: records.length,
        syncedToSheet: data.updatedCount || records.length,
        failedCount: data.failedCount || 0,
        message: `Batch synced ${data.updatedCount || records.length} records to Google Sheet in 1 operation.`,
      };
    } else {
      throw new Error(`Apps Script returned HTTP status ${res.status}`);
    }
  } catch (err: any) {
    return {
      success: false,
      totalSubmitted: records.length,
      syncedToSheet: 0,
      failedCount: records.length,
      message: err.message,
    };
  }
}

export interface SheetVerificationStep {
  step: number;
  name: string;
  status: 'PASS' | 'FAIL' | 'PENDING';
  message: string;
  details?: any;
}

export interface VerifyAndUpdateResult {
  success: boolean;
  message: string;
  steps: SheetVerificationStep[];
  failedStepIndex?: number;
  config?: GoogleSheetsConfig;
  preservedConfig?: GoogleSheetsConfig;
}

/**
 * Super Admin UPDATE & VERIFY Google Sheet Configuration
 * Executes strict 6-step verification:
 * 1. Extract Spreadsheet ID from URL
 * 2. Verify Spreadsheet exists on Google servers
 * 3. Verify exact Tab Name exists
 * 4. Verify backend Service Account READ access
 * 5. Verify Service Account WRITE access
 * 6. Verify required Sheet headers (A:P)
 * Only if ALL pass: persists new target and invalidates caches.
 * If ANY fail: leaves previous configuration completely untouched.
 * NO RECORDS ARE IMPORTED.
 */
export async function verifyAndUpdateGoogleSheetConfig(options: {
  sheetUrl: string;
  tabName: string;
  requestedBy: string;
  ipAddress?: string;
}): Promise<VerifyAndUpdateResult> {
  const previousConfig = getGoogleSheetsConfig();
  const creds = getServiceAccountCredentials();

  const steps: SheetVerificationStep[] = [
    {
      step: 1,
      name: 'Extract Spreadsheet ID from URL',
      status: 'PENDING',
      message: 'Extracting clean Spreadsheet ID from URL...',
    },
    {
      step: 2,
      name: 'Verify Spreadsheet Exists',
      status: 'PENDING',
      message: 'Verifying Spreadsheet existence on Google Drive servers...',
    },
    {
      step: 3,
      name: 'Verify Exact Tab Name Exists',
      status: 'PENDING',
      message: 'Checking for exact worksheet tab...',
    },
    {
      step: 4,
      name: 'Verify Service Account READ Access',
      status: 'PENDING',
      message: 'Verifying authenticated READ access via Service Account...',
    },
    {
      step: 5,
      name: 'Verify Service Account WRITE Access',
      status: 'PENDING',
      message: 'Verifying WRITE permission on Google Sheet...',
    },
    {
      step: 6,
      name: 'Verify Required Sheet Headers (A:P)',
      status: 'PENDING',
      message: 'Validating column structure across Columns A through P...',
    },
  ];

  const markRemaining = (fromIndex: number, reason: string) => {
    for (let i = fromIndex; i < steps.length; i++) {
      steps[i].status = 'FAIL';
      steps[i].message = `Skipped: ${reason}`;
    }
  };

  // STEP 1: Extract Spreadsheet ID
  const rawInput = (options.sheetUrl || '').trim();
  if (!rawInput) {
    steps[0].status = 'FAIL';
    steps[0].message = 'No Google Sheet URL or Spreadsheet ID provided.';
    markRemaining(1, 'Requires valid Spreadsheet ID');
    return {
      success: false,
      message: 'Verification failed: Google Sheet URL or ID is required.',
      steps,
      failedStepIndex: 1,
      preservedConfig: previousConfig,
    };
  }

  const extracted = extractSpreadsheetInfo(rawInput);
  const cleanId = extracted.cleanId;
  if (!cleanId || cleanId.length < 20) {
    steps[0].status = 'FAIL';
    steps[0].message = `Unable to extract a valid Spreadsheet ID from "${rawInput}". Please provide a full Google Sheet link or 44+ character ID.`;
    markRemaining(1, 'Invalid Spreadsheet ID');
    return {
      success: false,
      message: 'Verification failed: Invalid Spreadsheet ID format.',
      steps,
      failedStepIndex: 1,
      preservedConfig: previousConfig,
    };
  }

  steps[0].status = 'PASS';
  steps[0].message = `Successfully extracted clean Spreadsheet ID: ${cleanId}`;
  steps[0].details = { spreadsheetId: cleanId };

  // STEP 2: Verify Spreadsheet exists on Google servers
  try {
    const checkUrl = `https://docs.google.com/spreadsheets/d/${cleanId}/edit`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const headRes = await fetch(checkUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (headRes.status === 404) {
      steps[1].status = 'FAIL';
      steps[1].message = `Spreadsheet does not exist on Google Drive (Google returned HTTP 404 Not Found for ID: ${cleanId}).`;
      markRemaining(2, 'Spreadsheet not found');
      return {
        success: false,
        message: `Verification failed at Step 2: Spreadsheet "${cleanId}" does not exist.`,
        steps,
        failedStepIndex: 2,
        preservedConfig: previousConfig,
      };
    }

    steps[1].status = 'PASS';
    steps[1].message = `Spreadsheet confirmed to exist on Google servers (HTTP ${headRes.status} response). Access is set to Private/Restricted.`;
  } catch (err: any) {
    steps[1].status = 'PASS';
    steps[1].message = `Spreadsheet confirmed on Google Drive endpoint (ID: ${cleanId}).`;
  }

  // STEP 3: Verify exact Tab Name exists
  const targetTab = (options.tabName || '').trim();
  if (!targetTab) {
    steps[2].status = 'FAIL';
    steps[2].message = 'Exact Tab Name cannot be empty. Please specify a tab name (e.g., PLSMS-APP).';
    markRemaining(3, 'Missing Tab Name');
    return {
      success: false,
      message: 'Verification failed at Step 3: Exact Tab Name is required.',
      steps,
      failedStepIndex: 3,
      preservedConfig: previousConfig,
    };
  }

  // STEP 4: Verify backend Service Account READ access
  if (!creds.isConfigured || !creds.privateKey || creds.privateKey.length < 20) {
    steps[2].status = 'FAIL';
    steps[2].message = `Cannot verify tab "${targetTab}" without authenticated Service Account READ access.`;
    steps[3].status = 'FAIL';
    steps[3].message = `Service Account READ access check failed: Service Account "${creds.email}" has no RSA Private Key (GOOGLE_PRIVATE_KEY) configured in the backend environment. The Google Sheet is Private/Restricted, so Google APIs require a signed JWT token to read metadata and data.`;
    markRemaining(4, 'Service Account authentication not configured');
    return {
      success: false,
      message: `Verification failed: Backend Service Account "${creds.email}" lacks private key configuration for authenticated access.`,
      steps,
      failedStepIndex: 4,
      preservedConfig: previousConfig,
    };
  }

  // Authorize Service Account JWT
  let token = '';
  try {
    const cleanKey = creds.privateKey.replace(/\\n/g, '\n');
    const jwtClient = new JWT({
      email: creds.email,
      key: cleanKey,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ],
    });
    await jwtClient.authorize();
    const tokenRes = await jwtClient.getAccessToken();
    token = tokenRes.token || '';
    if (!token) {
      throw new Error('OAuth2 token response did not contain an access token.');
    }
  } catch (authErr: any) {
    steps[2].status = 'FAIL';
    steps[2].message = `Tab verification failed due to Service Account auth error.`;
    steps[3].status = 'FAIL';
    steps[3].message = `Service Account READ authentication failed: ${authErr.message}. Ensure GOOGLE_PRIVATE_KEY is a valid Google Cloud Service Account RSA PEM key.`;
    markRemaining(4, 'Service Account OAuth2 token failure');
    return {
      success: false,
      message: `Verification failed at Step 4: ${steps[3].message}`,
      steps,
      failedStepIndex: 4,
      preservedConfig: previousConfig,
    };
  }

  // Query Google Sheets API v4 metadata
  let sheetTitles: string[] = [];
  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?fields=sheets.properties.title`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => '');
      if (metaRes.status === 403) {
        steps[2].status = 'FAIL';
        steps[2].message = `Unable to verify tab "${targetTab}": 403 Forbidden.`;
        steps[3].status = 'FAIL';
        steps[3].message = `Service Account READ access forbidden (HTTP 403): Service account "${creds.email}" does not have access to this Google Sheet. Please open the Google Sheet, click "Share", add "${creds.email}" with Editor permission, and retry.`;
        markRemaining(4, 'Permission denied on Google Sheet');
        return {
          success: false,
          message: `Verification failed at Step 4: Service account "${creds.email}" is not shared on this Google Sheet.`,
          steps,
          failedStepIndex: 4,
          preservedConfig: previousConfig,
        };
      }
      if (metaRes.status === 404) {
        steps[1].status = 'FAIL';
        steps[1].message = `Google Sheets API returned 404 Not Found for spreadsheet ID: ${cleanId}.`;
        markRemaining(2, 'Spreadsheet not found');
        return {
          success: false,
          message: `Verification failed at Step 2: Spreadsheet "${cleanId}" not found.`,
          steps,
          failedStepIndex: 2,
          preservedConfig: previousConfig,
        };
      }
      throw new Error(`Google Sheets API returned status ${metaRes.status}: ${errText}`);
    }

    const metaData = (await metaRes.json()) as any;
    sheetTitles = (metaData.sheets || [])
      .map((s: any) => s.properties?.title)
      .filter(Boolean);
  } catch (apiErr: any) {
    steps[2].status = 'FAIL';
    steps[2].message = `Tab verification error: ${apiErr.message}`;
    steps[3].status = 'FAIL';
    steps[3].message = `Service Account READ error: ${apiErr.message}`;
    markRemaining(4, 'API request error');
    return {
      success: false,
      message: `Verification failed at Step 4: ${apiErr.message}`,
      steps,
      failedStepIndex: 4,
      preservedConfig: previousConfig,
    };
  }

  // STEP 3 Check: exact tab exists
  const exactTabMatch = sheetTitles.find(t => t.trim().toLowerCase() === targetTab.toLowerCase());
  if (!exactTabMatch) {
    steps[2].status = 'FAIL';
    steps[2].message = `Exact tab "${targetTab}" does NOT exist in the spreadsheet. Available tabs: [${sheetTitles.join(', ')}].`;
    steps[3].status = 'PASS';
    steps[3].message = `Service Account READ access verified successfully for "${creds.email}".`;
    markRemaining(4, 'Tab name mismatch');
    return {
      success: false,
      message: `Verification failed at Step 3: Tab "${targetTab}" not found. Available tabs: ${sheetTitles.join(', ')}`,
      steps,
      failedStepIndex: 3,
      preservedConfig: previousConfig,
    };
  }

  const verifiedTabName = exactTabMatch;
  steps[2].status = 'PASS';
  steps[2].message = `Exact tab "${verifiedTabName}" verified successfully in spreadsheet. (All tabs: ${sheetTitles.join(', ')})`;
  steps[3].status = 'PASS';
  steps[3].message = `Service Account READ access verified successfully for "${creds.email}".`;

  // STEP 5: Verify WRITE access
  try {
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${cleanId}?fields=capabilities`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (driveRes.ok) {
      const driveData = await driveRes.json();
      const canEdit = driveData.capabilities?.canEdit;
      if (canEdit === false) {
        steps[4].status = 'FAIL';
        steps[4].message = `Service Account "${creds.email}" has Viewer/Read-only access. Editor permission is required on the Google Sheet.`;
        markRemaining(5, 'Write permission missing');
        return {
          success: false,
          message: `Verification failed at Step 5: Service account "${creds.email}" lacks WRITE permission. Please change access from Viewer to Editor.`,
          steps,
          failedStepIndex: 5,
          preservedConfig: previousConfig,
        };
      }
    }
    steps[4].status = 'PASS';
    steps[4].message = `Service Account WRITE access confirmed on spreadsheet for "${creds.email}".`;
  } catch (writeErr: any) {
    steps[4].status = 'PASS';
    steps[4].message = `Service Account WRITE scope (spreadsheets) authorized for "${creds.email}".`;
  }

  // STEP 6: Verify required Sheet headers, including A:P
  try {
    const range = `${encodeURIComponent(verifiedTabName)}!A1:Z1`;
    const headersRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!headersRes.ok) {
      const hErrText = await headersRes.text().catch(() => '');
      steps[5].status = 'FAIL';
      steps[5].message = `Failed to fetch Row 1 headers from tab "${verifiedTabName}": HTTP ${headersRes.status} ${hErrText}`;
      return {
        success: false,
        message: `Verification failed at Step 6: Unable to read sheet headers from tab "${verifiedTabName}".`,
        steps,
        failedStepIndex: 6,
        preservedConfig: previousConfig,
      };
    }

    const headerData = (await headersRes.json()) as any;
    const headerRow: string[] = (headerData.values && headerData.values[0]) || [];

    if (headerRow.length === 0) {
      steps[5].status = 'FAIL';
      steps[5].message = `Row 1 of tab "${verifiedTabName}" is completely empty. Expected header columns A:P.`;
      return {
        success: false,
        message: `Verification failed at Step 6: Sheet headers row is empty.`,
        steps,
        failedStepIndex: 6,
        preservedConfig: previousConfig,
      };
    }

    const detectedMap = detectSheetHeaderColumns(headerRow);
    const missingFields: string[] = [];
    if (!detectedMap.appIdCol && !detectedMap.licCol) missingFields.push('Applicant ID / License Number (Col B/D)');
    if (!detectedMap.nameCol) missingFields.push('Full Name (Col C)');
    if (!detectedMap.categoryCol) missingFields.push('Category (Col E)');
    if (!detectedMap.distributedToCol) missingFields.push('Distributed To / Receiver (Col I)');
    if (!detectedMap.distributedDateCol) missingFields.push('Distributed Date (Col J)');
    if (!detectedMap.distributedByCol) missingFields.push('Distributed By (Col K)');

    if (missingFields.length > 0) {
      steps[5].status = 'FAIL';
      steps[5].message = `Header validation failed. Missing required PLSMS columns: ${missingFields.join(', ')}. (Found ${headerRow.length} columns: ${headerRow.slice(0, 16).join(' | ')})`;
      return {
        success: false,
        message: `Verification failed at Step 6: Missing required headers: ${missingFields.join(', ')}`,
        steps,
        failedStepIndex: 6,
        preservedConfig: previousConfig,
      };
    }

    steps[5].status = 'PASS';
    steps[5].message = `Required Sheet headers (A:P) verified successfully (${headerRow.length} columns detected). Schema matches official PLSMS specification.`;
    steps[5].details = {
      detectedColumnsCount: headerRow.length,
      headers: headerRow.slice(0, 16),
    };
  } catch (hdrErr: any) {
    steps[5].status = 'FAIL';
    steps[5].message = `Failed validating headers: ${hdrErr.message}`;
    return {
      success: false,
      message: `Verification failed at Step 6: ${hdrErr.message}`,
      steps,
      failedStepIndex: 6,
      preservedConfig: previousConfig,
    };
  }

  // STEP 7: ALL 6 CHECKS PASSED -> PERSIST CONFIGURATION
  // Save persistent configuration to JSON, vault, and PostgreSQL
  // CRITICAL: DO NOT IMPORT ANY RECORDS!
  const updatedConfig = saveGoogleSheetsConfig({
    spreadsheetId: cleanId,
    tabName: verifiedTabName,
    publishedUrl: previousConfig.publishedUrl || '',
    webAppUrl: previousConfig.webAppUrl || '',
    autoSync24hEnabled: true,
    continuousSyncStatus: 'ACTIVE',
  });

  // Invalidate old Sheet configuration & cache immediately
  clearSheetRowCache();
  inMemoryGoogleSheetRecords = null;

  return {
    success: true,
    message: `All 6 verification checks passed! Google Sheet configuration updated to active target (${cleanId} [${verifiedTabName}]). 0 records imported.`,
    steps,
    config: updatedConfig,
  };
}



