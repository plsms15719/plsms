import fs from 'fs';
import path from 'path';
import readline from 'readline';
import * as xlsxModule from 'xlsx';
import { ColumnMapping } from '../src/types';
import { evaluateAndMapSpreadsheet, ColumnMatchEvaluation } from './mappingEngine';

export type { ColumnMatchEvaluation };
export { evaluateAndMapSpreadsheet };

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
    matrix[r] = null as any; // Release 2D array row immediately to prevent holding dual dataset copies
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

  matrix.length = 0; // Release matrix array structure
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
  const firstNewline = text.indexOf('\n');
  const sample = firstNewline > 0 ? text.slice(0, Math.min(firstNewline, 2048)) : text.slice(0, 2048);
  
  let delimiter = ',';
  let delimiterCode = 44;
  const commaCount = (sample.match(/,/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  const semiCount = (sample.match(/;/g) || []).length;
  const pipeCount = (sample.match(/\|/g) || []).length;

  if (tabCount > commaCount && tabCount > semiCount) {
    delimiter = '\t';
    delimiterCode = 9;
  } else if (semiCount > commaCount && semiCount > tabCount) {
    delimiter = ';';
    delimiterCode = 59;
  } else if (pipeCount > commaCount && pipeCount > semiCount) {
    delimiter = '|';
    delimiterCode = 124;
  }

  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let hasQuotes = false;
  let cellStart = 0;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text.charCodeAt(i);
    if (inQuotes) {
      if (ch === 34 /* " */) {
        if (i + 1 < len && text.charCodeAt(i + 1) === 34) {
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      }
    } else {
      if (ch === 34 /* " */) {
        inQuotes = true;
        hasQuotes = true;
      } else if (ch === delimiterCode) {
        let cellStr = text.slice(cellStart, i).trim();
        if (hasQuotes && cellStr.charCodeAt(0) === 34 && cellStr.charCodeAt(cellStr.length - 1) === 34) {
          cellStr = cellStr.slice(1, -1).replace(/""/g, '"').trim();
        }
        row.push(cellStr);
        cellStart = i + 1;
        hasQuotes = false;
      } else if (ch === 10 /* \n */ || ch === 13 /* \r */) {
        let cellStr = text.slice(cellStart, i).trim();
        if (hasQuotes && cellStr.charCodeAt(0) === 34 && cellStr.charCodeAt(cellStr.length - 1) === 34) {
          cellStr = cellStr.slice(1, -1).replace(/""/g, '"').trim();
        }
        row.push(cellStr);
        if (ch === 13 && i + 1 < len && text.charCodeAt(i + 1) === 10) {
          i++;
        }
        cellStart = i + 1;
        hasQuotes = false;
        if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
          lines.push(row);
        }
        row = [];
      }
    }
  }

  // Push final remaining cell/row
  if (cellStart < len || row.length > 0) {
    let cellStr = text.slice(cellStart).trim();
    if (hasQuotes && cellStr.charCodeAt(0) === 34 && cellStr.charCodeAt(cellStr.length - 1) === 34) {
      cellStr = cellStr.slice(1, -1).replace(/""/g, '"').trim();
    }
    row.push(cellStr);
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      lines.push(row);
    }
  }

  return extractHeadersAndDataFromMatrix(lines);
}

/**
 * 95% Strong Column Mapping Engine with Right Data in Right Place validation
 */
export function detectColumnMapping(headers: string[], sampleRows: Record<string, any>[] = []): Partial<ColumnMapping> {
  const evaluation = evaluateAndMapSpreadsheet(headers, sampleRows);
  return evaluation.suggestedMapping;
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

  const suggestedMapping = detectColumnMapping(headers, rows);

  return {
    headers,
    rows,
    totalRows: rows.length,
    suggestedMapping,
  };
}

/**
 * Parses a single CSV line into an array of string values taking quotes into account
 */
export function parseCsvLineTokens(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  const len = line.length;
  for (let i = 0; i < len; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  result.push(cur.trim());
  return result;
}

export interface StreamBatchSummary {
  headers: string[];
  totalRows: number;
  totalBatches: number;
  suggestedMapping: Partial<ColumnMapping>;
}

/**
 * True bounded-memory streaming CSV parser.
 * Reads a CSV file line-by-line using readline and streams rows in batches
 * directly to the consumer callback. Never accumulates all rows in memory.
 */
export async function streamCsvFileInBatches(
  filePath: string,
  options: {
    batchSize?: number;
    startFromRow?: number; // 0-indexed data row offset to skip already processed rows
    onBatch: (
      batchRows: Record<string, any>[],
      batchIndex: number,
      startRowIndex: number,
      endRowIndex: number,
      sheetRowStart: number
    ) => Promise<void>;
    onHeadersDetected?: (headers: string[], mapping: Partial<ColumnMapping>) => void;
  }
): Promise<StreamBatchSummary> {
  const batchSize = Math.max(100, options.batchSize || 1000);
  const startFromRow = Math.max(0, options.startFromRow || 0);

  // Pass 1: Quick pre-scan of the first 40 lines to determine delimiter, headers, and header row index
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rlPre = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const preLines: string[] = [];
  for await (const line of rlPre) {
    if (line.trim().length > 0) {
      preLines.push(line);
      if (preLines.length >= 40) break;
    }
  }
  rlPre.close();
  fileStream.destroy();

  if (preLines.length === 0) {
    throw new Error('CSV file is empty or contains no readable lines.');
  }

  // Detect delimiter
  const sample = preLines.slice(0, 5).join('\n');
  let delimiter = ',';
  const commaCount = (sample.match(/,/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  const semiCount = (sample.match(/;/g) || []).length;
  const pipeCount = (sample.match(/\|/g) || []).length;

  if (tabCount > commaCount && tabCount > semiCount) {
    delimiter = '\t';
  } else if (semiCount > commaCount && semiCount > tabCount) {
    delimiter = ';';
  } else if (pipeCount > commaCount && pipeCount > semiCount) {
    delimiter = '|';
  }

  // Parse sample matrix to find real header row
  const sampleMatrix: string[][] = preLines.map((l) => parseCsvLineTokens(l, delimiter));
  let bestHeaderRowIndex = 0;
  let bestScore = 0;

  for (let r = 0; r < Math.min(25, sampleMatrix.length); r++) {
    const candidateRow = sampleMatrix[r];
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

  const rawHeaderRow = sampleMatrix[bestHeaderRowIndex] || [];
  const headers: string[] = [];
  for (let idx = 0; idx < rawHeaderRow.length; idx++) {
    const val = rawHeaderRow[idx] !== undefined ? String(rawHeaderRow[idx]).trim() : '';
    headers.push(val || `Column_${idx + 1}`);
  }
  while (headers.length > 0 && headers[headers.length - 1].startsWith('Column_')) {
    headers.pop();
  }
  if (headers.length === 0) headers.push('Column_1');

  // Check subheaders
  let dataStartLineIndex = bestHeaderRowIndex + 1;
  if (dataStartLineIndex < sampleMatrix.length) {
    const nextRow = sampleMatrix[dataStartLineIndex];
    if (Array.isArray(nextRow)) {
      const hasStatusSubheaders = nextRow.some((c) => {
        const s = String(c || '').trim().toUpperCase();
        return s === 'DISTRIBUTED' || s === 'MISSING' || s === 'FOUND';
      });
      const hasRealData = nextRow.some((c) => {
        const s = String(c || '').trim();
        return /^\d{2}-\d{2}-\d{8}$/.test(s) || /^\d{8,}$/.test(s);
      });
      if (hasStatusSubheaders && !hasRealData) {
        for (let c = 0; c < nextRow.length; c++) {
          const subVal = String(nextRow[c] || '').trim();
          if (subVal && c < headers.length) {
            if (headers[c].startsWith('Column_') || headers[c] === '' || headers[c] === 'STATUS') {
              headers[c] = subVal;
            }
          }
        }
        dataStartLineIndex++;
      }
    }
  }

  // Pre-evaluate column mapping from sample data
  const sampleDataRows: Record<string, any>[] = [];
  for (let r = dataStartLineIndex; r < Math.min(dataStartLineIndex + 10, sampleMatrix.length); r++) {
    const tokens = sampleMatrix[r];
    const rowObj: Record<string, any> = {};
    for (let c = 0; c < headers.length; c++) {
      rowObj[headers[c]] = tokens[c] !== undefined ? tokens[c] : '';
    }
    sampleDataRows.push(rowObj);
  }
  const suggestedMapping = detectColumnMapping(headers, sampleDataRows);
  if (options.onHeadersDetected) {
    options.onHeadersDetected(headers, suggestedMapping);
  }

  // Pass 2: Line-by-line streaming without buffering into memory
  const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

  let lineCounter = 0;
  let dataRowCounter = 0;
  let batchIndex = 0;
  let currentBatch: Record<string, any>[] = [];
  let batchStartRow = 0;
  let batchStartSheetRow = 0;

  // Handle multi-line quotes
  let pendingLine = '';
  let inMultiLineQuote = false;

  for await (const rawLine of rl) {
    lineCounter++;

    let fullLine = rawLine;
    if (inMultiLineQuote) {
      fullLine = pendingLine + '\n' + rawLine;
    }

    // Count unescaped quotes to verify if line is complete
    let quoteCount = 0;
    for (let i = 0; i < fullLine.length; i++) {
      if (fullLine[i] === '"') {
        if (i + 1 < fullLine.length && fullLine[i + 1] === '"') {
          i++; // escaped quote
        } else {
          quoteCount++;
        }
      }
    }

    if (quoteCount % 2 !== 0) {
      pendingLine = fullLine;
      inMultiLineQuote = true;
      continue;
    }

    pendingLine = '';
    inMultiLineQuote = false;

    // Skip preamble and header rows
    if (lineCounter <= dataStartLineIndex) {
      continue;
    }

    const trimmed = fullLine.trim();
    if (!trimmed) continue;

    dataRowCounter++;
    const currentDataRowIndex = dataRowCounter - 1; // 0-indexed
    const physicalSheetRow = lineCounter; // Actual row number in sheet (header + data)

    // Skip rows before startFromRow (fast resume without memory allocation)
    if (currentDataRowIndex < startFromRow) {
      continue;
    }

    const tokens = parseCsvLineTokens(fullLine, delimiter);
    const rowObj: Record<string, any> = { __sheetRow: physicalSheetRow };
    for (let c = 0; c < headers.length; c++) {
      rowObj[headers[c]] = tokens[c] !== undefined ? tokens[c] : '';
    }

    if (currentBatch.length === 0) {
      batchStartRow = currentDataRowIndex;
      batchStartSheetRow = physicalSheetRow;
    }

    currentBatch.push(rowObj);

    if (currentBatch.length >= batchSize) {
      const endRow = currentDataRowIndex + 1;
      await options.onBatch(currentBatch, batchIndex, batchStartRow, endRow, batchStartSheetRow);
      currentBatch = []; // Free V8 memory immediately
      batchIndex++;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // Dispatch final batch
  if (currentBatch.length > 0) {
    const endRow = dataRowCounter;
    await options.onBatch(currentBatch, batchIndex, batchStartRow, endRow, batchStartSheetRow);
    currentBatch = [];
    batchIndex++;
  }

  return {
    headers,
    totalRows: dataRowCounter,
    totalBatches: batchIndex,
    suggestedMapping,
  };
}

