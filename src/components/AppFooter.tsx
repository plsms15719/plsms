import React, { useEffect, useState } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import { api } from '../services/api';
import { safeStorage } from '../utils/storage';

export const AppFooter: React.FC = () => {
  const [visitorCount, setVisitorCount] = useState<number>(() => {
    try {
      const stored = safeStorage.getItem('plsms_permanent_visitor_counter');
      if (stored) {
        const val = parseInt(stored, 10);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch (_) {}
    return 1;
  });

  const fetchCounter = async () => {
    try {
      let localCount = 0;
      try {
        const stored = safeStorage.getItem('plsms_permanent_visitor_counter');
        if (stored) {
          const val = parseInt(stored, 10);
          if (!isNaN(val) && val > 0) localCount = val;
        }
      } catch (_) {}

      const res = await api.getVisitorCounter(localCount > 0 ? localCount : undefined);
      if (res && typeof res.count === 'number') {
        const finalCount = Math.max(res.count, localCount, 1);
        setVisitorCount(finalCount);
        try {
          safeStorage.setItem('plsms_permanent_visitor_counter', String(finalCount));
        } catch (_) {}
      } else if (localCount > 0) {
        setVisitorCount(localCount);
      }
    } catch (err) {
      console.warn('Could not fetch visitor counter:', err);
    }
  };

  useEffect(() => {
    // Initial fetch on mount for all pages (Public and Admin)
    fetchCounter();

    // Listen to real-time search events dispatched upon successful public search button click
    const handleCounterUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<number>;
      if (typeof customEvent.detail === 'number' && customEvent.detail > 0) {
        setVisitorCount(prev => {
          const higher = Math.max(prev, customEvent.detail);
          try {
            safeStorage.setItem('plsms_permanent_visitor_counter', String(higher));
          } catch (_) {}
          return higher;
        });
      } else {
        fetchCounter();
      }
    };

    window.addEventListener('plsms_visitor_counter_updated', handleCounterUpdate);
    window.addEventListener('focus', fetchCounter);

    // Refresh every 30 seconds to keep tabs synchronized across devices
    const interval = setInterval(fetchCounter, 30000);

    return () => {
      window.removeEventListener('plsms_visitor_counter_updated', handleCounterUpdate);
      window.removeEventListener('focus', fetchCounter);
      clearInterval(interval);
    };
  }, []);

  return (
    <footer
      id="app-global-footer"
      className="w-full bg-slate-50 dark:bg-[#071122] border-t border-slate-200 dark:border-[#162a4a] text-slate-700 dark:text-slate-300 py-3 sm:py-3.5 px-3 sm:px-6 transition-colors duration-200 mt-auto shadow-[0_-1px_3px_rgba(0,0,0,0.03)] dark:shadow-none"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-6">
        {/* Left Side: Compliance & Authority Notice with Icon & Border */}
        <div className="flex items-center gap-2.5 sm:gap-3 text-center sm:text-left min-w-0">
          <div 
            id="footer-security-icon-badge"
            className="hidden sm:flex p-2 rounded-xl border border-emerald-200 dark:border-[#162a4a] bg-emerald-50/80 dark:bg-[#0a1830] text-emerald-700 dark:text-emerald-400 shrink-0 shadow-xs"
            title="Official PLSMS Security & Regulatory Compliance"
          >
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="space-y-0.5 min-w-0">
            <p className="text-[11px] min-[360px]:text-[12px] sm:text-[13px] text-slate-900 dark:text-slate-200 font-bold leading-snug">
              © 2026 Transport Management Office, Driving License, Itahari, Sunsari. Authorized Use Only.
            </p>
            <p className="text-[10px] min-[360px]:text-[11px] sm:text-[12px] text-slate-600 dark:text-slate-400 font-medium leading-snug flex items-center justify-center sm:justify-start gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              All operations are logged and monitored for security compliance.
            </p>
          </div>
        </div>

        {/* Right Side: Visitor Search Counter Box with Icon & Border */}
        <div className="shrink-0 flex items-center justify-center">
          <div 
            id="footer-visitor-counter-card"
            className="border border-slate-200 dark:border-[#1d3d6e] bg-white dark:bg-[#071426] rounded-xl px-4 py-2 sm:px-5 sm:py-2.5 shadow-sm dark:shadow-inner flex items-center justify-center gap-3 min-w-[175px] sm:min-w-[200px] transition-colors"
          >
            <div 
              id="footer-visitor-icon-box"
              className="p-1.5 rounded-lg border border-cyan-200 dark:border-[#1d3d6e] bg-cyan-50 dark:bg-[#0b1d36] text-[#0088cc] dark:text-[#00c0f0] flex items-center justify-center shrink-0 shadow-xs"
            >
              <Users className="w-4 h-4" />
            </div>
            <div className="flex-1 flex flex-col items-center justify-center text-center min-w-0">
              <span className="text-base sm:text-lg font-black text-[#0088cc] dark:text-[#00c0f0] font-mono leading-none tracking-tight text-center block w-full">
                {visitorCount}
              </span>
              <span className="text-[9px] min-[380px]:text-[9.5px] sm:text-[10px] font-black text-[#0f294a] dark:text-white uppercase tracking-wider leading-none mt-1 whitespace-nowrap text-center block w-full">
                VISITOR COUNTER
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
