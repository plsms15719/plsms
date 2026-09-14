import React, { useState, useEffect } from 'react';
import {
  Lock,
  Key,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  X,
  Sparkles,
  ArrowRight,
  Shield,
  Loader2,
  RefreshCw,
  Fingerprint,
  Timer,
  User as UserIcon,
  Mail,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../../services/api';
import { SecurityPinStatus, User } from '../../types';
import { isSuperAdminUser, canAccessUploadCenter } from '../../utils/permissions';

interface UploadCenterVerificationCardProps {
  user: User | null;
  onSuccess: () => void;
  onCancel?: () => void;
  isModal?: boolean;
  timeoutNotice?: string | null;
  onClearTimeoutNotice?: () => void;
}

export const UploadCenterVerificationCard: React.FC<UploadCenterVerificationCardProps> = ({
  user,
  onSuccess,
  onCancel,
  isModal = false,
  timeoutNotice,
  onClearTimeoutNotice,
}) => {
  // Verification States (Step 1: 5-digit M-PIN, Step 2: Identity Authorization)
  const [step, setStep] = useState<1 | 2>(1);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState<string | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState<number | null>(null);

  // Step 2 Super Admin Credentials verification (100% Match logic)
  const [step2Identifier, setStep2Identifier] = useState<string>(() => {
    return user?.email || user?.id || 'SUPER_ADMIN';
  });
  const [step2Password, setStep2Password] = useState('');
  const [showStep2Password, setShowStep2Password] = useState(false);
  const [isAuthorizingStep2, setIsAuthorizingStep2] = useState(false);
  const [isCheckingStep2Match, setIsCheckingStep2Match] = useState(false);
  const [isStep2Matched, setIsStep2Matched] = useState(false);
  const [step2MatchMessage, setStep2MatchMessage] = useState<string | null>(null);
  const [step2MatchError, setStep2MatchError] = useState<string | null>(null);

  // PIN Status from DB
  const [pinStatus, setPinStatus] = useState<SecurityPinStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Modal: Change PIN
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [superAdminPwdForChange, setSuperAdminPwdForChange] = useState('');
  const [changePinError, setChangePinError] = useState<string | null>(null);
  const [changePinSuccess, setChangePinSuccess] = useState<string | null>(null);
  const [isChangingPin, setIsChangingPin] = useState(false);

  // Modal: Compulsory First-Time M-PIN Change (Strict security policy when Default PIN is entered/verified)
  const [showCompulsoryChangeModal, setShowCompulsoryChangeModal] = useState(false);
  const [compulsoryDefaultPin, setCompulsoryDefaultPin] = useState('');
  const [compulsoryFirstPin, setCompulsoryFirstPin] = useState('');
  const [compulsorySecondPin, setCompulsorySecondPin] = useState('');
  const [showCompulsoryDefaultPin, setShowCompulsoryDefaultPin] = useState(false);
  const [showCompulsoryFirstPin, setShowCompulsoryFirstPin] = useState(false);
  const [showCompulsorySecondPin, setShowCompulsorySecondPin] = useState(false);
  const [compulsoryError, setCompulsoryError] = useState<string | null>(null);
  const [compulsorySuccess, setCompulsorySuccess] = useState<string | null>(null);
  const [isSubmittingCompulsoryChange, setIsSubmittingCompulsoryChange] = useState(false);
  const [isCompulsorySubmittedSuccess, setIsCompulsorySubmittedSuccess] = useState(false);

  // Modal: Super Admin Reset PIN to Default
  const [showResetPinModal, setShowResetPinModal] = useState(false);
  const [superAdminResetPassword, setSuperAdminResetPassword] = useState('');
  const [resetPinError, setResetPinError] = useState<string | null>(null);
  const [resetPinSuccess, setResetPinSuccess] = useState<string | null>(null);
  const [isResettingPin, setIsResettingPin] = useState(false);

  const isSuperAdmin = Boolean(
    user &&
      (user.role === 'SUPER_ADMIN' ||
        user.role === 'SUPER ADMIN' ||
        user.id?.toUpperCase() === 'SUPER_ADMIN' ||
        user.id?.toUpperCase() === 'TMODLSUNSARI' ||
        user.id === 'user_superadmin')
  );

  const fetchPinStatus = async () => {
    try {
      setLoadingStatus(true);
      const status = await api.getSecurityPinStatus();
      setPinStatus(status);
      if (status.locked && status.lockedUntil) {
        const remaining = Math.max(0, Math.ceil((new Date(status.lockedUntil).getTime() - Date.now()) / 1000));
        setLockoutRemaining(remaining > 0 ? remaining : null);
      } else {
        setLockoutRemaining(null);
      }
    } catch (err: any) {
      console.error('Failed to fetch PIN status:', err);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchPinStatus();
  }, []);

  // When timeoutNotice is set, guarantee Step 1 (M-PIN) and focus input
  useEffect(() => {
    if (timeoutNotice) {
      setStep(1);
      setPin('');
      setVerifyError(null);
      setTimeout(() => {
        document.getElementById('security-mpin-input')?.focus();
      }, 120);
    }
  }, [timeoutNotice]);

  // When user prop changes, update default Step 2 identifier
  useEffect(() => {
    if (user?.email || user?.id) {
      setStep2Identifier(user.email || user.id);
    }
  }, [user]);

  // Step 2 Real-Time 100% Match Verification Hook
  useEffect(() => {
    if (step !== 2) return;

    const trimmedId = step2Identifier.trim();
    const trimmedPwd = step2Password.trim();

    // If either field is empty, reset match state
    if (!trimmedId || !trimmedPwd) {
      setIsStep2Matched(false);
      setStep2MatchMessage(null);
      setStep2MatchError(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsCheckingStep2Match(true);
        const res = await api.verifySuperAdminStep2({
          identifier: trimmedId,
          password: trimmedPwd,
        });

        if (res.matched && res.success) {
          setIsStep2Matched(true);
          setStep2MatchError(null);
          setStep2MatchMessage('✓ 100% MATCHED — Super Admin identity verified successfully!');
          if (res.clearanceToken) {
            sessionStorage.setItem('plsms_upload_center_token', res.clearanceToken);
          }
        } else {
          setIsStep2Matched(false);
          setStep2MatchMessage(null);
          setStep2MatchError(res.error || 'Super Admin User ID/Email or Password does not match.');
        }
      } catch (err: any) {
        setIsStep2Matched(false);
        setStep2MatchError(err.message || 'Verification check failed.');
      } finally {
        setIsCheckingStep2Match(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [step, step2Identifier, step2Password]);

  // Lockout countdown timer
  useEffect(() => {
    if (!lockoutRemaining || lockoutRemaining <= 0) return;
    const timer = setInterval(() => {
      setLockoutRemaining((prev) => {
        if (!prev || prev <= 1) {
          clearInterval(timer);
          fetchPinStatus();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutRemaining]);

  // Step 1: Verify 5-Digit M-PIN
  const handleVerifyStep1 = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = pin.trim();
    if (!trimmed) {
      setVerifyError(isSuperAdmin ? 'Please enter your 5-digit security M-PIN.' : 'Please enter your 5-digit M-PIN or personal login password.');
      return;
    }

    if (isSuperAdmin && !/^\d{5}$/.test(trimmed)) {
      setVerifyError('Security M-PIN must be exactly 5 numeric digits.');
      return;
    }

    try {
      setIsVerifying(true);
      setVerifyError(null);
      const res = await api.verifySecurityPin(trimmed);

      if (res.success) {
        // Save clearance token in session
        if (res.clearanceToken) {
          sessionStorage.setItem('plsms_upload_center_token', res.clearanceToken);
        }

        // COMPULSORY FIRST-TIME M-PIN CHANGE POLICY:
        // This dialog box should be displayed in ONLY ONE CASE:
        // if the user is inputting the Default MPIN (54321) for the first time!
        const isEnteredDefaultPin = pin.trim() === '54321';
        const isSystemDefault = Boolean(res.isDefault);

        if (isEnteredDefaultPin && isSystemDefault) {
          setCompulsoryDefaultPin('54321');
          setCompulsoryFirstPin('');
          setCompulsorySecondPin('');
          setCompulsoryError(null);
          setCompulsorySuccess(null);
          setShowCompulsoryChangeModal(true);
          return;
        }

        setVerifySuccess('✓ Step 1 M-PIN Verification Successful!');
        
        // If the user has already changed the MPIN, then after verifying this mpin exact matched in the saved MPIN in the database,
        // immediately proceed to 2-step verification ONLY for Super Admin:
        setTimeout(() => {
          setVerifySuccess(null);
          if (isSuperAdmin) {
            setStep(2);
          } else {
            // Non-Super Admin: 2-step verification is strictly for Super Admin.
            // Authorized staff clearance is granted immediately:
            const sessionPass = {
              userId: user?.id || 'STAFF',
              userName: user?.name || 'Administrator',
              role: user?.role || 'ADMINISTRATOR',
              clearedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            };
            sessionStorage.setItem('plsms_upload_center_clearance', JSON.stringify(sessionPass));
            sessionStorage.setItem('plsms_upload_center_authorized', 'true');
            sessionStorage.setItem('plsms_upload_center_last_active', Date.now().toString());
            onSuccess();
          }
        }, 500);
      }
    } catch (err: any) {
      console.error('Verification error:', err);
      setVerifyError(err.message || 'Invalid Security M-PIN. Please try again.');
      fetchPinStatus();
    } finally {
      setIsVerifying(false);
    }
  };

  // Compulsory First-Time M-PIN Change Handler
  const handleCompulsoryChangeSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setCompulsoryError(null);
    setCompulsorySuccess(null);

    const cleanDefault = compulsoryDefaultPin.trim();
    const cleanFirst = compulsoryFirstPin.trim();
    const cleanSecond = compulsorySecondPin.trim();

    if (cleanDefault !== '54321') {
      setCompulsoryError('Default M-PIN must be 54321.');
      return;
    }

    if (!/^\d{5}$/.test(cleanFirst)) {
      setCompulsoryError('New M-PIN must be exactly 5 numeric digits.');
      return;
    }

    if (cleanFirst === '54321') {
      setCompulsoryError('New M-PIN must be different from the default PIN (54321).');
      return;
    }

    if (cleanFirst !== cleanSecond) {
      setCompulsoryError('Confirmation M-PIN does not match the new M-PIN.');
      return;
    }

    try {
      setIsSubmittingCompulsoryChange(true);
      const res = await api.changeSecurityPin({
        currentPin: cleanDefault,
        newPin: cleanFirst,
      });

      if (res.clearanceToken) {
        sessionStorage.setItem('plsms_upload_center_token', res.clearanceToken);
      }

      // Switch to celebratory beautiful success UI
      setIsCompulsorySubmittedSuccess(true);
      setCompulsorySuccess(
        '✓ Security M-PIN successfully changed and secured in database!'
      );

      // Trigger celebratory confetti burst
      try {
        confetti({
          particleCount: 85,
          spread: 75,
          origin: { y: 0.55 },
        });
      } catch (_) {}

      // Play pleasant multi-tone success chime
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, audioCtx.currentTime + 0.12); // E5
        osc.frequency.exponentialRampToValueAtTime(783.99, audioCtx.currentTime + 0.25); // G5
        osc.frequency.exponentialRampToValueAtTime(1046.50, audioCtx.currentTime + 0.38); // C6
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.62);
      } catch (_) {}

      // Refresh PIN status from DB so isDefault is false
      await fetchPinStatus();
      setPin(cleanFirst);

      // Display the beautiful message, then smoothly advance to Step 2 (only for Super Admin)
      setTimeout(() => {
        setShowCompulsoryChangeModal(false);
        setIsCompulsorySubmittedSuccess(false);
        setCompulsorySuccess(null);
        if (isSuperAdmin) {
          setStep(2);
        } else {
          const sessionPass = {
            userId: user?.id || 'STAFF',
            userName: user?.name || 'Administrator',
            role: user?.role || 'ADMINISTRATOR',
            clearedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          };
          sessionStorage.setItem('plsms_upload_center_clearance', JSON.stringify(sessionPass));
          sessionStorage.setItem('plsms_upload_center_authorized', 'true');
          sessionStorage.setItem('plsms_upload_center_last_active', Date.now().toString());
          onSuccess();
        }
      }, 2400);
    } catch (err: any) {
      console.error('Compulsory PIN change failed:', err);
      setCompulsoryError(err.message || 'Failed to update M-PIN. Please try again.');
      setIsCompulsorySubmittedSuccess(false);
    } finally {
      setIsSubmittingCompulsoryChange(false);
    }
  };

  // Safe Cancel for Compulsory Change: keep console locked
  const handleCancelCompulsoryChange = () => {
    setShowCompulsoryChangeModal(false);
    setIsCompulsorySubmittedSuccess(false);
    setCompulsoryError(null);
    setCompulsorySuccess(null);
    setPin('');
    setVerifyError(null);
    setStep(1);
    sessionStorage.removeItem('plsms_upload_center_token');
    if (onCancel) {
      onCancel();
    }
  };

  // Step 2: Complete 2-Step Super Admin Identity Authorization
  const handleAuthorizeStep2 = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const trimmedId = step2Identifier.trim();
    const trimmedPwd = step2Password.trim();

    if (!trimmedId || !trimmedPwd) {
      setStep2MatchError('कृपया सुपर एडमिन युजर आईडी/इमेल र पासवर्ड दुबै प्रविष्ट गर्नुहोस्।');
      return;
    }

    try {
      setIsAuthorizingStep2(true);
      setVerifyError(null);

      // Perform direct verification if not already 100% matched
      let token = sessionStorage.getItem('plsms_upload_center_token');
      if (!isStep2Matched) {
        const res = await api.verifySuperAdminStep2({
          identifier: trimmedId,
          password: trimmedPwd,
        });

        if (!res.matched || !res.success) {
          setIsStep2Matched(false);
          setStep2MatchError(res.error || 'सुपर एडमिन प्रमाण १००% मेल खाएन (100% match required).');
          return;
        }

        setIsStep2Matched(true);
        if (res.clearanceToken) {
          token = res.clearanceToken;
          sessionStorage.setItem('plsms_upload_center_token', res.clearanceToken);
        }
      }

      // Cryptographic session clearance
      const sessionPass = {
        userId: trimmedId,
        userName: user?.name || 'Super Administrator',
        role: 'SUPER ADMIN',
        clearedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      };

      sessionStorage.setItem('plsms_upload_center_clearance', JSON.stringify(sessionPass));
      sessionStorage.setItem('plsms_upload_center_authorized', 'true');
      sessionStorage.setItem('plsms_upload_center_last_active', Date.now().toString());

      setVerifySuccess('✓ २-चरण प्रमाणीकरण १००% सफल! Upload Center खुल्दैछ...');

      // Gentle success audio chime
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.26);
      } catch (_) {}

      // Immediately open Upload Center
      setTimeout(() => {
        onSuccess();
      }, 350);
    } catch (err: any) {
      console.error('Step 2 authorization error:', err);
      setVerifyError(err.message || 'Clearance authorization failed.');
    } finally {
      setIsAuthorizingStep2(false);
    }
  };

  // Change PIN handler
  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePinError(null);
    setChangePinSuccess(null);

    const cleanNewPin = newPin.trim();
    const cleanConfirm = confirmPin.trim();

    if (!/^\d{5}$/.test(cleanNewPin)) {
      setChangePinError('नयाँ M-PIN ठ्याक्कै ५ अङ्कको संख्या हुनुपर्छ (New M-PIN must be strictly 5 numeric digits).');
      return;
    }

    if (cleanNewPin !== cleanConfirm) {
      setChangePinError('नयाँ M-PIN र पुष्टि गरिएको PIN मेल खाएन (New M-PIN and confirm PIN do not match).');
      return;
    }

    try {
      setIsChangingPin(true);
      const res = await api.changeSecurityPin({
        currentPin: currentPin.trim() || undefined,
        newPin: cleanNewPin,
        superAdminPassword: superAdminPwdForChange.trim() || undefined,
      });

      setChangePinSuccess(res.message || 'Security M-PIN successfully updated in database!');
      await fetchPinStatus();
      setTimeout(() => {
        setShowChangePinModal(false);
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
        setSuperAdminPwdForChange('');
        setChangePinSuccess(null);
      }, 1400);
    } catch (err: any) {
      console.error('Change PIN failed:', err);
      setChangePinError(err.message || 'Failed to update M-PIN. Please try again.');
    } finally {
      setIsChangingPin(false);
    }
  };

  // Super Admin Reset PIN to Default (54321)
  const handleResetPinToDefault = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetPinError(null);
    setResetPinSuccess(null);

    if (!superAdminResetPassword.trim()) {
      setResetPinError('Super Administrator password is required.');
      return;
    }

    try {
      setIsResettingPin(true);
      const res = await api.resetSecurityPin(superAdminResetPassword.trim());
      setResetPinSuccess(res.message || 'Security M-PIN successfully reset to default 54321 in database!');
      await fetchPinStatus();
      setPin('54321');
      setTimeout(() => {
        setShowResetPinModal(false);
        setSuperAdminResetPassword('');
        setResetPinSuccess(null);
      }, 1400);
    } catch (err: any) {
      console.error('Reset PIN failed:', err);
      setResetPinError(err.message || 'Failed to reset M-PIN. Please try again.');
    } finally {
      setIsResettingPin(false);
    }
  };

  const cardContent = (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 text-slate-800 dark:text-slate-100 transition-colors duration-200 animate-in fade-in">
      {/* Top Banner: Super User Premises & Settings Console */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <Shield className="w-6 h-6 text-indigo-600 dark:text-indigo-400 shrink-0" />
            Super User Premises & Settings Console
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 font-normal">
            Administer virtual premises metadata, configure system access levels, or initiate secure backups.
          </p>
        </div>

        {isModal && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="self-start sm:self-auto p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-all cursor-pointer shadow-xs"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Warning Box: RESTRICTED SUPERADMIN CONSOLE (Soft, elegant amber tone in light mode) */}
      <div className="rounded-2xl border border-amber-200/90 dark:border-amber-700/50 bg-amber-50/70 dark:bg-amber-950/20 p-4 sm:p-5 flex items-start gap-4 shadow-xs">
        <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/60 border border-amber-200 dark:border-amber-700/60 flex items-center justify-center shrink-0 text-amber-700 dark:text-amber-400 mt-0.5 shadow-xs">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-xs sm:text-sm font-bold text-amber-900 dark:text-amber-300 tracking-wider uppercase flex items-center gap-2">
            RESTRICTED SUPERADMIN CONSOLE
          </h3>
          <p className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed font-normal">
            Execute critical modifications, find/resolve duplicate ledger records, and append manual weekly/monthly entries. All transactions are digitally signed and logged.
          </p>
        </div>
      </div>

      {/* Session Inactivity Timeout Alert Banner (5-Minute Idle Out) */}
      {timeoutNotice && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-700/50 bg-rose-50/80 dark:bg-rose-950/30 p-4 sm:p-5 flex items-start gap-3.5 shadow-xs animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/70 border border-rose-200 dark:border-rose-700/60 flex items-center justify-center shrink-0 text-rose-700 dark:text-rose-300 shadow-xs">
            <Timer className="w-5 h-5 text-rose-600 dark:text-rose-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-rose-900 dark:text-rose-200 tracking-wide uppercase flex items-center gap-2 font-mono">
                <span>⚠️ Session Timed Out (सुरक्षा सत्र समाप्त)</span>
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-rose-600 text-white font-mono text-[10px] font-bold tracking-wider uppercase shadow-xs">
                AUTO-LOCKED
              </span>
            </div>
            <p className="text-xs text-rose-800 dark:text-rose-300 mt-1 font-medium leading-relaxed">
              {timeoutNotice}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-mono text-rose-900 dark:text-rose-200 bg-white/90 dark:bg-black/50 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800/40">
              <Lock className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>
                Console locked due to 2 minutes of inactivity. Enter your 5-digit M-PIN below to re-authenticate.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Two-Column Responsive Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* ========================================================= */}
        {/* LEFT CARD: Console Session Verification Required */}
        {/* ========================================================= */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0A1224] p-6 sm:p-8 flex flex-col items-center text-center relative shadow-xs transition-all">
          {/* Top Pill: Step Indicator */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/80 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 font-mono text-[11px] font-bold uppercase tracking-wider mb-5 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400"></span>
            {step === 1 ? 'STEP 1: VERIFICATION' : 'STEP 2: IDENTITY CLEARANCE'}
          </div>

          {/* Refined Circular Lock Icon */}
          <div className="w-14 h-14 rounded-full bg-white dark:bg-[#111C35] border border-slate-200 dark:border-slate-700/80 flex items-center justify-center mb-4 shadow-xs text-indigo-600 dark:text-indigo-400">
            {step === 1 ? (
              <Lock className="w-6 h-6" />
            ) : (
              <Fingerprint className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            )}
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight mb-2">
            {step === 1 ? 'Console Session Verification Required' : 'Identity Clearance & Confirmation'}
          </h2>

          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed mb-6 font-normal">
            {step === 1
              ? 'This panel handles low-level database operations. Please enter the master administrative clearance PIN to gain write permissions.'
              : 'Confirm your operator identity to sign the temporary cryptographic clearance token for Upload Center.'}
          </p>

          {/* Compact timeout banner inside left card */}
          {timeoutNotice && step === 1 && (
            <div className="w-full mb-5 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/90 border border-rose-200 dark:border-rose-500/70 text-xs text-rose-900 dark:text-rose-200 text-left flex items-start gap-2.5 font-mono shadow-xs">
              <Timer className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-rose-950 dark:text-white">Session Timed Out:</strong>
                <p className="mt-0.5 text-rose-800 dark:text-rose-300 font-sans text-[11px]">
                  Upload Center locked due to 2 minutes of inactivity. Please enter your 5-digit M-PIN to resume.
                </p>
              </div>
            </div>
          )}

          {/* Form / Inputs */}
          {step === 1 ? (
            <form onSubmit={handleVerifyStep1} className="w-full max-w-md flex flex-col gap-4 items-center">
              <div className="relative w-full">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                  <Key className="w-5 h-5" />
                </div>

                <input
                  type={showPin ? 'text' : 'password'}
                  id="security-mpin-input"
                  maxLength={isSuperAdmin ? 5 : 40}
                  value={pin}
                  onChange={(e) => {
                    const clean = isSuperAdmin ? e.target.value.replace(/\D/g, '').slice(0, 5) : e.target.value.slice(0, 40);
                    setPin(clean);
                    setVerifyError(null);
                  }}
                  placeholder={isSuperAdmin ? "Enter 5-Digit Security PIN" : "Enter 5-Digit M-PIN or Account Password"}
                  disabled={isVerifying || Boolean(lockoutRemaining && lockoutRemaining > 0)}
                  autoFocus
                  className="w-full bg-white hover:border-slate-400 focus:border-indigo-600 dark:bg-[#060D1A] dark:border-slate-700 dark:hover:border-slate-600 dark:focus:border-indigo-400 border-2 border-slate-200 focus:ring-4 focus:ring-indigo-500/15 dark:focus:ring-indigo-500/20 rounded-xl py-3 pl-12 pr-12 text-center font-mono font-bold tracking-wider text-slate-900 dark:text-white text-base placeholder:text-slate-400 dark:placeholder:text-slate-500 placeholder:tracking-normal placeholder:font-sans placeholder:text-xs sm:placeholder:text-sm placeholder:font-normal outline-none transition-all disabled:opacity-50 shadow-xs"
                />

                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 transition-colors cursor-pointer p-1"
                  title={showPin ? 'Hide PIN' : 'Show PIN'}
                >
                  {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              {/* Default M-PIN notice & Auto-Fill feature (SUPER ADMIN & AUTHORIZED USERS) or Custom PIN Active badge */}
              {pinStatus?.isDefault && (isSuperAdminUser(user) || canAccessUploadCenter(user)) ? (
                <div
                  id="default-mpin-notice-banner"
                  className="inline-flex items-center justify-center gap-2 py-1.5 px-4 rounded-full bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-700/60 text-amber-800 dark:text-amber-200 font-mono text-xs shadow-xs font-medium"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    Default M-PIN is currently <strong className="text-amber-950 dark:text-amber-300 font-bold">54321</strong>
                  </span>
                  <button
                    type="button"
                    id="btn-autofill-default-mpin"
                    onClick={() => {
                      setPin('54321');
                      setVerifyError(null);
                    }}
                    className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 underline font-bold uppercase tracking-wider transition-colors ml-1 cursor-pointer"
                  >
                    AUTO-FILL
                  </button>
                </div>
              ) : !pinStatus?.isDefault ? (
                <div
                  id="secured-mpin-notice-banner"
                  className="inline-flex items-center justify-center gap-2 py-1.5 px-4 rounded-full bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-200 font-mono text-xs shadow-xs font-semibold"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>
                    Custom Security M-PIN is <strong className="text-emerald-950 dark:text-emerald-300 font-bold">ACTIVE & SECURED</strong>
                  </span>
                </div>
              ) : null}

              {/* Feedback messages */}
              {verifyError && (
                <div className="w-full text-xs text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-700/60 p-3 rounded-xl flex items-center gap-2 text-left font-medium shadow-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>{verifyError}</span>
                </div>
              )}

              {lockoutRemaining && lockoutRemaining > 0 && (
                <div className="w-full text-xs text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-700/60 p-3 rounded-xl flex items-center justify-center gap-2 font-mono font-semibold shadow-xs">
                  <RotateCcw className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400" />
                  <span>Clearance Engine Locked: {lockoutRemaining} seconds remaining</span>
                </div>
              )}

              {verifySuccess && (
                <div className="w-full text-xs text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-700/60 p-3 rounded-xl flex items-center justify-center gap-2 font-mono font-bold shadow-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{verifySuccess}</span>
                </div>
              )}

              {/* Authenticate Button: Clean solid indigo button with crisp neutral disabled state */}
              <button
                type="submit"
                id="btn-authenticate-console"
                disabled={isVerifying || Boolean(lockoutRemaining && lockoutRemaining > 0) || pin.length < 5}
                className="w-full py-3.5 px-6 rounded-xl font-mono font-bold text-xs sm:text-sm uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2.5 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:border disabled:border-slate-200 dark:disabled:bg-slate-800/80 dark:disabled:text-slate-500 dark:disabled:border-slate-700 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow active:scale-[0.99] dark:bg-indigo-600 dark:hover:bg-indigo-500 dark:text-white"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>VERIFYING CLEARANCE PIN...</span>
                  </>
                ) : (
                  <>
                    <span>AUTHENTICATE CONSOLE PANEL</span>
                    <ArrowRight className="w-4 h-4 text-white" />
                  </>
                )}
              </button>
            </form>
          ) : (
            /* STEP 2: Super Admin Identity Clearance & Verification */
            <form onSubmit={handleAuthorizeStep2} className="w-full max-w-md flex flex-col gap-4 items-center animate-in fade-in duration-200 text-left">
              {/* Operator Identity Context */}
              <div className="w-full bg-white dark:bg-[#060D1A] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col gap-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono font-semibold flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    OPERATOR CLEARANCE PROFILE
                  </span>
                  <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800/50 text-indigo-700 dark:text-indigo-300 font-bold uppercase tracking-wider">
                    {user?.role || 'SUPER ADMIN'}
                  </span>
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse"></span>
                    <span>{user?.name || 'KOMAL DAHAL'}</span>
                    <span className="text-xs text-slate-400 font-mono font-normal">({user?.id || 'SUPER_ADMIN'})</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded font-bold tracking-wider">
                    UPLOAD CENTER
                  </span>
                </div>
              </div>

              {/* INPUT 1: Super Admin User ID / Email Address */}
              <div className="w-full flex flex-col gap-1.5">
                <label className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200 tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <UserIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    SUPER ADMIN USER ID / EMAIL ADDRESS
                  </span>
                  <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">REQUIRED</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    id="input-step2-super-admin-id"
                    value={step2Identifier}
                    onChange={(e) => {
                      setStep2Identifier(e.target.value.toUpperCase());
                      setStep2MatchError(null);
                      setVerifySuccess(null);
                    }}
                    placeholder="SUPER ADMIN ID OR EMAIL (E.G. SUPER_ADMIN)"
                    disabled={isAuthorizingStep2}
                    className="w-full bg-white hover:border-slate-400 focus:border-indigo-600 dark:bg-[#060D1A] dark:hover:border-slate-600 dark:focus:border-indigo-400 border-2 border-slate-200 focus:ring-4 focus:ring-indigo-500/15 dark:focus:ring-indigo-500/20 rounded-xl py-3 pl-10 pr-4 font-mono font-bold text-slate-900 dark:text-white text-xs sm:text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 placeholder:font-sans placeholder:text-xs placeholder:font-normal outline-none transition-all uppercase shadow-xs"
                  />
                </div>
              </div>

              {/* INPUT 2: Super Admin Password */}
              <div className="w-full flex flex-col gap-1.5">
                <label className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200 tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    SUPER ADMIN CONFIDENTIAL PASSWORD
                  </span>
                  <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">REQUIRED</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                    <Key className="w-4 h-4" />
                  </div>
                  <input
                    type={showStep2Password ? 'text' : 'password'}
                    id="input-step2-super-admin-password"
                    value={step2Password}
                    onChange={(e) => {
                      setStep2Password(e.target.value);
                      setStep2MatchError(null);
                      setVerifySuccess(null);
                    }}
                    placeholder="Enter Super Admin password..."
                    disabled={isAuthorizingStep2}
                    autoFocus
                    className="w-full bg-white hover:border-slate-400 focus:border-indigo-600 dark:bg-[#060D1A] dark:hover:border-slate-600 dark:focus:border-indigo-400 border-2 border-slate-200 focus:ring-4 focus:ring-indigo-500/15 dark:focus:ring-indigo-500/20 rounded-xl py-3 pl-10 pr-11 font-mono font-bold text-slate-900 dark:text-white text-xs sm:text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 placeholder:font-sans placeholder:text-xs placeholder:font-normal outline-none transition-all shadow-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowStep2Password(!showStep2Password)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 transition-colors cursor-pointer p-1"
                    title={showStep2Password ? 'Hide password' : 'Show password'}
                  >
                    {showStep2Password ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Real-Time 100% Match Status Banner */}
              {isCheckingStep2Match ? (
                <div className="w-full p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/50 text-indigo-900 dark:text-indigo-200 text-xs font-mono flex items-center justify-center gap-2 shadow-xs font-medium">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span>Verifying Super Admin credentials in database...</span>
                </div>
              ) : isStep2Matched ? (
                <div className="w-full p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-700/70 text-emerald-900 dark:text-emerald-200 text-xs font-mono flex items-center justify-between gap-2 shadow-xs animate-in fade-in duration-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-bold">100% MATCHED (VERIFIED)</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-xs">
                    VERIFIED
                  </span>
                </div>
              ) : step2MatchError ? (
                <div className="w-full p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-700/50 text-rose-900 dark:text-rose-200 text-xs font-mono flex items-start gap-2 shadow-xs animate-in fade-in duration-200 font-medium">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <span>{step2MatchError}</span>
                </div>
              ) : (
                <div className="w-full p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 text-[11px] font-mono flex items-center gap-2 font-medium">
                  <Shield className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Security Requirement: Credentials must match 100% to unlock verification.</span>
                </div>
              )}

              {verifySuccess && (
                <div className="w-full text-xs text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-700/60 p-3 rounded-xl flex items-center justify-center gap-2 font-mono font-bold shadow-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{verifySuccess}</span>
                </div>
              )}

              {/* Action Buttons: BACK & VERIFY (Active ONLY when 100% matched) */}
              <div className="flex gap-2.5 w-full pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setVerifyError(null);
                    setStep2MatchError(null);
                  }}
                  className="py-3 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                >
                  BACK
                </button>

                <button
                  type="submit"
                  id="btn-step2-verify-upload-center"
                  disabled={!isStep2Matched || isAuthorizingStep2}
                  className={`flex-1 py-3 px-4 rounded-xl font-mono font-bold text-xs sm:text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                    isStep2Matched && !isAuthorizingStep2
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm cursor-pointer active:scale-[0.99]'
                      : 'bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {isAuthorizingStep2 ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span className="font-bold uppercase tracking-wider">OPENING UPLOAD CENTER...</span>
                    </>
                  ) : isStep2Matched ? (
                    <>
                      <ShieldCheck className="w-4 h-4 text-white" />
                      <span className="font-bold uppercase tracking-wider">✓ VERIFY & UNLOCK UPLOAD CENTER</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                      <span className="font-bold uppercase tracking-wider">VERIFY (100% MATCH REQUIRED)</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ========================================================= */}
        {/* RIGHT CARD: PIN Control: Administrative Clearance Security */}
        {/* ========================================================= */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0A1224] p-6 sm:p-8 flex flex-col justify-between relative shadow-xs transition-all">
          <div>
            {/* Top Pill Badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-wider mb-4 shadow-xs">
              <span>PIN CONTROL: ADMINISTRATIVE CLEARANCE SECURITY</span>
            </div>

            <div className="flex items-start gap-3.5 mb-3">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#111C35] border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-200 mt-0.5 shadow-xs">
                <Key className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug">
                  प्रशासकीय पिन सुरक्षा नियन्त्रण (ADMIN REGISTRY SECURITY PIN CONTROL)
                </h3>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed font-normal">
              Change and rotation of the master administrative clearance PIN to safeguard low-level operations from unauthorized entries.
            </p>
          </div>

          {/* Inner Panel with Active Status & Buttons */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#060D1A] p-5 sm:p-6 flex flex-col items-center text-center gap-3.5 mt-auto shadow-xs">
            {/* Security Clearance Engine Status */}
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>Security Clearance Engine: Active</span>
            </div>

            {/* Change PIN Button (Clean solid slate button) */}
            <button
              type="button"
              id="btn-change-security-pin"
              onClick={() => {
                setChangePinError(null);
                setChangePinSuccess(null);
                setShowChangePinModal(true);
              }}
              className="w-full py-3 px-5 rounded-xl font-mono font-bold text-xs sm:text-sm uppercase tracking-wider transition-all shadow-xs hover:shadow active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white border border-slate-800 dark:border-slate-700"
            >
              <Key className="w-4 h-4" />
              <span>CHANGE SECURITY PIN</span>
            </button>

            {/* Current PIN status label */}
            <div className="mt-1 flex flex-col items-center gap-2">
              <div className="text-xs font-mono">
                {pinStatus?.isDefault ? (
                  <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 inline" />
                    Current PIN status: ⚠️ DEFAULT INSECURE PIN ACTIVE
                  </span>
                ) : (
                  <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 inline" />
                    Current PIN status: 🛡️ SECURE CUSTOM M-PIN ACTIVE
                  </span>
                )}
              </div>

              {/* Super Admin Reset Option */}
              {isSuperAdmin && !pinStatus?.isDefault && (
                <button
                  type="button"
                  onClick={() => {
                    setResetPinError(null);
                    setResetPinSuccess(null);
                    setShowResetPinModal(true);
                  }}
                  className="text-xs font-mono font-bold uppercase tracking-wider text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300 underline flex items-center gap-1.5 transition-colors cursor-pointer mt-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>RESET M-PIN TO DEFAULT (SUPER ADMIN)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODAL: CHANGE SECURITY PIN */}
      {/* ========================================================= */}
      {showChangePinModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0A1224] p-6 sm:p-8 shadow-2xl relative text-left text-slate-800 dark:text-slate-100">
            <button
              type="button"
              onClick={() => setShowChangePinModal(false)}
              className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-xs">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Change Security M-PIN (पिन परिवर्तन)</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-normal">Set new 5-digit master administrative security M-PIN</p>
              </div>
            </div>

            <form onSubmit={handleChangePin} className="flex flex-col gap-4">
              {/* If user is Super Admin, can enter Super Admin password instead of current PIN if forgotten */}
              {isSuperAdmin ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Current 5-Digit M-PIN <span className="text-slate-500 font-normal">(or Super Admin Password)</span>
                  </label>
                  <input
                    type="password"
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value)}
                    placeholder="Enter current 5-digit PIN"
                    className="w-full bg-white hover:border-slate-400 focus:border-indigo-600 dark:bg-[#060D1A] dark:hover:border-slate-600 dark:focus:border-indigo-400 border-2 border-slate-200 focus:ring-4 focus:ring-indigo-500/15 dark:focus:ring-indigo-500/20 rounded-xl py-2.5 px-3.5 text-slate-900 dark:text-white text-sm font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all shadow-xs"
                  />
                  <div className="mt-2">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Or authenticate using Super Admin password:</span>
                    <input
                      type="password"
                      value={superAdminPwdForChange}
                      onChange={(e) => setSuperAdminPwdForChange(e.target.value)}
                      placeholder="Super Administrator Password"
                      className="w-full mt-1 bg-white hover:border-slate-400 focus:border-indigo-600 dark:bg-[#060D1A] border-2 border-slate-200 dark:border-slate-700 dark:focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/15 dark:focus:ring-indigo-500/20 rounded-xl py-2 px-3 text-slate-900 dark:text-white text-xs font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all shadow-xs"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Current 5-Digit M-PIN <span className="text-rose-600 dark:text-rose-400">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    maxLength={5}
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="Enter current 5-digit PIN (e.g. 54321)"
                    className="w-full bg-white hover:border-slate-400 focus:border-indigo-600 dark:bg-[#060D1A] border-2 border-slate-200 dark:border-slate-700 dark:focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/15 dark:focus:ring-indigo-500/20 rounded-xl py-2.5 px-3.5 text-slate-900 dark:text-white text-sm font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all shadow-xs"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  New 5-Digit Security M-PIN <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  required
                  maxLength={5}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  placeholder="Enter new 5-digit numeric PIN"
                  className="w-full bg-white hover:border-slate-400 focus:border-indigo-600 dark:bg-[#060D1A] border-2 border-slate-200 dark:border-slate-700 dark:focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/15 dark:focus:ring-indigo-500/20 rounded-xl py-2.5 px-3.5 text-slate-900 dark:text-white text-sm font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all tracking-widest shadow-xs"
                />
                <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-1 block">Strictly 5 digits (0-9 only)</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  Confirm New 5-Digit M-PIN <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  required
                  maxLength={5}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  placeholder="Re-enter new 5-digit numeric PIN"
                  className="w-full bg-white hover:border-slate-400 focus:border-indigo-600 dark:bg-[#060D1A] border-2 border-slate-200 dark:border-slate-700 dark:focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/15 dark:focus:ring-indigo-500/20 rounded-xl py-2.5 px-3.5 text-slate-900 dark:text-white text-sm font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all tracking-widest shadow-xs"
                />
              </div>

              {changePinError && (
                <div className="text-xs text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-700/60 p-3 rounded-xl flex items-center gap-2 font-medium shadow-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>{changePinError}</span>
                </div>
              )}

              {changePinSuccess && (
                <div className="text-xs text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-700/60 p-3 rounded-xl flex items-center gap-2 font-bold shadow-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{changePinSuccess}</span>
                </div>
              )}

              <div className="flex gap-2.5 mt-2">
                <button
                  type="button"
                  onClick={() => setShowChangePinModal(false)}
                  className="w-1/3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={isChangingPin || newPin.length < 5 || confirmPin.length < 5}
                  className="flex-1 py-2.5 px-4 rounded-xl font-mono font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs active:scale-[0.99]"
                >
                  {isChangingPin ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span className="font-bold uppercase tracking-wider">UPDATING IN DATABASE...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-white" />
                      <span className="font-bold uppercase tracking-wider">SAVE NEW M-PIN IN DATABASE</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: SUPER ADMIN RESET M-PIN TO DEFAULT (54321) */}
      {/* ========================================================= */}
      {showResetPinModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-xl rounded-2xl border border-rose-200 dark:border-rose-700/60 bg-white dark:bg-[#140810] p-6 sm:p-8 shadow-2xl relative text-left text-slate-800 dark:text-slate-100">
            <button
              type="button"
              onClick={() => setShowResetPinModal(false)}
              className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-700/50 flex items-center justify-center text-rose-600 dark:text-rose-400 shadow-xs">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Reset M-PIN to Default</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-normal">Super Administrator Authenticated Password Verification</p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4 font-normal">
              This action resets the master administrative clearance M-PIN strictly back to the default <strong className="text-rose-700 dark:text-rose-300 font-bold font-mono">54321</strong> in the persistent database. Enter your Super Administrator login password to confirm identity.
            </p>

            <form onSubmit={handleResetPinToDefault} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  Super Administrator Password <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={superAdminResetPassword}
                  onChange={(e) => setSuperAdminResetPassword(e.target.value)}
                  placeholder="Enter Super Administrator Password"
                  className="w-full bg-white hover:border-slate-400 focus:border-rose-600 dark:bg-[#060D1A] border-2 border-slate-200 dark:border-slate-700 dark:focus:border-rose-400 focus:ring-4 focus:ring-rose-500/15 rounded-xl py-2.5 px-3.5 text-slate-900 dark:text-white text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none font-mono transition-all shadow-xs"
                  autoFocus
                />
              </div>

              {resetPinError && (
                <div className="text-xs text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-700/60 p-3 rounded-xl flex items-center gap-2 font-medium shadow-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>{resetPinError}</span>
                </div>
              )}

              {resetPinSuccess && (
                <div className="text-xs text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-700/60 p-3 rounded-xl flex items-center gap-2 font-bold shadow-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{resetPinSuccess}</span>
                </div>
              )}

              <div className="flex gap-2.5 mt-2">
                <button
                  type="button"
                  onClick={() => setShowResetPinModal(false)}
                  className="w-1/3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={isResettingPin || !superAdminResetPassword.trim()}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-mono font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 shadow-xs"
                >
                  {isResettingPin ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span className="font-bold uppercase tracking-wider">RESETTING TO 54321...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4 text-white" />
                      <span className="font-bold uppercase tracking-wider">CONFIRM RESET TO 54321</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: COMPULSORY FIRST-TIME M-PIN CHANGE (MANDATORY POLICY) */}
      {/* ========================================================= */}
      {showCompulsoryChangeModal && (
        <div
          id="compulsory-mpin-change-modal"
          className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
        >
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0A1224] p-6 sm:p-8 shadow-2xl relative text-left text-slate-800 dark:text-slate-100 my-auto">
            {/* If successfully changed, show Beautiful Success Message Screen */}
            {isCompulsorySubmittedSuccess ? (
              <div className="py-6 px-2 sm:px-4 flex flex-col items-center text-center space-y-5 animate-in zoom-in-95 fade-in duration-300">
                {/* Clean emblem with ShieldCheck */}
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/90 border-2 border-emerald-500 dark:border-emerald-400 flex items-center justify-center text-emerald-600 dark:text-emerald-300 shadow-sm">
                    <ShieldCheck className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white shadow-xs">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                </div>

                <div className="space-y-2 max-w-md">
                  <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-mono text-[11px] font-bold uppercase tracking-wider shadow-xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    M-PIN SECURITY UPDATE COMPLETED
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                    Security M-PIN Successfully Changed!
                  </h2>
                  <p className="text-xs sm:text-sm text-emerald-800 dark:text-emerald-200 font-medium">
                    Master Administrative Clearance M-PIN has been secured in the persistent database.
                  </p>
                </div>

                {/* Status breakdown */}
                <div className="w-full bg-slate-50 dark:bg-[#050E1F] border border-slate-200 dark:border-emerald-900/70 rounded-xl p-4 text-left font-mono space-y-2.5 text-xs shadow-xs">
                  <div className="flex items-center justify-between text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      Default M-PIN (54321):
                    </span>
                    <span className="text-rose-600 dark:text-rose-400 font-bold">Deactivated</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      New 5-Digit M-PIN:
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">Active & Encrypted</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-700 dark:text-slate-200">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      Security Clearance Status:
                    </span>
                    <span className="text-indigo-600 dark:text-indigo-400 font-bold">Verified & Secured</span>
                  </div>
                </div>

                {/* Progress countdown */}
                <div className="w-full flex flex-col items-center gap-2 pt-2">
                  <div className="flex items-center gap-2 text-xs font-mono text-indigo-700 dark:text-indigo-300 font-bold">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
                    <span>Entering Upload Center Console...</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 dark:bg-indigo-400 animate-pulse w-full"></div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                {/* Close/Cancel button */}
                <button
                  type="button"
                  onClick={handleCancelCompulsoryChange}
                  className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                  title="Cancel & Lock Console"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Header */}
                <div className="mb-5 space-y-2">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-mono text-[11px] font-bold uppercase tracking-wider shadow-xs">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>COMPULSORY SECURITY MANDATE</span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    <span>Compulsory M-PIN Change (अनिवार्य M-PIN परिवर्तन)</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed font-normal">
                    Default system M-PIN <strong className="text-amber-700 dark:text-amber-300 font-mono font-bold">54321</strong> verified. To protect government database records and license archives, you must set a new confidential 5-digit M-PIN before accessing the Upload Center.
                  </p>
                </div>

                {/* Alert Warning Box */}
                <div className="mb-4 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 text-xs font-mono flex items-start gap-2.5 shadow-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-bold">Security Rule:</span>
                    <p className="text-[11px] text-amber-800 dark:text-amber-200/90 leading-normal font-normal">
                      Default M-PIN (54321), new M-PIN, and confirmation M-PIN must all match 100% to successfully update and secure your console.
                    </p>
                  </div>
                </div>

                {/* Form */}
                <form onSubmit={handleCompulsoryChangeSubmit} className="space-y-4">
                  {/* Field 1: Default M-PIN */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-mono text-slate-700 dark:text-slate-200 font-bold flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Key className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        1. Default Security M-PIN (54321)
                      </span>
                      {compulsoryDefaultPin.trim() === '54321' ? (
                        <span className="text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Matched
                        </span>
                      ) : compulsoryDefaultPin.trim().length > 0 ? (
                        <span className="text-rose-700 dark:text-rose-400 text-xs font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Must be 54321
                        </span>
                      ) : null}
                    </label>

                    <div className="relative">
                      <input
                        type={showCompulsoryDefaultPin ? 'text' : 'password'}
                        id="compulsory-default-mpin"
                        maxLength={5}
                        value={compulsoryDefaultPin}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/\D/g, '').slice(0, 5);
                          setCompulsoryDefaultPin(clean);
                          setCompulsoryError(null);
                        }}
                        placeholder="54321"
                        className="w-full bg-white hover:border-slate-400 focus:border-amber-500 dark:bg-[#060D1A] dark:hover:border-slate-600 dark:focus:border-amber-400 border-2 border-slate-200 focus:ring-4 focus:ring-amber-500/15 rounded-xl py-2.5 px-3.5 pr-11 text-slate-900 dark:text-amber-200 font-mono text-sm tracking-widest outline-none transition-all placeholder:text-slate-400 shadow-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCompulsoryDefaultPin(!showCompulsoryDefaultPin)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-amber-300 transition-colors cursor-pointer p-1"
                        title={showCompulsoryDefaultPin ? 'Hide PIN' : 'Show PIN'}
                      >
                        {showCompulsoryDefaultPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Field 2: 1st New M-PIN */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-mono text-slate-700 dark:text-slate-200 font-bold flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Lock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        2. New 5-Digit Security M-PIN
                      </span>
                      {compulsoryFirstPin.trim() === '54321' ? (
                        <span className="text-rose-700 dark:text-rose-400 text-xs font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Must not be 54321
                        </span>
                      ) : /^\d{5}$/.test(compulsoryFirstPin.trim()) ? (
                        <span className="text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Valid PIN
                        </span>
                      ) : null}
                    </label>

                    <div className="relative">
                      <input
                        type={showCompulsoryFirstPin ? 'text' : 'password'}
                        id="compulsory-first-mpin"
                        maxLength={5}
                        value={compulsoryFirstPin}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/\D/g, '').slice(0, 5);
                          setCompulsoryFirstPin(clean);
                          setCompulsoryError(null);
                        }}
                        placeholder="Enter 1st New 5-Digit PIN (e.g. 84920)"
                        className="w-full bg-white hover:border-slate-400 focus:border-indigo-600 dark:bg-[#060D1A] dark:hover:border-slate-600 dark:focus:border-indigo-400 border-2 border-slate-200 focus:ring-4 focus:ring-indigo-500/15 rounded-xl py-2.5 px-3.5 pr-11 text-slate-900 dark:text-white font-mono text-sm tracking-widest outline-none transition-all placeholder:text-slate-400 shadow-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCompulsoryFirstPin(!showCompulsoryFirstPin)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-indigo-300 transition-colors cursor-pointer p-1"
                        title={showCompulsoryFirstPin ? 'Hide PIN' : 'Show PIN'}
                      >
                        {showCompulsoryFirstPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Field 3: 2nd New M-PIN */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-mono text-slate-700 dark:text-slate-200 font-bold flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        3. Confirm New 5-Digit M-PIN
                      </span>
                      {compulsorySecondPin.trim().length === 5 ? (
                        compulsorySecondPin.trim() === compulsoryFirstPin.trim() && compulsoryFirstPin.trim() !== '54321' ? (
                          <span className="text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> 100% Matched
                          </span>
                        ) : (
                          <span className="text-rose-700 dark:text-rose-400 text-xs font-bold flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Does not match new PIN
                          </span>
                        )
                      ) : null}
                    </label>

                    <div className="relative">
                      <input
                        type={showCompulsorySecondPin ? 'text' : 'password'}
                        id="compulsory-second-mpin"
                        maxLength={5}
                        value={compulsorySecondPin}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/\D/g, '').slice(0, 5);
                          setCompulsorySecondPin(clean);
                          setCompulsoryError(null);
                        }}
                        placeholder="Re-enter New 5-Digit PIN to Confirm"
                        className="w-full bg-white hover:border-slate-400 focus:border-emerald-600 dark:bg-[#060D1A] dark:hover:border-slate-600 dark:focus:border-emerald-400 border-2 border-slate-200 focus:ring-4 focus:ring-emerald-500/15 rounded-xl py-2.5 px-3.5 pr-11 text-slate-900 dark:text-white font-mono text-sm tracking-widest outline-none transition-all placeholder:text-slate-400 shadow-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCompulsorySecondPin(!showCompulsorySecondPin)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-emerald-300 transition-colors cursor-pointer p-1"
                        title={showCompulsorySecondPin ? 'Hide PIN' : 'Show PIN'}
                      >
                        {showCompulsorySecondPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Real-time Match Status Banner */}
                  {compulsoryDefaultPin.trim() === '54321' &&
                  /^\d{5}$/.test(compulsoryFirstPin.trim()) &&
                  compulsoryFirstPin.trim() !== '54321' &&
                  compulsorySecondPin.trim() === compulsoryFirstPin.trim() ? (
                    <div className="w-full p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-700/70 text-emerald-900 dark:text-emerald-200 text-xs font-mono flex items-center justify-between shadow-xs animate-in fade-in duration-200">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="font-bold">✓ Default, new, and confirmation M-PINs matched 100%!</span>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-xs">
                        READY TO SAVE
                      </span>
                    </div>
                  ) : null}

                  {/* Errors */}
                  {compulsoryError && (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-700/60 text-rose-900 dark:text-rose-200 text-xs flex items-center gap-2 font-medium shadow-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                      <span>{compulsoryError}</span>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={handleCancelCompulsoryChange}
                      disabled={isSubmittingCompulsoryChange}
                      className="w-full sm:w-1/3 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer text-center shadow-xs"
                    >
                      CANCEL
                    </button>

                    <button
                      type="submit"
                      id="btn-confirm-compulsory-mpin"
                      disabled={
                        isSubmittingCompulsoryChange ||
                        compulsoryDefaultPin.trim() !== '54321' ||
                        !/^\d{5}$/.test(compulsoryFirstPin.trim()) ||
                        compulsoryFirstPin.trim() === '54321' ||
                        compulsorySecondPin.trim() !== compulsoryFirstPin.trim()
                      }
                      className="w-full sm:w-2/3 py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white active:scale-[0.99] font-mono font-bold text-xs uppercase tracking-wider shadow-xs transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isSubmittingCompulsoryChange ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                          <span className="font-bold uppercase tracking-wider">SECURING PIN...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4 text-white" />
                          <span className="font-bold uppercase tracking-wider">CONFIRM & SECURE NEW M-PIN</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
        <div className="w-full max-w-5xl my-auto bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl transition-colors">
          {cardContent}
        </div>
      </div>
    );
  }

  return cardContent;
};
