import React, { useState } from 'react';
import {
  KeyRound,
  Lock,
  User,
  AlertTriangle,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { login } = useAuth();
  const { isDark } = useTheme();

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Reset fields to empty when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setIdentifier('');
      setPassword('');
      setError('');
      setIsInputFocused(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    setIdentifier('');
    setPassword('');
    setError('');
    onClose();
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedId = identifier.trim();
    if (!trimmedId) {
      setError('Please enter your Username or Email Address.');
      return;
    }
    if (!password) {
      setError('Please enter your confidential password.');
      return;
    }

    try {
      setLoading(true);
      await login(trimmedId, password);
      // Login successful: close login modal to enter the command center immediately
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Invalid Username/Email or Password. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !loading;

  return (
    <div
      id="plsms-login-modal-overlay"
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200 ${
        isDark ? 'bg-black/85 backdrop-blur-md' : 'bg-slate-900/60 backdrop-blur-sm'
      }`}
    >
      {/* Wide Horizontal Rectangular Dialog Container matching official design */}
      <div
        id="plsms-login-dialog-card"
        className={`w-full max-w-xl sm:max-w-[620px] rounded-2xl sm:rounded-3xl p-7 sm:p-9 shadow-2xl relative transition-colors ${
          isDark
            ? 'bg-[#0B1322] border border-[#1B2942] shadow-black/90 text-white'
            : 'bg-white border border-slate-200 shadow-xl shadow-slate-900/15 text-slate-900'
        }`}
      >
        {/* Top-Right Close Button */}
        <button
          id="btn-close-login-modal"
          onClick={handleClose}
          className={`absolute top-5 right-5 sm:top-6 sm:right-6 p-1.5 rounded-lg transition-colors cursor-pointer ${
            isDark
              ? 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              : 'text-slate-400 hover:text-slate-800 hover:bg-slate-100'
          }`}
          title="Close"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Centered Header with symbolic yellow Lock & Key badge in front of the two lines of text */}
        <div className="flex items-center justify-center gap-3.5 sm:gap-4 mb-7 text-left mx-auto">
          <div
            id="plsms-login-key-badge"
            className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#0c2444] via-[#10335c] to-[#07172c] flex items-center justify-center shadow-[0_4px_16px_rgba(245,158,11,0.25)] shrink-0 border border-amber-400/40 p-1.5 overflow-hidden"
          >
            {/* Ambient warm glow inside badge */}
            <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/10 via-transparent to-blue-400/15 pointer-events-none" />

            {/* Yellow Lock (padlock) */}
            <Lock className="w-5.5 h-5.5 sm:w-6 sm:h-6 text-amber-400 fill-amber-400/25 stroke-[2.2] -translate-x-1 -translate-y-0.5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" />

            {/* Yellow Key in foreground across the lock */}
            <KeyRound className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-yellow-300 fill-yellow-300/30 stroke-[2.4] absolute translate-x-1.5 translate-y-1 drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]" />
          </div>

          <div className="shrink-0">
            <h2
              id="plsms-login-title"
              className={`text-xl sm:text-2xl font-black tracking-wider uppercase leading-tight ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              PLSMS LOG-IN CENTER
            </h2>
            <p
              id="plsms-login-subtitle"
              className={`text-xs sm:text-sm font-semibold mt-1 leading-snug ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              }`}
            >
              Printed License Search Management System
            </p>
          </div>
        </div>

        {/* Form Container */}
        <form onSubmit={handleLoginSubmit} className="space-y-5">
          {error && (
            <div
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                isDark
                  ? 'bg-red-950/50 border border-red-800/80 text-red-300'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              <AlertTriangle className={`w-4 h-4 shrink-0 ${isDark ? 'text-red-400' : 'text-red-600'}`} />
              <span>{error}</span>
            </div>
          )}

          {/* Username or Email Address */}
          <div>
            <label
              className={`text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2 ${
                isDark ? 'text-slate-300' : 'text-slate-800'
              }`}
            >
              <User className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              <span>Enter your User Name or Email Address</span>
            </label>
            <div className="relative">
              <input
                id="input-login-identifier"
                type="text"
                required
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  if (error) setError('');
                }}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                placeholder="Enter your User Name or Email Address"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                className={`w-full px-4 py-3.5 rounded-xl text-sm font-medium focus:outline-none transition-all ${
                  isDark
                    ? 'bg-[#070D18] text-white placeholder:text-slate-500 ' +
                      (isInputFocused || identifier.trim().length > 0
                        ? 'border-blue-500 ring-2 ring-blue-500/25 border'
                        : 'border border-[#1E2E48] hover:border-slate-600')
                    : 'bg-slate-50 hover:bg-white focus:bg-white text-slate-900 placeholder:text-slate-400 ' +
                      (isInputFocused || identifier.trim().length > 0
                        ? 'border-blue-600 ring-2 ring-blue-600/20 border'
                        : 'border border-slate-300 hover:border-slate-400')
                }`}
              />
            </div>
            <p className={`text-[11px] mt-1.5 font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Enter your registered User ID (case-insensitive) or confidential email address.
            </p>
          </div>

          {/* Confidential Password */}
          <div>
            <label
              className={`text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2 ${
                isDark ? 'text-slate-300' : 'text-slate-800'
              }`}
            >
              <Lock className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
              <span>CONFIDENTIAL PASSWORD</span>
            </label>
            <div className="relative">
              <input
                id="input-login-password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder="••••••••••••"
                className={`w-full px-4 pr-12 py-3.5 rounded-xl text-sm font-medium focus:outline-none transition-all ${
                  isDark
                    ? 'bg-[#070D18] text-white placeholder:text-slate-500 border border-[#1E2E48] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25'
                    : 'bg-slate-50 hover:bg-white focus:bg-white text-slate-900 placeholder:text-slate-400 border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20'
                }`}
              />
              <button
                type="button"
                id="btn-toggle-login-password"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-3.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors focus:outline-none cursor-pointer ${
                  isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'
                }`}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className={`w-4 h-4 ${isDark ? 'text-slate-300' : 'text-slate-600'}`} />
                ) : (
                  <Eye className={`w-4 h-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
                )}
              </button>
            </div>
          </div>

          {/* Login Action Button */}
          <div className="pt-2 flex justify-center">
            <button
              id="btn-submit-login"
              type="submit"
              disabled={!canSubmit}
              className={`w-auto min-w-[170px] sm:min-w-[190px] py-2.5 px-7 rounded-xl text-xs sm:text-sm font-bold uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 ${
                canSubmit
                  ? 'bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white cursor-pointer shadow-lg shadow-blue-600/30 border border-blue-600'
                  : isDark
                  ? 'bg-[#121B2D] text-slate-500 border border-slate-700/60 cursor-not-allowed select-none'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed select-none'
              }`}
            >
              {loading ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span className="text-white">AUTHENTICATING...</span>
                </>
              ) : (
                <>
                  <Lock className={`w-4 h-4 ${canSubmit ? 'text-white' : isDark ? 'text-slate-500' : 'text-slate-400'}`} />
                  <span>LOGIN</span>
                </>
              )}
            </button>
          </div>

          {/* Official Government Disclaimer */}
          <p className={`text-xs text-center pt-2 font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Official government portal. All access attempts are strictly monitored and logged.
          </p>
        </form>
      </div>
    </div>
  );
};
