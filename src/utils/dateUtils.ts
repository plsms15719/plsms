import NepaliDateImport from 'nepali-date-converter';

// Resolve CJS / ESM double-default nesting safely across all environments
const NepaliDate: any =
  (NepaliDateImport as any)?.default?.default ||
  (NepaliDateImport as any)?.default ||
  NepaliDateImport;

/**
 * Utility to convert AD dates to Bikram Sambat (BS) Nepali Date and format Lot numbers
 * Powered by official Nepali Bikram Sambat calendar engine
 */

const DEVANAGARI_DIGITS: { [key: string]: string } = {
  '0': '०',
  '1': '१',
  '2': '२',
  '3': '३',
  '4': '४',
  '5': '५',
  '6': '६',
  '7': '७',
  '8': '८',
  '9': '९',
};

export function toNepaliDevanagariDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (char) => DEVANAGARI_DIGITS[char] || char);
}

/**
 * Converts any date input (AD Date, ISO string, or existing BS string) into exact YYYY-MM-DD Bikram Sambat format.
 */
export function getNepaliDate(dateInput?: string | Date): string {
  if (!dateInput) {
    return '<N/A>';
  }

  // If input is a string, check if it is already a BS date or contains Devanagari numerals
  if (typeof dateInput === 'string') {
    const raw = dateInput.trim();
    if (!raw || raw === '—' || raw === '-' || raw === '---' || raw === 'N/A' || raw === '<N/A>' || raw === 'undefined' || raw === 'null') {
      return '<N/A>';
    }

    // If it is an ISO timestamp with T or Z, parse as AD Date first
    if (raw.includes('T') || raw.includes('Z')) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        try {
          const nepDate = NepaliDate.fromAD(d);
          return nepDate.format('YYYY-MM-DD');
        } catch {}
      }
    }

    // Normalize Devanagari digits to standard ASCII digits
    const devanagariMap: { [key: string]: string } = {
      '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
      '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
    };
    const normalizedDigits = raw.replace(/[०-९]/g, (char) => devanagariMap[char] || char);

    // Strip any trailing time component if present (e.g., T14:24:22... or space 14:24)
    const dateOnlyPart = normalizedDigits.split(/[T\s]/)[0];

    // Check if it already matches a standard BS year (2060-2099)
    const bsMatch = dateOnlyPart.match(/^(20[6-9]\d)[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (bsMatch) {
      const y = bsMatch[1];
      const m = String(parseInt(bsMatch[2], 10)).padStart(2, '0');
      const d = String(parseInt(bsMatch[3], 10)).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    return '<N/A>';
  }

  try {
    const nepDate = NepaliDate.fromAD(d);
    return nepDate.format('YYYY-MM-DD');
  } catch {
    // Fallback if date is outside supported range
    const adYear = d.getFullYear();
    const bsYear = adYear + 57;
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${bsYear}-${m}-${day}`;
  }
}

/**
 * Normalizes any date input (BS string, Devanagari numerals, AD date, ISO string)
 * into a standard YYYY-MM-DD Bikram Sambat date string, or returns null if invalid.
 */
export function normalizeNepaliBSDate(input?: string | Date | null): string | null {
  if (!input) return null;
  const res = getNepaliDate(input);
  if (!res || res === '<N/A>' || res === '---' || !isValidNepaliBSDate(res)) {
    return null;
  }
  return res;
}

/**
 * Calculates current Nepali week range (Sunday to Saturday)
 */
export function getNepaliWeekRange(refDate?: Date): { fromDateBS: string; toDateBS: string } {
  const d = refDate ? new Date(refDate) : new Date();
  const dayOfWeek = isNaN(d.getDay()) ? 0 : d.getDay(); // 0 is Sunday, 6 is Saturday
  const sunday = new Date(d);
  sunday.setDate(d.getDate() - dayOfWeek);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  return {
    fromDateBS: getNepaliDate(sunday),
    toDateBS: getNepaliDate(saturday),
  };
}

/**
 * Calculates current Nepali month range (1st day of month to last day of month)
 */
export function getNepaliMonthRange(refDate?: Date): { fromDateBS: string; toDateBS: string } {
  const todayBS = getNepaliDate(refDate || new Date());
  const parts = todayBS.split('-').map((v) => parseInt(v, 10));
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    const y = parts[0];
    const m = parts[1];
    const days = getDaysInNepaliMonth(y, m - 1);
    return {
      fromDateBS: `${y}-${String(m).padStart(2, '0')}-01`,
      toDateBS: `${y}-${String(m).padStart(2, '0')}-${String(days).padStart(2, '0')}`,
    };
  }
  return { fromDateBS: todayBS, toDateBS: todayBS };
}

/**
 * Returns the number of days in a given Nepali Year and MonthIndex (0 = Baisakh, 11 = Chaitra)
 */
export function getDaysInNepaliMonth(year: number, monthIndex: number): number {
  try {
    // Check days by stepping through the month
    for (let day = 32; day >= 29; day--) {
      try {
        const nd = new NepaliDate(year, monthIndex, day);
        if (nd.getMonth() === monthIndex && nd.getDate() === day && nd.getYear() === year) {
          return day;
        }
      } catch {
        continue;
      }
    }
    return 30;
  } catch {
    return 30;
  }
}

/**
 * Returns the starting day of week (0 = Sunday, 6 = Saturday) for 1st day of a Nepali Month
 */
export function getNepaliMonthStartDay(year: number, monthIndex: number): number {
  try {
    const nd = new NepaliDate(year, monthIndex, 1);
    return nd.getDay();
  } catch {
    return 0;
  }
}

/**
 * Validates whether a YYYY-MM-DD string is a valid Bikram Sambat date
 */
export function isValidNepaliBSDate(bsString: string): boolean {
  if (!bsString || typeof bsString !== 'string') return false;
  const match = bsString.trim().match(/^(20\d\d)-(\d{1,2})-(\d{1,2})$/);
  if (!match) return false;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10) - 1; // 0-indexed
  const d = parseInt(match[3], 10);
  if (m < 0 || m > 11 || d < 1 || d > 32) return false;
  const maxDays = getDaysInNepaliMonth(y, m);
  return d <= maxDays;
}

export function formatDistributedDateBS(dateInput?: string | Date): string {
  if (!dateInput) return '<N/A>';
  return getNepaliDate(dateInput);
}

export function getNepaliDevanagariDate(dateInput?: string | Date): string {
  const standardBS = getNepaliDate(dateInput);
  return toNepaliDevanagariDigits(standardBS);
}

export function getOrdinalLotCode(index: number, customLot?: string): string {
  if (customLot && customLot.trim()) return customLot.trim();
  const n = index + 1;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] || s[v] || s[0];
  return `${n}${suffix}-LOT`;
}

export function formatNum(num: number): string {
  return (num || 0).toLocaleString('en-US');
}

export const NEP_DAYS = [
  'आइतबार',
  'सोमबार',
  'मंगलबार',
  'बुधबार',
  'बिहीबार',
  'शुक्रबार',
  'शनिबार',
];

export const NEP_MONTHS = [
  'वैशाख',
  'जेठ',
  'असार',
  'साउन',
  'भदौ',
  'असोज',
  'कात्तिक',
  'मंसिर',
  'पुस',
  'माघ',
  'फागुन',
  'चैत',
];

/**
 * Returns formatted Nepali BS Date object:
 * e.g., { dayOfWeek: 'शुक्रबार', day: '११', monthName: 'भदौ', year: '२०८३', fullDateString: 'शुक्रबार ११ भदौ २०८३' }
 */
export function getNepaliFullBSDate(dateInput?: string | Date): {
  dayOfWeek: string;
  day: string;
  monthName: string;
  year: string;
  fullDateString: string;
} {
  const d = dateInput instanceof Date ? dateInput : (dateInput ? new Date(dateInput) : new Date());
  const dayIdx = isNaN(d.getDay()) ? 5 : d.getDay();
  const dayOfWeek = NEP_DAYS[dayIdx] || 'शुक्रबार';

  const bsStandard = getNepaliDate(d);
  const parts = bsStandard.split('-');
  const bsYearNum = parseInt(parts[0], 10) || 2083;
  const bsMonthNum = parseInt(parts[1], 10) || 5;
  const bsDayNum = parseInt(parts[2], 10) || 11;

  const monthName = NEP_MONTHS[Math.max(0, Math.min(11, bsMonthNum - 1))] || 'भदौ';
  const nepDay = toNepaliDevanagariDigits(String(bsDayNum));
  const nepYear = toNepaliDevanagariDigits(String(bsYearNum));

  return {
    dayOfWeek,
    day: nepDay,
    monthName,
    year: nepYear,
    fullDateString: `${dayOfWeek} ${nepDay} ${monthName} ${nepYear}`,
  };
}

/**
 * Returns Nepali live time with Devanagari digits and period:
 * e.g. "०८:३२:२२ राती"
 */
export function getNepaliLiveTime(dateInput?: Date): {
  timeString: string;
  period: string;
  fullTimeString: string;
} {
  const d = dateInput || new Date();
  const rawHours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();

  // 12-hour format with leading zeros
  let h12 = rawHours % 12;
  if (h12 === 0) h12 = 12;
  const hourStr = String(h12).padStart(2, '0');
  const minStr = String(minutes).padStart(2, '0');
  const secStr = String(seconds).padStart(2, '0');

  const nepaliTimeDigits = toNepaliDevanagariDigits(`${hourStr}:${minStr}:${secStr}`);

  let period = 'बिहान';
  if (rawHours >= 0 && rawHours < 4) {
    period = 'राती';
  } else if (rawHours >= 4 && rawHours < 12) {
    period = 'बिहान';
  } else if (rawHours >= 12 && rawHours < 16) {
    period = 'दिउँसो';
  } else if (rawHours >= 16 && rawHours < 20) {
    period = 'साँझ';
  } else {
    period = 'राती';
  }

  return {
    timeString: nepaliTimeDigits,
    period,
    fullTimeString: `${nepaliTimeDigits} ${period}`,
  };
}

/**
 * Resolves the Nepal wall clock time (Asia/Kathmandu UTC+05:45) for any Date input.
 */
export function getNepalWallClockDate(dateInput?: string | Date | null): Date {
  const d = dateInput instanceof Date ? dateInput : (dateInput ? new Date(dateInput) : new Date());
  if (isNaN(d.getTime())) return new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + (5 * 60 + 45) * 60000);
}

/**
 * Returns today's Bikram Sambat date strictly in Nepal Time (UTC+05:45) formatted as YYYY-MM-DD.
 */
export function getTodayNepaliBSDate(refDate?: Date): string {
  const nepalNow = getNepalWallClockDate(refDate);
  try {
    const nepDate = NepaliDate.fromAD ? NepaliDate.fromAD(nepalNow) : new NepaliDate(nepalNow);
    return nepDate.format('YYYY-MM-DD');
  } catch {
    return getNepaliDate(nepalNow);
  }
}

/**
 * Normalizes any distribution date input (LicenseRecord, BS string, ISO string, AD Date)
 * into a standard YYYY-MM-DD Bikram Sambat string.
 */
export function extractDistributionBSDate(
  recordOrDate?: any,
  fallbackDate?: string | Date | null
): string | null {
  if (!recordOrDate && !fallbackDate) return null;

  let rawValue: any = recordOrDate;

  // If passed a LicenseRecord object or similar structure
  if (rawValue && typeof rawValue === 'object' && !(rawValue instanceof Date)) {
    rawValue =
      rawValue.distributedDate ||
      rawValue.distributedAt ||
      (rawValue.rawRecord && (
        rawValue.rawRecord['DISTRIBUTED DATE'] ||
        rawValue.rawRecord['DISTRIBUTION DATE'] ||
        rawValue.rawRecord['DATE']
      )) ||
      fallbackDate;
  } else if (!rawValue && fallbackDate) {
    rawValue = fallbackDate;
  }

  if (!rawValue) return null;

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed === '---' || trimmed === '<N/A>' || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }

    // Convert Devanagari numerals to ASCII digits
    const devanagariMap: { [key: string]: string } = {
      '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
      '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
    };
    const normalized = trimmed.replace(/[०-९]/g, (c) => devanagariMap[c] || c).split(/[T\s]/)[0];

    // Check if it already matches a standard BS year (2060-2099)
    const bsMatch = normalized.match(/^(20[6-9]\d)[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (bsMatch) {
      const y = bsMatch[1];
      const m = String(parseInt(bsMatch[2], 10)).padStart(2, '0');
      const d = String(parseInt(bsMatch[3], 10)).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    // Otherwise, try parsing as ISO / AD timestamp shifted to Nepal Time
    const parsedDate = new Date(trimmed);
    if (!isNaN(parsedDate.getTime())) {
      const nepalTime = getNepalWallClockDate(parsedDate);
      try {
        const nepDate = NepaliDate.fromAD ? NepaliDate.fromAD(nepalTime) : new NepaliDate(nepalTime);
        return nepDate.format('YYYY-MM-DD');
      } catch {
        return getNepaliDate(nepalTime);
      }
    }
  } else if (rawValue instanceof Date) {
    if (!isNaN(rawValue.getTime())) {
      const nepalTime = getNepalWallClockDate(rawValue);
      try {
        const nepDate = NepaliDate.fromAD ? NepaliDate.fromAD(nepalTime) : new NepaliDate(nepalTime);
        return nepDate.format('YYYY-MM-DD');
      } catch {
        return getNepaliDate(nepalTime);
      }
    }
  }

  const fallbackBS = getNepaliDate(rawValue);
  return fallbackBS && fallbackBS !== '<N/A>' ? fallbackBS : null;
}

/**
 * Checks if a distribution timestamp or date occurred on the same calendar day in Nepal (Bikram Sambat today).
 * 
 * STRICT TIME-BOUND RULE (Midnight Nepal Time):
 * Operator / Staff can change a distributed card to 'MISSING' strictly up to 11:59:59 PM (midnight)
 * of the Nepali Calendar day (Nepal Time UTC+05:45) on which the card was distributed.
 * From the next calendar day onward in Nepal Time (DATE(distributed_BS) < CURRENT_NEPALI_BS_DATE),
 * the MISSING action expires and the button disappears.
 *
 * Supports:
 * - LicenseRecord object (extracts distributedDate, distributedAt, rawRecord['DISTRIBUTED DATE'])
 * - Bikram Sambat date string (e.g. "2083-05-28", "२०८३-०५-२८")
 * - Gregorian Date / ISO timestamp (e.g. "2026-09-13T09:28:30.114Z")
 * - Optional fallback date string/Date as 2nd parameter
 */
export function isDistributedSameDay(
  recordOrDate?: any,
  fallbackDate?: string | Date | null
): boolean {
  try {
    const distBS = extractDistributionBSDate(recordOrDate, fallbackDate);
    if (!distBS) return false;

    const todayBS = getTodayNepaliBSDate();
    return distBS === todayBS;
  } catch {
    return false;
  }
}

/**
 * Determines whether the "MISSING" action button should be displayed for a given record.
 * 
 * SPECIAL BUSINESS LOGIC (User Mandate):
 * If a card was reported missing, found, and handed over/distributed on the same day
 * (or is a recovered found card that has completed handover/distribution), the case is
 * finished, and the MISSING action button must NOT be displayed anywhere in the STATUS
 * column of any table or action dialog.
 */
export function canDisplayMissingButton(record?: any): boolean {
  if (!record) return false;

  // 1. If currently active status is MISSING, do not show "Mark as Missing" button
  if (
    record.status === 'MISSING' ||
    record.rawRecord?.['STATUS'] === 'MISSING' ||
    record.rawRecord?.['MISSING'] === 'MISSING'
  ) {
    return false;
  }

  // 2. Check if the card is a FOUND card or was marked as found
  const isFound = Boolean(
    record.status === 'FOUND' ||
    record.rawRecord?.['FOUND'] === 'FOUND' ||
    record.rawRecord?.['STATUS'] === 'FOUND' ||
    record.foundDate ||
    record.foundReportedAt ||
    record.foundHandoverDone ||
    record.rawRecord?.['FOUND_HANDOVER'] === 'DONE' ||
    record.rawRecord?.['FOUND DATE'] ||
    record.rawRecord?.['FOUND_DATE']
  );

  // 3. Check if handover / distribution is completed
  const isHandedOver = Boolean(
    record.foundHandoverDone === true ||
    record.rawRecord?.['FOUND_HANDOVER'] === 'DONE' ||
    record.status === 'DISTRIBUTED' ||
    record.isDistributed === true ||
    record.rawRecord?.['DISTRIBUTED'] === 'DISTRIBUTED' ||
    record.rawRecord?.['STATUS DISTRIBUTED'] === 'DISTRIBUTED' ||
    (record.receivedBy && record.receivedBy !== '-' && record.receivedBy.trim().length > 0)
  );

  // If the card was marked as found and has been handed over, case is finished -> NEVER show missing button
  if (isFound && isHandedOver) {
    return false;
  }

  // 4. Same-day missing, found, and handover special logic:
  const missingDate = (
    record.missingDate ||
    record.rawRecord?.['MISSING DATE'] ||
    record.rawRecord?.['MISSING_DATE'] ||
    ''
  ).toString().trim();

  const foundDate = (
    record.foundDate ||
    record.rawRecord?.['FOUND DATE'] ||
    record.rawRecord?.['FOUND_DATE'] ||
    ''
  ).toString().trim();

  const distDate = (
    record.distributedDate ||
    record.rawRecord?.['DISTRIBUTED DATE'] ||
    record.rawRecord?.['DISTRIBUTED_DATE'] ||
    ''
  ).toString().trim();

  // If missing date matches found date or distribution date (same day event)
  if (missingDate && (missingDate === foundDate || missingDate === distDate)) {
    return false;
  }

  // If found date matches distribution date and card is distributed/handed over
  if (isFound && foundDate && distDate && foundDate === distDate) {
    return false;
  }

  // If marked found or missing on the same day as today and card is handed over
  const todayBS = getTodayNepaliBSDate();
  if (isHandedOver && (missingDate === todayBS || foundDate === todayBS)) {
    return false;
  }

  return true;
}

