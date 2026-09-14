import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  FileCheck,
  Download,
  Database,
  Layers,
  Settings2,
  Table,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../../services/api';
import { ColumnMapping, ImportJob } from '../../types';
import { GoogleSheetsSyncPanel } from './GoogleSheetsSyncPanel';
import { BackupDisasterRecoveryPanel } from './BackupDisasterRecoveryPanel';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, isSuperAdminUser, canAccessUploadCenter } from '../../utils/permissions';

interface Props {
  onImportComplete: () => void;
  resetProductionDataSection?: React.ReactNode;
}

export const UploadCenterView: React.FC<Props> = ({ onImportComplete, resetProductionDataSection }) => {
  const { user } = useAuth();
  const isSuperAdmin = isSuperAdminUser(user);
  const isAuthorizedUploadCenter = isSuperAdmin || canAccessUploadCenter(user);

  // Strictly check permissions:
  // If the user has NOT been given permission for the Upload Center by the Super User, all access is denied (stopped completely and strictly).
  // If the Super User has granted them permission for the Upload Center, ensure they can access the upload & sync engines.
  const canUploadExcel = isAuthorizedUploadCenter;
  const canSync = isAuthorizedUploadCenter;

  const canConfigureDaemon = isAuthorizedUploadCenter && (
    isSuperAdmin ||
    hasPermission(user, 'settings.sync_interval') ||
    hasPermission(user, 'uploads.sync_interval') ||
    isAuthorizedUploadCenter
  );

  const canBackupRestore = isAuthorizedUploadCenter && (
    isSuperAdmin ||
    hasPermission(user, 'cloud.backup_restore') ||
    hasPermission(user, 'cloud.backup_create') ||
    hasPermission(user, 'settings.backup_manage') ||
    user?.role === 'SUPER ADMIN' ||
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMINISTRATOR' ||
    user?.role === 'ADMIN'
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload Step State: 'SELECT' -> 'MAP_AND_PREVIEW' -> 'PROCESSING' -> 'SUCCESS'
  const [step, setStep] = useState<'SELECT' | 'MAP_AND_PREVIEW' | 'PROCESSING' | 'SUCCESS'>('SELECT');
  const [activeTab, setActiveTab] = useState<'GOOGLE_SHEETS' | 'OFFLINE_EXCEL' | 'BACKUP_RECOVERY'>(() => {
    if (canSync) return 'GOOGLE_SHEETS';
    if (canUploadExcel) return 'OFFLINE_EXCEL';
    if (canBackupRestore) return 'BACKUP_RECOVERY';
    return 'GOOGLE_SHEETS';
  });

  // Keep activeTab pointing to an authorized tab if permissions change or on initial load
  useEffect(() => {
    if (activeTab === 'GOOGLE_SHEETS' && !canSync) {
      if (canUploadExcel) setActiveTab('OFFLINE_EXCEL');
      else if (canBackupRestore) setActiveTab('BACKUP_RECOVERY');
    } else if (activeTab === 'OFFLINE_EXCEL' && !canUploadExcel) {
      if (canSync) setActiveTab('GOOGLE_SHEETS');
      else if (canBackupRestore) setActiveTab('BACKUP_RECOVERY');
    } else if (activeTab === 'BACKUP_RECOVERY' && !canBackupRestore) {
      if (canSync) setActiveTab('GOOGLE_SHEETS');
      else if (canUploadExcel) setActiveTab('OFFLINE_EXCEL');
    }
  }, [canSync, canUploadExcel, canBackupRestore, activeTab]);

  // Compute effective active tab to guarantee an authorized tab is rendered
  const effectiveTab: 'GOOGLE_SHEETS' | 'OFFLINE_EXCEL' | 'BACKUP_RECOVERY' | null = (
    activeTab === 'GOOGLE_SHEETS' && canSync ? 'GOOGLE_SHEETS' :
    activeTab === 'OFFLINE_EXCEL' && canUploadExcel ? 'OFFLINE_EXCEL' :
    activeTab === 'BACKUP_RECOVERY' && canBackupRestore ? 'BACKUP_RECOVERY' :
    canSync ? 'GOOGLE_SHEETS' :
    canUploadExcel ? 'OFFLINE_EXCEL' :
    canBackupRestore ? 'BACKUP_RECOVERY' :
    null
  );

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState('');

  // Preview data received from server
  const [previewData, setPreviewData] = useState<{
    filePath: string;
    fileName: string;
    fileSize: number;
    totalRows: number;
    detectedHeaders: string[];
    previewRows: any[];
  } | null>(null);

  // Dynamic Column Mapping State
  const [mapping, setMapping] = useState<ColumnMapping>({
    licenseNumber: '',
    applicationNumber: '',
    holderName: '',
    office: '',
    phone: '',
    nidOrPassport: '',
    dateOfBirth: '',
    address: '',
    licenseType: '',
    issueDate: '',
    expiryDate: '',
    status: '',
    smartCardSerial: '',
  });

  // Import Result
  const [importResult, setImportResult] = useState<ImportJob | null>(null);
  const [processingProgress, setProcessingProgress] = useState(0);

  const handleFileChange = async (file: File) => {
    if (!file) return;
    setError('');
    setSelectedFile(file);
    setLoadingPreview(true);

    try {
      const res = await api.previewUpload(file);
      setPreviewData({
        filePath: res.filePath,
        fileName: res.fileName,
        fileSize: res.fileSize,
        totalRows: res.totalRows,
        detectedHeaders: res.detectedHeaders,
        previewRows: res.previewRows,
      });

      // Populate mapping with auto-detected suggestions
      setMapping({
        licenseNumber: res.suggestedMapping.licenseNumber || res.detectedHeaders[0] || '',
        holderName: res.suggestedMapping.holderName || res.detectedHeaders[1] || '',
        applicationNumber: res.suggestedMapping.applicationNumber || '',
        office: res.suggestedMapping.office || '',
        phone: res.suggestedMapping.phone || '',
        nidOrPassport: res.suggestedMapping.nidOrPassport || '',
        dateOfBirth: res.suggestedMapping.dateOfBirth || '',
        address: res.suggestedMapping.address || '',
        licenseType: res.suggestedMapping.licenseType || '',
        issueDate: res.suggestedMapping.issueDate || '',
        expiryDate: res.suggestedMapping.expiryDate || '',
        status: res.suggestedMapping.status || '',
        smartCardSerial: res.suggestedMapping.smartCardSerial || '',
      });

      setStep('MAP_AND_PREVIEW');
    } catch (err: any) {
      setError(err.message || 'Failed to parse Excel/CSV file.');
      setSelectedFile(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleConfirmImport = async () => {
    if (!previewData) return;
    if (!mapping.licenseNumber || !mapping.holderName) {
      setError('License Number and Holder Name mapping are required.');
      return;
    }

    try {
      setStep('PROCESSING');
      setError('');
      setProcessingProgress(30);

      const progressInterval = setInterval(() => {
        setProcessingProgress((prev) => (prev < 90 ? prev + 15 : prev));
      }, 300);

      const res = await api.processUpload({
        filePath: previewData.filePath,
        fileName: previewData.fileName,
        fileSize: previewData.fileSize,
        mapping,
      });

      clearInterval(progressInterval);
      setProcessingProgress(100);

      setImportResult(res.importJob);
      setStep('SUCCESS');
      window.dispatchEvent(new CustomEvent('records-updated'));
      onImportComplete();
    } catch (err: any) {
      setError(err.message || 'Batch import failed.');
      setStep('MAP_AND_PREVIEW');
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setPreviewData(null);
    setImportResult(null);
    setError('');
    setStep('SELECT');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Top Method Switcher */}
      {(canSync || canUploadExcel || canBackupRestore) && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {canSync && (
              <button
                type="button"
                id="btn-tab-google-sheets"
                onClick={() => setActiveTab('GOOGLE_SHEETS')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center gap-2.5 cursor-pointer select-none ${
                  effectiveTab === 'GOOGLE_SHEETS'
                    ? 'bg-rose-100 dark:bg-gradient-to-r dark:from-[#04281e] dark:via-[#063327] dark:to-[#04281e] text-teal-950 dark:text-teal-100 border-2 border-teal-600 dark:border-teal-400 shadow-[0_4px_16px_rgba(20,184,166,0.25)] dark:shadow-[0_0_22px_rgba(20,184,166,0.45)] ring-3 ring-teal-500/25 dark:ring-teal-400/35 font-black scale-[1.02]'
                    : 'bg-rose-100 hover:bg-rose-200 dark:bg-[#061e19]/60 text-teal-800 dark:text-teal-300 hover:border-teal-300 dark:hover:bg-[#092b23] border border-teal-200/80 dark:border-teal-900/60 dark:hover:border-teal-700 hover:text-teal-950 dark:hover:text-teal-100 shadow-xs'
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    effectiveTab === 'GOOGLE_SHEETS'
                      ? 'bg-teal-500 dark:bg-teal-400 ring-3 ring-teal-400/60 dark:ring-teal-400/80 animate-pulse'
                      : 'bg-teal-400/70 dark:bg-teal-500/60'
                  }`}
                />
                <span>GOOGLE SHEETS LIVE SYNC ENGINE</span>
              </button>
            )}

            {canUploadExcel && (
              <button
                type="button"
                id="btn-tab-offline-excel"
                onClick={() => setActiveTab('OFFLINE_EXCEL')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center gap-2.5 cursor-pointer select-none ${
                  effectiveTab === 'OFFLINE_EXCEL'
                    ? 'bg-rose-100 dark:bg-gradient-to-r dark:from-[#082343] dark:via-[#0c2e56] dark:to-[#082343] text-sky-950 dark:text-sky-100 border-2 border-sky-600 dark:border-sky-400 shadow-[0_4px_16px_rgba(14,165,233,0.25)] dark:shadow-[0_0_22px_rgba(56,189,248,0.45)] ring-3 ring-sky-500/25 dark:ring-sky-400/35 font-black scale-[1.02]'
                    : 'bg-rose-100 hover:bg-rose-200 dark:bg-[#071b2f]/60 text-sky-800 dark:text-sky-300 hover:border-sky-300 dark:hover:bg-[#0b2742] border border-sky-200/80 dark:border-sky-900/60 dark:hover:border-sky-700 hover:text-sky-950 dark:hover:text-sky-100 shadow-xs'
                }`}
              >
                <FileSpreadsheet
                  className={`w-4 h-4 transition-all ${
                    effectiveTab === 'OFFLINE_EXCEL'
                      ? 'text-sky-600 dark:text-sky-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]'
                      : 'text-sky-600/70 dark:text-sky-400/70'
                  }`}
                />
                <span>OFFLINE EXCEL / CSV STEP MAPPER</span>
              </button>
            )}

            {canBackupRestore && (
              <button
                type="button"
                id="btn-tab-backup-recovery"
                onClick={() => setActiveTab('BACKUP_RECOVERY')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center gap-2.5 cursor-pointer select-none ${
                  effectiveTab === 'BACKUP_RECOVERY'
                    ? 'bg-rose-100 dark:bg-gradient-to-r dark:from-[#17163f] dark:via-[#1e1c50] dark:to-[#17163f] text-indigo-950 dark:text-indigo-100 border-2 border-indigo-600 dark:border-indigo-400 shadow-[0_4px_16px_rgba(99,102,241,0.25)] dark:shadow-[0_0_22px_rgba(129,140,248,0.45)] ring-3 ring-indigo-500/25 dark:ring-indigo-400/35 font-black scale-[1.02]'
                    : 'bg-rose-100 hover:bg-rose-200 dark:bg-[#12122b]/60 text-indigo-800 dark:text-indigo-300 hover:border-indigo-300 dark:hover:bg-[#1a1a3d] border border-indigo-200/80 dark:border-indigo-900/60 dark:hover:border-indigo-700 hover:text-indigo-950 dark:hover:text-indigo-100 shadow-xs'
                }`}
              >
                <ShieldAlert
                  className={`w-4 h-4 transition-all ${
                    effectiveTab === 'BACKUP_RECOVERY'
                      ? 'text-indigo-600 dark:text-indigo-300 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]'
                      : 'text-indigo-600/70 dark:text-indigo-400/70'
                  }`}
                />
                <span>ACCIDENTAL BACKUP AND DISASTER RECOVERY INJECTOR</span>
              </button>
            )}
          </div>

          {step !== 'SELECT' && effectiveTab === 'OFFLINE_EXCEL' && canUploadExcel && (
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-[#101b2e] dark:hover:bg-slate-800 dark:text-slate-200 dark:border dark:border-slate-700 font-bold rounded-xl text-xs transition-colors self-start sm:self-auto cursor-pointer"
            >
              Cancel & Upload Another
            </button>
          )}
        </div>
      )}

      {effectiveTab === 'GOOGLE_SHEETS' ? (
        <GoogleSheetsSyncPanel onSyncCompleted={onImportComplete} />
      ) : effectiveTab === 'OFFLINE_EXCEL' ? (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Excel & CSV Batch Upload Engine
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Process high-volume driving license dispatch files with automatic column detection and normalized JSON archiving.
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-4 rounded-2xl text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              {error}
            </div>
          )}

          {/* STEP 1: SELECT FILE */}
      {step === 'SELECT' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 rounded-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-emerald-950 dark:text-emerald-300">Inbuilt Official Excel Template</h4>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-400">
                  Pre-configured with standard Nepal Government Transport Management Office structure.
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  const { blob, filename } = await api.generateExcelReport({ reportType: 'TOTAL_SMART_CARDS', format: 'xlsx' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = filename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  window.URL.revokeObjectURL(url);
                } catch (err: any) {
                  setError(err.message || 'Failed to download template.');
                }
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 self-start sm:self-auto shrink-0 shadow-sm"
            >
              <Download className="w-4 h-4" />
              <span>Download Inbuilt Template</span>
            </button>
          </div>

          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="bg-white dark:bg-[#101b2e] border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 rounded-3xl p-12 text-center cursor-pointer transition-all hover:bg-slate-50/50 dark:hover:bg-[#14233c] group shadow-sm"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv, .tsv, .txt, .xlsm, .xlsb"
              onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
              className="hidden"
            />

            <div className="w-16 h-16 rounded-3xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center mx-auto mb-4 border border-indigo-100 dark:border-indigo-800/60 transition-all shadow-sm">
              {loadingPreview ? (
                <RefreshCw className="w-8 h-8 animate-spin" />
              ) : (
                <Upload className="w-8 h-8" />
              )}
            </div>

            <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              {loadingPreview ? 'Reading and Analyzing Spreadsheet...' : 'Drop Excel (.xlsx, .xls) or CSV File Here'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
              Supports monthly imports of 10,000 to 200,000+ license records with instantaneous background chunking.
            </p>

            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold border border-slate-200 dark:border-slate-700">
              <span>Or click to browse computer</span>
            </div>
          </div>

          {/* Engine Specs / Architecture highlights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-[#101b2e] p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3 border border-blue-200 dark:border-blue-800/60">
                <Sparkles className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Dynamic Header Mapping</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Works with any header names (Bengali, English, abbreviation). Map columns on the fly.
              </p>
            </div>

            <div className="bg-white dark:bg-[#101b2e] p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3 border border-emerald-200 dark:border-emerald-800/60">
                <Database className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Normalized JSON Backup</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Every uploaded batch is permanently archived in pure JSON format for rapid recovery.
              </p>
            </div>

            <div className="bg-white dark:bg-[#101b2e] p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-3 border border-purple-200 dark:border-purple-800/60">
                <Layers className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Duplicate Safety</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Preserves existing distribution statuses while seamlessly updating licensee profile records.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: DYNAMIC COLUMN MAPPING & ACTUAL ROW PREVIEW */}
      {step === 'MAP_AND_PREVIEW' && previewData && (
        <div className="space-y-6">
          {/* File Meta Banner */}
          <div className="bg-indigo-900 text-white rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-white backdrop-blur-sm">
                <FileCheck className="w-6 h-6 text-indigo-300" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider block">
                  File Analyzed
                </span>
                <h3 className="text-base font-bold text-white">{previewData.fileName}</h3>
                <div className="text-xs text-indigo-200 flex items-center gap-3 mt-0.5 font-medium">
                  <span>{(previewData.fileSize / 1024).toFixed(1)} KB</span>
                  <span>•</span>
                  <span>{previewData.totalRows.toLocaleString()} Rows Found</span>
                  <span>•</span>
                  <span>{previewData.detectedHeaders.length} Columns Detected</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleConfirmImport}
              className="px-6 py-3 bg-white hover:bg-slate-100 text-indigo-950 font-bold rounded-2xl text-xs shadow-lg transition-all flex items-center gap-2 shrink-0"
            >
              <span>Confirm & Process Import</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Column Mapping Section */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-indigo-600" />
                  Dynamic Column Mapper
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Confirm which spreadsheet headers correspond to PLSMS license entity attributes.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {/* Mandatory: License Number */}
              <div>
                <label className="block text-xs font-bold text-indigo-950 uppercase tracking-wider mb-1">
                  License Number <span className="text-red-500">*</span>
                </label>
                <select
                  value={mapping.licenseNumber}
                  onChange={(e) => setMapping({ ...mapping, licenseNumber: e.target.value })}
                  className="w-full p-2.5 bg-indigo-50/60 border-2 border-indigo-200 rounded-xl text-xs font-bold text-indigo-950 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- Select Column --</option>
                  {previewData.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mandatory: Holder Name */}
              <div>
                <label className="block text-xs font-bold text-indigo-950 uppercase tracking-wider mb-1">
                  Applicant / Holder Name <span className="text-red-500">*</span>
                </label>
                <select
                  value={mapping.holderName}
                  onChange={(e) => setMapping({ ...mapping, holderName: e.target.value })}
                  className="w-full p-2.5 bg-indigo-50/60 border-2 border-indigo-200 rounded-xl text-xs font-bold text-indigo-950 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- Select Column --</option>
                  {previewData.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Application Number */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Application / Ref No
                </label>
                <select
                  value={mapping.applicationNumber}
                  onChange={(e) => setMapping({ ...mapping, applicationNumber: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- Auto-Generate from License No --</option>
                  {previewData.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Issuing Office */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Issuing Office / Branch
                </label>
                <select
                  value={mapping.office}
                  onChange={(e) => setMapping({ ...mapping, office: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- Default (Central Office) --</option>
                  {previewData.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Contact Phone
                </label>
                <select
                  value={mapping.phone}
                  onChange={(e) => setMapping({ ...mapping, phone: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- None --</option>
                  {previewData.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* NID / Passport */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  National ID / Passport
                </label>
                <select
                  value={mapping.nidOrPassport}
                  onChange={(e) => setMapping({ ...mapping, nidOrPassport: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- None --</option>
                  {previewData.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* License Category */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  License Category / Type
                </label>
                <select
                  value={mapping.licenseType}
                  onChange={(e) => setMapping({ ...mapping, licenseType: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- Default (Smart Card License) --</option>
                  {previewData.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Issue Date */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Issue / Print Date
                </label>
                <select
                  value={mapping.issueDate}
                  onChange={(e) => setMapping({ ...mapping, issueDate: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- None --</option>
                  {previewData.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              {/* Expiry Date */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Expiry Date
                </label>
                <select
                  value={mapping.expiryDate}
                  onChange={(e) => setMapping({ ...mapping, expiryDate: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- None --</option>
                  {previewData.detectedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Actual Sample Rows Preview Table */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Table className="w-4 h-4 text-indigo-600" />
                Actual Row Preview (First {previewData.previewRows.length} Rows of {previewData.totalRows.toLocaleString()})
              </h3>
              <span className="text-[11px] font-bold text-slate-400">Pure Real Data</span>
            </div>

            <div className="overflow-x-auto border border-slate-300 dark:border-[#1E3B66] rounded-xl bg-white dark:bg-[#071326] shadow-xs">
              <table className="w-full text-left text-[13px] border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#0B172B] border-b border-slate-300 dark:border-[#1E3B66] text-slate-700 dark:text-slate-300 font-mono font-bold uppercase tracking-wider text-[11px]">
                    <th className="p-3 border-r border-slate-300 dark:border-[#1E3B66] text-center w-12">#</th>
                    {previewData.detectedHeaders.map((header, hIdx) => (
                      <th
                        key={header}
                        className={`p-3 whitespace-nowrap ${
                          hIdx < previewData.detectedHeaders.length - 1 ? 'border-r border-slate-300 dark:border-[#1E3B66]' : ''
                        }`}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 dark:divide-[#1E3B66] font-medium text-slate-800 dark:text-slate-200 text-[13px]">
                  {previewData.previewRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-[#0B172B]/60 border-b border-slate-300 dark:border-[#1E3B66] last:border-b-0">
                      <td className="p-3 text-slate-500 dark:text-slate-400 font-mono text-center border-r border-slate-300 dark:border-[#1E3B66]">{idx + 1}</td>
                      {previewData.detectedHeaders.map((header, cIdx) => (
                        <td
                          key={header}
                          className={`p-3 whitespace-nowrap truncate max-w-[200px] ${
                            cIdx < previewData.detectedHeaders.length - 1 ? 'border-r border-slate-300 dark:border-[#1E3B66]' : ''
                          }`}
                        >
                          {String(row[header] || '-')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: PROCESSING PROGRESS BAR */}
      {step === 'PROCESSING' && (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 shadow-xl text-center space-y-6 max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-3xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto border border-indigo-100 animate-pulse">
            <Database className="w-8 h-8 animate-spin" />
          </div>

          <div>
            <h3 className="text-lg font-bold text-slate-900">Processing Batch Import</h3>
            <p className="text-xs text-slate-500 mt-1">
              Normalizing records to JSON, verifying duplicates, and building high-speed search indexes...
            </p>
          </div>

          <div className="space-y-2">
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${processingProgress}%` }}
              />
            </div>
            <span className="text-xs font-bold text-slate-600 font-mono">{processingProgress}% Completed</span>
          </div>
        </div>
      )}

      {/* STEP 4: SUCCESS SUMMARY & DOWNLOAD NORMALIZED JSON */}
      {step === 'SUCCESS' && importResult && (
        <div className="bg-white rounded-3xl p-8 sm:p-10 border border-slate-200 shadow-xl max-w-2xl mx-auto space-y-6 text-center animate-in fade-in zoom-in-95 duration-300">
          <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div>
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">
              Batch Import Completed Successfully
            </span>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
              {importResult.newRecords.toLocaleString()} License Records Added
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Original spreadsheet archived and normalized to permanent JSON storage. All search indexes refreshed.
            </p>
          </div>

          {/* Import Statistics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Rows</span>
              <span className="text-base font-bold text-slate-900 font-mono mt-0.5 block">
                {importResult.totalRows.toLocaleString()}
              </span>
            </div>

            <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-100">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">New Records</span>
              <span className="text-base font-bold text-emerald-950 font-mono mt-0.5 block">
                +{importResult.newRecords.toLocaleString()}
              </span>
            </div>

            <div className="p-3.5 bg-blue-50 rounded-2xl border border-blue-100">
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">Updated</span>
              <span className="text-base font-bold text-blue-950 font-mono mt-0.5 block">
                {importResult.updatedRecords.toLocaleString()}
              </span>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Duration</span>
              <span className="text-base font-bold text-slate-900 font-mono mt-0.5 block">
                {importResult.durationMs}ms
              </span>
            </div>
          </div>

          {/* Download JSON Backup */}
          <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-left">
            <div>
              <h4 className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <Database className="w-4 h-4 text-indigo-600" />
                Normalized JSON Archive Created
              </h4>
              <p className="text-[11px] text-indigo-900 mt-0.5">
                Permanent JSON copy saved at <span className="font-mono">{importResult.jsonStoragePath}</span>
              </p>
            </div>

            <a
              href={`/api/imports/${importResult.id}/download-json`}
              download
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-1.5 shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Download JSON Backup
            </a>
          </div>

          <button
            onClick={handleReset}
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl text-xs transition-colors"
          >
            Import Another Batch
          </button>
        </div>
      )}
        </div>
      ) : effectiveTab === 'BACKUP_RECOVERY' ? (
        <div className="space-y-6">
          <BackupDisasterRecoveryPanel onRecoveryCompleted={onImportComplete} />
          {resetProductionDataSection && (
            <div className="pt-6 border-t-2 border-slate-200 dark:border-[#1E3050]">
              {resetProductionDataSection}
            </div>
          )}
        </div>
      ) : (
        <div className="p-8 text-center bg-white dark:bg-[#101b2e] rounded-2xl border border-slate-200 dark:border-slate-800 max-w-2xl mx-auto shadow-sm">
          <div className="flex items-center justify-center gap-3 mb-2">
            <ShieldAlert className="w-6 h-6 text-rose-500" />
            <span className="text-sm font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider font-mono">
              ACCESS DENIED — UNAUTHORIZED
            </span>
          </div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
            Access Denied. You do not have permission to use the upload or sync engines.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Please contact the Super Administrator to grant Operational Console permissions in the Upload Center.
          </p>
        </div>
      )}
    </div>
  );
};
