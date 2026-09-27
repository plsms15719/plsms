import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, X, Lock, UserX, ArrowLeft } from 'lucide-react';
import { User } from '../../types';

interface UploadCenterAccessDeniedModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
}

export const UploadCenterAccessDeniedModal: React.FC<UploadCenterAccessDeniedModalProps> = ({
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
          id="upload-center-access-denied-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/70 backdrop-blur-md transition-all"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 16 }}
            transition={{ type: 'spring', damping: 25, stiffness: 320 }}
            id="upload-center-access-denied-card"
            className="w-full max-w-2xl bg-white dark:bg-[#070F1E] border-2 border-rose-500/50 dark:border-rose-500/60 rounded-3xl shadow-2xl shadow-rose-950/30 p-6 sm:p-8 flex flex-col items-center text-center relative overflow-hidden space-y-5"
          >
            {/* Ambient Background Glow */}
            <div className="absolute -top-16 -right-16 w-44 h-44 bg-rose-500/10 dark:bg-rose-500/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -left-16 w-44 h-44 bg-rose-500/10 dark:bg-rose-500/20 rounded-full blur-3xl pointer-events-none" />

            {/* Top Close Button */}
            <button
              type="button"
              id="btn-close-access-denied-modal"
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white bg-slate-100 dark:bg-slate-900/80 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer z-10"
              title="Close Notice"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Top Section: Shield Icon & Badges */}
            <div className="flex flex-col items-center gap-2 pt-0.5">
              <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border-2 border-rose-300 dark:border-rose-800/80 flex items-center justify-center text-rose-600 dark:text-rose-400 shadow-inner ring-4 ring-rose-500/10">
                <ShieldAlert className="w-9 h-9 sm:w-10 sm:h-10 text-rose-600 dark:text-rose-400 animate-pulse" />
              </div>

              <div className="inline-flex items-center gap-1.5 px-4 py-1 rounded-full bg-rose-100 dark:bg-rose-950/90 border border-rose-200 dark:border-rose-800/80 text-rose-700 dark:text-rose-300 text-[10px] sm:text-[11px] font-mono font-bold uppercase tracking-wider">
                <Lock className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                <span>RESTRICTED PRIVILEGE • AUTHORIZED ACCESS ONLY</span>
              </div>
            </div>

            {/* Center Section: Requested Bold Headline & Elaborating Message */}
            <div className="space-y-2 max-w-xl">
              <h2 className="text-base sm:text-lg font-black text-rose-600 dark:text-rose-400 tracking-tight uppercase leading-snug">
                IT IS NOT ALLOWED TO ACCESS : ACCESS DENIED !!!
              </h2>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 -mt-0.5">
                यो सेक्सनमा प्रवेश निषेध गरिएको छ (RESTRICTED ZONE)
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-1">
                The <strong className="text-slate-900 dark:text-white font-semibold">Upload Center</strong> (Excel Lots & 24/7 Automated Sync Engine) modifies core government database records. Access is reserved for official <strong className="text-rose-600 dark:text-rose-400 font-bold">Super Administrators</strong> or staff members with delegated permissions.
              </p>
            </div>

            {/* Bottom Section: Current User Role Identity Pill & Dismiss Action */}
            <div className="w-full max-w-xl space-y-3 pt-1">
              <div className="w-full py-2.5 px-4 rounded-xl bg-slate-50 dark:bg-[#0B172B] border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-600 dark:text-slate-400 flex items-center justify-between">
                <span className="flex items-center gap-2 truncate">
                  <UserX className="w-4 h-4 text-rose-500 shrink-0" />
                  <span className="truncate font-semibold">{user?.name || 'Staff User'}</span>
                </span>
                <span className="font-bold text-rose-600 dark:text-rose-400 shrink-0 uppercase tracking-wider">
                  [{user?.role || 'UNAUTHORIZED'}]
                </span>
              </div>

              <button
                type="button"
                id="btn-confirm-access-denied-dismiss"
                onClick={onClose}
                className="w-full py-3 px-5 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 text-white font-mono text-xs sm:text-sm font-bold uppercase tracking-wider rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>UNDERSTOOD — RETURN TO SYSTEM SETTINGS</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
