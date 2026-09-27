import React, { useState, useEffect, useRef } from 'react';
import {
  FileSpreadsheet,
  ShieldCheck,
  Lock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Database,
  Layers,
  Clock,
  Info,
  X,
  KeyRound,
  UploadCloud,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../services/api';

interface SheetVerificationStep {
  step: number;
  name: string;
  status: 'PASS' | 'FAIL' | 'PENDING';
  message: string;
  details?: any;
}

interface Props {
  isSuperAdmin: boolean;
  onConfigChanged?: (config: any) => void;
}

export const GoogleSheetsConfigSection: React.FC<Props> = ({
  isSuperAdmin,
  onConfigChanged,
}) => {
  const [loadingConfig, setLoadingConfig] = useState<boolean>(true);
  const [activeConfig, setActiveConfig] = useState<any>(null);

  // Form fields & URL Locking / Edit state (SAVED URL -> temporary previousSavedUrl -> editable new URL)
  const [savedSheetUrl, setSavedSheetUrl] = useState<string>('');
  const [previousSavedSheetUrl, setPreviousSavedSheetUrl] = useState<string>('');
  const previousSavedSheetUrlRef = useRef<string>('');
  const [isEditingSheetUrl, setIsEditingSheetUrl] = useState<boolean>(false);
  const isEditingSheetUrlRef = useRef<boolean>(false);
  const sheetUrlInputRef = useRef<HTMLInputElement>(null);

  const [sheetUrl, setSheetUrl] = useState<string>('');
  const [tabName, setTabName] = useState<string>('');
  const [detectedTabs, setDetectedTabs] = useState<string[]>([]);
  const [isDetectingTabs, setIsDetectingTabs] = useState<boolean>(false);
  const [isolationInfo, setIsolationInfo] = useState<{
    isMaster: boolean;
    isRemixed: boolean;
    currentAppletId: string;
    masterAppletId: string;
  } | null>(null);

  // Verification state
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    message: string;
    steps: SheetVerificationStep[];
    failedStepIndex?: number;
  } | null>(null);

  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleDetectTabs = async (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed || trimmed.length < 5) return;
    setIsDetectingTabs(true);
    try {
      const res = await api.detectGoogleSheetTabs({ sheetUrlOrId: trimmed });
      if (res && res.availableTabs && res.availableTabs.length > 0) {
        setDetectedTabs(res.availableTabs);
        if (res.suggestedTab && (!tabName || tabName === 'Sheet1' || tabName === 'PLSMS-APP')) {
          setTabName(res.suggestedTab);
        }
      }
    } catch {
      // non-blocking
    } finally {
      setIsDetectingTabs(false);
    }
  };

  // Load existing persistent configuration on mount
  const loadConfig = async () => {
    try {
      setLoadingConfig(true);
      setErrorMessage(null);
      const [res, iso] = await Promise.all([
        api.getGoogleSheetsConfig(),
        api.getAppIsolationStatus().catch(() => null),
      ]);
      if (iso) {
        setIsolationInfo(iso);
      }
      const resolvedConfig = (res && res.config) ? res.config : res;
      if (resolvedConfig && (resolvedConfig.spreadsheetId || resolvedConfig.publishedUrl || resolvedConfig.tabName)) {
        setActiveConfig(resolvedConfig);
        const authoritativeUrl = resolvedConfig.spreadsheetId
          ? (resolvedConfig.spreadsheetId.startsWith('http')
              ? resolvedConfig.spreadsheetId
              : `https://docs.google.com/spreadsheets/d/${resolvedConfig.spreadsheetId}/edit`)
          : (resolvedConfig.publishedUrl || '');
        setSavedSheetUrl(authoritativeUrl);
        if (!isEditingSheetUrlRef.current) {
          setSheetUrl(authoritativeUrl);
        }
        if (resolvedConfig.tabName) {
          setTabName(resolvedConfig.tabName);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load Google Sheets configuration.');
    } finally {
      setLoadingConfig(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleCopyId = (idToCopy: string) => {
    if (!idToCopy) return;
    navigator.clipboard.writeText(idToCopy);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleStartEditSheetUrl = () => {
    if (!isSuperAdmin) return;
    const currentVal = savedSheetUrl || sheetUrl;
    setPreviousSavedSheetUrl(currentVal);
    previousSavedSheetUrlRef.current = currentVal;
    setIsEditingSheetUrl(true);
    isEditingSheetUrlRef.current = true;
    setSheetUrl(currentVal);
    setErrorMessage(null);
    setTimeout(() => {
      if (sheetUrlInputRef.current) {
        sheetUrlInputRef.current.focus();
        sheetUrlInputRef.current.select();
      }
    }, 50);
  };

  const handleCancelEditSheetUrl = () => {
    const restored = previousSavedSheetUrlRef.current || previousSavedSheetUrl || savedSheetUrl;
    setSheetUrl(restored);
    setPreviousSavedSheetUrl('');
    previousSavedSheetUrlRef.current = '';
    setIsEditingSheetUrl(false);
    isEditingSheetUrlRef.current = false;
    setErrorMessage(null);
  };

  // Handle Super Admin UPDATE & VERIFY
  const handleUpdateAndVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isSuperAdmin) {
      setErrorMessage('Access Denied: Only Super Administrators can execute UPDATE & VERIFY.');
      return;
    }

    const trimmedUrl = sheetUrl.trim();
    let trimmedTab = tabName.trim();

    if (!trimmedUrl) {
      setErrorMessage('Please provide a Google Sheet URL or Spreadsheet ID.');
      return;
    }

    try {
      setIsVerifying(true);
      setErrorMessage(null);
      setVerificationResult(null);

      // Auto-detect tab name if not specified
      if (!trimmedTab || trimmedTab === 'Sheet1') {
        try {
          const detectRes = await api.detectGoogleSheetTabs({ sheetUrlOrId: trimmedUrl });
          if (detectRes && detectRes.availableTabs && detectRes.availableTabs.length > 0) {
            trimmedTab = detectRes.suggestedTab || detectRes.availableTabs[0];
            setTabName(trimmedTab);
          }
        } catch {}
      }

      const result = await api.updateAndVerifyGoogleSheet({
        sheetUrl: trimmedUrl,
        tabName: trimmedTab || undefined,
      });

      setVerificationResult(result);

      if (result.success && result.config) {
        setActiveConfig(result.config);
        const updatedUrl = result.config.spreadsheetId
          ? `https://docs.google.com/spreadsheets/d/${result.config.spreadsheetId}/edit`
          : trimmedUrl;
        setSavedSheetUrl(updatedUrl);
        setSheetUrl(updatedUrl);
        setPreviousSavedSheetUrl('');
        previousSavedSheetUrlRef.current = '';
        setIsEditingSheetUrl(false);
        isEditingSheetUrlRef.current = false;
        if (result.config.tabName) {
          setTabName(result.config.tabName);
        }
        if (onConfigChanged) {
          onConfigChanged(result.config);
        }
      }
    } catch (err: any) {
      setVerificationResult({
        success: false,
        message: err.message || 'Verification process encountered an unexpected failure.',
        steps: [
          {
            step: 1,
            name: 'Verification Execution',
            status: 'FAIL',
            message: err.message || 'Execution error during UPDATE & VERIFY.',
          },
        ],
      });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div id="google-sheets-config-section" className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162846] rounded-2xl p-6 shadow-sm transition-colors">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-600 dark:text-emerald-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white font-mono">
                  Google Sheets Persistent Configuration
                </h2>
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold uppercase">
                  PLSMS CORE TARGET
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Configure and verify the active Google Sheet connection for official printed license records.
                All Service Account credentials remain backend-only. The target sheet must remain Private &amp; Restricted.
              </p>
            </div>
          </div>

          {/* Authorization Mode Indicator */}
          <div className="shrink-0">
            {isSuperAdmin ? (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-xs font-mono font-bold shadow-xs">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>SUPER ADMIN AUTHORIZED</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-xs font-mono font-bold shadow-xs">
                <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>READ-ONLY OBSERVER MODE</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Current Active Connection Status Card (Wide Horizontal Rectangle) */}
      <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162846] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono">
            <Database className="w-4 h-4 text-sky-500" />
            <span>Active Persistent Target Status</span>
          </div>
          <button
            type="button"
            id="refresh-sheets-config-btn"
            onClick={loadConfig}
            disabled={loadingConfig}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white font-mono transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingConfig ? 'animate-spin' : ''}`} />
            <span>Reload Status</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Active Spreadsheet ID */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0E1A2F] border border-slate-200 dark:border-[#1A2C4B] space-y-1.5">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono">
              Active Spreadsheet ID
            </span>
            <div className="flex items-center justify-between gap-2">
              <span
                className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate"
                title={activeConfig?.spreadsheetId || 'Not Configured'}
              >
                {activeConfig?.spreadsheetId ? (
                  activeConfig.spreadsheetId
                ) : (
                  <span className="text-slate-400 italic">Not Configured</span>
                )}
              </span>
              {activeConfig?.spreadsheetId && (
                <button
                  type="button"
                  id="copy-active-spreadsheet-id-btn"
                  onClick={() => handleCopyId(activeConfig.spreadsheetId)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  title="Copy Spreadsheet ID"
                >
                  {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
            {activeConfig?.spreadsheetId && (
              <a
                href={`https://docs.google.com/spreadsheets/d/${activeConfig.spreadsheetId}/edit`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline pt-0.5"
              >
                <span>Open in Google Sheets</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Active Tab Name */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0E1A2F] border border-slate-200 dark:border-[#1A2C4B] space-y-1.5">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono">
              Worksheet Tab Name
            </span>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                {activeConfig?.tabName || <span className="text-slate-400 italic">Not Configured</span>}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">Target worksheet for A:P columns</p>
          </div>

          {/* Service Account Identity */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0E1A2F] border border-slate-200 dark:border-[#1A2C4B] space-y-1.5">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono">
              Authorized Service Account
            </span>
            <div className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300 break-all leading-tight">
              {activeConfig?.serviceAccountEmail || 'plsms-sync-proxy@plsms-sync-proxy.iam.gserviceaccount.com'}
            </div>
            <span className="inline-block text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
              ● Editor Role Required
            </span>
          </div>

          {/* Sync & Security Model */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0E1A2F] border border-slate-200 dark:border-[#1A2C4B] space-y-1.5">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono">
              Protection &amp; Daemon State
            </span>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                PRIVATE / RESTRICTED
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>Status: {activeConfig?.continuousSyncStatus || 'PAUSED (0 imported)'}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Main Configuration Form Card (Wide Horizontal Rectangle) */}
      <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162846] rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white font-mono flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-500" />
            Update &amp; Verify Google Sheet Target
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Specify the new Google Sheet URL and worksheet tab name. When you execute{' '}
            <strong className="text-slate-800 dark:text-slate-200">UPDATE &amp; VERIFY</strong>, the backend verifies
            existence, permissions, and Column A:P headers before saving. If any check fails, the previous configuration
            is strictly preserved and no records are imported.
          </p>
        </div>

        {/* Remixed App Isolation Notice */}
        {(activeConfig?.isClonedMasterState || (isolationInfo?.isRemixed && !activeConfig?.spreadsheetId)) && (
          <div className="p-4 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800/80 flex items-start gap-3 text-xs text-cyan-900 dark:text-cyan-200">
            <ShieldCheck className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <span>Remixed App Isolation Mode Active</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-cyan-200 dark:bg-cyan-800 text-cyan-900 dark:text-cyan-100">
                  ISOLATED
                </span>
              </p>
              <p className="text-cyan-800 dark:text-cyan-300 leading-relaxed">
                This Remixed app instance starts with an isolated, clean configuration to prevent accidental synchronization with the Master App's Google Sheet. Use <strong>CHANGE URL</strong> below or <strong>Replace Google Sheet</strong> to connect your own sheet and initiate synchronization.
              </p>
            </div>
          </div>
        )}

        {!isSuperAdmin && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-start gap-3 text-xs text-amber-800 dark:text-amber-300">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">Super Administrator Authorization Required</p>
              <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                You are currently signed in with standard administrative privileges. Only Super Administrators have authority
                to modify Google Sheet connection parameters or run UPDATE &amp; VERIFY.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleUpdateAndVerify} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Field 1: Google Sheet URL */}
            <div className="md:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="google-sheet-url-input"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono"
                >
                  1. Google Sheet URL or Spreadsheet ID
                </label>
                {Boolean(savedSheetUrl && savedSheetUrl.trim()) && (!isSuperAdmin || !isEditingSheetUrl) && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700/60">
                    <Lock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    LOCKED
                  </span>
                )}
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <input
                    ref={sheetUrlInputRef}
                    id="google-sheet-url-input"
                    type="text"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    readOnly={!isSuperAdmin || (Boolean(savedSheetUrl && savedSheetUrl.trim()) && !isEditingSheetUrl)}
                    disabled={!isSuperAdmin || isVerifying}
                    placeholder="https://docs.google.com/spreadsheets/d/your-google-sheet-id/edit"
                    className={`w-full px-4 py-2.5 rounded-xl border text-xs font-mono transition-all ${
                      !isSuperAdmin || (Boolean(savedSheetUrl && savedSheetUrl.trim()) && !isEditingSheetUrl)
                        ? 'bg-slate-100 dark:bg-[#0B1527] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 cursor-not-allowed select-text'
                        : 'bg-white dark:bg-[#0B1527] border-slate-300 dark:border-[#1E3557] text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500'
                    }`}
                  />
                </div>

                {isSuperAdmin && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {Boolean(savedSheetUrl && savedSheetUrl.trim()) && !isEditingSheetUrl ? (
                      <button
                        type="button"
                        id="btn-change-sheet-config-url"
                        onClick={handleStartEditSheetUrl}
                        className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-98 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap"
                        title="Click to replace with a new Google Sheet URL"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-blue-200" />
                        <span>REPLACE WITH NEW URL</span>
                      </button>
                    ) : isEditingSheetUrl ? (
                      <button
                        type="button"
                        id="btn-cancel-edit-sheet-config-url"
                        onClick={handleCancelEditSheetUrl}
                        disabled={isVerifying}
                        className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap"
                        title="Cancel changes and restore previous URL"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>CANCEL</span>
                      </button>
                    ) : null}
                    {isSuperAdmin && isEditingSheetUrl && (
                      <button
                        type="button"
                        id="btn-detect-tabs-config-section"
                        onClick={() => handleDetectTabs(sheetUrl)}
                        disabled={isVerifying || isDetectingTabs || !sheetUrl.trim()}
                        className="px-3.5 py-2.5 bg-cyan-50 hover:bg-cyan-100 dark:bg-cyan-950/70 dark:hover:bg-cyan-900/60 text-cyan-800 dark:text-cyan-200 border border-cyan-300 dark:border-cyan-700/80 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap disabled:opacity-50"
                        title="Detect available tabs for this Google Sheet"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isDetectingTabs ? 'animate-spin' : ''}`} />
                        <span>{isDetectingTabs ? 'DETECTING...' : 'DETECT TABS'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Paste the full browser URL of the Google Sheet, or the extracted 44+ character ID.
              </p>
            </div>

            {/* Field 2: Tab Name */}
            <div className="space-y-1.5">
              <label
                htmlFor="google-sheet-tab-name-input"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono"
              >
                2. Worksheet Tab Name
              </label>
              <input
                id="google-sheet-tab-name-input"
                type="text"
                value={tabName}
                onChange={(e) => setTabName(e.target.value)}
                disabled={!isSuperAdmin || isVerifying}
                placeholder="PLSMS-APP"
                className={`w-full px-4 py-2.5 rounded-xl border text-xs font-mono transition-all ${
                  !isSuperAdmin
                    ? 'bg-slate-100 dark:bg-[#0B1527] border-slate-200 dark:border-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-white dark:bg-[#0B1527] border-slate-300 dark:border-[#1E3557] text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500'
                }`}
              />
              {detectedTabs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono">Available:</span>
                  {detectedTabs.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTabName(t)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-all cursor-pointer ${
                        tabName.trim() === t.trim()
                          ? 'bg-sky-600 text-white border-sky-600 font-bold'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {t} {tabName.trim() === t.trim() && '✓'}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Case-sensitive worksheet name (e.g. <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">PLSMS-APP</span>).
              </p>
            </div>
          </div>

          {errorMessage && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Info className="w-4 h-4 text-sky-500 shrink-0" />
              <span>
                Executes strict 6-step verification: ID extraction, Google server existence, Tab name check, Service Account READ, WRITE, and Columns A:P schema.
              </span>
            </div>

            <button
              type="submit"
              id="google-sheet-update-verify-btn"
              disabled={!isSuperAdmin || isVerifying || !sheetUrl.trim() || !tabName.trim()}
              className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 border shadow-sm font-mono cursor-pointer ${
                !isSuperAdmin
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                  : isVerifying
                  ? 'bg-sky-600 text-white border-sky-500 opacity-90 cursor-wait'
                  : 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white border-sky-600 hover:border-sky-500 shadow-md ring-1 ring-sky-400/30'
              }`}
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>VERIFYING (STEPS 1–6)...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>UPDATE &amp; VERIFY</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Verification Results Panel (Wide Horizontal Shape per Rule) */}
      <AnimatePresence>
        {verificationResult && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            id="verification-results-panel"
            className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162846] rounded-2xl p-6 sm:p-8 shadow-sm space-y-6"
          >
            {/* Outcome Header Banner */}
            {verificationResult.success ? (
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-sm font-bold font-mono uppercase tracking-wide">
                    ✓ All 6 Verification Checks Passed!
                  </h4>
                  <p className="text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
                    The Google Sheet target has been verified and permanently persisted to PostgreSQL and the permanent vault.
                    Old configuration and memory caches have been invalidated.
                    <span className="font-bold underline ml-1">
                      No records were imported into the database.
                    </span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-700 text-rose-900 dark:text-rose-200 flex items-start gap-3">
                <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-sm font-bold font-mono uppercase tracking-wide">
                    ✕ Verification Check Failed — Previous Configuration Preserved
                  </h4>
                  <p className="text-xs leading-relaxed text-rose-800 dark:text-rose-300">
                    {verificationResult.message}
                  </p>
                  <p className="text-[11px] text-rose-700 dark:text-rose-400 font-mono mt-1 font-bold">
                    SECURITY SAFEGUARD: The active configuration was NOT overwritten. No records were modified or imported.
                  </p>
                </div>
              </div>
            )}

            {/* Detailed 6-Step Verification Checklist */}
            <div className="space-y-3">
              <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono uppercase tracking-wider">
                Strict 6-Step Verification Audit Trail
              </h5>

              <div className="grid grid-cols-1 gap-2.5">
                {verificationResult.steps &&
                  verificationResult.steps.map((st) => (
                    <div
                      key={st.step}
                      className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono transition-all ${
                        st.status === 'PASS'
                          ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60 text-slate-800 dark:text-slate-200'
                          : st.status === 'FAIL'
                          ? 'bg-rose-50/60 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-slate-900 dark:text-slate-100'
                          : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            st.status === 'PASS'
                              ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300'
                              : st.status === 'FAIL'
                              ? 'bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-300'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                          }`}
                        >
                          {st.step}
                        </span>
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{st.name}</span>
                            {st.status === 'PASS' && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                                PASS
                              </span>
                            )}
                            {st.status === 'FAIL' && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300">
                                FAIL
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-normal">
                            {st.message}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 self-end sm:self-center">
                        {st.status === 'PASS' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        ) : st.status === 'FAIL' ? (
                          <XCircle className="w-5 h-5 text-rose-500" />
                        ) : (
                          <Clock className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
