import React, { useState, useEffect } from 'react';
import {
  Shield,
  LogOut,
  LogIn,
  Sun,
  Moon,
  QrCode,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getNepaliFullBSDate } from '../utils/dateUtils';
import { QRCodeModal } from './modals/QRCodeModal';

interface Props {
  activePortal: 'PUBLIC' | 'ADMIN';
  setActivePortal: (portal: 'PUBLIC' | 'ADMIN') => void;
  onOpenLogin: () => void;
}

export const HeaderNav: React.FC<Props> = ({
  activePortal,
  setActivePortal,
  onOpenLogin,
}) => {
  const { user, isAuthenticated, logout, systemRecordsCount, setShowFirstLoginPasswordModal } = useAuth();
  const { theme, isDark, toggleTheme } = useTheme();
  const [qrModalOpen, setQrModalOpen] = useState(false);

  // Live Nepali BS Date ticker
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDate(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const nepDateInfo = getNepaliFullBSDate(currentDate);

  // Extract short role code for badge: SU (Super Admin), ADM (Administrator), DEO (Data Entry Officer)
  const getRoleBadge = () => {
    if (!user) return 'SU';
    const role = (user.role || '').toUpperCase();
    if (role.includes('SUPER') || role === 'SUPER_ADMIN') return 'SU';
    if (role.includes('ADMIN')) return 'ADM';
    return 'DEO';
  };

  // Display User Full Name instead of email address
  const displayUserName = (
    user?.name?.trim() ||
    (user?.email ? user.email.replace(/@.*/, '') : '') ||
    'KOMAL DAHAL'
  ).toUpperCase();

  return (
    <>
      <header className="bg-white dark:bg-[#070e1c] text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800/90 sticky top-0 z-40 transition-colors duration-200 shadow-sm dark:shadow-md">
        <div className="w-full px-2 min-[360px]:px-2.5 min-[400px]:px-3 sm:px-6 lg:px-8 pt-1 sm:pt-1.5 pb-2 sm:pb-2.5">
          <div className="flex flex-row items-center justify-between gap-1.5 sm:gap-4">
            
            {/* LEFT: Government Logo & Title (Adjusted for mobile to push logo left and scale gracefully) */}
            <div className="flex items-center gap-1 min-[360px]:gap-1.5 sm:gap-3.5 min-w-0 flex-1">
              <img
                src="/emblem_of_nepal.png"
                alt="Emblem of Nepal"
                onClick={() => setActivePortal(isAuthenticated ? 'ADMIN' : 'PUBLIC')}
                className="w-5.5 h-5.5 min-[340px]:w-6 min-[340px]:h-6 min-[380px]:w-7 min-[380px]:h-7 sm:w-12 sm:h-12 object-contain shrink-0 cursor-pointer hover:scale-105 transition-transform drop-shadow-sm -ml-1 sm:ml-0"
                title="Transport Management Office, Driving License - Itahari, Sunsari"
              />
              <div 
                onClick={() => setActivePortal(isAuthenticated ? 'ADMIN' : 'PUBLIC')}
                className="flex flex-col cursor-pointer group min-w-0 flex-1"
              >
                <div className="flex items-center justify-between gap-1 min-[360px]:gap-1.5 min-w-0">
                  <span className="text-[clamp(10.5px,3vw,14.5px)] sm:text-[23px] font-extrabold text-[#0f294a] dark:text-white tracking-tight leading-tight group-hover:text-blue-700 dark:group-hover:text-cyan-200 transition-colors whitespace-nowrap">
                    Transport Management Office, Driving License
                  </span>
                  
                  {/* QR Code Button matching Picture 2 at right side of the same line (mobile) */}
                  <button
                    type="button"
                    id="header-mobile-qr-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setQrModalOpen(true);
                    }}
                    title="Open Portal QR Code"
                    aria-label="Open Portal QR Code"
                    className="sm:hidden px-1 min-[340px]:px-1.5 min-[370px]:px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700/90 bg-slate-50 dark:bg-[#0c1527] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-white transition-all shadow-xs animate-silent-qr hover:scale-105 active:scale-95 shrink-0 flex items-center gap-0.5 min-[370px]:gap-1 cursor-pointer"
                  >
                    <QrCode className="w-2.5 h-2.5 min-[370px]:w-3 min-[370px]:h-3 text-slate-700 dark:text-white shrink-0" />
                    <span className="text-[6.5px] min-[340px]:text-[7px] min-[370px]:text-[8px] font-black uppercase tracking-wider text-slate-800 dark:text-white whitespace-nowrap">
                      QR CODE
                    </span>
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5 sm:mt-1 min-w-0">
                  <span className="text-[8px] min-[340px]:text-[9px] min-[380px]:text-[10.5px] sm:text-[17.5px] font-semibold text-[#1e3a8a]/80 dark:text-slate-300 leading-tight shrink-0">
                    Itahari, Sunsari
                  </span>
                  {/* Nepali Date on mobile: placed at right alignment of Office address in the same line */}
                  <span className="sm:hidden text-[7.5px] min-[340px]:text-[8.5px] min-[380px]:text-[10px] font-bold text-[#0f294a] dark:text-slate-200 tracking-tight leading-tight select-none whitespace-nowrap text-right">
                    {nepDateInfo.fullDateString}
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT: Buttons, Nepali Calendar BS Date & User Status Badge */}
            <div className={`${isAuthenticated ? 'flex' : 'hidden sm:flex'} flex-col items-end gap-0.5 sm:gap-1 shrink-0`}>
              {/* Row 1: Action Controls (QR Code + Silent Theme Changer + Single Login/Logout) */}
              <div className="flex items-center gap-1 sm:gap-2.5">
                {/* 1. QR Code Button with Silent Blinking */}
                <button
                  id="header-qr-code-button"
                  onClick={() => setQrModalOpen(true)}
                  title="Open Portal QR Code"
                  className="px-1.5 sm:px-3 py-0.5 sm:py-1.5 rounded-full border border-slate-200 dark:border-slate-700/90 bg-slate-50 dark:bg-[#0c1527] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-white text-[9px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1 sm:gap-1.5 transition-all shadow-xs animate-silent-qr hover:scale-105"
                >
                  <QrCode className="w-3 h-3 sm:w-4 sm:h-4 text-slate-700 dark:text-white shrink-0" />
                  <span>QR CODE</span>
                </button>

                {/* 2. Theme Changer Icon Button with Silent Blinking (Desktop only: hidden on mobile) */}
                <button
                  id="theme-changer-icon-button"
                  onClick={toggleTheme}
                  title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
                  aria-label="Toggle Theme"
                  className="hidden sm:flex p-1 sm:p-2 rounded-full border border-slate-200 dark:border-slate-700/90 bg-slate-50 dark:bg-[#0c1527] hover:bg-slate-100 dark:hover:bg-slate-800 text-amber-500 dark:text-amber-400 items-center justify-center transition-all shadow-xs animate-silent-sun hover:scale-110"
                >
                  {isDark ? (
                    <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
                  ) : (
                    <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" />
                  )}
                </button>

                {/* 3. Single Login Button (Desktop only: hidden on mobile) / Red LOG OUT button (when logged in) */}
                {isAuthenticated ? (
                  <button
                    id="header-logout-button"
                    onClick={logout}
                    title="Logout from System"
                    className="px-2 sm:px-4 py-0.5 sm:py-1.5 rounded-md bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[9.5px] sm:text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-red-500/20 dark:shadow-red-950/40 flex items-center gap-1 sm:gap-1.5 active:scale-95"
                  >
                    <LogOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span>LOG OUT</span>
                  </button>
                ) : (
                  <button
                    id="header-single-login-button"
                    onClick={onOpenLogin}
                    title="Single Login for All Users"
                    className="hidden sm:flex px-2 sm:px-4 py-0.5 sm:py-1.5 rounded-md bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[9.5px] sm:text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-red-500/20 dark:shadow-red-950/40 items-center gap-1 sm:gap-1.5 active:scale-95"
                  >
                    <LogIn className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span>LOG IN</span>
                  </button>
                )}
              </div>

              {/* Row 2: Nepali Calendar (BS) Date Only (Desktop only) */}
              <div className="hidden sm:flex flex-col items-end text-right leading-tight pr-0.5">
                <div className="text-[13px] font-bold text-[#0f294a] dark:text-slate-200 tracking-wide font-sans select-none whitespace-nowrap">
                  {nepDateInfo.fullDateString}
                </div>
              </div>

              {/* Row 3: Logged-in User Identity Pill (Displays User's Name) */}
              {isAuthenticated && (
                <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-100/90 dark:bg-[#081121] shadow-xs text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 shadow-sm shadow-emerald-500/50 animate-pulse" />
                  <span className="text-slate-800 dark:text-slate-200 font-bold uppercase tracking-wider truncate max-w-[150px] sm:max-w-[240px] font-mono text-[11px]">
                    {displayUserName}
                  </span>
                  {getRoleBadge() === 'SU' ? (
                    <span className="bg-amber-100 dark:bg-amber-950/90 text-amber-900 dark:text-amber-300 border-[1.5px] border-amber-500 text-[9.5px] font-black px-1.5 py-0.5 rounded-tl-[6px] rounded-br-[6px] uppercase font-mono shadow-xs">
                      SU
                    </span>
                  ) : (
                    <span className="bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/80 dark:text-amber-400 dark:border-amber-500/60 text-[10px] font-black px-1.5 py-0.2 rounded uppercase">
                      {getRoleBadge()}
                    </span>
                  )}
                  {user?.mustChangePassword && (
                    <button
                      onClick={() => setShowFirstLoginPasswordModal(true)}
                      title="Click to set your personal password"
                      className="ml-1 px-2 py-0.5 rounded-md bg-amber-500 hover:bg-amber-600 active:scale-95 text-white text-[10px] font-bold font-mono uppercase tracking-tight flex items-center gap-1 shadow-xs transition-all animate-pulse"
                    >
                      <KeyRound className="w-3 h-3" />
                      <span className="hidden sm:inline">SET PASSWORD</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Interactive System QR Code Modal */}
      <QRCodeModal isOpen={qrModalOpen} onClose={() => setQrModalOpen(false)} />
    </>
  );
};
