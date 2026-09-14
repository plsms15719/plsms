import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Database,
  FileSpreadsheet,
  Search,
  Download,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  FileText,
  Layers,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { CrossPlatformParityStats, MatchingParityInfo } from '../../types';
import { resolveSearchedByStaff } from '../../utils/staffUtils';

export interface CategoryRecordsModalProps {
  isOpen: boolean;
  onClose: () => void;
  source: 'DB' | 'SHEET';
  category: 'ALL' | 'NOT_DISTRIBUTED' | 'DISTRIBUTED' | 'MISSING' | 'FOUND' | 'HANDED_OVER';
  categoryLabel: string;
  totalCount: number;
  filteredCount: number;
  records: any[];
  page: number;
  totalPages: number;
  tabName?: string;
  isLoading: boolean;
  onPageChange: (newPage: number) => void;
  onSearch: (query: string) => void;
  searchQuery: string;
  parityStats?: CrossPlatformParityStats;
}

type FilterMode = 'ALL' | 'KAP_4COL' | 'ANY_MAP' | 'ONLY_HERE' | 'STATUS_MISMATCH';

export const CategoryRecordsModal: React.FC<CategoryRecordsModalProps> = ({
  isOpen,
  onClose,
  source,
  category,
  categoryLabel,
  totalCount,
  filteredCount,
  records,
  page,
  totalPages,
  tabName,
  isLoading,
  onPageChange,
  onSearch,
  searchQuery,
  parityStats,
}) => {
  const [copiedLicense, setCopiedLicense] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [filterMode, setFilterMode] = useState<FilterMode>('ALL');

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Client-side quick filter on current batch
  const displayedRecords = useMemo(() => {
    if (!records || !isOpen) return [];
    if (filterMode === 'ALL') return records;
    return records.filter((r) => {
      const p: MatchingParityInfo | undefined = r.matchingParity;
      if (filterMode === 'KAP_4COL') {
        return p && p.matchLevel === 'KAP_4COL';
      }
      if (filterMode === 'ANY_MAP') {
        return p && p.isMatched && p.matchLevel !== 'UNMATCHED';
      }
      if (filterMode === 'ONLY_HERE') {
        return !p || !p.isMatched || p.matchLevel === 'UNMATCHED';
      }
      if (filterMode === 'STATUS_MISMATCH') {
        return p && p.isMatched && p.counterpartStatus && !p.statusAgreed;
      }
      return true;
    });
  }, [records, filterMode, isOpen]);

  if (!isOpen) return null;

  const handleCopy = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedLicense(text);
    setTimeout(() => setCopiedLicense(null), 2000);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(localSearch);
  };

  const handleExportCsv = () => {
    if (!records || records.length === 0) return;
    const headers = [
      'Col A (SN)',
      'Col B (Applicant ID)',
      'Col C (Holder Name)',
      'Col D (License Number)',
      'Col E (Category)',
      'Col F (Old Code)',
      'Col G (New Code)',
      'Col H (Department / Office)',
      'Col M (Status)',
      'Col I (Receiver / Remarks)',
      'Col J (Distributed Date)',
      'Col K (Distributed By)',
      'Col L (Submitted Document)',
      'KAP Match Level',
      'Counterpart Status',
      'Status Parity Agreement',
      'Counterpart Ref/Row',
    ];

    const rows = records.map((r, idx) => {
      const p: MatchingParityInfo | undefined = r.matchingParity;
      return [
        `"${r.sn || idx + 1}"`,
        `"${r.applicantId || r.applicationNumber || ''}"`,
        `"${r.holderName || ''}"`,
        `"${r.licenseNumber || ''}"`,
        `"${r.category || r.vehicleClass || ''}"`,
        `"${r.oldCode || ''}"`,
        `"${r.newCode || ''}"`,
        `"${r.office || r.department || ''}"`,
        `"${r.status || ''}"`,
        `"${r.receivedBy || r.receiverName || ''}"`,
        `"${r.distributedDate || r.distributedAt || ''}"`,
        `"${r.distributedBy || ''}"`,
        `"${r.submittedDocument || ''}"`,
        `"${p?.matchLevel || 'UNMATCHED'}"`,
        `"${p?.counterpartStatus || 'N/A'}"`,
        `"${p?.statusAgreed ? 'IN_SYNC' : (p?.isMatched ? 'DISCREPANCY' : 'SOLO')}"`,
        `"${p?.counterpartSheetRow ? 'Row ' + p.counterpartSheetRow : (p?.counterpartRecordId || 'N/A')}"`,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `KAP_MAP_${source}_${category}_RECORDS_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isDb = source === 'DB';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-7xl max-h-[95vh] flex flex-col rounded-2xl bg-white dark:bg-[#070D18] border border-slate-300 dark:border-slate-700/80 shadow-2xl overflow-hidden font-sans text-slate-900 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          className={`px-5 py-3.5 flex items-center justify-between border-b ${
            isDb
              ? 'bg-gradient-to-r from-blue-50 via-indigo-50/50 to-blue-50 dark:from-blue-950/50 dark:via-[#09152a] dark:to-blue-950/40 border-blue-200 dark:border-blue-800/40'
              : 'bg-gradient-to-r from-emerald-50 via-teal-50/50 to-emerald-50 dark:from-emerald-950/50 dark:via-[#09221b] dark:to-emerald-950/40 border-emerald-200 dark:border-emerald-800/40'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl border shadow-sm ${
                isDb
                  ? 'bg-blue-100 dark:bg-blue-900/50 border-blue-300 dark:border-blue-600/50 text-blue-700 dark:text-blue-300'
                  : 'bg-emerald-100 dark:bg-emerald-900/50 border-emerald-300 dark:border-emerald-600/50 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {isDb ? <Database className="w-5 h-5" /> : <FileSpreadsheet className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm sm:text-base font-black uppercase tracking-wider text-slate-900 dark:text-slate-100 font-mono">
                  {categoryLabel}
                </span>
                <span
                  className={`text-[10px] sm:text-[11px] px-2.5 py-0.5 rounded-full font-bold font-mono border ${
                    isDb
                      ? 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 border-blue-400/40'
                      : 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-400/40'
                  }`}
                >
                  {isDb ? 'PLATFORM 1: PLSMS DATABASE' : `PLATFORM 2: GOOGLE SHEET (${tabName || 'Sheet1'})`}
                </span>
                <span className="text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full font-mono bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 font-semibold">
                  {totalCount.toLocaleString()} Records
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 font-mono">
                <span>Matching Engine: <strong>KAP (4-Col Strict) & 5-Tier MAP</strong></span>
                <span>•</span>
                <span>Cross-platform sync & parity verified</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={records.length === 0}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer shadow-xs transition-colors"
              title="Export records with KAP/MAP matching data as CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer transition-colors"
              title="Close modal (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Cross-Platform Parity & Statistical Banner */}
        {parityStats && (
          <div className="px-5 py-2.5 bg-slate-50 dark:bg-[#0A1324] border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 font-semibold">
                <Database className="w-3.5 h-3.5" />
                DB: {parityStats.dbTotal.toLocaleString()}
              </span>
              <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400" />
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 font-semibold">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Sheet: {parityStats.sheetTotal.toLocaleString()}
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-700 dark:text-slate-300">
                KAP 4-Col Match: <strong className="text-emerald-600 dark:text-emerald-400">{parityStats.matchedKAP4Col.toLocaleString()} ({parityStats.kapMatchPercentage}%)</strong>
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-700 dark:text-slate-300">
                Status Agreement: <strong className="text-sky-600 dark:text-sky-400">{parityStats.statusAgreedTotal.toLocaleString()} ({parityStats.statusAgreementPercentage}%)</strong>
              </span>
            </div>

            {parityStats.statusDriftTotal > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/50 text-[11px] font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>Status Drift: {parityStats.statusDriftTotal.toLocaleString()} cards differ between Sheet and DB</span>
              </div>
            )}
          </div>
        )}

        {/* Toolbar: Search, Filter Tabs & Pagination */}
        <div className="px-5 py-2.5 bg-slate-100/70 dark:bg-[#0A101C] border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 font-mono text-[11px]">
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`px-2.5 py-1 rounded-lg transition-colors font-medium cursor-pointer shrink-0 ${
                filterMode === 'ALL'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-bold'
                  : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              All ({records.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('KAP_4COL')}
              className={`px-2.5 py-1 rounded-lg transition-colors font-medium cursor-pointer shrink-0 flex items-center gap-1 ${
                filterMode === 'KAP_4COL'
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-white dark:bg-slate-800/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/60 hover:bg-emerald-50'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              KAP 4-Col Matched
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('ANY_MAP')}
              className={`px-2.5 py-1 rounded-lg transition-colors font-medium cursor-pointer shrink-0 flex items-center gap-1 ${
                filterMode === 'ANY_MAP'
                  ? 'bg-sky-600 text-white font-bold'
                  : 'bg-white dark:bg-slate-800/80 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-700/60 hover:bg-sky-50'
              }`}
            >
              <Layers className="w-3 h-3" />
              All MAP Levels
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('STATUS_MISMATCH')}
              className={`px-2.5 py-1 rounded-lg transition-colors font-medium cursor-pointer shrink-0 flex items-center gap-1 ${
                filterMode === 'STATUS_MISMATCH'
                  ? 'bg-amber-600 text-white font-bold'
                  : 'bg-white dark:bg-slate-800/80 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60 hover:bg-amber-50'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              Status Mismatch
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('ONLY_HERE')}
              className={`px-2.5 py-1 rounded-lg transition-colors font-medium cursor-pointer shrink-0 ${
                filterMode === 'ONLY_HERE'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              Only in {source}
            </button>
          </div>

          {/* Search Form & Page Navigation */}
          <div className="flex items-center gap-2.5 w-full md:w-auto justify-between md:justify-end">
            <form onSubmit={handleSearchSubmit} className="relative flex-1 md:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Search Applicant ID, Name, License..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#070D18] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
              />
            </form>

            <div className="flex items-center gap-1.5 shrink-0 text-xs font-mono">
              <button
                type="button"
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 1 || isLoading}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#070D18] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-slate-600 dark:text-slate-400 text-[11px] whitespace-nowrap">
                {page} / {totalPages || 1}
              </span>
              <button
                type="button"
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages || isLoading}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#070D18] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Table Container */}
        <div className="flex-1 overflow-auto p-3 sm:p-5 relative min-h-[320px]">
          {isLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 dark:bg-[#070D18]/80 z-10 space-y-3">
              <RefreshCw className="w-8 h-8 text-blue-500 dark:text-blue-400 animate-spin" />
              <p className="text-xs font-mono text-slate-700 dark:text-slate-300">
                Importing and indexing {categoryLabel} via KAP / 5-Tier MAP Engine...
              </p>
            </div>
          ) : displayedRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
              <FileText className="w-10 h-10 text-slate-400 dark:text-slate-600" />
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 font-mono">No Records Found</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono max-w-sm">
                No records match the current search or KAP/MAP filter. Try clearing filters.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-[#1E3B66] shadow-sm bg-white dark:bg-[#071120]">
              <table className="w-full text-left text-[12px] sm:text-[13px] border-collapse font-sans">
                <thead className="bg-slate-100 dark:bg-[#0D1525] text-slate-700 dark:text-slate-300 font-mono uppercase text-[11px] border-b border-slate-300 dark:border-[#1E3B66] sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-2.5 border-r border-slate-300 dark:border-[#1E3B66] text-center w-10">Col A (#)</th>
                    <th className="py-2.5 px-3 border-r border-slate-300 dark:border-[#1E3B66]">Col B: Applicant ID</th>
                    <th className="py-2.5 px-3 border-r border-slate-300 dark:border-[#1E3B66]">Col C: Full Name</th>
                    <th className="py-2.5 px-3 border-r border-slate-300 dark:border-[#1E3B66]">Col D: License No</th>
                    <th className="py-2.5 px-2.5 border-r border-slate-300 dark:border-[#1E3B66] text-center">Col E: Cat</th>
                    <th className="py-2.5 px-3 border-r border-slate-300 dark:border-[#1E3B66]">Col M: Status ({source})</th>
                    <th className="py-2.5 px-3 border-r border-slate-300 dark:border-[#1E3B66]">KAP / MAP Match Level</th>
                    <th className="py-2.5 px-3 border-r border-slate-300 dark:border-[#1E3B66]">Counterpart Parity</th>
                    <th className="py-2.5 px-3 border-r border-slate-300 dark:border-[#1E3B66]">Col I: Receiver / Remarks</th>
                    <th className="py-2.5 px-3 border-r border-slate-300 dark:border-[#1E3B66]">Col J/K: Date / Staff</th>
                    <th className="py-2.5 px-3">Col F/G/H: Lot & Office</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 dark:divide-[#1E3B66] font-mono text-slate-800 dark:text-slate-200">
                  {displayedRecords.map((r, idx) => {
                    const rowNum = (page - 1) * 50 + idx + 1;
                    const isDistributed =
                      r.status === 'DISTRIBUTED' ||
                      r.isDistributed ||
                      (r.receivedBy && r.receivedBy.trim().length > 0 && r.receivedBy !== '-');
                    const isMissing = r.status === 'MISSING';
                    const isFound = r.status === 'FOUND' || Boolean(r.foundReason);
                    const parity: MatchingParityInfo | undefined = r.matchingParity;

                    return (
                      <tr
                        key={r.id || r.licenseNumber || idx}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-300 dark:border-[#1E3B66] last:border-b-0"
                      >
                        {/* Col A: Row Number / S.N. */}
                        <td className="py-2 px-2 text-slate-500 text-[11px] text-center border-r border-slate-300 dark:border-[#1E3B66]">
                          {r.sn || rowNum}
                        </td>

                        {/* Col B: Applicant ID */}
                        <td className="py-2 px-3 text-slate-900 dark:text-slate-100 font-semibold text-[12px] border-r border-slate-300 dark:border-[#1E3B66] whitespace-nowrap">
                          {r.applicantId || r.applicationNumber || '-'}
                        </td>

                        {/* Col C: Full Name */}
                        <td className="py-2 px-3 text-[12px] font-medium text-slate-900 dark:text-slate-200 font-sans border-r border-slate-300 dark:border-[#1E3B66] max-w-[180px] truncate" title={r.holderName}>
                          {r.holderName || '-'}
                        </td>

                        {/* Col D: License Number */}
                        <td className="py-2 px-3 font-semibold text-[12px] text-slate-900 dark:text-slate-100 border-r border-slate-300 dark:border-[#1E3B66] whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{r.licenseNumber || '-'}</span>
                            {r.licenseNumber && (
                              <button
                                type="button"
                                onClick={() => handleCopy(r.licenseNumber)}
                                className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                                title="Copy License Number"
                              >
                                {copiedLicense === r.licenseNumber ? (
                                  <Check className="w-3 h-3 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Col E: Category */}
                        <td className="py-2 px-2.5 text-center text-[11px] font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-[#1E3B66]">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                            {r.category || r.vehicleClass || '-'}
                          </span>
                        </td>

                        {/* Col M: Current Platform Status */}
                        <td className="py-2 px-3 border-r border-slate-300 dark:border-[#1E3B66] whitespace-nowrap">
                          {isMissing ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-500/40">
                              MISSING
                            </span>
                          ) : isFound ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-500/40">
                              FOUND
                            </span>
                          ) : isDistributed ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-500/40">
                              DISTRIBUTED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40">
                              AVAILABLE
                            </span>
                          )}
                        </td>

                        {/* KAP / MAP Match Level */}
                        <td className="py-2 px-3 border-r border-slate-300 dark:border-[#1E3B66] whitespace-nowrap">
                          {parity?.matchLevel === 'KAP_4COL' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-600/50">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              KAP 4-COL MATCH
                            </span>
                          ) : parity?.matchLevel === 'COMPOSITE' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-600/50">
                              <Layers className="w-3 h-3 text-sky-600" />
                              MAP: COMPOSITE
                            </span>
                          ) : parity?.matchLevel === 'EXACT_LIC' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-600/50">
                              MAP: EXACT LIC
                            </span>
                          ) : parity?.matchLevel === 'CLEAN_LIC' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-600/50">
                              MAP: CLEAN LIC
                            </span>
                          ) : parity?.matchLevel === 'APP_ID' ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-600/50">
                              MAP: APP ID
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                              SOLO ({source})
                            </span>
                          )}
                        </td>

                        {/* Counterpart Parity (Google Sheet <-> DB Status Comparison) */}
                        <td className="py-2 px-3 border-r border-slate-300 dark:border-[#1E3B66] whitespace-nowrap">
                          {parity && parity.isMatched ? (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                {parity.statusAgreed ? (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                    <Check className="w-3 h-3" />
                                    In-Sync ({parity.counterpartStatus})
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                    <AlertTriangle className="w-3 h-3 text-amber-500" />
                                    Drift: {parity.counterpartStatus}
                                  </span>
                                )}
                              </div>
                              {parity.counterpartSheetRow && (
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                  Sheet Row #{parity.counterpartSheetRow}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-mono italic">
                              Not in {isDb ? 'Sheet' : 'DB'}
                            </span>
                          )}
                        </td>

                        {/* Col I: Receiver / Remarks */}
                        <td className="py-2 px-3 text-slate-800 dark:text-slate-200 text-[12px] border-r border-slate-300 dark:border-[#1E3B66] max-w-[150px] truncate" title={r.receivedBy || r.receiverName || r.missingReason || r.foundReason}>
                          {r.receivedBy || r.receiverName || r.missingReason || r.foundReason || '-'}
                        </td>

                        {/* Col J/K: Date / Staff */}
                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300 text-[11px] border-r border-slate-300 dark:border-[#1E3B66] whitespace-nowrap">
                          <div>{r.distributedDate || r.distributedAt || r.missingDate || r.foundDate || '-'}</div>
                          {(r.distributedBy || r.missingReportedBy || r.foundReportedBy) && (
                            <div className="text-[10px] text-slate-500 uppercase">
                              {r.status === 'MISSING' ? resolveSearchedByStaff(r) : (r.distributedBy || r.foundReportedBy || resolveSearchedByStaff(r))}
                            </div>
                          )}
                        </td>

                        {/* Col F/G/H: Lot Codes & Office */}
                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300 text-[11px] whitespace-nowrap">
                          <div>Lot: {r.lotCode || r.oldCode || r.newCode || '-'}</div>
                          {r.office && <div className="text-[10px] text-slate-500">{r.office}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-100 dark:bg-[#080E18] border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>
              Connected Source: {isDb ? 'Local PLSMS Database Storage (SQLite / JSON Master)' : `Live Google Sheet (${tabName || 'Sheet1'})`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500">
              Showing {displayedRecords.length} of {records.length} records (Page {page} of {totalPages || 1})
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer transition-colors border border-slate-300 dark:border-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
