import {
  User,
  LicenseRecord,
  DistributionRecord,
  ImportJob,
  AuditLogItem,
  DashboardStats,
  AlphabeticalDashboardData,
  PublicSearchResult,
  LicenseStatus,
  ColumnMapping,
  OfficeNotice,
  NoticeAttachment,
  SecurityPinStatus,
  CrossPlatformParityStats,
  ClearCardDataPreview,
  ClearCardDataVerifyPayload,
  ClearCardDataVerifyResponse,
} from '../types';
import { getNepaliDate } from '../utils/dateUtils';
import { safeStorage } from '../utils/storage';

const API_BASE = '/api';

export function getStoredToken(): string | null {
  return safeStorage.getItem('plsms_auth_token');
}

function getAuthHeaders(extraHeaders: Record<string, string> = {}) {
  const token = getStoredToken();
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };
}

/**
 * Authoritative Server Readiness Check
 * Queries /api/health with cache-busting timestamp and no-cache headers.
 * Returns true if and only if the server returns HTTP 200 with { status: 'ok' }.
 * Never uses stale frontend state, cached responses, generic text matching, or old warm-up flags.
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health?_t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
    if (res.status === 200) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        return data?.status === 'ok';
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Ensures backend server is ready before sensitive operations.
 * If server is genuinely starting up, retries automatically every 400ms.
 * Once /api/health returns HTTP 200, returns true immediately.
 */
export async function waitForServerReady(maxWaitMs = 15000): Promise<boolean> {
  if (await checkServerHealth()) {
    return true;
  }
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 400));
    if (await checkServerHealth()) {
      return true;
    }
  }
  return false;
}

async function safeFetchJson<T = any>(
  url: string,
  options?: RequestInit,
  defaultErrorMsg = 'Server request failed'
): Promise<T> {
  const maxRetries = 35;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const finalOptions: RequestInit = {
        cache: 'no-store',
        ...options,
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          ...(options?.headers || {}),
        },
      };

      const res = await fetch(url, finalOptions);
      const contentType = res.headers.get('content-type') || '';

      // Check if proxy temporarily returned 502, 503, or 504
      const isHttpUnavailable = res.status === 502 || res.status === 503 || res.status === 504;
      if (isHttpUnavailable) {
        // Probe authoritative server health
        const isHealthy = await checkServerHealth();
        if (isHealthy) {
          // Backend is alive and healthy: retry immediately without showing warm-up message
          if (attempt < maxRetries) {
            attempt++;
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }
          throw new Error('Server request temporarily delayed. Please retry.');
        }

        // Genuine server startup in progress: retry automatically with backoff
        if (attempt < maxRetries) {
          attempt++;
          const backoff = Math.min(300 + attempt * 150, 1500);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw new Error('Server connection unavailable. Please refresh your browser.');
      }

      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (!res.ok) {
          const err: any = new Error(json.error || json.message || defaultErrorMsg);
          err.isRestricted = Boolean(json.isRestricted);
          err.isNotFound = Boolean(json.isNotFound);
          err.sheetUrl = json.sheetUrl;
          err.spreadsheetId = json.spreadsheetId;
          err.serviceAccountEmail = json.serviceAccountEmail;
          err.detectedTabName = json.detectedTabName;
          err.status = res.status;
          throw err;
        }
        return json as T;
      }

      // Response is non-JSON (e.g. 413, 401, 404, or HTML during reverse-proxy warm-up)
      const rawText = await res.text();
      const trimmedText = rawText.trim();

      // Check if response text is valid JSON despite missing or custom content-type header
      if ((trimmedText.startsWith('{') && trimmedText.endsWith('}')) || (trimmedText.startsWith('[') && trimmedText.endsWith(']'))) {
        try {
          const json = JSON.parse(trimmedText);
          if (!res.ok) {
            const err: any = new Error(json.error || json.message || defaultErrorMsg);
            err.isRestricted = Boolean(json.isRestricted);
            err.isNotFound = Boolean(json.isNotFound);
            err.sheetUrl = json.sheetUrl;
            err.spreadsheetId = json.spreadsheetId;
            err.serviceAccountEmail = json.serviceAccountEmail;
            err.detectedTabName = json.detectedTabName;
            err.status = res.status;
            throw err;
          }
          return json as T;
        } catch (e: any) {
          if (e.status) throw e;
        }
      }

      // If HTML returned for an /api/ route (e.g. Nginx proxy page during container start)
      const isHtmlResponse = rawText.includes('<!DOCTYPE') || rawText.includes('<!doctype') || rawText.includes('<html');
      const isNginxWarmupPage =
        isHtmlResponse &&
        (url.includes('/api') ||
         rawText.includes('Please wait while your application starts') ||
         rawText.includes('Starting Server...') ||
         rawText.includes('/var/www/assets/warmup') ||
         rawText.includes('warmup_start_time') ||
         rawText.includes('502 Bad Gateway') ||
         rawText.includes('503 Service Unavailable') ||
         rawText.includes('504 Gateway Time-out'));

      if (isNginxWarmupPage) {
        // Authoritative server health check
        const isHealthy = await checkServerHealth();
        if (isHealthy) {
          // Backend is alive: retry request immediately without showing warm-up message
          if (attempt < maxRetries) {
            attempt++;
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }
          throw new Error('Server request temporarily delayed. Please retry.');
        }

        // Genuine container spin-up: retry automatically
        if (attempt < maxRetries) {
          attempt++;
          const backoff = Math.min(300 + attempt * 150, 1500);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw new Error('Server connection unavailable. Please refresh your browser.');
      }

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Your session has expired. Please log in again.');
        }
        if (res.status === 403) {
          throw new Error('Access denied. Administrator privileges required.');
        }
        if (res.status === 413) {
          throw new Error('File size exceeds server upload limit.');
        }
        if (res.status === 404) {
          throw new Error('API route not found. Please refresh your browser.');
        }
        if (res.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a moment before saving again.');
        }
        throw new Error(rawText || defaultErrorMsg);
      }

      try {
        return JSON.parse(rawText) as T;
      } catch {
        throw new Error(`Unexpected server response format.`);
      }
    } catch (err: any) {
      if (err.isRestricted || err.isNotFound || err.status) {
        throw err;
      }

      const isNetworkError =
        err.name === 'TypeError' ||
        (err.message && (
          err.message.includes('Failed to fetch') ||
          err.message.includes('NetworkError') ||
          err.message.includes('network') ||
          err.message.includes('Load failed')
        ));

      if (isNetworkError && attempt < maxRetries) {
        // Authoritative probe: check if backend is actually healthy
        const isHealthy = await checkServerHealth();
        attempt++;
        const backoff = isHealthy ? 150 : Math.min(300 + attempt * 150, 1500);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      if (err.message && (err.message.includes('<!doctype') || err.message.includes('Unexpected token') || err.message.includes('<!DOCTYPE'))) {
        throw new Error('Server connection error. Please refresh your browser.');
      }
      throw err;
    }
  }

  throw new Error(defaultErrorMsg);
}

export function broadcastRecordUpdated(detail?: any) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('plsms:record-updated', { detail: detail || { timestamp: Date.now() } }));
  }
}

export function getSearchSessionId(): string {
  try {
    let sid = safeStorage.getItem('plsms_search_sid');
    if (!sid) {
      sid = 'sid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      safeStorage.setItem('plsms_search_sid', sid);
    }
    return sid;
  } catch {
    return 'default_sid';
  }
}

export const DEFAULT_FALLBACK_NOTICES: OfficeNotice[] = [
  {
    id: 'NOTICE_1788621682829_1ciy5',
    title: 'स्मार्ट कार्ड वितरण सम्बन्धी सूचना ।।',
    content:
      'यातायात व्यवस्था विभाग, मिनभवन, काठमाण्डौबाट Backlog License हरु कार्यालयमा प्रिन्ट भई आएको र उक्त लाईसेन्सहरु वितरण गर्नकोलागि तयारी अवस्थामा रहेकोले सेवाग्राहीहरुले आफ्नो Smart Card आए नआएको एकिन गर्नको लागि तलको लिंकमा Click गर्नुहोला । \n\nयदि तपाईको लाईसेन्स आएको पाईएमा यस कार्यालयमा सोमबारदेखि शुक्रबारसम्म उल्लेखित शाखामा सम्पर्क राख्नु हुन अनुरोध गरिन्छ ।\nhttps://drive.google.com/file/d/1ZbmCy1c8MKIcrfEpjHEVVUvu08mPElym/view',
    publishedDateBS: '2083-05-20',
    publishedDateAD: '2026-09-05T15:21:22.829Z',
    publishedBy: 'SUPER ADMIN',
    authorName: 'KOMAL DAHAL',
    status: 'ACTIVE',
    isPinned: true,
    priority: 'NORMAL',
    category: 'GENERAL',
    department: 'Department - क & Department - ख',
    createdAt: '2026-09-05T15:21:22.829Z',
    updatedAt: '2026-09-05T15:21:22.829Z',
  },
  {
    id: 'NOTICE_1',
    title: 'Smart Driving License Cards Available for Collection',
    content:
      'Smart cards are available in the offices so we announce you to all to contact in office to collect your smart cards. Please bring your original application slip/receipt, citizenship certificate, and valid identification to collect your printed smart driving license.',
    publishedDateBS: '2083-05-15',
    publishedDateAD: '2026-09-01T08:00:00.000Z',
    publishedBy: 'SUPER ADMIN',
    authorName: 'KOMAL DAHAL',
    status: 'ACTIVE',
    isPinned: true,
    priority: 'IMPORTANT',
    category: 'DISTRIBUTION',
    department: 'Department - क & Department - ख',
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
  },
  {
    id: 'NOTICE_2',
    title: 'Smart Card Distribution Schedule (Monday to Friday, 9:30 AM to 4:30 PM)',
    content:
      'Smart cards will be distributed by Monday to Friday from 9:30 to 4:30 in Department - क and Department - ख. All applicants are kindly requested to visit during these designated office hours.',
    publishedDateBS: '2083-05-15',
    publishedDateAD: '2026-09-01T09:00:00.000Z',
    publishedBy: 'SUPER ADMIN',
    authorName: 'KOMAL DAHAL',
    status: 'ACTIVE',
    isPinned: false,
    priority: 'NORMAL',
    category: 'TIMING',
    department: 'Department - क & Department - ख',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
];

export const api = {
  // System Status
  async getSystemStatus(): Promise<{
    systemName: string;
    usersCount: number;
    recordsCount: number;
    setupCompleted: boolean;
  }> {
    return safeFetchJson(`${API_BASE}/system/status`, undefined, 'Failed to fetch system status');
  },

  // First-run Super Admin Setup
  async setupSuperAdmin(data: { email: string; password: string; name?: string }): Promise<{
    success: boolean;
    user: User;
    token: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/auth/setup-super-admin`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      'Failed to setup Super Admin'
    );
  },

  // System Login (Email or User ID)
  async login(data: { email?: string; identifier?: string; username?: string; password: string }): Promise<{
    success: boolean;
    user: User;
    token: string;
    mustChangePassword?: boolean;
  }> {
    // Authoritative check: if server is temporarily in cold startup, wait until /api/health returns HTTP 200
    const isReady = await checkServerHealth();
    if (!isReady) {
      await waitForServerReady(15000);
    }

    const rawId = (data.identifier || data.username || data.email || '').trim();
    const payload = {
      email: rawId,
      identifier: rawId,
      username: rawId,
      userId: rawId,
      password: data.password,
    };

    return safeFetchJson(
      `${API_BASE}/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'Invalid credentials'
    );
  },

  // Authoritative Server Health Check
  checkHealth: checkServerHealth,
  waitForServerReady,

  // Validate Credentials / Password against Database
  async validatePasswordPrefix(identifier: string, passwordOrPrefix: string): Promise<boolean> {
    try {
      const res = await safeFetchJson<{ valid: boolean }>(
        `${API_BASE}/auth/validate-prefix`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password: passwordOrPrefix, prefix: passwordOrPrefix }),
        },
        'Prefix check failed'
      );
      return Boolean(res?.valid);
    } catch {
      return false;
    }
  },

  // Get Current Authenticated User
  async getCurrentUser(): Promise<{ user: User }> {
    return safeFetchJson(
      `${API_BASE}/auth/me`,
      {
        headers: getAuthHeaders(),
      },
      'Session expired'
    );
  },

  // Change Password (Super Admin or Staff User, including compulsory first login)
  async changePassword(data: { currentPassword?: string; newPassword: string; isFirstLogin?: boolean }): Promise<{ success: boolean; message: string; user?: User }> {
    return safeFetchJson(
      `${API_BASE}/auth/change-password`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to change password'
    );
  },

  // Public Search & Probable Suggestions
  async publicSearch(query: string, isNewSearch: boolean = true): Promise<PublicSearchResult> {
    const countParam = isNewSearch ? '1' : '0';
    const sid = getSearchSessionId();
    return safeFetchJson(
      `${API_BASE}/public/search?q=${encodeURIComponent(query)}&count=${countParam}&sid=${encodeURIComponent(sid)}`,
      undefined,
      'Search failed'
    );
  },

  async resetSearchSession(): Promise<{ success: boolean }> {
    const sid = getSearchSessionId();
    return safeFetchJson(
      `${API_BASE}/public/search-reset?sid=${encodeURIComponent(sid)}`,
      { method: 'POST' },
      'Failed to reset search session'
    ).catch(() => ({ success: true }));
  },

  async getPublicSuggestions(query: string, limit = 8): Promise<{ suggestions: any[] }> {
    return safeFetchJson(
      `${API_BASE}/public/suggestions?q=${encodeURIComponent(query)}&limit=${limit}`,
      undefined,
      'Failed to fetch suggestions'
    );
  },

  async getPublicStats(): Promise<DashboardStats> {
    return safeFetchJson(
      `${API_BASE}/public/stats`,
      undefined,
      'Failed to fetch public stats'
    );
  },

  // Visitor Search Counter (Server-persisted & Cross-Version Resilient)
  async getVisitorCounter(clientCount?: number): Promise<{ count: number }> {
    const url = clientCount && clientCount > 0 
      ? `${API_BASE}/public/visitor-counter?clientCount=${encodeURIComponent(clientCount)}` 
      : `${API_BASE}/public/visitor-counter`;
    return safeFetchJson(
      url,
      undefined,
      'Failed to fetch visitor counter'
    );
  },

  // Calibrate & Permanently Set Visitor Counter (Super Admin)
  async calibrateVisitorCounter(
    targetCount: number,
    reason?: string
  ): Promise<{ success: boolean; count: number; message: string }> {
    return safeFetchJson(
      `${API_BASE}/admin/visitor-counter/calibrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCount, reason }),
      },
      'Failed to calibrate visitor counter'
    );
  },

  // Upload Preview (Detect Columns & Row Preview)
  async previewUpload(file: File): Promise<{
    success: boolean;
    filePath: string;
    fileName: string;
    fileSize: number;
    totalRows: number;
    detectedHeaders: string[];
    suggestedMapping: Partial<ColumnMapping>;
    previewRows: any[];
  }> {
    const formData = new FormData();
    formData.append('file', file);

    const token = getStoredToken();
    return safeFetchJson(
      `${API_BASE}/upload/preview`,
      {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      },
      'Failed to preview upload'
    );
  },

  // Process Real Import -> JSON -> Database Batch
  async processUpload(data: {
    filePath: string;
    fileName: string;
    fileSize: number;
    mapping: ColumnMapping;
  }): Promise<{
    success: boolean;
    importJob: ImportJob;
    message: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/upload/process`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Batch import failed'
    );
  },

  // Search Admin Records
  async getRecords(params: {
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
  }): Promise<{
    records: LicenseRecord[];
    total: number;
    page: number;
    totalPages: number;
    limit: number;
  }> {
    const queryParams = new URLSearchParams();
    if (params.q) queryParams.set('q', params.q);
    if (params.strictIdOrLicense) queryParams.set('strictIdOrLicense', 'true');
    if (params.status) queryParams.set('status', params.status);
    if (params.office) queryParams.set('office', params.office);
    if (params.page) queryParams.set('page', String(params.page));
    if (params.limit) queryParams.set('limit', String(params.limit));
    if (params.sortBy) queryParams.set('sortBy', params.sortBy);
    if (params.sortOrder) queryParams.set('sortOrder', params.sortOrder);
    if (params.fromDateBS) queryParams.set('fromDateBS', params.fromDateBS);
    if (params.toDateBS) queryParams.set('toDateBS', params.toDateBS);
    queryParams.set('_t', String(Date.now()));

    return safeFetchJson(
      `${API_BASE}/records?${queryParams.toString()}`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch records'
    );
  },

  // Autocomplete / Probable Number Suggestions
  async getRecordSuggestions(query: string, limit = 8): Promise<{
    suggestions: Array<{
      type: 'APPLICANT_ID' | 'LICENSE_NO';
      value: string;
      applicantId?: string;
      licenseNumber?: string;
      holderName?: string;
      status?: string;
    }>;
  }> {
    return safeFetchJson(
      `${API_BASE}/records/suggestions?q=${encodeURIComponent(query)}&limit=${limit}`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch suggestions'
    );
  },

  // Record Handover / Distribution
  async distributeRecord(
    recordId: string,
    data: {
      receiverName: string;
      receiverNid: string;
      receiverPhone: string;
      receiverRelation: string;
      remarks?: string;
      office?: string;
      submittedDocument?: string;
      recommendingStaffName?: string;
    }
  ): Promise<{
    success: boolean;
    record: LicenseRecord;
    distribution: DistributionRecord;
    message: string;
  }> {
    const res = await safeFetchJson<{
      success: boolean;
      record: LicenseRecord;
      distribution: DistributionRecord;
      message: string;
    }>(
      `${API_BASE}/records/${recordId}/distribute`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to record distribution'
    );
    broadcastRecordUpdated({ record: res.record, type: 'DISTRIBUTED' });
    return res;
  },

  // Reset Distribution Record (Super Admin Only)
  async resetDistribution(recordId: string): Promise<{
    success: boolean;
    record: LicenseRecord;
    message: string;
  }> {
    const res = await safeFetchJson<{
      success: boolean;
      record: LicenseRecord;
      message: string;
    }>(
      `${API_BASE}/records/${recordId}/reset-distribution`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
      'Failed to reset distribution details'
    );
    broadcastRecordUpdated({ record: res.record, type: 'UPDATED' });
    return res;
  },

  // Correct Distribution Record (Super Admin Only - updates recipient name & doc in DB and Google Sheet immediately)
  async updateDistribution(
    recordId: string,
    data: { receiverName: string; submittedDocument?: string }
  ): Promise<{
    success: boolean;
    record: LicenseRecord;
    message: string;
  }> {
    const res = await safeFetchJson<{
      success: boolean;
      record: LicenseRecord;
      message: string;
    }>(
      `${API_BASE}/records/${recordId}/update-distribution`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to update distribution details'
    );
    broadcastRecordUpdated({ record: res.record, type: 'UPDATED' });
    return res;
  },

  // Update Submitted Document for a record
  async updateSubmittedDocument(
    recordId: string,
    submittedDocument: string,
    recommendingStaffName?: string,
    metadata?: { licenseNumber?: string; applicationNumber?: string; applicantId?: string }
  ): Promise<{
    success: boolean;
    record: LicenseRecord;
    message: string;
  }> {
    const res = await safeFetchJson<{
      success: boolean;
      record: LicenseRecord;
      message: string;
    }>(
      `${API_BASE}/records/${encodeURIComponent(recordId)}/submitted-document`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          submittedDocument,
          recommendingStaffName,
          licenseNumber: metadata?.licenseNumber,
          applicationNumber: metadata?.applicationNumber,
          applicantId: metadata?.applicantId,
        }),
      },
      'Failed to save submitted document'
    );
    broadcastRecordUpdated({ record: res.record, type: 'SUBMITTED_DOC_UPDATED' });
    return res;
  },

  // Update Status (e.g. Mark MISSING, AVAILABLE, etc.)
  async updateStatus(
    recordId: string,
    data: {
      status: LicenseStatus;
      reason?: string;
      phone?: string;
      contactMobile?: string;
      user?: string;
      reportedBy?: string;
      searchedBy?: string;
      missingMarkedBy?: string;
      missingMarkedSource?: 'APP_BUTTON' | 'IMPORTED_UNKNOWN';
      submittedDocument?: string;
      recommendingStaffName?: string;
      receiverName?: string;
      foundBy?: string;
    }
  ): Promise<{ success: boolean; record: LicenseRecord }> {
    const res = await safeFetchJson<{ success: boolean; record: LicenseRecord }>(
      `${API_BASE}/records/${recordId}/status`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to update record status'
    );
    broadcastRecordUpdated({ record: res.record, type: 'STATUS_UPDATED', status: data.status });
    return res;
  },

  // Update Record Contact Mobile (Compulsory for Missing Card Handover)
  async updateRecordMobile(
    recordId: string,
    phone: string
  ): Promise<{ success: boolean; record: LicenseRecord }> {
    const res = await safeFetchJson<{ success: boolean; record: LicenseRecord }>(
      `${API_BASE}/records/${recordId}/mobile`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ phone }),
      },
      'Failed to update contact mobile'
    );
    broadcastRecordUpdated({ record: res.record, type: 'RECORD_UPDATED' });
    return res;
  },

  // Dashboard Stats
  async getDashboardStats(): Promise<DashboardStats> {
    const cachedKey = 'plsms_cached_dashboard_stats';
    try {
      const data = await safeFetchJson<DashboardStats>(
        `${API_BASE}/dashboard/stats?_t=${Date.now()}`,
        {
          headers: getAuthHeaders(),
        },
        'Failed to fetch dashboard statistics'
      );
      if (data && typeof data === 'object' && typeof data.totalRecords === 'number') {
        safeStorage.setItem(cachedKey, JSON.stringify(data));
        return data;
      }
      return data;
    } catch (err: any) {
      const cached = safeStorage.getItem(cachedKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.totalRecords === 'number') {
            console.warn('Using cached dashboard statistics during server warmup:', err.message);
            return parsed;
          }
        } catch {
          // ignore cache parsing error
        }
      }
      throw err;
    }
  },

  // Live Sync Dashboard (forces cache invalidation and returns fresh stats)
  async liveSyncDashboard(): Promise<{ success: boolean; stats: DashboardStats; timestamp: string }> {
    const res = await safeFetchJson<{ success: boolean; stats: DashboardStats; timestamp: string }>(
      `${API_BASE}/dashboard/live-sync`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
      'Failed to execute live dashboard sync'
    );
    if (res && res.stats && typeof res.stats.totalRecords === 'number') {
      safeStorage.setItem('plsms_cached_dashboard_stats', JSON.stringify(res.stats));
    }
    broadcastRecordUpdated({ stats: res.stats, type: 'LIVE_SYNC' });
    return res;
  },

  // Alphabetical Dashboard Aggregation Stats (A-Z)
  async getAlphabeticalDashboardStats(params?: {
    fromDate?: string;
    toDate?: string;
  }): Promise<AlphabeticalDashboardData> {
    const queryParams = new URLSearchParams();
    if (params?.fromDate) queryParams.set('fromDate', params.fromDate);
    if (params?.toDate) queryParams.set('toDate', params.toDate);
    const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : '';

    return safeFetchJson(
      `${API_BASE}/dashboard/alphabetical${queryStr}`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch alphabetical dashboard statistics'
    );
  },

  // Missing Records
  async getMissingRecords(): Promise<{ records: LicenseRecord[]; total: number }> {
    return safeFetchJson(
      `${API_BASE}/missing`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch missing records'
    );
  },

  // Found Records
  async getFoundRecords(): Promise<{ records: LicenseRecord[]; total: number }> {
    return safeFetchJson(
      `${API_BASE}/found`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch found records'
    );
  },

  // Handed Over Records
  async getHandedOverRecords(): Promise<{ records: LicenseRecord[]; total: number }> {
    return safeFetchJson(
      `${API_BASE}/handed-over`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch handed over records'
    );
  },

  // Distributions
  async getDistributions(): Promise<{ distributions: DistributionRecord[]; total: number }> {
    return safeFetchJson(
      `${API_BASE}/distributions`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch distributions'
    );
  },

  // Imports
  async getImports(): Promise<{ imports: ImportJob[]; total: number }> {
    return safeFetchJson(
      `${API_BASE}/imports`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch import history'
    );
  },

  // Delete Import Job & its records
  async deleteImport(id: string): Promise<{ success: boolean; deletedRecords: number }> {
    return safeFetchJson(
      `${API_BASE}/imports/${id}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
      },
      'Failed to delete import lot'
    );
  },

  // Clear Master Data Forever
  async clearMasterData(): Promise<{ success: boolean; clearedRecords: number; clearedImports: number; message: string }> {
    return safeFetchJson(
      `${API_BASE}/database/clear-master-data`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
      'Failed to clear database'
    );
  },

  // Audit Logs
  async getAuditLogs(): Promise<{ logs: AuditLogItem[]; total: number }> {
    return safeFetchJson(
      `${API_BASE}/audit-logs`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch audit logs'
    );
  },

  async resetAuditLogs(): Promise<{ success: boolean; message: string; clearedLogs: number }> {
    return safeFetchJson(
      `${API_BASE}/admin/reset-audit-logs`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
      'Failed to reset audit logs'
    );
  },

  // Generate Excel or CSV Report
  async generateExcelReport(params: {
    reportType?: string;
    status?: string;
    office?: string;
    format?: 'xlsx' | 'csv';
  }): Promise<{ blob: Blob; filename: string }> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/reports/generate-excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errorJson = await res.json();
        throw new Error(errorJson.error || errorJson.message || 'Failed to generate report');
      }
      const rawText = await res.text();
      throw new Error(rawText || `Failed to generate report (HTTP ${res.status})`);
    }

    // Extract filename from Content-Disposition header if present
    const disposition = res.headers.get('Content-Disposition') || '';
    let filename = '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match && match[1]) {
      filename = match[1];
    } else {
      const nepaliDateStr = getNepaliDate(new Date());
      const ext = params.format === 'csv' ? 'csv' : 'xlsx';
      filename = `PLSMS5--${nepaliDateStr}.${ext}`;
    }

    const blob = await res.blob();
    return { blob, filename };
  },

  // Get Live Counts for All Report Cards in Terminal
  async getReportCounts(office?: string): Promise<{
    totalSmartCards: number;
    notDistributed: number;
    distributed: number;
    missing: number;
    found: number;
    requestToReceive: number;
    uploadHistory: number;
  }> {
    const query = office && office !== 'ALL' ? `?office=${encodeURIComponent(office)}` : '';
    const raw = await safeFetchJson<any>(
      `${API_BASE}/reports/counts${query}`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch report counts'
    );
    return {
      totalSmartCards: Number(raw?.totalSmartCards ?? raw?.totalRecords ?? 0),
      notDistributed: Number(raw?.notDistributed ?? raw?.availableCount ?? 0),
      distributed: Number(raw?.distributed ?? raw?.distributedCount ?? 0),
      missing: Number(raw?.missing ?? raw?.missingCount ?? 0),
      found: Number(raw?.found ?? raw?.foundCount ?? 0),
      requestToReceive: Number(raw?.requestToReceive ?? raw?.requestToReceiveCount ?? 0),
      uploadHistory: Number(raw?.uploadHistory ?? 0),
    };
  },

  // Get Preview Data for PDF / Printable Report Modal
  async getReportPreviewData(params: {
    reportType: string;
    office?: string;
  }): Promise<{
    reportTitle: string;
    reportType: string;
    total: number;
    records: any[];
    generatedAt: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/reports/preview-data`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(params),
      },
      'Failed to fetch report preview data'
    );
  },

  // Generate Multi-Sheet Integrated Report (.xlsx or .csv)
  async generateIntegratedReport(params: {
    sections: string[];
    office?: string;
    fromDate?: string;
    toDate?: string;
    format?: 'xlsx' | 'csv';
  }): Promise<{ blob: Blob; filename: string }> {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/reports/generate-integrated`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errorJson = await res.json();
        throw new Error(errorJson.error || errorJson.message || 'Failed to generate integrated report');
      }
      const rawText = await res.text();
      throw new Error(rawText || `Failed to generate integrated report (HTTP ${res.status})`);
    }

    const disposition = res.headers.get('Content-Disposition') || '';
    let filename = '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match && match[1]) {
      filename = match[1];
    } else {
      const nepaliDateStr = getNepaliDate(new Date());
      const ext = params.format === 'csv' ? 'csv' : 'xlsx';
      filename = `PLSMS5-INTEGRATED--${nepaliDateStr}.${ext}`;
    }

    const blob = await res.blob();
    return { blob, filename };
  },

  // Get Integrated Multi-Section Report Preview
  async getIntegratedReportPreviewData(params: {
    sections: string[];
    office?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{
    sections: Array<{
      id: string;
      title: string;
      count: number;
      records: any[];
      isUploadHistory?: boolean;
    }>;
    generatedAt: string;
    office: string;
    fromDate?: string;
    toDate?: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/reports/integrated-preview`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(params),
      },
      'Failed to fetch integrated preview data'
    );
  },

  // Google Sheets Sync Configuration
  async getGoogleSheetsConfig(): Promise<any> {
    return safeFetchJson(
      `${API_BASE}/sheets/config`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch Google Sheets config'
    );
  },

  async saveGoogleSheetsConfig(data: {
    spreadsheetId?: string;
    tabName?: string;
    publishedUrl?: string;
    webAppUrl?: string;
    daemonUrl?: string;
    syncDaemonUrl?: string;
  }): Promise<any> {
    const rawSpreadsheetInput = data.spreadsheetId !== undefined ? data.spreadsheetId.trim() : undefined;

    return safeFetchJson(
      `${API_BASE}/sheets/config`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          spreadsheetId: rawSpreadsheetInput,
          tabName: data.tabName !== undefined ? data.tabName.trim() : undefined,
          publishedUrl: data.publishedUrl !== undefined ? data.publishedUrl.trim() : undefined,
          webAppUrl: data.webAppUrl !== undefined ? data.webAppUrl.trim() : undefined,
          daemonUrl: data.daemonUrl !== undefined ? data.daemonUrl.trim() : (data.syncDaemonUrl !== undefined ? data.syncDaemonUrl.trim() : undefined),
          syncDaemonUrl: data.syncDaemonUrl !== undefined ? data.syncDaemonUrl.trim() : (data.daemonUrl !== undefined ? data.daemonUrl.trim() : undefined),
        }),
      },
      'Failed to save Google Sheets config'
    );
  },

  /**
   * Save Webhook Write-Back URL directly with full readiness verification
   */
  async saveWebhookUrl(webAppUrl: string): Promise<any> {
    const trimmed = (webAppUrl || '').trim();
    return this.saveGoogleSheetsConfig({ webAppUrl: trimmed });
  },

  /**
   * Retrieve current Webhook Write-Back URL
   */
  async getWebhookUrl(): Promise<{ webAppUrl: string; webhookUrl: string }> {
    const cfg = await this.getGoogleSheetsConfig();
    const url = cfg.webAppUrl || '';
    return { webAppUrl: url, webhookUrl: url };
  },

  /**
   * Save Sync Daemon URL directly with Super Admin authorization
   */
  async saveDaemonUrl(daemonUrl: string): Promise<any> {
    const trimmed = (daemonUrl || '').trim();
    return this.saveGoogleSheetsConfig({ daemonUrl: trimmed, syncDaemonUrl: trimmed });
  },

  /**
   * Retrieve current Sync Daemon URL
   */
  async getDaemonUrl(): Promise<{ daemonUrl: string; syncDaemonUrl: string }> {
    const cfg = await this.getGoogleSheetsConfig();
    const url = cfg.daemonUrl || cfg.syncDaemonUrl || '';
    return { daemonUrl: url, syncDaemonUrl: url };
  },

  /**
   * Verified readiness and initialization check for PLSMS server
   */
  async checkServerReadiness(): Promise<{ ready: boolean; service?: string }> {
    try {
      const res = await safeFetchJson<{ status: string; service: string }>(
        `${API_BASE}/health`,
        { method: 'GET' },
        'Server health check failed'
      );
      return { ready: res.status === 'ok', service: res.service };
    } catch {
      return { ready: false };
    }
  },

  async replaceGoogleSheetUrl(data: {
    sheetUrl: string;
    tabName?: string;
  }): Promise<{
    success: boolean;
    backgroundSyncStarted?: boolean;
    detectedTabs?: string[];
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
    totalProcessed?: number;
    newRecords?: number;
    updatedRecords?: number;
    duplicatesCount?: number;
    invalidRowsCount?: number;
    syncDurationMs?: number;
    indexedInRam?: number;
    config: any;
    message?: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/google-sheets/replace`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to replace Google Sheet URL'
    );
  },

  async detectGoogleSheetTabs(data: { sheetUrlOrId: string }): Promise<{
    success: boolean;
    spreadsheetId: string;
    availableTabs: string[];
    suggestedTab: string;
    message?: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/google-sheets/detect-tabs`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to detect Google Sheet tabs'
    );
  },

  async getAppIsolationStatus(): Promise<{
    isMaster: boolean;
    isRemixed: boolean;
    currentAppletId: string;
    masterAppletId: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/app-isolation/status`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to get app isolation status'
    );
  },

  // Super Admin UPDATE & VERIFY Google Sheet Configuration
  async updateAndVerifyGoogleSheet(data: {
    sheetUrl: string;
    tabName: string;
  }): Promise<{
    success: boolean;
    message: string;
    steps: Array<{
      step: number;
      name: string;
      status: 'PASS' | 'FAIL' | 'PENDING';
      message: string;
      details?: any;
    }>;
    failedStepIndex?: number;
    config?: any;
    preservedConfig?: any;
  }> {
    return safeFetchJson(
      `${API_BASE}/sheets/update-and-verify`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to execute UPDATE & VERIFY'
    );
  },

  async resetGoogleSheetsConfig(options?: { resetAppDatabase?: boolean }): Promise<{
    success: boolean;
    message: string;
    config: any;
    dbStats?: any;
    details?: any;
  }> {
    const res = await safeFetchJson<{
      success: boolean;
      message: string;
      config: any;
      dbStats?: any;
      details?: any;
    }>(
      `${API_BASE}/sheets/reset`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(options || {}),
      },
      'Failed to reset Google Sheets configuration'
    );
    broadcastRecordUpdated({ type: 'GOOGLE_SHEETS_RESET', res });
    return res;
  },

  async resetBothDatabases(): Promise<{
    success: boolean;
    mode: string;
    message: string;
    appDatabase: {
      clearedRecords: number;
      clearedImports: number;
      clearedDistributions: number;
      clearedAuditLogs: number;
      currentRecords: number;
    };
    googleSheetDatabase: any;
    dbStats: any;
  }> {
    throw new Error('Full Database Reset feature is permanently disabled.');
  },

  // Push all distributed cards (Columns I:P) directly to Google Sheets
  async pushAllDistributedToSheets(): Promise<{
    success: boolean;
    totalDistributed: number;
    syncedToSheet: number;
    skippedOrFailed: number;
    message: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/google-sheets/push-all-distributed`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
      'Failed to push distributed cards to Google Sheet'
    );
  },

  // Auto-sync / Import specific category exclusively from PLSMS Database or Linked Google Sheet
  async autoSyncCategory(
    category: string,
    source: string,
    options?: { page?: number; limit?: number; search?: string }
  ): Promise<{
    success: boolean;
    category: string;
    source: 'DB' | 'SHEET';
    totalCount?: number;
    filteredCount?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    records?: any[];
    tabName?: string;
    totalProcessed?: number;
    message: string;
    sheetStats?: any;
    dbStats?: any;
    config?: any;
    parityStats?: CrossPlatformParityStats;
  }> {
    const res = await safeFetchJson<{
      success: boolean;
      category: string;
      source: 'DB' | 'SHEET';
      totalCount?: number;
      filteredCount?: number;
      page?: number;
      limit?: number;
      totalPages?: number;
      records?: any[];
      tabName?: string;
      totalProcessed?: number;
      message: string;
      sheetStats?: any;
      dbStats?: any;
      config?: any;
      parityStats?: CrossPlatformParityStats;
    }>(
      `${API_BASE}/sheets/auto-sync-category`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          category,
          source,
          page: options?.page || 1,
          limit: options?.limit || 100,
          search: options?.search || '',
        }),
      },
      'Failed to auto-sync category'
    );
    broadcastRecordUpdated({ type: 'CATEGORY_SYNC', category, res });
    return res;
  },

  // Fetch cross-platform parity statistics between PLSMS Database and Google Sheets
  async getCrossPlatformParityStats(): Promise<CrossPlatformParityStats> {
    return await safeFetchJson<CrossPlatformParityStats>(
      `${API_BASE}/google-sheets/parity-stats`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to fetch cross-platform parity stats'
    );
  },

  // Dynamically import the exact Sheet Tab Name directly from the linked Google Sheet
  async importSheetName(): Promise<{
    success: boolean;
    tabName: string;
    spreadsheetId: string;
    source: string;
    message: string;
  }> {
    return safeFetchJson<{
      success: boolean;
      tabName: string;
      spreadsheetId: string;
      source: string;
      message: string;
    }>(
      `${API_BASE}/sheets/import-sheet-name`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
      'Failed to import sheet name from Google Sheet'
    );
  },

  // Trigger Google Sheets Synchronization via Authenticated Backend Service Account Proxy
  async syncGoogleSheets(data?: {
    spreadsheetId?: string;
    tabName?: string;
    publishedUrl?: string;
    rawCsvText?: string;
    parsedData?: any;
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
    config: any;
    error?: string;
    message?: string;
  }> {
    let sanitizedId = data?.spreadsheetId ? data.spreadsheetId.trim() : '';
    const match = sanitizedId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      sanitizedId = match[1];
    }

    const res = await safeFetchJson<{
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
      config: any;
      error?: string;
      message?: string;
    }>(
      `${API_BASE}/admin/sync-sheet`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          spreadsheetId: sanitizedId || data?.spreadsheetId,
          tabName: data?.tabName ? data.tabName.trim() : undefined,
          publishedUrl: data?.publishedUrl ? data.publishedUrl.trim() : undefined,
          rawCsvText: data?.rawCsvText,
          parsedData: data?.parsedData,
        }),
      },
      'Failed to sync with Google Sheets'
    );
    broadcastRecordUpdated({ type: 'GOOGLE_SHEETS_SYNC', res });
    return res;
  },

  // 24/7 Continuous Background Sync Settings
  async updateAutoSyncSettings(enabled: boolean, intervalSeconds: number): Promise<any> {
    return safeFetchJson(
      `${API_BASE}/google-sheets/autosync-settings`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled, intervalSeconds }),
      },
      'Failed to update 24/7 auto-sync configuration'
    );
  },

  // Trigger Immediate Daemon Sync Cycle
  async triggerDaemonSync(): Promise<any> {
    return safeFetchJson(
      `${API_BASE}/google-sheets/trigger-sync`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
      'Failed to execute immediate 24/7 sync'
    );
  },

  // Test Sub-Millisecond Search Latency Benchmark
  async testSearchLatency(iterations: number = 2000): Promise<{
    totalQueries: number;
    totalIndexed: number;
    totalTimeMs: number;
    averageLatencyMs: number;
    averageLatencyMicroseconds: number;
    throughputQps: number;
    sampleLookups: Array<{ query: string; found: boolean; durationMicroseconds: number }>;
  }> {
    return safeFetchJson(
      `${API_BASE}/benchmark/search-latency`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ iterations }),
      },
      'Failed to run search latency test'
    );
  },

  // ==========================================
  // STAFF USERS & PERMISSIONS MANAGEMENT API
  // ==========================================
  async getUsers(): Promise<{ users: User[] }> {
    return safeFetchJson(
      `${API_BASE}/admin/users`,
      { headers: getAuthHeaders() },
      'Failed to load user accounts'
    );
  },

  async createUser(userData: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    post?: string;
    role: string;
    permissions: string[];
    password: string;
  }): Promise<{ success: boolean; message: string; user: User }> {
    return safeFetchJson(
      `${API_BASE}/admin/users`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(userData),
      },
      'Failed to create user account'
    );
  },

  async updateUserDetails(
    userId: string,
    details: {
      name: string;
      phone?: string;
      email?: string;
      post?: string;
    }
  ): Promise<{ success: boolean; message: string; user: User; auditDetails?: string }> {
    return safeFetchJson(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(details),
      },
      'Failed to update staff profile details'
    );
  },

  async updateUserPermissions(userId: string, permissions: string[], role?: string): Promise<{ success: boolean; message: string; user: User }> {
    return safeFetchJson(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}/permissions`,
      {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ permissions, role }),
      },
      'Failed to update user permissions'
    );
  },

  async toggleUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<{ success: boolean; message: string; status: 'ACTIVE' | 'SUSPENDED' }> {
    return safeFetchJson(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}/status`,
      {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      },
      'Failed to toggle user status'
    );
  },

  async resetUserPassword(userId: string, newPassword: string): Promise<{ success: boolean; message: string; defaultPassword?: string }> {
    return safeFetchJson(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}/reset-password`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ newPassword }),
      },
      'Failed to reset user password'
    );
  },

  async resetUserDefaultPassword(userId: string): Promise<{ success: boolean; message: string; defaultPassword?: string }> {
    return safeFetchJson(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}/reset-default-password`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
      'Failed to reset user password to default'
    );
  },

  async deleteUser(userId: string): Promise<{ success: boolean; message: string }> {
    return safeFetchJson(
      `${API_BASE}/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
      },
      'Failed to revoke user account'
    );
  },

  async resetProductionDatabase(payload: {
    password: string;
    confirmationText: string;
    identifier?: string;
  }): Promise<{
    success: boolean;
    message: string;
    details: {
      clearedRecords: number;
      clearedImports: number;
      clearedDistributions: number;
      clearedAuditLogs: number;
    };
  }> {
    throw new Error('Full Database Reset feature is permanently disabled.');
  },

  // ==========================================
  // CLEAR CARD DATA / PRODUCTION INITIALIZATION API (SUPER ADMIN ONLY)
  // Completely separate from the disabled Full Database Reset.
  // Provides read-only preview and safety architecture verification.
  // ==========================================
  async getClearCardDataPreview(): Promise<{
    success: boolean;
    preview: ClearCardDataPreview;
  }> {
    return safeFetchJson(
      `${API_BASE}/admin/clear-card-data/preview`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to load card data initialization preview'
    );
  },

  async verifyClearCardDataSafety(payload: ClearCardDataVerifyPayload): Promise<ClearCardDataVerifyResponse> {
    return safeFetchJson(
      `${API_BASE}/admin/clear-card-data/verify-safety`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      },
      'Failed to verify production initialization safety architecture'
    );
  },

  // ==========================================
  // NOTICES & OFFICIAL ANNOUNCEMENTS API
  // ==========================================
  async getNotices(all = true): Promise<OfficeNotice[]> {
    try {
      const data = await safeFetchJson<OfficeNotice[]>(
        `${API_BASE}/notices?all=${all ? 'true' : 'false'}`,
        { headers: getAuthHeaders() },
        'Failed to load notices'
      );
      if (Array.isArray(data)) {
        try {
          safeStorage.setItem('plsms_notices_cache', JSON.stringify(data));
        } catch {}
      }
      return data;
    } catch (err: any) {
      // 1. Check local persistent storage cache
      const cached = safeStorage.getItem('plsms_notices_cache');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return all ? parsed : parsed.filter((n: OfficeNotice) => n.status === 'ACTIVE');
          }
        } catch {}
      }
      // 2. Fall back to authoritative default announcements so user experience is never broken
      if (DEFAULT_FALLBACK_NOTICES.length > 0) {
        return all
          ? DEFAULT_FALLBACK_NOTICES
          : DEFAULT_FALLBACK_NOTICES.filter((n) => n.status === 'ACTIVE');
      }
      throw err;
    }
  },

  async createNotice(data: Partial<OfficeNotice>): Promise<{ success: boolean; message: string; notice: OfficeNotice }> {
    return safeFetchJson(
      `${API_BASE}/notices`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to publish notice'
    );
  },

  async updateNotice(id: string, data: Partial<OfficeNotice>): Promise<{ success: boolean; message: string; notice: OfficeNotice }> {
    return safeFetchJson(
      `${API_BASE}/notices/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to update notice'
    );
  },

  async deleteNotice(id: string): Promise<{ success: boolean; message: string }> {
    return safeFetchJson(
      `${API_BASE}/notices/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
      },
      'Failed to delete notice'
    );
  },

  async toggleNoticeStatus(id: string): Promise<{ success: boolean; message: string; notice: OfficeNotice }> {
    return safeFetchJson(
      `${API_BASE}/notices/${encodeURIComponent(id)}/toggle`,
      {
        method: 'PATCH',
        headers: getAuthHeaders(),
      },
      'Failed to toggle notice status'
    );
  },

  async uploadNoticeAttachment(file: File): Promise<{ success: boolean; attachment: NoticeAttachment }> {
    const formData = new FormData();
    formData.append('attachment', file);
    const token = getStoredToken();

    const res = await fetch(`${API_BASE}/notices/upload-attachment`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Failed to upload attachment file');
    }

    return res.json();
  },

  async uploadFileToNotice(id: string, file: File): Promise<{ success: boolean; message: string; notice: OfficeNotice; attachment: NoticeAttachment }> {
    const formData = new FormData();
    formData.append('attachment', file);
    const token = getStoredToken();

    const res = await fetch(`${API_BASE}/notices/${encodeURIComponent(id)}/upload-file`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Failed to attach file to notice');
    }

    return res.json();
  },

  async getSecurityPinStatus(): Promise<SecurityPinStatus> {
    return safeFetchJson(
      `${API_BASE}/admin/security-pin/status`,
      {
        headers: getAuthHeaders(),
      },
      'Failed to load security pin status'
    );
  },

  async verifySecurityPin(pin: string): Promise<{ success: boolean; isDefault: boolean; clearanceToken: string; message: string }> {
    return safeFetchJson(
      `${API_BASE}/admin/security-pin/verify`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ pin }),
      },
      'Failed to verify security M-PIN'
    );
  },

  async changeSecurityPin(data: {
    currentPin?: string;
    newPin: string;
    superAdminPassword?: string;
  }): Promise<{ success: boolean; isDefault: boolean; clearanceToken?: string; message: string }> {
    return safeFetchJson(
      `${API_BASE}/admin/security-pin/change`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to change security M-PIN'
    );
  },

  async resetSecurityPin(superAdminPassword: string): Promise<{ success: boolean; isDefault: boolean; message: string }> {
    return safeFetchJson(
      `${API_BASE}/admin/security-pin/reset`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ superAdminPassword }),
      },
      'Failed to reset security M-PIN'
    );
  },

  async verifySuperAdminStep2(data: {
    identifier: string;
    password: string;
  }): Promise<{
    success: boolean;
    matched: boolean;
    clearanceToken?: string;
    user?: any;
    message?: string;
    error?: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/admin/security-step2-verify`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      },
      'Failed to verify Super Admin credentials'
    );
  },

  // Official PLSMS Backup & Accidental Disaster Recovery Methods
  async getBackupLocations(): Promise<{
    success: boolean;
    locations: Array<{
      code: string;
      nameNp: string;
      nameEn: string;
      locationNp: string;
      locationEn: string;
      officeNameNp: string;
      officeNameEn: string;
      departmentNp: string;
      departmentEn: string;
      provinceGovNp?: string;
      provinceGovEn?: string;
      isPrimary?: boolean;
    }>;
    activeOfficeCode: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/admin/backup/locations`,
      { headers: getAuthHeaders() },
      'Failed to fetch backup locations'
    );
  },

  async getDatabaseInventoryStats(): Promise<{
    success: boolean;
    totalRecords: number;
    notDistributed: number;
    distributed: number;
    missing: number;
    found: number;
    imports: number;
    distributions: number;
    users: number;
    usersWithPasswords?: number;
    passwordEncryptionFormat?: string;
    actionOverrides?: number;
    notices?: number;
    hasGoogleSheetsConfig?: boolean;
    timestamp: string;
  }> {
    return safeFetchJson(
      `${API_BASE}/admin/backup/stats?_t=${Date.now()}`,
      { headers: getAuthHeaders() },
      'Failed to fetch backup inventory statistics'
    );
  },

  async downloadBackupArchive(params: {
    locationCode: string;
    scope?: string;
    customOfficeName?: string;
    customLocationName?: string;
  }): Promise<{ filename: string; sizeBytes: number }> {
    const token = getStoredToken() || localStorage.getItem('plsms_auth_token') || localStorage.getItem('token') || '';
    const q = new URLSearchParams();
    q.set('locationCode', params.locationCode);
    if (params.scope) q.set('scope', params.scope);
    if (params.customOfficeName) q.set('customOfficeName', params.customOfficeName);
    if (params.customLocationName) q.set('customLocationName', params.customLocationName);
    if (token) q.set('token', token);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/admin/backup/export?${q.toString()}`, {
      headers,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Export failed (${response.status}): ${err}`);
    }

    const disposition = response.headers.get('Content-Disposition');
    const nepaliDateStr = getNepaliDate(new Date());
    let filename = `PLSMS_BACKUP_JSON_FILE_ARCHIVE_${nepaliDateStr}.json`;
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    return { filename, sizeBytes: blob.size };
  },

  async inspectBackupArchive(file: File): Promise<any> {
    const token = getStoredToken() || localStorage.getItem('plsms_auth_token') || localStorage.getItem('token') || '';
    const formData = new FormData();
    formData.append('backupFile', file);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/admin/backup/inspect`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error('Payload too large (HTTP 413). Upload size exceeded default limits; switching to chunked upload.');
        }
        throw new Error(`Server returned HTTP ${res.status}: ${res.statusText || 'Unable to inspect backup file'}`);
      }
      throw new Error(`Invalid server response format: ${text.slice(0, 150)}`);
    }

    if (!res.ok) {
      throw new Error(data.error || `Inspection failed (HTTP ${res.status})`);
    }
    return data;
  },

  async uploadLargeBackupFileInChunks(
    file: File,
    onProgress?: (progress: { percent: number; chunkIndex: number; totalChunks: number; retrying?: boolean }) => void
  ): Promise<string> {
    const chunkSize = 5 * 1024 * 1024; // 5MB agile chunk size for ultra-reliable transmission
    const totalChunks = Math.ceil(file.size / chunkSize);
    const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const maxRetriesPerChunk = 4;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunkBlob = file.slice(start, end);

      let success = false;
      let lastErrorMessage = '';

      for (let attempt = 0; attempt < maxRetriesPerChunk; attempt++) {
        try {
          const token = getStoredToken() || localStorage.getItem('plsms_auth_token') || localStorage.getItem('token') || '';
          const headers: Record<string, string> = {
            'Accept': 'application/json',
          };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }

          const formData = new FormData();
          formData.append('uploadId', uploadId);
          formData.append('chunkIndex', String(i));
          formData.append('totalChunks', String(totalChunks));
          formData.append('chunk', chunkBlob, file.name);

          const res = await fetch(`${API_BASE}/admin/backup/upload-chunk`, {
            method: 'POST',
            headers,
            body: formData,
          });

          const text = await res.text();
          const trimmed = text.trim();

          // Check if response is HTML (e.g. server starting/warmup or proxy error page)
          if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.includes('<title>Starting Server')) {
            throw new Error(`Server reverse proxy returned temporary warmup page (attempt ${attempt + 1}/${maxRetriesPerChunk})`);
          }

          let resJson: any = {};
          try {
            resJson = JSON.parse(text);
          } catch {
            throw new Error(`Non-JSON response from server (attempt ${attempt + 1}/${maxRetriesPerChunk})`);
          }

          if (!res.ok || !resJson.success) {
            throw new Error(resJson.error || `Chunk ${i + 1}/${totalChunks} upload failed with status ${res.status}`);
          }

          success = true;
          break;
        } catch (err: any) {
          lastErrorMessage = err.message || 'Network upload error';
          if (attempt < maxRetriesPerChunk - 1) {
            const delayMs = 1200 * (attempt + 1);
            if (onProgress) {
              const currentPercent = Math.round((i / totalChunks) * 100);
              onProgress({
                percent: currentPercent,
                chunkIndex: i + 1,
                totalChunks,
                retrying: true,
              });
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      if (!success) {
        throw new Error(`Chunk ${i + 1}/${totalChunks} upload encountered a connection issue: ${lastErrorMessage}. Please ensure the server is running and try again.`);
      }

      if (onProgress) {
        const percent = Math.round(((i + 1) / totalChunks) * 100);
        onProgress({ percent, chunkIndex: i + 1, totalChunks });
      }
    }

    return uploadId;
  },

  async inspectUploadedBackupArchive(uploadId: string): Promise<any> {
    const token = getStoredToken() || localStorage.getItem('plsms_auth_token') || localStorage.getItem('token') || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/admin/backup/inspect-uploaded`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ uploadId }),
    });

    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Server returned HTTP ${res.status}: ${text.slice(0, 150)}`);
    }

    if (!res.ok) {
      throw new Error(data.error || 'Pre-inspection of uploaded backup failed');
    }
    return data;
  },

  async restoreUploadedBackupArchive(
    uploadId: string,
    options: { mode: 'REPLACE' | 'MERGE'; targetLocationCode?: string }
  ): Promise<any> {
    const token = getStoredToken() || localStorage.getItem('plsms_auth_token') || localStorage.getItem('token') || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/admin/backup/restore-uploaded`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uploadId,
        mode: options.mode,
        targetLocationCode: options.targetLocationCode,
      }),
    });

    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Server returned HTTP ${res.status}: ${text.slice(0, 150)}`);
    }

    if (!res.ok) {
      throw new Error(data.error || 'Restoration of uploaded backup failed');
    }
    return data;
  },

  async restoreBackupArchive(
    file: File,
    options: { mode: 'REPLACE' | 'MERGE'; targetLocationCode?: string }
  ): Promise<any> {
    const token = getStoredToken() || localStorage.getItem('plsms_auth_token') || localStorage.getItem('token') || '';
    const formData = new FormData();
    formData.append('backupFile', file);
    formData.append('mode', options.mode);
    if (options.targetLocationCode) {
      formData.append('targetLocationCode', options.targetLocationCode);
    }

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/admin/backup/restore`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error('Payload too large (HTTP 413). Please use the chunked upload method.');
        }
        throw new Error(`Server returned HTTP ${res.status}: ${res.statusText || 'Restoration failed'}`);
      }
      throw new Error(`Invalid server response: ${text.slice(0, 150)}`);
    }

    if (!res.ok) {
      throw new Error(data.error || 'Restoration failed');
    }
    return data;
  },
};
