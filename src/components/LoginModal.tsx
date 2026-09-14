import React, { useState } from 'react';
import {
  Shield,
  Lock,
  User,
  AlertTriangle,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { login } = useAuth();

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Reset fields to empty when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setIdentifier('');
      setPassword('');
      setError('');
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

    const trimmedId = identifier.trim().toUpperCase();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-[#0B1526] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div>
          {/* Header */}
          <div className="p-6 pb-3 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 text-white mb-3 shadow-md shadow-blue-500/20">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight uppercase">
              PLSMS Command Center
            </h2>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
              Printed License Search Management System
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLoginSubmit} className="p-6 pt-2 space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Email / User ID field */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                <User className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <span>Username or Email Address</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value.toUpperCase());
                    if (error) setError('');
                  }}
                  placeholder="ENTER USER ID OR EMAIL"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck="false"
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-[#060D1A] border border-slate-300 dark:border-[#1E375F] rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-600 transition-all uppercase tracking-wide"
                />
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                Enter your registered User ID (e.g. SUPER_ADMIN) or confidential email address.
              </p>
            </div>

            {/* Password field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  <span>Confidential Password</span>
                </label>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="••••••••••••"
                  className="w-full px-4 pr-11 py-2.5 bg-slate-50 dark:bg-[#060D1A] border border-slate-300 dark:border-[#1E375F] rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-600 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors focus:outline-none cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  ) : (
                    <Eye className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Login Action Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className={`w-full py-3 px-4 rounded-xl text-sm font-bold uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-md ${
                  canSubmit
                    ? 'bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white cursor-pointer shadow-blue-500/20'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-300 dark:border-slate-700 cursor-not-allowed select-none'
                }`}
              >
                {loading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>AUTHENTICATING...</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    <span>LOGIN</span>
                  </>
                )}
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-center">
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Official government portal. All access attempts are strictly monitored and logged.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
