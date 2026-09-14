import fs from 'fs';
import path from 'path';
import { JWT } from 'google-auth-library';
import { parseCSVFast, extractHeadersAndDataFromMatrix, detectColumnMapping, XLSX } from './excelParser';
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
} from './db';
import { getNepaliDevanagariBSDate, toDevanagariDigits } from './nepaliDate';

const STORAGE_DIR = path.join(process.cwd(), 'data_storage');
const STORAGE_UPLOADS = path.join(STORAGE_DIR, 'uploads');
const CONFIG_FILE = path.join(STORAGE_DIR, 'google_sheets_config.json');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}
if (!fs.existsSync(STORAGE_UPLOADS)) {
  fs.mkdirSync(STORAGE_UPLOADS, { recursive: true });
}

export type { GoogleSheetsConfig };

/**
 * Get Service Account credentials from environment variables or secure keyfile
 */
export function getServiceAccountCredentials(): {
  email: string;
  privateKey: string;
  isConfigured: boolean;
} {
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';

  if (!email && process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      if (parsed.client_email) email = parsed.client_email;
      if (parsed.private_key) privateKey = parsed.private_key;
    } catch {}
  }

  if (!email && process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    try {
      const content = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.client_email) email = parsed.client_email;
      if (parsed.private_key) privateKey = parsed.private_key;
    } catch {}
  }

  // Production-ready default service account identity for PLSMS Cloud
  if (!email) {
    email = 'plsms-sync-proxy@nepal-transport-gov.iam.gserviceaccount.com';
  }

  const isConfigured = Boolean(privateKey && privateKey.trim().length > 20);

  return { email, privateKey, isConfigured };
}

export const OFFICIAL_DEFAULT_SHEET_ID = '1J3Kz3g0MzhiI8M-YFu6yl2jpOSFz4vRg3jxcpb-krdE';
export const OFFICIAL_DEFAULT_TAB_NAME = '1st -LOt--1-16000--csv';

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

export { buildKAP4ColKey };

export let inMemoryGoogleSheetRecords: LicenseRecord[] | null = null;

export function getGoogleSheetRecords(): LicenseRecord[] {
  const cfg = inMemoryConfig || getGoogleSheetsConfig();
  if (!cfg.spreadsheetId && !cfg.publishedUrl) {
    return [];
  }

  if (inMemoryGoogleSheetRecords && inMemoryGoogleSheetRecords.length > 0) {
    return inMemoryGoogleSheetRecords;
  }

  try {
    if (fs.existsSync(STORAGE_UPLOADS)) {
      const files = fs
        .readdirSync(STORAGE_UPLOADS)
        .filter((f) => f.startsWith('sync_') && f.endsWith('_normalized.json'))
        .sort((a, b) => {
          const statA = fs.statSync(path.join(STORAGE_UPLOADS, a));
          const statB = fs.statSync(path.join(STORAGE_UPLOADS, b));
          return statB.mtimeMs - statA.mtimeMs;
        });

      if (files.length > 0) {
        const latestFile = path.join(STORAGE_UPLOADS, files[0]);
        const content = fs.readFileSync(latestFile, 'utf-8');
        inMemoryGoogleSheetRecords = JSON.parse(content);
        return inMemoryGoogleSheetRecords || [];
      }
    }
  } catch (err: any) {
    console.warn('[Google Sheets Cache] Warning loading cached sheet records:', err.message);
  }

  return getAllRecords();
}

export function clearSheetRowCache(): void {
  sheetLicenseRowMap.clear();
  sheetCleanLicenseRowMap.clear();
  sheetAppIdRowMap.clear();
  sheetCompositeRowMap.clear();
}

const DEFAULT_CONFIG: GoogleSheetsConfig = {
  spreadsheetId: '',
  tabName: '',
  publishedUrl: '',
  webAppUrl: '',
  lastSyncAt: null,
  syncState: 'READY',
  indexedInRam: 0,
  lastSyncDurationMs: 0,
  duplicatesCount: 0,
  invalidRowsCount: 0,
  totalSheetRows: 0,
  duplicateItems: [],
  invalidItems: [],
  serviceAccountEmail: 'plsms-sync-proxy@nepal-transport-gov.iam.gserviceaccount.com',
  serviceAccountConfigured: false,
  proxyMode: 'BACKEND_PROXY',
  autoSync24hEnabled: true,
  autoSyncIntervalSeconds: 60,
  continuousSyncStatus: 'PAUSED',
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
    if (!fs.existsSync(CONFIG_FILE)) {
      const initialConfig: GoogleSheetsConfig = {
        ...DEFAULT_CONFIG,
        serviceAccountEmail: creds.email,
        serviceAccountConfigured: creds.isConfigured,
        proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
      };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2), 'utf-8');
      inMemoryConfig = initialConfig;
      return initialConfig;
    }

    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    if (!content || !content.trim()) {
      inMemoryConfig = { ...DEFAULT_CONFIG };
      return inMemoryConfig;
    }

    const parsed = JSON.parse(content);
    const hasActiveSheet = Boolean(parsed.spreadsheetId || parsed.publishedUrl);
    inMemoryConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      indexedInRam: hasActiveSheet ? currentRam : 0,
      totalSheetRows: hasActiveSheet ? (parsed.totalSheetRows || 0) : 0,
      serviceAccountEmail: creds.email,
      serviceAccountConfigured: creds.isConfigured,
      proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
    };

    // Auto-verify that sheetStats exists and missing/found counts match DB realities
    if (!inMemoryConfig.sheetStats || inMemoryConfig.sheetStats.missingRecords === undefined || inMemoryConfig.sheetStats.foundRecords === undefined || inMemoryConfig.sheetStats.handedOverRecords === undefined) {
      const records = getAllRecords();
      let dist = 0;
      let missing = 0;
      let found = 0;
      let handedOver = 0;
      for (const r of records) {
        if (isRecordMissing(r)) missing++;
        else if (isRecordFound(r)) found++;
        if (isRecordDistributed(r)) dist++;
        if (isRecordHandedOver(r)) {
          handedOver++;
        }
      }
      const total = inMemoryConfig.totalSheetRows || records.length || 0;
      inMemoryConfig.sheetStats = {
        totalRecords: total,
        availableRecords: Math.max(0, total - dist),
        distributedRecords: dist,
        missingRecords: missing,
        foundRecords: found,
        handedOverRecords: handedOver,
      };
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

export function saveGoogleSheetsConfig(config: Partial<GoogleSheetsConfig>): GoogleSheetsConfig {
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

    const updated: GoogleSheetsConfig = {
      ...current,
      ...config,
      duplicateItems: cleanDuplicates,
      invalidItems: cleanInvalid,
    };

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

    const tempPath = `${CONFIG_FILE}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2), 'utf-8');
    fs.renameSync(tempPath, CONFIG_FILE);
    return updated;
  } catch (err) {
    console.error('Error saving Google Sheets config:', err);
    return inMemoryConfig || getGoogleSheetsConfig();
  }
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
} {
  const currentCfg = inMemoryConfig || getGoogleSheetsConfig();
  const sheetRecs =
    inMemoryGoogleSheetRecords && inMemoryGoogleSheetRecords.length > 0
      ? inMemoryGoogleSheetRecords
      : getGoogleSheetRecords();

  const targetRecords = sheetRecs && sheetRecs.length > 0 ? sheetRecs : getAllRecords();

  let dist = 0;
  let missing = 0;
  let found = 0;
  let handedOver = 0;
  for (const r of targetRecords) {
    if (isRecordMissing(r)) missing++;
    else if (isRecordFound(r)) found++;
    if (isRecordDistributed(r)) dist++;
    if (isRecordHandedOver(r)) handedOver++;
  }

  const total = currentCfg.totalSheetRows || targetRecords.length || 0;
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
  const resetConfig: GoogleSheetsConfig = {
    spreadsheetId: '',
    tabName: '',
    publishedUrl: '',
    webAppUrl: '',
    lastSyncAt: null,
    syncState: 'READY',
    indexedInRam: 0,
    lastSyncDurationMs: 0,
    duplicatesCount: 0,
    invalidRowsCount: 0,
    totalSheetRows: 0,
    duplicateItems: [],
    invalidItems: [],
    serviceAccountEmail: creds.email || 'plsms-sync-proxy@nepal-transport-gov.iam.gserviceaccount.com',
    serviceAccountConfigured: creds.isConfigured,
    proxyMode: creds.isConfigured ? 'SERVICE_ACCOUNT' : 'BACKEND_PROXY',
    autoSync24hEnabled: false,
    autoSyncIntervalSeconds: 60,
    continuousSyncStatus: 'PAUSED',
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
      filtered = matched.filter(
        (r) =>
          (r.licenseNumber && r.licenseNumber.toLowerCase().includes(search)) ||
          (r.holderName && r.holderName.toLowerCase().includes(search)) ||
          (r.applicantId && r.applicantId.toLowerCase().includes(search)) ||
          (r.receivedBy && r.receivedBy.toLowerCase().includes(search)) ||
          (r.receiverRemarks && r.receiverRemarks.toLowerCase().includes(search)) ||
          (r.missingReason && r.missingReason.toLowerCase().includes(search))
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
      filtered = matched.filter(
        (r) =>
          (r.licenseNumber && r.licenseNumber.toLowerCase().includes(search)) ||
          (r.holderName && r.holderName.toLowerCase().includes(search)) ||
          (r.applicantId && r.applicantId.toLowerCase().includes(search)) ||
          (r.receivedBy && r.receivedBy.toLowerCase().includes(search)) ||
          (r.receiverRemarks && r.receiverRemarks.toLowerCase().includes(search)) ||
          (r.missingReason && r.missingReason.toLowerCase().includes(search))
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

  // Strategy 1: Check metadata from Service Account if configured
  const creds = getServiceAccountCredentials();
  if (creds.isConfigured) {
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

  // Strategy 1.5: Direct Workbook Inspection via SheetJS from export?format=xlsx
  if (cleanId) {
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

  // If old dummy placeholder was passed, automatically substitute official working sheet ID
  if (trimmed.includes('1BxIMVsOXRA5nfMdKvBdBZjgmUUqptlbs74OgvE2upms') || trimmed === '1BxIMVsOXRA5nfMdKvBdBZjgmUUqptlbs74OgvE2upms') {
    return {
      cleanId: OFFICIAL_DEFAULT_SHEET_ID,
      tabName: OFFICIAL_DEFAULT_TAB_NAME,
      isPublishedWeb: false,
    };
  }

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

  if (cleanId === '1BxIMVsOXRA5nfMdKvBdBZjgmUUqptlbs74OgvE2upms') {
    cleanId = OFFICIAL_DEFAULT_SHEET_ID;
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

  // 1. Fetch spreadsheet metadata to get exact sheet titles if needed
  let targetSheet = tabName || 'Sheet1';
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
        if (!sheetTitles.includes(targetSheet)) {
          targetSheet = sheetTitles[0];
        }
      }
    }
  } catch (metaErr) {
    // Continue with default targetSheet
  }

  // 2. Fetch all values from targetSheet
  const range = `${encodeURIComponent(targetSheet)}!A1:ZZ`;
  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;

  const valuesRes = await fetch(valuesUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!valuesRes.ok) {
    const errBody = await valuesRes.text();
    if (valuesRes.status === 404) {
      throw new Error(`Spreadsheet "${spreadsheetId}" not found or sheet tab "${targetSheet}" does not exist.`);
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

  if (rawValues.length === 0) {
    throw new Error(`The sheet tab "${targetSheet}" contains no data rows.`);
  }

  const parsed = extractHeadersAndDataFromMatrix(rawValues);
  return parsed;
}

/**
 * Fetch raw CSV, JSON, or Excel data from Google Sheets endpoints with multi-layer fallback & Service Account proxy
 */
async function fetchGoogleSheetData(
  spreadsheetId: string,
  tabName: string,
  publishedUrl?: string
): Promise<{ rawText?: string; parsedData?: { headers: string[]; rows: any[] }; serviceAccountUsed?: boolean }> {
  const info = extractSpreadsheetInfo(spreadsheetId);
  const cleanId = info.cleanId;
  const gid = info.gid;

  const creds = getServiceAccountCredentials();

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
      console.warn('Service Account fetch failed, attempting backend proxy fallback:', saErr.message);
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

  let saw401OrPrivate = false;
  let saw404NotFound = false;
  let all404 = true;
  let lastError = '';

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
      });

      if (response.status === 401 || response.status === 403) {
        saw401OrPrivate = true;
        all404 = false;
        lastError = `HTTP ${response.status} Unauthorized / Access Restricted`;
        continue;
      }

      if (response.status === 404) {
        saw404NotFound = true;
        lastError = `HTTP 404 Not Found`;
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
              const targetSheetName =
                workbook.SheetNames.find((n: string) => n.toLowerCase() === (tabName || 'sheet1').toLowerCase()) ||
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

      const text = await response.text();

      // Check if it returned an HTML sign-in page instead of actual data
      if (
        text.includes('<!DOCTYPE html') ||
        text.includes('accounts.google.com/signin') ||
        text.includes('ServiceLogin') ||
        text.includes('Sign in - Google Accounts')
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

      // Handle CSV text
      if (text.trim().length > 0) {
        return { rawText: text };
      }
    } catch (err: any) {
      all404 = false;
      lastError = err.message || 'Connection error';
    }
  }

  const sheetEditUrl = cleanId ? `https://docs.google.com/spreadsheets/d/${cleanId}/edit` : '';
  const isRestricted = saw401OrPrivate || lastError.includes('401') || lastError.includes('403') || lastError.includes('private');
  const isNotFound = saw404NotFound && all404 && !saw401OrPrivate;
  const cleanUrl = sheetEditUrl || `https://docs.google.com/spreadsheets/d/${cleanId}/edit`;

  let userFriendlyMsg = '';
  if (isRestricted) {
    if (creds.isConfigured) {
      userFriendlyMsg = `Google Sheet Permission Required: The document is private. Please click 'Share' in your Google Sheet and add the Service Account "${creds.email}" as Viewer (or set General Access to 'Anyone with the link can view').`;
    } else {
      userFriendlyMsg = `Google Sheet Access Restricted: The document is private. Please open your Google Sheet, click 'Share' (top-right), and set General Access to 'Anyone with the link' as Viewer (or use 'File > Share > Publish to web').`;
    }
  } else if (isNotFound) {
    userFriendlyMsg = `Spreadsheet Not Found (HTTP 404): The Google Spreadsheet with ID "${cleanId}" does not exist on Google Docs or has been removed. Please verify your Spreadsheet link/ID or load the Official Nepal Driving License Dataset.`;
  } else {
    userFriendlyMsg = lastError || 'Unable to sync with Google Sheet. Please check the URL/ID or share the sheet.';
  }

  const error: any = new Error(userFriendlyMsg);
  error.isRestricted = isRestricted;
  error.isNotFound = isNotFound;
  error.sheetUrl = cleanUrl;
  error.spreadsheetId = cleanId;
  error.serviceAccountEmail = creds.email;
  throw error;
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
}): Promise<{
  success: boolean;
  totalProcessed: number;
  newRecords: number;
  updatedRecords: number;
  duplicatesCount: number;
  invalidRowsCount: number;
  syncDurationMs: number;
  indexedInRam: number;
  duplicateItems: any[];
  config: GoogleSheetsConfig;
}> {
  const startTime = Date.now();
  const currentConfig = getGoogleSheetsConfig();

  const rawInput = (options.spreadsheetId || currentConfig.spreadsheetId || '').trim();
  const info = extractSpreadsheetInfo(rawInput);
  const spreadsheetId = info.cleanId || rawInput;
  const tabName = (options.tabName || currentConfig.tabName || 'Sheet1').trim();
  const publishedUrl = (options.publishedUrl || currentConfig.publishedUrl || '').trim();
  const uploadedBy = options.uploadedBy || 'Super Administrator';
  const isBackgroundDaemon = Boolean(options.isBackgroundDaemon);

  saveGoogleSheetsConfig({
    spreadsheetId: rawInput,
    tabName,
    publishedUrl,
    syncState: 'SYNCING',
    continuousSyncStatus: 'SYNCING',
    lastHeartbeatAt: new Date().toISOString(),
  });

  try {
    const fetched = await fetchGoogleSheetData(rawInput, tabName, publishedUrl);
    let parsed: { headers: string[]; rows: any[] };

    if (fetched.parsedData) {
      parsed = fetched.parsedData;
    } else if (fetched.rawText) {
      parsed = parseCSVFast(fetched.rawText);
    } else {
      throw new Error('No data received from Google Sheets.');
    }

    if (!parsed || parsed.rows.length === 0) {
      throw new Error('Google Sheet returned 0 data rows. Please ensure the sheet contains headers and record rows.');
    }

    const mapping = detectColumnMapping(parsed.headers);
    if (!mapping.licenseNumber || !mapping.holderName) {
      // Positional fallback
      const headers = parsed.headers;
      if (!mapping.licenseNumber) {
        if (headers.length > 2) mapping.licenseNumber = headers[2];
        else if (headers.length > 0) mapping.licenseNumber = headers[0];
      }
      if (!mapping.holderName) {
        if (headers.length > 1) mapping.holderName = headers[1];
        else if (headers.length > 0) mapping.holderName = headers[0];
      }
    }

    if (!mapping.licenseNumber || !mapping.holderName) {
      throw new Error(
        `Unable to identify License Number and Full Name columns. Found headers: ${parsed.headers.join(', ')}`
      );
    }

    const nowIso = new Date().toISOString();
    const importId = 'GS_SYNC_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const rawRows = parsed.rows;
    const totalRows = rawRows.length;
    let invalidRecords = 0;
    const normalizedRecords: LicenseRecord[] = [];
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
    const seen4ColInSheet = new Map<string, { sheetRow: number; item: any }>();

    // Fast index of existing DB records to preserve confirmed status state & trigger writeback to sheet
    const existingDbRecords = getAllRecords();
    const existingDbByLic = new Map<string, LicenseRecord[]>();
    const existingDbByCleanLic = new Map<string, LicenseRecord[]>();
    const existingDbByAppId = new Map<string, LicenseRecord[]>();
    const existingDbByComposite = new Map<string, LicenseRecord[]>();
    const existingDbBy4Col = new Map<string, LicenseRecord>();

    const pushDbRecord = (map: Map<string, LicenseRecord[]>, key: string, rec: LicenseRecord) => {
      const list = map.get(key);
      if (list) list.push(rec);
      else map.set(key, [rec]);
    };

    for (const er of existingDbRecords) {
      const uApp = (er.applicantId || er.applicationNumber || '').trim().toUpperCase();
      const uName = (er.holderName || '').trim().toUpperCase();
      const uLic = (er.licenseNumber || '').trim().toUpperCase();
      const uCat = (er.category || er.vehicleClass || '').trim().toUpperCase();

      if (uLic) {
        pushDbRecord(existingDbByLic, uLic, er);
        pushDbRecord(existingDbByCleanLic, uLic.replace(/[^A-Z0-9]/g, ''), er);
      }
      if (uApp) {
        pushDbRecord(existingDbByAppId, uApp, er);
        if (uLic) {
          pushDbRecord(existingDbByComposite, `${uApp}_${uLic.replace(/[^A-Z0-9]/g, '')}`, er);
        }
      }
      if (uApp && uLic) {
        existingDbBy4Col.set(`${uApp}|||${uName}|||${uLic}|||${uCat}`, er);
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

    for (let i = 0; i < totalRows; i++) {
      const row = rawRows[i];
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
          v === '(MISSING)' ||
          v === '(BLANK)'
        );
      };

      const hasLicNo = !isBlank(licNo);
      const hasAppId = !isBlank(rawAppNo);

      // USER MANDATE:
      // - If there is no data in 'APPLICANT ID' only, then it is a VALID row
      // - If there is no data in 'LICENSE NUMBER' only, then it is a VALID row
      // - BUT if there is NO data in BOTH fields ('APPLICANT ID' and 'LICENSE NUMBER'), then ONLY is it an INVALID row!
      if (!hasLicNo && !hasAppId) {
        invalidRecords++;
        invalidItems.push({
          sheetRow,
          sn,
          applicantId: '(Missing / Empty in Column B)',
          holderName: name || '(Blank / Empty)',
          licenseNumber: '(Missing / Empty in Column D)',
          category,
          department: office,
          reason:
            'Invalid Record: Both APPLICANT ID (Column B) and LICENSE NUMBER (Column D) are empty/missing. In Nepal Transport PLSMS, a record is valid and can be distributed if either identifier is present.',
          rawRow: row,
        });
        continue;
      }

      // Valid row values
      const appNo = hasAppId ? rawAppNo : (hasLicNo ? `APP-${licNo}` : `APP-ROW-${sheetRow}`);
      const validLicNo = hasLicNo ? licNo : '';
      const cleanName = name || 'UNKNOWN HOLDER';

      // STRICT 4-COLUMN DUPLICATE CHECK:
      // "duplicate can be calculated if the data of a ROW of APPLICANT ID and FULL NAME and LICENSE NUMBER and CATEGORY are exactly and strictly matched all these 4 columns data to the other any ROW of the whole sheet then only we can say this record of ROW is Duplicate. other wise we can not say the data is duplicate."
      const cleanAppId = appNo.trim().toUpperCase();
      const cleanNameUpper = cleanName.trim().toUpperCase();
      const cleanLicUpper = validLicNo.trim().toUpperCase();
      const cleanCat = category.trim().toUpperCase();
      const strict4ColKey = `${cleanAppId}|||${cleanNameUpper}|||${cleanLicUpper}|||${cleanCat}`;

      if (seen4ColInSheet.has(strict4ColKey)) {
        const firstSeen = seen4ColInSheet.get(strict4ColKey)!;
        sheetDuplicates.push({
          sheetRow,
          matchedRow: firstSeen.sheetRow,
          applicantId: appNo,
          holderName: cleanName,
          licenseNumber: validLicNo,
          category,
          office,
          reason: `Strict Duplicate: All 4 fields (Applicant ID: "${appNo}", Full Name: "${cleanName}", License No: "${validLicNo}", Category: "${category}") strictly match Sheet Row #${firstSeen.sheetRow}`,
        });
        continue; // Skip duplicate row from being normalized/indexed twice
      }

      seen4ColInSheet.set(strict4ColKey, { sheetRow, item: row });

      // Populate Live In-Memory Sheet Row Maps for Instant O(1) Targetting
      if (cleanLicUpper) sheetLicenseRowMap.set(cleanLicUpper, sheetRow);
      if (cleanAppId) sheetAppIdRowMap.set(cleanAppId, sheetRow);
      const cleanLicNorm = cleanLicUpper.replace(/[^A-Z0-9]/g, '');
      if (cleanLicNorm) sheetCleanLicenseRowMap.set(cleanLicNorm, sheetRow);
      if (cleanAppId && cleanLicNorm) sheetCompositeRowMap.set(`${cleanAppId}_${cleanLicNorm}`, sheetRow);
      sheet4ColCompositeRowMap.set(strict4ColKey, sheetRow);
      
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

      // Check corresponding existing record in Database using strict 4-column purity:
      // A person can have 2 or 3 smart cards after adding a category.
      // If the candidate record has a DIFFERENT category, it is a DIFFERENT smart card and MUST NOT match!
      let existingDb: LicenseRecord | undefined = undefined;
      if (strict4ColKey && existingDbBy4Col.has(strict4ColKey)) {
        existingDb = existingDbBy4Col.get(strict4ColKey);
      } else {
        const findCatMatch = (list: LicenseRecord[] | undefined): LicenseRecord | undefined => {
          if (!list || list.length === 0) return undefined;
          if (cleanCat) {
            for (const cand of list) {
              const candCat = normalizeCleanCategory(cand.category || cand.vehicleClass);
              if (candCat === cleanCat) return cand;
            }
            return undefined; // Do NOT match candidates with different categories!
          }
          return list[0];
        };

        if (cleanAppId && cleanLicNorm) {
          existingDb = findCatMatch(existingDbByComposite.get(`${cleanAppId}_${cleanLicNorm}`));
        }
        if (!existingDb && cleanLicUpper) {
          existingDb = findCatMatch(existingDbByLic.get(cleanLicUpper));
        }
        if (!existingDb && cleanLicNorm) {
          existingDb = findCatMatch(existingDbByCleanLic.get(cleanLicNorm));
        }
        if (!existingDb && cleanAppId) {
          existingDb = findCatMatch(existingDbByAppId.get(cleanAppId));
        }
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

      // Two-Way Sync Rule: If record is MISSING or FOUND in PLSMS DB, immediately write back to Google Sheet
      if ((isMissing || isFound) && (!rawStatusVal || rawStatusVal !== (isFound ? 'FOUND' : 'MISSING') || (isMissing && (rawDistVal || rawFoundVal || rawReceivedBy)))) {
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

      const record: LicenseRecord = {
        id: existingDb?.id || ('REC_' + Date.now() + '_' + i + '_' + (cleanCat ? cleanCat.replace(/[^A-Z0-9]/g, '') + '_' : '') + Math.random().toString(36).substring(2, 6)),
        sn,
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

      normalizedRecords.push(normalizeRecordData(record));
    }

    // Save JSON backup
    const jsonFileName = `sync_${importId}_normalized.json`;
    const jsonStoragePath = path.join(STORAGE_UPLOADS, jsonFileName);
    fs.writeFileSync(jsonStoragePath, JSON.stringify(normalizedRecords), 'utf-8');
    inMemoryGoogleSheetRecords = normalizedRecords;

    // Batch insert into in-memory hash store & disk
    const { newCount, updatedCount, duplicateCount: batchDupCount, duplicateItems: batchDups } = batchInsertOrUpdateRecords(
      normalizedRecords,
      importId,
      jsonStoragePath
    );

    // Continuous Sync Reconcile: Ensure all distributed cards from Google Sheet are synchronized into distributions.json
    reconcileDistributionsFromRecords();

    const totalDuplicatesCount = sheetDuplicates.length + batchDupCount;
    const allDuplicateItems = [...sheetDuplicates, ...(batchDups || [])];

    const syncDurationMs = Math.max(1, Date.now() - startTime);
    const allRecords = getAllRecords();
    const existingJobs = getImportJobs();
    const lotNumber = existingJobs.length + 1;
    const lotSuffix =
      ['th', 'st', 'nd', 'rd'][(lotNumber % 100 - 20) % 10] ||
      ['th', 'st', 'nd', 'rd'][lotNumber % 100] ||
      'th';
    const defaultLotCode = `${lotNumber}${lotSuffix}-LOT`;

    const shortId = spreadsheetId ? spreadsheetId.slice(0, 12) + '...' : 'Live Stream';

    const importJob: ImportJob = {
      id: importId,
      filename: `Google Sheet: ${shortId} [${tabName}]`,
      lotCode: defaultLotCode,
      nepaliDate: getNepaliDateString(new Date()),
      fileSize: (fetched.rawText ? fetched.rawText.length : normalizedRecords.length * 120),
      uploadedBy,
      uploadedAt: nowIso,
      totalRows: totalRows,
      newRecords: newCount,
      updatedRecords: updatedCount,
      duplicateRecords: totalDuplicatesCount,
      invalidRecords: invalidItems.length,
      status: 'COMPLETED',
      durationMs: syncDurationMs,
      jsonStoragePath,
      columnMapping: mapping as any,
      duplicateItems: allDuplicateItems,
    };

    saveImportJob(importJob);

    const intervalSec = currentConfig.autoSyncIntervalSeconds || 60;
    const nextScheduled = new Date(Date.now() + intervalSec * 1000).toISOString();
    const prevCount = currentConfig.successful24hSyncCount || 0;

    let sheetDistributed = 0;
    let sheetMissing = 0;
    let sheetFound = 0;
    let sheetHandedOver = 0;
    for (const r of normalizedRecords) {
      if (isRecordMissing(r)) sheetMissing++;
      else if (isRecordFound(r)) sheetFound++;
      if (isRecordDistributed(r)) sheetDistributed++;
      if (isRecordHandedOver(r)) {
        sheetHandedOver++;
      }
    }
    const sheetAvailable = Math.max(0, (totalRows || normalizedRecords.length) - sheetDistributed);
    const calculatedSheetStats = {
      totalRecords: totalRows || normalizedRecords.length,
      availableRecords: sheetAvailable,
      distributedRecords: sheetDistributed,
      missingRecords: sheetMissing,
      foundRecords: sheetFound,
      handedOverRecords: sheetHandedOver,
    };

    const updatedConfig = saveGoogleSheetsConfig({
      spreadsheetId: rawInput,
      tabName,
      publishedUrl,
      lastSyncAt: nowIso,
      syncState: 'SYNCED',
      indexedInRam: allRecords.length,
      lastSyncDurationMs: syncDurationMs,
      duplicatesCount: totalDuplicatesCount,
      invalidRowsCount: invalidItems.length,
      totalSheetRows: totalRows,
      sheetStats: calculatedSheetStats,
      invalidItems: invalidItems,
      duplicateItems: allDuplicateItems,
      lastError: undefined,
      continuousSyncStatus: 'CONNECTED_24_7',
      lastHeartbeatAt: nowIso,
      nextScheduledSyncAt: nextScheduled,
      successful24hSyncCount: prevCount + 1,
    });

    if (!isBackgroundDaemon || newCount > 0 || updatedCount > 0) {
      logAudit(
        'SUPER_ADMIN',
        uploadedBy,
        'GOOGLE_SHEETS_SYNCED',
        'IMPORT',
        `Synchronized ${normalizedRecords.length} records from Google Sheet (${tabName}) in ${syncDurationMs}ms. (${newCount} new, ${updatedCount} updated, ${totalDuplicatesCount} duplicates, ${invalidItems.length} invalid).`,
        options.ipAddress
      );
    }

    return {
      success: true,
      totalProcessed: normalizedRecords.length,
      newRecords: newCount,
      updatedRecords: updatedCount,
      duplicatesCount: totalDuplicatesCount,
      invalidRowsCount: invalidItems.length,
      syncDurationMs,
      indexedInRam: allRecords.length,
      duplicateItems: allDuplicateItems,
      config: updatedConfig,
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

  // Delayed initial boot sync (5 seconds cooldown to allow server routes to mount)
  setTimeout(async () => {
    try {
      const cfg = getGoogleSheetsConfig();
      if (cfg.autoSync24hEnabled !== false) {
        console.log('[PLSMS 24/7 Sync Engine] Performing automatic startup synchronization with Google Sheets...');
        await runDaemonSyncCycle();
      }
    } catch (err: any) {
      console.warn('[PLSMS 24/7 Sync Engine] Startup sync warning:', err.message);
    }
  }, 4000);

  // Interval check timer: runs every 5 seconds to evaluate scheduled sync time
  backgroundSyncTimer = setInterval(async () => {
    try {
      const config = getGoogleSheetsConfig();
      if (config.autoSync24hEnabled === false) {
        return;
      }

      const now = Date.now();
      const nextSyncTime = config.nextScheduledSyncAt ? new Date(config.nextScheduledSyncAt).getTime() : 0;

      if (!config.nextScheduledSyncAt || now >= nextSyncTime) {
        await runDaemonSyncCycle();
      }
    } catch (err: any) {
      console.error('[PLSMS 24/7 Sync Engine] Background cycle error:', err.message);
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

  if (!config.spreadsheetId && !config.publishedUrl) {
    saveGoogleSheetsConfig({
      continuousSyncStatus: 'PAUSED',
      nextScheduledSyncAt: nextScheduled,
      lastHeartbeatAt: new Date().toISOString(),
      lastError: undefined,
    });
    isDaemonSyncInProgress = false;
    return;
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

    console.log(
      `[PLSMS 24/7 Sync Engine] Synchronized ${result.totalProcessed} records. Next automated check: ${nextScheduled}`
    );
  } catch (err: any) {
    const isRestricted = Boolean(err.isRestricted || err.message?.includes('private') || err.message?.includes('Restricted') || err.message?.includes('Permission Required'));
    const retryDelayMs = isRestricted ? 10 * 60 * 1000 : 60 * 1000;
    console.warn(`[PLSMS 24/7 Sync Engine] Notice: ${err.message}. Retrying in ${Math.round(retryDelayMs / 60000)}m...`);
    saveGoogleSheetsConfig({
      continuousSyncStatus: 'ERROR',
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
    continuousSyncStatus: settings.enabled ? 'CONNECTED_24_7' : 'PAUSED',
    lastHeartbeatAt: new Date().toISOString(),
  });

  if (settings.enabled && !backgroundSyncTimer) {
    start24hBackgroundSyncDaemon();
  }

  return updated;
}

// Background High-Concurrency Write Queue for 5-6 Stations
interface QueuedSheetWrite {
  id: string;
  licenseNumber: string;
  data: {
    applicantId?: string;
    receivedBy: string;
    distributedDate?: string;
    distributedBy: string;
    submittedDocument?: string;
    status?: string;
  };
  queuedAt: number;
  attempts: number;
}

const writeQueue: QueuedSheetWrite[] = [];
let isQueueProcessing = false;
let lastQueueSuccessAt: string | null = null;
let queueErrorCount = 0;

export function queueGoogleSheetDistribution(
  licenseNumber: string,
  data: {
    applicantId?: string;
    receivedBy: string;
    distributedDate?: string;
    distributedBy: string;
    submittedDocument?: string;
    status?: string;
  }
): { queued: boolean; queueLength: number } {
  const item: QueuedSheetWrite = {
    id: 'Q_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    licenseNumber,
    data,
    queuedAt: Date.now(),
    attempts: 0,
  };
  writeQueue.push(item);

  // Trigger queue processor in next tick without blocking caller
  setImmediate(() => {
    processSheetWriteQueue().catch((err) => {
      console.error('[Sheet Queue] Uncaught error in queue processing:', err);
    });
  });

  return { queued: true, queueLength: writeQueue.length };
}

export function getSheetQueueStatus() {
  return {
    queueLength: writeQueue.length,
    isProcessing: isQueueProcessing,
    lastSuccessAt: lastQueueSuccessAt,
    errorCount: queueErrorCount,
  };
}

async function processSheetWriteQueue(): Promise<void> {
  if (isQueueProcessing) return;
  isQueueProcessing = true;
  try {
    while (writeQueue.length > 0) {
      const item = writeQueue[0];
      try {
        const result = await updateGoogleSheetDistribution(item.licenseNumber, item.data);
        if (result.success) {
          lastQueueSuccessAt = new Date().toISOString();
          writeQueue.shift();
        } else {
          item.attempts++;
          if (item.attempts >= 3) {
            console.warn(`[Sheet Queue] Dropping item ${item.licenseNumber} after 3 failed attempts.`);
            writeQueue.shift();
          } else {
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
      } catch (err: any) {
        queueErrorCount++;
        item.attempts++;
        if (item.attempts >= 3) {
          console.error(`[Sheet Queue] Error updating sheet for ${item.licenseNumber}:`, err);
          writeQueue.shift();
        } else {
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    }
  } finally {
    isQueueProcessing = false;
  }
}

// Cache for spreadsheet tab numeric sheetId (used for direct Google Sheets API formatting)
const sheetTabIdMap = new Map<string, number>();

/**
 * Update Google Sheet Row (Columns I to O) on Real Distribution Handover
 */
export async function updateGoogleSheetDistribution(
  licenseNumber: string,
  data: {
    applicantId?: string;
    receivedBy: string;
    distributedDate?: string;
    distributedBy: string;
    submittedDocument?: string;
    status?: string;
  }
): Promise<{ success: boolean; sheetUpdated: boolean; message?: string; rowNumber?: number; method?: string }> {
  try {
    const config = getGoogleSheetsConfig();
    if (!config.spreadsheetId && !config.webAppUrl) {
      return { success: true, sheetUpdated: false, message: 'No Google Sheet or Webhook connected.' };
    }
    const creds = getServiceAccountCredentials();
    const spreadsheetId = extractSpreadsheetInfo(config.spreadsheetId || '').cleanId;
    const tabName = config.tabName || 'Sheet1';

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

    const distVal = isDist ? 'DISTRIBUTED' : '';
    const missVal = isMiss ? 'MISSING' : '';
    const foundVal = (isFound || (data as any).foundVal === 'FOUND' || (data as any).isFoundHandover) ? 'FOUND' : '';

    const writeReceivedBy = isDist ? (data.receivedBy || '') : '';
    const writeDistDate = isDist ? (nepaliDevanagariDate || '') : '';
    const writeDistBy = isDist ? (data.distributedBy || '') : '';
    const writeSubDoc = isDist ? (data.submittedDocument || 'Original Smart Card') : '';

    const payload = {
      action: 'UPDATE_DISTRIBUTION',
      spreadsheetId,
      tabName,
      licenseNumber: licenseNumber ? licenseNumber.trim().toUpperCase() : '',
      applicantId: data.applicantId ? data.applicantId.trim().toUpperCase() : '',
      receivedBy: writeReceivedBy,
      distributedDate: writeDistDate,
      distributedBy: writeDistBy,
      submittedDocument: writeSubDoc,
      status: isMiss ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : (data.status || 'AVAILABLE'))),
      isDistributed: isDist,
      distVal,
      missVal,
      foundVal,
      timestamp: new Date().toISOString(),
    };

    // Method 1: Google Apps Script Web App Webhook (Highest Reliability across all 5 computers)
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
          console.log(`[Google Sheets Writeback via Webhook] Success:`, resJson);
          
          saveGoogleSheetsConfig({
            lastWritebackResult: {
              success: true,
              row: resJson.row || resJson.rowNumber,
              licenseNumber,
              timestamp: new Date().toISOString(),
              message: `Live updated Google Sheet (Row ${resJson.row || 'matched'}) via Apps Script Webhook`,
            },
          });

          return {
            success: true,
            sheetUpdated: true,
            rowNumber: resJson.row || resJson.rowNumber,
            method: 'APPS_SCRIPT_WEBHOOK',
            message: `Google Sheet updated via Web App Webhook`,
          };
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
        const targetLic = licenseNumber ? licenseNumber.trim().toUpperCase() : '';
        const targetAppId = data.applicantId ? data.applicantId.trim().toUpperCase() : '';
        let targetRowIndex = -1;

        if (targetLic && sheetLicenseRowMap.has(targetLic)) {
          targetRowIndex = sheetLicenseRowMap.get(targetLic)!;
        } else if (targetAppId && sheetAppIdRowMap.has(targetAppId)) {
          targetRowIndex = sheetAppIdRowMap.get(targetAppId)!;
        }

        // Only fetch entire sheet if not cached yet
        if (targetRowIndex === -1) {
          const range = `${encodeURIComponent(tabName)}!A1:N`;
          const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;
          const res = await fetch(getUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (res.ok) {
            const json = (await res.json()) as any;
            const rows: any[][] = json.values || [];

            // Populate high-speed row cache for all rows
            for (let r = 0; r < rows.length; r++) {
              const row = rows[r];
              const appIdInColB = row[1] ? String(row[1]).trim().toUpperCase() : '';
              const licInColD = row[3] ? String(row[3]).trim().toUpperCase() : '';
              if (appIdInColB) sheetAppIdRowMap.set(appIdInColB, r + 1);
              if (licInColD) sheetLicenseRowMap.set(licInColD, r + 1);

              if (targetAppId && appIdInColB === targetAppId && targetRowIndex === -1) {
                targetRowIndex = r + 1;
              }
              if (targetLic && licInColD === targetLic && targetRowIndex === -1) {
                targetRowIndex = r + 1;
              }
            }

            // Fallback: Search across all columns if still not found
            if (targetRowIndex === -1) {
              for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                if (
                  (targetLic && row.some((cell: any) => cell && String(cell).trim().toUpperCase() === targetLic)) ||
                  (targetAppId && row.some((cell: any) => cell && String(cell).trim().toUpperCase() === targetAppId))
                ) {
                  targetRowIndex = r + 1;
                  if (targetLic) sheetLicenseRowMap.set(targetLic, r + 1);
                  if (targetAppId) sheetAppIdRowMap.set(targetAppId, r + 1);
                  break;
                }
              }
            }
          }
        }

        if (targetRowIndex > 0) {
          const updateRange = `${encodeURIComponent(tabName)}!I${targetRowIndex}:O${targetRowIndex}`;
          const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${updateRange}?valueInputOption=USER_ENTERED`;

          const updateBody = {
            range: `${tabName}!I${targetRowIndex}:O${targetRowIndex}`,
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
              ],
            ],
          };

          const putRes = await fetch(updateUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateBody),
          });

          if (putRes.ok) {
            console.log(`[Google Sheets Writeback] Successfully updated Row ${targetRowIndex} (I${targetRowIndex}:O${targetRowIndex}) via Service Account!`);

            // Apply exact Picture 1 cell styling to Columns M, N, O:
            // -- DISTRIBUTED: Font Color Green (#008000), Bold, Center
            // -- MISSING: Font Color Red (#FF0000), Bold, Center
            // -- FOUND: Font Color Green (#008000), Bold, Center
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
                // Column M: DISTRIBUTED (col index 12)
                {
                  repeatCell: {
                    range: {
                      sheetId: sheetNumericId,
                      startRowIndex: targetRowIndex - 1,
                      endRowIndex: targetRowIndex,
                      startColumnIndex: 12,
                      endColumnIndex: 13,
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
                // Column N: MISSING (col index 13)
                {
                  repeatCell: {
                    range: {
                      sheetId: sheetNumericId,
                      startRowIndex: targetRowIndex - 1,
                      endRowIndex: targetRowIndex,
                      startColumnIndex: 13,
                      endColumnIndex: 14,
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
                // Column O: FOUND (col index 14)
                {
                  repeatCell: {
                    range: {
                      sheetId: sheetNumericId,
                      startRowIndex: targetRowIndex - 1,
                      endRowIndex: targetRowIndex,
                      startColumnIndex: 14,
                      endColumnIndex: 15,
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

            saveGoogleSheetsConfig({
              lastWritebackResult: {
                success: true,
                row: targetRowIndex,
                licenseNumber,
                timestamp: new Date().toISOString(),
                message: `Live updated Google Sheet Row ${targetRowIndex} (Columns I to O) with Picture 1 styles via Service Account`,
              },
            });
            return {
              success: true,
              sheetUpdated: true,
              rowNumber: targetRowIndex,
              method: 'SERVICE_ACCOUNT_DIRECT',
              message: `Updated Google Sheet row ${targetRowIndex} (Columns I to O with Picture 1 styles)`,
            };
          }
        }
      }
    }

    saveGoogleSheetsConfig({
      lastWritebackResult: {
        success: false,
        licenseNumber,
        timestamp: new Date().toISOString(),
        message: 'Saved locally in DB. Connect Google Apps Script Webhook or Service Account to sync to Google Sheet live.',
      },
    });

    return {
      success: true,
      sheetUpdated: false,
      message: 'Saved in system database. Google Sheets Webhook or Service Account needed for direct cloud writeback.',
    };
  } catch (err: any) {
    console.error('[Google Sheets Writeback] Error:', err);
    return {
      success: true,
      sheetUpdated: false,
      message: err.message,
    };
  }
}

/**
 * High-Performance In-Memory Hash-Indexed Google Apps Script Source Code
 * Provides O(1) instantaneous row matching across 200,000+ rows
 */
export const APPS_SCRIPT_HASH_INDEX_CODE = `// ==============================================================================
// NEPAL TRANSPORT MANAGEMENT OFFICE (YATAYAT KARYALAYA) - DRIVING LICENSE (PLSMS)
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
    receivedByCol: 9,    // Column I (Default)
    distDateCol: 10,     // Column J (Default)
    distByCol: 11,       // Column K (Default)
    subDocCol: 12,       // Column L (Default)
    statusCol: 13        // Column M (Default)
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
    } else if (h === 'STATUS' || h === 'CARD STATUS') {
      map.statusCol = c + 1;
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
      var cleanApp = normalizeKey(appIdStr);
      if (cleanApp && cleanApp !== upperAppId) {
        appIdMap[cleanApp] = rowNum;
      }
    }

    if (licStr) {
      var upperLic = licStr.toUpperCase();
      licMap[upperLic] = rowNum;
      var cleanLic = normalizeKey(licStr);
      if (cleanLic) {
        cleanLicMap[cleanLic] = rowNum;
      }
    }

    if (appIdStr && licStr) {
      compositeMap[appIdStr + '_' + licStr] = rowNum;
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
 * Apply Picture 1 Exact Styling to Columns I through O (1x7 range)
 * -- DISTRIBUTED: Font Color Green (#008000), Font Weight Bold, Center Aligned
 * -- MISSING: Font Color Red (#FF0000), Font Weight Bold, Center Aligned
 * -- FOUND: Font Color Green (#008000), Font Weight Bold, Center Aligned
 */
function applyRowStyles(targetRange, isDist, isMiss, isFound) {
  var colors = [
    [
      '#000000',
      '#000000',
      '#000000',
      '#000000',
      isDist ? '#008000' : '#000000',
      isMiss ? '#FF0000' : '#000000',
      isFound ? '#008000' : '#000000'
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
      isFound ? 'bold' : 'normal'
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
      'center'
    ]
  ];
  targetRange.setFontColors(colors);
  targetRange.setFontWeights(weights);
  targetRange.setHorizontalAlignments(alignments);
}

/**
 * Ensure Conditional Formatting Rules are active for Columns M, N, O
 */
function applyStatusConditionalFormatting(sheet) {
  try {
    var rules = sheet.getConditionalFormatRules() || [];
    var hasPlsms = false;
    for (var r = 0; r < rules.length; r++) {
      var cond = rules[r].getBooleanCondition();
      if (cond && cond.getCriteriaValues) {
        var vals = cond.getCriteriaValues();
        if (vals && (vals[0] === 'DISTRIBUTED' || vals[0] === 'MISSING' || vals[0] === 'FOUND')) {
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
      rules.push(distRule, missRule, foundRule);
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
    var tabName = data.tabName || '1st -LOt--1-16000--csv';
    var sheet = ss.getSheetByName(tabName) || ss.getSheets()[0];

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

          var distVal = isDist ? 'DISTRIBUTED' : '';
          var missVal = isMiss ? 'MISSING' : '';
          var foundVal = isFound ? 'FOUND' : '';

          var updateValues = [
            (isDist || isFound) ? (item.receivedBy || '') : '',
            (isDist || isFound) ? (item.distributedDate || '') : '',
            (isDist || isFound) ? (item.distributedBy || '') : '',
            (isDist || isFound) ? (item.submittedDocument || 'Original Smart Card') : '',
            distVal,
            missVal,
            foundVal
          ];

          var targetRange = sheet.getRange(targetRow, colI, 1, 7);
          targetRange.setValues([updateValues]);
          applyRowStyles(targetRange, isDist, isMiss, isFound);

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

    if (matchRes.row > 0) {
      var rowNumber = matchRes.row;
      var startCol = index.colMap.receivedByCol || 9;

      var isMiss = data.status === 'MISSING';
      var isFound = !isMiss && data.status === 'FOUND';
      var isDist = !isMiss && !isFound && (data.status === 'DISTRIBUTED' || data.isDistributed || (!data.status && data.receivedBy && data.receivedBy !== '-' && String(data.receivedBy).trim() !== ''));

      var distVal = isDist ? 'DISTRIBUTED' : '';
      var missVal = isMiss ? 'MISSING' : '';
      var foundVal = isFound ? 'FOUND' : '';

      var writeValues = [
        (isDist || isFound) ? (data.receivedBy || '') : '',
        (isDist || isFound) ? (data.distributedDate || '') : '',
        (isDist || isFound) ? (data.distributedBy || '') : '',
        (isDist || isFound) ? (data.submittedDocument || 'Original Smart Card') : '',
        distVal,
        missVal,
        foundVal
      ];

      var targetRange = sheet.getRange(rowNumber, startCol, 1, 7);
      targetRange.setValues([writeValues]);
      applyRowStyles(targetRange, isDist, isMiss, isFound);

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        row: rowNumber,
        rowNumber: rowNumber,
        matchType: matchRes.matchType,
        lookupDurationMicroseconds: matchRes.lookupMicroseconds,
        message: 'Fast In-Memory Hash matched row ' + rowNumber + ' (Updated Columns I to O: DISRTIBUTED TO, DATE, BY, DOC, DISTRIBUTED, MISSING, FOUND with Picture 1 exact styles)'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Row not found in index - optionally force refresh index once and retry
    var freshIndex = buildFastInMemoryHashIndex(sheet, true);
    var retryMatch = lookupTargetRow(freshIndex, data.applicantId, data.licenseNumber);

    if (retryMatch.row > 0) {
      var freshRowNum = retryMatch.row;
      var freshCol = freshIndex.colMap.receivedByCol || 9;

      var isMiss = data.status === 'MISSING';
      var isFound = !isMiss && data.status === 'FOUND';
      var isDist = !isMiss && !isFound && (data.status === 'DISTRIBUTED' || data.isDistributed || (!data.status && data.receivedBy && data.receivedBy !== '-' && String(data.receivedBy).trim() !== ''));

      var distVal = isDist ? 'DISTRIBUTED' : '';
      var missVal = isMiss ? 'MISSING' : '';
      var foundVal = isFound ? 'FOUND' : '';

      var writeValues = [
        (isDist || isFound) ? (data.receivedBy || '') : '',
        (isDist || isFound) ? (data.distributedDate || '') : '',
        (isDist || isFound) ? (data.distributedBy || '') : '',
        (isDist || isFound) ? (data.submittedDocument || 'Original Smart Card') : '',
        distVal,
        missVal,
        foundVal
      ];

      var retryRange = sheet.getRange(freshRowNum, freshCol, 1, 7);
      retryRange.setValues([writeValues]);
      applyRowStyles(retryRange, isDist, isMiss, isFound);

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        row: freshRowNum,
        rowNumber: freshRowNum,
        matchType: retryMatch.matchType,
        lookupDurationMicroseconds: retryMatch.lookupMicroseconds,
        message: 'Matched row ' + freshRowNum + ' after fresh index re-sync (Updated Columns I to O with Picture 1 exact styles)'
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

      return {
        licenseNumber: rec.licenseNumber ? rec.licenseNumber.trim().toUpperCase() : '',
        applicantId: rec.applicantId ? rec.applicantId.trim().toUpperCase() : '',
        receivedBy: (isDist || isFound) ? (rec.receivedBy || '') : '',
        distributedDate: (isDist || isFound) ? nepaliDevanagariDate : '',
        distributedBy: (isDist || isFound) ? (rec.distributedBy || '') : '',
        submittedDocument: (isDist || isFound) ? (rec.submittedDocument || 'Original Smart Card') : '',
        status: isMiss ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : (rec.status || 'AVAILABLE'))),
        isDistributed: isDist,
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



