import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Search,
  RotateCcw,
  RefreshCw,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { AlphabeticalDashboardData, AlphabeticalStatItem } from '../../types';
import { api } from '../../services/api';
import { getNepaliDate } from '../../utils/dateUtils';
import { NepaliDatePicker } from '../common/NepaliDatePicker';
import { AlphabeticalPrintModal } from '../modals/AlphabeticalPrintModal';

interface Props {
  onRefreshStats?: () => void;
}

export const AlphabeticalDashboardView: React.FC<Props> = ({ onRefreshStats }) => {
  const [data, setData] = useState<AlphabeticalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Date filters in Bikram Sambat (BS)
  const [fromDateBS, setFromDateBS] = useState('');
  const [toDateBS, setToDateBS] = useState('');

  // Filter application state
  const [appliedFromDate, setAppliedFromDate] = useState('');
  const [appliedToDate, setAppliedToDate] = useState('');

  const fetchAlphabeticalStats = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.getAlphabeticalDashboardStats({
        fromDate: appliedFromDate.trim() || undefined,
        toDate: appliedToDate.trim() || undefined,
      });
      setData(res);
    } catch (err: any) {
      console.error('Failed to load alphabetical dashboard statistics:', err);
      setError(err?.message || 'Failed to fetch alphabetical dashboard records.');
    } finally {
      setLoading(false);
    }
  }, [appliedFromDate, appliedToDate]);

  useEffect(() => {
    fetchAlphabeticalStats();
  }, [fetchAlphabeticalStats]);

  const handleApplyFilter = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAppliedFromDate(fromDateBS);
    setAppliedToDate(toDateBS);
  };

  const handleResetFilter = () => {
    setFromDateBS('');
    setToDateBS('');
    setAppliedFromDate('');
    setAppliedToDate('');
  };

  const handleSetTodayBS = () => {
    const todayBS = getNepaliDate(new Date());
    setFromDateBS(todayBS);
    setToDateBS(todayBS);
    setAppliedFromDate(todayBS);
    setAppliedToDate(todayBS);
  };

  const handlePrint = () => {
    setShowPrintModal(true);
  };

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  // Fallback initial items if data is loading or empty
  const items: AlphabeticalStatItem[] = data?.items && data.items.length > 0
    ? data.items
    : letters.map((l) => ({
        letter: l,
        label: `Alphabet ${l}`,
        count: 0,
        distributed: 0,
        remained: 0,
      }));

  const totalCount = data?.totalCount || 0;
  const totalDistributed = data?.totalDistributed || 0;
  const totalRemained = data?.totalRemained || 0;

  return (
    <div className="space-y-4">
      {/* ========================================================================= */}
      {/* 1. TOP FILTER BAR (Exact match to Picture 1 & Authentic Nepali Calendar)  */}
      {/* ========================================================================= */}
      <form
        onSubmit={handleApplyFilter}
        className="p-3 sm:p-4 rounded-xl bg-slate-50 dark:bg-[#071120] border border-slate-200 dark:border-[#17253d] shadow-sm transition-all"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          {/* Left: Date Filters in Nepali Calendar BS */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 flex-1">
            {/* From Date BS */}
            <div className="flex items-center gap-2 min-w-[210px] flex-1 sm:flex-initial">
              <label className="text-xs font-black text-slate-800 dark:text-slate-300 whitespace-nowrap uppercase tracking-wider font-mono">
                From Date (वि.सं.)
              </label>
              <div className="sm:w-44 w-full">
                <NepaliDatePicker
                  value={fromDateBS}
                  onChange={setFromDateBS}
                  placeholder="YYYY-MM-DD"
                  id="from-date-bs"
                  inputClassName="!bg-white dark:!bg-[#071120] !border-slate-300 dark:!border-slate-700 !text-slate-900 dark:!text-white font-semibold"
                />
              </div>
            </div>

            {/* To Date BS */}
            <div className="flex items-center gap-2 min-w-[210px] flex-1 sm:flex-initial">
              <label className="text-xs font-black text-slate-800 dark:text-slate-300 whitespace-nowrap uppercase tracking-wider font-mono">
                To Date (वि.सं.)
              </label>
              <div className="sm:w-44 w-full">
                <NepaliDatePicker
                  value={toDateBS}
                  onChange={setToDateBS}
                  placeholder="YYYY-MM-DD"
                  id="to-date-bs"
                  inputClassName="!bg-white dark:!bg-[#071120] !border-slate-300 dark:!border-slate-700 !text-slate-900 dark:!text-white font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Right: Action Buttons */}
          <div className="flex items-center gap-2 whitespace-nowrap">
            <button
              type="submit"
              disabled={loading}
              className="px-3.5 py-1.5 bg-[#008ba8] hover:bg-[#007790] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer"
              title="Filter Alphabetical Dashboard"
            >
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Search (खोज्नुहोस्)</span>
            </button>

            <button
              type="button"
              onClick={handleResetFilter}
              disabled={loading || (!fromDateBS && !toDateBS && !appliedFromDate && !appliedToDate)}
              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-[#12223a] dark:hover:bg-[#1a3154] border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-300 hover:text-black dark:hover:text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
              title="Reset Filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={handleSetTodayBS}
              className="hidden sm:flex px-2.5 py-1.5 bg-cyan-50 hover:bg-cyan-100 dark:bg-[#0b172a] dark:hover:bg-[#13233e] border border-cyan-400 dark:border-cyan-500/40 text-cyan-800 dark:text-cyan-300 text-xs font-bold rounded-lg items-center gap-1 transition-all active:scale-95 cursor-pointer shadow-xs"
              title="Quick Filter: Today (BS)"
            >
              <span>Today BS</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="p-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-[#12223a] dark:hover:bg-[#1a3154] border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-300 hover:text-black dark:hover:text-white rounded-lg transition-all active:scale-95 cursor-pointer"
              title="Print Alphabetical Report"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Filter Feedback Tag */}
        {(appliedFromDate || appliedToDate) && (
          <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-cyan-800 dark:text-cyan-300 font-semibold">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              <span>
                Filtered by Range:{' '}
                <strong className="text-slate-900 dark:text-white font-mono">{appliedFromDate || 'Beginning'}</strong> to{' '}
                <strong className="text-slate-900 dark:text-white font-mono">{appliedToDate || 'Current Date'}</strong>
              </span>
            </span>
            <button
              type="button"
              onClick={handleResetFilter}
              className="text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white underline cursor-pointer font-bold"
            >
              Clear Filter
            </button>
          </div>
        )}
      </form>

      {/* Error alert */}
      {error && (
        <div className="p-3 rounded-xl bg-red-100 dark:bg-red-950/60 border border-red-300 dark:border-red-700/60 text-red-900 dark:text-red-200 text-xs flex items-center justify-between font-semibold">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => fetchAlphabeticalStats()}
            className="px-2 py-1 bg-red-200 dark:bg-red-900/60 hover:bg-red-300 dark:hover:bg-red-800 rounded font-bold underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ALPHABETICAL STATS TABLE (A to Z) (Exact match to Picture 1)           */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-slate-200 dark:border-[#17253d] bg-white dark:bg-[#071120] overflow-hidden shadow-sm dark:shadow-md">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            {/* Table Header */}
            <thead>
              <tr className="bg-slate-100 dark:bg-[#050c18] border-b border-slate-200 dark:border-slate-700/80 text-[11px] font-black uppercase tracking-wider font-mono select-none">
                {/* 1. ALPHABET (वर्ण) */}
                <th className="py-2.5 px-4 text-left text-slate-900 dark:text-slate-200 border-r border-slate-200 dark:border-slate-800/80 w-[30%]">
                  ALPHABET (वर्ण)
                </th>

                {/* 2. COUNT (कुल संख्या) */}
                <th className="py-2.5 px-4 text-center text-slate-900 dark:text-slate-200 border-r border-slate-200 dark:border-slate-800/80 w-[23%]">
                  COUNT (कुल संख्या)
                </th>

                {/* 3. DISTRIBUTED (वितरित संख्या) */}
                <th className="py-2.5 px-4 text-center text-emerald-700 dark:text-emerald-400 border-r border-slate-200 dark:border-slate-800/80 w-[23%]">
                  DISTRIBUTED (वितरित संख्या)
                </th>

                {/* 4. REMAINED (बाँकी) */}
                <th className="py-2.5 px-4 text-center text-amber-700 dark:text-amber-400 w-[24%]">
                  REMAINED (बाँकी)
                </th>
              </tr>
            </thead>

            {/* Table Body (26 Rows: A to Z) */}
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70 text-[13px]">
              {loading && !data ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-600 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 text-cyan-600 dark:text-cyan-400 animate-spin" />
                      <span className="text-[13px] font-mono font-bold tracking-wide">
                        Calculating Alphabetical Aggregate Counts...
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((row) => {
                  const hasCount = row.count > 0;
                  const hasDistributed = row.distributed > 0;
                  const hasRemained = row.remained > 0;

                  return (
                    <tr
                      key={row.letter}
                      className={`transition-colors hover:bg-slate-50 dark:hover:bg-[#0c182c]/80 ${
                        hasCount ? 'bg-blue-50/40 dark:bg-[#081223]/50' : 'bg-transparent'
                      }`}
                    >
                      {/* 1. Alphabet Badge & Label */}
                      <td className="py-2 px-4 text-left border-r border-slate-200 dark:border-slate-800/80 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center font-normal text-[11px] border transition-all ${
                              hasCount
                                ? 'bg-cyan-100 border-cyan-400 text-cyan-900 dark:bg-cyan-950/80 dark:border-cyan-500/60 dark:text-cyan-300 shadow-xs'
                                : 'bg-slate-100 border-slate-300 text-slate-700 dark:bg-[#0d1b30] dark:border-slate-700/60 dark:text-slate-400'
                            }`}
                          >
                            {row.letter}
                          </span>
                          <span className="font-normal text-slate-900 dark:text-slate-200 text-[13px] tracking-wide">
                            {row.label}
                          </span>
                        </div>
                      </td>

                      {/* 2. Count (कुल संख्या) */}
                      <td className="py-2 px-4 text-center border-r border-slate-200 dark:border-slate-800/80 whitespace-nowrap">
                        {hasCount ? (
                          <span className="inline-flex items-center justify-center min-w-[36px] px-2.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/70 border border-blue-400 dark:border-blue-500/50 text-blue-900 dark:text-blue-300 text-[13px] font-normal shadow-xs">
                            {row.count.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 text-[13px] font-normal">
                            0
                          </span>
                        )}
                      </td>

                      {/* 3. Distributed (वितरित संख्या) */}
                      <td className="py-2 px-4 text-center border-r border-slate-200 dark:border-slate-800/80 whitespace-nowrap">
                        <span
                          className={`text-[13px] font-normal ${
                            hasDistributed
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {row.distributed.toLocaleString()}
                        </span>
                      </td>

                      {/* 4. Remained (बाँकी) */}
                      <td className="py-2 px-4 text-center whitespace-nowrap">
                        <span
                          className={`text-[13px] font-normal ${
                            hasRemained
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {row.remained.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Footer: TOTAL (जम्मा) (Exact match to Picture 1) */}
            <tfoot>
              <tr className="bg-slate-100 dark:bg-[#040812] border-t-2 border-slate-300 dark:border-slate-700 text-[13px] select-none">
                {/* TOTAL (जम्मा) */}
                <td className="py-3 px-4 text-left text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-800/80 tracking-wider text-[13px] font-normal">
                  TOTAL (जम्मा)
                </td>

                {/* Total Count */}
                <td className="py-3 px-4 text-center border-r border-slate-200 dark:border-slate-800/80 text-blue-700 dark:text-[#38BDF8] text-[13px] font-normal tracking-wide">
                  {totalCount.toLocaleString()}
                </td>

                {/* Total Distributed */}
                <td className="py-3 px-4 text-center border-r border-slate-200 dark:border-slate-800/80 text-emerald-700 dark:text-[#10B981] text-[13px] font-normal tracking-wide">
                  {totalDistributed.toLocaleString()}
                </td>

                {/* Total Remained */}
                <td className="py-3 px-4 text-center text-amber-700 dark:text-[#F59E0B] text-[13px] font-normal tracking-wide">
                  {totalRemained.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* PDF / Print Document Preview Modal */}
      <AlphabeticalPrintModal
        isOpen={showPrintModal}
        onClose={() => setShowPrintModal(false)}
        data={data}
        fromDate={appliedFromDate || fromDateBS}
        toDate={appliedToDate || toDateBS}
      />
    </div>
  );
};
