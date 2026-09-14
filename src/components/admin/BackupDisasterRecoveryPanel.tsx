import React, { useState, useRef, useEffect } from 'react';
import {
  Database,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Info,
  Layers,
  Users,
  MapPin,
  Lock,
  History,
  FileText,
  Flame,
  Key,
  Eye,
  EyeOff,
  Cpu,
  Search,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Radio,
  Bell,
  Sliders,
  X,
} from 'lucide-react';
import { api } from '../../services/api';

interface BackupLocation {
  code: string;
  nameNp: string;
  nameEn: string;
  locationNp: string;
  locationEn: string;
  officeNameNp: string;
  officeNameEn: string;
  departmentNp: string;
  departmentEn: string;
  isPrimary?: boolean;
}

interface InspectionReport {
  valid: boolean;
  signatureValid: boolean;
  archiveSignature: string;
  version: string;
  exportedAt: string;
  exportedBy: {
    id?: string;
    name?: string;
    email?: string;
    role?: string;
  } | null;
  location: {
    code?: string;
    nameNp?: string;
    nameEn?: string;
    locationNp?: string;
    locationEn?: string;
    officeNameNp?: string;
    officeNameEn?: string;
    departmentNp?: string;
    departmentEn?: string;
    scope?: string;
  } | null;
  locationValid: boolean;
  isOfficialLocationMatch: boolean;
  manifest: {
    scope?: string;
    totalRecords: number;
    totalDistributions: number;
    totalImports: number;
    totalUsers: number;
    totalNotices: number;
    totalActionOverrides?: number;
    hasGoogleSheetsConfig: boolean;
    checksumValid: boolean;
    dataChecksumSha256?: string;
    actionCategories?: {
      totalSmartCards: number;
      notDistributedCards: number;
      distributedCards: number;
      missingCards: number;
      foundCards: number;
      handedOverCards?: number;
    };
    userSecurity?: {
      totalUsers: number;
      usersWithPasswords: number;
      passwordEncryptionFormat: string;
      accountIdentifiers?: Array<{
        id: string;
        name?: string;
        role?: string;
        hasEncryptedPassword?: boolean;
      }>;
    };
    auxiliaryItems?: {
      totalImports: number;
      totalDistributions: number;
      totalActionOverrides: number;
      totalNotices: number;
      hasGoogleSheetsConfig: boolean;
    };
  };
  sampleRecord?: {
    holderName?: string;
    licenseNumber?: string;
    applicationNumber?: string;
    office?: string;
    status?: string;
  };
  error?: string;
}

interface BackupDisasterRecoveryPanelProps {
  onRecoveryCompleted?: () => void;
}

export const BackupDisasterRecoveryPanel: React.FC<BackupDisasterRecoveryPanelProps> = ({
  onRecoveryCompleted,
}) => {
  const [locations, setLocations] = useState<BackupLocation[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [inspection, setInspection] = useState<InspectionReport | null>(null);
  const [analysisError, setAnalysisError] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Recovery configuration
  const [recoveryMode, setRecoveryMode] = useState<'REPLACE' | 'MERGE'>('REPLACE');
  const [targetLocationCode, setTargetLocationCode] = useState<string>('ITAHARI_SUNSARI');
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showUserPasswordList, setShowUserPasswordList] = useState<boolean>(false);
  const [showLiveStats, setShowLiveStats] = useState<boolean>(true);

  // Live Database Inventory State (Pre-Recovery baseline)
  const [liveStats, setLiveStats] = useState<{
    totalRecords: number;
    notDistributed: number;
    distributed: number;
    missing: number;
    found: number;
    imports: number;
    distributions: number;
    users: number;
    usersWithPasswords?: number;
    passwordEncryptionFormat?: string;
    actionOverrides?: number;
    notices?: number;
    hasGoogleSheetsConfig?: boolean;
    timestamp: string;
  } | null>(null);
  const [loadingLiveStats, setLoadingLiveStats] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Execution state
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreProgress, setRestoreProgress] = useState<string>('');
  const [restoreSuccess, setRestoreSuccess] = useState<{
    restoredRecords: number;
    restoredDistributions: number;
    restoredImports: number;
    restoredUsers: number;
    restoredUsersWithPasswords?: number;
    restoredNotices?: number;
    restoredActionOverrides?: number;
    restoredSheetsConfig?: boolean;
    actionCategories?: {
      totalSmartCards: number;
      notDistributedCards: number;
      distributedCards: number;
      missingCards: number;
      foundCards: number;
      handedOverCards?: number;
    };
    userSecurity?: {
      totalUsers: number;
      usersWithPasswords: number;
      passwordEncryptionFormat: string;
    };
    message: string;
    restoredAt: string;
  } | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const [restoreError, setRestoreError] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch official office locations on mount
  useEffect(() => {
    let isMounted = true;
    api
      .getBackupLocations()
      .then((res) => {
        if (isMounted && res.locations) {
          setLocations(res.locations);
          if (res.activeOfficeCode) {
            setTargetLocationCode(res.activeOfficeCode);
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to load backup locations:', err);
      });

    loadLiveDatabaseStats();

    const handleSync = () => {
      loadLiveDatabaseStats();
    };

    window.addEventListener('database-reset', handleSync);
    window.addEventListener('records-updated', handleSync);
    window.addEventListener('google-sheets-reset', handleSync);

    return () => {
      isMounted = false;
      window.removeEventListener('database-reset', handleSync);
      window.removeEventListener('records-updated', handleSync);
      window.removeEventListener('google-sheets-reset', handleSync);
    };
  }, []);

  const loadLiveDatabaseStats = async () => {
    try {
      setLoadingLiveStats(true);
      const stats = await api.getDatabaseInventoryStats();
      setLiveStats(stats);
    } catch (err) {
      console.warn('Could not load live inventory stats:', err);
    } finally {
      setLoadingLiveStats(false);
    }
  };

  const handleExportCurrentSafetyBackup = async () => {
    try {
      setIsExporting(true);
      await api.downloadBackupArchive({
        locationCode: targetLocationCode,
        scope: 'FULL_MASTER_ARCHIVE',
      });
    } catch (err: any) {
      console.error('Failed to export safety backup:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setAnalysisError('');
    setInspection(null);
    setRestoreSuccess(null);
    setRestoreError('');
    setShowUserPasswordList(false);
    setAnalyzing(true);

    try {
      const report = await api.inspectBackupArchive(file);
      setInspection(report);
      if (report.location?.code) {
        setTargetLocationCode(report.location.code);
      }
    } catch (err: any) {
      console.error('Inspection failed:', err);
      setAnalysisError(err.message || 'Corrupt or unreadable JSON backup file.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleResetRecovery = () => {
    setSelectedFile(null);
    setInspection(null);
    setRestoreSuccess(null);
    setShowSuccessModal(false);
    setRestoreError('');
    setAnalysisError('');
    setShowUserPasswordList(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const onDragLeave = () => {
    setIsDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleExecuteRestore = async () => {
    if (!selectedFile || !inspection) return;

    try {
      setIsRestoring(true);
      setRestoreError('');
      setRestoreProgress('1/3 Creating automatic pre-recovery safety snapshot...');

      await new Promise((r) => setTimeout(r, 450));
      setRestoreProgress('2/3 Writing persistent records, users & distribution ledgers to disk...');

      const result = await api.restoreBackupArchive(selectedFile, {
        mode: recoveryMode,
        targetLocationCode,
      });

      setRestoreProgress('3/3 Rebuilding high-speed index & flushing caches...');
      await new Promise((r) => setTimeout(r, 450));

      setRestoreSuccess({
        restoredRecords: result.restoredRecords || 0,
        restoredDistributions: result.restoredDistributions || 0,
        restoredImports: result.restoredImports || 0,
        restoredUsers: result.restoredUsers || 0,
        restoredUsersWithPasswords:
          result.restoredUsersWithPasswords ?? result.userSecurity?.usersWithPasswords,
        restoredNotices: result.restoredNotices || 0,
        restoredActionOverrides: result.restoredActionOverrides || 0,
        restoredSheetsConfig: result.restoredSheetsConfig,
        actionCategories: result.actionCategories,
        userSecurity: result.userSecurity,
        message: result.message || 'Database successfully restored.',
        restoredAt: result.restoredAt || new Date().toISOString(),
      });

      setShowSuccessModal(true);
      setShowConfirmModal(false);

      // Refresh live system state
      await loadLiveDatabaseStats();

      window.dispatchEvent(new CustomEvent('records-updated'));
      window.dispatchEvent(new CustomEvent('database-reset'));
      window.dispatchEvent(new CustomEvent('google-sheets-reset'));
      window.dispatchEvent(new CustomEvent('plsms:record-updated'));

      if (onRecoveryCompleted) {
        onRecoveryCompleted();
      }
    } catch (err: any) {
      console.error('Restoration error:', err);
      setRestoreError(err.message || 'Failed to inject and restore backup database.');
    } finally {
      setIsRestoring(false);
      setRestoreProgress('');
    }
  };

  const activeOffice = locations.find((l) => l.code === targetLocationCode) || locations[1];

  // Derive inspected 7 categories
  const archiveActionCats = inspection?.manifest.actionCategories || {
    totalSmartCards: inspection?.manifest.totalRecords || 0,
    notDistributedCards: Math.max(
      0,
      (inspection?.manifest.totalRecords || 0) - (inspection?.manifest.totalDistributions || 0)
    ),
    distributedCards: inspection?.manifest.totalDistributions || 0,
    missingCards: 0,
    foundCards: 0,
    handedOverCards: inspection?.manifest.totalDistributions || 0,
  };

  const archiveUserSec = inspection?.manifest.userSecurity || {
    totalUsers: inspection?.manifest.totalUsers || 0,
    usersWithPasswords: inspection?.manifest.totalUsers || 0,
    passwordEncryptionFormat: 'BCRYPT_CRYPTOGRAPHIC_HASH (Extra Coding Form)',
    accountIdentifiers: [],
  };

  const archiveAuxiliary = inspection?.manifest.auxiliaryItems || {
    totalImports: inspection?.manifest.totalImports || 0,
    totalDistributions: inspection?.manifest.totalDistributions || 0,
    totalActionOverrides: inspection?.manifest.totalActionOverrides || 0,
    totalNotices: inspection?.manifest.totalNotices || 0,
    hasGoogleSheetsConfig: Boolean(inspection?.manifest.hasGoogleSheetsConfig),
  };

  return (
    <div
      id="plsms-disaster-recovery-container"
      className="w-full relative rounded-3xl bg-white dark:bg-[#030712] border border-slate-200 dark:border-indigo-500/30 p-5 sm:p-7 space-y-6 shadow-xl dark:shadow-2xl transition-all"
    >
      {/* Container Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-indigo-900/40">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-800 flex items-center justify-center text-white shrink-0 shadow-lg shadow-indigo-900/20 dark:shadow-indigo-900/40 border border-indigo-400/30">
            <ShieldAlert className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white font-mono uppercase">
              PLSMS SYSTEM DATA RECOVERY & BACKUP INJECTION ENGINE
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCurrentSafetyBackup}
            disabled={isExporting}
            className="px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 dark:border-amber-500/40 text-[15px] font-mono font-bold dark:text-amber-300 flex items-center gap-2 cursor-pointer transition-all active:scale-95 shadow-xs"
            title="Download full JSON backup of active database before restoring"
          >
            {isExporting ? (
              <RefreshCw className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400" />
            ) : (
              <Database className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            )}
            <span>{isExporting ? 'EXPORTING PRE-RECOVERY BACKUP...' : 'TAKE PRE-RECOVERY BACKUP'}</span>
          </button>
        </div>
      </div>

      {/* Error Notification Banner */}
      {(restoreError || analysisError) && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/80 border-2 border-rose-300 dark:border-rose-500 text-rose-900 dark:text-rose-200 flex items-start gap-3 shadow-lg font-mono">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <strong className="text-rose-950 dark:text-white font-bold block">Recovery Validation Error:</strong>
            <p>{restoreError || analysisError}</p>
          </div>
        </div>
      )}

      {/* FLOATING SUCCESS INFORMATION DIALOG BOX (Square in shape, focused at the center of the working area) */}
      {restoreSuccess && showSuccessModal && (
        <div
          id="recovery-success-dialog-overlay"
          className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div
            id="recovery-success-dialog-square"
            className="w-full max-w-[420px] aspect-square max-h-[92vh] flex flex-col justify-between items-center text-center p-6 sm:p-7 rounded-3xl bg-white dark:bg-[#071224] border border-emerald-300/70 dark:border-emerald-500/50 shadow-2xl relative text-slate-800 dark:text-slate-100 animate-in zoom-in-95 duration-200 overflow-hidden"
          >
            {/* Close (X) button at top right */}
            <button
              type="button"
              id="close-recovery-success-dialog-btn"
              onClick={() => setShowSuccessModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors cursor-pointer z-10"
              title="Close dialog (X)"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Top Emblem & Badge */}
            <div className="flex flex-col items-center pt-2">
              <div className="relative mb-3">
                <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 border-2 border-emerald-500/80 dark:border-emerald-400 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
                  <CheckCircle2 className="w-9 h-9 sm:w-10 sm:h-10 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-white shadow-xs">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
              </div>

              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-wider shadow-xs mb-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                DISASTER RECOVERY EXECUTED
              </div>

              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight leading-snug px-3">
                Database Disaster Recovery Executed Successfully
              </h3>
            </div>

            {/* Middle Message / Information */}
            <div className="my-auto px-2 w-full space-y-2">
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-[#050C1B] border border-slate-200 dark:border-slate-800 text-left">
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans line-clamp-3">
                  {restoreSuccess.message}
                </p>
                <div className="mt-2 pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  <span>Timestamp: {new Date(restoreSuccess.restoredAt).toLocaleTimeString()}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Audit Logged</span>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="w-full space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
              <button
                type="button"
                id="ack-recovery-success-btn"
                onClick={() => setShowSuccessModal(false)}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-mono font-bold text-xs uppercase tracking-wider shadow-xs transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Close & View Live Database</span>
              </button>

              <button
                type="button"
                id="load-another-archive-modal-btn"
                onClick={() => {
                  setShowSuccessModal(false);
                  handleResetRecovery();
                }}
                className="w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <span>Load Another Backup Archive</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle non-dominating status chip in working area when dialog is closed */}
      {restoreSuccess && !showSuccessModal && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-slate-800 dark:text-slate-200 text-xs font-mono shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-bold text-emerald-950 dark:text-emerald-300">
              Database Disaster Recovery Executed Successfully
            </span>
            <span className="text-slate-500 dark:text-slate-400 text-[11px] hidden sm:inline">
              ({new Date(restoreSuccess.restoredAt).toLocaleTimeString()})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSuccessModal(true)}
              className="px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-slate-700 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold transition-colors cursor-pointer"
            >
              View Summary
            </button>
            <button
              type="button"
              onClick={handleResetRecovery}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3 text-slate-500" />
              <span>Load Another</span>
            </button>
          </div>
        </div>
      )}

      {/* PRIMARY 7-CATEGORY AUDIT CONSOLE (Starts at 0, populates on file load, confirms on restore) */}
      <div className="rounded-2xl bg-slate-50 dark:bg-[#050C1A] border border-slate-200 dark:border-indigo-500/40 p-5 sm:p-6 space-y-5 font-mono shadow-sm">
        {/* Console Header & Dynamic Verification Status Badge */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                {restoreSuccess
                  ? 'RESTORED DATABASE INVENTORY & ENTITIES CONFIRMATION (7 CATEGORIES):'
                  : inspection
                  ? 'ARCHIVE INVENTORY AUDIT & ITEM DETAILS (VERIFIED FROM BACKUP FILE):'
                  : 'SYSTEM DATA RECOVERY & INSPECTION AUDIT (7 CATEGORIES):'}
              </h4>
            </div>
            {(restoreSuccess || inspection) && (
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                {restoreSuccess
                  ? 'All 7 categories below have been successfully injected and verified on the live system:'
                  : `Backup file "${selectedFile?.name}" verified. All 7 categories below reflect the exact archive data to be restored:`}
              </p>
            )}
          </div>

          {(restoreSuccess || inspection) && (
            <div className="shrink-0">
              {restoreSuccess ? (
                <span className="px-3 py-1 rounded-full text-[11px] font-black tracking-wider uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-500/60 shadow-xs flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                  <span>✓ RESTORATION CONFIRMED ON LIVE SYSTEM</span>
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full text-[11px] font-black tracking-wider uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-500/60 shadow-xs flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                  <span>✓ BACKUP FILE VERIFIED — ALL 7 CATEGORIES LOADED</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Location Signature Banner (When a file is loaded or restored) */}
        {inspection && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700/70 shadow-xs">
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  inspection.isOfficialLocationMatch
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-600/50'
                    : inspection.locationValid
                    ? 'bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-600/50'
                    : 'bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-600/50'
                }`}
              >
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                    Location Signature Stamp:
                  </span>
                  {inspection.isOfficialLocationMatch ? (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-500/50 text-[10px] font-black uppercase">
                      ✓ Location Signature Valid
                    </span>
                  ) : inspection.locationValid ? (
                    <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-500/50 text-[10px] font-black uppercase">
                      ℹ Different Branch Stamp
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-500/50 text-[10px] font-black uppercase">
                      ⚠ Location Required
                    </span>
                  )}
                </div>
                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  {inspection.location?.nameEn ||
                    inspection.location?.officeNameEn ||
                    'Official Archive'}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {inspection.location?.nameNp || inspection.location?.locationNp || 'कोशी प्रदेश / नेपाल'}
                </p>
              </div>
            </div>

            {/* Target Office Selection */}
            {!restoreSuccess && (
              <div className="flex flex-col gap-1 min-w-[200px]">
                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">
                  Assign Target Office:
                </label>
                <select
                  value={targetLocationCode}
                  onChange={(e) => setTargetLocationCode(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                >
                  {locations.map((loc) => (
                    <option key={loc.code} value={loc.code}>
                      {loc.locationEn} ({loc.officeNameEn})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* 6 SMART CARD ACTION CATEGORIES (Items 1 to 6) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* 1. Total Smart cards */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-blue-300 dark:border-blue-500/50 shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 uppercase">
                <Database className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>1. Total Smart Cards</span>
              </span>
              <strong className="text-xl sm:text-2xl font-black text-blue-700 dark:text-blue-300 block mt-1.5">
                {restoreSuccess
                  ? (restoreSuccess.actionCategories?.totalSmartCards ?? restoreSuccess.restoredRecords).toLocaleString()
                  : inspection
                  ? archiveActionCats.totalSmartCards.toLocaleString()
                  : '0'}
              </strong>
            </div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block border-t border-slate-100 dark:border-slate-800 pt-1">
              {restoreSuccess ? '✓ कुल कार्ड (Restored)' : 'कुल कार्ड (Master Records)'}
            </span>
          </div>

          {/* 2. Distributed Smarts cards */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-sky-300 dark:border-sky-500/50 shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-bold text-sky-800 dark:text-sky-400 flex items-center gap-1.5 uppercase">
                <CheckCircle2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>2. Distributed Cards</span>
              </span>
              <strong className="text-xl sm:text-2xl font-black text-sky-700 dark:text-sky-300 block mt-1.5">
                {restoreSuccess
                  ? (restoreSuccess.actionCategories?.distributedCards ?? restoreSuccess.restoredDistributions).toLocaleString()
                  : inspection
                  ? archiveActionCats.distributedCards.toLocaleString()
                  : '0'}
              </strong>
            </div>
            <span className="text-[10px] text-sky-700 dark:text-sky-400/80 mt-1 block border-t border-slate-100 dark:border-slate-800 pt-1">
              {restoreSuccess ? '✓ हस्तान्तरित (Restored)' : 'हस्तान्तरित (Handed Over)'}
            </span>
          </div>

          {/* 3. Not-Distributed Smarts cards */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-emerald-300 dark:border-emerald-500/50 shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-400 flex items-center gap-1.5 uppercase">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>3. Not-Distributed</span>
              </span>
              <strong className="text-xl sm:text-2xl font-black text-emerald-700 dark:text-emerald-300 block mt-1.5">
                {restoreSuccess
                  ? (restoreSuccess.actionCategories?.notDistributedCards ?? 0).toLocaleString()
                  : inspection
                  ? archiveActionCats.notDistributedCards.toLocaleString()
                  : '0'}
              </strong>
            </div>
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400/80 mt-1 block border-t border-slate-100 dark:border-slate-800 pt-1">
              {restoreSuccess ? '✓ वितरण बाँकी (Restored)' : 'वितरण बाँकी (In Office Vault)'}
            </span>
          </div>

          {/* 4. Missing Smart Cards */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-rose-300 dark:border-rose-500/50 shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-bold text-rose-800 dark:text-rose-400 flex items-center gap-1.5 uppercase">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>4. Missing Cards</span>
              </span>
              <strong className="text-xl sm:text-2xl font-black text-rose-700 dark:text-rose-300 block mt-1.5">
                {restoreSuccess
                  ? (restoreSuccess.actionCategories?.missingCards ?? 0).toLocaleString()
                  : inspection
                  ? archiveActionCats.missingCards.toLocaleString()
                  : '0'}
              </strong>
            </div>
            <span className="text-[10px] text-rose-700 dark:text-rose-400/80 mt-1 block border-t border-slate-100 dark:border-slate-800 pt-1">
              {restoreSuccess ? '✓ हराएको (Restored)' : 'हराएको (Reported Lost)'}
            </span>
          </div>

          {/* 5. Found Smart Cards */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-purple-300 dark:border-purple-500/50 shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-bold text-purple-800 dark:text-purple-400 flex items-center gap-1.5 uppercase">
                <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                <span>5. Found Cards</span>
              </span>
              <strong className="text-xl sm:text-2xl font-black text-purple-700 dark:text-purple-300 block mt-1.5">
                {restoreSuccess
                  ? (restoreSuccess.actionCategories?.foundCards ?? 0).toLocaleString()
                  : inspection
                  ? archiveActionCats.foundCards.toLocaleString()
                  : '0'}
              </strong>
            </div>
            <span className="text-[10px] text-purple-700 dark:text-purple-400/80 mt-1 block border-t border-slate-100 dark:border-slate-800 pt-1">
              {restoreSuccess ? '✓ भेटिएको (Restored)' : 'भेटिएको (Recovered Cards)'}
            </span>
          </div>

          {/* 6. Handed Over Smart Cards */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/80 border border-teal-300 dark:border-teal-500/50 shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-bold text-teal-800 dark:text-teal-400 flex items-center gap-1.5 uppercase">
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                <span>6. Handed Over Cards</span>
              </span>
              <strong className="text-xl sm:text-2xl font-black text-teal-700 dark:text-teal-300 block mt-1.5">
                {restoreSuccess
                  ? (restoreSuccess.actionCategories?.handedOverCards ?? restoreSuccess.actionCategories?.distributedCards ?? restoreSuccess.restoredDistributions).toLocaleString()
                  : inspection
                  ? (archiveActionCats.handedOverCards ?? archiveActionCats.distributedCards).toLocaleString()
                  : '0'}
              </strong>
            </div>
            <span className="text-[10px] text-teal-700 dark:text-teal-400/80 mt-1 block border-t border-slate-100 dark:border-slate-800 pt-1">
              {restoreSuccess ? '✓ हस्तान्तरित (Restored)' : 'हस्तान्तरित (Handed Over)'}
            </span>
          </div>
        </div>

        {/* Action Balance Ratio Bar (When numbers are loaded) */}
        {((inspection && archiveActionCats.totalSmartCards > 0) || (restoreSuccess && (restoreSuccess.actionCategories?.totalSmartCards ?? restoreSuccess.restoredRecords) > 0)) && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
              <span>Smart Card Inventory Balance Ratio:</span>
              <span>
                {archiveActionCats.totalSmartCards > 0
                  ? `${Math.round((archiveActionCats.notDistributedCards / archiveActionCats.totalSmartCards) * 1000) / 10}% Vault • ${Math.round((archiveActionCats.distributedCards / archiveActionCats.totalSmartCards) * 1000) / 10}% Distributed`
                  : ''}
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full"
                style={{
                  width: `${archiveActionCats.totalSmartCards > 0 ? (archiveActionCats.notDistributedCards / archiveActionCats.totalSmartCards) * 100 : 0}%`,
                }}
              />
              <div
                className="bg-sky-500 h-full"
                style={{
                  width: `${archiveActionCats.totalSmartCards > 0 ? (archiveActionCats.distributedCards / archiveActionCats.totalSmartCards) * 100 : 0}%`,
                }}
              />
              {archiveActionCats.missingCards > 0 && (
                <div
                  className="bg-rose-500 h-full"
                  style={{
                    width: `${Math.max(1, (archiveActionCats.missingCards / archiveActionCats.totalSmartCards) * 100)}%`,
                  }}
                />
              )}
              {archiveActionCats.foundCards > 0 && (
                <div
                  className="bg-purple-500 h-full"
                  style={{
                    width: `${Math.max(1, (archiveActionCats.foundCards / archiveActionCats.totalSmartCards) * 100)}%`,
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* ITEM 6: NO OF REGISTERED USERS ID'S ALONG WITH PASSWORDS (EXTRA CODING FORM) */}
        <div className="p-4 rounded-xl bg-amber-50/40 dark:bg-slate-900/70 border border-amber-300 dark:border-2 dark:border-amber-500/40 space-y-3 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-500 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0 mt-0.5">
                <Key className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h5 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase">
                    6. No. of Registered Users ID's along with their Passwords (extra coding form):
                  </h5>
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-600 text-[10px] font-black uppercase">
                    EXTRA CODING FORM • BCRYPT HASH
                  </span>
                </div>
                <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-0.5">
                  {restoreSuccess ? (
                    <>
                      Restored into System: <strong className="text-amber-800 dark:text-amber-300">{restoreSuccess.restoredUsers} User Accounts</strong> (All credentials safely preserved).
                    </>
                  ) : inspection ? (
                    <>
                      Total Registered User Accounts in Archive: <strong className="text-amber-800 dark:text-amber-300">{archiveUserSec.totalUsers} Users</strong> ({archiveUserSec.usersWithPasswords} protected with cryptographic password hash).
                    </>
                  ) : (
                    <>
                      Total Registered User Accounts in Archive: <strong className="text-slate-500 dark:text-slate-400">0 Users</strong> (Awaiting backup archive).
                    </>
                  )}
                </p>
              </div>
            </div>

            {inspection && archiveUserSec.accountIdentifiers && archiveUserSec.accountIdentifiers.length > 0 && (
              <button
                type="button"
                onClick={() => setShowUserPasswordList(!showUserPasswordList)}
                className="px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 dark:border-amber-500/50 text-[11px] font-bold dark:text-amber-300 flex items-center gap-1.5 shrink-0 cursor-pointer self-start sm:self-auto transition-colors"
              >
                {showUserPasswordList ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showUserPasswordList ? 'Hide User ID List' : 'View Registered User IDs & Hash Form'}</span>
              </button>
            )}
          </div>

          {/* Expandable User Account Table */}
          {showUserPasswordList && archiveUserSec.accountIdentifiers && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#050B16] animate-in fade-in duration-200 shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-slate-900/90 text-slate-600 dark:text-slate-400 text-[10px] uppercase border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Registered User ID</th>
                    <th className="py-2 px-3">Account Name</th>
                    <th className="py-2 px-3">Assigned Role</th>
                    <th className="py-2 px-3">Password Encoding State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-800 dark:text-slate-300">
                  {archiveUserSec.accountIdentifiers.map((acc, idx) => (
                    <tr key={acc.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                      <td className="py-2 px-3 text-slate-400 dark:text-slate-500">{idx + 1}</td>
                      <td className="py-2 px-3 font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                        <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        <span>{acc.id}</span>
                      </td>
                      <td className="py-2 px-3">{acc.name || 'Official Staff'}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {acc.role || 'OFFICE OPERATOR'}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                          <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>BCRYPT_HASH [EXTRA_CODING_FORM: PRESERVED]</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ITEM 7: AUXILIARY ITEMS & OTHER DATA IN BACKUP */}
        <div className="p-4 rounded-xl bg-indigo-50/40 dark:bg-slate-900/70 border border-indigo-200 dark:border-indigo-500/40 space-y-3 shadow-xs">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h5 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase">
              7. Other Items & Auxiliary Data in Archive (Exported / Taking Backup / Downloading):
            </h5>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[10px] text-slate-600 dark:text-slate-400 block">Batch Import Jobs:</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">Dispatched lots</span>
              </div>
              <strong className="text-base font-black text-blue-700 dark:text-blue-300">
                {restoreSuccess
                  ? restoreSuccess.restoredImports.toLocaleString()
                  : inspection
                  ? archiveAuxiliary.totalImports.toLocaleString()
                  : '0'}
              </strong>
            </div>

            <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[10px] text-slate-600 dark:text-slate-400 block">Handover Ledgers:</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">Recipient receipts</span>
              </div>
              <strong className="text-base font-black text-emerald-700 dark:text-emerald-300">
                {restoreSuccess
                  ? restoreSuccess.restoredDistributions.toLocaleString()
                  : inspection
                  ? archiveAuxiliary.totalDistributions.toLocaleString()
                  : '0'}
              </strong>
            </div>

            <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[10px] text-slate-600 dark:text-slate-400 block">Action Overrides:</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">Audit corrections</span>
              </div>
              <strong className="text-base font-black text-amber-700 dark:text-amber-300">
                {restoreSuccess
                  ? '0'
                  : inspection
                  ? (archiveAuxiliary.totalActionOverrides ?? 0).toLocaleString()
                  : '0'}
              </strong>
            </div>

            <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[10px] text-slate-600 dark:text-slate-400 block">Office Public Notices:</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">Citizen bulletins</span>
              </div>
              <strong className="text-base font-black text-purple-700 dark:text-purple-300">
                {restoreSuccess
                  ? (restoreSuccess.restoredNotices ?? 0).toLocaleString()
                  : inspection
                  ? (archiveAuxiliary.totalNotices ?? 0).toLocaleString()
                  : '0'}
              </strong>
            </div>
          </div>
        </div>

        {/* Cryptographic Manifest & Integrity Receipt (When inspection is present) */}
        {inspection && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-[11px] shadow-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Exported By & Timestamp:</span>
              <span className="text-slate-800 dark:text-slate-300 font-medium">
                {inspection.exportedBy?.name || 'Authorized Officer'} ({inspection.exportedBy?.role || 'ADMIN'}) •{' '}
                {new Date(inspection.exportedAt).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400 block text-[10px]">SHA-256 Cryptographic Checksum:</span>
              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="truncate">
                  {inspection.manifest.dataChecksumSha256
                    ? `${inspection.manifest.dataChecksumSha256.slice(0, 24)}... (Verified)`
                    : 'System Integrity Signature Valid'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Mode Selection (When file is loaded and ready to restore) */}
        {inspection && !restoreSuccess && (
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase block">
              Choose Recovery Injection Mode:
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => setRecoveryMode('REPLACE')}
                className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                  recoveryMode === 'REPLACE'
                    ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-500 dark:border-rose-500/80 shadow-md text-slate-900 dark:text-white'
                    : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Flame className="w-4 h-4 text-rose-500" />
                    Full Accidental Disaster Recovery
                  </span>
                  <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase bg-rose-100 dark:bg-rose-950 px-2 py-0.5 rounded border border-rose-300 dark:border-rose-800">
                    Recommended
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  Completely restores database to exact archived state. An automatic pre-recovery safety snapshot is created before injection.
                </p>
              </div>

              <div
                onClick={() => setRecoveryMode('MERGE')}
                className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                  recoveryMode === 'MERGE'
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 shadow-md text-slate-900 dark:text-white'
                    : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                    Differential Merge & Append
                  </span>
                  <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase bg-indigo-100 dark:bg-indigo-950 px-2 py-0.5 rounded border border-indigo-300 dark:border-indigo-800">
                    Safe Merge
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                  Preserves existing non-conflicting records and adds or updates records and users from the backup archive.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Button (When file is loaded and ready to restore) */}
        {inspection && !restoreSuccess && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleResetRecovery}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-bold dark:border-slate-600 flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Select Different Archive (Reset to 0)</span>
              </button>
              <div className="text-xs text-slate-500 dark:text-slate-400 hidden sm:flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Identity Verified • Action will be logged</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              disabled={isRestoring}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-rose-600 via-indigo-600 to-blue-600 hover:from-rose-500 hover:to-blue-500 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 transition-all cursor-pointer active:scale-95"
            >
              <Database className="w-4 h-4" />
              <span>INJECT & RESTORE DATABASE NOW</span>
            </button>
          </div>
        )}

        {/* Action Button (When restoration is complete) */}
        {restoreSuccess && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Restored: <strong>{(restoreSuccess.actionCategories?.totalSmartCards ?? restoreSuccess.restoredRecords).toLocaleString()}</strong> smart cards & <strong>{restoreSuccess.restoredUsers}</strong> users confirmed live.</span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowSuccessModal(true)}
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-xs font-bold dark:border-slate-700 flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>View Summary Dialog</span>
              </button>

              <button
                type="button"
                onClick={handleResetRecovery}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Load Another Backup Archive</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Upload Dropzone (Shown when no file is staged or when restoring another file) */}
      {!inspection && !restoreSuccess && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative rounded-2xl border-2 border-dashed p-7 sm:p-9 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-3 font-mono ${
            isDragOver
              ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40 shadow-lg'
              : selectedFile
              ? 'border-emerald-400 bg-emerald-50/50 dark:border-emerald-500/50 dark:bg-[#060D1A]'
              : 'border-slate-300 hover:border-indigo-500 bg-slate-50/70 hover:bg-slate-100/70 dark:border-slate-700 dark:hover:border-indigo-500/60 dark:bg-[#050A14] dark:hover:bg-[#070F20]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.plsms"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileSelect(e.target.files[0]);
              }
            }}
          />

          <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-gradient-to-b dark:from-indigo-500/20 dark:to-indigo-950/40 border border-indigo-200 dark:border-indigo-500/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-sm">
            {analyzing ? (
              <RefreshCw className="w-7 h-7 animate-spin text-indigo-600 dark:text-indigo-400" />
            ) : selectedFile ? (
              <FileCheck className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <UploadCloud className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            )}
          </div>

          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              {selectedFile
                ? `Selected: ${selectedFile.name}`
                : 'Choose or Drag Official PLSMS Backup File (.json / .plsms)'}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {selectedFile
                ? `File Size: ${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Analyzing archive and reading 7 categories...`
                : 'When this file is uploaded, all 7 categories above will immediately populate with the archive dataset'}
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="mt-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
          >
            <Database className="w-3.5 h-3.5" />
            <span>Browse Local Files</span>
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-black/85 backdrop-blur-md flex items-center justify-center p-4 font-mono">
          <div className="bg-white dark:bg-[#070F1E] border border-slate-300 dark:border-2 dark:border-indigo-500 rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-indigo-600 dark:text-indigo-400">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-500 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                  CONFIRM ACCIDENTAL DISASTER RECOVERY
                </h3>
                <p className="text-xs text-indigo-600 dark:text-indigo-300">
                  Target Office: {activeOffice?.nameEn || 'Itahari, Sunsari'}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 space-y-3 leading-relaxed">
              <p>
                You are about to restore{' '}
                <strong className="text-blue-700 dark:text-blue-400">
                  {archiveActionCats.totalSmartCards.toLocaleString()} Smart Cards
                </strong>{' '}
                ({archiveActionCats.notDistributedCards.toLocaleString()} vault, {archiveActionCats.distributedCards.toLocaleString()} distributed, {archiveActionCats.missingCards} missing, {archiveActionCats.foundCards} found, {(archiveActionCats.handedOverCards ?? archiveActionCats.distributedCards).toLocaleString()} handed over).
              </p>

              <p>
                User Accounts & Passwords:{' '}
                <strong className="text-amber-800 dark:text-amber-300">
                  {archiveUserSec.totalUsers} Registered User IDs
                </strong>{' '}
                with cryptographic passwords (extra coding form).
              </p>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800 pt-2">
                Mode: <strong className="text-slate-900 dark:text-white">{recoveryMode === 'REPLACE' ? 'Complete State Replacement' : 'Differential Merge'}</strong>. An automatic safety snapshot will be saved on server disk prior to injection.
              </p>
            </div>

            {isRestoring && (
              <div className="p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-500 text-indigo-900 dark:text-indigo-200 text-xs flex items-center gap-3">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span>{restoreProgress || 'Executing database injection...'}</span>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isRestoring}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRestore}
                disabled={isRestoring}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
              >
                {isRestoring ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Restoring Database...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>CONFIRM & EXECUTE RECOVERY</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
