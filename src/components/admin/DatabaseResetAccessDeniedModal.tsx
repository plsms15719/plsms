import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, X, Lock, UserX, ArrowLeft, AlertTriangle, Database } from 'lucide-react';
import { User } from '../../types';

interface DatabaseResetAccessDeniedModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
}

export const DatabaseResetAccessDeniedModal: React.FC<DatabaseResetAccessDeniedModalProps> = ({
  isOpen,
  onClose,
  user,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          id="database-reset-access-denied-overlay"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md transition-all"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 340 }}
            id="database-reset-access-denied-modal"
            className="w-full max-w-2xl bg-white dark:bg-[#070F1E] border-2 border-rose-500/70 dark:border-rose-500/80 rounded-3xl shadow-2xl shadow-rose-950/40 p-6 sm:p-8 flex flex-col items-center text-center relative overflow-hidden space-y-5"
          >
            {/* Ambient Background Glow */}
            <div className="absolute -top-20 -right-20 w-52 h-52 bg-rose-500/15 dark:bg-rose-500/25 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -left-20 w-52 h-52 bg-amber-500/15 dark:bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />

            {/* Top Close Button */}
            <button
              type="button"
              id="btn-close-reset-denied-modal"
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white bg-slate-100 dark:bg-slate-900/80 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer z-10"
              title="Close Notice"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Top Section: Rectangular Icon Frame & Security Badges */}
            <div className="flex flex-col items-center gap-2.5 pt-1">
              <div className="flex items-center gap-2">
                <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-950/80 dark:to-rose-900/40 border-2 border-rose-300 dark:border-rose-700/80 flex items-center justify-center text-rose-600 dark:text-rose-400 shadow-lg shadow-rose-500/10 ring-4 ring-rose-500/15">
                  <ShieldAlert className="w-9 h-9 sm:w-10 sm:h-10 text-rose-600 dark:text-rose-400 animate-pulse" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-rose-100 dark:bg-rose-950/90 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[10px] sm:text-[11px] font-mono font-bold uppercase tracking-wider shadow-xs">
                  <Lock className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                  <span>CRITICAL SAFEGUARD • SUPER ADMIN EXCLUSIVE</span>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-[10px] sm:text-[11px] font-mono font-bold uppercase tracking-wider shadow-xs">
                  <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  <span>PREVENTS IRREVERSIBLE DATA LOSS</span>
                </div>
              </div>
            </div>

            {/* Center Section: Access Denied Message */}
            <div className="space-y-2.5 max-w-xl">
              <h2 className="text-base sm:text-xl font-black text-rose-600 dark:text-rose-400 tracking-tight uppercase leading-snug">
                ACCESS DENIED : SUPER ADMIN ONLY ACTION !!!
              </h2>
              <p className="text-xs font-semibold text-rose-700/90 dark:text-rose-300/90 font-mono">
                डाटाबेस रिसेट कार्य केवल सुपर एडमिनका लागि मात्र सुरक्षित गरिएको छ (RESTRICTED ZONE)
              </p>
              <div className="p-3.5 rounded-2xl bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-slate-700 dark:text-slate-300 text-xs sm:text-[13px] leading-relaxed text-left space-y-2 font-sans">
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-500 font-bold text-sm shrink-0 mt-0.5">•</span>
                  <span>
                    <strong>High Risk of Data Loss:</strong> Resetting the whole application and both databases (PLSMS Core Database & Google Sheet Sync Engine) permanently wipes all government printed license records.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-500 font-bold text-sm shrink-0 mt-0.5">•</span>
                  <span>
                    <strong>Office Staff Restriction:</strong> Office staff and delegated operators are strictly prohibited from resetting databases to protect official citizen and license data from accidental loss.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-500 font-bold text-sm shrink-0 mt-0.5">•</span>
                  <span>
                    <strong>Super Administrator Clearance:</strong> Only the official <strong className="text-rose-600 dark:text-rose-400 font-bold">Super Administrator</strong> is permitted to execute this action.
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Section: Current User Role Identity Pill & Dismiss Button */}
            <div className="w-full max-w-xl space-y-3 pt-1">
              <div className="w-full py-2.5 px-4 rounded-xl bg-slate-50 dark:bg-[#0B172B] border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-600 dark:text-slate-400 flex items-center justify-between shadow-inner">
                <span className="flex items-center gap-2 truncate">
                  <UserX className="w-4 h-4 text-rose-500 shrink-0" />
                  <span className="truncate font-semibold">{user?.name || 'Office Staff User'}</span>
                </span>
                <span className="font-bold text-rose-600 dark:text-rose-400 shrink-0 uppercase tracking-wider">
                  [{user?.role || 'STAFF'} • RESTRICTED]
                </span>
              </div>

              <button
                type="button"
                id="btn-confirm-reset-denied-dismiss"
                onClick={onClose}
                className="w-full py-3 px-5 bg-gradient-to-r from-rose-600 via-rose-700 to-rose-800 hover:from-rose-700 hover:to-rose-900 text-white font-mono text-xs sm:text-sm font-bold uppercase tracking-wider rounded-xl shadow-md hover:shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>UNDERSTOOD — RETURN TO WORKING AREA</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
