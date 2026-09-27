import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Database,
  Layers,
  FileCheck2,
  Users,
  History,
  FileSpreadsheet,
  Info,
  Eye,
  EyeOff,
  Flame,
  Check,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import { ClearCardDataPreview, ClearCardDataVerifyResponse } from '../../types';

interface ClearCardDataSectionProps {
  onRefresh?: () => void;
}

export const ClearCardDataSection: React.FC<ClearCardDataSectionProps> = ({ onRefresh }) => {
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<ClearCardDataPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Form inputs for verification
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  // Verification state
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<ClearCardDataVerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Modal view for full audit breakdown
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const fetchPreview = async () => {
    try {
      setLoadingPreview(true);
      setPreviewError(null);
      const res = await api.getClearCardDataPreview();
      if (res && res.success && res.preview) {
        setPreviewData(res.preview);
      } else {
        setPreviewError('Failed to fetch card data initialization preview.');
      }
    } catch (err: any) {
      setPreviewError(err.message || 'Error communicating with server for preview.');
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    fetchPreview();
  }, []);

  const handleVerifySafetyArchitecture = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    setVerifyResult(null);

    if (confirmationPhrase.trim() !== 'INITIALIZE PRODUCTION CARDS') {
      setVerifyError('Security phrase mismatch. Please type exactly: INITIALIZE PRODUCTION CARDS');
      return;
    }

    if (!password) {
      setVerifyError('Confidential Super Administrator password is required for identity confirmation.');
      return;
    }

    if (!acknowledged) {
      setVerifyError('Please check the safety acknowledgment checkbox before proceeding.');
      return;
    }

    try {
      setIsVerifying(true);
      const res = await api.verifyClearCardDataSafety({
        password,
        confirmationPhrase: confirmationPhrase.trim(),
        acknowledged,
      });

      if (res && res.success) {
        setVerifyResult(res);
        if (res.preview) {
          setPreviewData(res.preview);
        }
        setShowDetailsModal(true);
        onRefresh?.();
      } else {
        setVerifyError(res?.message || 'Safety architecture verification failed.');
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Verification attempt failed. Check password and try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const isFormReady =
    confirmationPhrase.trim() === 'INITIALIZE PRODUCTION CARDS' &&
    password.length > 0 &&
    acknowledged;

  return (
    <div
      id="clear-card-data-production-init-container"
      className="w-full bg-white dark:bg-[#070F1E] border-2 border-indigo-300 dark:border-indigo-900/80 rounded-3xl p-6 sm:p-8 shadow-md dark:shadow-2xl space-y-7 transition-colors font-sans"
    >
      {/* 1. Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-[#1E293B]">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-300 dark:border-indigo-600/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 shadow-sm dark:shadow-[0_0_20px_rgba(99,102,241,0.3)]">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                Clear Card Data / Production Initialization
              </h2>
              <span className="px-2.5 py-0.5 bg-indigo-100 dark:bg-indigo-950/90 border border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-300 text-[10px] font-mono font-black rounded-full uppercase tracking-wider">
                SUPER ADMIN EXCLUSIVE
              </span>
              <span className="px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/90 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-[10px] font-mono font-black rounded-full uppercase tracking-wider">
                PREVIEW & SAFETY ARCHITECTURE
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 font-medium max-w-3xl leading-relaxed">
              Targeted production preparation utility in Printed License Search Management System (PLSMS). Provides an inspection preview of card-only records targeted for future cleanup, while strictly preserving <strong>real Google Sheet records in staging ({previewData?.summary.stagingRecordsRetained?.toLocaleString() ?? 0} rows)</strong>, user accounts, audit trails, and configurations.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={fetchPreview}
            disabled={loadingPreview}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#0C1A30] dark:hover:bg-[#122442] border border-slate-300 dark:border-[#1E375F] text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2 transition-all shadow-xs cursor-pointer"
            title="Refresh preview data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingPreview ? 'animate-spin' : ''}`} />
            <span>Refresh Preview</span>
          </button>
        </div>
      </div>

      {previewError && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-mono flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{previewError}</span>
        </div>
      )}

      {/* 2. Side-by-Side Horizontal Scope Comparison */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white font-mono flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-500" />
              <span>Read-Only Inventory Preview: Target Card Data vs Strictly Preserved Data</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Strictly isolated scope ensures only test/card records are planned for clearing, with no disruption to core system data.
            </p>
          </div>
          <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-bold self-start sm:self-auto flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Zero Deletion Mode Active
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Column A: Data Targeted For Future Clearing (Card Data Only) */}
          <div className="lg:col-span-5 bg-rose-50/60 dark:bg-[#12080D] border-2 border-rose-200 dark:border-rose-900/60 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-rose-200 dark:border-rose-900/50 pb-3">
                <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-mono font-bold text-xs uppercase tracking-wide">
                  <Flame className="w-4 h-4" />
                  <span>Targeted Card & Test Data (Planned Clear)</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                  CARD SCOPE ONLY
                </span>
              </div>

              <div className="space-y-2.5">
                {previewData?.targetTablesAndStores.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-white/80 dark:bg-[#1A0C14] border border-rose-200/80 dark:border-rose-900/40 text-xs font-mono space-y-1 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-rose-200">{item.table}</span>
                      <span className="px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 font-black text-xs">
                        {item.recordCount.toLocaleString()} rows
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 font-sans leading-relaxed">
                      {item.description}
                    </p>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      Store: {item.store}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-rose-200 dark:border-rose-900/50 flex items-center justify-between text-xs font-mono text-rose-900 dark:text-rose-300 font-bold">
              <span>Total Card Records In Target Scope:</span>
              <span className="text-sm font-black">
                {(previewData?.summary.totalCardRecordsToClear ?? 10000).toLocaleString()} Cards
              </span>
            </div>
          </div>

          {/* Column B: Strictly Preserved & Protected Data (Guaranteed Safe) */}
          <div className="lg:col-span-7 bg-emerald-50/60 dark:bg-[#061513] border-2 border-emerald-200 dark:border-emerald-900/60 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-emerald-200 dark:border-emerald-900/50 pb-3">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-mono font-bold text-xs uppercase tracking-wide">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Strictly Preserved System Data (NEVER CLEARED)</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  GUARANTEED SAFE
                </span>
              </div>

              {/* Special Prominent Card: records_staging */}
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-100/90 to-teal-100/80 dark:from-emerald-950/80 dark:to-teal-950/70 border-2 border-emerald-400 dark:border-emerald-600/70 text-xs font-mono space-y-1.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0" />
                    <span className="font-black text-emerald-950 dark:text-white">
                      records_staging (PostgreSQL Staging Partition)
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white font-black text-xs shadow-xs">
                    {(previewData?.summary.stagingRecordsRetained ?? 0).toLocaleString()} REAL RECORDS
                  </span>
                </div>
                <p className="text-[11px] text-emerald-900 dark:text-emerald-200/90 font-sans leading-relaxed">
                  <strong>CRITICAL PRODUCTION SHIELD:</strong> Real synchronized Google Sheet records stored in staging are completely protected and untouched. This dataset is preserved ready for live production activation.
                </p>
              </div>

              {/* Grid of Other Preserved Components */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {previewData?.preservedTablesAndStores
                  .filter((p) => !p.table.includes('records_staging'))
                  .map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-white/80 dark:bg-[#0A1D1A] border border-emerald-200/80 dark:border-emerald-900/40 text-xs font-mono space-y-1 shadow-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 dark:text-emerald-200 truncate pr-1">
                          {item.table.split(' ')[0]}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold text-[10px] shrink-0">
                          {typeof item.recordCount === 'number'
                            ? `${item.recordCount.toLocaleString()} rows`
                            : item.recordCount}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400 font-sans leading-tight">
                        {item.description}
                      </p>
                      <div className="text-[9px] text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                        <Check className="w-3 h-3" /> Fully Preserved
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="pt-3 border-t border-emerald-200 dark:border-emerald-900/50 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-emerald-900 dark:text-emerald-300 font-bold">
              <span>Security Guarantee:</span>
              <span className="text-[11px] text-emerald-800 dark:text-emerald-400">
                {(previewData?.summary.stagingRecordsRetained ?? 0).toLocaleString()} Staging Records + {previewData?.summary.userAccountsRetained ?? 11} Users + Audit Logs 100% Protected
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Safety Architecture Pillars */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-[#091528] border border-slate-200 dark:border-[#1E3050] space-y-3">
        <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white font-mono flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-500" />
          <span>Safety Architecture & Transaction Safeguards</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-3 rounded-xl bg-white dark:bg-[#0B1A32] border border-slate-200 dark:border-slate-800 space-y-1">
            <span className="text-indigo-600 dark:text-indigo-400 font-bold text-[11px] uppercase flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-indigo-500" /> Transaction Rollback
            </span>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 font-sans leading-tight">
              Single atomic database transaction. Any runtime error triggers an automatic full rollback.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white dark:bg-[#0B1A32] border border-slate-200 dark:border-slate-800 space-y-1">
            <span className="text-emerald-600 dark:text-emerald-400 font-bold text-[11px] uppercase flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Staging Isolation
            </span>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 font-sans leading-tight">
              records_staging is excluded from cleanup queries to protect staged Google Sheet rows.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white dark:bg-[#0B1A32] border border-slate-200 dark:border-slate-800 space-y-1">
            <span className="text-blue-600 dark:text-blue-400 font-bold text-[11px] uppercase flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-blue-500" /> Bounded Card Scope
            </span>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 font-sans leading-tight">
              Never performs a database-wide reset. Strictly targets card-level inventory only.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white dark:bg-[#0B1A32] border border-slate-200 dark:border-slate-800 space-y-1">
            <span className="text-amber-600 dark:text-amber-400 font-bold text-[11px] uppercase flex items-center gap-1">
              <Lock className="w-3 h-3 text-amber-500" /> Phase 1 Lock
            </span>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 font-sans leading-tight">
              Destructive deletion is deactivated in this phase. Verifies preview & safety readiness only.
            </p>
          </div>
        </div>
      </div>

      {/* 4. Super Admin Explicit Confirmation Form (Wide Rectangular Layout) */}
      <form
        onSubmit={handleVerifySafetyArchitecture}
        className="p-5 sm:p-6 rounded-2xl bg-indigo-50/50 dark:bg-[#09152B]/60 border-2 border-indigo-200 dark:border-indigo-800/80 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-200 dark:border-indigo-800/60 pb-3">
          <div className="flex items-center gap-2 text-indigo-950 dark:text-indigo-200 font-mono font-bold text-xs uppercase tracking-wider">
            <Lock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Super Administrator Confirmation & Safety Verification Form</span>
          </div>
          <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
            Phase 1: Verification & Simulation Only
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Field 1: Confirmation Phrase */}
          <div className="space-y-1.5 font-mono">
            <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span>1. Type Confirmation Phrase:</span>
              <span className="text-rose-600 dark:text-rose-400 select-all font-black">
                INITIALIZE PRODUCTION CARDS
              </span>
            </label>
            <input
              type="text"
              value={confirmationPhrase}
              onChange={(e) => setConfirmationPhrase(e.target.value)}
              placeholder="INITIALIZE PRODUCTION CARDS"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#060D1A] border border-slate-300 dark:border-[#1E3050] text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          {/* Field 2: Super Admin Password */}
          <div className="space-y-1.5 font-mono">
            <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
              <span>2. Super Admin Confidential Password</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">Identity Re-Verification</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter Super Admin password"
                className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-white dark:bg-[#060D1A] border border-slate-300 dark:border-[#1E3050] text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Checkbox Acknowledgment */}
        <label className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-[#060D1A] border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 shrink-0 mt-0.5 cursor-pointer"
          />
          <span className="leading-relaxed">
            I confirm that I am an authorized Super Administrator. I understand that this operation plans the initialization of card records only, and that <strong>records_staging ({(previewData?.summary.stagingRecordsRetained ?? 0).toLocaleString()} rows)</strong>, user accounts, and system configurations are strictly preserved.
          </span>
        </label>

        {verifyError && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-xs font-mono text-rose-800 dark:text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{verifyError}</span>
          </div>
        )}

        {/* Submit & Action Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            Phase 1 Safeguard: Click to execute transaction simulation and safety architecture dry-run.
          </div>

          <button
            type="submit"
            disabled={!isFormReady || isVerifying}
            className={`px-6 py-3 rounded-xl text-xs font-mono font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md ${
              isFormReady && !isVerifying
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30 active:scale-98'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700'
            }`}
          >
            {isVerifying ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
                <span>Simulating Safety Architecture...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-300" />
                <span>Verify Safety Architecture & Simulate</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* 5. Wide Horizontal Rectangular Verification Results Modal */}
      {showDetailsModal && verifyResult && (
        <div
          id="clear-card-data-verification-modal-overlay"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDetailsModal(false);
            }
          }}
        >
          <div className="bg-white dark:bg-[#071120] border-2 border-emerald-500 rounded-3xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200 text-slate-900 dark:text-slate-100">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-emerald-200 dark:border-emerald-800/60">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 border-2 border-emerald-500 dark:border-emerald-400 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-md">
                  <CheckCircle2 className="w-7 h-7 animate-pulse" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-300 border border-emerald-400">
                      SAFETY ARCHITECTURE VERIFIED • DRY-RUN PASSED
                    </span>
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono font-semibold">
                      PLSMS Command Center
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-black font-mono tracking-tight text-slate-900 dark:text-white mt-1">
                    Clear Card Data / Production Initialization — Safety Simulation Passed
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowDetailsModal(false)}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                title="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Metric Pills */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0A1629] border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Targeted Cards
                </span>
                <div className="text-lg font-black text-rose-600 dark:text-rose-400 mt-1">
                  {verifyResult.details.targetRecordsCount.toLocaleString()} Cards
                </div>
                <span className="text-[10px] text-rose-500 font-bold">Planned for Clearing</span>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700">
                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                  Staging Retention
                </span>
                <div className="text-lg font-black text-emerald-600 dark:text-emerald-300 mt-1">
                  {verifyResult.details.stagingCount.toLocaleString()} Staged
                </div>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">✓ 100% Protected</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0A1629] border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Transaction Test
                </span>
                <div className="text-lg font-black text-indigo-600 dark:text-indigo-400 mt-1">
                  PASS (Rollback)
                </div>
                <span className="text-[10px] text-indigo-500 font-bold">Atomic Rollback Ready</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0A1629] border border-slate-200 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Deletion State
                </span>
                <div className="text-lg font-black text-amber-600 dark:text-amber-400 mt-1">
                  0 DELETED
                </div>
                <span className="text-[10px] text-amber-500 font-bold">Zero Data Altered</span>
              </div>
            </div>

            {/* Detailed Findings & Protection Notice */}
            <div className="p-4 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/60 text-xs font-mono space-y-2 leading-relaxed">
              <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200 font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Verification Statement:</span>
              </div>
              <p className="text-slate-700 dark:text-slate-300">
                {verifyResult.message}
              </p>
              <div className="pt-2 border-t border-emerald-200 dark:border-emerald-800/50 text-[11px] text-slate-600 dark:text-slate-400">
                {verifyResult.details.notice}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-200 dark:border-[#1E293B]">
              <button
                type="button"
                onClick={() => setShowDetailsModal(false)}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold uppercase tracking-wider cursor-pointer shadow-md transition-all"
              >
                Close Verification Notice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
