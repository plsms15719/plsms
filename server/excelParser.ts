import fs from 'fs';
import path from 'path';
import * as xlsxModule from 'xlsx';
import { ColumnMapping } from '../src/types';

// Safely obtain SheetJS XLSX object in ESM / CommonJS / tsx environments
export const XLSX = (xlsxModule as any).default || xlsxModule;

export interface ParsedSpreadsheetResult {
  headers: string[];
  rows: Record<string, any>[];
  totalRows: number;
  suggestedMapping: Partial<ColumnMapping>;
}

/**
 * Intelligent 2D matrix parser that identifies the actual header row,
 * bypassing official government title banners and summary rows (e.g. TOTAL RECORDS: X)
 */
export function extractHeadersAndDataFromMatrix(matrix: any[][]): { headers: string[]; rows: Record<string, any>[] } {
  if (!matrix || matrix.length === 0) return { headers: [], rows: [] };

  // Scan the first 25 rows to identify the real column header row
  let bestHeaderRowIndex = 0;
  let bestScore = 0;

  for (let r = 0; r < Math.min(25, matrix.length); r++) {
    const candidateRow = matrix[r];
    if (!Array.isArray(candidateRow) || candidateRow.length === 0) continue;

    let score = 0;
    for (const cell of candidateRow) {
      if (!cell) continue;
      const str = String(cell).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
      if (str === 'sn' || str === 'slno' || str === 'sno') score += 2;
      if (str.includes('applicant') || str.includes('appid') || str.includes('applno')) score += 3;
      if (str.includes('fullname') || str.includes('holdername') || str === 'name') score += 3;
      if (str.includes('license') || str.includes('dlno') || str.includes('cardno')) score += 3;
      if (str.includes('category') || str.includes('vehicleclass') || str.includes('licensetype')) score += 2;
      if (str.includes('department') || str.includes('office') || str.includes('branch')) score += 2;
      if (str.includes('status')) score += 2;
      if (str.includes('oldcode') || str.includes('newcode')) score += 2;
      if (str.includes('receivedby') || str.includes('distributeddate') || str.includes('distributedby')) score += 2;
      if (str.includes('submitteddoc') || str.includes('citizenship') || str.includes('nid')) score += 2;
      if (str.includes('phone') || str.includes('mobile')) score += 2;
      if (str.includes('issuedate') || str.includes('expirydate')) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestHeaderRowIndex = r;
    }
  }

  const headerRow = matrix[bestHeaderRowIndex] || [];
  const rawHeaders: string[] = [];

  for (let idx = 0; idx < headerRow.length; idx++) {
    const col = headerRow[idx];
    const val = col !== undefined && col !== null ? String(col).trim() : '';
    rawHeaders.push(val || `Column_${idx + 1}`);
  }

  // Remove trailing generic/empty columns if they are not real headers
  while (rawHeaders.length > 0 && rawHeaders[rawHeaders.length - 1].startsWith('Column_')) {
    rawHeaders.pop();
  }

  const headers = rawHeaders.length > 0 ? [...rawHeaders] : ['Column_1'];

  // Check if the immediate next row is a subheader row (e.g. Row 5: DISTRIBUTED, MISSING, FOUND under STATUS)
  let startDataRow = bestHeaderRowIndex + 1;
  if (startDataRow < matrix.length) {
    const nextRow = matrix[startDataRow];
    if (Array.isArray(nextRow)) {
      const hasStatusSubheaders = nextRow.some((c: any) => {
        const s = String(c || '').trim().toUpperCase();
        return s === 'DISTRIBUTED' || s === 'MISSING' || s === 'FOUND';
      });
      const hasRealData = nextRow.some((c: any) => {
        const s = String(c || '').trim();
        return /^\d{2}-\d{2}-\d{8}$/.test(s) || /^\d{8,}$/.test(s);
      });

      if (hasStatusSubheaders && !hasRealData) {
        // Overlay subheader titles (e.g. DISTRIBUTED, MISSING, FOUND) into the header list
        for (let c = 0; c < nextRow.length; c++) {
          const subVal = String(nextRow[c] || '').trim();
          if (subVal) {
            if (c < headers.length) {
              // If previous header was generic or Column_*, replace it; if it was STATUS, distinguish or append
              if (headers[c].startsWith('Column_') || headers[c] === '' || headers[c] === 'STATUS') {
                headers[c] = subVal;
              }
            } else {
              headers.push(subVal);
            }
          }
        }
        startDataRow++;
      }
    }
  }

  const headersCount = headers.length;
  const rows: Record<string, any>[] = [];

  for (let r = startDataRow; r < matrix.length; r++) {
    const rowArray = matrix[r];
    if (!Array.isArray(rowArray) || rowArray.length === 0) continue;

    // Check if it's a summary row like "TOTAL RECORDS: 0" or empty
    const firstCell = String(rowArray[0] || '').trim().toUpperCase();
    if (firstCell.startsWith('TOTAL RECORDS:') || firstCell.startsWith('TOTAL:')) {
      continue;
    }

    // Check if entire row has meaningful content
    const hasData = rowArray.some((c: any) => c !== undefined && c !== null && String(c).trim() !== '');
    if (!hasData) continue;

    const rowObj: Record<string, any> = {};
    for (let c = 0; c < headersCount; c++) {
      const val = rowArray[c];
      rowObj[headers[c]] = val !== undefined && val !== null ? String(val).trim() : '';
    }
    rows.push(rowObj);
  }

  return { headers, rows };
}

/**
 * High-performance, streaming-capable CSV Parser
 */
export function parseCSVFast(text: string): { headers: string[]; rows: Record<string, any>[] } {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Auto-detect delimiter from the first 2048 characters
  const sample = text.slice(0, 2048);
  const firstLine = sample.split(/[\r\n]+/)[0] || '';
  
  let delimiter = ',';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const pipeCount = (firstLine.match(/\|/g) || []).length;

  if (tabCount > commaCount && tabCount > semiCount) {
    delimiter = '\t';
  } else if (semiCount > commaCount && semiCount > tabCount) {
    delimiter = ';';
  } else if (pipeCount > commaCount && pipeCount > semiCount) {
    delimiter = '|';
  }

  const lines: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          cell += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(cell.trim());
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && i + 1 < len && text[i + 1] === '\n') {
          i++;
        }
        row.push(cell.trim());
        cell = '';
        if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
          lines.push(row);
        }
        row = [];
      } else {
        cell += ch;
      }
    }
  }

  // Push final remaining cell/row
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      lines.push(row);
    }
  }

  return extractHeadersAndDataFromMatrix(lines);
}

/**
 * Intelligent Column Detection
 */
export function detectColumnMapping(headers: string[]): Partial<ColumnMapping> {
  const mapping: Partial<ColumnMapping> = {};

  headers.forEach((header, idx) => {
    const raw = header.trim();
    const h = raw.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. S.N. (Column A)
    if (
      !mapping.sn &&
      (h === 'sn' || h === 'sno' || h === 'slno' || h === 'serialno' || h === 'sn' || h === 'serialnumber')
    ) {
      mapping.sn = raw;
    }
    // 2. APPLICANT ID (Column B)
    else if (
      !mapping.applicationNumber &&
      (h.includes('applicantid') ||
        h.includes('applicationid') ||
        h.includes('applicationno') ||
        h.includes('applicationnumber') ||
        h.includes('application') ||
        h.includes('appid') ||
        h.includes('appno') ||
        h.includes('applno') ||
        h.includes('refno') ||
        h.includes('referenceno') ||
        h.includes('tokenno') ||
        h.includes('slipno') ||
        h.includes('slip') ||
        h.includes('token') ||
        h.includes('reference'))
    ) {
      mapping.applicationNumber = raw;
    }
    // 3. FULL NAME / Holder Name (Column C)
    else if (
      !mapping.holderName &&
      (h.includes('fullname') ||
        h.includes('holdername') ||
        h.includes('drivername') ||
        h.includes('clientname') ||
        h.includes('customername') ||
        h.includes('applicantname') ||
        h.includes('licenseholder') ||
        h === 'name' ||
        h.endsWith('name'))
    ) {
      mapping.holderName = raw;
    }
    // 4. LICENSE NUMBER (Column D)
    else if (
      !mapping.licenseNumber &&
      (h.includes('licenseno') ||
        h.includes('licensenumber') ||
        h.includes('licnum') ||
        h.includes('license_no') ||
        h.includes('cardno') ||
        h.includes('dlno') ||
        h.includes('drivinglicense') ||
        h.includes('licno') ||
        h.includes('dlnumber') ||
        h.includes('licnumber') ||
        h.includes('smartcard') ||
        h === 'license' ||
        h === 'dl' ||
        h.startsWith('lic'))
    ) {
      mapping.licenseNumber = raw;
    }
    // 5. CATEGORY / Vehicle Class (Column E)
    else if (
      !mapping.category &&
      !mapping.vehicleClass &&
      (h.includes('category') ||
        h.includes('class') ||
        h.includes('licensetype') ||
        h.includes('vehicletype') ||
        h.includes('vehiclecategory') ||
        h.includes('licensecategory') ||
        h.includes('vehicleclass') ||
        h === 'type')
    ) {
      mapping.category = raw;
      mapping.vehicleClass = raw;
    }
    // 6. OLD CODE (Column F)
    else if (
      !mapping.oldCode &&
      (h.includes('oldcode') ||
        h.includes('oldcodeno') ||
        h.includes('oldcode_no') ||
        h.includes('old_code') ||
        h.includes('previouscode'))
    ) {
      mapping.oldCode = raw;
    }
    // 7. NEW CODE (Column G)
    else if (
      !mapping.newCode &&
      (h.includes('newcode') ||
        h.includes('newcodeno') ||
        h.includes('newcode_no') ||
        h.includes('new_code') ||
        h.includes('codeno') ||
        h.includes('code_no') ||
        h === 'code')
    ) {
      mapping.newCode = raw;
    }
    // 8. DEPARTMENT / Office (Column H)
    else if (
      !mapping.office &&
      (h.includes('department') ||
        h.includes('office') ||
        h.includes('branch') ||
        h.includes('station') ||
        h.includes('location') ||
        h.includes('district') ||
        h.includes('rto') ||
        h.includes('zone') ||
        h.includes('center') ||
        h.includes('centre') ||
        h.includes('yatayat'))
    ) {
      mapping.office = raw;
      mapping.department = raw;
    }
    // 9. RECEIVED BY / Receiver Name (Column I)
    else if (
      !mapping.receivedBy &&
      !mapping.receiverName &&
      (h.includes('receivedby') ||
        h.includes('received_by') ||
        h.includes('receivername') ||
        h.includes('receiver_name') ||
        h.includes('bujhiline') ||
        h.includes('bujhilineko') ||
        h.includes('handoverto') ||
        h.includes('handedoverto') ||
        h.includes('recipient') ||
        h.includes('received') ||
        h.includes('disrtibutedto') ||
        h.includes('distributedto') ||
        h.includes('disrtibuted_to') ||
        h.includes('distributed_to') ||
        h.includes('disrtibuted') ||
        h.includes('distributed'))
    ) {
      mapping.receivedBy = raw;
      mapping.receiverName = raw;
    }
    // 10. DISTRIBUTED DATE (Column J)
    else if (
      !mapping.distributedDate &&
      !mapping.distributedAt &&
      (h.includes('distributeddate') ||
        h.includes('distributiondate') ||
        h.includes('distributed_date') ||
        h.includes('distributedat') ||
        h.includes('distributed_at') ||
        h.includes('handoverdate') ||
        h.includes('delivereddate') ||
        h.includes('distribution') ||
        h.includes('distributedon'))
    ) {
      mapping.distributedDate = raw;
      mapping.distributedAt = raw;
    }
    // 11. DISTRIBUTED BY (Column K)
    else if (
      !mapping.distributedBy &&
      (h.includes('distributedby') ||
        h.includes('distributed_by') ||
        h.includes('handoverby') ||
        h.includes('handedoverby') ||
        h.includes('distributorofficer') ||
        h.includes('staffname'))
    ) {
      mapping.distributedBy = raw;
    }
    // 12. SUBMITTED DOC. (Column L)
    else if (
      !mapping.submittedDocument &&
      (h.includes('submitteddoc') ||
        h.includes('submitted_doc') ||
        h.includes('submitteddocument') ||
        h.includes('docsubmitted') ||
        h.includes('documentsubmitted') ||
        h.includes('citizenship') ||
        h.includes('nid') ||
        h.includes('doc'))
    ) {
      mapping.submittedDocument = raw;
    }
    // 13. STATUS (Column M)
    else if (
      !mapping.status &&
      (h.includes('status') ||
        h.includes('cardstatus') ||
        h.includes('availability') ||
        h.includes('deliverystatus') ||
        h.includes('handoverstatus'))
    ) {
      mapping.status = raw;
    }
    // Contact Phone matching
    else if (
      !mapping.phone &&
      (h.includes('phone') ||
        h.includes('mobile') ||
        h.includes('cell') ||
        h.includes('contact') ||
        h.includes('telephoneno') ||
        h.includes('phoneno') ||
        h.includes('mobileno') ||
        h.includes('contactno') ||
        h === 'tel')
    ) {
      mapping.phone = raw;
    }
    // Date of Birth matching
    else if (
      !mapping.dateOfBirth &&
      (h.includes('dob') ||
        h.includes('birthdate') ||
        h.includes('dateofbirth') ||
        h.includes('birth'))
    ) {
      mapping.dateOfBirth = raw;
    }
    // Address matching
    else if (
      !mapping.address &&
      (h.includes('address') ||
        h.includes('permanentaddress') ||
        h.includes('presentaddress') ||
        h.includes('city') ||
        h.includes('locationaddress') ||
        h.includes('permaddress'))
    ) {
      mapping.address = raw;
    }
  });

  // Positional fallback for 15-column and 13-column layouts (A: SN, B: APPLICANT ID, C: FULL NAME, D: LICENSE NO, E: CATEGORY, F: OLD CODE, G: NEW CODE, H: DEPARTMENT, I: RECEIVED BY, J: DISTRIBUTED DATE, K: DISTRIBUTED BY, L: SUBMITTED DOC, M: STATUS / DISTRIBUTED, N: MISSING, O: FOUND)
  if (headers.length >= 13) {
    if (!mapping.sn && headers[0]) mapping.sn = headers[0];
    if (!mapping.applicationNumber && headers[1]) mapping.applicationNumber = headers[1];
    if (!mapping.holderName && headers[2]) mapping.holderName = headers[2];
    if (!mapping.licenseNumber && headers[3]) mapping.licenseNumber = headers[3];
    if (!mapping.category && headers[4]) { mapping.category = headers[4]; mapping.vehicleClass = headers[4]; }
    if (!mapping.oldCode && headers[5]) mapping.oldCode = headers[5];
    if (!mapping.newCode && headers[6]) mapping.newCode = headers[6];
    if (!mapping.office && headers[7]) { mapping.office = headers[7]; mapping.department = headers[7]; }
    if (!mapping.receivedBy && headers[8]) { mapping.receivedBy = headers[8]; mapping.receiverName = headers[8]; }
    if (!mapping.distributedDate && headers[9]) { mapping.distributedDate = headers[9]; mapping.distributedAt = headers[9]; }
    if (!mapping.distributedBy && headers[10]) mapping.distributedBy = headers[10];
    if (!mapping.submittedDocument && headers[11]) mapping.submittedDocument = headers[11];
    if (!mapping.status && headers[12]) mapping.status = headers[12];
  }

  // Fallback: If holderName wasn't mapped yet, check for any header with 'applicant'
  if (!mapping.holderName) {
    const applicantHeader = headers.find((h) => h.toLowerCase().includes('applicant') && !h.toLowerCase().includes('id') && !h.toLowerCase().includes('no'));
    if (applicantHeader) mapping.holderName = applicantHeader;
  }

  return mapping;
}

/**
 * Universal Spreadsheet and CSV Parser
 * Reads .xlsx, .xls, and .csv files from disk safely without XLSX.readFile error
 */
export function parseUploadedSpreadsheet(filePath: string, originalName: string): ParsedSpreadsheetResult {
  if (!fs.existsSync(filePath)) {
    throw new Error('Uploaded file could not be found on server disk.');
  }

  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    throw new Error('The uploaded file is empty (0 bytes). Please upload a valid Excel or CSV file.');
  }

  const ext = path.extname(originalName || filePath).toLowerCase();
  const validExtensions = ['.xlsx', '.xls', '.csv', '.xlsm', '.xlsb', '.tsv', '.txt'];
  if (!validExtensions.includes(ext)) {
    throw new Error(`Unsupported file type (${ext || 'unknown'}). Please upload an Excel (.xlsx, .xls) or CSV/TSV file.`);
  }

  let headers: string[] = [];
  let rows: Record<string, any>[] = [];

  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    try {
      const csvContent = fs.readFileSync(filePath, 'utf-8');
      const csvParsed = parseCSVFast(csvContent);
      headers = csvParsed.headers;
      rows = csvParsed.rows;
    } catch (csvErr: any) {
      // Fallback to SheetJS reader if custom CSV parser encounters unexpected encoding
      try {
        const fileBuffer = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true, raw: false });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error('No worksheets found in CSV file.');
        const worksheet = workbook.Sheets[sheetName];
        const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
        const extracted = extractHeadersAndDataFromMatrix(matrix as any[][]);
        headers = extracted.headers;
        rows = extracted.rows;
      } catch (fallbackErr: any) {
        throw new Error(`Invalid or corrupted CSV file: ${csvErr.message || fallbackErr.message}`);
      }
    }
  } else {
    // Excel file (.xlsx, .xls, .xlsm, .xlsb)
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true, dense: false });

      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('The Excel workbook contains no readable sheets.');
      }

      // Check sheets:
      // Priority 1: Check for explicit Master / Total Smart Cards sheet (as found in official PLSMS multi-sheet template reports)
      const masterSheetName = workbook.SheetNames.find((s: string) => {
        const u = s.trim().toUpperCase();
        return (
          u === 'TOTAL SMART CARDS' ||
          u === 'TOTAL_SMART_CARDS' ||
          u === 'ALL RECORDS' ||
          u === 'MASTER' ||
          u === 'SMART CARDS' ||
          u === 'DRIVING LICENSES' ||
          u === 'ALL CARDS'
        );
      });

      if (masterSheetName) {
        const ws = workbook.Sheets[masterSheetName];
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as any[][];
        const extracted = extractHeadersAndDataFromMatrix(matrix);
        headers = extracted.headers;
        rows = extracted.rows;
      } else {
        // Priority 2: Check all sheets. If multiple sheets contain tabular license data, combine them
        let primaryHeaders: string[] = [];
        const combinedRows: Record<string, any>[] = [];

        for (const sName of workbook.SheetNames) {
          const ws = workbook.Sheets[sName];
          const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as any[][];
          const extracted = extractHeadersAndDataFromMatrix(matrix);
          if (extracted.rows.length > 0) {
            if (primaryHeaders.length === 0) {
              primaryHeaders = extracted.headers;
              combinedRows.push(...extracted.rows);
            } else {
              // Combine if contains core column markers
              const hasCoreColumns = extracted.headers.some((h) => {
                const hl = h.toLowerCase();
                return hl.includes('license') || hl.includes('applicant') || hl.includes('name') || hl.includes('dl');
              });
              if (hasCoreColumns) {
                combinedRows.push(...extracted.rows);
              }
            }
          }
        }

        if (primaryHeaders.length > 0 && combinedRows.length > 0) {
          headers = primaryHeaders;
          rows = combinedRows;
        } else {
          // Fallback to first sheet
          const ws = workbook.Sheets[workbook.SheetNames[0]];
          const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as any[][];
          const extracted = extractHeadersAndDataFromMatrix(matrix);
          headers = extracted.headers;
          rows = extracted.rows;
        }
      }
    } catch (excelErr: any) {
      throw new Error(`Corrupted or unreadable Excel workbook (${excelErr.message}). Ensure the file is not password-protected or damaged.`);
    }
  }

  if (headers.length === 0 || rows.length === 0) {
    throw new Error('The uploaded file contains no data rows or recognizable header columns.');
  }

  const suggestedMapping = detectColumnMapping(headers);

  return {
    headers,
    rows,
    totalRows: rows.length,
    suggestedMapping,
  };
}

