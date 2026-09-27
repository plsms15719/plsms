export type LicenseStatus = 'AVAILABLE' | 'DISTRIBUTED' | 'MISSING' | 'FOUND' | 'PENDING' | 'EXPIRED' | 'CANCELLED';

export interface LicenseRecord {
  id: string;
  sn?: number | string; // Column A: S.N.
  sheetRow?: number; // Google Sheet Row Number
  sourceSheet?: string; // Source Google Sheet ID or name
  sheetTab?: string; // Source Sheet Tab name
  applicantId?: string; // Column B: APPLICANT ID
  applicationNumber: string; // Column B
  holderName: string; // Column C: FULL NAME
  licenseNumber: string; // Column D: LICENSE NUMBER
  category?: string; // Column E: CATEGORY
  vehicleClass?: string; // Column E
  oldCode?: string; // Column F: OLD CODE
  newCode?: string; // Column G: NEW CODE
  department?: string; // Column H: DEPARTMENT
  office: string; // Column H: DEPARTMENT / Office
  receivedBy?: string; // Column I: RECEIVED BY
  receiverName?: string; // Column I: RECEIVED BY / Receiver
  distributedTo?: string; // Column I: DISTRIBUTED TO / Receiver
  distributedDate?: string; // Column J: DISTRIBUTED DATE
  distributedAt?: string; // Column J: DISTRIBUTED DATE (ISO)
  distributedBy?: string; // Column K: DISTRIBUTED BY
  submittedDocument?: string; // Column L: SUBMITTED DOC.
  status: LicenseStatus; // Column M: STATUS
  mainStatus?: 'DISTRIBUTED' | 'NOT_DISTRIBUTED'; // Core classification: Total Cards = Not-Distributed + Distributed
  issueFlag?: 'NORMAL' | 'MISSING'; // Sub-status under DISTRIBUTED
  fatherOrSpouseName?: string;
  dateOfBirth?: string;
  phone?: string;
  mobileNumber?: string;
  nidOrPassport?: string;
  address?: string;
  licenseType?: string;
  issueDate?: string;
  expiryDate?: string;
  smartCardSerial?: string;
  importId: string;
  importedAt: string;
  updatedAt: string;
  isDistributed: boolean;
  receiverNid?: string;
  receiverPhone?: string;
  receiverRelation?: string;
  receiverRemarks?: string;
  recommendingStaffName?: string;
  handoverReference?: string;
  missingReason?: string;
  missingReportedAt?: string;
  missingReportedBy?: string;
  missingMarkedBy?: string;
  missingMarkedSource?: 'APP_BUTTON' | 'IMPORTED_UNKNOWN' | string;
  missingDate?: string;
  foundReason?: string;
  foundReportedAt?: string;
  foundReportedBy?: string;
  foundBy?: string;
  foundDate?: string;
  foundHandoverDone?: boolean;
  rawRecord?: Record<string, any>;
  matchingInfo?: MatchingParityInfo;
  matchingParity?: MatchingParityInfo;
}

export type MapMatchLevel = 'KAP_4COL' | 'COMPOSITE' | 'EXACT_LIC' | 'CLEAN_LIC' | 'APP_ID' | 'UNMATCHED';

export interface MatchingParityInfo {
  isMatched: boolean;
  matchLevel: MapMatchLevel;
  matchedColKey?: string;
  counterpartStatus?: string;
  statusAgreed?: boolean;
  counterpartSheetRow?: number;
  counterpartRecordId?: string;
  otherPlatformRecord?: {
    id?: string;
    applicantId?: string;
    holderName?: string;
    licenseNumber?: string;
    category?: string;
    status?: string;
    receivedBy?: string;
    distributedDate?: string;
    distributedBy?: string;
    submittedDocument?: string;
  };
  isStatusInSync: boolean;
  sourcePlatform: 'DB' | 'SHEET';
  counterpartPlatform: 'DB' | 'SHEET';
}

export interface CrossPlatformParityStats {
  success?: boolean;
  totalDbRecords: number;
  totalSheetRecords: number;
  kap4ColMatchedCount: number;
  compositeMatchedCount: number;
  exactLicMatchedCount: number;
  cleanLicMatchedCount: number;
  appIdMatchedCount: number;
  inSyncCount: number;
  statusMismatchCount: number;
  onlyInDbCount: number;
  onlyInSheetCount: number;
  syncParityPercentage: number;
  lastCalculatedAt: string;

  // Compatibility aliases
  dbTotal?: number;
  sheetTotal?: number;
  matchedKAP4Col?: number;
  kapMatchPercentage?: number;
  matchedTotal?: number;
  statusAgreedTotal?: number;
  statusAgreementPercentage?: number;
  statusDriftTotal?: number;
}

export interface PermissionItem {
  id: string;
  name: string;
  description?: string;
  category: string;
}

export interface PermissionGroup {
  key: string;
  title: string;
  badgeCode: string;
  permissions: PermissionItem[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'SUPER ADMIN' | 'ADMINISTRATOR' | 'DATA ENTRY OFFICER' | 'SMART CARD DISTRIBUTER' | 'SUPER_ADMIN' | 'ADMIN' | 'DATA_ENTRY_OFFICER' | 'SMART_CARD_DISTRIBUTOR' | string;
  post?: string;
  phone?: string;
  status?: 'ACTIVE' | 'SUSPENDED';
  permissions?: string[];
  createdAt: string;
  lastLogin?: string;
  mustChangePassword?: boolean;
  isDefaultPassword?: boolean;
  passwordChanged?: boolean;
  passwordChangedAt?: string;
  passwordHash?: string;
  mPinHash?: string;
  hasChangedMpin?: boolean;
  isDefaultMpin?: boolean;
  mPinUpdatedAt?: string;
  mPinUpdatedBy?: string;
}

export interface ImportJob {
  id: string;
  filename: string;
  lotCode?: string;
  nepaliDate?: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  totalRows: number;
  newRecords: number;
  updatedRecords: number;
  duplicateRecords: number;
  invalidRecords: number;
  successfullyImported?: number;
  missingApplicantId?: number;
  missingLicenseNumber?: number;
  otherInvalidRows?: number;
  missingApplicantItems?: any[];
  missingLicenseItems?: any[];
  status: 'COMPLETED' | 'PROCESSING' | 'FAILED';
  durationMs: number;
  jsonStoragePath?: string;
  originalStoragePath?: string;
  columnMapping: Record<string, string>;
  errorMessage?: string;
  duplicateItems?: {
    licenseNumber: string;
    holderName?: string;
    office?: string;
    existingRecord?: any;
    incomingRecord?: any;
  }[];
}

export interface DistributionRecord {
  id: string;
  licenseId: string;
  licenseNumber: string;
  holderName: string;
  receiverName: string;
  receiverNid: string;
  receiverPhone: string;
  receiverRelation: 'SELF' | 'AUTHORIZED_REPRESENTATIVE' | 'FAMILY_MEMBER' | 'COURIER' | 'OTHER';
  office: string;
  distributedBy: string;
  distributedAt: string;
  distributedDate?: string;
  remarks?: string;
  submittedDocument?: string;
  recommendingStaffName?: string;
  handoverReference: string;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  category: 'AUTH' | 'IMPORT' | 'DISTRIBUTION' | 'RECORD_UPDATE' | 'STATUS_CHANGE' | 'MISSING' | 'FOUND' | 'REPORT' | 'SECURITY';
  details: string;
  ipAddress?: string;
}

export interface DashboardStats {
  totalRecords: number;
  availableRecords: number;
  notDistributedRecords?: number;
  distributedRecords: number;
  missingRecords: number;
  foundRecords?: number;
  handedOverRecords?: number;
  pendingRecords: number;
  expiredRecords: number;
  totalImports: number;
  totalDistributions: number;
  officeDistribution: {
    office: string;
    total: number;
    available: number;
    distributed: number;
    missing: number;
    found?: number;
    handedOver?: number;
  }[];
  recentDistributions: DistributionRecord[];
  recentImports: ImportJob[];
}

export interface AlphabeticalStatItem {
  letter: string;
  label: string;
  count: number;
  distributed: number;
  remained: number;
}

export interface AlphabeticalDashboardData {
  items: AlphabeticalStatItem[];
  totalCount: number;
  totalDistributed: number;
  totalRemained: number;
  fromDate?: string;
  toDate?: string;
}

export interface PublicSearchResult {
  found: boolean;
  licenseNumber?: string;
  applicationNumber?: string;
  applicantId?: string;
  holderName?: string;
  status?: LicenseStatus | 'NOT_FOUND';
  office?: string;
  department?: string;
  category?: string;
  vehicleClass?: string;
  oldCode?: string;
  newCode?: string;
  issueDate?: string;
  expiryDate?: string;
  pickupInstructions?: string;
  message?: string;
  record?: LicenseRecord;
  records?: LicenseRecord[];
  totalMatches?: number;
  visitorCount?: number;
}

export interface NoticeAttachment {
  name: string;
  size: number;
  type: string;
  url: string;
  uploadedAt: string;
}

export interface OfficeNotice {
  id: string;
  title: string;
  content: string;
  publishedDateBS: string;
  publishedDateAD: string;
  publishedBy: string;
  authorName?: string;
  status: 'ACTIVE' | 'DISABLED';
  isPinned?: boolean;
  priority?: 'NORMAL' | 'IMPORTANT' | 'URGENT';
  category?: 'DISTRIBUTION' | 'TIMING' | 'HOLIDAY' | 'DOCUMENTS' | 'GENERAL';
  department?: string;
  attachment?: NoticeAttachment | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminActiveView =
  | 'DASHBOARD'
  | 'SEARCH_RECORDS'
  | 'UPLOAD_CENTER'
  | 'DISTRIBUTION'
  | 'MISSING_RECORDS'
  | 'FOUND_RECORDS'
  | 'HANDED_OVER_RECORDS'
  | 'NOTICES'
  | 'REPORTS'
  | 'AUDIT_LOGS'
  | 'SETTINGS';

export interface ColumnMapping {
  sn?: string; // Column A: S.N.
  applicantId?: string; // Column B: APPLICANT ID
  applicationNumber: string; // Column B: APPLICANT ID
  holderName: string; // Column C: FULL NAME
  licenseNumber: string; // Column D: LICENSE NUMBER
  category?: string; // Column E: CATEGORY
  vehicleClass?: string;
  oldCode?: string; // Column F: OLD CODE
  newCode?: string; // Column G: NEW CODE
  office: string; // Column H: DEPARTMENT
  department?: string;
  receivedBy?: string; // Column I: RECEIVED BY
  receiverName?: string;
  distributedTo?: string; // Column I: DISTRIBUTED TO / Receiver
  distributedDate?: string; // Column J: DISTRIBUTED DATE
  distributedAt?: string;
  distributedBy?: string; // Column K: DISTRIBUTED BY
  submittedDocument?: string; // Column L: SUBMITTED DOC.
  status?: string; // Column M: STATUS
  dateOfBirth?: string;
  phone?: string;
  nidOrPassport?: string;
  address?: string;
  licenseType?: string;
  issueDate?: string;
  expiryDate?: string;
  smartCardSerial?: string;
}

export interface GoogleSheetsConfig {
  appletId?: string;
  isClonedMasterState?: boolean;
  isRemixedApp?: boolean;
  spreadsheetId: string;
  tabName: string;
  publishedUrl: string;
  lastSyncAt: string | null;
  syncState: 'READY' | 'SYNCED' | 'SYNCING' | 'ERROR' | 'IDLE' | 'NOT_CONNECTED';
  indexedInRam: number;
  lastSyncDurationMs: number;
  duplicatesCount: number;
  invalidRowsCount: number;
  totalSheetRows?: number;
  successfullyImported?: number;
  missingApplicantIdCount?: number;
  missingLicenseNumberCount?: number;
  otherInvalidRowsCount?: number;
  missingApplicantItems?: Array<{
    sheetRow: number;
    sn?: string;
    applicantId?: string;
    holderName?: string;
    licenseNumber?: string;
    category?: string;
    department?: string;
    reason: string;
    rawRow?: any;
  }>;
  missingLicenseItems?: Array<{
    sheetRow: number;
    sn?: string;
    applicantId?: string;
    holderName?: string;
    licenseNumber?: string;
    category?: string;
    department?: string;
    reason: string;
    rawRow?: any;
  }>;
  sheetStats?: {
    totalRecords: number;
    availableRecords: number;
    distributedRecords: number;
    missingRecords: number;
    foundRecords?: number;
    handedOverRecords?: number;
  };
  invalidItems?: Array<{
    sheetRow: number;
    sn?: string;
    applicantId?: string;
    holderName?: string;
    licenseNumber?: string;
    category?: string;
    department?: string;
    reason: string;
    rawRow?: any;
  }>;
  lastError?: string;
  duplicateItems?: any[];
  webAppUrl?: string; // Google Apps Script Web App Webhook URL for 100% live multi-computer writeback
  daemonUrl?: string; // 24/7 Sync Daemon Service URL / configuration endpoint
  syncDaemonUrl?: string; // Alias for daemonUrl
  writebackMode?: 'APPS_SCRIPT_WEBHOOK' | 'SERVICE_ACCOUNT' | 'AUTO';
  lastWritebackResult?: {
    success: boolean;
    status?: 'SUCCESS' | 'FAILED' | 'QUEUED' | 'UNCONFIGURED' | string;
    row?: number;
    licenseNumber?: string;
    timestamp?: string;
    message?: string;
  };
  serviceAccountEmail?: string;
  serviceAccountConfigured?: boolean;
  proxyMode?: 'SERVICE_ACCOUNT' | 'BACKEND_PROXY';
  autoSync24hEnabled?: boolean;
  autoSyncIntervalSeconds?: number;
  nextScheduledSyncAt?: string | null;
  continuousSyncStatus?: 'ACTIVE' | 'CONNECTED_24_7' | 'SYNCING' | 'PAUSED' | 'ERROR' | 'RECONNECTING' | 'TEMPORARILY_UNAVAILABLE' | 'INACTIVE';
  successful24hSyncCount?: number;
  lastHeartbeatAt?: string | null;
}

export interface BenchmarkResult {
  totalQueries: number;
  totalIndexed: number;
  totalTimeMs: number;
  averageLatencyMs: number;
  averageLatencyMicroseconds: number;
  throughputQps: number;
  sampleLookups: Array<{ query: string; found: boolean; durationMicroseconds: number }>;
}

export interface SecurityPinStatus {
  isConfigured: boolean;
  isDefault: boolean;
  updatedAt: string;
  updatedBy: string;
  locked: boolean;
  lockedUntil: string | null;
  failedAttempts: number;
}

// =========================================================================
// CLEAR CARD DATA / PRODUCTION INITIALIZATION ARCHITECTURE TYPES
// =========================================================================
export interface ClearCardDataTargetItem {
  table: string;
  store: string;
  description: string;
  recordCount: number;
  category: 'CARD_RECORDS' | 'DISTRIBUTION_LOGS' | 'STATUS_OVERRIDES' | 'IMPORT_JOBS';
  impact: 'PLANNED_CLEAR';
}

export interface ClearCardDataPreservedItem {
  table: string;
  store: string;
  description: string;
  recordCount: number | string;
  category: 'STAGING_DATA' | 'USER_ACCOUNTS' | 'AUDIT_LOGS' | 'CONFIGURATION' | 'NOTICES' | 'VISITOR_COUNTER';
  protectionStatus: 'STRICTLY_PROTECTED_UNTOUCHED';
  notes?: string;
}

export interface ClearCardDataPreview {
  featureName: string;
  mode: 'READ_ONLY_PREVIEW';
  generatedAt: string;
  targetTablesAndStores: ClearCardDataTargetItem[];
  preservedTablesAndStores: ClearCardDataPreservedItem[];
  summary: {
    totalCardRecordsToClear: number;
    totalDistributionsToClear: number;
    totalActionOverridesToClear: number;
    totalImportJobsToClear: number;
    stagingRecordsRetained: number;
    userAccountsRetained: number;
    auditLogsRetained: number;
  };
  safetyArchitecture: {
    transactionRollbackEngineReady: boolean;
    stagingShieldActive: boolean;
    superAdminAuthRequired: boolean;
    phaseStatus: 'PREVIEW_AND_SAFETY_ARCH_ONLY';
    destructiveExecutionEnabled: boolean;
    lockStatus: string;
  };
}

export interface ClearCardDataVerifyPayload {
  password: string;
  confirmationPhrase: string;
  acknowledged: boolean;
}

export interface ClearCardDataVerifyResponse {
  success: boolean;
  mode: 'PREVIEW_AND_SAFETY_ARCH_ONLY';
  dryRunPassed: boolean;
  message: string;
  preview: ClearCardDataPreview;
  details: {
    transactionRollbackVerified: boolean;
    recordsStagingProtected: boolean;
    stagingCount: number;
    targetRecordsCount: number;
    targetDistributionsCount: number;
    auditLogsPreserved: boolean;
    usersPreserved: boolean;
    executionState: string;
    notice: string;
  };
}

