import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Zap,
  PlusCircle,
  FileSpreadsheet,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  Check,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  BarChart3,
  ArrowUpDown,
  Sparkles,
  Lock,
  PhoneCall,
  Edit2,
} from 'lucide-react';
import { DashboardStats, AdminActiveView, LicenseRecord } from '../../types';
import { api } from '../../services/api';
import { formatDistributedDateBS, isDistributedSameDay, canDisplayMissingButton } from '../../utils/dateUtils';
import { resolveRecordStaff, resolveSubmittedDocument, resolveSearchedByStaff } from '../../utils/staffUtils';
import { HandoverModal } from '../modals/HandoverModal';
import { LicenseDetailModal } from '../modals/LicenseDetailModal';
import { ReportMissingModal } from '../modals/ReportMissingModal';
import { ConfirmFoundModal } from '../modals/ConfirmFoundModal';
import { UpdateMobileModal } from '../modals/UpdateMobileModal';
import { AlphabeticalDashboardView } from './AlphabeticalDashboardView';
import { HistoryInput } from '../common/HistoryInput';
import { FoundCardHandoverModal } from '../modals/FoundCardHandoverModal';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, isSuperAdminUser } from '../../utils/permissions';

interface Props {
  onNavigate: (view: AdminActiveView) => void;
  onOpenUpload: () => void;
}

export const DashboardView: React.FC<Props> = ({ onNavigate, onOpenUpload }) => {
  const { user } = useAuth();
  const isSuperAdmin = isSuperAdminUser(user);
  const canViewDashboard = hasPermission(user, 'dashboard.view');
  const canViewAlphabetical = hasPermission(user, 'dashboard.alphabetical');
  const canViewTables = hasPermission(user, 'dashboard.tables');
  const canDistribute = hasPermission(user, 'records.distribute');
  const canMarkMissing = hasPermission(user, 'records.mark_missing');
  const canMarkFound = hasPermission(user, 'records.unmark_missing');
  const canLiveSync = hasPermission(user, 'cloud.sheets_sync');

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date>(new Date());

  // Submenu mode: Overview Dashboard vs Alphabetical Dashboard (Exact match to Picture 2)
  const [dashboardMode, setDashboardMode] = useState<'OVERVIEW' | 'ALPHABETICAL'>('OVERVIEW');

  // Active Topic Filter for Smart Card Dashboard (matching Picture 1 & Picture 2)
  const [activeTopic, setActiveTopic] = useState<'ALL' | 'NOT_DISTRIBUTED' | 'DISTRIBUTED' | 'MISSING' | 'FOUND' | 'HANDED_OVER'>('ALL');

  // Table State & Sorting
  const [records, setRecords] = useState<LicenseRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortBy, setSortBy] = useState<string>('sn');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Action Loading & Toast Feedback
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);

  // Modals for Actions
  const [selectedRecordForDetail, setSelectedRecordForDetail] = useState<LicenseRecord | null>(null);
  const [selectedRecordForFoundHandover, setSelectedRecordForFoundHandover] = useState<LicenseRecord | null>(null);
  const [selectedRecordForHandover, setSelectedRecordForHandover] = useState<LicenseRecord | null>(null);
  const [selectedRecordForMissing, setSelectedRecordForMissing] = useState<LicenseRecord | null>(null);
  const [selectedRecordForFound, setSelectedRecordForFound] = useState<LicenseRecord | null>(null);
  const [selectedRecordForMobile, setSelectedRecordForMobile] = useState<LicenseRecord | null>(null);

  // Set of found card IDs that have been handed over/distributed
  const [foundHandedOverIds, setFoundHandedOverIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('plsms_found_handed_over_ids');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const markFoundAsHandedOver = (recordId: string, licenseNumber?: string) => {
    setFoundHandedOverIds((prev) => {
      const next = new Set(prev);
      if (recordId) next.add(recordId);
      if (licenseNumber) next.add(licenseNumber.toUpperCase().trim());
      try {
        localStorage.setItem('plsms_found_handed_over_ids', JSON.stringify(Array.from(next)));
      } catch (_) {}
      return next;
    });
  };

  const isFoundCardHandedOver = (rec: LicenseRecord) => {
    if (!rec) return false;
    if (rec.foundHandoverDone === false) return false;
    if (rec.foundHandoverDone === true) return true;
    if (rec.rawRecord?.['FOUND_HANDOVER'] === 'DONE') return true;
    if (rec.rawRecord?.['STATUS DISTRIBUTED'] === 'DISTRIBUTED' && rec.rawRecord?.['FOUND'] === 'FOUND') return true;
    if (foundHandedOverIds.has(rec.id)) return true;
    if (rec.licenseNumber && foundHandedOverIds.has(rec.licenseNumber.toUpperCase().trim())) return true;
    if (rec.applicantId && foundHandedOverIds.has(rec.applicantId.toUpperCase().trim())) return true;
    if (rec.applicationNumber && foundHandedOverIds.has(rec.applicationNumber.toUpperCase().trim())) return true;
    return false;
  };

  const totalCardsCount = stats?.totalRecords || 0;
  const notDistributedCount = stats?.availableRecords || 0;
  const distributedCount = stats?.distributedRecords || 0;
  const missingCount = stats?.missingRecords || 0;
  const foundCount = stats?.foundRecords || 0;
  const handedOverCount = stats?.handedOverRecords ?? 0;

  const fetchStats = async (showLoading = true, retryAttempt = 0) => {
    try {
      if (showLoading && !stats) setLoadingStats(true);
      const data = await api.getDashboardStats();
      if (data) {
        setStats(data);
        setLastSyncedAt(new Date());
      }
    } catch (err: any) {
      console.warn('Dashboard stats temporarily warming up:', err?.message || err);
      // If stats haven't loaded yet, retry automatically with exponential backoff
      if (!stats && retryAttempt < 3) {
        setTimeout(() => {
          fetchStats(false, retryAttempt + 1);
        }, 1500 * (retryAttempt + 1));
      }
    } finally {
      if (showLoading) setLoadingStats(false);
    }
  };

  const handleLiveSync = async () => {
    try {
      setIsSyncing(true);
      const result = await api.liveSyncDashboard();
      if (result && result.stats) {
        setStats(result.stats);
        setLastSyncedAt(new Date());
      }
      await fetchRecords();
      setToastMessage({
        type: 'success',
        text: '✓ डाटाबेस तथा गुगल सिट ताजा स्थितिमा सिंक भयो (Live sync completed: Database & Google Sheet synchronized parallelly).',
      });
    } catch (err: any) {
      console.error('Live sync error:', err);
      setToastMessage({
        type: 'error',
        text: `Sync Error: ${err.message || 'Could not complete live sync'}`,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const fetchRecords = useCallback(async () => {
    if (!canViewTables) {
      setRecords([]);
      setTotalRecords(0);
      return;
    }
    try {
      setTableLoading(true);
      let statusParam = 'ALL';
      if (activeTopic === 'NOT_DISTRIBUTED') statusParam = 'NOT_DISTRIBUTED';
      else if (activeTopic === 'DISTRIBUTED') statusParam = 'DISTRIBUTED';
      else if (activeTopic === 'MISSING') statusParam = 'MISSING';
      else if (activeTopic === 'FOUND') statusParam = 'FOUND';
      else if (activeTopic === 'HANDED_OVER') statusParam = 'HANDED_OVER';

      const res = await api.getRecords({
        q: searchQuery.trim() || undefined,
        status: statusParam !== 'ALL' ? statusParam : undefined,
        page,
        limit: pageSize,
        sortBy,
        sortOrder,
      });

      setRecords(res.records || []);
      setTotalRecords(res.total || 0);
    } catch (err) {
      console.error('Failed to fetch dashboard table records:', err);
    } finally {
      setTableLoading(false);
    }
  }, [activeTopic, searchQuery, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    fetchStats(true);
  }, []);

  // Real-Time Automatic Synchronization & Event Bus Listener
  useEffect(() => {
    // Auto-polling interval every 6 seconds to capture any updates from other windows/Google Sheets
    const interval = setInterval(() => {
      fetchStats(false);
    }, 6000);

    const handleRecordUpdated = () => {
      fetchStats(false);
      fetchRecords();
    };

    const handleDatabaseReset = () => {
      fetchStats(true);
      fetchRecords();
    };

    const handleWindowFocus = () => {
      fetchStats(false);
      fetchRecords();
    };

    window.addEventListener('plsms:record-updated', handleRecordUpdated);
    window.addEventListener('database-reset', handleDatabaseReset);
    window.addEventListener('records-updated', handleDatabaseReset);
    window.addEventListener('google-sheets-reset', handleDatabaseReset);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleWindowFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('plsms:record-updated', handleRecordUpdated);
      window.removeEventListener('database-reset', handleDatabaseReset);
      window.removeEventListener('records-updated', handleDatabaseReset);
      window.removeEventListener('google-sheets-reset', handleDatabaseReset);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleWindowFocus);
    };
  }, [fetchRecords]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Clear toast automatically after 4 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Reset to page 1 when topic changes; auto-select recent sort when viewing Distributed or Handed Over
  const handleTopicChange = (topic: 'ALL' | 'NOT_DISTRIBUTED' | 'DISTRIBUTED' | 'MISSING' | 'FOUND' | 'HANDED_OVER') => {
    setActiveTopic(topic);
    setPage(1);
    if (topic === 'DISTRIBUTED' || topic === 'HANDED_OVER') {
      setSortBy('updatedAt');
      setSortOrder('desc');
    } else if (topic === 'ALL' || topic === 'NOT_DISTRIBUTED') {
      setSortBy('sn');
      setSortOrder('asc');
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(1);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setPage(1);
  };

  const handleHandoverSuccess = () => {
    fetchStats(false);
    fetchRecords();
    setToastMessage({
      type: 'success',
      text: '✓ स्मार्ट कार्ड सफलतापूर्वक हस्तान्तरण भयो र डाटाबेस तथा गुगल सिटमा सुरक्षित गरियो! (Handover saved and synced).',
    });
  };

  // Action Button Logic: Mark Card as MISSING
  const handleMarkAsMissing = async (record: LicenseRecord) => {
    try {
      setActionLoadingId(record.id);
      const loginUserFullName = user?.name ? user.name.trim().toUpperCase() : '';
      await api.updateStatus(record.id, {
        status: 'MISSING',
        reason: 'While Searching Not-Found in Sorted Slot',
        user: loginUserFullName,
        reportedBy: loginUserFullName,
        searchedBy: loginUserFullName,
        missingMarkedBy: loginUserFullName,
        missingMarkedSource: 'APP_BUTTON',
      });
      await fetchStats();
      await fetchRecords();
      setToastMessage({
        type: 'error',
        text: `License ${record.licenseNumber || record.applicantId || 'Record'} reported as MISSING and moved to Missing Cards register.`,
      });
    } catch (err: any) {
      console.error('Failed to mark card as missing:', err);
      setToastMessage({
        type: 'error',
        text: err?.message || 'Failed to update record status to MISSING.',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Action Button Logic: Mark Missing Card as FOUND (Opens Confirm Found Card Modal)
  const handleMarkAsFound = (record: LicenseRecord) => {
    setSelectedRecordForFound(record);
  };

  // Action Button Logic: Reinstate Found Card back to AVAILABLE shelf
  const handleReinstateToAvailable = async (record: LicenseRecord) => {
    try {
      setActionLoadingId(record.id);
      await api.updateStatus(record.id, {
        status: 'AVAILABLE',
        reason: 'Recovered card reinstated back to active shelf inventory.',
      });
      await fetchStats();
      await fetchRecords();
      setToastMessage({
        type: 'success',
        text: `License ${record.licenseNumber || record.applicantId || 'Record'} reinstated back to AVAILABLE shelf.`,
      });
    } catch (err: any) {
      console.error('Failed to reinstate record to available:', err);
      setToastMessage({
        type: 'error',
        text: err?.message || 'Failed to reinstate record.',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const totalPages = Math.ceil(totalRecords / pageSize) || 1;

  if (loadingStats && !stats) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Loading Real-Time Statistics...
          </span>
        </div>
      </div>
    );
  }

  const isDbEmpty = !stats || stats.totalRecords === 0;
  const isMissingOrFoundView = activeTopic === 'MISSING' || activeTopic === 'FOUND';

  return (
    <div className="space-y-4">
      {/* Smart Card Dashboard Title */}
      <div className="text-center py-1">
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 dark:text-white tracking-widest uppercase font-mono drop-shadow-sm transition-colors">
          SMART CARD DASHBOARD
        </h1>
      </div>

      {/* Dashboard Submenu Navigation (Exact match to Picture 2) */}
      <div className="flex justify-center my-1">
        <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#071120] border border-slate-300 dark:border-[#17253d] w-full max-w-xl shadow-xs">
          {/* Button 1: OVERVIEW DASHBOARD */}
          <button
            type="button"
            onClick={() => setDashboardMode('OVERVIEW')}
            className={`flex-1 py-2 px-3 sm:px-4 rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer select-none ${
              dashboardMode === 'OVERVIEW'
                ? 'bg-[#008ba8] text-white shadow-sm ring-1 ring-cyan-400/40'
                : 'text-slate-700 hover:text-black hover:bg-slate-200/70 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/40'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-cyan-200" />
            <span>OVERVIEW DASHBOARD</span>
          </button>

          {/* Button 2: ALPHABETICAL DASHBOARD */}
          <button
            type="button"
            onClick={() => setDashboardMode('ALPHABETICAL')}
            className={`flex-1 py-2 px-3 sm:px-4 rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer select-none ${
              dashboardMode === 'ALPHABETICAL'
                ? 'bg-[#008ba8] text-white shadow-sm ring-1 ring-cyan-400/40'
                : 'text-slate-700 hover:text-black hover:bg-slate-200/70 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/40'
            }`}
          >
            <span className="w-5 h-5 rounded bg-blue-600/70 text-white font-mono font-black text-[10px] flex items-center justify-center border border-blue-400/50">
              abc
            </span>
            <span>ALPHABETICAL DASHBOARD</span>
          </button>
        </div>
      </div>

      {/* Action Toast Alert Banner */}
      {toastMessage && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold transition-all shadow-sm ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-[#062c20] border-emerald-300 dark:border-emerald-600 text-emerald-800 dark:text-emerald-200'
              : toastMessage.type === 'error'
              ? 'bg-red-50 dark:bg-red-950/60 border-red-300 dark:border-red-600 text-red-800 dark:text-red-200'
              : 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-600 text-blue-800 dark:text-blue-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />}
            {toastMessage.type === 'error' && <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />}
            {toastMessage.type === 'info' && <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
            <span>{toastMessage.text}</span>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-current"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Render Alphabetical Dashboard View when selected */}
      {dashboardMode === 'ALPHABETICAL' ? (
        <AlphabeticalDashboardView onRefreshStats={fetchStats} />
      ) : (
        <>
      {/* ========================================================================= */}
      {/* SMART CARD DASHBOARD: 6 ACTIVE BUTTON PANELS                              */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. TOTAL SMART CARDS */}
        <button
          type="button"
          onClick={() => handleTopicChange('ALL')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#08101E] border text-center flex flex-col justify-center items-center space-y-1.5 transition-all shadow-xs hover:shadow-sm active:scale-[0.98] cursor-pointer ${
            activeTopic === 'ALL'
              ? 'border-2 border-blue-600 ring-2 ring-blue-500/20 dark:ring-blue-500/40 bg-blue-50/50 dark:bg-[#08101E]'
              : 'border-slate-200 dark:border-[#17253d] hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-[#0d1b33]'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight font-mono">
            TOTAL SMART CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
            {totalCardsCount.toLocaleString()}
          </span>
        </button>

        {/* 2. NOT-DISTRIBUTED CARDS */}
        <button
          type="button"
          onClick={() => handleTopicChange('NOT_DISTRIBUTED')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#08101E] border text-center flex flex-col justify-center items-center space-y-1.5 transition-all shadow-xs hover:shadow-sm active:scale-[0.98] cursor-pointer ${
            activeTopic === 'NOT_DISTRIBUTED'
              ? 'border-2 border-emerald-600 ring-2 ring-emerald-500/20 dark:ring-emerald-500/40 bg-emerald-50/50 dark:bg-[#08101E]'
              : 'border-slate-200 dark:border-[#17253d] hover:border-emerald-400 hover:bg-slate-50 dark:hover:bg-[#0d1b33]'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-emerald-700 dark:text-[#10B981] uppercase tracking-tight font-mono">
            NOT -DISTRIBUTED CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-emerald-700 dark:text-[#10B981] font-mono">
            {notDistributedCount.toLocaleString()}
          </span>
        </button>

        {/* 3. DISTRIBUTED CARDS */}
        <button
          type="button"
          onClick={() => handleTopicChange('DISTRIBUTED')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#08101E] border text-center flex flex-col justify-center items-center space-y-1.5 transition-all shadow-xs hover:shadow-sm active:scale-[0.98] cursor-pointer ${
            activeTopic === 'DISTRIBUTED'
              ? 'border-2 border-sky-600 dark:border-sky-400 ring-2 ring-sky-500/20 dark:ring-sky-400/40 bg-sky-50/50 dark:bg-[#08101E]'
              : 'border-slate-200 dark:border-[#17253d] hover:border-sky-400 hover:bg-slate-50 dark:hover:bg-[#0d1b33]'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-sky-700 dark:text-[#38BDF8] uppercase tracking-tight font-mono">
            DISTRIBUTED CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-sky-700 dark:text-[#38BDF8] font-mono">
            {distributedCount.toLocaleString()}
          </span>
        </button>

        {/* 4. MISSING CARDS */}
        <button
          type="button"
          onClick={() => handleTopicChange('MISSING')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#08101E] border text-center flex flex-col justify-center items-center space-y-1.5 transition-all shadow-xs hover:shadow-sm active:scale-[0.98] cursor-pointer ${
            activeTopic === 'MISSING'
              ? 'border-2 border-rose-600 ring-2 ring-rose-500/20 dark:ring-rose-500/40 bg-rose-50/50 dark:bg-[#08101E]'
              : 'border-slate-200 dark:border-[#17253d] hover:border-rose-400 hover:bg-slate-50 dark:hover:bg-[#0d1b33]'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-rose-700 dark:text-[#F87171] uppercase tracking-tight font-mono">
            MISSING CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-rose-700 dark:text-[#F87171] font-mono">
            {missingCount.toLocaleString()}
          </span>
        </button>

        {/* 5. FOUND CARDS */}
        <button
          type="button"
          onClick={() => handleTopicChange('FOUND')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#08101E] border text-center flex flex-col justify-center items-center space-y-1.5 transition-all shadow-xs hover:shadow-sm active:scale-[0.98] cursor-pointer ${
            activeTopic === 'FOUND'
              ? 'border-2 border-purple-600 ring-2 ring-purple-500/20 dark:ring-purple-500/40 bg-purple-50/50 dark:bg-[#08101E]'
              : 'border-slate-200 dark:border-[#17253d] hover:border-purple-400 hover:bg-slate-50 dark:hover:bg-[#0d1b33]'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-purple-700 dark:text-[#C084FC] uppercase tracking-tight font-mono">
            FOUND CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-purple-700 dark:text-[#C084FC] font-mono">
            {foundCount.toLocaleString()}
          </span>
        </button>

        {/* 6. HANDED OVER CARDS */}
        <button
          type="button"
          onClick={() => handleTopicChange('HANDED_OVER')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#08101E] border text-center flex flex-col justify-center items-center space-y-1.5 transition-all shadow-xs hover:shadow-sm active:scale-[0.98] cursor-pointer ${
            activeTopic === 'HANDED_OVER'
              ? 'border-2 border-teal-600 ring-2 ring-teal-500/20 dark:ring-teal-500/40 bg-teal-50/50 dark:bg-[#08101E]'
              : 'border-slate-200 dark:border-[#17253d] hover:border-teal-400 hover:bg-slate-50 dark:hover:bg-[#0d1b33]'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-teal-700 dark:text-[#2DD4BF] uppercase tracking-tight font-mono">
            HANDED OVER CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-teal-700 dark:text-[#2DD4BF] font-mono">
            {handedOverCount.toLocaleString()}
          </span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TOPIC TABS (Matching Picture 1 & Picture 2)                               */}
      {/* ========================================================================= */}
      <div className="space-y-4 pt-1">
        {/* Topic-Wise Active Linked Tabs */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-6 border-b border-slate-200 dark:border-[#1e2d4a] pb-1">
          {/* TAB 1: TOTAL SMART CARDS */}
          <button
            type="button"
            onClick={() => handleTopicChange('ALL')}
            className={`pb-2.5 text-sm sm:text-[14px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all relative cursor-pointer ${
              activeTopic === 'ALL'
                ? 'text-slate-900 dark:text-white font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>TOTAL SMART CARDS</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold transition-colors ${
              activeTopic === 'ALL'
                ? 'bg-blue-100 text-blue-800 dark:bg-[#1e293b] dark:text-slate-300'
                : 'bg-slate-100 text-slate-700 dark:bg-[#1e293b]/70 dark:text-slate-400'
            }`}>
              {totalCardsCount.toLocaleString()}
            </span>
            {activeTopic === 'ALL' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EF4444] rounded-full" />
            )}
          </button>

          {/* TAB 2: NOT-DISTRIBUTED CARDS */}
          <button
            type="button"
            onClick={() => handleTopicChange('NOT_DISTRIBUTED')}
            className={`pb-2.5 text-sm sm:text-[14px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all relative cursor-pointer ${
              activeTopic === 'NOT_DISTRIBUTED'
                ? 'text-slate-900 dark:text-white font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>NOT -DISTRIBUTED CARDS</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold transition-colors ${
              activeTopic === 'NOT_DISTRIBUTED'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-[#1e293b] dark:text-emerald-300'
                : 'bg-slate-100 text-slate-700 dark:bg-[#1e293b]/70 dark:text-slate-400'
            }`}>
              {notDistributedCount.toLocaleString()}
            </span>
            {activeTopic === 'NOT_DISTRIBUTED' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EF4444] rounded-full" />
            )}
          </button>

          {/* TAB 3: DISTRIBUTED CARDS */}
          <button
            type="button"
            onClick={() => handleTopicChange('DISTRIBUTED')}
            className={`pb-2.5 text-sm sm:text-[14px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all relative cursor-pointer ${
              activeTopic === 'DISTRIBUTED'
                ? 'text-slate-900 dark:text-white font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>DISTRIBUTED CARDS</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold transition-colors ${
              activeTopic === 'DISTRIBUTED'
                ? 'bg-sky-100 text-sky-800 dark:bg-[#1e293b] dark:text-blue-300'
                : 'bg-slate-100 text-slate-700 dark:bg-[#1e293b]/70 dark:text-slate-400'
            }`}>
              {distributedCount.toLocaleString()}
            </span>
            {activeTopic === 'DISTRIBUTED' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EF4444] rounded-full" />
            )}
          </button>

          {/* TAB 4: MISSING CARDS */}
          <button
            type="button"
            onClick={() => handleTopicChange('MISSING')}
            className={`pb-2.5 text-sm sm:text-[14px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all relative cursor-pointer ${
              activeTopic === 'MISSING'
                ? 'text-slate-900 dark:text-white font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>MISSING CARDS</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold transition-colors ${
              activeTopic === 'MISSING'
                ? 'bg-rose-100 text-rose-800 dark:bg-[#1e293b] dark:text-rose-300'
                : 'bg-slate-100 text-slate-700 dark:bg-[#1e293b]/70 dark:text-slate-400'
            }`}>
              {missingCount.toLocaleString()}
            </span>
            {activeTopic === 'MISSING' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EF4444] rounded-full" />
            )}
          </button>

          {/* TAB 5: FOUND CARDS */}
          <button
            type="button"
            onClick={() => handleTopicChange('FOUND')}
            className={`pb-2.5 text-sm sm:text-[14px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all relative cursor-pointer ${
              activeTopic === 'FOUND'
                ? 'text-slate-900 dark:text-white font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>FOUND CARDS</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold transition-colors ${
              activeTopic === 'FOUND'
                ? 'bg-purple-100 text-purple-800 dark:bg-[#1e293b] dark:text-purple-300'
                : 'bg-slate-100 text-slate-700 dark:bg-[#1e293b]/70 dark:text-slate-400'
            }`}>
              {foundCount.toLocaleString()}
            </span>
            {activeTopic === 'FOUND' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EF4444] rounded-full" />
            )}
          </button>

          {/* TAB 6: HANDED OVER CARDS */}
          <button
            type="button"
            onClick={() => handleTopicChange('HANDED_OVER')}
            className={`pb-2.5 text-sm sm:text-[14px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all relative cursor-pointer ${
              activeTopic === 'HANDED_OVER'
                ? 'text-slate-900 dark:text-white font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>HANDED OVER CARDS</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold transition-colors ${
              activeTopic === 'HANDED_OVER'
                ? 'bg-teal-100 text-teal-800 dark:bg-[#1e293b] dark:text-teal-300'
                : 'bg-slate-100 text-slate-700 dark:bg-[#1e293b]/70 dark:text-slate-400'
            }`}>
              {handedOverCount.toLocaleString()}
            </span>
            {activeTopic === 'HANDED_OVER' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#EF4444] rounded-full" />
            )}
          </button>
        </div>

        {/* Search, Sort & Live Sync Action Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
          {/* Search Bar with History Autocomplete */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 z-10">
              <Search className="w-4 h-4" />
            </div>
            <HistoryInput
              historyKey="dashboard_search"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={
                isMissingOrFoundView
                  ? 'Filter current register by name, license number, or applicant code...'
                  : 'Enter License Number or Applicant ID...'
              }
              className="w-full bg-white dark:bg-[#08101E] border border-slate-200 dark:border-[#1e2d4a] text-slate-900 dark:text-white rounded-xl px-10 py-2.5 text-xs sm:text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 transition-colors shadow-xs"
            />
          </div>

          {/* Sort Selection Dropdown */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={`${sortBy}_${sortOrder}`}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'recent') {
                    setSortBy('updatedAt');
                    setSortOrder('desc');
                  } else if (val === 'sn_asc') {
                    setSortBy('sn');
                    setSortOrder('asc');
                  } else if (val === 'sn_desc') {
                    setSortBy('sn');
                    setSortOrder('desc');
                  } else if (val === 'app_asc') {
                    setSortBy('applicantId');
                    setSortOrder('asc');
                  } else if (val === 'name_asc') {
                    setSortBy('holderName');
                    setSortOrder('asc');
                  } else if (val === 'lic_asc') {
                    setSortBy('licenseNumber');
                    setSortOrder('asc');
                  }
                  setPage(1);
                }}
                className="bg-white dark:bg-[#08101E] border border-slate-200 dark:border-[#1e2d4a] text-slate-800 dark:text-slate-200 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-semibold focus:outline-none focus:border-blue-500 cursor-pointer shadow-xs"
              >
                <option value="sn_asc">क्रम: क्र.सं. १..N (S.N. 1..N)</option>
                <option value="recent">हालै वितरण गरिएको पहिले (Recently Distributed First)</option>
                <option value="sn_desc">क्रम: क्र.सं. अन्त्य देखि (S.N. N..1)</option>
                <option value="app_asc">आवेदन नम्बर (Applicant ID)</option>
                <option value="name_asc">पुरा नाम (Full Name A..Z)</option>
                <option value="lic_asc">लाइसेन्स नम्बर (License No.)</option>
              </select>
            </div>

            {/* Live Sync Button */}
            {canLiveSync && (
              <button
                type="button"
                disabled={isSyncing}
                onClick={handleLiveSync}
                className="px-3.5 py-2.5 rounded-xl bg-[#008ba8] hover:bg-[#00768f] text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                title="Real-Time Database & Google Sheet Sync"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'सिंक हुँदैछ...' : 'Live Sync'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Sync Status Banner / Last Synced Timestamp */}
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>लाइभ डाटाबेस तथा सिट सिंक सक्रिय (Live auto-sync active)</span>
          </div>
          <div className="font-mono text-[11px]">
            ताजा सिंक: {lastSyncedAt.toLocaleTimeString()}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* DATA TABLE (Refined Theme Colors & Increased Font Sizes)                */}
        {/* ========================================================================= */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-[#1e2d4a] bg-white dark:bg-[#030914] shadow-xs dark:shadow-xl">
          <table className="w-full text-left border-collapse min-w-[900px]">
            {/* Table Header with Refined Slate/Charcoal Colors and Crisp Contrast */}
            <thead className="bg-slate-100 dark:bg-[#0c1626] border-b-2 border-slate-300 dark:border-[#1e2d4a]">
              {activeTopic === 'MISSING' ? (
                /* =================================================================== */
                /* MISSING CARDS TABLE: 10 COLUMNS (WITH MISSING MARKED BY)            */
                /* =================================================================== */
                <tr>
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

                  {/* 3. LICENSE NUMBER */}
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      LICENSE NUMBER
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (लाइसेन्स नम्बर)
                    </div>
                  </th>

                  {/* 4. FULL NAME */}
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      FULL NAME
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (पूरा नाम)
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

                  {/* 6. MISSING MARKED BY */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      MISSING MARKED BY
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (हराएको जनाउने)
                    </div>
                  </th>

                  {/* 7. MOBILE NUMBER */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      MOBILE NUMBER
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (मोबाईल)
                    </div>
                  </th>

                  {/* 8. MISSING DATE */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      MISSING DATE
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (हराएको मिति)
                    </div>
                  </th>

                  {/* 9. STATUS */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      STATUS
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (स्थिति)
                    </div>
                  </th>

                  {/* 10. ACTIONS */}
                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      ACTIONS
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (कार्य)
                    </div>
                  </th>
                </tr>
              ) : activeTopic === 'ALL' ? (
                /* =================================================================== */
                /* TOTAL SMART CARD TABLE: 2-TIER STATUS HEADER (PICTURE 1 EXACT)      */
                /* =================================================================== */
                <>
                  <tr>
                    {/* 1. S.N. */}
                    <th rowSpan={2} className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 w-12 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        S.N.
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (क्र.सं.)
                      </div>
                    </th>

                    {/* 2. APPLICANT ID */}
                    <th rowSpan={2} className="py-2 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        APPLICANT ID
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (आवेदन नम्बर)
                      </div>
                    </th>

                    {/* 3. FULL NAME */}
                    <th rowSpan={2} className="py-2 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        FULL NAME
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (पुरा नाम)
                      </div>
                    </th>

                    {/* 4. LICENSE NUMBER */}
                    <th rowSpan={2} className="py-2 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        LICENSE NUMBER
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (लाइसेन्स नम्बर)
                      </div>
                    </th>

                    {/* 5. CATEGORY */}
                    <th rowSpan={2} className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 w-20 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        CATEGORY
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (वर्ग)
                      </div>
                    </th>

                    {/* 6. SUBMITTED DOC. */}
                    <th rowSpan={2} className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        SUBMITTED DOC.
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (पेश गरिएको कागजात)
                      </div>
                    </th>

                    {/* 7. DISTRIBUTED BY */}
                    <th rowSpan={2} className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        DISTRIBUTED BY
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (वितरण गर्ने कर्मचारी)
                      </div>
                    </th>

                    {/* 8. DISTRIBUTED TO */}
                    <th rowSpan={2} className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        DISTRIBUTED TO
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (बुझिलिनेको नाम)
                      </div>
                    </th>

                    {/* 9. DISTRIBUTION DATE */}
                    <th rowSpan={2} className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        DISTRIBUTION DATE
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (वितरण मिति BS)
                      </div>
                    </th>

                    {/* 10. MERGED STATUS HEADER (Matching Picture 2 styling) */}
                    <th colSpan={3} className="py-1.5 px-3 text-center border-b border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                      <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                        STATUS
                      </div>
                      <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                        (स्थिति)
                      </div>
                    </th>
                  </tr>

                  {/* SUB-HEADER ROW FOR STATUS: DISTRIBUTED | MISSING | FOUND */}
                  <tr className="border-b-2 border-slate-300 dark:border-[#1e2d4a]">
                    <th className="py-1 px-2.5 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap text-center text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                      DISTRIBUTED
                    </th>
                    <th className="py-1 px-2.5 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap text-center text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                      MISSING
                    </th>
                    <th className="py-1 px-2.5 text-center whitespace-nowrap text-center text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                      FOUND
                    </th>
                  </tr>
                </>
              ) : activeTopic === 'FOUND' || activeTopic === 'HANDED_OVER' ? (
                /* =================================================================== */
                /* FOUND & HANDED OVER SMART CARDS TABLE (13 COLUMNS)                  */
                /* =================================================================== */
                <tr>
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

                  {/* 6. MISSING DATE (हराएको मिति) */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      MISSING DATE
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (हराएको मिति)
                    </div>
                  </th>

                  {/* 7. FOUND DATE (फेला परेको मिति) */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      FOUND DATE
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (फेला परेको मिति)
                    </div>
                  </th>

                  {/* 8. SUBMITTED DOC. */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      SUBMITTED DOC.
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (पेश गरिएको कागजात)
                    </div>
                  </th>

                  {/* 9. DISTRIBUTED BY */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      DISTRIBUTED BY
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (वितरण गर्ने कर्मचारी)
                    </div>
                  </th>

                  {/* 10. DISTRIBUTED TO */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      DISTRIBUTED TO
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (बुझिलिनेको नाम)
                    </div>
                  </th>

                  {/* 11. DISTRIBUTION DATE */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      DISTRIBUTION DATE
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (वितरण मिति BS)
                    </div>
                  </th>

                  {/* 12. STATUS */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      STATUS
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (स्थिति)
                    </div>
                  </th>

                  {/* 13. ACTIONS */}
                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      ACTIONS
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (कार्य)
                    </div>
                  </th>
                </tr>
              ) : (
                /* =================================================================== */
                /* DEFAULT REGISTER COLUMNS (NOT-DISTRIBUTED, DISTRIBUTED, FOUND)      */
                /* =================================================================== */
                <tr>
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

                  {/* 10. STATUS / ACTIONS */}
                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      STATUS / ACTIONS
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (स्थिति / कार्य)
                    </div>
                  </th>
                </tr>
              )}
            </thead>

            {/* Table Body with Alternating Clean Neutral Pattern */}
            <tbody className="divide-y divide-slate-200 dark:divide-[#1e2d4a]/70">
              {tableLoading ? (
                <tr>
                  <td colSpan={activeTopic === 'FOUND' || activeTopic === 'HANDED_OVER' ? 13 : activeTopic === 'ALL' ? 12 : activeTopic === 'MISSING' ? 10 : 10} className="py-8 text-center bg-white dark:bg-[#030914]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Loading Smart Cards Table...
                      </span>
                    </div>
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={activeTopic === 'FOUND' || activeTopic === 'HANDED_OVER' ? 13 : activeTopic === 'ALL' ? 12 : activeTopic === 'MISSING' ? 10 : 10} className="py-8 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-[#030914]">
                    <div className="text-sm font-medium">No records found matching current criteria.</div>
                    {searchQuery && (
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                        Try searching with a different license number or applicant ID.
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                records.map((record, index) => {
                  const serialNumber = (page - 1) * pageSize + (index + 1);
                  const isMissing =
                    record.status === 'MISSING' ||
                    record.issueFlag === 'MISSING' ||
                    record.rawRecord?.['MISSING'] === 'MISSING';
                  const isFound =
                    !isMissing &&
                    (record.status === 'FOUND' ||
                      Boolean(record.foundReason) ||
                      Boolean(record.foundDate) ||
                      record.rawRecord?.['FOUND'] === 'FOUND');
                  const isDistributed =
                    !isMissing &&
                    (record.status === 'DISTRIBUTED' || record.isDistributed || isFound);
                  const categoryValue = record.category || record.vehicleClass || 'A';
                  const applicantIdValue = record.applicantId || record.applicationNumber || '---';
                  const holderNameValue = record.holderName || '---';
                  const licenseNumberValue = record.licenseNumber || '---';

                  const rawMobile =
                    record.phone ||
                    record.receiverPhone ||
                    record.rawRecord?.['PHONE'] ||
                    record.rawRecord?.['MOBILE'] ||
                    record.rawRecord?.['Mobile'] ||
                    record.rawRecord?.['MOBILE NUMBER'] ||
                    record.rawRecord?.['CONTACT'] ||
                    record.rawRecord?.['Mobile Number'] ||
                    '';
                  const cleanMobileDigits = rawMobile.replace(/\D/g, '').slice(0, 10);
                  const mobileNumberValue =
                    cleanMobileDigits.length >= 7
                      ? cleanMobileDigits
                      : rawMobile.trim()
                      ? rawMobile.trim()
                      : '---';

                  const missingDateValue =
                    record.missingDate ||
                    record.rawRecord?.['MISSING DATE'] ||
                    record.rawRecord?.['MISSING_DATE'] ||
                    record.rawRecord?.['Missing Date'] ||
                    record.rawRecord?.['हराएको मिति'] ||
                    (record.missingReportedAt ? formatDistributedDateBS(record.missingReportedAt) : '') ||
                    '---';

                  const foundDateValue =
                    record.foundDate ||
                    record.rawRecord?.['FOUND DATE'] ||
                    record.rawRecord?.['FOUND_DATE'] ||
                    record.rawRecord?.['Found Date'] ||
                    record.rawRecord?.['फेला परेको मिति'] ||
                    (record.foundReportedAt ? formatDistributedDateBS(record.foundReportedAt) : '') ||
                    '---';

                  // Thorough distribution date resolution from all database sources
                  let rawDistDate =
                    record.distributedDate ||
                    record.distributedAt ||
                    (isFound ? record.foundDate || record.foundReportedAt : undefined) ||
                    record.rawRecord?.['DISTRIBUTED DATE'] ||
                    record.rawRecord?.['DISTRIBUTION DATE'] ||
                    record.rawRecord?.['DISTRIBUTED_DATE'] ||
                    record.rawRecord?.['Distribution Date'] ||
                    record.rawRecord?.['Handover Date'] ||
                    record.rawRecord?.['वितरण मिति'];

                  if ((!rawDistDate || rawDistDate === '---' || rawDistDate === '<N/A>') && isFound) {
                    rawDistDate = foundDateValue !== '---' ? foundDateValue : undefined;
                  }

                  const distributedDateValue =
                    rawDistDate && rawDistDate !== '---' && rawDistDate !== '<N/A>'
                      ? formatDistributedDateBS(rawDistDate)
                      : isDistributed
                      ? '<N/A>'
                      : '---';

                  // Thorough submitted document resolution using centralized helper
                  const docResolved = resolveSubmittedDocument(record);
                  const submittedDocValue =
                    docResolved && docResolved !== '<N/A>' && docResolved !== '---'
                      ? docResolved
                      : isDistributed || isFound
                      ? '<N/A>'
                      : '---';

                  // Thorough distributed to / receiver name resolution from all database sources
                  let rawDistributedTo =
                    record.receivedBy ||
                    record.receiverName ||
                    record.rawRecord?.['DISTRIBUTED TO'] ||
                    record.rawRecord?.['RECEIVED BY'] ||
                    record.rawRecord?.['DISTRIBUTED_TO'] ||
                    record.rawRecord?.['RECEIVED_BY'] ||
                    record.rawRecord?.['Receiver Name'] ||
                    record.rawRecord?.['Received By'] ||
                    record.rawRecord?.['बुझिलिनेको नाम'];

                  if ((!rawDistributedTo || rawDistributedTo === '---' || rawDistributedTo === '<N/A>') && record.foundReason?.includes('Received by:')) {
                    const match = record.foundReason.match(/Received by:\s*([^.]+)/i);
                    if (match && match[1]?.trim()) rawDistributedTo = match[1].trim();
                  }
                  if ((!rawDistributedTo || rawDistributedTo === '---' || rawDistributedTo === '<N/A>') && (isDistributed || isFound)) {
                    rawDistributedTo = record.holderName || '<N/A>';
                  }

                  const distributedToValue =
                    rawDistributedTo && rawDistributedTo.trim() && rawDistributedTo !== '---' && rawDistributedTo !== '<N/A>'
                      ? rawDistributedTo.trim()
                      : isDistributed
                      ? '<N/A>'
                      : '---';

                  const distributedByValue = resolveRecordStaff(record);
                  const missingMarkedByValue = resolveSearchedByStaff(record);

                  // Alternating clean row background (White / Very Subtle Slate)
                  const isOddRow = index % 2 === 1;
                  const rowBgClass = isOddRow
                    ? 'bg-slate-50/75 dark:bg-[#08101e]/60'
                    : 'bg-white dark:bg-[#030914]';

                  if (activeTopic === 'MISSING') {
                    /* =================================================================== */
                    /* MISSING CARDS ROW (10 COLUMNS: MISSING MARKED BY + MISSING DATE)    */
                    /* =================================================================== */
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

                        {/* 3. LICENSE NUMBER */}
                        <td className="py-2 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 text-blue-900 dark:text-blue-300 text-[13px] font-normal whitespace-nowrap">
                          {licenseNumberValue}
                        </td>

                        {/* 4. FULL NAME */}
                        <td className="py-2 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-900 dark:text-white text-[13px] font-normal uppercase tracking-normal whitespace-nowrap">
                          {holderNameValue}
                        </td>

                        {/* 5. CATEGORY (Badge Pill) */}
                        <td className="py-2 px-2.5 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                          <span className="px-2.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-[13px] font-normal inline-block shadow-2xs">
                            {categoryValue}
                          </span>
                        </td>

                        {/* 6. MISSING MARKED BY */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-900 dark:text-slate-100 text-[13px] font-normal whitespace-nowrap">
                          {missingMarkedByValue === '-----' ? (
                            <span className="font-mono text-slate-500 dark:text-slate-400 font-bold tracking-widest">-----</span>
                          ) : (
                            <span className="font-semibold uppercase">{missingMarkedByValue}</span>
                          )}
                        </td>

                        {/* 7. MOBILE NUMBER */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                          {mobileNumberValue !== '---' ? (
                            <div className="inline-flex items-center justify-center gap-1.5 font-mono text-[13px] text-slate-800 dark:text-slate-100">
                              {isSuperAdmin ? (
                                <>
                                  <a
                                    href={`tel:${mobileNumberValue}`}
                                    className="font-bold text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline cursor-pointer"
                                    title={`Call ${holderNameValue} at ${mobileNumberValue} for card handover`}
                                  >
                                    {mobileNumberValue}
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedRecordForMobile(record)}
                                    className="p-1 text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 rounded transition-colors cursor-pointer ml-0.5"
                                    title="Update contact mobile number (Super Admin only)"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                </>
                              ) : (
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {mobileNumberValue}
                                </span>
                              )}
                            </div>
                          ) : isSuperAdmin ? (
                            <button
                              type="button"
                              onClick={() => setSelectedRecordForMobile(record)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-300 dark:border-amber-600/50 text-amber-800 dark:text-amber-300 text-[11px] font-bold tracking-tight cursor-pointer shadow-2xs transition-all animate-pulse"
                              title="Mobile number is compulsory to call cardholder when found. Click to enter mobile number (Super Admin only)."
                            >
                              <PhoneCall className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                              <span>+ Add Mobile (Compulsory)</span>
                            </button>
                          ) : (
                            <span className="font-mono text-slate-400 dark:text-slate-500 text-xs">
                              ---
                            </span>
                          )}
                        </td>

                        {/* 8. MISSING DATE */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-700 dark:text-slate-300 text-[13px] font-normal whitespace-nowrap">
                          {missingDateValue}
                        </td>

                        {/* 9. STATUS */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                          <span className="px-3 py-1 rounded bg-[#DC2626] text-white text-[13px] font-normal tracking-wider uppercase shadow-2xs">
                            MISSING
                          </span>
                        </td>

                        {/* 10. ACTIONS (FOUND) */}
                        <td className="py-2 px-3 text-center whitespace-nowrap">
                          {canMarkFound ? (
                            <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                disabled={actionLoadingId === record.id}
                                onClick={() => handleMarkAsFound(record)}
                                className="px-3 py-1 bg-purple-600 hover:bg-purple-500 border border-purple-400 text-white rounded text-[13px] font-normal flex items-center gap-1.5 transition-all shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer"
                                title="Mark as Found / Recovered"
                              >
                                {actionLoadingId === record.id ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                )}
                                <span>FOUND</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600 font-mono text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  }

                  /* =================================================================== */
                  /* FOUND & HANDED OVER SMART CARDS ROW RENDERING (13 COLUMNS)         */
                  /* =================================================================== */
                  if (activeTopic === 'FOUND' || activeTopic === 'HANDED_OVER') {
                    const isHandedOver = activeTopic === 'HANDED_OVER' ? true : isFoundCardHandedOver(record);

                    // Columns 8-11 show the official handover/distribution details once handed over
                    const submittedDocDisplay = isHandedOver
                      ? (record.submittedDocument || record.rawRecord?.['SUBMITTED DOC.'] || resolveSubmittedDocument(record) || '-------')
                      : '-------';

                    const distributedByDisplay = isHandedOver
                      ? (record.distributedBy || record.rawRecord?.['DISTRIBUTED BY'] || resolveRecordStaff(record) || '-------')
                      : '-------';

                    const distributedToDisplay = isHandedOver
                      ? (record.receiverName || record.receivedBy || record.rawRecord?.['DISTRIBUTED TO'] || record.holderName || '-------')
                      : '-------';

                    const distributedDateDisplay = isHandedOver
                      ? (record.distributedDate
                          ? formatDistributedDateBS(record.distributedDate)
                          : record.distributedAt
                          ? formatDistributedDateBS(record.distributedAt)
                          : record.rawRecord?.['DISTRIBUTED DATE']
                          ? formatDistributedDateBS(record.rawRecord['DISTRIBUTED DATE'])
                          : '-------')
                      : '-------';

                    return (
                      <tr
                        key={record.id || index}
                        className={`${rowBgClass} hover:bg-purple-50/60 dark:hover:bg-purple-950/30 transition-colors group border-b border-slate-200 dark:border-[#1e2d4a]/70`}
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
                          <div>
                            <span>{holderNameValue}</span>
                            {mobileNumberValue !== '---' && (
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5 font-normal lowercase">
                                <PhoneCall className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span>{mobileNumberValue}</span>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 4. LICENSE NUMBER */}
                        <td className="py-2 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 text-blue-900 dark:text-blue-300 text-[13px] font-normal whitespace-nowrap">
                          {licenseNumberValue}
                        </td>

                        {/* 5. CATEGORY */}
                        <td className="py-2 px-2.5 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                          <span className="px-2.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-[13px] font-normal inline-block shadow-2xs">
                            {categoryValue}
                          </span>
                        </td>

                        {/* 6. MISSING DATE (हराएको मिति) */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-800 dark:text-slate-200 text-[13px] font-normal whitespace-nowrap font-mono">
                          {missingDateValue}
                        </td>

                        {/* 7. FOUND DATE (फेला परेको मिति) */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-800 dark:text-slate-200 text-[13px] font-normal whitespace-nowrap font-mono">
                          {foundDateValue}
                        </td>

                        {/* 8. SUBMITTED DOC. */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-700 dark:text-slate-300 text-[13px] font-normal whitespace-nowrap font-mono">
                          {submittedDocDisplay}
                        </td>

                        {/* 9. DISTRIBUTED BY */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-900 dark:text-slate-100 text-[13px] font-normal uppercase whitespace-nowrap font-mono">
                          {distributedByDisplay}
                        </td>

                        {/* 10. DISTRIBUTED TO */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-900 dark:text-slate-100 text-[13px] font-normal uppercase whitespace-nowrap font-mono">
                          {distributedToDisplay}
                        </td>

                        {/* 11. DISTRIBUTION DATE */}
                        <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-800 dark:text-slate-200 text-[13px] font-normal whitespace-nowrap font-mono">
                          {distributedDateDisplay}
                        </td>

                        {/* 12. STATUS (स्थिति) */}
                        <td className="py-2 px-2.5 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                          {activeTopic === 'HANDED_OVER' ? (
                            <div
                              className="inline-flex flex-row items-center justify-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-100 dark:bg-[#062c20] border border-emerald-400 dark:border-emerald-500/40 text-emerald-800 dark:text-[#10B981] text-[13px] font-normal uppercase tracking-tight shadow-2xs whitespace-nowrap shrink-0 select-none cursor-default"
                              title="Handed Over from Found Cards (हस्तान्तरण भइसकेको)"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-[#10B981] shrink-0" />
                              <span>HANDOVERED</span>
                            </div>
                          ) : (
                            <div className="inline-flex flex-row items-center justify-center gap-1 px-2.5 py-0.5 rounded bg-purple-600 dark:bg-purple-600 border border-purple-400 dark:border-purple-400 text-white dark:text-white text-[13px] font-normal uppercase tracking-tight shadow-xs whitespace-nowrap shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white animate-pulse shrink-0" />
                              <span>FOUND</span>
                            </div>
                          )}
                        </td>

                        {/* 13. ACTIONS (कार्य) */}
                        <td className="py-2 px-2.5 text-center whitespace-nowrap">
                          {activeTopic === 'HANDED_OVER' ? (
                            <button
                              type="button"
                              onClick={() => setSelectedRecordForDetail(record)}
                              className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 transition-colors shadow-xs cursor-pointer"
                              title="View Handed Over Smart Card Details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View</span>
                            </button>
                          ) : isFoundCardHandedOver(record) ? (
                            <div
                              className="inline-flex flex-row items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-700 dark:bg-emerald-800 border border-emerald-500 text-white text-[12px] font-semibold uppercase tracking-wider shadow-xs whitespace-nowrap shrink-0 select-none cursor-default animate-in fade-in"
                              title="हस्तान्तरण सम्पन्न भइसकेको (Smart Card Handover Complete)"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200 shrink-0" />
                              <span>HANDED OVER</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSelectedRecordForFoundHandover(record)}
                              className="inline-flex flex-row items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white border border-emerald-400/80 dark:border-emerald-500/50 text-[12px] font-semibold uppercase tracking-wider transition-all cursor-pointer shadow-xs whitespace-nowrap hover:shadow-md group-hover:border-emerald-300"
                              title="हराएको स्मार्ट कार्ड फेला परेपछि सेवाग्राहीलाई हस्तान्तरण गर्नुहोस् (Click to Hand Over Found Smart Card to Cardholder)"
                            >
                              <Check className="w-3.5 h-3.5 shrink-0 text-emerald-100" />
                              <span>HAND OVER</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  }

                  /* =================================================================== */
                  /* DEFAULT REGISTER ROW RENDERING (ALL, NOT-DISTRIBUTED, DISTRIBUTED)  */
                  /* =================================================================== */
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
                      <td className="py-2 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 text-slate-900 dark:text-slate-100 text-[13px] font-normal uppercase whitespace-nowrap">
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

                      {/* 10. STATUS / ACTIONS */}
                      {activeTopic === 'ALL' ? (
                        <>
                          {/* 10. DISTRIBUTED COLUMN */}
                          <td className="py-2 px-2.5 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                            {isDistributed ? (
                              <div className="inline-flex flex-row items-center justify-center gap-1 px-2.5 py-0.5 rounded bg-emerald-100 dark:bg-[#062c20] border border-emerald-400 dark:border-emerald-500/40 text-emerald-800 dark:text-[#10B981] text-[13px] font-normal uppercase tracking-tight shadow-2xs whitespace-nowrap shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-[#10B981] animate-pulse shrink-0" />
                                <span>DISTRIBUTED</span>
                              </div>
                            ) : isMissing ? (
                              <span className="inline-flex flex-row items-center justify-center px-2.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-[12px] font-medium uppercase tracking-tight whitespace-nowrap shrink-0">
                                NOT-DISTRIBUTED
                              </span>
                            ) : canDistribute ? (
                              <button
                                type="button"
                                onClick={() => setSelectedRecordForHandover(record)}
                                className="inline-flex flex-row items-center justify-center px-2.5 py-0.5 rounded bg-red-50 hover:bg-red-100 dark:bg-[#0b1322] dark:hover:bg-[#15233d] border border-red-300 dark:border-red-600/50 text-red-700 dark:text-[#F87171] text-[12px] font-medium uppercase tracking-tight transition-all cursor-pointer shadow-2xs active:scale-95 whitespace-nowrap shrink-0"
                                title="Click to Distribute this License"
                              >
                                NOT-DISTRIBUTED
                              </button>
                            ) : (
                              <span className="inline-flex flex-row items-center justify-center px-2.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-[12px] font-medium uppercase tracking-tight whitespace-nowrap shrink-0">
                                NOT-DISTRIBUTED
                              </span>
                            )}
                          </td>

                          {/* 11. MISSING COLUMN */}
                          <td className="py-2 px-2.5 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                            {isMissing ? (
                              <div className="inline-flex flex-row items-center justify-center px-2.5 py-0.5 rounded bg-[#DC2626] dark:bg-[#DC2626] border border-red-500 dark:border-red-500 text-white dark:text-white text-[13px] font-normal uppercase tracking-tight shadow-xs whitespace-nowrap shrink-0 select-none cursor-default">
                                <span>MISSING</span>
                              </div>
                            ) : canMarkMissing && isDistributed && isDistributedSameDay(record) && canDisplayMissingButton(record) ? (
                              <button
                                type="button"
                                onClick={() => setSelectedRecordForMissing(record)}
                                className="inline-flex flex-row items-center justify-center gap-1 px-2.5 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-400 dark:bg-red-950/40 dark:hover:bg-red-900/60 dark:border-red-500/50 dark:hover:border-red-400 dark:text-red-400 dark:hover:text-red-200 text-[12px] font-medium transition-all cursor-pointer shadow-2xs active:scale-95 whitespace-nowrap shrink-0"
                                title="Report this Distributed Card as Missing (Permitted strictly up to 11:59 PM midnight of Nepali Calendar date)"
                              >
                                <AlertOctagon className="w-3 h-3 text-red-500 dark:text-red-400 shrink-0" />
                                <span>MISSING</span>
                              </button>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600 font-mono text-xs">—</span>
                            )}
                          </td>

                          {/* 12. FOUND COLUMN */}
                          <td className="py-2 px-2.5 text-center whitespace-nowrap">
                            {isFound ? (
                              <div className="inline-flex flex-row items-center justify-center gap-1 px-2.5 py-0.5 rounded bg-purple-600 dark:bg-purple-600 border border-purple-400 dark:border-purple-400 text-white dark:text-white text-[13px] font-normal uppercase tracking-tight shadow-xs whitespace-nowrap shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white animate-pulse shrink-0" />
                                <span>FOUND</span>
                              </div>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600 font-mono text-xs">—</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <td className="py-2 px-2.5 text-center whitespace-nowrap">
                          <div className="flex flex-row items-center justify-center gap-1.5 w-full flex-nowrap whitespace-nowrap">
                            {isMissing ? (
                              <div className="inline-flex flex-row items-center justify-center px-2.5 py-0.5 rounded bg-[#DC2626] dark:bg-[#DC2626] border border-red-500 dark:border-red-500 text-white dark:text-white text-[13px] font-normal uppercase tracking-tight shadow-xs whitespace-nowrap shrink-0 select-none cursor-default">
                                <span>MISSING</span>
                              </div>
                            ) : isFound ? (
                              <div className="inline-flex flex-wrap items-center justify-center gap-1.5">
                                <div className="inline-flex flex-row items-center justify-center gap-1 px-2.5 py-0.5 rounded bg-purple-600 dark:bg-purple-600 border border-purple-400 dark:border-purple-400 text-white dark:text-white text-[13px] font-normal uppercase tracking-tight shadow-xs whitespace-nowrap shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white animate-pulse shrink-0" />
                                  <span>FOUND</span>
                                </div>
                                <div className="inline-flex flex-row items-center justify-center gap-1 px-2.5 py-0.5 rounded bg-emerald-100 dark:bg-[#062c20] border border-emerald-400 dark:border-emerald-500/40 text-emerald-800 dark:text-[#10B981] text-[13px] font-normal uppercase tracking-tight shadow-2xs whitespace-nowrap shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-[#10B981] animate-pulse shrink-0" />
                                  <span>DISTRIBUTED</span>
                                </div>
                              </div>
                            ) : isDistributed ? (
                              <div className="inline-flex flex-wrap items-center justify-center gap-1.5">
                                <div className="inline-flex flex-row items-center justify-center gap-1 px-3 py-0.5 rounded bg-emerald-100 dark:bg-[#062c20] border border-emerald-400 dark:border-emerald-500/40 text-emerald-800 dark:text-[#10B981] text-[13px] font-normal uppercase tracking-tight shadow-2xs whitespace-nowrap shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-[#10B981] animate-pulse shrink-0" />
                                  <span>DISTRIBUTED</span>
                                </div>
                                {canMarkMissing && isDistributedSameDay(record) && canDisplayMissingButton(record) && (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedRecordForMissing(record)}
                                    className="inline-flex flex-row items-center justify-center gap-1 px-2.5 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-400 dark:bg-red-950/40 dark:hover:bg-red-900/60 dark:border-red-500/50 dark:hover:border-red-400 dark:text-red-400 dark:hover:text-red-200 text-[13px] font-normal transition-all cursor-pointer shadow-2xs active:scale-95 whitespace-nowrap shrink-0"
                                    title="Report this Distributed Card as Missing (Permitted strictly up to 11:59 PM midnight of Nepali Calendar date)"
                                  >
                                    <AlertOctagon className="w-3 h-3 text-red-500 dark:text-red-400 shrink-0" />
                                    <span>MISSING</span>
                                  </button>
                                )}
                              </div>
                            ) : canDistribute ? (
                              <button
                                type="button"
                                onClick={() => setSelectedRecordForHandover(record)}
                                className="inline-flex flex-row items-center justify-center px-3 py-1 rounded bg-red-50 hover:bg-red-100 dark:bg-[#0b1322] dark:hover:bg-[#15233d] border border-red-300 dark:border-red-600/50 text-red-700 dark:text-[#F87171] text-[13px] font-normal uppercase tracking-tight transition-all cursor-pointer shadow-2xs active:scale-95 whitespace-nowrap shrink-0"
                                title="Click to Distribute this License"
                              >
                                NOT-DISTRIBUTED
                              </button>
                            ) : (
                              <span className="inline-flex flex-row items-center justify-center px-3 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-[13px] font-normal uppercase tracking-tight whitespace-nowrap shrink-0">
                                NOT-DISTRIBUTED
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination & Summary Footer */}
        {totalRecords > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>
                Showing <strong className="text-slate-800 dark:text-white">{(page - 1) * pageSize + 1}</strong> to{' '}
                <strong className="text-slate-800 dark:text-white">{Math.min(page * pageSize, totalRecords)}</strong> of{' '}
                <strong className="text-slate-800 dark:text-white">{totalRecords.toLocaleString()}</strong> Smart Cards
              </span>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <div className="flex items-center gap-1.5">
                <span>Per Page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-white dark:bg-[#08101E] border border-slate-200 dark:border-[#1e2d4a] text-slate-800 dark:text-white rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 font-mono font-medium cursor-pointer"
                >
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={300}>300</option>
                  <option value={400}>400</option>
                  <option value={500}>500</option>
                </select>
              </div>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || tableLoading}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1e2d4a] bg-white dark:bg-[#08101E] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#0d1b33] hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1 shadow-sm cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>

              <div className="px-3 py-1 rounded-lg bg-slate-50 dark:bg-[#08101E] border border-slate-200 dark:border-[#1e2d4a] text-slate-800 dark:text-white font-mono font-bold text-xs">
                {page} / {totalPages}
              </div>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || tableLoading}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1e2d4a] bg-white dark:bg-[#08101E] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#0d1b33] hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1 shadow-sm cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* If Database is 0, show clean upload onboarding prompt */}
      {isDbEmpty && (
        <div className="bg-white dark:bg-[#111827] rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 p-8 sm:p-12 text-center transition-colors duration-200">
          <div className="w-16 h-16 rounded-3xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto mb-4 border border-indigo-100 dark:border-indigo-900/40">
            <FileSpreadsheet className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Zero License Records in System</h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
            No mock or sample data exists. Connect your Google Sheet or upload your official Excel spreadsheet to populate the master registry.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
            <button
              onClick={() => onNavigate('UPLOAD_CENTER')}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl text-xs shadow-md hover:shadow-lg transition-all inline-flex items-center gap-2 cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              <span>Connect Google Sheets</span>
            </button>
            <button
              onClick={onOpenUpload}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs shadow-md hover:shadow-lg transition-all inline-flex items-center gap-2 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Upload Excel / CSV File</span>
            </button>
          </div>
        </div>
      )}
      </>
      )}

      {/* Handover Modal */}
      {selectedRecordForHandover && (
        <HandoverModal
          record={selectedRecordForHandover}
          onClose={() => setSelectedRecordForHandover(null)}
          onSuccess={handleHandoverSuccess}
        />
      )}

      {/* Report Card as Missing Modal (Exact PLSMS Registry Card Design) */}
      {selectedRecordForMissing && (
        <ReportMissingModal
          record={selectedRecordForMissing}
          onClose={() => setSelectedRecordForMissing(null)}
          onSuccess={(updated) => {
            setSelectedRecordForMissing(null);
            fetchStats();
            setActiveTopic('MISSING');
            setPage(1);
            setToastMessage({
              type: 'error',
              text: `License ${updated.licenseNumber || updated.applicantId || 'Record'} reported as MISSING and registered in Missing Cards index.`,
            });
          }}
        />
      )}

      {/* Confirm Found Card Modal (Exact PLSMS Registry Action Design) */}
      {selectedRecordForFound && (
        <ConfirmFoundModal
          record={selectedRecordForFound}
          onClose={() => setSelectedRecordForFound(null)}
          onSuccess={(updated) => {
            setSelectedRecordForFound(null);
            fetchStats();
            fetchRecords();
            setActiveTopic('FOUND');
            setPage(1);
            setToastMessage({
              type: 'success',
              text: `License ${updated.licenseNumber || updated.applicantId || 'Record'} verified and successfully marked as FOUND.`,
            });
          }}
        />
      )}

      {/* Detail Modal */}
      {selectedRecordForDetail && (
        <LicenseDetailModal
          record={selectedRecordForDetail}
          onClose={() => setSelectedRecordForDetail(null)}
          onDistribute={(rec) => {
            setSelectedRecordForDetail(null);
            setSelectedRecordForHandover(rec);
          }}
          onMarkMissing={() => {
            setSelectedRecordForDetail(null);
            fetchStats();
            fetchRecords();
          }}
        />
      )}

      {/* Found Card Handover Modal */}
      {selectedRecordForFoundHandover && (
        <FoundCardHandoverModal
          record={selectedRecordForFoundHandover}
          onClose={() => {
            setSelectedRecordForFoundHandover(null);
            fetchStats(false);
            fetchRecords();
          }}
          onSuccess={(updated) => {
            // Immediately mark as handed over so 'HANDOVER' button turns into 'DISTRIBUTED' right away
            markFoundAsHandedOver(updated.id, updated.licenseNumber);
            setRecords((prev) =>
              prev.map((r) =>
                r.id === updated.id || (r.licenseNumber && r.licenseNumber === updated.licenseNumber)
                  ? {
                      ...r,
                      ...updated,
                      status: 'DISTRIBUTED',
                      isDistributed: true,
                      foundHandoverDone: true,
                      receiverName: updated.receiverName || r.receiverName,
                      receivedBy: updated.receivedBy || r.receivedBy,
                      submittedDocument: updated.submittedDocument || r.submittedDocument,
                      distributedBy: updated.distributedBy || r.distributedBy,
                      distributedDate: updated.distributedDate || r.distributedDate,
                    }
                  : r
              )
            );
            fetchStats(false);
            setToastMessage({
              type: 'success',
              text: `License ${updated.licenseNumber || updated.applicantId || 'Record'} successfully handed over to ${updated.receiverName || updated.receivedBy || 'receiver'}.`,
            });
          }}
        />
      )}

      {/* Update Compulsory Mobile Modal */}
      {selectedRecordForMobile && (
        <UpdateMobileModal
          record={selectedRecordForMobile}
          onClose={() => setSelectedRecordForMobile(null)}
          onSuccess={(updated) => {
            setSelectedRecordForMobile(null);
            fetchStats(false);
            fetchRecords();
            setToastMessage({
              type: 'success',
              text: `Mobile number ${updated.phone} recorded for ${updated.holderName || 'License Card'}. Staff can now call to handover!`,
            });
          }}
        />
      )}
    </div>
  );
};
