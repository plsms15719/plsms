import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  FileText,
  FileDown,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Printer,
  X,
  Calendar,
  Check,
} from 'lucide-react';
import { api } from '../../services/api';
import { getNepaliDate, getDaysInNepaliMonth, formatDistributedDateBS } from '../../utils/dateUtils';
import { resolveSubmittedDocument } from '../../utils/staffUtils';
import { NepaliDatePicker } from '../common/NepaliDatePicker';
import { normalizeCodeNumber } from '../../utils/codeUtils';

interface ReportCardConfig {
  id: string;
  title1: string;
  title2: string;
  countKey: keyof ReportCounts;
  isCyanTitle?: boolean;
  isAggregate?: boolean;
}

const ALL_REPORT_SECTIONS = [
  'TOTAL_SMART_CARDS',
  'DISTRIBUTED',
  'NOT_DISTRIBUTED',
  'MISSING',
  'FOUND',
  'REQUEST_TO_RECEIVE',
  'UPLOAD_HISTORY',
];

interface ReportCounts {
  totalSmartCards: number;
  notDistributed: number;
  distributed: number;
  missing: number;
  found: number;
  requestToReceive: number;
  uploadHistory: number;
}

interface IntegratedSectionOption {
  id: string;
  label: string;
  defaultChecked: boolean;
}

export const ReportsView: React.FC = () => {
  const [counts, setCounts] = useState<ReportCounts>({
    totalSmartCards: 0,
    notDistributed: 0,
    distributed: 0,
    missing: 0,
    found: 0,
    requestToReceive: 0,
    uploadHistory: 0,
  });

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<'xlsx' | 'csv' | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Integrated Report System State
  const [selectedSections, setSelectedSections] = useState<string[]>([
    'TOTAL_SMART_CARDS',
    'DISTRIBUTED',
    'NOT_DISTRIBUTED',
    'MISSING',
    'FOUND',
    'REQUEST_TO_RECEIVE',
    'UPLOAD_HISTORY',
  ]);
  const [fromDateBS, setFromDateBS] = useState('2083-01-01');
  const [toDateBS, setToDateBS] = useState('2083-05-15');
  const [generatingIntegrated, setGeneratingIntegrated] = useState(false);
  const [integratedFormat, setIntegratedFormat] = useState<'xlsx' | 'csv' | null>(null);

  // Single Report Printable / PDF Modal State
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    reportTitle: string;
    reportType: string;
    total: number;
    records: any[];
    generatedAt: string;
  } | null>(null);

  // Integrated Multi-Section Printable Preview State
  const [integratedPreviewOpen, setIntegratedPreviewOpen] = useState(false);
  const [integratedPreviewLoading, setIntegratedPreviewLoading] = useState(false);
  const [integratedPreviewData, setIntegratedPreviewData] = useState<{
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
  } | null>(null);

  const fetchCounts = async () => {
    try {
      const data = await api.getReportCounts();
      setCounts(data);
    } catch (err: any) {
      console.error('Failed to load report counts:', err);
    }
  };

  useEffect(() => {
    fetchCounts();
    const handleSync = () => {
      fetchCounts();
    };
    window.addEventListener('records-updated', handleSync);
    window.addEventListener('database-reset', handleSync);
    return () => {
      window.removeEventListener('records-updated', handleSync);
      window.removeEventListener('database-reset', handleSync);
    };
  }, []);

  // Set default initial dates based on current Bikram Sambat date
  useEffect(() => {
    const today = getNepaliDate(new Date());
    if (today && today !== '<N/A>') {
      const parts = today.split('-').map((v) => parseInt(v, 10));
      if (parts.length === 3) {
        const y = parts[0];
        setFromDateBS(`${y}-01-01`);
        setToDateBS(today);
      }
    }
  }, []);

  const handleDownloadSingle = async (reportType: string, format: 'xlsx' | 'csv') => {
    try {
      setDownloadingId(reportType);
      setDownloadFormat(format);
      setSuccessMsg('');
      setErrorMsg('');

      const { blob, filename } = await api.generateExcelReport({
        reportType,
        format,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setSuccessMsg(`Downloaded "${filename}" successfully.`);
      setTimeout(() => setSuccessMsg(''), 4500);
    } catch (err: any) {
      console.error('Download error:', err);
      setErrorMsg(err.message || 'Failed to download report. Please try again.');
      setTimeout(() => setErrorMsg(''), 6000);
    } finally {
      setDownloadingId(null);
      setDownloadFormat(null);
    }
  };

  const handleOpenPrintPreview = async (reportType: string) => {
    try {
      setPreviewLoading(true);
      setPreviewModalOpen(true);
      setErrorMsg('');

      const data = await api.getReportPreviewData({
        reportType,
      });
      setPreviewData(data);
    } catch (err: any) {
      console.error('Failed to load preview data:', err);
      setErrorMsg(err.message || 'Failed to load report preview.');
      setPreviewModalOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Toggle Section Selection for Integrated Report
  const toggleSection = (id: string) => {
    setSelectedSections((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAllSections = () => {
    setSelectedSections(ALL_REPORT_SECTIONS);
  };

  const deselectAllSections = () => {
    setSelectedSections([]);
  };

  // Quick Preset Handlers for Nepali Date Range
  const handlePresetToday = () => {
    const today = getNepaliDate(new Date());
    setFromDateBS(today);
    setToDateBS(today);
  };

  const handlePresetThisMonth = () => {
    const today = getNepaliDate(new Date());
    const parts = today.split('-').map((v) => parseInt(v, 10));
    if (parts.length === 3) {
      const y = parts[0];
      const m = parts[1];
      const days = getDaysInNepaliMonth(y, m - 1);
      setFromDateBS(`${y}-${String(m).padStart(2, '0')}-01`);
      setToDateBS(`${y}-${String(m).padStart(2, '0')}-${String(days).padStart(2, '0')}`);
    }
  };

  const handlePresetThisYear = () => {
    const today = getNepaliDate(new Date());
    const parts = today.split('-').map((v) => parseInt(v, 10));
    if (parts.length === 3) {
      const y = parts[0];
      const daysChaitra = getDaysInNepaliMonth(y, 11);
      setFromDateBS(`${y}-01-01`);
      setToDateBS(`${y}-12-${String(daysChaitra).padStart(2, '0')}`);
    }
  };

  const handlePresetAllTime = () => {
    setFromDateBS('');
    setToDateBS('');
  };

  // Generate Integrated Multi-Sheet Report (.xlsx or .csv)
  const handleGenerateIntegrated = async (format: 'xlsx' | 'csv' = 'xlsx', customSections?: string[]) => {
    const targetSections = customSections && customSections.length > 0
      ? customSections
      : selectedSections.length > 0
      ? selectedSections
      : ALL_REPORT_SECTIONS;

    if (targetSections.length === 0) {
      setErrorMsg('Please select at least one report section to compile.');
      return;
    }

    try {
      setGeneratingIntegrated(true);
      if (customSections) {
        setDownloadingId('AGGREGATE_REPORT');
        setDownloadFormat(format);
      }
      setIntegratedFormat(format);
      setSuccessMsg('');
      setErrorMsg('');

      const { blob, filename } = await api.generateIntegratedReport({
        sections: targetSections,
        fromDate: fromDateBS.trim() || undefined,
        toDate: toDateBS.trim() || undefined,
        format,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setSuccessMsg(`Compiled & downloaded integrated aggregate report "${filename}" (${targetSections.length} sheets).`);
      setTimeout(() => setSuccessMsg(''), 5500);
    } catch (err: any) {
      console.error('Integrated report generation error:', err);
      setErrorMsg(err.message || 'Failed to generate integrated report.');
      setTimeout(() => setErrorMsg(''), 6000);
    } finally {
      setGeneratingIntegrated(false);
      setDownloadingId(null);
      setIntegratedFormat(null);
      setDownloadFormat(null);
    }
  };

  // Open Preview for Integrated Multi-Section Report
  const handleOpenIntegratedPreview = async (customSections?: string[]) => {
    const targetSections = customSections && customSections.length > 0
      ? customSections
      : selectedSections.length > 0
      ? selectedSections
      : ALL_REPORT_SECTIONS;

    if (targetSections.length === 0) {
      setErrorMsg('Please select at least one report section to preview.');
      return;
    }

    try {
      setIntegratedPreviewLoading(true);
      setIntegratedPreviewOpen(true);
      setErrorMsg('');

      const data = await api.getIntegratedReportPreviewData({
        sections: targetSections,
        fromDate: fromDateBS.trim() || undefined,
        toDate: toDateBS.trim() || undefined,
      });
      setIntegratedPreviewData(data);
    } catch (err: any) {
      console.error('Failed to load integrated preview:', err);
      setErrorMsg(err.message || 'Failed to load integrated report preview.');
      setIntegratedPreviewOpen(false);
    } finally {
      setIntegratedPreviewLoading(false);
    }
  };

  const reportCards: ReportCardConfig[] = [
    {
      id: 'TOTAL_SMART_CARDS',
      title1: 'Total Smart',
      title2: 'Cards Report',
      countKey: 'totalSmartCards',
    },
    {
      id: 'NOT_DISTRIBUTED',
      title1: 'Not Distributed',
      title2: 'Cards Report',
      countKey: 'notDistributed',
    },
    {
      id: 'DISTRIBUTED',
      title1: 'Distributed',
      title2: 'Cards Report',
      countKey: 'distributed',
      isCyanTitle: true,
    },
    {
      id: 'MISSING',
      title1: 'Missing',
      title2: 'Cards Report',
      countKey: 'missing',
    },
    {
      id: 'FOUND',
      title1: 'Found',
      title2: 'Cards Report',
      countKey: 'found',
    },
    {
      id: 'REQUEST_TO_RECEIVE',
      title1: 'Request to Receive',
      title2: 'Report',
      countKey: 'requestToReceive',
    },
    {
      id: 'UPLOAD_HISTORY',
      title1: 'Upload History',
      title2: 'Report',
      countKey: 'uploadHistory',
    },
    {
      id: 'AGGREGATE_REPORT',
      title1: 'Aggregate Report',
      title2: '(All Sheet-Wise)',
      countKey: 'totalSmartCards',
      isAggregate: true,
    },
  ];

  const integratedSections: IntegratedSectionOption[] = [
    { id: 'TOTAL_SMART_CARDS', label: 'Total Smart Cards', defaultChecked: true },
    { id: 'DISTRIBUTED', label: 'Distributed Cards', defaultChecked: true },
    { id: 'NOT_DISTRIBUTED', label: 'Not-Distributed Cards', defaultChecked: true },
    { id: 'MISSING', label: 'Missing Cards', defaultChecked: true },
    { id: 'FOUND', label: 'Found Cards', defaultChecked: true },
    { id: 'REQUEST_TO_RECEIVE', label: 'Request to Receive', defaultChecked: true },
    { id: 'UPLOAD_HISTORY', label: 'Upload History', defaultChecked: true },
  ];

  return (
    <div className="space-y-6">
      {/* Toast Notifications */}
      {successMsg && (
        <div className="bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 p-3.5 rounded-2xl text-xs font-semibold flex items-center justify-between shadow-lg animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="text-emerald-400 hover:text-emerald-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-950/90 border border-rose-500/50 text-rose-300 p-3.5 rounded-2xl text-xs font-semibold flex items-center justify-between shadow-lg animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg('')} className="text-rose-400 hover:text-rose-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Terminal Box */}
      <div className="bg-white dark:bg-[#0b172a] rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-[#1e3456] shadow-xl dark:shadow-2xl relative overflow-hidden transition-colors duration-200">
        {/* Terminal Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-[#1c3558]">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
              Print Reports Terminal
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Filter, construct, and download professional Excel &amp; CSV reports.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={fetchCounts}
              title="Refresh Record Counts"
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#10223d] dark:hover:bg-[#183259] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#22406b] rounded-xl text-xs font-bold uppercase transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span className="text-[11px] font-bold">REFRESH METRICS</span>
            </button>
          </div>
        </div>

        {/* 7 Report Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-6">
          {reportCards.map((card) => {
            const count = counts[card.countKey] || 0;
            const isBusyXlsx = downloadingId === card.id && downloadFormat === 'xlsx';
            const isBusyCsv = downloadingId === card.id && downloadFormat === 'csv';

            return (
              <div
                key={card.id}
                className="transition-all rounded-2xl p-4 sm:p-4.5 flex items-center justify-between group shadow-sm hover:shadow-md bg-slate-50/80 dark:bg-[#0f1f38] border border-slate-200 dark:border-[#1b365d] hover:border-slate-300 dark:hover:border-[#2a4e80] hover:bg-white dark:hover:bg-[#0f1f38]"
              >
                {/* Left: Card Header & Count */}
                <div className="min-w-0 pr-2">
                  <h3
                    className={`text-xs sm:text-sm font-bold leading-tight mt-0.5 ${
                      card.isCyanTitle
                        ? 'text-cyan-800 dark:text-[#38bdf8]'
                        : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    <div>{card.title1}</div>
                    <div>{card.title2}</div>
                  </h3>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1 whitespace-nowrap">
                    {card.isAggregate
                      ? `${count} total cards in database`
                      : `${count} records matching`}
                  </div>
                </div>

                {/* Right: 3 Action Buttons (Excel, Print/PDF, CSV) */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Button 1: Excel (.xlsx) */}
                  <button
                    onClick={() =>
                      card.isAggregate
                        ? handleGenerateIntegrated('xlsx', ALL_REPORT_SECTIONS)
                        : handleDownloadSingle(card.id, 'xlsx')
                    }
                    disabled={downloadingId !== null || generatingIntegrated}
                    title={
                      card.isAggregate
                        ? 'Download Consolidated Multi-Sheet Excel Template (All 7 Sheets)'
                        : 'Download Official Excel Template (.xlsx)'
                    }
                    className="w-8 h-8 rounded-lg border border-emerald-300 dark:border-emerald-500/50 bg-emerald-50 hover:bg-emerald-100 dark:bg-[#09221b] dark:hover:bg-emerald-900/60 active:bg-emerald-200 dark:active:bg-emerald-800 text-emerald-700 dark:text-emerald-400 flex items-center justify-center transition-all hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    {isBusyXlsx ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-300" />
                    ) : (
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {/* Button 2: Print / PDF Modal */}
                  <button
                    onClick={() =>
                      card.isAggregate
                        ? handleOpenIntegratedPreview(ALL_REPORT_SECTIONS)
                        : handleOpenPrintPreview(card.id)
                    }
                    disabled={downloadingId !== null || generatingIntegrated}
                    title={
                      card.isAggregate
                        ? 'Official Print / PDF Multi-Section Aggregate Report Preview'
                        : 'Official Print / PDF Report Preview'
                    }
                    className="w-8 h-8 rounded-lg border border-rose-300 dark:border-rose-500/50 bg-rose-50 hover:bg-rose-100 dark:bg-[#250e18] dark:hover:bg-rose-900/60 active:bg-rose-200 dark:active:bg-rose-800 text-rose-700 dark:text-rose-400 flex items-center justify-center transition-all hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </button>

                  {/* Button 3: CSV Download */}
                  <button
                    onClick={() =>
                      card.isAggregate
                        ? handleGenerateIntegrated('csv', ALL_REPORT_SECTIONS)
                        : handleDownloadSingle(card.id, 'csv')
                    }
                    disabled={downloadingId !== null || generatingIntegrated}
                    title={
                      card.isAggregate
                        ? 'Download Consolidated Multi-Section CSV (.csv)'
                        : 'Direct Download CSV (.csv)'
                    }
                    className="w-8 h-8 rounded-lg border border-cyan-300 dark:border-cyan-500/50 bg-cyan-50 hover:bg-cyan-100 dark:bg-[#0b2438] dark:hover:bg-cyan-900/60 active:bg-cyan-200 dark:active:bg-cyan-800 text-cyan-700 dark:text-cyan-400 flex items-center justify-center transition-all hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    {isBusyCsv ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-600 dark:text-cyan-300" />
                    ) : (
                      <FileDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ========================================================================= */}
        {/* INTEGRATED REPORT SYSTEM SECTION                                          */}
        {/* ========================================================================= */}
        <div className="mt-8 pt-6 border-t border-slate-200 dark:border-[#1a3458]">
          {/* Section Header */}
          <div className="flex items-center gap-2 mb-1">
            <FileSpreadsheet className="w-5 h-5 text-cyan-600 dark:text-cyan-400 shrink-0" />
            <h3 className="text-sm sm:text-base font-extrabold text-cyan-700 dark:text-cyan-400 tracking-wide uppercase">
              INTEGRATED REPORT SYSTEM (एकीकृत रिपोर्ट प्रणाली)
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
            Select ledger sections to compile into a consolidated single-file Excel workbook (.xlsx) containing multiple sheet tabs.
          </p>

          {/* Choice Buttons - Tight to text and displayed in a single line horizontally */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {integratedSections.map((sec) => {
              const isChecked = selectedSections.includes(sec.id);
              return (
                <button
                  type="button"
                  key={sec.id}
                  onClick={() => toggleSection(sec.id)}
                  className={`inline-flex items-center gap-2 py-1.5 px-3 rounded-lg border text-left transition-all cursor-pointer select-none shrink-0 whitespace-nowrap active:scale-95 ${
                    isChecked
                      ? 'bg-cyan-50/90 dark:bg-[#0f2444] border-cyan-400 dark:border-cyan-500/60 text-slate-900 dark:text-white shadow-xs'
                      : 'bg-slate-50/80 dark:bg-[#0a182d] border-slate-200 dark:border-[#1c3558] text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-all shrink-0 ${
                      isChecked
                        ? 'bg-cyan-600 dark:bg-[#0084ff] text-white shadow-xs'
                        : 'border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900/60'
                    }`}
                  >
                    {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                  <span className="text-xs font-semibold tracking-tight">
                    {sec.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Filter Sub-Card: FILTER BY NEPALI DATE RANGE */}
          <div className="bg-slate-50/90 dark:bg-[#081528] border border-slate-200 dark:border-[#1b3459] rounded-2xl p-4 sm:p-5 shadow-xs dark:shadow-inner">
            {/* Sub-Card Top Row: Header & Quick Preset Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-200 dark:border-[#142845]">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                  FILTER BY NEPALI DATE RANGE (दर्ता मिति दायरा):
                </span>
              </div>

                {/* Quick Range Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handlePresetToday}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 dark:bg-[#0e223d] dark:hover:bg-[#15345d] text-cyan-800 dark:text-cyan-300 border border-slate-300 dark:border-[#1e3e6b] text-[11px] font-bold uppercase transition-all cursor-pointer active:scale-95 shadow-xs"
                >
                  TODAY
                </button>
                <button
                  type="button"
                  onClick={handlePresetThisMonth}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 dark:bg-[#0e223d] dark:hover:bg-[#15345d] text-cyan-800 dark:text-cyan-300 border border-slate-300 dark:border-[#1e3e6b] text-[11px] font-bold uppercase transition-all cursor-pointer active:scale-95 shadow-xs"
                >
                  THIS MONTH
                </button>
                <button
                  type="button"
                  onClick={handlePresetThisYear}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 dark:bg-[#0e223d] dark:hover:bg-[#15345d] text-cyan-800 dark:text-cyan-300 border border-slate-300 dark:border-[#1e3e6b] text-[11px] font-bold uppercase transition-all cursor-pointer active:scale-95 shadow-xs"
                >
                  THIS YEAR
                </button>
                <button
                  type="button"
                  onClick={handlePresetAllTime}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 dark:bg-[#0e223d] dark:hover:bg-[#15345d] text-cyan-800 dark:text-cyan-300 border border-slate-300 dark:border-[#1e3e6b] text-[11px] font-bold uppercase transition-all cursor-pointer active:scale-95 shadow-xs"
                >
                  ALL TIME
                </button>
              </div>
            </div>

            {/* Sub-Card Bottom Row: From Date & To Date Pickers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>सुरु मिति (FROM DATE):</span>
                </label>
                <NepaliDatePicker
                  value={fromDateBS}
                  onChange={setFromDateBS}
                  placeholder="YYYY-MM-DD"
                  id="integrated-from-date-bs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>अन्तिम मिति (TO DATE):</span>
                </label>
                <NepaliDatePicker
                  value={toDateBS}
                  onChange={setToDateBS}
                  placeholder="YYYY-MM-DD"
                  id="integrated-to-date-bs"
                />
              </div>
            </div>
          </div>

          {/* Bottom Action Section with Generate Integrated Report Button */}
          <div className="flex flex-wrap items-center justify-between gap-4 mt-5 pt-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 shrink-0"></span>
              <span>
                Selected <strong className="text-slate-800 dark:text-slate-200">{selectedSections.length}</strong> sheets to compile into single workbook.
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Secondary Option: Print / PDF Consolidated Preview */}
              <button
                type="button"
                onClick={() => handleOpenIntegratedPreview()}
                disabled={generatingIntegrated || selectedSections.length === 0}
                title="Preview and print multi-section report document"
                className="px-3.5 py-2.5 rounded-xl border border-rose-300 dark:border-rose-500/50 bg-rose-50 hover:bg-rose-100 dark:bg-[#250e18] dark:hover:bg-rose-900/60 active:bg-rose-200 dark:active:bg-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline font-bold uppercase">PREVIEW / PRINT PDF</span>
              </button>

              {/* Secondary Option: Consolidated CSV */}
              <button
                type="button"
                onClick={() => handleGenerateIntegrated('csv')}
                disabled={generatingIntegrated || selectedSections.length === 0}
                title="Download consolidated CSV"
                className="px-3.5 py-2.5 rounded-xl border border-cyan-300 dark:border-cyan-500/50 bg-cyan-50 hover:bg-cyan-100 dark:bg-[#0b2438] dark:hover:bg-cyan-900/60 active:bg-cyan-200 dark:active:bg-cyan-800 text-cyan-700 dark:text-cyan-300 text-xs font-bold flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <FileDown className="w-4 h-4" />
                <span className="hidden sm:inline font-bold uppercase">EXPORT CSV</span>
              </button>

              {/* Primary Action Button: Generate Integrated Report */}
              <button
                type="button"
                onClick={() => handleGenerateIntegrated('xlsx')}
                disabled={generatingIntegrated || selectedSections.length === 0}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-black uppercase flex items-center gap-2.5 transition-all shadow-md shadow-emerald-700/20 dark:shadow-emerald-950/50 active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {generatingIntegrated && integratedFormat === 'xlsx' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-4 h-4" />
                )}
                <span>GENERATE INTEGRATED REPORT (.XLSX)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. SINGLE REPORT PRINTABLE / PDF MODAL                                    */}
      {/* ========================================================================= */}
      {previewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-5xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal Top Bar (Hidden on Print) */}
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0 print:hidden">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {previewData?.reportTitle || 'Official Report Preview'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Formatted with Nepal Government Transport Management Office Letterhead
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print / Save PDF</span>
                </button>
                <button
                  onClick={() => setPreviewModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body - Official Report View */}
            <div className="p-6 sm:p-8 overflow-y-auto print:p-0 flex-1 font-sans">
              {previewLoading ? (
                <div className="py-20 flex flex-col items-center justify-center text-slate-500 gap-3">
                  <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
                  <p className="text-xs font-semibold">Compiling official document...</p>
                </div>
              ) : previewData ? (
                <div className="space-y-2 text-slate-900 bg-white">
                  {/* Government Official Header */}
                  <div className="text-center pb-2">
                    <h1 className="text-base sm:text-lg font-black text-[#ff0000] tracking-wide uppercase">
                      TRANSPORT MANAGEMENT OFFICE, DRIVING LICENSE
                    </h1>
                    <h2 className="text-xs sm:text-sm font-bold text-[#ff0000] tracking-wider uppercase mt-0.5">
                      ITAHARI, SUNSARI, NEPAL
                    </h2>
                  </div>

                  {/* Row 3: Total Records (Left) and Official Report Subtitle (Center) */}
                  <div className="grid grid-cols-12 border border-[#d1d5db] text-xs font-bold mt-2">
                    <div className="col-span-3 py-1.5 px-3 bg-[#e8eef5] text-slate-900 border-r border-[#d1d5db] flex items-center">
                      TOTAL RECORDS: {previewData.total}
                    </div>
                    <div className="col-span-9 py-1.5 px-3 bg-[#f2f6fa] text-[#0b2447] text-center flex items-center justify-center uppercase">
                      OFFICIAL REPORT: {previewData.reportTitle} | Generated:{' '}
                      {(() => {
                        const now = new Date(previewData.generatedAt || Date.now());
                        const d = String(now.getDate()).padStart(2, '0');
                        const m = String(now.getMonth() + 1).padStart(2, '0');
                        const y = now.getFullYear();
                        return `${d}/${m}/${y}`;
                      })()}
                    </div>
                  </div>

                  {/* Data Table with Red Headers and Light Pink Background */}
                  <div className="border border-slate-300 overflow-x-auto mt-2">
                    <table className="w-full text-[13px] text-left border-collapse">
                      <thead>
                        <tr className="bg-[#ffecef] text-[#ff0000] font-bold border-b border-[#ff9999] whitespace-nowrap text-center">
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">S.N.</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">APPLICANT ID</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">FULL NAME</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">LICENSE NUMBER</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">CATEGORY</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">OLD CODE</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">NEW CODE</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">DEPARTMENT</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">RECEIVED BY</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">DISTRIBUTED DATE</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">DISTRIBUTED BY</th>
                          <th rowSpan={2} className="p-2 border border-[#ff7f7f] text-center">SUBMITTED DOC.</th>
                          <th colSpan={3} className="p-2 border border-[#ff7f7f] text-center">STATUS</th>
                        </tr>
                        <tr className="bg-[#ffecef] text-[#ff0000] font-bold border-b border-[#ff9999] whitespace-nowrap text-center">
                          <th className="p-1.5 border border-[#ff7f7f] text-center text-xs">DISTRIBUTED</th>
                          <th className="p-1.5 border border-[#ff7f7f] text-center text-xs">MISSING</th>
                          <th className="p-1.5 border border-[#ff7f7f] text-center text-xs">FOUND</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.records.length === 0 ? (
                          <tr>
                            <td colSpan={15} className="p-8 text-center text-slate-500 font-medium">
                              No records found matching current criteria.
                            </td>
                          </tr>
                        ) : (
                          previewData.records.map((rec: any, idx: number) => {
                            const raw = rec.rawRecord || {};
                            const rawOld = raw['OLD CODE'] || raw['OLD_CODE'] || rec.oldCode;
                            const rawNew = raw['NEW CODE'] || raw['NEW_CODE'] || rec.newCode;
                            const oldCode = rawOld ? normalizeCodeNumber(rawOld) : '—';
                            const newCode = rawNew ? normalizeCodeNumber(rawNew) : '—';
                            const isFound = rec.status === 'FOUND' || Boolean(rec.foundReason);
                            const isMissing = rec.status === 'MISSING';
                            const isDist = rec.status === 'DISTRIBUTED' || rec.isDistributed || Boolean(rec.distributedAt) || Boolean(rec.receivedBy && rec.receivedBy !== '-') || isFound || isMissing;
                            const submittedDoc = isDist
                              ? resolveSubmittedDocument(rec)
                              : '—';
                            const receivedBy = isDist
                              ? (rec.receivedBy || rec.receiverName || '<N/A>')
                              : '—';
                            const isKnownDistributor =
                              isDist &&
                              rec.distributedBy &&
                              rec.distributedBy.trim() &&
                              !['SUPER_ADMIN', 'SUPERADMIN', 'SUPER ADMINISTRATOR'].includes(rec.distributedBy.trim().toUpperCase()) &&
                              rec.distributedBy.trim() !== '<N/A>' &&
                              rec.distributedBy.trim() !== 'N/A';
                            const distributedBy = isDist
                              ? (isKnownDistributor ? rec.distributedBy.trim() : '<N/A>')
                              : '—';

                            let distDateStr = '—';
                            if (isDist) {
                              distDateStr = formatDistributedDateBS(rec);
                            }

                            let colDist = '';
                            let colMissing = '';
                            let colFound = '';
                            if (isMissing) {
                              colMissing = 'MISSING';
                            } else if (isFound && rec.status === 'FOUND') {
                              colFound = 'FOUND';
                            } else if (isDist) {
                              colDist = 'DISTRIBUTED';
                            }

                            return (
                              <tr
                                key={rec.id || idx}
                                className="border-b border-slate-200 hover:bg-slate-50 transition-colors"
                              >
                                <td className="p-1.5 border-r border-slate-200 text-center font-mono">{idx + 1}</td>
                                <td className="p-1.5 border-r border-slate-200 text-center font-mono font-medium">{rec.applicantId || rec.applicationNumber || '—'}</td>
                                <td className="p-1.5 border-r border-slate-200 font-bold uppercase">{rec.holderName || '—'}</td>
                                <td className="p-1.5 border-r border-slate-200 text-center font-mono font-semibold">{rec.licenseNumber || '—'}</td>
                                <td className="p-1.5 border-r border-slate-200 text-center font-bold">{rec.category || rec.vehicleClass || '—'}</td>
                                <td className="p-1.5 border-r border-slate-200 text-center">{oldCode}</td>
                                <td className="p-1.5 border-r border-slate-200 text-center">{newCode}</td>
                                <td className="p-1.5 border-r border-slate-200 text-left">{rec.office || rec.department || 'कार्ड वितरण शाखा - \'क\''}</td>
                                <td className="p-1.5 border-r border-slate-200 font-medium">{receivedBy}</td>
                                <td className="p-1.5 border-r border-slate-200 text-center font-mono">{distDateStr}</td>
                                <td className="p-1.5 border-r border-slate-200 text-center">{distributedBy}</td>
                                <td className="p-1.5 border-r border-slate-200 text-left">{submittedDoc}</td>
                                <td className="p-1.5 border-r border-slate-200 text-center font-bold text-green-700">{colDist}</td>
                                <td className="p-1.5 border-r border-slate-200 text-center font-bold text-red-600">{colMissing}</td>
                                <td className="p-1.5 text-center font-bold text-green-700">{colFound}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. INTEGRATED MULTI-SECTION PRINTABLE / PDF MODAL                         */}
      {/* ========================================================================= */}
      {integratedPreviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-5xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            {/* Top Bar */}
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0 print:hidden">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Integrated Multi-Section Aggregate Report Preview
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Consolidated report with {integratedPreviewData?.sections?.length || 0} sections
                    {fromDateBS || toDateBS ? ` | Range: ${fromDateBS || 'Start'} to ${toDateBS || 'End'}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print All / Save PDF</span>
                </button>
                <button
                  onClick={() => setIntegratedPreviewOpen(false)}
                  className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body - Multi-Section Report View */}
            <div className="p-6 sm:p-8 overflow-y-auto print:p-0 flex-1 font-sans space-y-10">
              {integratedPreviewLoading ? (
                <div className="py-20 flex flex-col items-center justify-center text-slate-500 gap-3">
                  <RefreshCw className="w-8 h-8 animate-spin text-cyan-600" />
                  <p className="text-xs font-semibold">Compiling integrated report preview...</p>
                </div>
              ) : integratedPreviewData ? (
                integratedPreviewData.sections.map((sec, secIdx) => (
                  <div key={sec.id} className={`space-y-2 text-slate-900 bg-white ${secIdx > 0 ? 'print:break-before-page pt-4' : ''}`}>
                    {/* Header */}
                    <div className="text-center pb-2">
                      <h1 className="text-base sm:text-lg font-black text-[#ff0000] tracking-wide uppercase">
                        TRANSPORT MANAGEMENT OFFICE, DRIVING LICENSE
                      </h1>
                      <h2 className="text-xs sm:text-sm font-bold text-[#ff0000] tracking-wider uppercase mt-0.5">
                        ITAHARI, SUNSARI, NEPAL
                      </h2>
                    </div>

                    {/* Section Subtitle */}
                    <div className="text-center py-1.5 px-3 bg-[#f2f6fa] border border-[#e2e8f0] text-xs font-bold text-[#0b2447] uppercase">
                      OFFICIAL REPORT: {sec.title} | Generated: {getNepaliDate(new Date())}
                      {fromDateBS || toDateBS ? ` | Range: ${fromDateBS || 'Start'} to ${toDateBS || 'End'}` : ''}
                    </div>

                    {/* Table */}
                    <div className="border border-slate-300 overflow-x-auto mt-2">
                      <table className="w-full text-[13px] text-left border-collapse">
                        <thead>
                          <tr className="bg-[#ffecef] text-[#ff0000] font-bold border-b border-[#ff9999] whitespace-nowrap text-center">
                            <th className="p-2 border border-[#ff7f7f] text-center">S.N.</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">APPLICANT ID</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">FULL NAME</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">LICENSE NUMBER</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">CATEGORY</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">OLD CODE</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">NEW CODE</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">DEPARTMENT</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">RECEIVED BY</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">DISTRIBUTED DATE</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">DISTRIBUTED BY</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">SUBMITTED DOC.</th>
                            <th className="p-2 border border-[#ff7f7f] text-center">STATUS</th>
                          </tr>
                          <tr className="bg-[#e8eef5] text-slate-900 font-bold border-b border-slate-300">
                            <td colSpan={13} className="p-1.5 px-2 text-left text-[13px] font-bold text-slate-900 border-x border-slate-300">
                              TOTAL RECORDS IN SECTION: {sec.records.length}
                            </td>
                          </tr>
                        </thead>
                        <tbody>
                          {sec.records.length === 0 ? (
                            <tr>
                              <td colSpan={13} className="p-6 text-center text-slate-500 font-medium">
                                No records found for this section in the selected date range.
                              </td>
                            </tr>
                          ) : (
                            sec.records.map((rec: any, idx: number) => {
                              const raw = rec.rawRecord || {};
                              const rawOld = raw['OLD CODE'] || raw['OLD_CODE'] || rec.oldCode;
                              const rawNew = raw['NEW CODE'] || raw['NEW_CODE'] || rec.newCode;
                              const oldCode = rawOld ? normalizeCodeNumber(rawOld) : '—';
                              const newCode = rawNew ? normalizeCodeNumber(rawNew) : '—';
                              const isFound = rec.status === 'FOUND' || Boolean(rec.foundReason);
                              const isMissing = rec.status === 'MISSING';
                              const isDist = rec.status === 'DISTRIBUTED' || rec.isDistributed || Boolean(rec.distributedAt) || Boolean(rec.receivedBy && rec.receivedBy !== '-') || isFound || isMissing;
                              const submittedDoc = isDist
                                ? resolveSubmittedDocument(rec)
                                : '—';
                              const receivedBy = isDist
                                ? (rec.receivedBy || rec.receiverName || '<N/A>')
                                : '—';
                              const isKnownDistributor =
                                isDist &&
                                rec.distributedBy &&
                                rec.distributedBy.trim() &&
                                !['SUPER_ADMIN', 'SUPERADMIN', 'SUPER ADMINISTRATOR'].includes(rec.distributedBy.trim().toUpperCase()) &&
                                rec.distributedBy.trim() !== '<N/A>' &&
                                rec.distributedBy.trim() !== 'N/A';
                              const distributedBy = isDist
                                ? (isKnownDistributor ? rec.distributedBy.trim() : '<N/A>')
                                : '—';
                              
                              let statusText = isDist ? 'DISTRIBUTED' : 'NOT-DISTRIBUTED';
                              let statusColor = isDist ? 'text-green-700' : 'text-red-600';
                              if (isFound) {
                                statusText = 'FOUND';
                                statusColor = 'text-purple-600 font-bold';
                              } else if (isMissing) {
                                statusText = 'MISSING';
                                statusColor = 'text-rose-600';
                              }

                              let distDateStr = '—';
                              if (isDist) {
                                distDateStr = formatDistributedDateBS(rec);
                              }

                              return (
                                <tr key={rec.id || idx} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                                  <td className="p-1.5 border-r border-slate-200 text-center font-mono">{idx + 1}</td>
                                  <td className="p-1.5 border-r border-slate-200 text-center font-mono font-medium">{rec.applicantId || rec.applicationNumber || '—'}</td>
                                  <td className="p-1.5 border-r border-slate-200 font-bold uppercase">{rec.holderName || '—'}</td>
                                  <td className="p-1.5 border-r border-slate-200 text-center font-mono font-semibold">{rec.licenseNumber || '—'}</td>
                                  <td className="p-1.5 border-r border-slate-200 text-center font-bold">{rec.category || rec.vehicleClass || '—'}</td>
                                  <td className="p-1.5 border-r border-slate-200 text-center">{oldCode}</td>
                                  <td className="p-1.5 border-r border-slate-200 text-center">{newCode}</td>
                                  <td className="p-1.5 border-r border-slate-200 text-left">{rec.office || rec.department || 'कार्ड वितरण शाखा - \'क\''}</td>
                                  <td className="p-1.5 border-r border-slate-200 font-medium">{receivedBy}</td>
                                  <td className="p-1.5 border-r border-slate-200 text-center font-mono">{distDateStr}</td>
                                  <td className="p-1.5 border-r border-slate-200 text-center">{distributedBy}</td>
                                  <td className="p-1.5 border-r border-slate-200 text-left">{submittedDoc}</td>
                                  <td className={`p-1.5 text-center font-bold ${statusColor}`}>{statusText}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
