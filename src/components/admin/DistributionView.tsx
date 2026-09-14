import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileCheck2,
  Search,
  Printer,
  Calendar,
  RefreshCw,
  Download,
  Filter,
  CheckCircle2,
  FileSpreadsheet,
  Layers,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { LicenseRecord, DistributionRecord } from '../../types';
import { api } from '../../services/api';
import {
  getNepaliDate,
  getNepaliWeekRange,
  getNepaliMonthRange,
  normalizeNepaliBSDate,
  isValidNepaliBSDate,
} from '../../utils/dateUtils';
import { NepaliDatePicker } from '../common/NepaliDatePicker';
import { generatePrintHeaderHtml, resolveBranchFromRecords, OFFICE_CONFIG } from '../../utils/officeConfig';
import { resolveRecordStaff, resolveSubmittedDocument } from '../../utils/staffUtils';
import { HistoryInput } from '../common/HistoryInput';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../utils/permissions';
import { ConfirmFoundModal } from '../modals/ConfirmFoundModal';

interface Props {
  onPrintSlip?: (dist: DistributionRecord) => void;
}

export const DistributionView: React.FC<Props> = () => {
  const { user } = useAuth();
  const canPrintRegister = hasPermission(user, 'distribution.print_register');
  const canExportCsv = hasPermission(user, 'distribution.export_csv');
  const canUnmarkMissing = hasPermission(user, 'records.unmark_missing');

  // Selected record for confirming as FOUND
  const [selectedRecordForFound, setSelectedRecordForFound] = useState<LicenseRecord | null>(null);

  // Live current Nepali date helper (ensures accurate date in Nepal Standard Time)
  const getLiveTodayNepaliDate = useCallback(() => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const nepalTime = new Date(utc + 3600000 * 5.75);
    const nepStr = getNepaliDate(nepalTime);
    return nepStr && nepStr !== '<N/A>' ? nepStr : getNepaliDate(now);
  }, []);

  // Date filtering state: defaults to live current date and 'today' preset highlight
  const [fromDateBS, setFromDateBS] = useState<string>(() => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const nepalTime = new Date(utc + 3600000 * 5.75);
    const nepStr = getNepaliDate(nepalTime);
    return nepStr && nepStr !== '<N/A>' ? nepStr : getNepaliDate(now);
  });
  const [toDateBS, setToDateBS] = useState<string>(() => {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const nepalTime = new Date(utc + 3600000 * 5.75);
    const nepStr = getNepaliDate(nepalTime);
    return nepStr && nepStr !== '<N/A>' ? nepStr : getNepaliDate(now);
  });
  const [activePreset, setActivePreset] = useState<'today' | 'week' | 'month' | 'all' | 'custom'>('today');

  // Search & Pagination state
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Data & loading state
  const [records, setRecords] = useState<LicenseRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  /**
   * Smartly normalizes any date into YYYY-MM-DD Bikram Sambat string
   */
  const resolveRecordBSDate = useCallback((record: LicenseRecord): string => {
    const rawDate =
      record.distributedDate ||
      record.distributedAt ||
      (record.rawRecord &&
        (record.rawRecord['DISTRIBUTED DATE'] ||
          record.rawRecord['वितरण मिति'] ||
          record.rawRecord['DISTRIBUTED_DATE']));

    if (!rawDate || rawDate === '---' || rawDate === '<N/A>') {
      return '<N/A>';
    }
    const normalized = normalizeNepaliBSDate(rawDate);
    return normalized || getNepaliDate(rawDate);
  }, []);

  /**
   * Fetches distributed records from the server
   */
  const fetchDistributedRecords = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg('');

      // When pageSize is 0 or very large, fetch maximum
      const fetchLimit = pageSize === 0 ? 5000 : pageSize;

      const res = await api.getRecords({
        status: 'DISTRIBUTED',
        q: searchTerm.trim() || undefined,
        fromDateBS: fromDateBS.trim() || undefined,
        toDateBS: toDateBS.trim() || undefined,
        page,
        limit: fetchLimit,
        sortBy: 'distributedDate',
        sortOrder: 'desc',
      });

      setRecords(res.records || []);
      setTotalRecords(res.total || 0);
    } catch (err: any) {
      console.error('Failed to fetch distributed records:', err);
      setErrorMsg(err.message || 'वितरण विवरण लोड गर्न सकिएन (Failed to load distribution records)');
    } finally {
      setLoading(false);
    }
  }, [searchTerm, fromDateBS, toDateBS, page, pageSize]);

  // Refetch when filters or pagination change
  useEffect(() => {
    fetchDistributedRecords();
  }, [fetchDistributedRecords]);

  // Listen to system-wide record updates (e.g. when a missing record is marked FOUND)
  useEffect(() => {
    const handleRecordUpdated = (e: any) => {
      const detail = e?.detail;
      if (detail?.record) {
        setRecords((prev) =>
          prev.map((r) =>
            r.id === detail.record.id
              ? {
                  ...r,
                  ...detail.record,
                  status: detail.record.status,
                  issueFlag: detail.record.issueFlag,
                  foundReason: detail.record.foundReason,
                  missingReason: detail.record.missingReason,
                }
              : r
          )
        );
      }
    };
    window.addEventListener('plsms:record-updated', handleRecordUpdated);
    return () => {
      window.removeEventListener('plsms:record-updated', handleRecordUpdated);
    };
  }, []);

  // Presets Handlers
  const handlePresetToday = () => {
    const todayBS = getLiveTodayNepaliDate();
    setFromDateBS(todayBS);
    setToDateBS(todayBS);
    setActivePreset('today');
    setPage(1);
  };

  const handlePresetThisWeek = () => {
    const week = getNepaliWeekRange(new Date());
    setFromDateBS(week.fromDateBS);
    setToDateBS(week.toDateBS);
    setActivePreset('week');
    setPage(1);
  };

  const handlePresetMonthly = () => {
    const month = getNepaliMonthRange(new Date());
    setFromDateBS(month.fromDateBS);
    setToDateBS(month.toDateBS);
    setActivePreset('month');
    setPage(1);
  };

  const handlePresetAllTime = () => {
    setFromDateBS('');
    setToDateBS('');
    setActivePreset('all');
    setPage(1);
  };

  const handleFromDateChange = (val: string) => {
    setFromDateBS(val);
    setActivePreset('custom');
    setPage(1);
  };

  const handleToDateChange = (val: string) => {
    setToDateBS(val);
    setActivePreset('custom');
    setPage(1);
  };

  // Print Daily Distribution Register
  const handlePrintDailyRegister = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const dateRangeLabel =
      fromDateBS && toDateBS
        ? fromDateBS === toDateBS
          ? `मिति: ${fromDateBS} (BS)`
          : `मिति: ${fromDateBS} देखि ${toDateBS} सम्म (BS)`
        : fromDateBS
        ? `मिति: ${fromDateBS} देखि यता (BS)`
        : toDateBS
        ? `मिति: ${toDateBS} सम्म (BS)`
        : 'सबै मितिका वितरित कार्डहरू (All Time)';

    const rowsHtml = records
      .map((r, i) => {
        const sn = (page - 1) * pageSize + (i + 1);
        const appId = r.applicantId || r.applicationNumber || '---';
        const name = r.holderName || '---';
        const lic = r.licenseNumber || '---';
        const cat = r.category || r.vehicleClass || 'A';
        const dateBS = resolveRecordBSDate(r);
        const doc = resolveSubmittedDocument(r);
        const staff = resolveRecordStaff(r);
        const distTo = r.receivedBy || r.receiverName || r.holderName || '<N/A>';
        const isMissing = r.status === 'MISSING' || r.issueFlag === 'MISSING';
        const isFound = r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.foundDate);
        const statusText = isMissing ? 'DISTRIBUTED / MISSING' : isFound ? 'DISTRIBUTED / FOUND' : 'DISTRIBUTED';
        const statusColor = isMissing ? '#dc2626' : isFound ? '#9333ea' : '#047857';
        return `
          <tr>
            <td style="text-align:center; padding: 6px 8px; border: 1px solid #94a3b8;">${sn}</td>
            <td style="padding: 6px 8px; border: 1px solid #94a3b8;">${appId}</td>
            <td style="padding: 6px 8px; border: 1px solid #94a3b8; font-weight: 500; text-transform: uppercase;">${name}</td>
            <td style="padding: 6px 8px; border: 1px solid #94a3b8; color: #1e3a8a;">${lic}</td>
            <td style="text-align:center; padding: 6px 8px; border: 1px solid #94a3b8;">${cat}</td>
            <td style="text-align:center; padding: 6px 8px; border: 1px solid #94a3b8;">${doc}</td>
            <td style="text-align:center; padding: 6px 8px; border: 1px solid #94a3b8; text-transform: uppercase;">${staff}</td>
            <td style="text-align:center; padding: 6px 8px; border: 1px solid #94a3b8; text-transform: uppercase;">${distTo}</td>
            <td style="text-align:center; padding: 6px 8px; border: 1px solid #94a3b8;">${dateBS}</td>
            <td style="text-align:center; padding: 6px 8px; border: 1px solid #94a3b8; color: ${statusColor}; font-weight: bold;">${statusText}</td>
          </tr>
        `;
      })
      .join('');

    const branchName = resolveBranchFromRecords(records);
    const officialHeaderHtml = generatePrintHeaderHtml({
      reportTitleNp: 'दैनिक स्मार्ट कार्ड वितरण अभिलेख दर्ता किताब',
      reportTitleEn: 'DISTRIBUTION REGISTER',
      dateRangeLabel,
      totalCount: totalRecords,
      branchName,
    });

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>स्मार्ट कार्ड वितरण अभिलेख किताब (Distribution Register) - ${OFFICE_CONFIG.locationNp}</title>
          <style>
            @page { size: A4 landscape; margin: 10mm; }
            body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 10px; color: #0f172a; font-size: 11px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
            th { background-color: #f1f5f9; padding: 7px 6px; border: 1px solid #64748b; font-size: 10.5px; text-transform: uppercase; font-weight: 700; color: #0f172a; }
            td { font-size: 11px; }
            .footer { margin-top: 24px; display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; padding: 0 10px; }
          </style>
        </head>
        <body>
          ${officialHeaderHtml}
          <table>
            <thead>
              <tr>
                <th style="width: 40px;">क्र.सं. (S.N.)</th>
                <th>आवेदन नम्बर (APPLICANT ID)</th>
                <th>पुरा नाम (FULL NAME)</th>
                <th>लाइसेन्स नम्बर (LICENSE NUMBER)</th>
                <th>वर्ग (CAT)</th>
                <th>पेश कागजात (SUBMITTED DOC)</th>
                <th>वितरण गर्ने कर्मचारी (DISTRIBUTED BY)</th>
                <th>बुझिलिनेको नाम (DISTRIBUTED TO)</th>
                <th>वितरण मिति (DIST. DATE BS)</th>
                <th>स्थिति (STATUS)</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="footer">
            <div>तयार गर्ने कर्मचारी: .......................................</div>
            <div>प्रमाणित गर्ने अधिकृत: .......................................</div>
            <div>कार्यालय छाप: .......................................</div>
          </div>
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (records.length === 0) return;
    const headers = [
      'S.N.',
      'Applicant ID',
      'Full Name',
      'License Number',
      'Category',
      'Submitted Document',
      'Distributed By',
      'Distributed To',
      'Distribution Date BS',
      'Status',
    ];

    const csvRows = records.map((r, i) => {
      const sn = (page - 1) * pageSize + (i + 1);
      const appId = `"${(r.applicantId || r.applicationNumber || '').replace(/"/g, '""')}"`;
      const name = `"${(r.holderName || '').replace(/"/g, '""')}"`;
      const lic = `"${(r.licenseNumber || '').replace(/"/g, '""')}"`;
      const cat = `"${(r.category || r.vehicleClass || 'A').replace(/"/g, '""')}"`;
      const dateBS = `"${resolveRecordBSDate(r)}"`;
      const doc = `"${resolveSubmittedDocument(r).replace(/"/g, '""')}"`;
      const staff = `"${resolveRecordStaff(r).replace(/"/g, '""')}"`;
      const distTo = `"${(r.receivedBy || r.receiverName || r.holderName || '<N/A>').replace(/"/g, '""')}"`;
      const isMissing = r.status === 'MISSING' || r.issueFlag === 'MISSING';
      const isFound = r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.foundDate);
      const statusVal = isMissing ? 'DISTRIBUTED / MISSING' : isFound ? 'DISTRIBUTED / FOUND' : 'DISTRIBUTED';
      return [sn, appId, name, lic, cat, doc, staff, distTo, dateBS, statusVal].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...csvRows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `smart_card_distributions_${fromDateBS || 'all'}_to_${toDateBS || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Pagination calculations
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalRecords / pageSize);
  const startItem = totalRecords === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = pageSize === 0 ? totalRecords : Math.min(page * pageSize, totalRecords);

  return (
    <div className="space-y-4">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-[#071120] border border-slate-200 dark:border-[#162744] rounded-2xl p-4 sm:p-5 shadow-xs transition-colors">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-600/40 flex items-center justify-center text-emerald-700 dark:text-emerald-400">
                <FileCheck2 className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                DISTRIBUTION REGISTER (वितरित कार्ड स्थायी अभिलेख)
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              नेपाली मिति (वि.सं.) अनुसार स्थायी रुपमा वितरण गरिएका स्मार्ट कार्डहरूको दर्ता किताब तथा दैनिक अभिलेख सूची
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Ledger count badges */}
            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-[#06241a] border border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse"></span>
              <span>कुल वितरित (Total Distributed): <strong>{totalRecords.toLocaleString()}</strong></span>
            </div>

            {/* Print Register Button */}
            {canPrintRegister && (
              <button
                type="button"
                onClick={handlePrintDailyRegister}
                disabled={records.length === 0}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-[#12233f] dark:hover:bg-[#1a3159] dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-95 disabled:opacity-50"
                title="दैनिक वितरण किताब प्रिन्ट गर्नुहोस् (Print Daily Distribution Register)"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Register</span>
              </button>
            )}

            {/* Export CSV */}
            {canExportCsv && (
              <button
                type="button"
                onClick={handleExportCSV}
                disabled={records.length === 0}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-[#12233f] dark:hover:bg-[#1a3159] dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-95 disabled:opacity-50"
                title="डाटा एक्सेल / CSV डाउनलोड गर्नुहोस्"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            )}

            {/* Refresh */}
            <button
              type="button"
              onClick={fetchDistributedRecords}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-[#12233f] dark:hover:bg-[#1a3159] dark:text-slate-200 border border-slate-300 dark:border-slate-700 transition-all cursor-pointer shadow-2xs active:scale-95"
              title="पुनः ताजा गर्नुहोस् (Refresh)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Table Container with TOP BORDER DATE PICKER TOOLBAR */}
      <div className="bg-white dark:bg-[#030914] rounded-2xl border-2 border-[#b8d2eb] dark:border-[#1e2d4a] shadow-md dark:shadow-xl overflow-hidden">
        {/* =================================================================== */}
        {/* TOP BORDER DATE PICKER & FILTER TOOLBAR                            */}
        {/* =================================================================== */}
        <div className="bg-[#f0f6fc] dark:bg-[#071326] border-b-2 border-[#b8d2eb] dark:border-[#1e2d4a] p-3 sm:p-4 space-y-3">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            {/* Left: Nepali Date Range Selector ('From' <NepaliDatePicker> TO <NepaliDatePicker>, Presets) */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1 text-[12px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>नेपाली मिति (DATE FILTER):</span>
              </div>

              {/* FROM DATE */}
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">From</span>
                <div className="w-36">
                  <NepaliDatePicker
                    value={fromDateBS}
                    onChange={handleFromDateChange}
                    placeholder={getLiveTodayNepaliDate() || '2083-05-20'}
                    id="dist-from-date-bs"
                    inputClassName="py-1 px-2.5 text-xs font-normal bg-white dark:bg-[#0b1b36] border-slate-300 dark:border-slate-700 rounded-lg shadow-2xs"
                  />
                </div>
              </div>

              {/* TO DATE */}
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">TO</span>
                <div className="w-36">
                  <NepaliDatePicker
                    value={toDateBS}
                    onChange={handleToDateChange}
                    placeholder={getLiveTodayNepaliDate() || '2083-05-20'}
                    id="dist-to-date-bs"
                    inputClassName="py-1 px-2.5 text-xs font-normal bg-white dark:bg-[#0b1b36] border-slate-300 dark:border-slate-700 rounded-lg shadow-2xs"
                  />
                </div>
              </div>

              {/* Quick Range Presets: Today, This Week, Monthly, All Time */}
              <div className="flex flex-wrap items-center gap-1 ml-1">
                <button
                  type="button"
                  onClick={handlePresetToday}
                  className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-all cursor-pointer active:scale-95 shadow-2xs border ${
                    activePreset === 'today'
                      ? 'bg-blue-600 border-blue-600 text-white dark:bg-blue-600 dark:border-blue-500'
                      : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-300 dark:bg-[#0c1e38] dark:hover:bg-[#142f56] dark:text-slate-200 dark:border-slate-700'
                  }`}
                  title="आज वितरण गरिएका कार्डहरू (Today)"
                >
                  Today (आज)
                </button>

                <button
                  type="button"
                  onClick={handlePresetThisWeek}
                  className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-all cursor-pointer active:scale-95 shadow-2xs border ${
                    activePreset === 'week'
                      ? 'bg-blue-600 border-blue-600 text-white dark:bg-blue-600 dark:border-blue-500'
                      : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-300 dark:bg-[#0c1e38] dark:hover:bg-[#142f56] dark:text-slate-200 dark:border-slate-700'
                  }`}
                  title="यस हप्ता वितरण गरिएका कार्डहरू (This Week)"
                >
                  This Week (यो हप्ता)
                </button>

                <button
                  type="button"
                  onClick={handlePresetMonthly}
                  className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-all cursor-pointer active:scale-95 shadow-2xs border ${
                    activePreset === 'month'
                      ? 'bg-blue-600 border-blue-600 text-white dark:bg-blue-600 dark:border-blue-500'
                      : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-300 dark:bg-[#0c1e38] dark:hover:bg-[#142f56] dark:text-slate-200 dark:border-slate-700'
                  }`}
                  title="यस महिना वितरण गरिएका कार्डहरू (Monthly)"
                >
                  Monthly (महिना)
                </button>

                <button
                  type="button"
                  onClick={handlePresetAllTime}
                  className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-all cursor-pointer active:scale-95 shadow-2xs border ${
                    activePreset === 'all'
                      ? 'bg-blue-600 border-blue-600 text-white dark:bg-blue-600 dark:border-blue-500'
                      : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-300 dark:bg-[#0c1e38] dark:hover:bg-[#142f56] dark:text-slate-200 dark:border-slate-700'
                  }`}
                  title="सबै स्थायी वितरण रेकर्डहरू (All Time)"
                >
                  All Time (सबै)
                </button>
              </div>
            </div>

            {/* Right: Quick Search Box with History */}
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-2.5 z-10" />
                <HistoryInput
                  historyKey="distribution_search"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  placeholder="खोज्नुहोस्: नाम, लाइसेन्स वा आवेदन नं..."
                  className="w-full pl-9 pr-8 py-1.5 bg-white dark:bg-[#0b1b36] border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-normal text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                />
              </div>
            </div>
          </div>

          {/* Active Filter Notification Pill */}
          {(fromDateBS || toDateBS || searchTerm) && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200/80 dark:border-[#13243f] text-[11px] text-slate-600 dark:text-slate-400">
              <span className="font-semibold text-slate-800 dark:text-slate-200">सक्रिय फिल्टर (Active Filter):</span>
              {fromDateBS && toDateBS ? (
                <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/80 border border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300">
                  {fromDateBS === toDateBS ? `मिति: ${fromDateBS}` : `मिति: ${fromDateBS} देखि ${toDateBS}`}
                </span>
              ) : fromDateBS ? (
                <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/80 border border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300">
                  सुरु मिति: {fromDateBS}
                </span>
              ) : toDateBS ? (
                <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/80 border border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300">
                  अन्तिम मिति: {toDateBS}
                </span>
              ) : null}

              {searchTerm && (
                <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300">
                  खोजी: "{searchTerm}"
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  setFromDateBS('');
                  setToDateBS('');
                  setSearchTerm('');
                  setActivePreset('all');
                  setPage(1);
                }}
                className="text-blue-600 dark:text-blue-400 hover:underline font-semibold ml-2 cursor-pointer"
              >
                फिल्टर हटाउनुहोस् (Clear All)
              </button>
            </div>
          )}
        </div>

        {/* =================================================================== */}
        {/* DATA TABLE (PICTURE 2 EXACT REPLICA)                                */}
        {/* =================================================================== */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] border-collapse">
            <thead>
              <tr className="bg-[#deecf9] dark:bg-[#08101E] border-b-2 border-[#b8d2eb] dark:border-[#1e2d4a]">
                {/* 1. S.N. */}
                <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 w-12 whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    S.N.
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (क्र.सं.)
                  </div>
                </th>

                {/* 2. APPLICANT ID */}
                <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    APPLICANT ID
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (आवेदन नम्बर)
                  </div>
                </th>

                {/* 3. FULL NAME */}
                <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    FULL NAME
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (पुरा नाम)
                  </div>
                </th>

                {/* 4. LICENSE NUMBER */}
                <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    LICENSE NUMBER
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (लाइसेन्स नम्बर)
                  </div>
                </th>

                {/* 5. CATEGORY */}
                <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 w-20 whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    CATEGORY
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (वर्ग)
                  </div>
                </th>

                {/* 6. SUBMITTED DOC. */}
                <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    SUBMITTED DOC.
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (पेश गरिएको कागजात)
                  </div>
                </th>

                {/* 7. DISTRIBUTED BY */}
                <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    DISTRIBUTED BY
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (वितरण गर्ने कर्मचारी)
                  </div>
                </th>

                {/* 8. DISTRIBUTED TO */}
                <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    DISTRIBUTED TO
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (बुझिलिनेको नाम)
                  </div>
                </th>

                {/* 9. DISTRIBUTION DATE */}
                <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    DISTRIBUTION DATE
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (वितरण मिति BS)
                  </div>
                </th>

                {/* 10. STATUS / ACTIONS (Exact match to Picture 3) */}
                <th className="py-2.5 px-3 text-center whitespace-nowrap">
                  <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                    STATUS / ACTIONS
                  </div>
                  <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                    (स्थिति / कार्य)
                  </div>
                </th>
              </tr>
            </thead>

            {/* Table Body with alternating clean neutral rows */}
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e2d4a]/70">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center bg-white dark:bg-[#030914]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" />
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        वितरण विवरण लोड हुँदैछ (Loading Distribution Register)...
                      </span>
                    </div>
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-[#030914]">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/60 flex items-center justify-center mx-auto mb-2 text-slate-400">
                      <FileCheck2 className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {fromDateBS || toDateBS
                        ? `छनोट गरिएको मितिमा कुनै कार्ड वितरण भएको भेटिएन (${fromDateBS || 'सबै'} देखि ${toDateBS || 'सबै'})`
                        : 'कुनै वितरण विवरण फेला परेन (No distributed records found)'}
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-md mx-auto">
                      {searchTerm
                        ? `"${searchTerm}" सँग मेल खाने कुनै पनि रेकर्ड भेटिएन।`
                        : 'माथि रहेको "All Time (सबै)" बटनमा क्लिक गरेर सबै ४,०१३ भन्दा बढी स्थायी वितरण रेकर्डहरू हेर्न सक्नुहुन्छ।'}
                    </p>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={handlePresetAllTime}
                        className="px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 text-xs font-semibold hover:bg-blue-100 transition-all cursor-pointer"
                      >
                        सबै रेकर्डहरू देखाउनुहोस् (Show All Distributed)
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                records.map((record, index) => {
                  const serialNumber = (page - 1) * pageSize + (index + 1);
                  const applicantIdValue = record.applicantId || record.applicationNumber || '---';
                  const holderNameValue = record.holderName || '---';
                  const licenseNumberValue = record.licenseNumber || '---';
                  const categoryValue = record.category || record.vehicleClass || 'A';

                  // Distribution date
                  const distributedDateValue = resolveRecordBSDate(record);

                  // Submitted document resolution
                  const submittedDocValue = resolveSubmittedDocument(record);

                  // Distributed to / receiver resolution matching DashboardView
                  let rawDistributedTo =
                    record.receivedBy ||
                    record.receiverName ||
                    record.rawRecord?.['DISTRIBUTED TO'] ||
                    record.rawRecord?.['RECEIVED BY'] ||
                    record.rawRecord?.['DISTRIBUTED_TO'] ||
                    record.rawRecord?.['RECEIVED_BY'] ||
                    record.rawRecord?.['Receiver Name'] ||
                    record.rawRecord?.['Received By'] ||
                    record.rawRecord?.['बुझिलिनेको नाम'] ||
                    record.holderName;

                  if ((!rawDistributedTo || rawDistributedTo === '---' || rawDistributedTo === '<N/A>') && record.foundReason?.includes('Received by:')) {
                    const match = record.foundReason.match(/Received by:\s*([^.]+)/i);
                    if (match && match[1]?.trim()) rawDistributedTo = match[1].trim();
                  }

                  const distributedToValue =
                    rawDistributedTo && rawDistributedTo.trim() && rawDistributedTo !== '---' && rawDistributedTo !== '<N/A>'
                      ? rawDistributedTo.trim()
                      : '<N/A>';

                  // Distributed by staff resolution
                  const distributedByValue = resolveRecordStaff(record);

                  // Alternating clean row background
                  const isOddRow = index % 2 === 1;
                  const rowBgClass = isOddRow
                    ? 'bg-slate-50/75 dark:bg-[#08101e]/60'
                    : 'bg-white dark:bg-[#030914]';

                  return (
                    <tr
                      key={record.id || index}
                      className={`${rowBgClass} hover:bg-blue-50/60 dark:hover:bg-blue-950/30 transition-colors group border-b border-slate-200 dark:border-[#1e2d4a]/70`}
                    >
                      {/* 1. S.N. */}
                      <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-700 dark:text-slate-300 text-[13px] font-normal whitespace-nowrap">
                        {serialNumber}
                      </td>

                      {/* 2. APPLICANT ID */}
                      <td className="py-2 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-900 dark:text-slate-100 text-[13px] font-normal whitespace-nowrap">
                        {applicantIdValue}
                      </td>

                      {/* 3. FULL NAME */}
                      <td className="py-2 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-900 dark:text-white text-[13px] font-normal uppercase tracking-normal whitespace-nowrap">
                        {holderNameValue}
                      </td>

                      {/* 4. LICENSE NUMBER */}
                      <td className="py-2 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 text-blue-900 dark:text-blue-300 text-[13px] font-normal whitespace-nowrap">
                        {licenseNumberValue}
                      </td>

                      {/* 5. CATEGORY (Badge Pill) */}
                      <td className="py-2 px-2.5 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        <span className="px-2.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-[13px] font-normal inline-block shadow-2xs">
                          {categoryValue}
                        </span>
                      </td>

                      {/* 6. SUBMITTED DOC. */}
                      <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-700 dark:text-slate-300 text-[13px] font-normal whitespace-nowrap">
                        {submittedDocValue}
                      </td>

                      {/* 7. DISTRIBUTED BY */}
                      <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-800 dark:text-slate-200 text-[13px] font-normal uppercase whitespace-nowrap">
                        {distributedByValue}
                      </td>

                      {/* 8. DISTRIBUTED TO */}
                      <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-900 dark:text-slate-100 text-[13px] font-normal uppercase whitespace-nowrap">
                        {distributedToValue}
                      </td>

                      {/* 9. DISTRIBUTION DATE */}
                      <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-800 dark:text-slate-200 text-[13px] font-normal whitespace-nowrap">
                        {distributedDateValue}
                      </td>

                      {/* 10. STATUS / ACTIONS (Dual status buttons matching Picture 3) */}
                      <td className="py-2 px-2.5 text-center whitespace-nowrap">
                        {(() => {
                          const isMissing =
                            record.status === 'MISSING' ||
                            record.issueFlag === 'MISSING';
                          const isFound =
                            record.status === 'FOUND' ||
                            Boolean(record.foundReason) ||
                            Boolean(record.foundDate);

                          return (
                            <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
                              {/* 1. DISTRIBUTED Button/Badge (Always present as primary status) */}
                              <div className="inline-flex flex-row items-center justify-center gap-1 px-3 py-0.5 rounded bg-emerald-100 dark:bg-[#062c20] border border-emerald-400 dark:border-emerald-500/40 text-emerald-800 dark:text-[#10B981] text-[13px] font-normal uppercase tracking-tight shadow-2xs whitespace-nowrap">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-[#10B981] animate-pulse shrink-0" />
                                <span>DISTRIBUTED</span>
                              </div>

                              {/* 2. MISSING Button (When marked missing, clicking opens confirm found modal) */}
                              {isMissing && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedRecordForFound(record)}
                                  disabled={!canUnmarkMissing}
                                  className={`inline-flex flex-row items-center justify-center gap-1 px-3 py-0.5 rounded bg-red-100 dark:bg-[#2c0a0a] border border-red-400 dark:border-red-600/50 text-red-800 dark:text-[#F87171] text-[13px] font-normal uppercase tracking-tight shadow-2xs whitespace-nowrap transition-all ${
                                    canUnmarkMissing
                                      ? 'cursor-pointer hover:bg-red-200 dark:hover:bg-red-950/80 active:scale-95'
                                      : 'opacity-90 cursor-default'
                                  }`}
                                  title={
                                    canUnmarkMissing
                                      ? 'स्मार्ट कार्ड फेला पर्यो? यहाँ क्लिक गरेर FOUND प्रमाणित गर्नुहोस् (Click to Confirm Found)'
                                      : 'स्मार्ट कार्ड हराएको रिपोर्ट गरिएको छ (Reported as MISSING)'
                                  }
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-600 dark:bg-[#F87171] animate-pulse shrink-0" />
                                  <span>MISSING</span>
                                </button>
                              )}

                              {/* 3. FOUND Button/Badge (When found, automatically replaces MISSING) */}
                              {!isMissing && isFound && (
                                <div
                                  className="inline-flex flex-row items-center justify-center gap-1 px-3 py-0.5 rounded bg-purple-100 dark:bg-[#25103a] border border-purple-400 dark:border-purple-500/50 text-purple-800 dark:text-[#c084fc] text-[13px] font-normal uppercase tracking-tight shadow-2xs whitespace-nowrap"
                                  title={
                                    record.foundReason
                                      ? `फेला परेको प्रमाणित: ${record.foundReason}`
                                      : 'स्मार्ट कार्ड फेला परेको प्रमाणित भइसकेको छ (FOUND)'
                                  }
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-purple-600 dark:bg-purple-400 animate-pulse shrink-0" />
                                  <span>FOUND</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* =================================================================== */}
        {/* BOTTOM PAGINATION BAR                                               */}
        {/* =================================================================== */}
        <div className="bg-[#f8fafc] dark:bg-[#071326] border-t border-slate-200 dark:border-[#1e2d4a]/70 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span>
              देखाउँदै {startItem} देखि {endItem} (जम्मा {totalRecords.toLocaleString()} रेकर्डहरू)
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <div className="flex items-center gap-1">
              <span>प्रति पृष्ठ:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-white dark:bg-[#0b1b36] border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-900 dark:text-white"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={0}>सबै (All)</option>
              </select>
            </div>
          </div>

          {pageSize > 0 && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={page <= 1}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b1b36] hover:bg-slate-100 dark:hover:bg-[#142f56] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                title="पहिलो पृष्ठ"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b1b36] hover:bg-slate-100 dark:hover:bg-[#142f56] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1"
              >
                <ChevronLeft className="w-3 h-3" />
                <span>अघिल्लो</span>
              </button>

              <span className="px-3 py-1 font-semibold text-slate-800 dark:text-slate-200">
                पृष्ठ {page} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b1b36] hover:bg-slate-100 dark:hover:bg-[#142f56] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1"
              >
                <span>पछिल्लो</span>
                <ChevronRight className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b1b36] hover:bg-slate-100 dark:hover:bg-[#142f56] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                title="अन्तिम पृष्ठ"
              >
                »
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirm Found Modal for marking a missing card as FOUND */}
      {selectedRecordForFound && (
        <ConfirmFoundModal
          record={selectedRecordForFound}
          onClose={() => setSelectedRecordForFound(null)}
          onSuccess={(updated) => {
            setSelectedRecordForFound(null);
            setRecords((prev) =>
              prev.map((r) =>
                r.id === updated.id
                  ? {
                      ...r,
                      ...updated,
                      status: 'FOUND',
                      issueFlag: 'NORMAL',
                    }
                  : r
              )
            );
            fetchDistributedRecords();
          }}
        />
      )}
    </div>
  );
};
