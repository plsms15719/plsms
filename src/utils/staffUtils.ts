import { LicenseRecord } from '../types';

/**
 * Smartly resolves the FULL Name of the office staff who saved the smart card receiver
 * and submitted documents from database records.
 */
export function resolveRecordStaff(record: LicenseRecord): string {
  const isFound = record.status === 'FOUND' || Boolean(record.foundReason);
  const isDistributed =
    record.status === 'DISTRIBUTED' ||
    record.isDistributed ||
    isFound ||
    Boolean(record.distributedAt) ||
    Boolean(record.distributedDate) ||
    Boolean(record.receivedBy && record.receivedBy !== '-' && record.receivedBy !== '---' && record.receivedBy !== '<N/A>');

  let rawStaff =
    record.distributedBy ||
    (record.rawRecord &&
      (record.rawRecord['DISTRIBUTED BY'] ||
        record.rawRecord['DISTRIBUTED_BY'] ||
        record.rawRecord['OFFICE STAFF'] ||
        record.rawRecord['STAFF'] ||
        record.rawRecord['Staff'] ||
        record.rawRecord['Office Staff'] ||
        record.rawRecord['HANDOVER_BY'] ||
        record.rawRecord['HANDED_OVER_BY'] ||
        record.rawRecord['वितरण गर्ने'] ||
        record.rawRecord['कार्यालय कर्मचारी'] ||
        record.rawRecord['कर्मचारी'])) ||
    cleanStaffRecommenderName(record.recommendingStaffName) ||
    record.foundReportedBy;

  if (
    (!rawStaff || rawStaff === '---' || rawStaff === '<N/A>') &&
    record.foundReason?.includes('distributed by:')
  ) {
    const match = record.foundReason.match(/distributed by:\s*([^.]+)/i);
    if (match && match[1]?.trim()) rawStaff = match[1].trim();
  }
  if (
    (!rawStaff || rawStaff === '---' || rawStaff === '<N/A>') &&
    record.foundReason?.includes('Staff:')
  ) {
    const match = record.foundReason.match(/Staff:\s*([^.]+)/i);
    if (match && match[1]?.trim()) rawStaff = match[1].trim();
  }

  if (rawStaff && typeof rawStaff === 'string') {
    const trimmed = rawStaff.trim();
    const upper = trimmed.toUpperCase();
    if (upper === 'SUPER_ADMIN' || upper === 'SUPERADMIN' || upper === 'SUPER ADMINISTRATOR' || upper === 'ADMIN') {
      return 'KOMAL DAHAL';
    }
    if (upper === 'DKOMAL_PLSMS5') {
      return 'DAHAL KOMAL';
    }
    if (upper === 'TMODLSUNSARI') {
      return 'TMO SUNSARI ADMINISTRATOR';
    }
    if (trimmed && trimmed !== '---' && trimmed !== '<N/A>') {
      return trimmed.toUpperCase();
    }
  }

  return isDistributed ? '<N/A>' : '---';
}

/**
 * Resolves the FULL NAME of the user / staff who marked the card as MISSING
 * (displayed in the "MISSING MARKED BY" / "SEARCHED BY" column of the missing cards table).
 *
 * Official Directive:
 * - If the record was imported or moved by unknown persons before using this app (not moved in this table by clicking on the 'MISSING' button):
 *   write '-----' dashes only.
 * - If an office staff member clicks on the 'MISSING' button in PLSMS to move the record into the missing table:
 *   display the actual FULL NAME of that staff member.
 */
export function resolveSearchedByStaff(record: LicenseRecord, _currentUserName?: string): string {
  // If the record was imported from inventory/Google Sheet or marked unknown, and NOT moved via the in-app MISSING button
  const isImportedUnknown =
    record.missingMarkedSource === 'IMPORTED_UNKNOWN' ||
    record.missingReason === 'Reported missing in inventory/Google Sheet' ||
    (record.rawRecord && (record.rawRecord['SEARCHED BY'] === '-----' || record.rawRecord['MISSING MARKED BY'] === '-----'));

  if (isImportedUnknown && record.missingMarkedSource !== 'APP_BUTTON') {
    return '-----';
  }

  let raw =
    record.missingMarkedBy ||
    record.missingReportedBy ||
    (record.rawRecord && (
      record.rawRecord['MISSING MARKED BY'] ||
      record.rawRecord['MISSING_MARKED_BY'] ||
      record.rawRecord['SEARCHED BY'] ||
      record.rawRecord['SEARCHED_BY'] ||
      record.rawRecord['MISSING REPORTED BY'] ||
      record.rawRecord['MISSING_BY'] ||
      record.rawRecord['REPORTED BY']
    ));

  if (!raw || raw === '---' || raw === '----' || raw === '-----' || raw === '<N/A>' || raw === '-') {
    return '-----';
  }

  const trimmed = String(raw).trim();
  const upper = trimmed.toUpperCase();

  // If it was one of the imported records where 'KOMAL DAHAL' was falsely stamped by the import process
  if (
    (upper === 'KOMAL DAHAL' || upper === 'SUPER ADMIN' || upper === 'SUPER_ADMIN') &&
    record.missingMarkedSource !== 'APP_BUTTON' &&
    (!record.missingReason || record.missingReason === 'Reported missing in inventory/Google Sheet')
  ) {
    return '-----';
  }

  if (
    upper === 'SUPER_ADMIN' ||
    upper === 'SUPERADMIN' ||
    upper === 'SUPER ADMINISTRATOR' ||
    upper === 'SUPER ADMIN' ||
    upper === 'ADMIN'
  ) {
    return record.missingMarkedSource === 'APP_BUTTON' ? 'KOMAL DAHAL' : '-----';
  }
  if (upper === 'DKOMAL_PLSMS5') {
    return 'DAHAL KOMAL';
  }
  if (upper === 'TMODLSUNSARI') {
    return 'TMO SUNSARI ADMINISTRATOR';
  }
  if (upper === 'SDAHAL_PLSMS5') {
    return 'SITANSHU DAHAL';
  }
  if (upper === 'STAFF_RAMESH') {
    return 'RAMESH SHRESTHA';
  }
  if (upper === 'STAFF_SITA') {
    return 'SITA ADHIKARI';
  }

  return trimmed.toUpperCase();
}

export const resolveMissingMarkedByStaff = resolveSearchedByStaff;

export const STANDARD_DOCUMENTS = [
  'Original Smart Card',
  'Payment Receipt Bill',
  'Citizenship',
  'Traffic Police Letter',
  'Traffic Police License Letter',
];

const STANDARD_DOCS_SET = new Set([
  'ORIGINAL SMART CARD',
  'PAYMENT RECEIPT BILL',
  'CITIZENSHIP',
  'TRAFFIC POLICE LETTER',
  'TRAFFIC POLICE LICENSE LETTER',
  'N/A',
  '<N/A>',
  '---',
  '----',
  '-',
]);

/**
 * Checks whether text is an internal system status / missing / recovery reason,
 * which should NEVER be displayed or stored as a submitted document or staff name.
 */
export function isInvalidReasonText(str?: string | null): boolean {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim().toLowerCase();
  if (!s) return false;
  return (
    s.includes('while searching not-found') ||
    s.includes('not-found in sorted slot') ||
    s.includes('not found in sorted slot') ||
    s.includes('reported missing') ||
    s.includes('missing from sorted slot') ||
    s.includes('not found in physical') ||
    s.includes('card recovered and located') ||
    s.includes('smart card recovered and located') ||
    s.includes('card found & recovered') ||
    s.includes('status updated') ||
    s.includes('found smart card handover') ||
    s.includes('recovered and verified with submitted document') ||
    s.includes('smart card recovered and verified')
  );
}

/**
 * Extracts and returns ONLY the chosen or written document text.
 * Strips unnecessary status text (e.g. "Smart card recovered and verified with submitted document: ...",
 * "While Searching Not-Found in Sorted Slot", etc.).
 */
export function extractCleanSubmittedDoc(val?: string | null): string {
  if (!val || typeof val !== 'string') return '';
  let str = val.trim();
  if (!str || str === '---' || str === '<N/A>' || str === '----' || str === '-') return '';

  // Check if string contains "submitted document: <doc>" pattern
  const subDocMatch = str.match(/submitted document:\s*([^.\n;]+?)(?:\.\s*(?:Received by|Distributed by)|$|\.)/i);
  if (subDocMatch && subDocMatch[1]?.trim()) {
    const extracted = subDocMatch[1].trim();
    return extractCleanSubmittedDoc(extracted);
  }

  // If prefixed with RECOM. BY: check if the inner content is valid
  if (/^(?:RECOM(?:\.|\s)*BY|RECOMMENDED\s+BY|RECOM|RECOMMENDATION)\s*:?\s*/i.test(str)) {
    const strippedRecom = str.replace(/^(?:RECOM(?:\.|\s)*BY|RECOMMENDED\s+BY|RECOM|RECOMMENDATION)\s*:?\s*/i, '').trim();
    if (isInvalidReasonText(strippedRecom)) {
      // Check if it has an embedded submitted document pattern
      const innerMatch = strippedRecom.match(/submitted document:\s*([^.\n;]+?)(?:\.\s*(?:Received by|Distributed by)|$|\.)/i);
      if (innerMatch && innerMatch[1]?.trim()) {
        return extractCleanSubmittedDoc(innerMatch[1]);
      }
      return '';
    }
    const cleanStaff = cleanStaffRecommenderName(strippedRecom);
    if (cleanStaff) {
      return `RECOM. BY: ${cleanStaff}`;
    }
    return '';
  }

  // If it's an invalid internal reason text
  if (isInvalidReasonText(str)) {
    return '';
  }

  // Check standard documents (normalize capitalization if matched)
  const upper = str.toUpperCase();
  for (const std of STANDARD_DOCUMENTS) {
    if (std.toUpperCase() === upper) return std;
  }

  return str;
}

/**
 * Cleans the staff recommender name by stripping any "RECOM. BY:", "RECOMMENDED BY:", etc. prefixes.
 * Rejects invalid reason phrases, standard document names, or placeholders.
 */
export function cleanStaffRecommenderName(val?: string | null): string {
  if (!val || typeof val !== 'string') return '';
  let str = val.trim();
  str = str.replace(/^(?:RECOM(?:\.|\s)*BY|RECOMMENDED\s+BY|RECOM|RECOMMENDATION)\s*:?\s*/i, '').trim();
  if (
    !str ||
    str === 'Office Staff Recommendation' ||
    str === '<N/A>' ||
    str === '---' ||
    str === '----' ||
    str === '-' ||
    isInvalidReasonText(str) ||
    STANDARD_DOCS_SET.has(str.toUpperCase())
  ) {
    return '';
  }
  return str;
}

/**
 * Checks whether a given document value represents an Office Staff Recommendation.
 */
export function isRecommenderDoc(doc?: string | null): boolean {
  if (!doc || typeof doc !== 'string') return false;
  const trimmed = doc.trim();
  if (!trimmed || trimmed === '---' || trimmed === '<N/A>' || trimmed === '----' || trimmed === '-') return false;
  const upper = trimmed.toUpperCase();
  if (upper === 'OFFICE STAFF RECOMMENDATION') return true;
  if (/^RECOM(?:\.|\s)*BY/i.test(upper) || /^RECOMMENDED\s+BY/i.test(upper)) {
    const clean = cleanStaffRecommenderName(trimmed);
    return Boolean(clean);
  }
  return false;
}

/**
 * Formats the submitted document string to official format:
 * "RECOM. BY: <Entered Full name>"
 */
export function formatRecommenderDoc(name?: string | null): string {
  if (!name || !name.trim()) return 'Office Staff Recommendation';
  const clean = cleanStaffRecommenderName(name);
  if (!clean) return 'Office Staff Recommendation';
  return `RECOM. BY: ${clean}`;
}

/**
 * Resolves the display text for submitted document across all areas of the app.
 * Only returns the chosen / written document text.
 */
export function resolveSubmittedDocument(
  record?: {
    status?: string;
    isDistributed?: boolean;
    submittedDocument?: string;
    recommendingStaffName?: string;
    rawRecord?: Record<string, any>;
    reason?: string;
    foundReason?: string;
    remarks?: string;
    receiverRemarks?: string;
  } | null
): string {
  if (!record) return '<N/A>';

  // 1. If recommendingStaffName is set and valid, format as RECOM. BY: <Staff Name>
  if (record.recommendingStaffName && record.recommendingStaffName.trim()) {
    const cleanStaff = cleanStaffRecommenderName(record.recommendingStaffName);
    if (cleanStaff) {
      return `RECOM. BY: ${cleanStaff}`;
    }
  }

  // 2. If submittedDocument is explicitly set, extract and clean it
  if (record.submittedDocument && record.submittedDocument.trim()) {
    const cleaned = extractCleanSubmittedDoc(record.submittedDocument);
    if (cleaned) {
      return cleaned;
    }
  }

  // 3. Check rawRecord fields
  const raw =
    record.rawRecord?.['SUBMITTED DOC.'] ||
    record.rawRecord?.['SUBMITTED DOC'] ||
    record.rawRecord?.['SUBMITTED_DOC'] ||
    record.rawRecord?.['पेश गरिएको कागजात'] ||
    record.rawRecord?.['कागजात'];

  if (raw && typeof raw === 'string' && raw.trim()) {
    const cleanedRaw = extractCleanSubmittedDoc(raw);
    if (cleanedRaw) {
      return cleanedRaw;
    }
  }

  // 4. Check if foundReason or reason contains "submitted document:"
  const reasonText = record.foundReason || record.reason || '';
  if (reasonText && reasonText.includes('submitted document:')) {
    const match = reasonText.match(/submitted document:\s*([^.\n;]+?)(?:\.\s*(?:Received by|Distributed by)|$|\.)/i);
    if (match && match[1]?.trim()) {
      const cleanedFromReason = extractCleanSubmittedDoc(match[1].trim());
      if (cleanedFromReason) {
        return cleanedFromReason;
      }
    }
  }

  // 5. If card is distributed or found, default to Original Smart Card
  const isDistributed =
    record.status === 'DISTRIBUTED' ||
    record.isDistributed ||
    record.status === 'FOUND' ||
    Boolean(record.foundReason);

  if (isDistributed) {
    return 'Original Smart Card';
  }

  return '<N/A>';
}
