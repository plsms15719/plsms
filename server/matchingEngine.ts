import { LicenseRecord, MapMatchLevel, MatchingParityInfo, CrossPlatformParityStats } from '../src/types';

/**
 * ==============================================================================
 * PLSMS CANONICAL MATCHING & MAPPING ENGINE (KAP & MAP)
 * ==============================================================================
 * Provides the single source of truth for all record matching across:
 *  1. PLSMS App Database (SQLite / Local Storage)
 *  2. Google Sheet Database (Spreadsheet columns A-O)
 *  3. Excel / CSV Import Engine
 *  4. High-Speed RAM In-Memory Indices
 *
 * Core Terminology:
 *  - KAP: Key Applicant/Process (4-Column Strict Identifier: Applicant ID, Full Name, License Number, Category)
 *  - MAP: Multi-Key Associative Priority (5-Tier Cascading Matching Hierarchy)
 * ==============================================================================
 */

// 1. NORMALIZATION UTILITIES
export function normalizeCleanApplicantId(val?: string | null): string {
  if (!val) return '';
  return String(val).trim().toUpperCase();
}

export function normalizeCleanHolderName(val?: string | null): string {
  if (!val) return '';
  return String(val).trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizeCleanLicenseNumber(val?: string | null): string {
  if (!val) return '';
  return String(val).trim().toUpperCase();
}

export function normalizeCleanLicDigits(val?: string | null): string {
  if (!val) return '';
  return String(val).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeCleanCategory(val?: string | null): string {
  if (!val) return '';
  const raw = String(val).trim().toUpperCase();
  if (raw === 'UNDEFINED' || raw === 'NULL' || raw === 'N/A' || raw === '---') return '';
  return raw.replace(/\s*,\s*/g, ', ').replace(/\s*\/\s*/g, ', ').trim();
}

export function isCategoryStrictlyEqual(cat1?: string | null, cat2?: string | null): boolean {
  const norm1 = normalizeCleanCategory(cat1);
  const norm2 = normalizeCleanCategory(cat2);
  if (!norm1 && !norm2) return true;
  if (!norm1 || !norm2) return false;
  return norm1 === norm2;
}

export function normalizeCodeDashes(code?: unknown): string | undefined {
  if (code === undefined || code === null) return undefined;
  const str = String(code).trim();
  if (!str) return undefined;
  const stripped = str.replace(/[\s\-_—–./\\]/g, '');
  if (!stripped || /^(na|n\/a|null|none|nil|undefined|0)$/i.test(stripped)) {
    return '----';
  }
  let cleaned = str.replace(/(?:[-—–]\s*){4,}/g, '----');
  cleaned = cleaned.replace(/[-—–]{4,}/g, '----');
  return cleaned.trim();
}

/**
 * Builds the canonical KAP 4-Column Key
 * "duplicate can be calculated if the data of a ROW of APPLICANT ID and FULL NAME and LICENSE NUMBER and CATEGORY are exactly and strictly matched all these 4 columns data"
 */
export function buildKAP4ColKey(
  applicantId?: string | null,
  holderName?: string | null,
  licenseNumber?: string | null,
  category?: string | null
): string {
  const appId = normalizeCleanApplicantId(applicantId);
  const name = normalizeCleanHolderName(holderName);
  const lic = normalizeCleanLicenseNumber(licenseNumber);
  const cat = normalizeCleanCategory(category);
  return `${appId}|||${name}|||${lic}|||${cat}`;
}

/**
 * Builds the standard composite key: `${appId}_${cleanLicNorm}`
 */
export function buildCompositeKey(
  applicantId?: string | null,
  licenseNumber?: string | null,
  category?: string | null
): string {
  const appId = normalizeCleanApplicantId(applicantId);
  const cleanLic = normalizeCleanLicDigits(licenseNumber);
  const cat = normalizeCleanCategory(category);
  if (appId && cleanLic && cat) return `${appId}_${cleanLic}_${cat}`;
  if (appId && cleanLic) return `${appId}_${cleanLic}`;
  if (cleanLic) return cleanLic;
  return appId;
}

export interface MatchResult<T> {
  record: T | null;
  matchLevel: MapMatchLevel;
  matchedKey: string;
}

/**
 * High-Speed Multi-Key Associative Priority (MAP) Index
 * Holds O(1) indices for KAP 4-column keys, composite keys, exact license numbers,
 * clean normalized license numbers, and applicant IDs.
 * Strictly respects that a person can legitimately possess multiple smart cards
 * for different categories (e.g. Category A, and later Category A, B).
 */
export class UnifiedRecordMapIndex<T = LicenseRecord> {
  public readonly byKAP4Col = new Map<string, T>();
  public readonly byComposite = new Map<string, T[]>();
  public readonly byExactLic = new Map<string, T[]>();
  public readonly byCleanLic = new Map<string, T[]>();
  public readonly byAppId = new Map<string, T[]>();
  public readonly byId = new Map<string, T>();
  public totalIndexed = 0;

  public clear(): void {
    this.byKAP4Col.clear();
    this.byComposite.clear();
    this.byExactLic.clear();
    this.byCleanLic.clear();
    this.byAppId.clear();
    this.byId.clear();
    this.totalIndexed = 0;
  }

  private pushToList(map: Map<string, T[]>, key: string, record: T): void {
    const list = map.get(key);
    if (list) {
      list.push(record);
    } else {
      map.set(key, [record]);
    }
  }

  public indexRecord(
    record: T,
    fields: {
      id?: string;
      applicantId?: string;
      applicationNumber?: string;
      holderName?: string;
      licenseNumber?: string;
      category?: string;
      vehicleClass?: string;
    }
  ): void {
    const appId = normalizeCleanApplicantId(fields.applicantId || fields.applicationNumber);
    const name = normalizeCleanHolderName(fields.holderName);
    const lic = normalizeCleanLicenseNumber(fields.licenseNumber);
    const cleanLic = normalizeCleanLicDigits(fields.licenseNumber);
    const cat = normalizeCleanCategory(fields.category || fields.vehicleClass);

    // 1. Tier 1: KAP 4-Column Exact Key
    if (appId || lic) {
      const kapKey = `${appId}|||${name}|||${lic}|||${cat}`;
      this.byKAP4Col.set(kapKey, record);
    }

    // 2. Tier 2: Composite Key (AppID + Clean License)
    if (appId && cleanLic) {
      this.pushToList(this.byComposite, `${appId}_${cleanLic}`, record);
      if (cat) {
        this.pushToList(this.byComposite, `${appId}_${cleanLic}_${cat}`, record);
      }
    }

    // 3. Tier 3: Exact License Number
    if (lic) {
      this.pushToList(this.byExactLic, lic, record);
    }

    // 4. Tier 4: Clean License without hyphens/spaces
    if (cleanLic) {
      this.pushToList(this.byCleanLic, cleanLic, record);
    }

    // 5. Tier 5: Applicant ID
    if (appId) {
      this.pushToList(this.byAppId, appId, record);
    }

    // 6. Primary / Storage ID
    if (fields.id) {
      this.byId.set(fields.id, record);
    }

    this.totalIndexed++;
  }

  /**
   * 5-Tier Cascading Priority Match (MAP Hierarchy)
   * Enforces 4-column purity: A record can only match if its Category does NOT conflict.
   * If a citizen holds Category 'A' and another record is Category 'A, B', they are
   * separate physical smart cards and MUST NOT be conflated as duplicates or MAP: COMPOSITE.
   */
  public matchRecord(query: {
    id?: string;
    applicantId?: string;
    applicationNumber?: string;
    holderName?: string;
    licenseNumber?: string;
    category?: string;
    vehicleClass?: string;
  }): MatchResult<T> {
    const appId = normalizeCleanApplicantId(query.applicantId || query.applicationNumber);
    const name = normalizeCleanHolderName(query.holderName);
    const lic = normalizeCleanLicenseNumber(query.licenseNumber);
    const cleanLic = normalizeCleanLicDigits(query.licenseNumber);
    const cat = normalizeCleanCategory(query.category || query.vehicleClass);

    // Tier 1: Strict KAP 4-Column Exact Match (Highest Reliability)
    if (appId && lic && name) {
      const kapKey = `${appId}|||${name}|||${lic}|||${cat}`;
      if (this.byKAP4Col.has(kapKey)) {
        return {
          record: this.byKAP4Col.get(kapKey)!,
          matchLevel: 'KAP_4COL',
          matchedKey: kapKey,
        };
      }
    }

    // Candidate selection helper: Enforce Category Purity
    // If the query has a specified Category, candidates MUST have the exact same category.
    // If none match the category, they cannot be matched because they are distinct smart cards.
    const pickCompatibleCandidate = (candidates: T[] | undefined): T | null => {
      if (!candidates || candidates.length === 0) return null;
      if (cat) {
        for (const c of candidates) {
          const rec = c as any;
          const recCat = normalizeCleanCategory(rec.category || rec.vehicleClass);
          if (recCat === cat) return c;
        }
        return null;
      }
      return candidates[0];
    };

    // Tier 2: Composite Key Match (Applicant ID + Clean License)
    if (appId && cleanLic) {
      if (cat && this.byComposite.has(`${appId}_${cleanLic}_${cat}`)) {
        const match = pickCompatibleCandidate(this.byComposite.get(`${appId}_${cleanLic}_${cat}`));
        if (match) {
          return {
            record: match,
            matchLevel: 'COMPOSITE',
            matchedKey: `${appId}_${cleanLic}_${cat}`,
          };
        }
      }
      const compKey = `${appId}_${cleanLic}`;
      if (this.byComposite.has(compKey)) {
        const match = pickCompatibleCandidate(this.byComposite.get(compKey));
        if (match) {
          return {
            record: match,
            matchLevel: 'COMPOSITE',
            matchedKey: compKey,
          };
        }
      }
    }

    // Tier 3: Exact License Number Match
    if (lic && this.byExactLic.has(lic)) {
      const match = pickCompatibleCandidate(this.byExactLic.get(lic));
      if (match) {
        return {
          record: match,
          matchLevel: 'EXACT_LIC',
          matchedKey: lic,
        };
      }
    }

    // Tier 4: Clean License Match (Symbols stripped)
    if (cleanLic && this.byCleanLic.has(cleanLic)) {
      const match = pickCompatibleCandidate(this.byCleanLic.get(cleanLic));
      if (match) {
        return {
          record: match,
          matchLevel: 'CLEAN_LIC',
          matchedKey: cleanLic,
        };
      }
    }

    // Tier 5: Applicant ID Match
    if (appId && this.byAppId.has(appId)) {
      const match = pickCompatibleCandidate(this.byAppId.get(appId));
      if (match) {
        return {
          record: match,
          matchLevel: 'APP_ID',
          matchedKey: appId,
        };
      }
    }

    // Fallback: Storage Record ID
    if (query.id && this.byId.has(query.id)) {
      return {
        record: this.byId.get(query.id)!,
        matchLevel: 'EXACT_LIC',
        matchedKey: query.id,
      };
    }

    return {
      record: null,
      matchLevel: 'UNMATCHED',
      matchedKey: '',
    };
  }
}

/**
 * Builds a Unified Record Index from any array of LicenseRecords
 */
export function buildUnifiedIndex(records: LicenseRecord[]): UnifiedRecordMapIndex<LicenseRecord> {
  const index = new UnifiedRecordMapIndex<LicenseRecord>();
  for (const r of records) {
    index.indexRecord(r, {
      id: r.id,
      applicantId: r.applicantId,
      applicationNumber: r.applicationNumber,
      holderName: r.holderName,
      licenseNumber: r.licenseNumber,
      category: r.category,
      vehicleClass: r.vehicleClass,
    });
  }
  return index;
}

export function isRecordDistributed(r?: LicenseRecord | null): boolean {
  if (!r) return false;
  if (isRecordMissing(r)) return false;
  if (isRecordFound(r)) {
    return Boolean(r.foundHandoverDone === true);
  }
  return Boolean(
    r.status === 'DISTRIBUTED' ||
    r.isDistributed === true ||
    r.mainStatus === 'DISTRIBUTED' ||
    r.rawRecord?.['STATUS DISTRIBUTED'] === 'DISTRIBUTED' ||
    r.rawRecord?.['DISTRIBUTED'] === 'DISTRIBUTED' ||
    (r.rawRecord?.['DISRTIBUTED TO'] && String(r.rawRecord['DISRTIBUTED TO']).trim().length > 0 && r.rawRecord['DISRTIBUTED TO'] !== '-') ||
    (r.rawRecord?.['DISTRIBUTED TO'] && String(r.rawRecord['DISTRIBUTED TO']).trim().length > 0 && r.rawRecord['DISTRIBUTED TO'] !== '-') ||
    (r.rawRecord?.['RECEIVED BY'] && String(r.rawRecord['RECEIVED BY']).trim().length > 0 && r.rawRecord['RECEIVED BY'] !== '-') ||
    (r.receivedBy && String(r.receivedBy).trim().length > 0 && r.receivedBy !== '-' && r.receivedBy !== '---' && r.receivedBy !== '<N/A>')
  );
}

export function isRecordFound(r?: LicenseRecord | null): boolean {
  if (!r) return false;
  if (r.status === 'FOUND' || r.rawRecord?.['STATUS'] === 'FOUND' || r.rawRecord?.['FOUND'] === 'FOUND') {
    return true;
  }
  if (Boolean(r.foundReason) || Boolean(r.foundDate) || Boolean(r.foundReportedBy)) {
    return true;
  }
  if (r.receiverRemarks && r.receiverRemarks.toUpperCase().includes('FOUND')) {
    return true;
  }
  return false;
}

export function isRecordHandedOver(r?: LicenseRecord | null): boolean {
  if (!r) return false;
  if (r.foundHandoverDone === false) return false;
  if (isRecordMissing(r)) return false;
  return Boolean(r.foundHandoverDone === true);
}

export function isRecordMissing(r?: LicenseRecord | null): boolean {
  if (!r) return false;
  if (isRecordFound(r)) return false;
  if (r.status === 'MISSING' || r.issueFlag === 'MISSING' || r.rawRecord?.['STATUS'] === 'MISSING' || r.rawRecord?.['MISSING'] === 'MISSING') {
    return true;
  }
  if (Boolean(r.missingReason) || Boolean(r.missingDate)) {
    return true;
  }
  return false;
}

/**
 * Compares Platform 1 (PLSMS DB) and Platform 2 (Google Sheet) using KAP & MAP
 */
export function calculateCrossPlatformParity(
  dbRecords: LicenseRecord[],
  sheetRecords: LicenseRecord[]
): CrossPlatformParityStats {
  const sheetIndex = buildUnifiedIndex(sheetRecords);

  let kap4ColMatchedCount = 0;
  let compositeMatchedCount = 0;
  let exactLicMatchedCount = 0;
  let cleanLicMatchedCount = 0;
  let appIdMatchedCount = 0;
  let inSyncCount = 0;
  let statusMismatchCount = 0;
  let onlyInDbCount = 0;

  for (const dbRec of dbRecords) {
    const match = sheetIndex.matchRecord({
      applicantId: dbRec.applicantId,
      applicationNumber: dbRec.applicationNumber,
      holderName: dbRec.holderName,
      licenseNumber: dbRec.licenseNumber,
      category: dbRec.category,
      vehicleClass: dbRec.vehicleClass,
    });

    if (match.record) {
      if (match.matchLevel === 'KAP_4COL') kap4ColMatchedCount++;
      else if (match.matchLevel === 'COMPOSITE') compositeMatchedCount++;
      else if (match.matchLevel === 'EXACT_LIC') exactLicMatchedCount++;
      else if (match.matchLevel === 'CLEAN_LIC') cleanLicMatchedCount++;
      else if (match.matchLevel === 'APP_ID') appIdMatchedCount++;

      // Check if status & receiver are in sync
      const dbStatus = (dbRec.status || 'AVAILABLE').toUpperCase();
      const sheetStatus = (match.record.status || 'AVAILABLE').toUpperCase();
      const dbDist = isRecordDistributed(dbRec);
      const sheetDist = isRecordDistributed(match.record);
      const dbMiss = isRecordMissing(dbRec);
      const sheetMiss = isRecordMissing(match.record);
      const dbFound = isRecordFound(dbRec);
      const sheetFound = isRecordFound(match.record);

      if ((dbMiss && sheetMiss) || (dbFound && sheetFound) || (dbDist && sheetDist) || (dbStatus === sheetStatus)) {
        inSyncCount++;
      } else {
        statusMismatchCount++;
      }
    } else {
      onlyInDbCount++;
    }
  }

  // Calculate only in sheet
  const dbIndex = buildUnifiedIndex(dbRecords);
  let onlyInSheetCount = 0;
  for (const sheetRec of sheetRecords) {
    const match = dbIndex.matchRecord({
      applicantId: sheetRec.applicantId,
      applicationNumber: sheetRec.applicationNumber,
      holderName: sheetRec.holderName,
      licenseNumber: sheetRec.licenseNumber,
      category: sheetRec.category,
      vehicleClass: sheetRec.vehicleClass,
    });
    if (!match.record) {
      onlyInSheetCount++;
    }
  }

  const totalPossible = Math.max(dbRecords.length, sheetRecords.length);
  const totalMatched = kap4ColMatchedCount + compositeMatchedCount + exactLicMatchedCount + cleanLicMatchedCount + appIdMatchedCount;
  const syncParityPercentage = totalPossible > 0 ? Math.round((totalMatched / totalPossible) * 1000) / 10 : 100;
  const kapMatchPercentage = totalPossible > 0 ? Math.round((kap4ColMatchedCount / totalPossible) * 1000) / 10 : 100;
  const statusAgreementPercentage = totalMatched > 0 ? Math.round((inSyncCount / totalMatched) * 1000) / 10 : 100;

  return {
    success: true,
    totalDbRecords: dbRecords.length,
    totalSheetRecords: sheetRecords.length,
    kap4ColMatchedCount,
    compositeMatchedCount,
    exactLicMatchedCount,
    cleanLicMatchedCount,
    appIdMatchedCount,
    inSyncCount,
    statusMismatchCount,
    onlyInDbCount,
    onlyInSheetCount,
    syncParityPercentage,
    lastCalculatedAt: new Date().toISOString(),

    // Field aliases for rich UI consumption
    dbTotal: dbRecords.length,
    sheetTotal: sheetRecords.length,
    matchedKAP4Col: kap4ColMatchedCount,
    kapMatchPercentage,
    matchedTotal: totalMatched,
    statusAgreedTotal: inSyncCount,
    statusAgreementPercentage,
    statusDriftTotal: statusMismatchCount,
  };
}

/**
 * Annotates records with rich Cross-Platform Parity & KAP/MAP match metadata
 */
export function annotateRecordsWithParity(
  records: LicenseRecord[],
  sourcePlatform: 'DB' | 'SHEET',
  counterpartRecords: LicenseRecord[]
): LicenseRecord[] {
  const counterpartIndex = buildUnifiedIndex(counterpartRecords);
  const counterpartPlatform: 'DB' | 'SHEET' = sourcePlatform === 'DB' ? 'SHEET' : 'DB';

  return records.map((rec) => {
    const match = counterpartIndex.matchRecord({
      applicantId: rec.applicantId,
      applicationNumber: rec.applicationNumber,
      holderName: rec.holderName,
      licenseNumber: rec.licenseNumber,
      category: rec.category,
      vehicleClass: rec.vehicleClass,
    });

    const isMatched = Boolean(match.record);
    const counterpartRec = match.record;

    let isStatusInSync = false;
    if (counterpartRec) {
      const s1 = (rec.status || 'AVAILABLE').toUpperCase();
      const s2 = (counterpartRec.status || 'AVAILABLE').toUpperCase();
      const d1 = rec.status === 'DISTRIBUTED' || rec.isDistributed;
      const d2 = counterpartRec.status === 'DISTRIBUTED' || counterpartRec.isDistributed;
      isStatusInSync = s1 === s2 || (d1 && d2);
    }

    const parityInfo: MatchingParityInfo = {
      isMatched,
      matchLevel: match.matchLevel,
      matchedColKey: match.matchedKey,
      counterpartStatus: counterpartRec?.status,
      statusAgreed: isStatusInSync,
      counterpartRecordId: counterpartRec?.id,
      counterpartSheetRow: typeof counterpartRec?.sn === 'number' ? counterpartRec.sn : counterpartRec?.rawRecord?.sheetRow,
      isStatusInSync,
      sourcePlatform,
      counterpartPlatform,
      otherPlatformRecord: counterpartRec
        ? {
            id: counterpartRec.id,
            applicantId: counterpartRec.applicantId || counterpartRec.applicationNumber,
            holderName: counterpartRec.holderName,
            licenseNumber: counterpartRec.licenseNumber,
            category: counterpartRec.category,
            status: counterpartRec.status,
            receivedBy: counterpartRec.receivedBy || counterpartRec.receiverName,
            distributedDate: counterpartRec.distributedDate || counterpartRec.distributedAt,
            distributedBy: counterpartRec.distributedBy,
            submittedDocument: counterpartRec.submittedDocument,
          }
        : undefined,
    };

    return {
      ...rec,
      matchingInfo: parityInfo,
      matchingParity: parityInfo,
      parity: parityInfo,
    };
  });
}
