import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Search,
  UploadCloud,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  History,
  ShieldAlert,
  Settings,
  Shield,
  Menu,
  X,
  Megaphone,
  Handshake,
} from 'lucide-react';
import { AdminActiveView, LicenseRecord, DistributionRecord } from '../../types';
import { DashboardView } from './DashboardView';
import { LicenseSearchView } from './LicenseSearchView';
import { DistributionView } from './DistributionView';
import { MissingRecordsView } from './MissingRecordsView';
import { FoundSmartCardsView } from './FoundSmartCardsView';
import { HandedOverSmartCardsView } from './HandedOverSmartCardsView';
import { ReportsView } from './ReportsView';
import { AuditLogsView } from './AuditLogsView';
import { SettingsView, ConsoleTab } from './SettingsView';
import { NoticesView } from './NoticesView';

import { LicenseDetailModal } from '../modals/LicenseDetailModal';
import { HandoverModal } from '../modals/HandoverModal';
import { FlagMissingModal } from '../modals/FlagMissingModal';
import { PrintSlipModal } from '../modals/PrintSlipModal';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, hasAnyPermission } from '../../utils/permissions';

interface NavItemDef {
  id: AdminActiveView;
  label: string;
  icon: React.FC<{ className?: string }>;
  iconColor: string;
  activeIconColor: string;
  requiredPermissions: string[];
  textClass?: string;
}

const ALL_NAV_ITEMS: NavItemDef[] = [
  {
    id: 'DASHBOARD',
    label: 'SMART CARD DASHBOARD',
    icon: LayoutDashboard,
    iconColor: 'text-blue-500 dark:text-blue-400',
    activeIconColor: 'text-sky-200',
    requiredPermissions: ['dashboard.view'],
  },
  {
    id: 'SEARCH_RECORDS',
    label: 'SEARCH SMART CARD',
    icon: Search,
    iconColor: 'text-cyan-500 dark:text-cyan-400',
    activeIconColor: 'text-cyan-200',
    requiredPermissions: ['records.search', 'records.view', 'records.search_mark_missing'],
  },
  {
    id: 'DISTRIBUTION',
    label: 'DISTRIBUTED SMART CARDS',
    icon: FileCheck2,
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    activeIconColor: 'text-emerald-200',
    requiredPermissions: ['records.distribute', 'records.view', 'records.export_pdf', 'records.export_excel'],
  },
  {
    id: 'MISSING_RECORDS',
    label: 'MISSING SMART CARDS',
    icon: AlertTriangle,
    iconColor: 'text-amber-500 dark:text-amber-400',
    activeIconColor: 'text-amber-200',
    requiredPermissions: ['records.mark_missing', 'records.export_missing', 'records.search_mark_missing'],
  },
  {
    id: 'FOUND_RECORDS',
    label: 'FOUND SMART CARDS',
    icon: CheckCircle2,
    iconColor: 'text-teal-500 dark:text-teal-400',
    activeIconColor: 'text-teal-200',
    requiredPermissions: ['found.view', 'records.unmark_missing', 'found.verify'],
  },
  {
    id: 'HANDED_OVER_RECORDS',
    label: 'HANDED OVER SMART CARDS',
    icon: Handshake,
    iconColor: 'text-purple-500 dark:text-purple-400',
    activeIconColor: 'text-purple-200',
    requiredPermissions: ['found.view', 'records.distribute', 'records.view'],
  },
  {
    id: 'NOTICES',
    label: 'NOTICES',
    icon: Megaphone,
    iconColor: 'text-rose-500 dark:text-rose-400',
    activeIconColor: 'text-rose-200',
    requiredPermissions: ['notices.view', 'notices.manage'],
  },
  {
    id: 'REPORTS',
    label: 'REPORT GENERATOR',
    icon: FileSpreadsheet,
    iconColor: 'text-green-600 dark:text-green-400',
    activeIconColor: 'text-green-200',
    requiredPermissions: [
      'reports.generate_ledger',
      'reports.view_analytics',
      'reports.export_csv',
      'reports.audit_summary',
      'records.export_excel',
      'records.export_pdf',
    ],
  },
  {
    id: 'AUDIT_LOGS',
    label: 'AUDIT LOGS',
    icon: ShieldAlert,
    iconColor: 'text-red-500 dark:text-red-400',
    activeIconColor: 'text-red-200',
    requiredPermissions: ['security.view_audit_logs', 'audit.view', 'security.export_audit_logs'],
  },
  {
    id: 'SETTINGS',
    label: 'SYSTEM SETTINGS',
    icon: Settings,
    iconColor: 'text-sky-500 dark:text-sky-400',
    activeIconColor: 'text-sky-200',
    requiredPermissions: [
      'settings.view',
      'settings.general',
      'settings.mpin_manage',
      'settings.security_timeout',
      'settings.print_layout',
      'settings.sync_interval',
      'settings.backup_manage',
      'settings.maintenance',
      'records.excel_upload',
      'records.manual_entry',
      'records.bulk_status_update',
      'uploads.sync_interval',
      'user.create',
      'user.edit',
      'user.permissions',
      'user.delete',
      'user.suspend',
      'cloud.sheets_sync',
      'cloud.sheets_config',
      'cloud.backup_create',
      'cloud.backup_download',
      'cloud.backup_restore',
      'cloud.database_purge',
      'database.backup',
      'database.reset',
    ],
  },
];

export const AdminPortal: React.FC = () => {
  const { user, refreshSystemStatus } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Filter navigation items: SYSTEM SETTINGS is always displayed for all users created inside the app, other items strictly require permissions
  const permittedNavItems = useMemo(() => {
    return ALL_NAV_ITEMS.filter(
      (item) => item.id === 'SETTINGS' || hasAnyPermission(user, item.requiredPermissions)
    );
  }, [user]);

  const [activeView, setActiveView] = useState<AdminActiveView>(() => {
    if (permittedNavItems.length > 0) {
      return permittedNavItems[0].id;
    }
    return 'DASHBOARD';
  });

  // Automatically keep activeView on a permitted tab if permissions change or initially loaded
  useEffect(() => {
    if (permittedNavItems.length > 0) {
      const isAllowed = permittedNavItems.some((item) => item.id === activeView);
      if (!isAllowed) {
        setActiveView(permittedNavItems[0].id);
      }
    }
  }, [permittedNavItems, activeView]);

  // Modals state
  const [selectedRecord, setSelectedRecord] = useState<LicenseRecord | null>(null);
  const [distributeRecord, setDistributeRecord] = useState<LicenseRecord | null>(null);
  const [missingRecord, setMissingRecord] = useState<LicenseRecord | null>(null);
  const [slipDistribution, setSlipDistribution] = useState<DistributionRecord | null>(null);
  const [settingsTab, setSettingsTab] = useState<ConsoleTab>('USERS_ROLES');

  const handleNavigate = (view: AdminActiveView) => {
    if (view === 'UPLOAD_CENTER') {
      const lastActive = sessionStorage.getItem('plsms_upload_center_last_active');
      if (
        sessionStorage.getItem('plsms_upload_center_authorized') === 'true' &&
        lastActive &&
        Date.now() - Number(lastActive) >= 2 * 60 * 1000
      ) {
        sessionStorage.removeItem('plsms_upload_center_authorized');
        sessionStorage.removeItem('plsms_upload_center_token');
        sessionStorage.removeItem('plsms_upload_center_clearance');
        sessionStorage.removeItem('plsms_upload_center_last_active');
        sessionStorage.setItem('plsms_upload_center_timed_out', 'true');
      } else {
        // Initialize timer timestamp on clicking Upload Center
        sessionStorage.setItem('plsms_upload_center_last_active', Date.now().toString());
      }
      setSettingsTab('UPLOAD_CENTER');
      setActiveView('SETTINGS');
    } else if (view === 'SETTINGS') {
      setSettingsTab('USERS_ROLES');
      setActiveView('SETTINGS');
    } else {
      setActiveView(view);
    }
  };

  const isCurrentViewPermitted = permittedNavItems.some((item) => item.id === activeView);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-[#0B0F19] flex flex-col md:flex-row transition-colors duration-200">
      {/* Mobile Nav Toggle */}
      <div className="md:hidden bg-white dark:bg-[#111827] p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between transition-colors duration-200">
        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
          Management Console
        </span>
        <button
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Sidebar Navigation */}
      <aside
        className={`w-full md:w-72 bg-white dark:bg-[#111827] border-r border-slate-200 dark:border-slate-800 p-4 space-y-2 shrink-0 transition-colors duration-200 ${
          mobileNavOpen ? 'block' : 'hidden md:block'
        }`}
      >
        <div className="px-3 py-2 text-[14.5px] font-black uppercase tracking-wider text-slate-900 dark:text-slate-200">
          Management Console
        </div>

        <nav className="space-y-1">
          {permittedNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'SETTINGS') {
                    setSettingsTab('USERS_ROLES');
                  }
                  setActiveView(item.id);
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl ${
                  item.textClass || 'text-xs'
                } font-bold transition-all whitespace-nowrap group ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-black'
                    : 'text-slate-800 dark:text-slate-300 hover:text-black dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 font-extrabold'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                    isActive ? item.activeIconColor : item.iconColor
                  }`}
                />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 w-full overflow-y-auto">
        {!isCurrentViewPermitted ? (
          <div className="bg-white dark:bg-[#070F1E] border border-red-300 dark:border-red-900/60 rounded-2xl p-8 text-center max-w-lg mx-auto my-12 space-y-4 shadow-xl">
            <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto border border-red-300 dark:border-red-800">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                Access Denied (पहुँच अस्वीकृत)
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                तपाईंको प्रयोगकर्ता खातामा यो मोड्युल हेर्ने वा सञ्चालन गर्ने अनुमति (Permission) प्रदान गरिएको छैन ।
                (You do not have access permission for this module. Unticked items are strictly hidden.)
              </p>
            </div>
            {permittedNavItems.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveView(permittedNavItems[0].id)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
              >
                अनुमति भएको मुख्य पृष्ठमा जानुहोस् (Go to {permittedNavItems[0].label})
              </button>
            )}
          </div>
        ) : (
          <>
            {activeView === 'DASHBOARD' && (
              <DashboardView
                onNavigate={handleNavigate}
                onOpenUpload={() => {
                  setSettingsTab('UPLOAD_CENTER');
                  setActiveView('SETTINGS');
                }}
              />
            )}

            {activeView === 'SEARCH_RECORDS' && (
              <LicenseSearchView
                onSelectRecord={(r) => setSelectedRecord(r)}
                onDistribute={(r) => setDistributeRecord(r)}
                onMarkMissing={(r) => setMissingRecord(r)}
                onNavigate={handleNavigate}
              />
            )}

            {activeView === 'UPLOAD_CENTER' && (
              <SettingsView
                initialTab="UPLOAD_CENTER"
                onTabChange={(tab) => setSettingsTab(tab)}
                onImportComplete={() => {
                  refreshSystemStatus();
                }}
              />
            )}

            {activeView === 'DISTRIBUTION' && (
              <DistributionView onPrintSlip={(dist) => setSlipDistribution(dist)} />
            )}

            {activeView === 'MISSING_RECORDS' && (
              <MissingRecordsView
                onSelectRecord={(r) => setSelectedRecord(r)}
                onRefreshStats={() => refreshSystemStatus()}
              />
            )}

            {activeView === 'FOUND_RECORDS' && (
              <FoundSmartCardsView
                onSelectRecord={(r) => setSelectedRecord(r)}
                onRefreshStats={() => refreshSystemStatus()}
              />
            )}

            {activeView === 'HANDED_OVER_RECORDS' && (
              <HandedOverSmartCardsView
                onSelectRecord={(r) => setSelectedRecord(r)}
                onRefreshStats={() => refreshSystemStatus()}
              />
            )}

            {activeView === 'NOTICES' && <NoticesView />}

            {activeView === 'REPORTS' && <ReportsView />}

            {activeView === 'AUDIT_LOGS' && <AuditLogsView />}

            {activeView === 'SETTINGS' && (
              <SettingsView
                initialTab={settingsTab}
                onTabChange={(tab) => setSettingsTab(tab)}
                onImportComplete={() => {
                  refreshSystemStatus();
                }}
              />
            )}
          </>
        )}
      </main>

      {/* Global Modals */}
      <LicenseDetailModal
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
        onDistribute={(r) => {
          setSelectedRecord(null);
          setDistributeRecord(r);
        }}
        onMarkMissing={(r) => {
          setSelectedRecord(null);
          setMissingRecord(r);
        }}
      />

      <HandoverModal
        record={distributeRecord}
        onClose={() => setDistributeRecord(null)}
        onSuccess={(updatedRecord) => {
          refreshSystemStatus();
        }}
      />

      <FlagMissingModal
        record={missingRecord}
        onClose={() => setMissingRecord(null)}
        onSuccess={(updatedRecord) => {
          refreshSystemStatus();
        }}
      />

      <PrintSlipModal
        distribution={slipDistribution}
        onClose={() => setSlipDistribution(null)}
      />
    </div>
  );
};
