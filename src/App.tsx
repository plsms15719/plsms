import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { HeaderNav } from './components/HeaderNav';
import { PublicPortal } from './components/PublicPortal';
import { AdminPortal } from './components/admin/AdminPortal';
import { AppFooter } from './components/AppFooter';
import { FirstRunSetupModal } from './components/FirstRunSetupModal';
import { LoginModal } from './components/LoginModal';
import { FirstLoginPasswordModal } from './components/modals/FirstLoginPasswordModal';
import { RefreshCw } from 'lucide-react';

const AppContent: React.FC = () => {
  const {
    isAuthenticated,
    setupCompleted,
    loading,
    showFirstLoginPasswordModal,
    setShowFirstLoginPasswordModal,
    tempSessionPassword,
  } = useAuth();
  const [activePortal, setActivePortal] = useState<'PUBLIC' | 'ADMIN'>('PUBLIC');
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  // Automatically switch to Admin Portal once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      setActivePortal('ADMIN');
    }
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Initializing PLSMS Core System...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0F19] flex flex-col font-sans text-slate-900 dark:text-slate-100 selection:bg-blue-500/20 selection:text-blue-900 dark:selection:bg-blue-500/30 dark:selection:text-blue-100 transition-colors duration-200">
      {/* Top Header Navigation */}
      <HeaderNav
        activePortal={activePortal}
        setActivePortal={(portal) => {
          if (portal === 'ADMIN' && !isAuthenticated) {
            setLoginModalOpen(true);
          } else {
            setActivePortal(portal);
          }
        }}
        onOpenLogin={() => setLoginModalOpen(true)}
      />

      {/* Main View Portals */}
      <div className="flex-1">
        {activePortal === 'PUBLIC' || !isAuthenticated ? (
          <PublicPortal />
        ) : (
          <AdminPortal />
        )}
      </div>

      {/* Global Application Footer (Always rendered on every page of Public and Admin Portal) */}
      <AppFooter />

      {/* First-Run Super Admin Setup Modal (Locks permanently after USERS = 1) */}
      <FirstRunSetupModal isOpen={!setupCompleted} />

      {/* Super Admin Login Modal */}
      <LoginModal
        isOpen={loginModalOpen && setupCompleted && !isAuthenticated}
        onClose={() => setLoginModalOpen(false)}
      />

      {/* Immediate First-Login Password Change Modal */}
      {isAuthenticated && (
        <FirstLoginPasswordModal
          isOpen={showFirstLoginPasswordModal}
          onClose={() => setShowFirstLoginPasswordModal(false)}
          defaultCurrentPassword={tempSessionPassword}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

