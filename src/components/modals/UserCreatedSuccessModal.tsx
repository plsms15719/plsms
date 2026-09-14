import React, { useEffect } from 'react';
import {
  CheckCircle2,
  User,
  Shield,
  Briefcase,
  Hash,
  Sparkles,
  Award,
} from 'lucide-react';
import confetti from 'canvas-confetti';

export interface CreatedUserInfo {
  name: string;
  id: string;
  role: string;
  post?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  user: CreatedUserInfo | null;
}

export const UserCreatedSuccessModal: React.FC<Props> = ({
  isOpen,
  onClose,
  user,
}) => {
  useEffect(() => {
    if (isOpen) {
      try {
        confetti({
          particleCount: 70,
          spread: 80,
          origin: { y: 0.55 },
          colors: ['#10B981', '#6366F1', '#F59E0B', '#3B82F6'],
        });
      } catch (e) {
        // Fallback if canvas is not available in environment
      }
    }
  }, [isOpen]);

  // Handle Enter key for quick dismissal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !user) return null;

  // Format role name in neat uppercase
  const formatRole = (roleStr: string) => {
    const upper = (roleStr || '').toUpperCase();
    if (upper === 'SUPER_ADMIN' || upper.includes('SUPER')) return 'SUPER ADMIN';
    if (upper === 'ADMIN' || upper.includes('ADMINISTRATOR')) return 'ADMINISTRATOR';
    if (upper === 'DATA ENTRY OFFICER' || upper === 'DATA_ENTRY_OFFICER' || upper === 'OFFICE_STAFF' || upper.includes('STAFF') || upper.includes('ENTRY')) {
      return 'DATA ENTRY OFFICER';
    }
    return upper.replace(/_/g, ' ') || 'DATA ENTRY OFFICER';
  };

  const fullNameUpper = (user.name || '').toUpperCase();
  const userIdUpper = (user.id || '').toUpperCase();
  const roleUpper = formatRole(user.role).toUpperCase();
  const postUpper = (user.post || 'OFFICE OPERATOR').toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-[#0A1222] border-2 border-emerald-500/50 dark:border-emerald-500/40 rounded-3xl shadow-2xl shadow-emerald-500/10 overflow-hidden relative transition-colors animate-in zoom-in-95 duration-200">
        
        {/* Subtle decorative top gradient bar */}
        <div className="h-2 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />

        <div className="p-6 sm:p-8 space-y-6">
          
          {/* Header with Success Icon */}
          <div className="text-center space-y-3">
            <div className="relative inline-block">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-emerald-50 dark:bg-emerald-950/80 border-2 border-emerald-300 dark:border-emerald-700/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <CheckCircle2 className="w-10 h-10 sm:w-12 sm:h-12" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-md animate-bounce">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
            </div>

            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/90 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-[11px] font-black uppercase tracking-wider font-mono mb-2">
                <Award className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>OFFICIAL ACCOUNT CREATED</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight font-mono">
                User Created Successfully----
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                The new staff credentials have been securely registered in the central system.
              </p>
            </div>
          </div>

          {/* Credentials Display Card (All in CAPITAL LETTERS) */}
          <div className="bg-slate-50 dark:bg-[#070E1C] border border-slate-200 dark:border-[#162846] rounded-2xl p-5 space-y-3.5 shadow-inner">
            
            {/* FULL NAME */}
            <div className="flex items-center justify-between py-2 border-b border-slate-200/80 dark:border-slate-800/80 gap-3">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0">
                <User className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-[11px] font-black uppercase tracking-wider font-mono">
                  FULL NAME
                </span>
              </div>
              <span className="text-sm sm:text-base font-black text-slate-900 dark:text-white font-mono uppercase tracking-wide text-right truncate">
                {fullNameUpper}
              </span>
            </div>

            {/* USER ID */}
            <div className="flex items-center justify-between py-2 border-b border-slate-200/80 dark:border-slate-800/80 gap-3">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0">
                <Hash className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-[11px] font-black uppercase tracking-wider font-mono">
                  USER ID
                </span>
              </div>
              <span className="text-xs sm:text-sm font-black font-mono uppercase tracking-wider text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800/60 px-2.5 py-1 rounded-lg text-right">
                {userIdUpper}
              </span>
            </div>

            {/* ROLE */}
            <div className="flex items-center justify-between py-2 border-b border-slate-200/80 dark:border-slate-800/80 gap-3">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0">
                <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-[11px] font-black uppercase tracking-wider font-mono">
                  ROLE
                </span>
              </div>
              {roleUpper === 'SUPER ADMIN' ? (
                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-xs font-black bg-amber-100 dark:bg-amber-950/90 border-[1.5px] border-amber-500 text-amber-900 dark:text-amber-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                  👑 SUPER ADMIN
                </span>
              ) : roleUpper === 'ADMINISTRATOR' ? (
                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-xs font-black bg-purple-100 dark:bg-purple-950/90 border-[1.5px] border-purple-500 text-purple-900 dark:text-purple-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                  🛡️ ADMINISTRATOR
                </span>
              ) : roleUpper === 'SMART CARD DISTRIBUTER' ? (
                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-xs font-black bg-emerald-100 dark:bg-emerald-950/90 border-[1.5px] border-emerald-500 text-emerald-900 dark:text-emerald-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                  🪪 SMART CARD DISTRIBUTER
                </span>
              ) : (
                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-xs font-black bg-cyan-100 dark:bg-cyan-950/90 border-[1.5px] border-cyan-500 text-cyan-900 dark:text-cyan-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                  👤 DATA ENTRY OFFICER
                </span>
              )}
            </div>

            {/* POST */}
            <div className="flex items-center justify-between py-2 gap-3">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 shrink-0">
                <Briefcase className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span className="text-[11px] font-black uppercase tracking-wider font-mono">
                  POST
                </span>
              </div>
              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 font-mono uppercase tracking-wide text-right truncate">
                {postUpper}
              </span>
            </div>

          </div>

          {/* Dialog Box Action: ONLY an 'OK' Button */}
          <div className="pt-2 flex justify-center">
            <button
              type="button"
              autoFocus
              onClick={onClose}
              className="w-full sm:w-auto min-w-[200px] px-10 py-3.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black font-mono text-sm tracking-wider uppercase rounded-2xl shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer ring-2 ring-emerald-500/20 hover:ring-emerald-400/40"
            >
              OK
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
