import React, { useState, useEffect } from 'react';
import {
  Lock,
  KeyRound,
  ShieldCheck,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  X,
  Sparkles,
  Shield,
  ArrowRight,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

const formatPrimaryRole = (roleStr?: string) => {
  const upper = (roleStr || '').trim().toUpperCase();
  if (upper === 'SUPER_ADMIN' || upper.includes('SUPER')) return 'SUPER ADMIN';
  if (upper === 'ADMIN' || upper.includes('ADMINISTRATOR')) return 'ADMINISTRATOR';
  if (upper === 'SMART CARD DISTRIBUTER' || upper.includes('SMART') || upper.includes('CARD')) return 'SMART CARD DISTRIBUTER';
  return 'DATA ENTRY OFFICER';
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultCurrentPassword?: string;
}

export const FirstLoginPasswordModal: React.FC<Props> = ({
  isOpen,
  onClose,
  defaultCurrentPassword = '',
}) => {
  const { user, updateUser, logout } = useAuth();
  const isCompulsory = Boolean(user?.mustChangePassword);

  const [currentPassword, setCurrentPassword] = useState(defaultCurrentPassword);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Sync default current password if passed in
  useEffect(() => {
    if (defaultCurrentPassword) {
      setCurrentPassword(defaultCurrentPassword);
    }
  }, [defaultCurrentPassword]);

  if (!isOpen) return null;

  // Password validation checks
  const hasMinLength = newPassword.length >= 6;
  const hasLetters = /[a-zA-Z]/.test(newPassword);
  const hasNumbersOrSymbols = /[^a-zA-Z]/.test(newPassword);
  const isDifferentFromOld = !currentPassword || newPassword !== currentPassword;
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isNotDefault =
    newPassword !== 'Itahari@PLSMS' &&
    newPassword !== 'Itahari@2026' &&
    newPassword.toLowerCase() !== 'itahari@plsms' &&
    newPassword.toLowerCase() !== 'itahari@2026';

  // Strength score
  let strengthScore = 0;
  if (hasMinLength) strengthScore += 1;
  if (hasLetters) strengthScore += 1;
  if (hasNumbersOrSymbols) strengthScore += 1;
  if (newPassword.length >= 8) strengthScore += 1;

  const isFormValid =
    hasMinLength &&
    hasLetters &&
    hasNumbersOrSymbols &&
    isDifferentFromOld &&
    passwordsMatch &&
    isNotDefault &&
    !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!hasMinLength) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    if (!hasLetters || !hasNumbersOrSymbols) {
      setError('Password must contain a mix of letters and numbers/special symbols.');
      return;
    }

    if (!isNotDefault) {
      setError('New personal password cannot be the system default password. Please choose your own personal confidential password.');
      return;
    }

    if (!isDifferentFromOld) {
      setError('New password cannot be identical to your temporary initial password.');
      return;
    }

    if (!passwordsMatch) {
      setError('New password and confirmation password do not match.');
      return;
    }

    try {
      setLoading(true);
      const res = await api.changePassword({
        currentPassword: currentPassword || undefined,
        newPassword,
        isFirstLogin: true,
      });

      if (res && res.user) {
        updateUser({ ...res.user, mustChangePassword: false, isDefaultPassword: false });
      } else if (user) {
        updateUser({ ...user, mustChangePassword: false, isDefaultPassword: false });
      }

      setSuccess(true);

      // Trigger celebratory confetti
      try {
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch (err) {
        // Safe fallback if canvas not available
      }

      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1600);
    } catch (err: any) {
      setError(err.message || 'Failed to update password. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-[#0A1222] border border-slate-200 dark:border-[#1E3A66] rounded-3xl shadow-2xl overflow-hidden relative transition-colors">
        
        {/* Subtle decorative top bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-500" />

        {/* Close / Dismiss or Sign Out Button */}
        {isCompulsory ? (
          <button
            type="button"
            onClick={logout}
            className="absolute top-4 right-4 px-3 py-1.5 rounded-xl text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer"
            title="Sign Out / Cancel login"
          >
            SIGN OUT
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Dismiss / Remind Me Later"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Dialog Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3.5 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-inner shrink-0">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700/60 text-amber-800 dark:text-amber-300 text-[10px] font-black uppercase tracking-wider font-mono mb-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span>First Login Security Setup</span>
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                Set Your Personal Password
              </h2>
            </div>
          </div>
          
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Welcome to the PLSMS Command Center! Your login was successful. To ensure official government data security, please choose your personal confidential password.
          </p>
        </div>

        {/* Staff Identity Pill */}
        {user && (
          <div className="mx-6 mb-4 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#060D1A] border border-slate-200 dark:border-[#142642] flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <div className="truncate">
                <span className="font-bold text-slate-900 dark:text-white uppercase font-mono">
                  {user.name}
                </span>
                <span className="text-slate-400 dark:text-slate-500 ml-1.5 font-mono text-[11px]">
                  ({user.id})
                </span>
              </div>
            </div>
            {formatPrimaryRole(user.role) === 'SUPER ADMIN' ? (
              <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-amber-100 dark:bg-amber-950/90 border-[1.5px] border-amber-500 text-amber-900 dark:text-amber-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs shrink-0">
                👑 SUPER ADMIN
              </span>
            ) : formatPrimaryRole(user.role) === 'ADMINISTRATOR' ? (
              <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-purple-100 dark:bg-purple-950/90 border-[1.5px] border-purple-500 text-purple-900 dark:text-purple-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs shrink-0">
                🛡️ ADMINISTRATOR
              </span>
            ) : formatPrimaryRole(user.role) === 'SMART CARD DISTRIBUTER' ? (
              <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-emerald-100 dark:bg-emerald-950/90 border-[1.5px] border-emerald-500 text-emerald-900 dark:text-emerald-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs shrink-0">
                🪪 SMART CARD DISTRIBUTER
              </span>
            ) : (
              <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-cyan-100 dark:bg-cyan-950/90 border-[1.5px] border-cyan-500 text-cyan-900 dark:text-cyan-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs shrink-0">
                👤 DATA ENTRY OFFICER
              </span>
            )}
          </div>
        )}

        {/* Success Card or Form */}
        {success ? (
          <div className="p-8 text-center space-y-3 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-3xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-emerald-500 mx-auto flex items-center justify-center shadow-lg">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h3 className="text-base font-bold text-emerald-700 dark:text-emerald-300">
              Password Updated Successfully!
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xs mx-auto">
              Your new personal password is saved in the encrypted database. Directing you into the application...
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
            {error && (
              <div className="bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 p-3 rounded-xl text-xs font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Current / Temporary Password */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono">
                  Current Temporary Password <span className="text-rose-500">*</span>
                </label>
                {defaultCurrentPassword && (
                  <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1 font-mono">
                    <ShieldCheck className="w-3 h-3" /> Auto-verified from session
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 dark:bg-[#070F1E] border border-slate-300 dark:border-[#1E3A66] rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  title={showCurrent ? 'Hide' : 'Show'}
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1 font-mono">
                New Secure Password <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters (mix letters & numbers/symbols)"
                  className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 dark:bg-[#070F1E] border border-slate-300 dark:border-[#1E3A66] rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  title={showNew ? 'Hide' : 'Show'}
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Strength Meter Bar */}
              {newPassword.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-500 dark:text-slate-400">Password Strength:</span>
                    <span
                      className={`font-bold ${
                        strengthScore <= 1
                          ? 'text-rose-500'
                          : strengthScore <= 2
                          ? 'text-amber-500'
                          : strengthScore === 3
                          ? 'text-indigo-500 dark:text-indigo-400'
                          : 'text-emerald-500'
                      }`}
                    >
                      {strengthScore <= 1
                        ? 'Weak'
                        : strengthScore <= 2
                        ? 'Fair'
                        : strengthScore === 3
                        ? 'Good'
                        : 'Strong & Secure'}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex gap-0.5">
                    <div
                      className={`h-full transition-all duration-300 ${
                        strengthScore >= 1
                          ? strengthScore <= 1
                            ? 'bg-rose-500 w-1/4'
                            : strengthScore <= 2
                            ? 'bg-amber-500 w-2/4'
                            : strengthScore === 3
                            ? 'bg-indigo-500 w-3/4'
                            : 'bg-emerald-500 w-full'
                          : 'w-0'
                      }`}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Confirm New Password */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono">
                  Confirm New Password <span className="text-rose-500">*</span>
                </label>
                {confirmPassword && (
                  <span
                    className={`text-[10px] font-mono font-bold flex items-center gap-1 ${
                      passwordsMatch ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                    }`}
                  >
                    {passwordsMatch ? '✓ Passwords match' : '✕ Does not match'}
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className={`w-full pl-3.5 pr-10 py-2.5 bg-slate-50 dark:bg-[#070F1E] border rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none transition-colors ${
                    confirmPassword && !passwordsMatch
                      ? 'border-rose-400 dark:border-rose-600 focus:border-rose-500'
                      : 'border-slate-300 dark:border-[#1E3A66] focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  title={showConfirm ? 'Hide' : 'Show'}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Security Notice Checklist */}
            <div className="p-3 bg-slate-50 dark:bg-[#060D1A] rounded-xl border border-slate-200 dark:border-[#142642] text-[11px] space-y-1 text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200 text-xs mb-1">
                <Shield className="w-3.5 h-3.5 text-indigo-500" />
                <span>Security Requirements:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 font-mono text-[10.5px]">
                <span className={hasMinLength ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                  {hasMinLength ? '✓' : '•'} Min. 6 characters
                </span>
                <span className={hasLetters ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                  {hasLetters ? '✓' : '•'} Contains letters (A-Z)
                </span>
                <span className={hasNumbersOrSymbols ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                  {hasNumbersOrSymbols ? '✓' : '•'} Numbers or symbols
                </span>
                <span className={isDifferentFromOld ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-500'}>
                  {isDifferentFromOld ? '✓' : '✕'} Different from old
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              {isCompulsory ? (
                <button
                  type="button"
                  onClick={logout}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors font-mono cursor-pointer"
                >
                  SIGN OUT
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-mono cursor-pointer"
                >
                  REMIND ME LATER
                </button>
              )}

              <button
                type="submit"
                disabled={!isFormValid}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all duration-200 ${
                  isFormValid
                    ? 'bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white shadow-indigo-600/30 cursor-pointer'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-60'
                }`}
              >
                {loading ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span className="font-bold uppercase tracking-wider">SAVE NEW PASSWORD</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
