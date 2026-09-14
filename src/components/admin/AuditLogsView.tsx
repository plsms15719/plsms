import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Search,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  X,
  Lock,
  FileSpreadsheet,
} from 'lucide-react';
import { AuditLogItem } from '../../types';
import { api } from '../../services/api';
import { HistoryInput } from '../common/HistoryInput';
import { useAuth } from '../../context/AuthContext';
import { isSuperAdminUser } from '../../utils/permissions';

export const AuditLogsView: React.FC = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Reset Audit Logs Modal states (Exclusively for Super Admin)
  const [showConfirmResetModal, setShowConfirmResetModal] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [clearedLogsCount, setClearedLogsCount] = useState(0);

  // Strict check: Only official Super Admin can view or trigger the Reset Audit Ledger functionality
  const isSuperAdmin = isSuperAdminUser(user);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await api.getAuditLogs();
      setLogs(res.logs || []);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const handleReset = () => {
      fetchLogs();
    };
    window.addEventListener('database-reset', handleReset);
    return () => window.removeEventListener('database-reset', handleReset);
  }, []);

  // Listen for ESC key to close modal
  useEffect(() => {
    if (!showSuccessModal && !showConfirmResetModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSuccessModal(false);
        setShowConfirmResetModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSuccessModal, showConfirmResetModal]);

  const handleExecuteReset = async () => {
    if (!isSuperAdmin) {
      setResetError('Access denied: Only Super Administrator can reset the security audit ledger.');
      return;
    }
    try {
      setResetting(true);
      setResetError(null);
      const res = await api.resetAuditLogs();
      setClearedLogsCount(res.clearedLogs);
      setLogs([]);
      setShowConfirmResetModal(false);
      setShowSuccessModal(true);
    } catch (err: any) {
      setResetError(err?.message || 'Failed to reset audit logs. Super Admin permission required.');
    } finally {
      setResetting(false);
    }
  };

  const filtered = logs.filter((log) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      log.action.toLowerCase().includes(q) ||
      log.category.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q) ||
      log.userName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Security & Audit Ledger
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Immutable chronological record of administrative actions, logins, database imports, and distribution handovers.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          {/* Reset Audit Logs Button (Super Admin) */}
          {isSuperAdmin && (
            <button
              id="btn-reset-audit-logs"
              onClick={() => {
                setResetError(null);
                setShowConfirmResetModal(true);
              }}
              className="px-3.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 dark:border-rose-800/80 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="Permanently purge all audit logs to 0 for a clean slate"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>Reset Audit Ledger</span>
            </button>
          )}

          <button
            onClick={fetchLogs}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300/80 dark:bg-[#101b2e] dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-700 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Search with History */}
      <div className="bg-white dark:bg-[#101b2e] p-4 rounded-3xl border border-slate-200 dark:border-slate-800/90 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-3 z-10" />
          <HistoryInput
            historyKey="audit_search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search audit trail by Action, Category, Officer, or Keyword..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-[#091220] border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-600 dark:focus:ring-indigo-500 focus:bg-white dark:focus:bg-[#0c1626] transition-all"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#101b2e] rounded-3xl border border-slate-200 dark:border-slate-800/90 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center">
            <RefreshCw className="w-8 h-8 text-indigo-600 dark:text-indigo-400 animate-spin mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Loading Audit Ledger...
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Clean Ledger Active • 0 Audit Events Logged</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1">
                The audit ledger is completely clean. New administrative security events, authentication attempts, and handover distribution actions will appear here in chronological sequence.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border-2 border-[#b8d2eb] dark:border-[#1e2d4a] bg-white dark:bg-[#030914] shadow-md dark:shadow-xl">
            <table className="w-full text-left text-[13px] border-collapse">
              <thead>
                <tr className="bg-[#deecf9] dark:bg-[#08101E] border-b-2 border-[#b8d2eb] dark:border-[#1e2d4a] text-[#b91c1c] dark:text-[#F87171] font-bold uppercase tracking-wider text-[11px]">
                  <th className="p-3 pl-4 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80">Timestamp</th>
                  <th className="p-3 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80">Category</th>
                  <th className="p-3 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80">Action</th>
                  <th className="p-3 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80">Officer / User</th>
                  <th className="p-3 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80">Event Details</th>
                  <th className="p-3 text-right pr-4">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#cde0f2] dark:divide-[#1e2d4a]/70 font-normal text-slate-800 dark:text-slate-200 text-[13px]">
                {filtered.map((item, index) => {
                  const isOdd = index % 2 === 1;
                  const rowBg = isOdd
                    ? 'bg-[#e7f1fc] dark:bg-[#0b162b]'
                    : 'bg-white dark:bg-[#030914]';

                  return (
                    <tr
                      key={item.id}
                      className={`${rowBg} hover:bg-[#d5e7fa] dark:hover:bg-[#112445] transition-colors border-b border-[#cde0f2] dark:border-[#1e2d4a]/70`}
                    >
                      <td className="p-1.5 pl-3 font-mono text-slate-700 dark:text-slate-300 text-[13px] whitespace-nowrap border-r border-[#cde0f2] dark:border-[#1e2d4a]/70">
                        {new Date(item.timestamp).toLocaleString()}
                      </td>
                      <td className="p-1.5 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap text-center">
                        <span className="px-2 py-0.5 rounded text-[11px] font-normal bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 shadow-xs">
                          {item.category}
                        </span>
                      </td>
                      <td className="p-1.5 font-normal text-slate-900 dark:text-white font-mono text-[13px] border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {item.action}
                      </td>
                      <td className="p-1.5 text-slate-800 dark:text-slate-200 font-normal border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {item.userName}
                      </td>
                      <td className="p-1.5 text-slate-700 dark:text-slate-300 max-w-md border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 font-normal">
                        {item.details}
                      </td>
                      <td className="p-1.5 pr-3 text-right font-mono text-slate-500 dark:text-slate-400 text-[13px] whitespace-nowrap">
                        {item.ipAddress || '127.0.0.1'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CONFIRMATION MODAL: Reset Audit Ledger (Exclusively for Super Admin) */}
      {isSuperAdmin && showConfirmResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div
            className="w-full max-w-md bg-white dark:bg-[#0c1626] rounded-3xl border-2 border-rose-300 dark:border-rose-800/80 shadow-2xl p-6 sm:p-7 space-y-5"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center border border-rose-200 dark:border-rose-800/80 shrink-0">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Reset Security & Audit Ledger?
                  </h3>
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-mono font-medium">
                    Permanent Purge • Clean Slate Ledger
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmResetModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-900 dark:text-rose-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-rose-800 dark:text-rose-300">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>Irreversible Permanent Action</span>
              </div>
              <p>
                This will permanently delete all {logs.length} chronological audit events, security clearances, and handover records from the system.
              </p>
              <p className="font-mono text-[11px] text-rose-700 dark:text-rose-300/80">
                Current audit log count: <strong>{logs.length} records</strong>
              </p>
            </div>

            {resetError && (
              <div className="p-3 rounded-xl bg-rose-100 dark:bg-rose-950 border border-rose-300 dark:border-rose-700 text-xs text-rose-800 dark:text-rose-200 font-medium">
                {resetError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmResetModal(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={handleExecuteReset}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                {resetting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Purging Ledger...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Yes, Reset Audit Ledger Permanently</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CENTERED SUCCESS MODAL: Audit Ledger Reset Successfully */}
      {showSuccessModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSuccessModal(false);
            }
          }}
        >
          <div
            className="w-full max-w-xl bg-emerald-50 dark:bg-[#061517] rounded-3xl border-2 border-emerald-400 dark:border-emerald-500/60 shadow-2xl p-6 sm:p-8 space-y-6 text-slate-900 dark:text-white"
            role="dialog"
            aria-modal="true"
          >
            {/* Header with dismiss X */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/40 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider font-mono">
                    Clean Slate Active
                  </div>
                  <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                    Audit Ledger Reset Successfully
                  </h3>
                </div>
              </div>
              <button
                type="button"
                id="btn-close-audit-reset-modal"
                onClick={() => setShowSuccessModal(false)}
                className="p-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/80 dark:hover:bg-emerald-900 border border-emerald-300 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                title="Close view mode (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Metric Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 font-mono">
              <div className="p-4 bg-white dark:bg-emerald-950/70 rounded-2xl border border-emerald-300 dark:border-emerald-500/40 shadow-xs dark:shadow-inner">
                <div className="text-[10px] sm:text-[11px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-wider">
                  PURGED AUDIT LOGS
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
                  {clearedLogsCount.toLocaleString()} events
                </div>
                <div className="text-[10.5px] text-emerald-600 dark:text-emerald-400/70 mt-1">
                  Purged permanently from storage
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-emerald-950/70 rounded-2xl border border-emerald-300 dark:border-emerald-500/40 shadow-xs dark:shadow-inner">
                <div className="text-[10px] sm:text-[11px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-wider">
                  CURRENT LEDGER STATUS
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                  0 Records
                </div>
                <div className="text-[10.5px] text-emerald-600 dark:text-emerald-400/70 mt-1">
                  Clean slate ready for new actions
                </div>
              </div>
            </div>

            {/* Status & Next Step Guidance */}
            <div className="p-4 rounded-2xl bg-emerald-100/70 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2.5 text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  <strong>Clean Slate Active:</strong> All audit trails and security log events have been cleared. New operations will be logged fresh.
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-3 border-t border-emerald-200 dark:border-emerald-800/60">
              <button
                type="button"
                onClick={() => setShowSuccessModal(false)}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono font-bold text-xs transition-colors cursor-pointer shadow-sm text-center"
              >
                Close Notice (Esc)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
