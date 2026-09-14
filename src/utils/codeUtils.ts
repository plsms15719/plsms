/**
 * Utility functions for formatting and normalizing CODE NO (Old Code / New Code)
 * 
 * Strict User Directive:
 * Code numbers must never display more than 4 dashes (e.g. "------" or "- - - - - -").
 * Whenever placeholder dashes or empty code values are shown, strictly display exactly 4 dashes: "----".
 */

/**
 * Normalizes any code value so that if it is empty, placeholder, or composed
 * of dashes/spaces (like "- - - - - -", "------", etc.), it strictly outputs "----".
 * If a value contains a sequence of 4 or more dashes, it replaces them with "----".
 */
export function normalizeCodeNumber(val: unknown): string {
  if (val === undefined || val === null) {
    return '----';
  }

  const str = String(val).trim();
  if (!str) {
    return '----';
  }

  // Check if the entire string consists solely of hyphens, dashes, en-dashes, em-dashes, spaces, underscores, slashes, or dots
  const stripped = str.replace(/[\s\-_—–./\\]/g, '');
  if (!stripped || /^(na|n\/a|null|none|nil|undefined|0)$/i.test(stripped)) {
    return '----';
  }

  // If the string contains a run of 4 or more dashes (with or without spaces between them)
  // e.g. "- - - - - -", "------", "--------", " - - - - "
  let cleaned = str.replace(/(?:[-—–]\s*){4,}/g, '----');
  cleaned = cleaned.replace(/[-—–]{4,}/g, '----');

  return cleaned.trim();
}

/**
 * Extracts and normalizes the old and new code parts for any license record.
 * Handles both separated columns (OLD CODE / NEW CODE) and combined strings (e.g. "265/- - - - - -").
 */
export function getRecordCodeParts(record: any): { oldPart: string; newPart: string; fullDisplay: string } {
  if (!record) {
    return { oldPart: '----', newPart: '----', fullDisplay: '----/----' };
  }

  const raw = record.rawRecord || {};

  let rawOld =
    record.oldCode ||
    raw['OLD CODE'] ||
    raw['Old Code'] ||
    raw['old_code'] ||
    raw['OLD_CODE'] ||
    raw['OLD CODE NO'] ||
    raw['OLD CODE NO.'] ||
    raw['OLD CODE NUMBER'] ||
    '';

  let rawNew =
    record.newCode ||
    raw['NEW CODE'] ||
    raw['New Code'] ||
    raw['new_code'] ||
    raw['NEW_CODE'] ||
    raw['NEW CODE NO'] ||
    raw['NEW CODE NO.'] ||
    raw['NEW CODE NUMBER'] ||
    '';

  // Fallback to combined code fields if old or new code is missing
  const combinedCode =
    record.codeNo ||
    record.code ||
    raw['CODE NO'] ||
    raw['CODE NO.'] ||
    raw['CODE'] ||
    raw['Code'] ||
    '';

  if ((!rawOld || !rawNew) && combinedCode && String(combinedCode).includes('/')) {
    const parts = String(combinedCode).split('/');
    if (!rawOld && parts[0]) rawOld = parts[0];
    if (!rawNew && parts[1]) rawNew = parts[1];
  }

  const oldPart = normalizeCodeNumber(rawOld);
  const newPart = normalizeCodeNumber(rawNew);

  return {
    oldPart,
    newPart,
    fullDisplay: `${oldPart}/${newPart}`,
  };
}

/**
 * Formats license number or applicant ID search input based on official business rules:
 * 1. If License Searcher types first 2 digits and first dash '-', recognize license format:
 *    xx-xx-xxxxxxxxx (first 2 digits + '-' + second 2 digits + '-' + up to 9 digits, max 15 chars).
 *    Automatically fills the remaining dash after the second 2 digits, and strictly limits to 9 numbers at the end.
 * 2. If user types continuous digits more than 10 digits without dashes, automatically fills the two (-) dashes as xx-xx-xxxxxxxxx.
 * 3. If Applicant ID searcher types up to 10 digits/alphanumeric characters, keeps it as Applicant ID without dashes.
 */
export function formatLicenseOrApplicantInput(input: string, prevInput: string = ''): string {
  if (!input) return '';

  let raw = input.toUpperCase().replace(/\s+/g, '');
  const isDelete = Boolean(prevInput && raw.length < prevInput.length);

  // If user is deleting/backspacing, allow deletion without re-inserting dashes prematurely
  if (isDelete) {
    return raw.slice(0, 15);
  }

  // Prevent leading dash or multiple consecutive dashes
  raw = raw.replace(/^-+/, '').replace(/-{2,}/g, '-');

  // Rule 1: License searcher typed a dash or has dash in input
  if (raw.includes('-')) {
    const parts = raw.split('-');
    const p1 = (parts[0] || '').replace(/\D/g, '').slice(0, 2);

    const restOfParts = parts.slice(1).join('-');
    const subParts = restOfParts.split('-');
    let p2 = (subParts[0] || '').replace(/\D/g, '').slice(0, 2);
    let p3 = '';

    if (subParts.length > 1) {
      p3 = subParts.slice(1).join('').replace(/\D/g, '').slice(0, 9);
    } else if (restOfParts.replace(/\D/g, '').length > 2) {
      const allDigits = restOfParts.replace(/\D/g, '');
      p2 = allDigits.slice(0, 2);
      p3 = allDigits.slice(2, 11);
    }

    if (p3 || parts.length >= 3) {
      return `${p1}-${p2}-${p3}`;
    } else if (p2.length === 2) {
      // Auto-fill remaining dash when second 2 digits are entered
      return `${p1}-${p2}-`;
    } else {
      return `${p1}-${p2}`;
    }
  }

  // Pure digits without dash
  const isPureDigits = /^\d+$/.test(raw);
  if (isPureDigits) {
    if (raw.length > 10) {
      // Rule 2: Continuous more than 10 digits -> auto fill two (-) dashes as xx-xx-xxxxxxxxx
      const p1 = raw.slice(0, 2);
      const p2 = raw.slice(2, 4);
      const p3 = raw.slice(4, 13); // up to 9 digits (total 13 digits = 15 chars)
      return `${p1}-${p2}-${p3}`;
    } else {
      // Rule 3: Up to 10 digits -> Applicant ID, do not fill any dashes
      return raw;
    }
  }

  // Rule 3 (alphanumeric Applicant ID without dashes): allow up to 10 characters
  return raw.replace(/[^A-Z0-9]/g, '').slice(0, 10);
}
