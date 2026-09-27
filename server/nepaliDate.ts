/**
 * Server-side Bikram Sambat (BS) Nepali Calendar & Devanagari Conversion Utility
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

/**
 * Converts English digits (0-9) to Nepali Devanagari digits (०-९)
 */
export function toDevanagariDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (char) => DEVANAGARI_DIGITS[char] || char);
}

/**
 * Converts AD Date to Bikram Sambat (BS) date
 */
export function getBikramSambatDate(dateInput?: string | Date): {
  bsYear: number;
  bsMonth: number;
  bsDay: number;
  formattedBS: string;
  formattedDevanagariBS: string;
} {
  // If string date input is already a BS date (e.g. 2083-05-10 or 2083/05/10)
  if (typeof dateInput === 'string') {
    const raw = dateInput.trim();

    // If it is an ISO timestamp with T or Z, parse as AD Date
    if (raw.includes('T') || raw.includes('Z')) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        return getBikramSambatDate(d);
      }
    }

    const devanagariMap: { [key: string]: string } = {
      '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
      '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
    };
    const normalized = raw.replace(/[०-९]/g, (c) => devanagariMap[c] || c).split(/[T\s]/)[0];
    const bsMatch = normalized.match(/^(20[6-9]\d)[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (bsMatch) {
      const bsYear = parseInt(bsMatch[1], 10);
      const bsMonth = parseInt(bsMatch[2], 10);
      const bsDay = parseInt(bsMatch[3], 10);
      const mm = String(bsMonth).padStart(2, '0');
      const dd = String(bsDay).padStart(2, '0');
      return {
        bsYear,
        bsMonth,
        bsDay,
        formattedBS: `${bsYear}-${mm}-${dd}`,
        formattedDevanagariBS: `${bsYear}-${mm}-${dd}`,
      };
    }
  }

  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  const adYear = validDate.getFullYear();
  const adMonth = validDate.getMonth() + 1; // 1-12
  const adDay = validDate.getDate();

  let bsYear = adYear + 57;
  let bsMonth = 1;
  let bsDay = 1;

  if (adMonth === 1) { // Jan
    bsYear = adYear + 56;
    if (adDay < 15) {
      bsMonth = 9; // Poush
      bsDay = adDay + 16;
    } else {
      bsMonth = 10; // Magh
      bsDay = adDay - 14;
    }
  } else if (adMonth === 2) { // Feb
    bsYear = adYear + 56;
    if (adDay < 13) {
      bsMonth = 10; // Magh
      bsDay = adDay + 17;
    } else {
      bsMonth = 11; // Falgun
      bsDay = adDay - 12;
    }
  } else if (adMonth === 3) { // Mar
    bsYear = adYear + 56;
    if (adDay < 15) {
      bsMonth = 11; // Falgun
      bsDay = adDay + 16;
    } else {
      bsMonth = 12; // Chaitra
      bsDay = adDay - 14;
    }
  } else if (adMonth === 4) { // Apr
    if (adDay < 14) {
      bsYear = adYear + 56;
      bsMonth = 12; // Chaitra
      bsDay = adDay + 17;
    } else {
      bsYear = adYear + 57;
      bsMonth = 1; // Baisakh
      bsDay = adDay - 13;
    }
  } else if (adMonth === 5) { // May
    if (adDay < 15) {
      bsMonth = 1; // Baisakh
      bsDay = adDay + 17;
    } else {
      bsMonth = 2; // Jestha
      bsDay = adDay - 14;
    }
  } else if (adMonth === 6) { // Jun
    if (adDay < 15) {
      bsMonth = 2; // Jestha
      bsDay = adDay + 17;
    } else {
      bsMonth = 3; // Ashadh
      bsDay = adDay - 14;
    }
  } else if (adMonth === 7) { // Jul
    if (adDay < 16) {
      bsMonth = 3; // Ashadh
      bsDay = adDay + 16;
    } else {
      bsMonth = 4; // Shrawan
      bsDay = adDay - 15;
    }
  } else if (adMonth === 8) { // Aug
    if (adDay < 17) {
      bsMonth = 4; // Shrawan
      bsDay = adDay + 16;
    } else {
      bsMonth = 5; // Bhadra
      bsDay = adDay - 16;
    }
  } else if (adMonth === 9) { // Sep
    if (adDay < 17) {
      bsMonth = 5; // Bhadra
      bsDay = adDay + 15;
    } else {
      bsMonth = 6; // Ashwin
      bsDay = adDay - 16;
    }
  } else if (adMonth === 10) { // Oct
    if (adDay < 18) {
      bsMonth = 6; // Ashwin
      bsDay = adDay + 14;
    } else {
      bsMonth = 7; // Kartik
      bsDay = adDay - 17;
    }
  } else if (adMonth === 11) { // Nov
    if (adDay < 17) {
      bsMonth = 7; // Kartik
      bsDay = adDay + 14;
    } else {
      bsMonth = 8; // Mangsir
      bsDay = adDay - 16;
    }
  } else { // Dec (Month 12)
    if (adDay < 16) {
      bsMonth = 8; // Mangsir
      bsDay = adDay + 14;
    } else {
      bsMonth = 9; // Poush
      bsDay = adDay - 15;
    }
  }

  // Normalize month & day
  if (bsDay <= 0) bsDay = 1;
  if (bsDay > 32) bsDay = 32;

  const mm = String(bsMonth).padStart(2, '0');
  const dd = String(bsDay).padStart(2, '0');

  const formattedBS = `${bsYear}-${mm}-${dd}`;
  const formattedDevanagariBS = `${bsYear}-${mm}-${dd}`;

  return {
    bsYear,
    bsMonth,
    bsDay,
    formattedBS,
    formattedDevanagariBS,
  };
}

/**
 * Returns current or given date formatted in Nepali Bikram Sambat with Devanagari numerals
 * Example: "२०८३/०५/०८"
 */
export function getNepaliDevanagariBSDate(dateInput?: string | Date): string {
  return getBikramSambatDate(dateInput).formattedDevanagariBS;
}

/**
 * Normalizes any date string (ISO, AD Date, Devanagari BS, ASCII BS)
 * into a standardized YYYY-MM-DD Bikram Sambat date string.
 */
export function normalizeToNepaliBS(dateInput?: string | Date | null): string | null {
  if (!dateInput) return null;
  const raw = String(dateInput).trim();
  if (!raw || raw === '—' || raw === '-' || raw === '---' || raw === 'N/A' || raw === '<N/A>' || raw === 'undefined' || raw === 'null') {
    return null;
  }
  try {
    const res = getBikramSambatDate(raw);
    return res.formattedBS || null;
  } catch {
    return null;
  }
}
