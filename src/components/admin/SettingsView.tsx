import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Flame,
  ShieldAlert,
  Database,
  Users,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  Search,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Shield,
  FileSpreadsheet,
  Layers,
  UserPlus,
  Trash2,
  Key,
  PauseCircle,
  PlayCircle,
  Sliders,
  ExternalLink,
  Info,
  RotateCcw,
  UploadCloud,
  Lock,
  Unlock,
  Timer,
  Building2,
  MapPin,
  HardDriveDownload,
  FileCheck,
  Save,
  X,
  Maximize2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { User, PermissionGroup, PermissionItem } from '../../types';
import { validatePasswordStrength, generateStrongPassword, PasswordValidationResult } from '../../utils/passwordUtils';
import { UserCreatedSuccessModal, CreatedUserInfo } from '../modals/UserCreatedSuccessModal';
import { UploadCenterView } from './UploadCenterView';
import { UploadCenterVerificationCard } from './UploadCenterVerificationCard';
import { UploadCenterAccessDeniedModal } from './UploadCenterAccessDeniedModal';
import { ActionNotificationModal, ActionNotificationData } from './ActionNotificationModal';
import { hasPermission, isSuperAdminUser, canAccessUploadCenter } from '../../utils/permissions';

// Password Strength Meter Component
const PasswordStrengthMeter: React.FC<{ validation: PasswordValidationResult; password?: string }> = ({
  validation,
  password,
}) => {
  if (!password) return null;
  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="text-slate-500 dark:text-slate-400">Security Strength:</span>
        <span
          className={`font-bold ${
            validation.score === 3
              ? 'text-emerald-600 dark:text-emerald-400'
              : validation.score === 2
              ? 'text-sky-600 dark:text-sky-400'
              : validation.score === 1
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {validation.score === 3
            ? '✓ STRONG SECURE'
            : validation.score === 2
            ? '✓ GOOD (MIXED)'
            : validation.score === 1
            ? '⚠ WEAK (MIX LETTERS & NUMBERS/SYMBOLS)'
            : '✗ TOO SHORT (< 6 CHARS)'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${
            validation.score >= 1
              ? validation.score === 1
                ? 'bg-amber-500'
                : 'bg-emerald-500'
              : 'bg-rose-500'
          }`}
        />
        <div
          className={`h-full transition-all ${
            validation.score >= 2 ? 'bg-emerald-500' : 'bg-transparent'
          }`}
        />
        <div
          className={`h-full transition-all ${
            validation.score >= 3 ? 'bg-emerald-600' : 'bg-transparent'
          }`}
        />
      </div>
      <div className="grid grid-cols-2 gap-1 text-[10px] font-mono pt-0.5">
        <div
          className={`flex items-center gap-1 ${
            validation.checks.minLength
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-400'
          }`}
        >
          <span>{validation.checks.minLength ? '✓' : '○'}</span>
          <span>At least 6 chars</span>
        </div>
        <div
          className={`flex items-center gap-1 ${
            validation.checks.isMixed
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-400'
          }`}
        >
          <span>{validation.checks.isMixed ? '✓' : '○'}</span>
          <span>Mixed letters & numbers/symbols</span>
        </div>
      </div>
    </div>
  );
};

// Comprehensive Menu-Based Granular Permissions Catalog
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'menu_dashboard',
    badgeCode: '1',
    title: '1. SMART CARD DASHBOARD (कन्सोल ड्यासबोर्ड)',
    permissions: [
      { id: 'dashboard.view', name: 'View Smart Card Dashboard', category: 'SMART CARD DASHBOARD', description: 'Access dashboard overview, KPIs, metrics, and distribution charts' },
      { id: 'dashboard.export_summary', name: 'Export Dashboard Summary & Stats', category: 'SMART CARD DASHBOARD', description: 'Export visual statistics and inventory summaries' },
      { id: 'dashboard.alphabetical', name: 'View Alphabetical Dashboard', category: 'SMART CARD DASHBOARD', description: 'Access alphabetical aggregate distribution reports, A to Z analytics, and letter statistics' },
      { id: 'dashboard.tables', name: 'View All tables', category: 'SMART CARD DASHBOARD', description: 'View and browse underlying records tables, search queries, filters, and paginated lists' },
    ],
  },
  {
    key: 'menu_search',
    badgeCode: '2',
    title: '2. SEARCH SMART CARD (कार्ड खोज तथा विवरण)',
    permissions: [
      { id: 'records.search', name: 'Global Sub-Millisecond Search', category: 'SEARCH SMART CARD', description: 'Query records by license, application number, citizenship, or applicant name' },
      { id: 'records.view', name: 'View Smart Card Records', category: 'SEARCH SMART CARD', description: 'Browse, inspect, and open applicant modal details' },
      { id: 'records.view_unfiltered_raw', name: 'Access Raw Unmasked Fields', category: 'SEARCH SMART CARD', description: 'View unmasked NID, passport, and system internal identifiers' },
      { id: 'records.edit', name: 'Edit Card & Applicant Data', category: 'SEARCH SMART CARD', description: 'Modify applicant name, phone, categories, old/new codes, and office' },
      { id: 'records.delete', name: 'Delete License Records', category: 'SEARCH SMART CARD', description: 'Permanently remove individual license records from database' },
      { id: 'records.search_mark_missing', name: 'Save the Searched Record and mark Missing', category: 'SEARCH SMART CARD', description: 'Save the searched smart card record and report it as missing / lost' },
      { id: 'records.unmark_missing', name: 'Verify & Restore Missing Records (Mark Found)', category: 'SEARCH SMART CARD', description: 'Recover and clear missing status upon finding and verify card' },
    ],
  },
  {
    key: 'menu_upload',
    badgeCode: '3',
    title: '3. UPLOAD CENTER (एक्सेल लट तथा ब्याच अपलोड)',
    permissions: [
      { id: 'uploads.operational_console', name: 'Operational Console in UPLOAD CENTER', category: 'UPLOAD CENTER', description: 'Permission to access Upload Center operational console and use upload & sync engines' },
      { id: 'records.excel_upload', name: 'Upload Excel Lots & Batches', category: 'UPLOAD CENTER', description: 'Import monthly .xlsx/.xls master files into central database' },
      { id: 'records.manual_entry', name: 'Manual Record Creation', category: 'UPLOAD CENTER', description: 'Manually insert new smart card records directly without file upload' },
      { id: 'records.bulk_status_update', name: 'Bulk Status Batch Modification', category: 'UPLOAD CENTER', description: 'Batch update multiple record statuses at once' },
      { id: 'uploads.sync_interval', name: 'Configure 24/7 Background Daemon Interval', category: 'UPLOAD CENTER', description: 'Set background Google Sheets poll frequencies and auto-sync intervals' },
    ],
  },
  {
    key: 'menu_distribution',
    badgeCode: '4',
    title: '4. DISTRIBUTED SMART CARDS (कार्ड वितरण तथा रसिद)',
    permissions: [
      { id: 'records.distribute', name: 'Execute Card Distribution', category: 'DISTRIBUTED SMART CARDS', description: 'Handover smart cards to applicant or authorized receiver & log details' },
      { id: 'records.undo_distribution', name: 'Revert Distribution Status', category: 'DISTRIBUTED SMART CARDS', description: 'Rollback handed-over cards to available status (permitted on same day)' },
      { id: 'records.export_pdf', name: 'Print Distribution Slip & Handover Ledger PDF', category: 'DISTRIBUTED SMART CARDS', description: 'Print official distribution certificates, slips, and receipts' },
      { id: 'records.export_excel', name: 'Export Master Distribution Spreadsheets', category: 'DISTRIBUTED SMART CARDS', description: 'Generate filtered Excel exports of distributed inventory' },
    ],
  },
  {
    key: 'menu_missing',
    badgeCode: '5',
    title: '5. MISSING SMART CARDS (हराएका / फेला नपरेका कार्ड)',
    permissions: [
      { id: 'records.mark_missing', name: 'Mark Cards as Missing / Lost', category: 'MISSING SMART CARDS', description: 'Flag misplaced smart cards with investigation notes and date' },
      { id: 'records.export_missing', name: 'Export Missing Inventory Ledger', category: 'MISSING SMART CARDS', description: 'Download complete report of all flagged missing cards' },
    ],
  },
  {
    key: 'menu_found',
    badgeCode: '6',
    title: '6. FOUND SMART CARDS (फेला परेका स्मार्ट कार्डहरू)',
    permissions: [
      { id: 'found.view', name: 'View Found Smart Cards Archive', category: 'FOUND SMART CARDS', description: 'Access found smart cards archive, browse recovered cards registry, and search history' },
      { id: 'found.verify', name: 'Verify & Mark Found (Clear Missing Status)', category: 'FOUND SMART CARDS', description: 'Confirm found cards with submitted document proof, receiver details, and restore records' },
      { id: 'found.details', name: 'View Found Card Details & Documents', category: 'FOUND SMART CARDS', description: 'Inspect applicant modal, submitted document type, receiving officer, and remarks' },
      { id: 'found.export', name: 'Export Found Records Ledger', category: 'FOUND SMART CARDS', description: 'Export recovered and verified smart cards dataset to Excel and official spreadsheets' },
    ],
  },
  {
    key: 'menu_notices',
    badgeCode: '7',
    title: '7. NOTICES (सूचना तथा सन्देश प्रसारण)',
    permissions: [
      { id: 'notices.view', name: 'View Official Notices', category: 'NOTICES', description: 'View administrative announcements and departmental notices' },
      { id: 'notices.manage', name: 'Create & Publish Notices', category: 'NOTICES', description: 'Compose, publish, and update official public and office notices' },
      { id: 'notices.delete', name: 'Delete & Archive Notices', category: 'NOTICES', description: 'Remove or archive outdated notices from portal' },
    ],
  },
  {
    key: 'menu_reports',
    badgeCode: '8',
    title: '8. REPORT GENERATOR (प्रतिवेदन तथा लेजर)',
    permissions: [
      { id: 'reports.generate_ledger', name: 'Daily Dispatch Register Ledger', category: 'REPORT GENERATOR', description: 'Generate formatted daily register and distribution ledger reports' },
      { id: 'reports.view_analytics', name: 'Visual Analytics & Charts', category: 'REPORT GENERATOR', description: 'Inspect category, lot, and handover distribution trend graphs' },
      { id: 'reports.export_csv', name: 'Export Statistical Datasets & CSVs', category: 'REPORT GENERATOR', description: 'Download analytical CSV datasets for official review' },
      { id: 'reports.audit_summary', name: 'Operator Shift & Handover Summary', category: 'REPORT GENERATOR', description: 'View daily totals grouped by distributing staff officer' },
    ],
  },
  {
    key: 'menu_audit',
    badgeCode: '9',
    title: '9. AUDIT LOGS & SECURITY (अडिट लग तथा सुरक्षा)',
    permissions: [
      { id: 'security.view_audit_logs', name: 'View Cryptographic Audit Trail', category: 'AUDIT LOGS & SECURITY', description: 'Audit all distribution, search, login, and administrative activities' },
      { id: 'security.export_audit_logs', name: 'Export Tamper-Proof Audit Trail', category: 'AUDIT LOGS & SECURITY', description: 'Download complete chronological security audit log records' },
      { id: 'security.session_control', name: 'Force Terminate Active Sessions', category: 'AUDIT LOGS & SECURITY', description: 'Remotely invalidate active staff login tokens in real-time' },
      { id: 'security.ip_whitelist', name: 'IP Restriction & Rate Limit Controls', category: 'AUDIT LOGS & SECURITY', description: 'Configure authorized office network subnet ranges and firewall' },
    ],
  },
  {
    key: 'menu_users',
    badgeCode: '10',
    title: '10. USER & ACCESS MANAGEMENT (प्रयोगकर्ता तथा पहुँच नियन्त्रण)',
    permissions: [
      { id: 'user.create', name: 'Create User Accounts', category: 'USER & ACCESS MANAGEMENT', description: 'Create and provision new staff operator credentials' },
      { id: 'user.edit', name: 'Edit Users Profiles', category: 'USER & ACCESS MANAGEMENT', description: 'Modify employee name, phone, designated post, and department' },
      { id: 'user.password_reset', name: 'Reset User Password', category: 'USER & ACCESS MANAGEMENT', description: 'Trigger emergency password reset for locked operators' },
      { id: 'user.reset_own_password', name: 'Reset Own Password', category: 'USER & ACCESS MANAGEMENT', description: 'Change personal confidential password and security credentials' },
      { id: 'user.delete', name: 'Revoke / Delete User ID & Password', category: 'USER & ACCESS MANAGEMENT', description: 'Permanently remove staff access credentials and revoke login ID' },
      { id: 'user.permissions', name: 'Manage Granular Permissions', category: 'USER & ACCESS MANAGEMENT', description: 'Modify and grant fine-grained permissions to user accounts' },
      { id: 'user.suspend', name: 'Suspend / Reactivate Accounts', category: 'USER & ACCESS MANAGEMENT', description: 'Temporarily freeze staff account access or restore active state' },
    ],
  },
  {
    key: 'menu_duplicates',
    badgeCode: '11',
    title: '11. DUPLICATE MANAGEMENT (दोहोरिएका रेकर्ड व्यवस्थापन)',
    permissions: [
      { id: 'duplicates.detect', name: 'Automated Duplicate Detection', category: 'DUPLICATE MANAGEMENT', description: 'Scan database for redundant licenses & duplicate applications' },
      { id: 'duplicates.merge', name: 'Merge & Consolidate Records', category: 'DUPLICATE MANAGEMENT', description: 'Consolidate multiple records into a single verified master' },
      { id: 'duplicates.resolve', name: 'Manual Override Resolution', category: 'DUPLICATE MANAGEMENT', description: 'Approve or reject conflicting card metadata and field discrepancies' },
      { id: 'duplicates.archive', name: 'Archive Redundant Entries', category: 'DUPLICATE MANAGEMENT', description: 'Retain historical duplicates in deep cold storage' },
    ],
  },
  {
    key: 'menu_cloud',
    badgeCode: '12',
    title: '12. DATABASE & CLOUD CONTROL (गुगल सिट तथा क्लाउड नियन्त्रण)',
    permissions: [
      { id: 'cloud.sheets_sync', name: 'Google Sheets 2-Way Real-Time Live Sync', category: 'DATABASE & CLOUD CONTROL', description: 'Synchronize live records bi-directionally with Google Cloud Spreadsheets' },
      { id: 'cloud.sheets_config', name: 'Google Sheets Service & Auth Setup', category: 'DATABASE & CLOUD CONTROL', description: 'Modify spreadsheet URLs and Google Cloud API credentials' },
      { id: 'cloud.backup_create', name: 'Create Instant Database Backup Snapshot', category: 'DATABASE & CLOUD CONTROL', description: 'Trigger full atomic database backup snapshot' },
      { id: 'cloud.backup_download', name: 'Download Encrypted JSON Archive', category: 'DATABASE & CLOUD CONTROL', description: 'Download offline backup dump of all records and activity logs' },
      { id: 'cloud.backup_restore', name: 'Restore Database from JSON Archive', category: 'DATABASE & CLOUD CONTROL', description: 'Revert state from a verified timestamped backup archive' },
      { id: 'cloud.database_purge', name: 'Emergency Database Hard Reset / Purge', category: 'DATABASE & CLOUD CONTROL', description: 'Execute complete system wipe (strictly owner/super admin only)' },
    ],
  },
  {
    key: 'menu_settings',
    badgeCode: '13',
    title: '13. SYSTEM SETTINGS (प्रणाली सेटिङ तथा कन्फिगरेसन)',
    permissions: [
      { id: 'settings.view', name: 'Access System Settings Console', category: 'SYSTEM SETTINGS', description: 'Access settings panel, configuration modules, and diagnostic status' },
      { id: 'settings.general', name: 'Office Profile & General Configuration', category: 'SYSTEM SETTINGS', description: 'Configure office name, office code, counters/room numbers, and operational profile' },
      { id: 'settings.mpin_manage', name: 'Security mPIN & Authorization Keys', category: 'SYSTEM SETTINGS', description: 'Manage, update, and reset 4-digit administrative Security mPIN and clearance keys' },
      { id: 'settings.security_timeout', name: '2-Step Verification & Auto-Lock Timeout', category: 'SYSTEM SETTINGS', description: 'Configure 2-minute inactivity auto-lock and 2-step verification clearance' },
      { id: 'settings.print_layout', name: 'Print & Handover Receipt Preferences', category: 'SYSTEM SETTINGS', description: 'Configure distribution receipt templates, font sizing, and official header/footer' },
      { id: 'settings.sync_interval', name: '24/7 Background Daemon & Sync Schedule', category: 'SYSTEM SETTINGS', description: 'Set background Google Sheets poll frequencies and continuous auto-sync schedule' },
      { id: 'settings.backup_manage', name: 'System Backup Snapshots & Offline Archive', category: 'SYSTEM SETTINGS', description: 'Instant snapshot creation, offline archive downloads, and database restores' },
      { id: 'settings.maintenance', name: 'System Maintenance & Cache Optimization', category: 'SYSTEM SETTINGS', description: 'Re-index records cache, run integrity diagnostics, and optimize system performance' },
      { id: 'settings.emergency_lock', name: 'Emergency Maintenance Lockdown Mode', category: 'SYSTEM SETTINGS', description: 'Toggle emergency maintenance lock and freeze operational changes' },
    ],
  },
];

const ALL_PERMISSION_IDS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.id));
const TOTAL_PERMISSIONS_COUNT = ALL_PERMISSION_IDS.length; // 47 permissions total across 11 menu groups

// Standard Role Presets
export const generatePlsmsUserId = (fullName: string): string => {
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) {
    const cleanWord = parts[0].replace(/[^a-z0-9]/g, '');
    return cleanWord ? `${cleanWord}_PLSMS`.toUpperCase() : '';
  }
  if (parts.length === 2) {
    // First name's First letter + Last Name's all characters + _PLSMS (eg. KOMAL DAHAL -> KDAHAL_PLSMS)
    const firstInitial = parts[0].charAt(0).replace(/[^a-z0-9]/g, '');
    const lastName = parts[1].replace(/[^a-z0-9]/g, '');
    if (!firstInitial && !lastName) return '';
    return `${firstInitial}${lastName}_PLSMS`.toUpperCase();
  }
  // 3 or more parts: First name's First letter + Middle name's First letter + Last Name's all characters + _PLSMS (eg. KOMAL MANI DAHAL -> KMDAHAL_PLSMS)
  const firstInitial = parts[0].charAt(0).replace(/[^a-z0-9]/g, '');
  const middleInitials = parts
    .slice(1, parts.length - 1)
    .map((p) => p.charAt(0))
    .join('')
    .replace(/[^a-z0-9]/g, '');
  const lastName = parts[parts.length - 1].replace(/[^a-z0-9]/g, '');
  if (!firstInitial && !middleInitials && !lastName) return '';
  return `${firstInitial}${middleInitials}${lastName}_PLSMS`.toUpperCase();
};

const ROLE_PRESETS = {
  SUPER_ADMIN: ALL_PERMISSION_IDS,
  ADMIN: [
    'dashboard.view', 'dashboard.export_summary', 'dashboard.alphabetical', 'dashboard.tables',
    'records.search', 'records.view', 'records.view_unfiltered_raw', 'records.edit', 'records.search_mark_missing',
    'records.excel_upload', 'records.manual_entry', 'records.bulk_status_update',
    'records.distribute', 'records.undo_distribution', 'records.export_pdf', 'records.export_excel',
    'records.mark_missing', 'records.export_missing', 'records.unmark_missing',
    'found.view', 'found.verify', 'found.details', 'found.export',
    'notices.view', 'notices.manage',
    'reports.generate_ledger', 'reports.view_analytics', 'reports.export_csv', 'reports.audit_summary',
    'security.view_audit_logs', 'security.export_audit_logs',
    'user.create', 'user.edit', 'user.password_reset', 'user.reset_own_password',
    'duplicates.detect', 'duplicates.merge', 'duplicates.resolve', 'duplicates.archive',
    'cloud.sheets_sync', 'cloud.backup_create', 'cloud.backup_download',
    'uploads.sync_interval',
    'settings.view', 'settings.general', 'settings.print_layout', 'settings.sync_interval', 'settings.backup_manage', 'settings.maintenance',
  ],
  SMART_CARD_DISTRIBUTOR: [
    'records.search',
    'records.view',
    'records.search_mark_missing',
    'records.distribute',
    'records.undo_distribution',
    'records.export_pdf',
    'records.mark_missing',
    'records.unmark_missing',
    'found.view',
    'found.verify',
    'found.details',
    'notices.view',
    'reports.generate_ledger',
    'reports.audit_summary',
    'user.reset_own_password',
  ],
  DATA_ENTRY_OFFICER: [
    'records.search',
    'records.view',
    'records.search_mark_missing',
    'records.manual_entry',
    'records.distribute',
    'records.undo_distribution',
    'records.mark_missing',
    'records.export_pdf',
    'found.view',
    'found.details',
    'notices.view',
    'reports.generate_ledger',
    'reports.audit_summary',
    'user.reset_own_password',
  ],
  OFFICE_STAFF: [
    'records.search',
    'records.view',
    'records.search_mark_missing',
    'records.distribute',
    'records.undo_distribution',
    'records.mark_missing',
    'records.export_pdf',
    'found.view',
    'found.details',
    'notices.view',
    'reports.generate_ledger',
    'reports.audit_summary',
    'user.reset_own_password',
  ],
};

export const formatPrimaryRole = (roleStr?: string): 'SUPER ADMIN' | 'ADMINISTRATOR' | 'DATA ENTRY OFFICER' | 'SMART CARD DISTRIBUTER' => {
  const upper = (roleStr || '').trim().toUpperCase();
  if (upper === 'SUPER_ADMIN' || upper === 'SUPER ADMIN' || upper.includes('SUPER')) {
    return 'SUPER ADMIN';
  }
  if (upper === 'ADMIN' || upper === 'ADMINISTRATOR' || upper.includes('ADMIN')) {
    return 'ADMINISTRATOR';
  }
  if (upper.includes('DISTRIBUT') || upper.includes('CARD DISTRIBUT')) {
    return 'SMART CARD DISTRIBUTER';
  }
  return 'DATA ENTRY OFFICER';
};

export const getUserRoleCategory = (stUser: User): 'SUPER_ADMIN' | 'ADMINISTRATOR' | 'DATA_ENTRY_OFFICER' | 'SMART_CARD_DISTRIBUTOR' => {
  const isSuperAdmin =
    stUser.role === 'SUPER_ADMIN' ||
    stUser.role === 'SUPER ADMIN' ||
    stUser.id?.toUpperCase() === 'SUPER_ADMIN' ||
    stUser.id?.toUpperCase() === 'TMODLSUNSARI';
  if (isSuperAdmin) return 'SUPER_ADMIN';

  const r = (stUser.role || '').toUpperCase();
  if (r === 'ADMIN' || r === 'ADMINISTRATOR' || r.includes('ADMIN')) {
    return 'ADMINISTRATOR';
  }
  if (r.includes('DISTRIBUT') || r.includes('CARD DISTRIBUT')) {
    return 'SMART_CARD_DISTRIBUTOR';
  }
  return 'DATA_ENTRY_OFFICER';
};

export const ROLE_PRIORITY_ORDER: Record<string, number> = {
  SUPER_ADMIN: 1,
  ADMINISTRATOR: 2,
  DATA_ENTRY_OFFICER: 3,
  SMART_CARD_DISTRIBUTOR: 4,
};

export type StaffCategoryFilter = 'SUPER_ADMIN' | 'ADMINISTRATOR' | 'DATA_ENTRY_OFFICER' | 'SMART_CARD_DISTRIBUTOR' | 'ALL';

export type RoleThemeKey = 'SUPER_ADMIN' | 'ADMIN' | 'DATA_ENTRY_OFFICER' | 'SMART_CARD_DISTRIBUTOR';

export interface RoleThemeConfig {
  name: string;
  dotClass: string;
  headerTitleClass: string;
  headerBadgeClass: string;
  searchFocusClass: string;
  selectAllBtn: string;
  expandAllBtn: string;
  // Group toggle button styles
  groupBtnSelected: string;
  groupBtnUnselected: string;
  // Group badge when all items in group are selected
  groupBadgeSelected: string;
  // Expandable item when checked
  itemChecked: string;
  checkboxClass: string;
  cardBorderHover: string;
}

export const ROLE_THEME_CONFIGS: Record<RoleThemeKey, RoleThemeConfig> = {
  SUPER_ADMIN: {
    name: 'SUPER ADMIN',
    dotClass: 'bg-amber-500 dark:bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.7)]',
    headerTitleClass: 'text-amber-800 dark:text-amber-300',
    headerBadgeClass: 'bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 border-amber-300 dark:border-amber-600',
    searchFocusClass: 'focus:border-amber-500 dark:focus:border-amber-400 focus:ring-1 focus:ring-amber-500 dark:focus:ring-amber-400',
    selectAllBtn: 'text-amber-800 dark:text-amber-300 bg-white dark:bg-amber-950/40 hover:bg-amber-50 dark:hover:bg-amber-950/80 border-amber-300 dark:border-amber-500/50',
    expandAllBtn: 'text-amber-800 dark:text-amber-300 bg-white dark:bg-amber-950/40 hover:bg-amber-50 dark:hover:bg-amber-950/80 border-amber-300 dark:border-amber-500/50',
    groupBtnSelected: 'bg-amber-100 dark:bg-amber-950/90 border-amber-400 dark:border-amber-500 text-amber-900 dark:text-amber-300 shadow-sm dark:shadow-[0_0_10px_rgba(245,158,11,0.3)] font-bold',
    groupBtnUnselected: 'bg-white dark:bg-[#120B04] border-amber-300/70 dark:border-amber-800/70 text-amber-800 dark:text-amber-400/90 hover:bg-amber-50 dark:hover:bg-amber-950/50 hover:text-amber-900 dark:hover:text-amber-200 hover:border-amber-400 dark:hover:border-amber-500 font-semibold',
    groupBadgeSelected: 'bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 border-amber-300 dark:border-amber-600/70 font-bold',
    itemChecked: 'bg-amber-50/80 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100 border border-amber-200/80 dark:border-amber-800/40',
    checkboxClass: 'text-amber-600 dark:text-amber-400 focus:ring-amber-500',
    cardBorderHover: 'hover:border-amber-400 dark:hover:border-amber-500/60',
  },
  ADMIN: {
    name: 'ADMINISTRATOR',
    dotClass: 'bg-purple-500 dark:bg-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.7)]',
    headerTitleClass: 'text-purple-800 dark:text-purple-300',
    headerBadgeClass: 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-300 border-purple-300 dark:border-purple-600',
    searchFocusClass: 'focus:border-purple-500 dark:focus:border-purple-400 focus:ring-1 focus:ring-purple-500 dark:focus:ring-purple-400',
    selectAllBtn: 'text-purple-800 dark:text-purple-300 bg-white dark:bg-purple-950/40 hover:bg-purple-50 dark:hover:bg-purple-950/80 border-purple-300 dark:border-purple-500/50',
    expandAllBtn: 'text-purple-800 dark:text-purple-300 bg-white dark:bg-purple-950/40 hover:bg-purple-50 dark:hover:bg-purple-950/80 border-purple-300 dark:border-purple-500/50',
    groupBtnSelected: 'bg-purple-100 dark:bg-purple-950/90 border-purple-400 dark:border-purple-500 text-purple-900 dark:text-purple-300 shadow-sm dark:shadow-[0_0_10px_rgba(168,85,247,0.3)] font-bold',
    groupBtnUnselected: 'bg-white dark:bg-[#150724] border-purple-300/70 dark:border-purple-800/70 text-purple-800 dark:text-purple-400/90 hover:bg-purple-50 dark:hover:bg-purple-950/50 hover:text-purple-900 dark:hover:text-purple-200 hover:border-purple-400 dark:hover:border-purple-500 font-semibold',
    groupBadgeSelected: 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-300 border-purple-300 dark:border-purple-600/70 font-bold',
    itemChecked: 'bg-purple-50/80 dark:bg-purple-950/30 text-purple-950 dark:text-purple-100 border border-purple-200/80 dark:border-purple-800/40',
    checkboxClass: 'text-purple-600 dark:text-purple-400 focus:ring-purple-500',
    cardBorderHover: 'hover:border-purple-400 dark:hover:border-purple-500/60',
  },
  DATA_ENTRY_OFFICER: {
    name: 'DATA ENTRY OFFICER',
    dotClass: 'bg-sky-500 dark:bg-[#38BDF8] shadow-[0_0_10px_rgba(56,189,248,0.7)]',
    headerTitleClass: 'text-sky-800 dark:text-[#38BDF8]',
    headerBadgeClass: 'bg-sky-100 dark:bg-[#0E2A47] text-sky-900 dark:text-[#38BDF8] border-sky-300 dark:border-[#38BDF8]',
    searchFocusClass: 'focus:border-sky-500 dark:focus:border-[#38BDF8] focus:ring-1 focus:ring-sky-500 dark:focus:ring-[#38BDF8]',
    selectAllBtn: 'text-sky-800 dark:text-[#38BDF8] bg-white dark:bg-[#0E2A47]/40 hover:bg-sky-50 dark:hover:bg-[#0E2A47]/80 border-sky-300 dark:border-[#38BDF8]/50',
    expandAllBtn: 'text-sky-800 dark:text-[#38BDF8] bg-white dark:bg-[#0E2A47]/40 hover:bg-sky-50 dark:hover:bg-[#0E2A47]/80 border-sky-300 dark:border-[#38BDF8]/50',
    groupBtnSelected: 'bg-sky-100 dark:bg-[#0E2A47] border-sky-400 dark:border-[#38BDF8] text-sky-900 dark:text-[#38BDF8] shadow-sm dark:shadow-[0_0_12px_rgba(56,189,248,0.4)] font-bold',
    groupBtnUnselected: 'bg-white dark:bg-[#07172B] border-sky-300/70 dark:border-[#1A3A63] text-sky-800 dark:text-[#38BDF8]/90 hover:bg-sky-50 dark:hover:bg-[#0E2A47]/50 hover:text-sky-900 dark:hover:text-white hover:border-sky-400 dark:hover:border-[#38BDF8] font-semibold',
    groupBadgeSelected: 'bg-sky-100 dark:bg-[#0E2A47] text-sky-900 dark:text-[#38BDF8] border-sky-300 dark:border-[#38BDF8]/60 font-bold',
    itemChecked: 'bg-sky-50/80 dark:bg-[#0E2A47]/35 text-sky-950 dark:text-sky-100 border border-sky-200/80 dark:border-[#1E4373]/50',
    checkboxClass: 'text-sky-600 dark:text-[#38BDF8] focus:ring-sky-500',
    cardBorderHover: 'hover:border-sky-400 dark:hover:border-[#38BDF8]/60',
  },
  SMART_CARD_DISTRIBUTOR: {
    name: 'SMART CARD DISTRIBUTER',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]',
    headerTitleClass: 'text-emerald-800 dark:text-emerald-300',
    headerBadgeClass: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-300 border-emerald-300 dark:border-emerald-600',
    searchFocusClass: 'focus:border-emerald-500 dark:focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500 dark:focus:ring-emerald-400',
    selectAllBtn: 'text-emerald-800 dark:text-emerald-300 bg-white dark:bg-emerald-950/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/80 border-emerald-300 dark:border-emerald-500/50',
    expandAllBtn: 'text-emerald-800 dark:text-emerald-300 bg-white dark:bg-emerald-950/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/80 border-emerald-300 dark:border-emerald-500/50',
    groupBtnSelected: 'bg-emerald-100 dark:bg-emerald-950/90 border-emerald-400 dark:border-emerald-500 text-emerald-900 dark:text-emerald-300 shadow-sm dark:shadow-[0_0_12px_rgba(16,185,129,0.4)] font-bold',
    groupBtnUnselected: 'bg-white dark:bg-[#061811] border-emerald-300/70 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-400/90 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-900 dark:hover:text-emerald-200 hover:border-emerald-400 dark:hover:border-emerald-500 font-semibold',
    groupBadgeSelected: 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-300 border-emerald-300 dark:border-emerald-600/70 font-bold',
    itemChecked: 'bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100 border border-emerald-200/80 dark:border-emerald-800/40',
    checkboxClass: 'text-emerald-600 dark:text-emerald-400 focus:ring-emerald-500',
    cardBorderHover: 'hover:border-emerald-400 dark:hover:border-emerald-500/60',
  },
};

export type ConsoleTab = 'USERS_ROLES' | 'UPLOAD_CENTER' | 'BACKUPS';

export interface SettingsViewProps {
  initialTab?: ConsoleTab;
  onTabChange?: (tab: ConsoleTab) => void;
  onImportComplete?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  initialTab = 'USERS_ROLES',
  onTabChange,
  onImportComplete,
}) => {
  const { user, updateUser, refreshCurrentUser, refreshSystemStatus } = useAuth();
  const isCurrentUserSuperAdmin = Boolean(
    user &&
      (user.role === 'SUPER_ADMIN' ||
        user.role === 'SUPER ADMIN' ||
        user.id?.toUpperCase() === 'SUPER_ADMIN' ||
        user.id?.toUpperCase() === 'TMODLSUNSARI' ||
        user.id?.toUpperCase() === 'DKOMAL_PLSMS5' ||
        getUserRoleCategory(user) === 'SUPER_ADMIN')
  );

  const userCanAccessUploadCenter = canAccessUploadCenter(user);
  const canUpload = userCanAccessUploadCenter;
  const canManageUsers = isCurrentUserSuperAdmin || hasPermission(user, 'user.create') || hasPermission(user, 'user.edit') || hasPermission(user, 'user.permissions');

  const resolvedDefaultTab: ConsoleTab = useMemo(() => {
    if (initialTab) return initialTab;
    return 'USERS_ROLES';
  }, [initialTab]);

  const [activeTab, setActiveTab] = useState<ConsoleTab>(resolvedDefaultTab);

  // 2-Step Verification Clearance for Upload Center with 2-Minute Inactivity Auto-Lock
  const UPLOAD_CENTER_IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes = 120,000ms

  const [isUploadCenterCleared, setIsUploadCenterCleared] = useState<boolean>(() => {
    const isAuth = sessionStorage.getItem('plsms_upload_center_authorized') === 'true';
    const lastActive = sessionStorage.getItem('plsms_upload_center_last_active');
    if (isAuth && lastActive) {
      const elapsed = Date.now() - Number(lastActive);
      if (elapsed >= 2 * 60 * 1000) {
        sessionStorage.removeItem('plsms_upload_center_authorized');
        sessionStorage.removeItem('plsms_upload_center_token');
        sessionStorage.removeItem('plsms_upload_center_clearance');
        sessionStorage.removeItem('plsms_upload_center_last_active');
        return false;
      }
    }
    return isAuth;
  });

  const [showUploadCenterVerifyModal, setShowUploadCenterVerifyModal] = useState(false);
  const [showAccessDeniedModal, setShowAccessDeniedModal] = useState(false);
  const [uploadCenterTimeoutNotice, setUploadCenterTimeoutNotice] = useState<string | null>(() => {
    if (sessionStorage.getItem('plsms_upload_center_timed_out') === 'true') {
      sessionStorage.removeItem('plsms_upload_center_timed_out');
      return '२ मिनेटसम्म कुनै माउस वा किबोर्ड गतिविधि नभएकाले डाटा अपलोड, मेटाउने र अन्य कार्यहरूको सुरक्षाका लागि अपलोड सेन्टर स्वतः लक गरिएको छ। (Upload Center auto-locked after 2 minutes of inactivity).';
    }
    return null;
  });
  const [idleRemainingSeconds, setIdleRemainingSeconds] = useState<number>(120);
  const lastActivityTimestampRef = useRef<number>(Date.now());
  const handledInitialTabRef = useRef<string | null>(null);

  // Immediate Lock Function for Upload Center Clearance
  const lockUploadCenterAccess = useCallback((reason?: string) => {
    sessionStorage.removeItem('plsms_upload_center_authorized');
    sessionStorage.removeItem('plsms_upload_center_token');
    sessionStorage.removeItem('plsms_upload_center_clearance');
    sessionStorage.removeItem('plsms_upload_center_last_active');

    setIsUploadCenterCleared(false);
    setShowFinalSafetyModal(false);
    setResetProdPassword('');
    setResetProdConfirmText('');
    setResetProdAcknowledged(false);

    if (reason) {
      setUploadCenterTimeoutNotice(reason);
    }
    if (userCanAccessUploadCenter) {
      setShowUploadCenterVerifyModal(true);
    } else {
      setShowUploadCenterVerifyModal(false);
      setActiveTab('USERS_ROLES');
    }
  }, [user, userCanAccessUploadCenter]);

  // Format MM:SS for live countdown
  const formatIdleTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 2-Minute Inactivity Monitoring Hook (strictly runs after clicking & viewing 'UPLOAD CENTER')
  useEffect(() => {
    if (!isUploadCenterCleared || activeTab !== 'UPLOAD_CENTER') {
      return;
    }

    // Reset and initialize 2-minute timer immediately upon entering/clearing Upload Center
    lastActivityTimestampRef.current = Date.now();
    sessionStorage.setItem('plsms_upload_center_last_active', Date.now().toString());
    setIdleRemainingSeconds(120);

    const triggerSessionTimeout = () => {
      lockUploadCenterAccess(
        '२ मिनेटसम्म माउस वा किबोर्ड निष्क्रिय रहेकाले डाटा सुरक्षाका लागि अपलोड सेन्टर स्वतः लक गरिएको छ। (Upload Center session closed due to 2 minutes of mouse pointer inactivity. Please verify 5-digit M-PIN to regain access.)'
      );

      // Web Audio API chime tone safely
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(480, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(240, ctx.currentTime + 0.35);
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.35);
        }
      } catch {
        // Safe fallback
      }
    };

    let lastRecord = 0;
    const recordUserActivity = () => {
      const now = Date.now();
      lastActivityTimestampRef.current = now;
      if (now - lastRecord > 1000) {
        lastRecord = now;
        sessionStorage.setItem('plsms_upload_center_last_active', now.toString());
      }
    };

    const handleFocusOrVisibility = () => {
      const now = Date.now();
      const elapsed = now - lastActivityTimestampRef.current;
      if (elapsed >= UPLOAD_CENTER_IDLE_TIMEOUT_MS) {
        triggerSessionTimeout();
      } else {
        recordUserActivity();
      }
    };

    // User Interaction Events covering Mouse pointer (priority) and Keyboard/Touch interactions
    const activityEvents = [
      'mousemove',
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'contextmenu',
      'wheel',
      'pointerdown',
      'pointermove',
      'keydown',
      'keyup',
      'keypress',
      'touchstart',
      'touchend',
      'touchmove',
      'scroll',
    ];

    activityEvents.forEach((evt) => {
      window.addEventListener(evt, recordUserActivity, { passive: true });
    });
    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);

    const checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastActivityTimestampRef.current;
      const remainingSec = Math.max(0, Math.ceil((UPLOAD_CENTER_IDLE_TIMEOUT_MS - elapsed) / 1000));
      setIdleRemainingSeconds(remainingSec);

      if (elapsed >= UPLOAD_CENTER_IDLE_TIMEOUT_MS) {
        clearInterval(checkInterval);
        triggerSessionTimeout();
      }
    }, 1000);

    return () => {
      clearInterval(checkInterval);
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, recordUserActivity);
      });
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
    };
  }, [isUploadCenterCleared, activeTab, lockUploadCenterAccess]);

  useEffect(() => {
    if (initialTab) {
      if (initialTab === 'UPLOAD_CENTER') {
        if (!userCanAccessUploadCenter) {
          // Strictly prevent unauthorized users from accessing upload center or seeing default MPIN hint
          setShowAccessDeniedModal(true);
          setShowUploadCenterVerifyModal(false);
          setActiveTab('USERS_ROLES');
          onTabChange?.('USERS_ROLES');
          handledInitialTabRef.current = 'USERS_ROLES';
        } else {
          setActiveTab('UPLOAD_CENTER');
          fetchDbStats();
          // Prompt verification modal only once on entry if not yet cleared and tab changed
          if (!isUploadCenterCleared && handledInitialTabRef.current !== 'UPLOAD_CENTER') {
            setShowUploadCenterVerifyModal(true);
          }
          handledInitialTabRef.current = 'UPLOAD_CENTER';
        }
      } else {
        setActiveTab(initialTab);
        setShowUploadCenterVerifyModal(false);
        setShowAccessDeniedModal(false);
        handledInitialTabRef.current = initialTab;
      }
    }
  }, [initialTab, userCanAccessUploadCenter, isUploadCenterCleared]);

  useEffect(() => {
    if (activeTab === 'UPLOAD_CENTER') {
      fetchDbStats();
    }
  }, [activeTab]);

  const handleTabClick = (tab: ConsoleTab) => {
    if (tab === 'UPLOAD_CENTER') {
      if (!userCanAccessUploadCenter) {
        // Unauthorized user: show Access Denied modal and preserve existing restricted behavior
        setShowUploadCenterVerifyModal(false);
        setShowAccessDeniedModal(true);
        return;
      }

      fetchDbStats();
      setActiveTab('UPLOAD_CENTER');
      onTabChange?.('UPLOAD_CENTER');
      handledInitialTabRef.current = 'UPLOAD_CENTER';

      // If not yet cleared or session timed out, prompt verification modal strictly once
      if (!isUploadCenterCleared) {
        setShowUploadCenterVerifyModal(true);
      } else {
        // Active session already cleared: refresh 2-minute activity timer
        lastActivityTimestampRef.current = Date.now();
        sessionStorage.setItem('plsms_upload_center_last_active', Date.now().toString());
        setIdleRemainingSeconds(120);
      }
      return;
    }

    // Dismiss verification and access denied modals if switching away to USERS & ROLES or BACKUPS
    setShowUploadCenterVerifyModal(false);
    setShowAccessDeniedModal(false);
    setActiveTab(tab);
    onTabChange?.(tab);
    handledInitialTabRef.current = tab;
  };

  // Production Database Reset Engine State (High-Risk Super Admin Only)
  const [resetProdIdentifier, setResetProdIdentifier] = useState('');
  const [resetProdPassword, setResetProdPassword] = useState('');
  const [showResetProdPassword, setShowResetProdPassword] = useState(false);
  const [isResetPasswordValid, setIsResetPasswordValid] = useState<boolean | null>(null);
  const [resetProdConfirmText, setResetProdConfirmText] = useState('');
  const [resetProdAcknowledged, setResetProdAcknowledged] = useState(false);
  const [resettingProductionData, setResettingProductionData] = useState(false);
  const [showFinalSafetyModal, setShowFinalSafetyModal] = useState(false);

  // Live password matched / not matched validation logic (Picture 2 & 3)
  useEffect(() => {
    const trimmedId = resetProdIdentifier.trim();
    if (!trimmedId || resetProdPassword.length === 0) {
      setIsResetPasswordValid(null);
      return;
    }

    let isMounted = true;
    const checkTimer = setTimeout(async () => {
      try {
        const valid = await api.validatePasswordPrefix(trimmedId, resetProdPassword);
        if (isMounted) {
          setIsResetPasswordValid(valid);
        }
      } catch {
        if (isMounted) {
          setIsResetPasswordValid(false);
        }
      }
    }, 80);

    return () => {
      isMounted = false;
      clearTimeout(checkTimer);
    };
  }, [resetProdIdentifier, resetProdPassword]);
  const [productionResetResult, setProductionResetResult] = useState<{
    success: boolean;
    message: string;
    details?: {
      clearedRecords: number;
      clearedImports: number;
      clearedDistributions: number;
      clearedAuditLogs: number;
    };
  } | null>(null);
  const [showResetSuccessModal, setShowResetSuccessModal] = useState(false);

  // Close reset success modal with Escape key
  useEffect(() => {
    if (!showResetSuccessModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowResetSuccessModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showResetSuccessModal]);
  const [productionResetError, setProductionResetError] = useState('');
  const [liveDbStats, setLiveDbStats] = useState<{
    totalRecords: number;
    totalImports: number;
    totalDistributions: number;
    totalAuditLogs: number;
  }>({ totalRecords: 0, totalImports: 0, totalDistributions: 0, totalAuditLogs: 0 });
  const [loadingDbStats, setLoadingDbStats] = useState(false);

  // Staff User Creation Form State
  const [staffName, setStaffName] = useState('');
  const [userId, setUserId] = useState('');
  const [isUserIdManualEdit, setIsUserIdManualEdit] = useState(false);
  const [mobileNumber, setMobileNumber] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [designatedPost, setDesignatedPost] = useState('');
  const [operationalRole, setOperationalRole] = useState('Data Entry Officer (System Operator)');
  const [temporaryPassword, setTemporaryPassword] = useState('Itahari@2026');
  const [showPassword, setShowPassword] = useState(false);

  // Granular Permissions State
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(ROLE_PRESETS.DATA_ENTRY_OFFICER);
  const [activePreset, setActivePreset] = useState<'SUPER_ADMIN' | 'ADMIN' | 'DATA_ENTRY_OFFICER' | 'SMART_CARD_DISTRIBUTOR' | 'CUSTOM'>('DATA_ENTRY_OFFICER');
  const [lastSelectedRolePreset, setLastSelectedRolePreset] = useState<RoleThemeKey>('DATA_ENTRY_OFFICER');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [permissionSearch, setPermissionSearch] = useState('');
  // User Creation Permission Lock: Must click 'SAVE PERMISSION AS SELECTED ABOVE' before '+ CREATE USER ID' is enabled
  const [isPermissionsSaved, setIsPermissionsSaved] = useState(false);
  const [showPermissionsSavedModal, setShowPermissionsSavedModal] = useState(false);

  // Active Role Color Theme mapping (Dynamic matching between Role button and all Permission buttons)
  const currentRoleThemeKey: RoleThemeKey = useMemo(() => {
    if (activePreset === 'SUPER_ADMIN') return 'SUPER_ADMIN';
    if (activePreset === 'ADMIN') return 'ADMIN';
    if (activePreset === 'DATA_ENTRY_OFFICER') return 'DATA_ENTRY_OFFICER';
    if (activePreset === 'SMART_CARD_DISTRIBUTOR') return 'SMART_CARD_DISTRIBUTOR';
    return lastSelectedRolePreset;
  }, [activePreset, lastSelectedRolePreset]);

  const activeRoleTheme: RoleThemeConfig = ROLE_THEME_CONFIGS[currentRoleThemeKey];

  // Registered Staff Matrix State
  const [usersList, setUsersList] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createdUserSuccessInfo, setCreatedUserSuccessInfo] = useState<CreatedUserInfo | null>(null);
  const [statusMessage, setStatusMessage] = useState<ActionNotificationData | null>(null);

  // Staff Matrix Category Filter:
  const [staffFilter, setStaffFilter] = useState<StaffCategoryFilter>('ALL');
  const [staffSearchQuery, setStaffSearchQuery] = useState('');

  // Modals State
  const [permissionModalUser, setPermissionModalUser] = useState<User | null>(null);
  const [modalPermissions, setModalPermissions] = useState<string[]>([]);
  const [modalActivePreset, setModalActivePreset] = useState<RoleThemeKey>('DATA_ENTRY_OFFICER');
  const [savingPermissions, setSavingPermissions] = useState(false);

  const [resetModalUser, setResetModalUser] = useState<User | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('Itahari@2026');
  const [resettingPassword, setResettingPassword] = useState(false);

  // Staff Self Password Change Modal
  const [selfPasswordModalOpen, setSelfPasswordModalOpen] = useState(false);
  const [selfCurrentPassword, setSelfCurrentPassword] = useState('');
  const [selfNewPassword, setSelfNewPassword] = useState('');
  const [selfConfirmPassword, setSelfConfirmPassword] = useState('');
  const [showSelfCurrentPassword, setShowSelfCurrentPassword] = useState(false);
  const [showSelfNewPassword, setShowSelfNewPassword] = useState(false);
  const [showSelfConfirmPassword, setShowSelfConfirmPassword] = useState(false);
  const [selfChangingPassword, setSelfChangingPassword] = useState(false);
  const [selfPasswordError, setSelfPasswordError] = useState('');
  const [selfPasswordSuccess, setSelfPasswordSuccess] = useState('');

  const [revokeModalUser, setRevokeModalUser] = useState<User | null>(null);
  const [revokingUser, setRevokingUser] = useState(false);

  // Backup Tab State & Multi-Location Configuration
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState('');
  const [backupError, setBackupError] = useState('');
  const [backupLocations, setBackupLocations] = useState<Array<{
    code: string;
    nameNp: string;
    nameEn: string;
    locationNp: string;
    locationEn: string;
    officeNameNp: string;
    officeNameEn: string;
    departmentNp: string;
    departmentEn: string;
    provinceGovNp?: string;
    provinceGovEn?: string;
    isPrimary?: boolean;
  }>>([]);
  const [selectedBackupLocationCode, setSelectedBackupLocationCode] = useState<string>('ITAHARI_SUNSARI');
  const [backupScope, setBackupScope] = useState<'FULL_MASTER_ARCHIVE' | 'RECORDS_ONLY' | 'DISTRIBUTIONS_ONLY' | 'USERS_SECURITY'>('FULL_MASTER_ARCHIVE');
  const [customOfficeName, setCustomOfficeName] = useState('');
  const [customLocationName, setCustomLocationName] = useState('');
  const [downloadedBackupInfo, setDownloadedBackupInfo] = useState<{
    filename: string;
    sizeBytes: number;
    locationName: string;
    locationCode: string;
    scope: string;
    timestamp: string;
  } | null>(null);
  const [liveInventoryStats, setLiveInventoryStats] = useState<{
    records: number;
    notDistributed: number;
    distributed: number;
    missing: number;
    found: number;
    handedOver?: number;
    distributions: number;
    imports: number;
    users: number;
    usersWithPasswords?: number;
    passwordEncryptionFormat?: string;
    actionOverrides?: number;
    notices?: number;
    hasGoogleSheetsConfig?: boolean;
  }>({
    records: 0,
    notDistributed: 0,
    distributed: 0,
    missing: 0,
    found: 0,
    handedOver: 0,
    distributions: 0,
    imports: 0,
    users: 0,
    usersWithPasswords: 0,
    passwordEncryptionFormat: 'BCRYPT_CRYPTOGRAPHIC_HASH',
    actionOverrides: 0,
    notices: 0,
    hasGoogleSheetsConfig: false,
  });

  // Visitor Counter Permanent Preservation State & Handlers
  const [adminVisitorCount, setAdminVisitorCount] = useState<number>(1);
  const [calibrateInputCount, setCalibrateInputCount] = useState<string>('');
  const [isCalibratingVisitorCount, setIsCalibratingVisitorCount] = useState(false);
  const [calibrateVisitorSuccess, setCalibrateVisitorSuccess] = useState<string | null>(null);
  const [calibrateVisitorError, setCalibrateVisitorError] = useState<string | null>(null);

  const fetchAdminVisitorCount = async () => {
    try {
      const res = await api.getVisitorCounter();
      if (res && typeof res.count === 'number') {
        setAdminVisitorCount(res.count);
        setCalibrateInputCount((prev) => (prev ? prev : String(res.count)));
      }
    } catch (_) {}
  };

  const handleCalibrateVisitorCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(calibrateInputCount, 10);
    if (isNaN(val) || val < 1) {
      setCalibrateVisitorError('कृपया कम्तीमा १ वा सोभन्दा बढीको वैध संख्या प्रविष्ट गर्नुहोस् (Minimum count must be 1 or higher).');
      return;
    }
    setIsCalibratingVisitorCount(true);
    setCalibrateVisitorError(null);
    setCalibrateVisitorSuccess(null);
    try {
      const res = await api.calibrateVisitorCounter(
        val,
        'Super Admin manual calibration & cross-version lock'
      );
      if (res && res.success) {
        setAdminVisitorCount(res.count);
        setCalibrateInputCount(String(res.count));
        setCalibrateVisitorSuccess(
          `भिजिटर काउन्टर सफलतापुर्वक ${res.count.toLocaleString()} मा स्थायी रूपमा सुरक्षित गरियो। अबदेखि यो कहिल्यै घट्ने वा रिसेट हुने छैन। (Visitor counter permanently set to ${res.count.toLocaleString()} across all database tiers).`
        );
        window.dispatchEvent(
          new CustomEvent('plsms_visitor_counter_updated', {
            detail: res.count,
          })
        );
      } else {
        setCalibrateVisitorError(res?.message || 'भिजिटर काउन्टर अपडेट गर्न सकिएन।');
      }
    } catch (err: any) {
      setCalibrateVisitorError(err.message || 'भिजिटर काउन्टर अपडेट गर्दा त्रुटि उत्पन्न भयो।');
    } finally {
      setIsCalibratingVisitorCount(false);
    }
  };

  // Load Registered Users on Mount
  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      const res = await api.getUsers();
      let list: User[] = [];
      if (res && res.users && res.users.length > 0) {
        list = [...res.users];
      } else {
        // Fallback default users
        list = [
          {
            id: 'DKOMAL_PLSMS5',
            name: 'DAHAL KOMAL',
            email: 'tmodlitahari@gmail.com',
            phone: '9842033214',
            post: 'Computer Officer',
            role: 'ADMIN',
            status: 'ACTIVE',
            permissions: ALL_PERMISSION_IDS,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'STAFF_RAMESH',
            name: 'RAMESH SHRESTHA',
            email: 'ramesh.shrestha@tmodl.gov.np',
            phone: '9852011223',
            post: 'Nayab Subba / Registration Officer',
            role: 'DATA_ENTRY_OFFICER',
            status: 'ACTIVE',
            permissions: ['records.view', 'records.search', 'records.distribute'],
            createdAt: new Date().toISOString(),
          },
          {
            id: 'STAFF_SITA',
            name: 'SITA ADHIKARI',
            email: 'sita.adhikari@tmodl.gov.np',
            phone: '9842155678',
            post: 'Assistant Computer Operator',
            role: 'DATA_ENTRY_OFFICER',
            status: 'ACTIVE',
            permissions: ['records.view', 'records.search', 'records.manual_entry'],
            createdAt: new Date().toISOString(),
          },
          {
            id: 'SUPER_ADMIN',
            name: 'KOMAL DAHAL',
            email: 'dahalkomal@gmail.com',
            phone: '9842033214',
            post: 'SYSTEM CONTROLLER',
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            permissions: ALL_PERMISSION_IDS,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'TMODLSUNSARI',
            name: 'TMO SUNSARI ADMINISTRATOR',
            email: 'tmodlsunsari@gmail.com',
            phone: '9842000000',
            post: 'SYSTEM CONTROLLER',
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            permissions: ALL_PERMISSION_IDS,
            createdAt: new Date().toISOString(),
          },
        ];
      }

      // Always ensure the logged-in user is prominently in the list and hoisted to the top
      if (user) {
        const existingIdx = list.findIndex(
          (u) =>
            u.id.toLowerCase() === user.id.toLowerCase() ||
            (user.email && u.email && u.email.toLowerCase() === user.email.toLowerCase())
        );
        if (existingIdx !== -1) {
          const [found] = list.splice(existingIdx, 1);
          list.unshift({
            ...found,
            name: user.name || found.name,
            role: user.role || found.role,
            post: user.post || found.post,
          });
        } else {
          list.unshift({
            id: user.id,
            name: user.name,
            email: user.email || '',
            phone: user.phone || '',
            post: user.post || 'Computer Officer',
            role: user.role,
            status: user.status || 'ACTIVE',
            permissions: user.permissions || ALL_PERMISSION_IDS,
            createdAt: user.createdAt || new Date().toISOString(),
          });
        }
      }

      setUsersList(list);
    } catch (err: any) {
      console.warn('Notice loading users list:', err?.message || err);
      // Construct fallback list including active login user and known staff accounts
      const fallbackList: User[] = [];
      if (user) {
        fallbackList.push({
          id: user.id,
          name: user.name,
          email: user.email || 'tmodlitahari@gmail.com',
          phone: user.phone || '9842033214',
          post: user.post || 'Computer Officer',
          role: user.role || 'ADMIN',
          status: user.status || 'ACTIVE',
          permissions: user.permissions || ALL_PERMISSION_IDS,
          createdAt: user.createdAt || new Date().toISOString(),
        });
      }
      if (!fallbackList.some((u) => u.id === 'DKOMAL_PLSMS5')) {
        fallbackList.push({
          id: 'DKOMAL_PLSMS5',
          name: 'DAHAL KOMAL',
          email: 'tmodlitahari@gmail.com',
          phone: '9842033214',
          post: 'Computer Officer',
          role: 'ADMIN',
          status: 'ACTIVE',
          permissions: ALL_PERMISSION_IDS,
          createdAt: new Date().toISOString(),
        });
      }
      if (!fallbackList.some((u) => u.id === 'STAFF_RAMESH')) {
        fallbackList.push({
          id: 'STAFF_RAMESH',
          name: 'RAMESH SHRESTHA',
          email: 'ramesh.shrestha@tmodl.gov.np',
          phone: '9852011223',
          post: 'Nayab Subba / Registration Officer',
          role: 'DATA_ENTRY_OFFICER',
          status: 'ACTIVE',
          permissions: ['records.view', 'records.search', 'records.distribute'],
          createdAt: new Date().toISOString(),
        });
      }
      if (!fallbackList.some((u) => u.id === 'STAFF_SITA')) {
        fallbackList.push({
          id: 'STAFF_SITA',
          name: 'SITA ADHIKARI',
          email: 'sita.adhikari@tmodl.gov.np',
          phone: '9842155678',
          post: 'Assistant Computer Operator',
          role: 'DATA_ENTRY_OFFICER',
          status: 'ACTIVE',
          permissions: ['records.view', 'records.search', 'records.manual_entry'],
          createdAt: new Date().toISOString(),
        });
      }
      if (!fallbackList.some((u) => u.id === 'SUPER_ADMIN')) {
        fallbackList.push({
          id: 'SUPER_ADMIN',
          name: 'KOMAL DAHAL',
          email: 'dahalkomal@gmail.com',
          phone: '9842033214',
          post: 'SYSTEM CONTROLLER',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          permissions: ALL_PERMISSION_IDS,
          createdAt: new Date().toISOString(),
        });
      }
      setUsersList(fallbackList);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [user?.id]);

  // Load Backup Locations & Live Inventory Counts
  useEffect(() => {
    let isMounted = true;
    api
      .getBackupLocations()
      .then((res) => {
        if (isMounted && res.locations && res.locations.length > 0) {
          setBackupLocations(res.locations);
          if (res.activeOfficeCode) {
            setSelectedBackupLocationCode(res.activeOfficeCode);
          }
        }
      })
      .catch((err) => {
        console.warn('Notice loading backup locations:', err);
      });

    const loadLiveInventory = async () => {
      try {
        const [backupStats, dashStats] = await Promise.all([
          api.getDatabaseInventoryStats().catch(() => null),
          api.getDashboardStats().catch(() => null),
        ]);

        if (isMounted) {
          const total = backupStats?.totalRecords ?? dashStats?.totalRecords ?? 0;
          const notDist = backupStats?.notDistributed ?? dashStats?.availableRecords ?? 0;
          const dist = backupStats?.distributed ?? dashStats?.distributedRecords ?? 0;
          const miss = backupStats?.missing ?? dashStats?.missingRecords ?? 0;
          const fnd = backupStats?.found ?? dashStats?.foundRecords ?? 0;
          const handedOver = backupStats?.handedOverCards ?? dashStats?.handedOverRecords ?? dist;
          const imp = backupStats?.imports ?? dashStats?.totalImports ?? 0;
          const userCount = backupStats?.users || (usersList.length > 0 ? usersList.length : 4);

          setLiveInventoryStats({
            records: total,
            notDistributed: notDist,
            distributed: dist,
            missing: miss,
            found: fnd,
            handedOver: handedOver,
            distributions: dist,
            imports: imp,
            users: userCount,
            usersWithPasswords: backupStats?.usersWithPasswords ?? userCount,
            passwordEncryptionFormat: backupStats?.passwordEncryptionFormat || 'BCRYPT_CRYPTOGRAPHIC_HASH',
            actionOverrides: backupStats?.actionOverrides ?? 0,
            notices: backupStats?.notices ?? 0,
            hasGoogleSheetsConfig: backupStats?.hasGoogleSheetsConfig ?? false,
          });
        }
      } catch (err) {
        console.warn('Notice loading inventory stats:', err);
      }
    };

    loadLiveInventory();
    fetchAdminVisitorCount();

    const handleDataUpdate = () => {
      loadLiveInventory();
      fetchAdminVisitorCount();
    };

    window.addEventListener('records-updated', handleDataUpdate);
    window.addEventListener('database-reset', handleDataUpdate);

    return () => {
      isMounted = false;
      window.removeEventListener('records-updated', handleDataUpdate);
      window.removeEventListener('database-reset', handleDataUpdate);
    };
  }, [usersList.length]);

  // Handle Preset Apply
  const applyPreset = (preset: 'SUPER_ADMIN' | 'ADMIN' | 'SMART_CARD_DISTRIBUTOR' | 'DATA_ENTRY_OFFICER' | 'OFFICE_STAFF') => {
    setIsPermissionsSaved(false);
    if (preset === 'SUPER_ADMIN') {
      setActivePreset('SUPER_ADMIN');
      setLastSelectedRolePreset('SUPER_ADMIN');
      setSelectedPermissions(ROLE_PRESETS.SUPER_ADMIN);
      setOperationalRole('Super Admin (Full Access)');
    } else if (preset === 'ADMIN') {
      setActivePreset('ADMIN');
      setLastSelectedRolePreset('ADMIN');
      setSelectedPermissions(ROLE_PRESETS.ADMIN);
      setOperationalRole('Administrator (Office Manager)');
    } else if (preset === 'SMART_CARD_DISTRIBUTOR') {
      setActivePreset('SMART_CARD_DISTRIBUTOR');
      setLastSelectedRolePreset('SMART_CARD_DISTRIBUTOR');
      setSelectedPermissions(ROLE_PRESETS.SMART_CARD_DISTRIBUTOR);
      setOperationalRole('Smart Card Distributer (Counter Operator)');
    } else {
      setActivePreset('DATA_ENTRY_OFFICER');
      setLastSelectedRolePreset('DATA_ENTRY_OFFICER');
      setSelectedPermissions(ROLE_PRESETS.DATA_ENTRY_OFFICER);
      setOperationalRole('Data Entry Officer (System Operator)');
    }
  };

  // Toggle single permission
  const togglePermission = (permId: string) => {
    const isSuperAdminOnly = permId === 'dashboard.view' || permId === 'dashboard.tables';
    const isTargetSuperAdmin =
      activePreset === 'SUPER_ADMIN' ||
      operationalRole.includes('Super Admin');

    if (isSuperAdminOnly && !isTargetSuperAdmin && !selectedPermissions.includes(permId)) {
      setStatusMessage({
        type: 'error',
        title: 'Super Admin Access Only',
        text: 'Smart Card Dashboard overview and underlying tables access are strictly reserved for Super Administrators and cannot be assigned to Data Entry Officers or other roles.',
      });
      return;
    }

    setIsPermissionsSaved(false);
    setActivePreset('CUSTOM');
    setSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    );
  };

  // Toggle entire group
  const toggleGroup = (groupKey: string) => {
    setIsPermissionsSaved(false);
    setActivePreset('CUSTOM');
    const group = PERMISSION_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;

    const isTargetSuperAdmin =
      activePreset === 'SUPER_ADMIN' ||
      operationalRole.includes('Super Admin');

    const groupPermIds = group.permissions
      .map((p) => p.id)
      .filter((id) => isTargetSuperAdmin || (id !== 'dashboard.view' && id !== 'dashboard.tables'));

    const allSelected = groupPermIds.length > 0 && groupPermIds.every((id) => selectedPermissions.includes(id));

    if (allSelected) {
      setSelectedPermissions((prev) => prev.filter((id) => !groupPermIds.includes(id)));
    } else {
      setSelectedPermissions((prev) => Array.from(new Set([...prev, ...groupPermIds])));
    }
  };

  // Select / Clear all permissions
  const selectAllPermissions = () => {
    setIsPermissionsSaved(false);
    setActivePreset('SUPER_ADMIN');
    const isTargetSuperAdmin =
      activePreset === 'SUPER_ADMIN' ||
      operationalRole.includes('Super Admin');
    const perms = isTargetSuperAdmin
      ? ALL_PERMISSION_IDS
      : ALL_PERMISSION_IDS.filter((id) => id !== 'dashboard.view' && id !== 'dashboard.tables');
    setSelectedPermissions(perms);
  };

  const clearAllPermissions = () => {
    setIsPermissionsSaved(false);
    setActivePreset('CUSTOM');
    setSelectedPermissions([]);
  };

  // Save Permissions As Selected Above Action (Picture 1 Action Handler)
  const handleSavePermissions = () => {
    if (selectedPermissions.length === 0) {
      setStatusMessage({
        type: 'error',
        text: 'Zero permissions selected. Please select at least 1 access permission before saving.',
        title: 'Zero Permissions Selected',
      });
      return;
    }
    // Open the confirmation modal - permissions will be locked and saved upon clicking 'PROCEED TO CREATE USER ID'
    setShowPermissionsSavedModal(true);
  };

  // Called when clicking 'PROCEED TO CREATE USER ID' in the modal
  const handleProceedToCreateUserId = () => {
    setIsPermissionsSaved(true);
    setShowPermissionsSavedModal(false);
  };

  // Expand / Collapse all groups
  const toggleExpandAll = () => {
    const anyClosed = PERMISSION_GROUPS.some((g) => !expandedGroups[g.key]);
    const newState: Record<string, boolean> = {};
    PERMISSION_GROUPS.forEach((g) => {
      newState[g.key] = anyClosed;
    });
    setExpandedGroups(newState);
  };

  const toggleGroupExpand = (groupKey: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  // Duplicate Detection Memoized Checks
  const matchingUserWithSameId = useMemo(() => {
    if (!userId.trim()) return null;
    return usersList.find((u) => u.id.trim().toLowerCase() === userId.trim().toLowerCase()) || null;
  }, [userId, usersList]);

  const matchingUserWithSameName = useMemo(() => {
    if (!staffName.trim()) return null;
    return usersList.find((u) => u.name.trim().toLowerCase() === staffName.trim().toLowerCase()) || null;
  }, [staffName, usersList]);

  // Handle Staff Name Input change (automatically converts to uppercase & generates User ID in real-time)
  const handleStaffNameChange = (val: string) => {
    const upperName = val.toUpperCase();
    setStaffName(upperName);
    if (!isUserIdManualEdit || !userId.trim()) {
      const generated = generatePlsmsUserId(upperName);
      setUserId(generated);
    }
  };

  // Handle User ID Input change (allows full manual edit)
  const handleUserIdChange = (val: string) => {
    setUserId(val.toUpperCase());
    setIsUserIdManualEdit(true);
  };

  // Auto Generate User ID button click
  const handleAutoGenerateUserId = () => {
    const generated = generatePlsmsUserId(staffName);
    if (generated) {
      setUserId(generated.toUpperCase());
      setIsUserIdManualEdit(false);
    } else {
      const randomNum = Math.floor(100 + Math.random() * 900);
      setUserId(`STAFF${randomNum}_PLSMS`);
      setIsUserIdManualEdit(false);
    }
  };

  // Generate Random Password
  const handleGenerateRandomPassword = () => {
    setTemporaryPassword(generateStrongPassword('Plsms'));
  };

  // Filtered permission groups based on search
  const filteredGroups = useMemo(() => {
    if (!permissionSearch.trim()) return PERMISSION_GROUPS;
    const query = permissionSearch.toLowerCase();
    return PERMISSION_GROUPS.map((group) => {
      const matching = group.permissions.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query) ||
          (p.description && p.description.toLowerCase().includes(query))
      );
      return {
        ...group,
        permissions: matching,
      };
    }).filter((group) => group.permissions.length > 0);
  }, [permissionSearch]);

  // Filtered staff list for the Permissions Matrix table
  const displayedUsers = useMemo(() => {
    let list = usersList;

    const canViewAllUsers = Boolean(
      isCurrentUserSuperAdmin ||
        canManageUsers ||
        user?.role === 'ADMINISTRATOR' ||
        user?.role === 'ADMIN' ||
        getUserRoleCategory(user) === 'ADMINISTRATOR' ||
        user?.permissions?.includes('*') ||
        user?.permissions?.includes('settings.view') ||
        user?.permissions?.includes('user.view') ||
        user?.permissions?.includes('user.edit')
    );

    // Strictly display ONLY the details of the logged-in user if non-privileged
    if (!canViewAllUsers) {
      if (!user) return [];
      const userMatches = usersList.filter((stUser) => {
        const matchId = Boolean(user.id && stUser.id && stUser.id.toLowerCase() === user.id.toLowerCase());
        const matchEmail = Boolean(user.email && stUser.email && stUser.email.toLowerCase() === user.email.toLowerCase());
        return matchId || matchEmail;
      });
      list = userMatches.length > 0 ? userMatches : [user];
    } else {
      // 1. Filter by category
      if (staffFilter === 'SUPER_ADMIN') {
        list = list.filter((u) => getUserRoleCategory(u) === 'SUPER_ADMIN');
      } else if (staffFilter === 'ADMINISTRATOR') {
        list = list.filter((u) => getUserRoleCategory(u) === 'ADMINISTRATOR');
      } else if (staffFilter === 'DATA_ENTRY_OFFICER') {
        list = list.filter((u) => getUserRoleCategory(u) === 'DATA_ENTRY_OFFICER');
      } else if (staffFilter === 'SMART_CARD_DISTRIBUTOR') {
        list = list.filter((u) => getUserRoleCategory(u) === 'SMART_CARD_DISTRIBUTOR');
      } // If 'ALL', keep all accounts
    }

    // 2. Filter by search query
    if (staffSearchQuery.trim()) {
      const q = staffSearchQuery.toLowerCase();
      list = list.filter((stUser) => {
        const matchName = stUser.name?.toLowerCase().includes(q);
        const matchId = stUser.id?.toLowerCase().includes(q);
        const matchPost = stUser.post?.toLowerCase().includes(q);
        const matchRole = stUser.role?.toLowerCase().includes(q);
        const matchEmail = stUser.email?.toLowerCase().includes(q);
        return matchName || matchId || matchPost || matchRole || matchEmail;
      });
    }

    // 3. Sort by Role Priority:
    // 1-SUPER ADMIN, 2-ADMINISTRATOR, 3-DATA ENTRY OFFICER, 4-SMART CARD DISTRIBUTER
    return [...list].sort((a, b) => {
      const catA = getUserRoleCategory(a);
      const catB = getUserRoleCategory(b);
      const priorityA = ROLE_PRIORITY_ORDER[catA] ?? 99;
      const priorityB = ROLE_PRIORITY_ORDER[catB] ?? 99;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // Secondary sort: Staff Name or ID alphabetically
      const nameA = a.name || a.id || '';
      const nameB = b.name || b.id || '';
      return nameA.localeCompare(nameB);
    });
  }, [usersList, staffFilter, staffSearchQuery, isCurrentUserSuperAdmin, user]);

  // Create User Account Handler
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    // Defense-in-depth: Must accept permissions first via 'SAVE PERMISSION AS SELECTED ABOVE' button
    if (!isPermissionsSaved) {
      setStatusMessage({
        type: 'error',
        text: "Please click 'SAVE PERMISSION AS SELECTED ABOVE' and accept the permissions before creating the user ID.",
        title: 'Permissions Confirmation Required',
      });
      return;
    }

    if (!staffName.trim()) {
      setStatusMessage({ type: 'error', text: 'Staff Full Name is required.' });
      return;
    }
    if (!userId.trim()) {
      setStatusMessage({ type: 'error', text: 'User ID is required.' });
      return;
    }
    if (!temporaryPassword || temporaryPassword.length < 6) {
      setStatusMessage({ type: 'error', text: 'Temporary password must be at least 6 characters long.' });
      return;
    }

    const tempValidation = validatePasswordStrength(temporaryPassword);
    if (!tempValidation.isValid) {
      setStatusMessage({ type: 'error', text: tempValidation.message });
      return;
    }

    if (matchingUserWithSameId) {
      setStatusMessage({
        type: 'error',
        text: `User ID "${userId}" is already assigned to "${matchingUserWithSameId.name}". Please choose a unique User ID.`,
      });
      return;
    }

    let roleCode: 'SUPER ADMIN' | 'ADMINISTRATOR' | 'DATA ENTRY OFFICER' | 'SMART CARD DISTRIBUTER' = 'DATA ENTRY OFFICER';
    if (operationalRole.includes('Super Admin')) roleCode = 'SUPER ADMIN';
    else if (operationalRole.includes('Administrator')) roleCode = 'ADMINISTRATOR';
    else if (operationalRole.includes('Distribut')) roleCode = 'SMART CARD DISTRIBUTER';

    try {
      setCreatingUser(true);
      const createdId = userId.trim();
      const createdName = staffName.trim();
      const createdPost = designatedPost.trim();
      const createdRole = roleCode;

      const res = await api.createUser({
        id: createdId,
        name: createdName,
        email: emailAddress.trim() || undefined,
        phone: mobileNumber.trim() || undefined,
        post: createdPost || undefined,
        role: createdRole,
        permissions: selectedPermissions,
        password: temporaryPassword,
      });

      // Immediately display the beautiful 'User Created Successfully----' dialog with Full Name, User ID, Role, Post
      const createdUserObj: User = res.user || {
        id: createdId,
        name: createdName,
        email: emailAddress.trim() || undefined,
        phone: mobileNumber.trim() || undefined,
        post: createdPost || undefined,
        role: createdRole,
        permissions: selectedPermissions,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
      };

      setUsersList((prev) => {
        const filtered = prev.filter((u) => u.id !== createdUserObj.id);
        return [...filtered, createdUserObj];
      });

      setCreatedUserSuccessInfo({
        name: createdUserObj.name || createdName,
        id: createdUserObj.id || createdId,
        role: createdUserObj.role || createdRole,
        post: createdUserObj.post || createdPost || 'OFFICE OPERATOR',
      });

      setStatusMessage({ type: 'success', text: res.message || `User ${createdId} created successfully!` });

      // Reset form
      setStaffName('');
      setUserId('');
      setIsUserIdManualEdit(false);
      setMobileNumber('');
      setEmailAddress('');
      setDesignatedPost('');
      setTemporaryPassword('Itahari@2026');
      applyPreset('DATA_ENTRY_OFFICER');

      await fetchUsers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create user account' });
    } finally {
      setCreatingUser(false);
    }
  };

  // Suspend / Activate User Handler
  const handleToggleUserStatus = async (targetUser: User) => {
    const newStatus = targetUser.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    try {
      await api.toggleUserStatus(targetUser.id, newStatus);
      setUsersList((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, status: newStatus } : u))
      );
      setStatusMessage({
        type: 'success',
        text: `User ${targetUser.name} is now ${newStatus}.`,
        title: newStatus === 'ACTIVE' ? 'Staff Account Activated' : 'Staff Account Suspended',
        actionType: newStatus === 'ACTIVE' ? 'USER_STATUS_ACTIVE' : 'USER_STATUS_SUSPENDED',
        targetName: targetUser.name,
        targetId: targetUser.id,
        targetRole: targetUser.role,
        details:
          newStatus === 'ACTIVE'
            ? `The user profile for ${targetUser.name} has been activated. Full system login privileges have been restored in the PLSMS directory.`
            : `The user account for ${targetUser.name} has been placed on SUSPENDED status. System access is temporarily restricted.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to toggle user status' });
    }
  };

  // Open Permissions Modal
  const handleOpenPermissionsModal = (targetUser: User) => {
    if (!isCurrentUserSuperAdmin) return;
    setPermissionModalUser(targetUser);
    setModalPermissions(targetUser.permissions || (targetUser.role === 'SUPER_ADMIN' ? ALL_PERMISSION_IDS : []));
    const roleCat = getUserRoleCategory(targetUser);
    let key: RoleThemeKey = 'DATA_ENTRY_OFFICER';
    if (roleCat === 'SUPER_ADMIN') key = 'SUPER_ADMIN';
    else if (roleCat === 'ADMINISTRATOR') key = 'ADMIN';
    else if (roleCat === 'SMART_CARD_DISTRIBUTOR') key = 'SMART_CARD_DISTRIBUTOR';
    setModalActivePreset(key);
  };

  // Save Permissions Modal
  const handleSaveModalPermissions = async () => {
    if (!permissionModalUser) return;
    try {
      setSavingPermissions(true);
      await api.updateUserPermissions(permissionModalUser.id, modalPermissions);
      setUsersList((prev) =>
        prev.map((u) => (u.id === permissionModalUser.id ? { ...u, permissions: modalPermissions } : u))
      );
      if (user && (user.id === permissionModalUser.id || user.id.toLowerCase() === permissionModalUser.id.toLowerCase())) {
        updateUser({ ...user, permissions: modalPermissions });
      }
      const savedUser = permissionModalUser;
      setPermissionModalUser(null);
      setStatusMessage({
        type: 'success',
        text: `Permissions updated for ${savedUser.name}`,
        title: 'Staff Permissions Updated Successfully',
        actionType: 'PERMISSIONS_UPDATED',
        targetName: savedUser.name,
        targetId: savedUser.id,
        targetRole: savedUser.role,
        details: `The operational permissions and system security privileges for staff member "${savedUser.name}" (${savedUser.id}) have been successfully updated and applied in the PLSMS official records.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save permissions' });
    } finally {
      setSavingPermissions(false);
    }
  };

  // Reset Password Handler
  const handleExecuteResetPassword = async () => {
    if (!resetModalUser) return;
    const resetValidation = validatePasswordStrength(resetNewPassword);
    if (!resetValidation.isValid) {
      setStatusMessage({ type: 'error', text: resetValidation.message });
      return;
    }

    try {
      setResettingPassword(true);
      await api.resetUserPassword(resetModalUser.id, resetNewPassword);
      const targetReset = resetModalUser;
      setResetModalUser(null);
      setStatusMessage({
        type: 'success',
        text: `Password for ${targetReset.name} was successfully reset to "${resetNewPassword}". The user will be required to change it on their next login.`,
        title: 'Password Reset Completed',
        actionType: 'PASSWORD_RESET',
        targetName: targetReset.name,
        targetId: targetReset.id,
        targetRole: targetReset.role,
        details: `The temporary password for ${targetReset.name} has been securely configured. The user will be prompted to set their personal confidential password upon next login.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to reset password' });
    } finally {
      setResettingPassword(false);
    }
  };

  // Auto Reset to Default Password Handler (Yellow for Super Admin, Blue for others)
  const handleExecuteAutoResetDefaultPassword = async () => {
    if (!resetModalUser) return;
    try {
      setResettingPassword(true);
      const isSuper = getUserRoleCategory(resetModalUser) === 'SUPER_ADMIN';
      const expectedDefault = isSuper ? 'Itahari@PLSMS' : 'Itahari@2026';
      const res = await api.resetUserDefaultPassword(resetModalUser.id);
      const defaultPwd = res.defaultPassword || expectedDefault;
      const targetReset = resetModalUser;
      setResetModalUser(null);
      setStatusMessage({
        type: 'success',
        text: `Password for ${targetReset.name} was automatically reset to official default "${defaultPwd}". The user must change it upon their next login.`,
        title: 'Default Password Restored',
        actionType: 'PASSWORD_DEFAULT_RESTORED',
        targetName: targetReset.name,
        targetId: targetReset.id,
        targetRole: targetReset.role,
        details: `Password for ${targetReset.name} was automatically reset to the official government default "${defaultPwd}". The user must configure a confidential password upon next login.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to reset password to default' });
    } finally {
      setResettingPassword(false);
    }
  };

  // Staff Self-Password Change Handler
  const handleSelfPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSelfPasswordError('');
    setSelfPasswordSuccess('');

    if (!selfNewPassword) {
      setSelfPasswordError('Please enter a new password.');
      return;
    }

    const validation = validatePasswordStrength(selfNewPassword);
    if (!validation.isValid) {
      setSelfPasswordError(validation.message);
      return;
    }

    if (selfNewPassword !== selfConfirmPassword) {
      setSelfPasswordError('New passwords do not match. Please re-enter them identically.');
      return;
    }

    try {
      setSelfChangingPassword(true);
      const res = await api.changePassword({
        currentPassword: selfCurrentPassword,
        newPassword: selfNewPassword,
      });
      setSelfPasswordSuccess(res.message || 'Your password was updated successfully!');
      setTimeout(() => {
        setSelfPasswordModalOpen(false);
        setSelfCurrentPassword('');
        setSelfNewPassword('');
        setSelfConfirmPassword('');
        setSelfPasswordSuccess('');
      }, 1500);
    } catch (err: any) {
      setSelfPasswordError(err.message || 'Failed to update password');
    } finally {
      setSelfChangingPassword(false);
    }
  };

  // Revoke User Handler
  const handleExecuteRevokeUser = async () => {
    if (!revokeModalUser) return;
    try {
      setRevokingUser(true);
      await api.deleteUser(revokeModalUser.id);
      setUsersList((prev) => prev.filter((u) => u.id !== revokeModalUser.id));
      const targetRevoke = revokeModalUser;
      setRevokeModalUser(null);
      setStatusMessage({
        type: 'success',
        text: `User account ${targetRevoke.name} has been revoked.`,
        title: 'Staff Account Revoked',
        actionType: 'USER_REVOKED',
        targetName: targetRevoke.name,
        targetId: targetRevoke.id,
        targetRole: targetRevoke.role,
        details: `The user account for ${targetRevoke.name} (${targetRevoke.id}) has been permanently revoked and removed from active service in the PLSMS directory.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to revoke user account' });
    } finally {
      setRevokingUser(false);
    }
  };

  // Live Database Stats Fetcher
  const fetchDbStats = async () => {
    try {
      setLoadingDbStats(true);
      const [statsRes, importsRes, distRes, auditRes] = await Promise.all([
        api.getDashboardStats().catch(() => null),
        api.getImports().catch(() => null),
        api.getDistributions().catch(() => null),
        api.getAuditLogs().catch(() => null),
      ]);
      setLiveDbStats({
        totalRecords: statsRes?.totalRecords || 0,
        totalImports: importsRes?.imports?.length ?? importsRes?.total ?? 0,
        totalDistributions: distRes?.distributions?.length ?? distRes?.total ?? 0,
        totalAuditLogs: auditRes?.logs?.length ?? auditRes?.total ?? 0,
      });
    } catch (err) {
      console.error('Error fetching live db stats:', err);
    } finally {
      setLoadingDbStats(false);
    }
  };

  // Execute Production Database Reset
  const handleExecuteProductionReset = async () => {
    setProductionResetError('');
    setProductionResetResult(null);

    if (resetProdConfirmText.trim() !== 'RESET PLSMS PRODUCTION DATA') {
      setProductionResetError('Exact phrase mismatch. You must type exactly: RESET PLSMS PRODUCTION DATA');
      return;
    }

    if (!resetProdPassword) {
      setProductionResetError('Super Administrator password is required for identity verification.');
      return;
    }

    if (!resetProdAcknowledged) {
      setProductionResetError('Please confirm the irreversible acknowledgment checkbox.');
      return;
    }

    try {
      setResettingProductionData(true);
      const res = await api.resetProductionDatabase({
        password: resetProdPassword,
        confirmationText: resetProdConfirmText.trim(),
        identifier: resetProdIdentifier.trim(),
      });

      setProductionResetResult(res);
      setShowResetSuccessModal(true);
      setStatusMessage({
        type: 'success',
        text: '✓ PRODUCTION DATA RESET SUCCESSFULLY — SYSTEM IS READY FOR FRESH GOOGLE SHEET IMPORT.',
      });
      setShowFinalSafetyModal(false);
      setResetProdPassword('');
      setIsResetPasswordValid(null);
      setResetProdConfirmText('');
      setResetProdAcknowledged(false);
      setLiveDbStats({ totalRecords: 0, totalImports: 0, totalDistributions: 0, totalAuditLogs: 0 });

      // Signal all views (Reports, Dashboard, Records) to immediately refresh to 0
      window.dispatchEvent(new CustomEvent('database-reset'));
      window.dispatchEvent(new CustomEvent('records-updated'));
    } catch (err: any) {
      setProductionResetError(err.message || 'Failed to reset production data.');
      setShowFinalSafetyModal(false);
    } finally {
      setResettingProductionData(false);
    }
  };

  // Official Multi-Location System Backup Generator
  const handleExportSystemBackup = async (overrideLocationCode?: string) => {
    try {
      setCreatingBackup(true);
      setBackupSuccess('');
      setBackupError('');
      setDownloadedBackupInfo(null);

      const targetLocCode = overrideLocationCode || selectedBackupLocationCode;
      const matchedLoc = backupLocations.find((l) => l.code === targetLocCode);
      const locDisplayName =
        targetLocCode === 'CUSTOM_OFFICE' && customOfficeName
          ? customOfficeName
          : matchedLoc?.nameEn || targetLocCode;

      const result = await api.downloadBackupArchive({
        locationCode: targetLocCode,
        scope: backupScope,
        customOfficeName: targetLocCode === 'CUSTOM_OFFICE' ? customOfficeName : undefined,
        customLocationName: targetLocCode === 'CUSTOM_OFFICE' ? customLocationName : undefined,
      });

      const nowTime = new Date().toLocaleTimeString();
      setDownloadedBackupInfo({
        filename: result.filename,
        sizeBytes: result.sizeBytes,
        locationName: locDisplayName,
        locationCode: targetLocCode,
        scope: backupScope,
        timestamp: nowTime,
      });

      setBackupSuccess(
        `Verified official cryptographic backup file generated and downloaded successfully for ${locDisplayName} (${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB).`
      );
    } catch (err: any) {
      console.error('System backup export error:', err);
      setBackupError(err.message || 'Failed to generate official system backup file.');
    } finally {
      setCreatingBackup(false);
    }
  };

  // Instant Full Backup Generator (backward compatibility)
  const handleCreateInstantBackup = () => handleExportSystemBackup();

  // Modular Reset Production Data Container (Rendered at end of Upload Center & as dedicated view)
  const renderResetProductionDataSection = () => (
    <div
      id="reset-production-data-container"
      className="bg-white dark:bg-[#070F1E] border-2 border-rose-300 dark:border-rose-900/70 rounded-3xl p-6 sm:p-8 shadow-md dark:shadow-2xl space-y-7 transition-colors"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-[#1E1222]">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950 border border-rose-300 dark:border-rose-600/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 shadow-sm dark:shadow-[0_0_20px_rgba(244,63,94,0.3)]">
            <Flame className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                RESET PRODUCTION DATA (Super Admin)
              </h2>
              <span className="px-2.5 py-0.5 bg-rose-100 dark:bg-rose-950 border border-rose-300 dark:border-rose-600 text-rose-800 dark:text-rose-300 text-[10px] font-mono font-black rounded-full uppercase tracking-wider animate-pulse">
                HIGH RISK • PERMANENT
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 font-medium max-w-3xl leading-relaxed">
              Permanently erase all imported license records, temporary dataset caches, upload histories, and distribution logs so you can connect and sync a fresh official Google Sheet for production.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => handleExportSystemBackup()}
            disabled={creatingBackup}
            className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 dark:border-amber-500/50 text-xs font-mono font-bold dark:text-amber-300 flex items-center gap-2 cursor-pointer transition-all active:scale-95 shadow-xs"
            title="Download full JSON backup of active database before resetting"
          >
            {creatingBackup ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600 dark:text-amber-400" />
            ) : (
              <Database className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            )}
            <span>{creatingBackup ? 'EXPORTING BACKUP...' : 'TAKE PRE-RECOVERY BACKUP'}</span>
          </button>

          <button
            type="button"
            onClick={fetchDbStats}
            disabled={loadingDbStats}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#0C1A30] dark:hover:bg-[#122442] border border-slate-300 dark:border-[#1E375F] text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2 transition-all shadow-sm cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingDbStats ? 'animate-spin' : ''}`} />
            <span>Refresh Stats</span>
          </button>
        </div>
      </div>

      {/* Success Banner */}
      {productionResetResult && (
        <div className="bg-emerald-50 dark:bg-emerald-950/90 border-2 border-emerald-500 text-emerald-900 dark:text-emerald-100 p-5 rounded-2xl shadow-sm dark:shadow-[0_0_25px_rgba(16,185,129,0.35)] space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <h3 className="text-sm font-black font-mono tracking-wide text-emerald-800 dark:text-emerald-300">
                {productionResetResult.message || '✓ PRODUCTION DATA RESET SUCCESSFULLY — SYSTEM IS READY FOR FRESH GOOGLE SHEET IMPORT.'}
              </h3>
            </div>
            <button
              type="button"
              id="btn-open-center-view-notice"
              onClick={() => setShowResetSuccessModal(true)}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all shrink-0 self-start sm:self-auto"
              title="Focus and view this notice in the center of the screen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Center View Mode</span>
            </button>
          </div>
          <div className="text-xs text-emerald-800 dark:text-emerald-200/90 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-emerald-200 dark:border-emerald-800/60 font-mono">
            <div className="p-2.5 bg-emerald-100/60 dark:bg-emerald-900/40 rounded-xl border border-emerald-300 dark:border-emerald-700/50">
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase font-semibold">Purged License Records</div>
              <div className="text-base font-black text-emerald-950 dark:text-white">{productionResetResult.details?.clearedRecords ?? 0} records</div>
            </div>
            <div className="p-2.5 bg-emerald-100/60 dark:bg-emerald-900/40 rounded-xl border border-emerald-300 dark:border-emerald-700/50">
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase font-semibold">Purged Import Jobs</div>
              <div className="text-base font-black text-emerald-950 dark:text-white">{productionResetResult.details?.clearedImports ?? 0} batches</div>
            </div>
            <div className="p-2.5 bg-emerald-100/60 dark:bg-emerald-900/40 rounded-xl border border-emerald-300 dark:border-emerald-700/50">
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase font-semibold">Purged Distributions</div>
              <div className="text-base font-black text-emerald-950 dark:text-white">{productionResetResult.details?.clearedDistributions ?? 0} records</div>
            </div>
            <div className="p-2.5 bg-emerald-100/60 dark:bg-emerald-900/40 rounded-xl border border-emerald-300 dark:border-emerald-700/50">
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase font-semibold">Purged Audit Logs</div>
              <div className="text-base font-black text-emerald-950 dark:text-white">{productionResetResult.details?.clearedAuditLogs ?? 0} events</div>
            </div>
          </div>
          <div className="pt-2 flex flex-wrap items-center gap-4 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
            <div className="flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Production data cleared.</span>
            </div>
            <button
              type="button"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="font-bold underline text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-white cursor-pointer"
            >
              Scroll up to Google Sheets Sync / Upload tools ↑
            </button>
            <button
              type="button"
              onClick={() => setShowResetSuccessModal(true)}
              className="font-bold underline text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-white cursor-pointer flex items-center gap-1"
            >
              <span>View in Center of Screen ⛶</span>
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {productionResetError && (
        <div className="bg-rose-50 dark:bg-rose-950/90 border border-rose-300 dark:border-rose-500 text-rose-800 dark:text-rose-200 p-4 rounded-2xl text-xs font-semibold flex items-center gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
          <span>{productionResetError}</span>
        </div>
      )}

      {/* Current Live Database State Matrix */}
      <div className="space-y-3">
        <h3 className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase font-mono tracking-wider flex items-center gap-2">
          <Database className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          CURRENT DATABASE STATUS (TARGETED FOR PERMANENT PURGE)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-50 dark:bg-[#081326] border border-slate-200 dark:border-[#162A4A] p-4 rounded-2xl space-y-1">
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase font-semibold">Active License Records</div>
            <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {liveDbStats.totalRecords.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-500 font-mono">
              {liveDbStats.totalRecords === 0 ? 'Clean slate (0 records)' : 'Will be permanently deleted'}
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-[#081326] border border-slate-200 dark:border-[#162A4A] p-4 rounded-2xl space-y-1">
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase font-semibold">Import History Batches</div>
            <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {liveDbStats.totalImports.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-500 font-mono">
              {liveDbStats.totalImports === 0 ? 'Clean slate (0 batches)' : 'Will be permanently purged'}
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-[#081326] border border-slate-200 dark:border-[#162A4A] p-4 rounded-2xl space-y-1">
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase font-semibold">Handover Distributions</div>
            <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {liveDbStats.totalDistributions.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-500 font-mono">
              {liveDbStats.totalDistributions === 0 ? 'Clean slate (0 logs)' : 'Will be permanently cleared'}
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-[#081326] border border-slate-200 dark:border-[#162A4A] p-4 rounded-2xl space-y-1">
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase font-semibold">Security Audit Logs</div>
            <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {liveDbStats.totalAuditLogs.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-500 font-mono">
              {liveDbStats.totalAuditLogs === 0 ? 'Clean slate (0 logs)' : 'Will be permanently purged'}
            </div>
          </div>
        </div>
      </div>

      {/* Scope Comparison: What is Purged vs What is Preserved */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* What is Permanently Purged */}
        <div className="bg-rose-50 dark:bg-[#120810] border border-rose-200 dark:border-rose-900/50 rounded-2xl p-5 space-y-3.5">
          <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-bold font-mono text-xs uppercase tracking-wide">
            <Trash2 className="w-4 h-4" />
            <span>PERMANENTLY PURGED ON RESET</span>
          </div>
          <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-2 font-mono list-disc pl-4 leading-relaxed">
            <li>All imported license & smart card ledger records in database.</li>
            <li>All Import History batches, uploaded lot files, and batch processing records.</li>
            <li>All Audit logs, security access ledgers, and user activity records.</li>
            <li>All Report Center records & sheet-wise/topic-wise generated reports.</li>
            <li>All 8 report categories (Total Smart Cards, Distributed, Not-Distributed, Missing, Found, Request to Receive, Upload History, Aggregate Sheet-Wise) reset cleanly to 0.</li>
            <li>All temporary JSON datasets, search indexes, and memory caches.</li>
            <li>All previously synchronized Google Sheet rows and batch metrics.</li>
            <li>All uploaded Excel/CSV files in storage directories.</li>
            <li>All handover distribution records, dispatch logs, and action overrides.</li>
          </ul>
        </div>

        {/* What is Safely Preserved */}
        <div className="bg-emerald-50 dark:bg-[#071524] border border-emerald-200 dark:border-emerald-900/50 rounded-2xl p-5 space-y-3.5">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold font-mono text-xs uppercase tracking-wide">
            <ShieldCheck className="w-4 h-4" />
            <span>SAFELY PRESERVED (NOT MODIFIED)</span>
          </div>
          <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-2 font-mono list-disc pl-4 leading-relaxed">
            <li>Super Administrator account credentials & master authentication.</li>
            <li>Registered staff user accounts and role permissions matrix.</li>
            <li>Google Sheet connection parameters & Service Account credentials.</li>
            <li>The actual remote Google Sheet document (remains untouched).</li>
            <li>System branding, premises configuration & security settings.</li>
            <li>Public portal visitor counter & citizen license search metrics (strictly preserved and continues to increment).</li>
          </ul>
        </div>
      </div>

      {/* Security Verification & Execution Form */}
      {isCurrentUserSuperAdmin ? (
        <div className="bg-slate-50 dark:bg-[#0B1526] border-2 border-rose-200 dark:border-rose-900/70 rounded-3xl p-6 sm:p-7 space-y-6 shadow-sm dark:shadow-2xl">
          <div className="flex items-center gap-2.5 text-rose-700 dark:text-rose-400 font-mono font-bold text-sm uppercase tracking-wide border-b border-rose-200 dark:border-rose-950 pb-3">
            <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-500" />
            <span>SUPER ADMIN TWO-STEP IDENTITY & PHRASE VERIFICATION</span>
          </div>

          <div className="space-y-5">
            {/* Step 1: Enter Email/USER ID (Super Admin) */}
            <div>
              <label className="block text-xs font-mono font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-slate-500" />
                <span>1. SUPER ADMIN USERNAME OR EMAIL *</span>
              </label>
              <div className="relative max-w-md">
                <input
                  type="text"
                  value={resetProdIdentifier}
                  onChange={(e) => setResetProdIdentifier(e.target.value.toUpperCase())}
                  placeholder="e.g. admin@plsms.gov.np or User ID"
                  className="w-full px-4 py-3 bg-white dark:bg-[#060D1A] border border-slate-300 dark:border-[#1E375F] rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-all uppercase"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Enter authorized Super Admin User ID or registered email address.
              </p>
            </div>

            {/* Step 2: Re-authenticate Super Admin Password with Matched/Not Matched Logic */}
            <div>
              <div className="flex items-center justify-between max-w-md mb-1.5">
                <label className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                  <span>2. CONFIDENTIAL PASSWORD — RE-AUTHENTICATE SUPER ADMIN ({user?.name || 'SUPER ADMIN'}) *</span>
                </label>
                {resetProdPassword.length > 0 && (
                  isResetPasswordValid === true ? (
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono uppercase">
                      ✓ VERIFIED MATCH
                    </span>
                  ) : isResetPasswordValid === false ? (
                    <span className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1 font-mono uppercase">
                      ✕ PASSWORD MISMATCH
                    </span>
                  ) : null
                )}
              </div>
              <div className="relative max-w-md">
                <input
                  type={showResetProdPassword ? 'text' : 'password'}
                  value={resetProdPassword}
                  onChange={(e) => setResetProdPassword(e.target.value)}
                  placeholder="Enter Super Admin confidential password"
                  className={`w-full px-4 py-3 bg-white dark:bg-[#060D1A] border rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none transition-all pr-10 ${
                    resetProdPassword.length > 0 && isResetPasswordValid === true
                      ? 'border-emerald-500 ring-1 ring-emerald-500'
                      : resetProdPassword.length > 0 && isResetPasswordValid === false
                      ? 'border-rose-500 ring-1 ring-rose-500'
                      : 'border-slate-300 dark:border-[#1E375F] focus:border-rose-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowResetProdPassword(!showResetProdPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  title={showResetProdPassword ? 'Hide password' : 'Show password'}
                >
                  {showResetProdPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Live Status Messages */}
              {resetProdPassword.length > 0 && isResetPasswordValid === false && (
                <div className="flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400 mt-1.5 font-mono uppercase">
                  <Lock className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span>PASSWORD OR USERNAME MISMATCH — ACTION BUTTON IS LOCKED</span>
                </div>
              )}
              {resetProdPassword.length > 0 && isResetPasswordValid === true && (
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1.5 font-mono uppercase">
                  <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>SUPER ADMIN CREDENTIALS VERIFIED — ACTION UNLOCKED</span>
                </div>
              )}

              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Required to verify your authorized identity before modifying core storage.
              </p>
            </div>

            {/* Step 3: Exact Phrase Confirmation */}
            <div>
              <label className="block text-xs font-mono font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                3. TYPE CONFIRMATION PHRASE EXACTLY: <span className="text-rose-600 dark:text-rose-400 font-mono font-black select-all">RESET PLSMS PRODUCTION DATA</span> *
              </label>
              <div className="relative max-w-md">
                <input
                  type="text"
                  value={resetProdConfirmText}
                  onChange={(e) => setResetProdConfirmText(e.target.value)}
                  placeholder="RESET PLSMS PRODUCTION DATA"
                  className={`w-full px-4 py-3 bg-white dark:bg-[#060D1A] border rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none transition-all pr-10 ${
                    resetProdConfirmText.trim() === 'RESET PLSMS PRODUCTION DATA'
                      ? 'border-emerald-500 ring-1 ring-emerald-500'
                      : 'border-slate-300 dark:border-[#1E375F] focus:border-rose-500'
                  }`}
                />
                {resetProdConfirmText.trim() === 'RESET PLSMS PRODUCTION DATA' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400 absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Confirmation phrase is case-sensitive to ensure deliberate human authorization.
              </p>
            </div>

            {/* Step 4: Irreversible Acknowledgment Checkbox */}
            <div className="pt-2">
              <label className="flex items-start gap-3 cursor-pointer bg-white dark:bg-[#070E1C] p-4 rounded-xl border border-rose-200 dark:border-rose-950 hover:border-rose-300 dark:hover:border-rose-900/80 transition-all shadow-sm">
                <input
                  type="checkbox"
                  checked={resetProdAcknowledged}
                  onChange={(e) => setResetProdAcknowledged(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-rose-600 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 rounded focus:ring-rose-500 cursor-pointer"
                />
                <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-mono">
                  <strong className="text-rose-700 dark:text-rose-300">I acknowledge this action is PERMANENT and IRREVERSIBLE.</strong>{' '}
                  All license records, report datasets, and transaction histories will be completely purged from the application database.
                </div>
              </label>
            </div>

            {/* Action Button: Disable / Enable based on password matched and confirmation phrase */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-4">
              {isResetPasswordValid !== true ? (
                <button
                  type="button"
                  disabled
                  className="px-6 py-3.5 bg-[#F1F5F9] dark:bg-[#1E293B] text-[#94A3B8] dark:text-[#64748B] border border-[#E2E8F0] dark:border-[#334155] font-mono font-bold text-xs uppercase tracking-wider rounded-xl cursor-not-allowed select-none flex items-center justify-center gap-2.5"
                >
                  <Lock className="w-4 h-4 text-[#94A3B8] dark:text-[#64748B]" />
                  <span>AUTHENTICATION REQUIRED (BUTTON LOCKED)</span>
                </button>
              ) : resetProdConfirmText.trim() !== 'RESET PLSMS PRODUCTION DATA' || !resetProdAcknowledged ? (
                <button
                  type="button"
                  disabled
                  className="px-6 py-3.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/60 font-mono font-bold text-xs uppercase tracking-wider rounded-xl cursor-not-allowed select-none flex items-center justify-center gap-2.5"
                >
                  <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span>CREDENTIALS VERIFIED — CONFIRMATION PHRASE & ACKNOWLEDGMENT REQUIRED</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowFinalSafetyModal(true)}
                  disabled={resettingProductionData}
                  className="px-6 py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-mono font-black text-xs uppercase tracking-wider rounded-xl shadow-md dark:shadow-[0_0_20px_rgba(244,63,94,0.4)] transition-all flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  <Unlock className="w-4 h-4" />
                  <span>CONFIRM & EXECUTE PRODUCTION RESET</span>
                </button>
              )}

              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Super Admin authorization token will be validated server-side.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-600/40 text-amber-800 dark:text-amber-300 text-xs font-mono flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
          <span>
            <strong>Super Administrator Privilege Required:</strong> Only the Master Super Administrator can purge production records. (Logged in as {user?.role || 'Staff'})
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto text-slate-900 dark:text-slate-100 font-sans pb-12 transition-colors duration-200">
      {/* Top Header & Navigation Bar (Picture 2 Top Bar) */}
      <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162846] rounded-2xl p-5 sm:p-6 shadow-sm dark:shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5 font-mono">
            Super User Premises & Settings Console
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 font-normal">
            Administer virtual premises metadata, configure system access levels, or initiate secure backups.
          </p>
        </div>

        {/* Top Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            id="tab-users-roles"
            onClick={() => handleTabClick('USERS_ROLES')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer uppercase tracking-wider ${
              activeTab === 'USERS_ROLES'
                ? 'bg-sky-50 dark:bg-[#0E2A47] border-sky-300 dark:border-[#38BDF8] text-sky-700 dark:text-[#38BDF8] shadow-xs ring-1 ring-sky-400/30'
                : 'bg-white hover:bg-slate-50 dark:bg-[#0B172B] dark:hover:bg-[#112240] border-slate-200 dark:border-[#1C335A] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-500 shadow-xs'
            }`}
          >
            <Users className="w-4 h-4 text-sky-600 dark:text-[#38BDF8]" />
            <span>USERS & ROLES</span>
          </button>

          <button
            type="button"
            id="tab-upload-center"
            onClick={() => handleTabClick('UPLOAD_CENTER')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer uppercase tracking-wider ${
              activeTab === 'UPLOAD_CENTER'
                ? 'bg-indigo-50 dark:bg-[#1E1138] border-indigo-300 dark:border-[#A855F7] text-indigo-700 dark:text-[#E9D5FF] shadow-xs ring-1 ring-indigo-400/30'
                : 'bg-white hover:bg-slate-50 dark:bg-[#0B172B] dark:hover:bg-[#112240] border-slate-200 dark:border-[#1C335A] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-500 shadow-xs'
            }`}
          >
            <UploadCloud className={`w-4 h-4 ${activeTab === 'UPLOAD_CENTER' ? 'text-indigo-600 dark:text-[#C084FC]' : 'text-slate-400 dark:text-purple-400'}`} />
            <span>UPLOAD CENTER</span>
          </button>

          <button
            type="button"
            id="tab-backups"
            onClick={() => handleTabClick('BACKUPS')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer uppercase tracking-wider ${
              activeTab === 'BACKUPS'
                ? 'bg-amber-50 dark:bg-amber-950/80 border-amber-300 dark:border-amber-500 text-amber-800 dark:text-amber-300 shadow-xs ring-1 ring-amber-400/30'
                : 'bg-white hover:bg-slate-50 dark:bg-[#0B172B] dark:hover:bg-[#112240] border-slate-200 dark:border-[#1C335A] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-500 shadow-xs'
            }`}
          >
            <Database className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            <span>BACKUPS</span>
          </button>
        </div>
      </div>


      {/* Floating Informative Action Notification Modal (Wide Rectangle, Meaningful Icons & Understandable Sentences) */}
      <ActionNotificationModal
        notification={statusMessage}
        onClose={() => setStatusMessage(null)}
      />

      {/* TAB 1: USERS & ROLES (The Exact Layout in Picture 2) */}
      {activeTab === 'USERS_ROLES' && (
        <div className="space-y-8">
          {/* SECTION 1: ASSIGN USER CREDENTIALS, ROLLS & PERMISSIONS (Super Admin / User Manager) */}
          {(isCurrentUserSuperAdmin || canManageUsers) && (
            <form onSubmit={handleCreateUser} className="space-y-6">
              {/* CONTAINER 1: ASSIGN USER CREDENTIALS, ROLLS & PERMISSIONS (Standalone Separate Container) */}
              <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162846] rounded-2xl p-5 sm:p-7 shadow-md dark:shadow-2xl space-y-6 transition-colors">
                <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white uppercase tracking-wider font-mono flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-sky-600 dark:text-[#38BDF8]" />
                  ASSIGN USER CREDENTIALS, ROLLS & PERMISSIONS
                </h2>

                {/* Row 1 & 2: Input Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
                {/* 1. Staff Full Name */}
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono">
                    STAFF FULL NAME <span className="text-rose-500 dark:text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={staffName}
                    onChange={(e) => handleStaffNameChange(e.target.value.toUpperCase())}
                    placeholder="eg. KOMAL DAHAL"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs sm:text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-sky-500 dark:focus:border-[#38BDF8] focus:ring-1 focus:ring-sky-500 dark:focus:ring-[#38BDF8] transition-all uppercase"
                  />
                  {matchingUserWithSameName && (
                    <div className="mt-1.5 p-2 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-500/50 rounded-lg text-indigo-900 dark:text-indigo-200 text-[11px] flex items-center gap-1.5 animate-fadeIn">
                      <Info className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                      <span>
                        Note: Staff member <strong>{matchingUserWithSameName.name}</strong> is already registered ({matchingUserWithSameName.id}).
                      </span>
                    </div>
                  )}
                </div>

                {/* 2. User ID (with Auto Generate & Duplicate Detection Prompt) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono">
                      USER ID <span className="text-rose-500 dark:text-rose-400">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleAutoGenerateUserId}
                      className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 flex items-center gap-1 hover:underline focus:outline-none"
                    >
                      <Sparkles className="w-3 h-3 text-amber-500 dark:text-amber-400" />
                      Auto Generate
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={userId}
                    onChange={(e) => handleUserIdChange(e.target.value.toUpperCase())}
                    placeholder="eg. KDAHAL_PLSMS"
                    className={`w-full px-3.5 py-2.5 bg-white dark:bg-[#081326] border rounded-xl text-xs sm:text-sm font-mono font-medium text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none transition-all uppercase ${
                      matchingUserWithSameId
                        ? 'border-amber-500 ring-1 ring-amber-500/50 bg-amber-50 dark:bg-amber-950/20'
                        : 'border-slate-300 dark:border-[#1A3158] focus:border-sky-500 dark:focus:border-[#38BDF8] focus:ring-1 focus:ring-sky-500 dark:focus:ring-[#38BDF8]'
                    }`}
                  />
                  
                  {/* Matching User ID Detected Prompt */}
                  {matchingUserWithSameId && (
                    <div className="mt-2 p-2.5 bg-gradient-to-r from-amber-50 to-rose-50 dark:from-amber-950/90 dark:to-rose-950/80 border border-amber-300 dark:border-amber-500/80 rounded-xl text-amber-900 dark:text-amber-200 text-xs space-y-1.5 shadow-sm dark:shadow-[0_0_15px_rgba(245,158,11,0.25)] animate-fadeIn">
                      <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300 font-mono text-[11px]">
                        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>MATCHING USER ID DETECTED</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-100/90 font-sans">
                        User ID <code className="font-mono font-bold text-slate-900 dark:text-white bg-amber-100 dark:bg-black/50 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-500/40">{userId}</code> is already in use by{' '}
                        <strong className="text-slate-900 dark:text-white">{matchingUserWithSameId.name}</strong> ({matchingUserWithSameId.post || matchingUserWithSameId.role}).
                      </p>
                      <div className="text-[10px] text-amber-800 dark:text-amber-300/90 flex flex-wrap items-center gap-1.5 pt-0.5 border-t border-amber-200 dark:border-amber-500/30">
                        <span>Quick unique suggestion:</span>
                        <button
                          type="button"
                          onClick={() => {
                            const upperId = userId.toUpperCase();
                            const newId = upperId.includes('_PLSMS')
                              ? upperId.replace('_PLSMS', '2_PLSMS')
                              : `${upperId}2`;
                            setUserId(newId);
                            setIsUserIdManualEdit(true);
                          }}
                          className="px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/80 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-100 font-mono font-bold border border-amber-300 dark:border-amber-400 text-[10px] transition-all"
                        >
                          {userId.toUpperCase().includes('_PLSMS')
                            ? userId.toUpperCase().replace('_PLSMS', '2_PLSMS')
                            : `${userId}2`}
                        </button>
                        <span className="text-slate-600 dark:text-slate-300">or type any custom ID.</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Mobile Number */}
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono">
                    MOBILE NUMBER
                  </label>
                  <input
                    type="text"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    placeholder="eg. 9842033214"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs sm:text-sm font-mono font-medium text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-sky-500 dark:focus:border-[#38BDF8] focus:ring-1 focus:ring-sky-500 dark:focus:ring-[#38BDF8] transition-all"
                  />
                </div>

                {/* 4. Email Address */}
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono">
                    EMAIL ADDRESS (OPTIONAL)
                  </label>
                  <input
                    type="email"
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value.toUpperCase())}
                    placeholder="e.g. officer@plsms.gov.np"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs sm:text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-sky-500 dark:focus:border-[#38BDF8] focus:ring-1 focus:ring-sky-500 dark:focus:ring-[#38BDF8] transition-all uppercase"
                  />
                </div>

                {/* 5. Designated Post */}
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono">
                    DESIGNATED POST <span className="text-rose-500 dark:text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={designatedPost}
                    onChange={(e) => setDesignatedPost(e.target.value)}
                    placeholder="eg. Computer Operator"
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs sm:text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-sky-500 dark:focus:border-[#38BDF8] focus:ring-1 focus:ring-sky-500 dark:focus:ring-[#38BDF8] transition-all"
                  />
                </div>

                {/* 6. System Operational Role */}
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono">
                    SYSTEM OPERATIONAL ROLE
                  </label>
                  <select
                    value={operationalRole}
                    onChange={(e) => {
                      setOperationalRole(e.target.value);
                      if (e.target.value.includes('Super Admin')) applyPreset('SUPER_ADMIN');
                      else if (e.target.value.includes('Administrator')) applyPreset('ADMIN');
                      else if (e.target.value.includes('Data Entry')) applyPreset('DATA_ENTRY_OFFICER');
                      else if (e.target.value.includes('Distribut')) applyPreset('SMART_CARD_DISTRIBUTOR');
                      else applyPreset('DATA_ENTRY_OFFICER');
                    }}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs sm:text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:border-sky-500 dark:focus:border-[#38BDF8] focus:ring-1 focus:ring-sky-500 dark:focus:ring-[#38BDF8] transition-all"
                  >
                    <option value="Super Admin (Full Access)">Super Admin (Full Access)</option>
                    <option value="Administrator (Office Manager)">Administrator (Office Manager)</option>
                    <option value="Data Entry Officer (System Operator)">Data Entry Officer (System Operator)</option>
                    <option value="Smart Card Distributer (Counter Operator)">Smart Card Distributer (Counter Operator)</option>
                  </select>
                </div>
              </div>

              {/* ACCESS PERMISSIONS CONTAINER (Picture 2: Placed directly below SYSTEM OPERATIONAL ROLE and directly above TEMPORARY PASSWORD) */}
              <div className="bg-slate-50 dark:bg-[#050B16] border border-slate-200 dark:border-[#14233C] rounded-xl p-4 sm:p-5 space-y-4 transition-colors">
                {/* Header Line */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 dark:border-[#14233C] pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${activeRoleTheme.dotClass}`} />
                      <h3 className={`text-xs sm:text-sm font-black uppercase tracking-wider font-mono ${activeRoleTheme.headerTitleClass}`}>
                        ACCESS PERMISSIONS (
                        <span className={selectedPermissions.length > 0 ? 'text-emerald-600 dark:text-emerald-400 font-black' : 'text-rose-600 dark:text-rose-400 font-black'}>
                          {selectedPermissions.length}
                        </span>
                        {' '}/ {TOTAL_PERMISSIONS_COUNT} GRANTED)
                      </h3>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Select granular feature access permissions for this user account or apply role presets.
                    </p>
                  </div>

                  {/* Presets & Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest font-mono mr-1">
                      PRESETS:
                    </span>
                    <button
                      type="button"
                      onClick={() => applyPreset('SUPER_ADMIN')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                        activePreset === 'SUPER_ADMIN'
                          ? 'bg-amber-100 dark:bg-amber-950/80 border-amber-400 dark:border-amber-500 text-amber-900 dark:text-amber-300 shadow-sm dark:shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                          : 'bg-white dark:bg-[#0A162B] border-slate-300 dark:border-[#1C335A] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      SUPER ADMIN
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('ADMIN')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                        activePreset === 'ADMIN'
                          ? 'bg-purple-100 dark:bg-purple-950/80 border-purple-400 dark:border-purple-500 text-purple-900 dark:text-purple-300 shadow-sm dark:shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                          : 'bg-white dark:bg-[#0A162B] border-slate-300 dark:border-[#1C335A] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      ADMINISTRATOR
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('DATA_ENTRY_OFFICER')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                        activePreset === 'DATA_ENTRY_OFFICER'
                          ? 'bg-sky-100 dark:bg-[#0E2A47] border-sky-400 dark:border-[#38BDF8] text-sky-900 dark:text-[#38BDF8] shadow-sm dark:shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                          : 'bg-white dark:bg-[#0A162B] border-slate-300 dark:border-[#1C335A] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      DATA ENTRY OFFICER
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('SMART_CARD_DISTRIBUTOR')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                        activePreset === 'SMART_CARD_DISTRIBUTOR'
                          ? 'bg-emerald-100 dark:bg-emerald-950/80 border-emerald-400 dark:border-emerald-500 text-emerald-900 dark:text-emerald-300 shadow-sm dark:shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                          : 'bg-white dark:bg-[#0A162B] border-slate-300 dark:border-[#1C335A] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      SMART CARD DISTRIBUTER
                    </button>

                    <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1 hidden sm:block" />

                    <button
                      type="button"
                      onClick={selectAllPermissions}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${activeRoleTheme.selectAllBtn}`}
                    >
                      ✓ Select All
                    </button>
                    <button
                      type="button"
                      onClick={clearAllPermissions}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold text-rose-700 dark:text-rose-400 bg-white dark:bg-transparent hover:bg-rose-50 dark:hover:bg-rose-950/50 border border-rose-300 dark:border-rose-500/40 transition-all"
                    >
                      ✕ Clear All
                    </button>
                    <button
                      type="button"
                      onClick={toggleExpandAll}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${activeRoleTheme.expandAllBtn}`}
                    >
                      {PERMISSION_GROUPS.some((g) => !expandedGroups[g.key]) ? '+ Expand All' : '- Collapse All'}
                    </button>
                  </div>
                </div>

                {/* Search Bar for Permissions */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={permissionSearch}
                    onChange={(e) => setPermissionSearch(e.target.value)}
                    placeholder="Search permissions (eg. excel, upload, delete, reset)..."
                    className={`w-full pl-9 pr-4 py-2 bg-white dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs font-medium text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none transition-all ${activeRoleTheme.searchFocusClass}`}
                  />
                </div>

                {/* 2-Column Accordion Groups Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredGroups.map((group) => {
                    const groupPermIds = group.permissions.map((p) => p.id);
                    const selectedCount = groupPermIds.filter((id) => selectedPermissions.includes(id)).length;
                    const totalInGroup = groupPermIds.length;
                    const isFullySelected = selectedCount === totalInGroup && totalInGroup > 0;
                    const isExpanded = !!expandedGroups[group.key] || !!permissionSearch;

                    return (
                      <div
                        key={group.key}
                        className={`bg-white dark:bg-[#081326] border border-slate-200 dark:border-[#162A4A] rounded-xl overflow-hidden shadow-sm transition-all ${activeRoleTheme.cardBorderHover}`}
                      >
                        {/* Group Header Row */}
                        <div className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-[#0C1B33] transition-colors">
                          <button
                            type="button"
                            onClick={() => toggleGroupExpand(group.key)}
                            className="flex items-center gap-2 flex-1 text-left focus:outline-none"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                            )}
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 tracking-wide font-mono">
                              {group.title}
                            </span>
                            {selectedCount === 0 ? (
                              <span
                                title={`0 Granted, ${totalInGroup} Not Granted (${totalInGroup} Total)`}
                                className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border transition-all bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/60 shadow-xs"
                              >
                                <span className="text-rose-600 dark:text-rose-400 font-bold">0</span>
                                <span className="text-rose-400/60 dark:text-rose-400/50 font-normal">/</span>
                                <span className="text-rose-600/80 dark:text-rose-400/80 font-bold">{totalInGroup}</span>
                              </span>
                            ) : isFullySelected ? (
                              <span
                                title={`All ${totalInGroup} Permissions Granted (${totalInGroup}/${totalInGroup})`}
                                className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border transition-all bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/60 shadow-xs"
                              >
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{selectedCount}</span>
                                <span className="text-emerald-500/60 dark:text-emerald-400/50 font-normal">/</span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{totalInGroup}</span>
                              </span>
                            ) : (
                              <span
                                title={`${selectedCount} Granted (Green), ${totalInGroup - selectedCount} Not Granted of ${totalInGroup} Total`}
                                className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border transition-all bg-slate-100 dark:bg-slate-800/90 border-slate-200 dark:border-slate-700/80 shadow-xs"
                              >
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{selectedCount}</span>
                                <span className="text-slate-400 dark:text-slate-500 font-normal">/</span>
                                <span className="text-yellow-600 dark:text-yellow-400 font-bold">{totalInGroup}</span>
                              </span>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleGroup(group.key)}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider font-mono border transition-all ${
                              isFullySelected
                                ? activeRoleTheme.groupBtnSelected
                                : activeRoleTheme.groupBtnUnselected
                            }`}
                          >
                            {isFullySelected ? 'DESELECT GROUP' : 'SELECT GROUP'}
                          </button>
                        </div>

                        {/* Expandable Group Checkboxes */}
                        {isExpanded && (
                          <div className="p-3 pt-1 border-t border-slate-200 dark:border-[#14233C] space-y-1.5 bg-slate-50/70 dark:bg-[#050C18]">
                            {group.permissions.map((perm) => {
                              const isChecked = selectedPermissions.includes(perm.id);
                              const isSuperAdminOnly = perm.id === 'dashboard.view' || perm.id === 'dashboard.tables';
                              const isTargetSuperAdmin =
                                activePreset === 'SUPER_ADMIN' ||
                                operationalRole.includes('Super Admin');
                              const isRestricted = isSuperAdminOnly && !isTargetSuperAdmin;

                              return (
                                <label
                                  key={perm.id}
                                  title={isRestricted ? 'This permission is strictly reserved for Super Administrators only' : undefined}
                                  className={`flex items-start gap-2.5 p-1.5 rounded-lg transition-colors ${
                                    isRestricted
                                      ? 'opacity-60 cursor-not-allowed text-slate-400 dark:text-slate-500'
                                      : isChecked
                                      ? activeRoleTheme.itemChecked
                                      : 'cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={isRestricted}
                                    onChange={() => !isRestricted && togglePermission(perm.id)}
                                    className={`mt-0.5 rounded border-slate-400 dark:border-slate-600 focus:ring-0 focus:outline-none bg-white dark:bg-slate-900 ${activeRoleTheme.checkboxClass} ${
                                      isRestricted ? 'cursor-not-allowed opacity-50' : ''
                                    }`}
                                  />
                                  <div className="text-xs">
                                    <div className="font-semibold text-slate-900 dark:text-slate-200 leading-tight flex items-center gap-1.5 flex-wrap">
                                      <span>{perm.name}</span>
                                      {isSuperAdminOnly && (
                                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-bold">
                                          SUPER ADMIN ONLY
                                        </span>
                                      )}
                                    </div>
                                    {perm.description && (
                                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                        {perm.description}
                                      </div>
                                    )}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* BOTTOM ACTION BAR AT BOTTOM OF ACCESS PERMISSIONS (Picture 1: SAVE PERMISSION AS SELECTED ABOVE) */}
                <div className="pt-4 mt-2 border-t border-slate-200 dark:border-[#14233C] flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-100/70 dark:bg-[#060D1A] p-3.5 sm:p-4 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-xl transition-colors ${
                        isPermissionsSaved
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
                          : 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-800'
                      }`}
                    >
                      {isPermissionsSaved ? (
                        <CheckCircle2 className="w-5 h-5 shrink-0" />
                      ) : (
                        <AlertCircle className="w-5 h-5 shrink-0" />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-bold font-mono uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        {isPermissionsSaved ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-black flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            PERMISSIONS ACCEPTED & SAVED ({selectedPermissions.length} / {TOTAL_PERMISSIONS_COUNT} GRANTED)
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 font-black flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            UNSAVED SELECTION ({selectedPermissions.length} / {TOTAL_PERMISSIONS_COUNT} SELECTED)
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {isPermissionsSaved
                          ? "Permissions are verified & locked. '+ CREATE USER ID' button is now enabled."
                          : "Click the button to accept & save permissions to unlock the '+ CREATE USER ID' button."}
                      </p>
                    </div>
                  </div>

                  {/* Picture 1 / Picture 2 Style Action Button */}
                  <button
                    type="button"
                    id="btn-save-permission-selected-above"
                    onClick={handleSavePermissions}
                    className={`px-7 py-2.5 rounded-full text-xs sm:text-sm font-bold tracking-wide transition-all shadow-md flex items-center justify-center gap-2 font-mono uppercase whitespace-nowrap active:scale-[0.98] ${
                      isPermissionsSaved
                        ? 'bg-[#059669] hover:bg-[#047857] text-white shadow-[0_0_18px_rgba(5,150,105,0.45)] ring-2 ring-emerald-400/40'
                        : 'bg-[#0284C7] hover:bg-[#0369A1] active:bg-[#075985] text-white shadow-[0_0_18px_rgba(2,132,199,0.5)] hover:shadow-[0_0_24px_rgba(2,132,199,0.75)]'
                    }`}
                  >
                    {isPermissionsSaved ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                    )}
                    <span>{isPermissionsSaved ? 'SAVED PERMISSIONS' : 'SAVE PERMISSION AS SELECTED ABOVE'}</span>
                  </button>
                </div>
              </div>

              {/* Password & Create User Row (Kept at the end of ASSIGN USER CREDENTIALS, ROLLS & PERMISSIONS card, right below ACCESS PERMISSIONS) */}
              <div className="bg-slate-50 dark:bg-[#050B16] border border-slate-200 dark:border-[#14233C] rounded-xl p-4 sm:p-5 space-y-3 transition-colors">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Password Input & Dice */}
                  <div className="flex-1 max-w-md">
                    <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono">
                      TEMPORARY PASSWORD <span className="text-rose-500 dark:text-rose-400">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          value={temporaryPassword}
                          onChange={(e) => setTemporaryPassword(e.target.value)}
                          placeholder="Itahari@2026"
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs sm:text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-sky-500 dark:focus:border-[#38BDF8]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleGenerateRandomPassword}
                        className="px-3 py-2.5 bg-white dark:bg-[#0B172B] hover:bg-slate-100 dark:hover:bg-[#122442] border border-slate-300 dark:border-[#1E3B66] rounded-xl text-xs font-bold text-sky-700 dark:text-[#38BDF8] flex items-center gap-1.5 shrink-0 transition-all font-mono shadow-sm"
                        title="Generate Random Secure Password"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                        RANDOM
                      </button>
                    </div>

                    {/* Password Strength Meter */}
                    <div className="mt-2">
                      <PasswordStrengthMeter
                        validation={validatePasswordStrength(temporaryPassword)}
                        password={temporaryPassword}
                      />
                    </div>
                  </div>

                  {/* Create User Button & Quick Presets */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 font-mono">Quick:</span>
                      <button
                        type="button"
                        onClick={() => setTemporaryPassword('Itahari@2026')}
                        className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-[#38BDF8] rounded-lg text-[10px] font-mono text-emerald-700 dark:text-emerald-400 shadow-sm"
                      >
                        Itahari@2026
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemporaryPassword('Itahari@PLSMS')}
                        className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-amber-500 dark:hover:border-[#38BDF8] rounded-lg text-[10px] font-mono text-amber-700 dark:text-amber-400 shadow-sm"
                      >
                        Itahari@PLSMS
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={creatingUser || !isPermissionsSaved}
                      className={`px-6 py-2.5 font-black rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 font-mono uppercase tracking-wider ${
                        !isPermissionsSaved
                          ? 'bg-slate-300 dark:bg-[#0c1626] text-slate-500 dark:text-slate-500 border border-slate-300 dark:border-[#1c335a] cursor-not-allowed opacity-60 shadow-none'
                          : 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 dark:bg-[#0284C7] dark:hover:bg-[#0369A1] dark:active:bg-[#075985] text-white shadow-md dark:shadow-[0_0_20px_rgba(2,132,199,0.5)] cursor-pointer'
                      }`}
                      title={
                        !isPermissionsSaved
                          ? "Please click 'SAVE PERMISSION AS SELECTED ABOVE' in the permissions section first"
                          : "Create User ID"
                      }
                    >
                      {creatingUser ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : !isPermissionsSaved ? (
                        <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                      ) : (
                        <UserPlus className="w-4 h-4" />
                      )}
                      <span>+ CREATE USER ID</span>
                    </button>
                  </div>
                </div>

                {!isPermissionsSaved ? (
                  <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-1.5 italic font-semibold">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>'+ CREATE USER ID' is locked. Please click "SAVE PERMISSION AS SELECTED ABOVE" above to verify and activate.</span>
                  </p>
                ) : (
                  <p className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>✓ Permissions accepted and saved ({selectedPermissions.length} granted). '+ CREATE USER ID' is now active.</span>
                  </p>
                )}

                <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                  Compulsory first login password change will be enforced for the operator.
                </p>
              </div>
            </div>
          </form>
        )}

        {/* SECTION 2: REGISTERED STAFF ACCOUNTS & PERMISSIONS MATRIX */}
        <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162846] rounded-2xl p-5 sm:p-7 shadow-sm dark:shadow-2xl space-y-5 transition-colors">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-[#14233C] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                  {isCurrentUserSuperAdmin
                    ? 'Registered Staff Accounts & Permissions Matrix'
                    : 'My Staff Account & Profile Details'}
                </h2>
                {isCurrentUserSuperAdmin ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-black font-mono bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-700">
                    {usersList.length} Accounts
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-black font-mono bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                    Active Login ID: {user?.id}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {isCurrentUserSuperAdmin
                  ? 'Manage all office staff, computer operators, and administrators authorized with Login IDs.'
                  : `Authorized account credentials and personal details for logged-in user (${user?.name || user?.id}).`}
              </p>
            </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchUsers}
                  disabled={loadingUsers}
                  className="px-3.5 py-2 bg-white dark:bg-[#0B172B] hover:bg-slate-100 dark:hover:bg-[#122442] border border-slate-300 dark:border-[#1E3B66] rounded-xl text-xs font-mono font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
                  <span>Refresh Matrix</span>
                </button>
              </div>
            </div>

            {/* CURRENT LOGGED-IN STAFF OPERATOR BANNER */}
            {user && (
              <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 via-teal-50 to-indigo-50 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-indigo-950/30 border border-emerald-300/80 dark:border-emerald-500/40 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-emerald-600 dark:bg-emerald-500 text-white flex items-center justify-center font-black text-base font-mono shadow-md shrink-0">
                    {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400 font-mono">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Current Logged-in Staff Member
                      </span>
                      {getUserRoleCategory(user) === 'SUPER_ADMIN' ? (
                        <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-amber-950/80 dark:bg-amber-950/90 border-[1.5px] border-amber-500 text-amber-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                          👑 SUPER ADMIN
                        </span>
                      ) : getUserRoleCategory(user) === 'ADMINISTRATOR' ? (
                        <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-purple-950/80 dark:bg-purple-950/90 border-[1.5px] border-purple-500 text-purple-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                          🛡️ ADMINISTRATOR
                        </span>
                      ) : getUserRoleCategory(user) === 'SMART_CARD_DISTRIBUTOR' ? (
                        <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-emerald-950/80 dark:bg-emerald-950/90 border-[1.5px] border-emerald-500 text-emerald-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                          🪪 SMART CARD DISTRIBUTER
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-cyan-950/80 dark:bg-cyan-950/90 border-[1.5px] border-cyan-500 text-cyan-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                          👤 DATA ENTRY OFFICER
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-mono border border-emerald-300 dark:border-emerald-800">
                        STATUS: ACTIVE
                      </span>
                    </div>

                    <div className="text-sm sm:text-base font-black text-slate-900 dark:text-white mt-1">
                      {user.name || 'DAHAL KOMAL'}
                      <span className="ml-2 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                        ID: {user.id || 'DKOMAL_PLSMS5'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 mt-1 font-medium">
                      <span><strong>Designation:</strong> {user.post || 'Computer Officer'}</span>
                      {user.phone && <span><strong>Mobile:</strong> {user.phone}</span>}
                      {user.email && <span><strong>Email:</strong> {user.email}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start md:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSelfPasswordModalOpen(true);
                      setSelfCurrentPassword('');
                      setSelfNewPassword('');
                      setSelfConfirmPassword('');
                      setSelfPasswordError('');
                      setSelfPasswordSuccess('');
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-mono font-bold rounded-xl flex items-center gap-2 shadow-sm transition-all"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Change My Password</span>
                  </button>
                </div>
              </div>
            )}

            {/* CATEGORY FILTER TABS & SEARCH TOOLBAR (Super Admin Only) */}
            {isCurrentUserSuperAdmin && (
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5 pt-1">
                <div className="flex flex-wrap lg:flex-nowrap items-center gap-1 sm:gap-1.5 p-1 bg-slate-100 dark:bg-[#0B172B] rounded-xl border border-slate-200 dark:border-[#1E3B66] text-xs font-mono overflow-x-auto no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setStaffFilter('SUPER_ADMIN')}
                    className={`px-3 py-1.5 rounded-tl-[11px] rounded-br-[11px] font-bold font-mono transition-all flex items-center gap-1.5 whitespace-nowrap text-[11px] sm:text-xs border-[1.5px] ${
                      staffFilter === 'SUPER_ADMIN'
                        ? 'bg-amber-950/80 dark:bg-amber-950/90 border-amber-500 text-amber-300 shadow-xs'
                        : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <span>👑 SUPER ADMIN</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                        staffFilter === 'SUPER_ADMIN'
                          ? 'bg-amber-900/80 text-amber-200 border border-amber-500/50'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {usersList.filter((u) => getUserRoleCategory(u) === 'SUPER_ADMIN').length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStaffFilter('ADMINISTRATOR')}
                    className={`px-2.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 whitespace-nowrap text-[11px] sm:text-xs ${
                      staffFilter === 'ADMINISTRATOR'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <span>ADMINISTRATOR</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                        staffFilter === 'ADMINISTRATOR'
                          ? 'bg-purple-800 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {usersList.filter((u) => getUserRoleCategory(u) === 'ADMINISTRATOR').length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStaffFilter('DATA_ENTRY_OFFICER')}
                    className={`px-2.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 whitespace-nowrap text-[11px] sm:text-xs ${
                      staffFilter === 'DATA_ENTRY_OFFICER'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <span>DATA ENTRY OFFICER</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                        staffFilter === 'DATA_ENTRY_OFFICER'
                          ? 'bg-indigo-800 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {usersList.filter((u) => getUserRoleCategory(u) === 'DATA_ENTRY_OFFICER').length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStaffFilter('SMART_CARD_DISTRIBUTOR')}
                    className={`px-2.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 whitespace-nowrap text-[11px] sm:text-xs ${
                      staffFilter === 'SMART_CARD_DISTRIBUTOR'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <span>SMART CARD DISTRIBUTER</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                        staffFilter === 'SMART_CARD_DISTRIBUTOR'
                          ? 'bg-indigo-800 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {usersList.filter((u) => getUserRoleCategory(u) === 'SMART_CARD_DISTRIBUTOR').length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStaffFilter('ALL')}
                    className={`px-2.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 whitespace-nowrap text-[11px] sm:text-xs ${
                      staffFilter === 'ALL'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <span>ALL ACCOUNTS</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                        staffFilter === 'ALL'
                          ? 'bg-indigo-800 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {usersList.length}
                    </span>
                  </button>
                </div>

                {/* Quick Search */}
                <div className="relative flex-1 lg:max-w-[240px] shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filter by name, ID, or post..."
                    value={staffSearchQuery}
                    onChange={(e) => setStaffSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-[#081326] border border-slate-300 dark:border-[#1E3B66] rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}

            {/* Matrix Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-300 dark:border-[#1E3B66] bg-white dark:bg-[#071326] shadow-xs">
              <table className="w-full text-center border-collapse text-[13px]">
                <thead>
                  <tr className="bg-slate-100/90 dark:bg-[#0B172B] border-b border-slate-300 dark:border-[#1E3B66] text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono select-none">
                    <th className="py-3 px-3 w-14 text-center border-r border-slate-300 dark:border-[#1E3B66]">SN</th>
                    <th className="py-3 px-4 text-center border-r border-slate-300 dark:border-[#1E3B66]">STAFF FULL NAME</th>
                    <th className="py-3 px-4 text-center border-r border-slate-300 dark:border-[#1E3B66]">USER ID</th>
                    <th className="py-3 px-4 text-center border-r border-slate-300 dark:border-[#1E3B66]">ROLE</th>
                    <th className="py-3 px-4 text-center border-r border-slate-300 dark:border-[#1E3B66]">POST & CONTACTS</th>
                    <th className="py-3 px-4 text-center border-r border-slate-300 dark:border-[#1E3B66]">STATUS</th>
                    <th className="py-3 px-4 text-center">ACTION CONTROLS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 dark:divide-[#1E3B66] text-[13px]">
                  {displayedUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        <p className="text-sm font-medium">No registered accounts found matching your filter criteria.</p>
                        <button
                          type="button"
                          onClick={() => {
                            setStaffFilter('ALL');
                            setStaffSearchQuery('');
                          }}
                          className="mt-2 text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          Reset Filters to Show All Accounts
                        </button>
                      </td>
                    </tr>
                  ) : (
                    displayedUsers.map((stUser, index) => {
                      const isOwner = stUser.id.toUpperCase() === 'SUPER_ADMIN' || stUser.role === 'SUPER_ADMIN';
                      const isSuspended = stUser.status === 'SUSPENDED';
                      const isSelf = Boolean(
                        user &&
                          (stUser.id.toLowerCase() === user.id.toLowerCase() ||
                            (user.email && stUser.email && stUser.email.toLowerCase() === user.email.toLowerCase()))
                      );

                      return (
                        <tr
                          key={stUser.id}
                          className={`transition-colors border-b border-slate-300 dark:border-[#1E3B66] last:border-b-0 ${
                            isSelf
                              ? 'bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-100/50 dark:hover:bg-emerald-950/30'
                              : isSuspended
                              ? 'opacity-60 bg-rose-50/50 dark:bg-rose-950/10 hover:bg-rose-100/50'
                              : 'hover:bg-slate-50 dark:hover:bg-[#0B172B]/60'
                          }`}
                        >
                          {/* 0. SN (Serial Number) with automatic increment/decrement */}
                          <td className="py-3.5 px-3 w-14 text-center font-mono text-xs font-bold text-slate-600 dark:text-slate-400 border-r border-slate-300 dark:border-[#1E3B66]">
                            {index + 1}
                          </td>

                          {/* 1. Staff Full Name */}
                          <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white tracking-wide uppercase text-center border-r border-slate-300 dark:border-[#1E3B66]">
                            <div className="flex flex-col items-center justify-center gap-1.5">
                              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tracking-wide text-center">
                                {stUser.name ? stUser.name.toUpperCase() : ''}
                              </span>
                              {isSelf && (
                                <div
                                  title="Currently Active Account: You are logged into this staff profile"
                                  className="inline-flex items-center justify-center gap-1.5 px-3 py-0.5 text-[9.5px] font-mono font-bold tracking-wider uppercase bg-emerald-50/95 dark:bg-[#042014] text-emerald-800 dark:text-emerald-300 border-[1.5px] border-emerald-400 dark:border-emerald-500 rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs select-none hover:brightness-105 transition-all cursor-default"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse shrink-0 shadow-[0_0_6px_rgba(16,185,129,0.9)]" />
                                  <span className="font-black text-emerald-700 dark:text-emerald-300">ACTIVE</span>
                                  <span className="opacity-40 font-normal text-emerald-600 dark:text-emerald-400">|</span>
                                  <span className="font-semibold text-emerald-800 dark:text-emerald-200">LOGIN</span>
                                  <span className="font-black text-emerald-600 dark:text-emerald-400">(YOU)</span>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* 2. User ID */}
                          <td className="py-3.5 px-4 text-center border-r border-slate-300 dark:border-[#1E3B66]">
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                              {stUser.id}
                            </span>
                          </td>

                          {/* 3. Role */}
                          <td className="py-3.5 px-4 text-center border-r border-slate-300 dark:border-[#1E3B66]">
                            <div className="flex items-center justify-center">
                              {getUserRoleCategory(stUser) === 'SUPER_ADMIN' ? (
                                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-amber-950/80 dark:bg-amber-950/90 border-[1.5px] border-amber-500 text-amber-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                                  👑 SUPER ADMIN
                                </span>
                              ) : getUserRoleCategory(stUser) === 'ADMINISTRATOR' ? (
                                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-purple-950/80 dark:bg-purple-950/90 border-[1.5px] border-purple-500 text-purple-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                                  🛡️ ADMINISTRATOR
                                </span>
                              ) : getUserRoleCategory(stUser) === 'SMART_CARD_DISTRIBUTOR' ? (
                                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-emerald-950/80 dark:bg-emerald-950/90 border-[1.5px] border-emerald-500 text-emerald-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                                  🪪 SMART CARD DISTRIBUTER
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-cyan-950/80 dark:bg-cyan-950/90 border-[1.5px] border-cyan-500 text-cyan-300 font-mono uppercase tracking-wider rounded-tl-[11px] rounded-br-[11px] rounded-tr-none rounded-bl-none shadow-xs">
                                  👤 DATA ENTRY OFFICER
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 4. Post & Contacts */}
                          <td className="py-3.5 px-4 text-center space-y-0.5 border-r border-slate-300 dark:border-[#1E3B66]">
                            <div className="font-bold text-slate-800 dark:text-slate-200 text-center">
                              {stUser.post || 'SYSTEM CONTROLLER'}
                            </div>
                            {stUser.phone && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono text-center">
                                Mo. {stUser.phone}
                              </div>
                            )}
                            {stUser.email && !stUser.email.toLowerCase().includes('@office.local') && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[200px] mx-auto text-center">
                                ✉️ {stUser.email}
                              </div>
                            )}
                          </td>

                          {/* 5. Status */}
                          <td className="py-3.5 px-4 text-center border-r border-slate-300 dark:border-[#1E3B66]">
                            <div className="flex items-center justify-center">
                              {isSuspended ? (
                                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-rose-900/60 dark:bg-rose-950/80 border-[1.5px] border-rose-500 text-rose-300 font-mono uppercase tracking-wider rounded-tl-[10px] rounded-br-[10px] rounded-tr-none rounded-bl-none shadow-xs">
                                  SUSPENDED
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-black bg-emerald-100 dark:bg-[#042014] border-[1.5px] border-emerald-400 dark:border-emerald-500 text-emerald-800 dark:text-emerald-300 font-mono uppercase tracking-wider rounded-tl-[10px] rounded-br-[10px] rounded-tr-none rounded-bl-none shadow-xs">
                                  ACTIVE
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 6. Action Controls */}
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex flex-wrap items-center justify-center gap-1.5">
                              {/* PERMISSIONS (Super Admin Only) */}
                              {isCurrentUserSuperAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenPermissionsModal(stUser)}
                                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-50 hover:bg-purple-100 dark:bg-[#1A1438] dark:hover:bg-[#271E54] border border-purple-300 dark:border-purple-500/50 text-purple-700 dark:text-purple-300 font-mono flex items-center gap-1 transition-all"
                                  title="Inspect or adjust granular permissions"
                                >
                                  <Shield className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                  <span>PERMISSIONS</span>
                                </button>
                              )}

                              {/* CHANGE MY PASSWORD / RESET PASSWORD */}
                              {isSelf ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelfPasswordModalOpen(true);
                                    setSelfCurrentPassword('');
                                    setSelfNewPassword('');
                                    setSelfConfirmPassword('');
                                    setSelfPasswordError('');
                                    setSelfPasswordSuccess('');
                                  }}
                                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/80 dark:hover:bg-emerald-900 border border-emerald-300 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300 font-mono flex items-center gap-1 transition-all shadow-sm"
                                  title="Change your login password"
                                >
                                  <KeyRound className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                  <span>CHANGE PASSWORD</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResetModalUser(stUser);
                                    const isSuper = getUserRoleCategory(stUser) === 'SUPER_ADMIN';
                                    setResetNewPassword(isSuper ? 'Itahari@PLSMS' : 'Itahari@2026');
                                  }}
                                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-sky-50 hover:bg-sky-100 dark:bg-[#0A263D] dark:hover:bg-[#0F385A] border border-sky-300 dark:border-[#38BDF8]/50 text-sky-700 dark:text-[#38BDF8] font-mono flex items-center gap-1 transition-all"
                                  title="Reset staff operator password"
                                >
                                  <Key className="w-3 h-3 text-sky-600 dark:text-[#38BDF8]" />
                                  <span>RESET PASSWORD</span>
                                </button>
                              )}

                              {/* SUSPEND / ACTIVATE (Only non-owners and not self) */}
                              {!isOwner && !isSelf && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleUserStatus(stUser)}
                                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border font-mono flex items-center gap-1 transition-all ${
                                    isSuspended
                                      ? 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/80 dark:hover:bg-emerald-900 border-emerald-300 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/80 dark:hover:bg-amber-900 border-amber-300 dark:border-amber-500 text-amber-800 dark:text-amber-300'
                                  }`}
                                  title={isSuspended ? 'Reactivate account' : 'Suspend account access'}
                                >
                                  {isSuspended ? (
                                    <>
                                      <PlayCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                      <span>ACTIVATE</span>
                                    </>
                                  ) : (
                                    <>
                                      <PauseCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                      <span>SUSPEND</span>
                                    </>
                                  )}
                                </button>
                              )}

                              {/* REVOKE (Only non-owners and not self) */}
                              {!isOwner && !isSelf && (
                                <button
                                  type="button"
                                  onClick={() => setRevokeModalUser(stUser)}
                                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/80 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-500/50 text-rose-700 dark:text-rose-300 font-mono flex items-center gap-1 transition-all"
                                  title="Revoke and permanently delete user"
                                >
                                  <Trash2 className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                                  <span>REVOKE</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: UPLOAD CENTER (Moved completely into System Settings with 2-Step Verification) */}
      {activeTab === 'UPLOAD_CENTER' && userCanAccessUploadCenter && (
        <div className="space-y-6">
          {!isUploadCenterCleared ? (
            !showUploadCenterVerifyModal ? (
              <div className="w-full">
                <UploadCenterVerificationCard
                  user={user}
                  timeoutNotice={uploadCenterTimeoutNotice}
                  onClearTimeoutNotice={() => setUploadCenterTimeoutNotice(null)}
                  onSuccess={() => {
                    setIsUploadCenterCleared(true);
                    setUploadCenterTimeoutNotice(null);
                    setShowUploadCenterVerifyModal(false);
                    handledInitialTabRef.current = 'UPLOAD_CENTER';
                    lastActivityTimestampRef.current = Date.now();
                    sessionStorage.setItem('plsms_upload_center_last_active', Date.now().toString());
                    setIdleRemainingSeconds(120);
                  }}
                />
              </div>
            ) : null
          ) : (
            <div className="space-y-6">
              {/* Clearance Session Status Bar with Live 5-Minute Inactivity Auto-Lock Monitor */}
              <div
                className={`flex flex-col md:flex-row md:items-center justify-between gap-3 border rounded-xl px-4 py-3 text-xs shadow-sm transition-all ${
                  idleRemainingSeconds <= 60
                    ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-400 dark:border-amber-600 text-amber-950 dark:text-amber-200'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-300'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck
                    className={`w-4 h-4 shrink-0 ${
                      idleRemainingSeconds <= 60
                        ? 'text-amber-600 dark:text-amber-400 animate-bounce'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  />
                  <div>
                    <span className="font-bold">2-STEP AUTHENTICATION CLEARANCE ACTIVE</span>
                    <span className="hidden sm:inline text-slate-600 dark:text-slate-400 ml-1.5 font-sans">
                      — Operational write permissions granted for Data Upload & Delete Operations.
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Real-time 2-Minute Inactivity Monitor Badge */}
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-xs font-bold border ${
                      idleRemainingSeconds <= 60
                        ? 'bg-rose-100 dark:bg-rose-950/80 border-rose-400 dark:border-rose-600 text-rose-800 dark:text-rose-200 animate-pulse'
                        : 'bg-emerald-100/80 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700/50 text-emerald-900 dark:text-emerald-200'
                    }`}
                    title="User inactivity timer resets on mouse movement, touch, or keyboard input"
                  >
                    <Timer className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {idleRemainingSeconds <= 60 ? (
                        <>निष्क्रियता चेतावनी: <strong>{formatIdleTimer(idleRemainingSeconds)}</strong> मा लक हुनेछ</>
                      ) : (
                        <>निष्क्रियता सुरक्षा लक (Auto-Lock): <strong>{formatIdleTimer(idleRemainingSeconds)}</strong></>
                      )}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => lockUploadCenterAccess('अपरेटरद्वारा कन्सोल म्यानुअल रूपमा लक गरियो (Console manually locked by operator).')}
                    className="px-3 py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/70 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-600/40 text-rose-800 dark:text-rose-300 transition-all cursor-pointer font-mono font-bold text-[11px] flex items-center gap-1.5"
                    title="Lock Upload Center console immediately"
                  >
                    <Lock className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                    <span>कन्सोल लक गर्नुहोस् (LOCK)</span>
                  </button>
                </div>
              </div>

              <UploadCenterView
                onImportComplete={() => {
                  if (onImportComplete) {
                    onImportComplete();
                  }
                  refreshSystemStatus?.();
                  fetchDbStats();
                }}
                resetProductionDataSection={renderResetProductionDataSection()}
              />
            </div>
          )}
        </div>
      )}

      {/* TAB 2: BACKUPS */}
      {activeTab === 'BACKUPS' && (
        <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162846] rounded-2xl p-6 sm:p-8 shadow-sm dark:shadow-2xl space-y-6 transition-colors">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-mono flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              Cryptographic Database Backup & Snapshot Engine
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Download atomic JSON dumps of all smart card records, audit logs, and user configurations.
            </p>
          </div>

          {/* FLOATING SUCCESS INFORMATION DIALOG BOX (Rectangular shape, 50%+ wider horizontal size for optimal spacing and readability) */}
          {backupSuccess && (
            <div
              id="backup-success-dialog-overlay"
              className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
            >
              <div
                id="backup-success-dialog"
                className="w-full max-w-[600px] flex flex-col items-center text-center p-6 sm:p-7 sm:px-10 rounded-3xl bg-white dark:bg-[#071224] border border-emerald-300/70 dark:border-emerald-500/50 shadow-2xl relative text-slate-800 dark:text-slate-100 animate-in zoom-in-95 duration-200 overflow-hidden"
              >
                {/* Close (X) button at top right */}
                <button
                  type="button"
                  id="close-backup-success-dialog-btn"
                  onClick={() => setBackupSuccess('')}
                  className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors cursor-pointer z-10"
                  title="Close dialog (X)"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Top Emblem & Badge */}
                <div className="flex flex-col items-center pt-1 mb-4">
                  <div className="relative mb-3">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 border-2 border-emerald-500/80 dark:border-emerald-400 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
                      <CheckCircle2 className="w-9 h-9 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-white shadow-xs">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>

                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-wider shadow-xs mb-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    BACKUP ARCHIVE CREATED
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-snug px-3">
                    System Backup Generated Successfully
                  </h3>
                </div>

                {/* Middle Message / Information */}
                <div className="w-full space-y-3 mb-5">
                  <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 dark:bg-[#050C1B] border border-slate-200 dark:border-slate-800 text-left">
                    <p className="text-xs sm:text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
                      {backupSuccess}
                    </p>
                    {downloadedBackupInfo && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        <span className="truncate flex-1 font-semibold text-slate-800 dark:text-slate-200" title={downloadedBackupInfo.filename}>
                          {downloadedBackupInfo.filename}
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                          ✓ Downloaded
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="w-full pt-1">
                  <button
                    type="button"
                    id="ack-backup-success-btn"
                    onClick={() => setBackupSuccess('')}
                    className="w-full py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-mono font-bold text-xs sm:text-sm uppercase tracking-wider shadow-xs transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Close & Continue</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Backup Error Notification */}
          {backupError && (
            <div className="bg-rose-50 dark:bg-rose-950/90 border border-rose-300 dark:border-rose-500 text-rose-800 dark:text-rose-200 p-4 rounded-xl text-xs font-semibold flex items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>{backupError}</span>
              </div>
              <button
                type="button"
                onClick={() => setBackupError('')}
                className="text-rose-700 hover:text-rose-900 dark:text-rose-300 text-xs font-mono font-bold px-2 py-0.5 rounded cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Downloaded Backup Audit Card */}
          {downloadedBackupInfo && (
            <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs font-mono">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="font-bold text-slate-800 dark:text-white">{downloadedBackupInfo.filename}</span>
                  <span className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                    {(downloadedBackupInfo.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-2">
                  <span>Location: <strong className="text-indigo-600 dark:text-indigo-300">{downloadedBackupInfo.locationName}</strong></span>
                  <span>•</span>
                  <span>Scope: <strong className="text-slate-700 dark:text-slate-200">{downloadedBackupInfo.scope}</strong></span>
                  <span>•</span>
                  <span>Time: {downloadedBackupInfo.timestamp}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleTabClick('UPLOAD_CENTER')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-2 self-start sm:self-auto cursor-pointer shrink-0"
              >
                <HardDriveDownload className="w-3.5 h-3.5 text-amber-300" />
                <span>Test / Restore in Upload Center</span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Card 1: Official System Backup & Download Console (Full 7-Category Audit + Download) */}
            <div className="lg:col-span-8 bg-slate-50 dark:bg-[#081326] border border-slate-200 dark:border-[#162A4A] rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white font-mono flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-amber-500" />
                  <span>1. Official System Backup & Download Console</span>
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/50">
                  COMPULSORY SIGNATURE
                </span>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-mono">
                Generates a cryptographically signed backup archive containing full smart card inventories, distributions, and configurations stamped with the official office signature. All 7 categories below are bundled into your download.
              </p>

              {/* CONTENTS & DATA TO BE DOWNLOADED / EXPORTED IN BACKUP (All 7 Categories) */}
              <div className="p-3.5 sm:p-4 rounded-xl bg-white dark:bg-[#0c1930] border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Contents & Data Inventory to be Exported in Downloaded File:</span>
                  </span>
                  <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/50">
                    7 CATEGORIES READY
                  </span>
                </div>

                {/* 6 Core Smart Card Action Categories matching Picture 2 */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center font-mono">
                  {/* TOTAL SMART CARDS */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#081326] border border-blue-500/30 dark:border-blue-500/40 shadow-xs flex flex-col justify-between">
                    <span className="text-[10px] sm:text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">
                      1. TOTAL SMART CARDS
                    </span>
                    <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-1">
                      {liveInventoryStats.records.toLocaleString()}
                    </span>
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                      कुल कार्ड (Master)
                    </span>
                  </div>

                  {/* NOT -DISTRIBUTED CARDS */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#081326] border border-emerald-500/30 dark:border-emerald-500/40 shadow-xs flex flex-col justify-between">
                    <span className="text-[10px] sm:text-[11px] font-bold text-emerald-700 dark:text-[#10B981] uppercase tracking-tight">
                      2. NOT -DISTRIBUTED
                    </span>
                    <span className="text-base sm:text-lg font-black text-emerald-700 dark:text-[#10B981] mt-1">
                      {liveInventoryStats.notDistributed.toLocaleString()}
                    </span>
                    <span className="text-[9px] text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                      वितरण बाँकी (In Vault)
                    </span>
                  </div>

                  {/* DISTRIBUTED CARDS */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#081326] border border-sky-500/30 dark:border-sky-500/40 shadow-xs flex flex-col justify-between">
                    <span className="text-[10px] sm:text-[11px] font-bold text-sky-700 dark:text-[#38BDF8] uppercase tracking-tight">
                      3. DISTRIBUTED CARDS
                    </span>
                    <span className="text-base sm:text-lg font-black text-sky-700 dark:text-[#38BDF8] mt-1">
                      {liveInventoryStats.distributed.toLocaleString()}
                    </span>
                    <span className="text-[9px] text-sky-600/70 dark:text-sky-400/70 mt-0.5">
                      हस्तान्तरित (Handed Over)
                    </span>
                  </div>

                  {/* MISSING CARDS */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#081326] border border-rose-500/30 dark:border-rose-500/40 shadow-xs flex flex-col justify-between">
                    <span className="text-[10px] sm:text-[11px] font-bold text-rose-700 dark:text-[#F87171] uppercase tracking-tight">
                      4. MISSING CARDS
                    </span>
                    <span className="text-base sm:text-lg font-black text-rose-700 dark:text-[#F87171] mt-1">
                      {liveInventoryStats.missing.toLocaleString()}
                    </span>
                    <span className="text-[9px] text-rose-600/70 dark:text-rose-400/70 mt-0.5">
                      हराएको (Reported Lost)
                    </span>
                  </div>

                  {/* FOUND CARDS */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#081326] border border-purple-500/30 dark:border-purple-500/40 shadow-xs flex flex-col justify-between">
                    <span className="text-[10px] sm:text-[11px] font-bold text-purple-700 dark:text-[#C084FC] uppercase tracking-tight">
                      5. FOUND CARDS
                    </span>
                    <span className="text-base sm:text-lg font-black text-purple-700 dark:text-[#C084FC] mt-1">
                      {liveInventoryStats.found.toLocaleString()}
                    </span>
                    <span className="text-[9px] text-purple-600/70 dark:text-purple-400/70 mt-0.5">
                      भेटिएको (Recovered)
                    </span>
                  </div>

                  {/* HANDED OVER CARDS */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#081326] border border-teal-500/30 dark:border-teal-500/40 shadow-xs flex flex-col justify-between">
                    <span className="text-[10px] sm:text-[11px] font-bold text-teal-700 dark:text-[#2DD4BF] uppercase tracking-tight">
                      6. HANDED OVER CARDS
                    </span>
                    <span className="text-base sm:text-lg font-black text-teal-700 dark:text-[#2DD4BF] mt-1">
                      {(liveInventoryStats.handedOver ?? liveInventoryStats.distributed).toLocaleString()}
                    </span>
                    <span className="text-[9px] text-teal-600/70 dark:text-teal-400/70 mt-0.5">
                      हस्तान्तरित (Handed Over)
                    </span>
                  </div>
                </div>

                {/* Telemetry Ratio Bar */}
                {liveInventoryStats.records > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      <span>Action Data Ratio Balance:</span>
                      <span>
                        {Math.round((liveInventoryStats.notDistributed / liveInventoryStats.records) * 1000) / 10}% Vault •{' '}
                        {Math.round((liveInventoryStats.distributed / liveInventoryStats.records) * 1000) / 10}% Distributed
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
                      <div
                        className="bg-emerald-500 h-full"
                        style={{ width: `${(liveInventoryStats.notDistributed / liveInventoryStats.records) * 100}%` }}
                        title={`Not Distributed: ${liveInventoryStats.notDistributed.toLocaleString()}`}
                      />
                      <div
                        className="bg-sky-500 h-full"
                        style={{ width: `${(liveInventoryStats.distributed / liveInventoryStats.records) * 100}%` }}
                        title={`Distributed: ${liveInventoryStats.distributed.toLocaleString()}`}
                      />
                      {liveInventoryStats.missing > 0 && (
                        <div
                          className="bg-rose-500 h-full"
                          style={{ width: `${Math.max(1, (liveInventoryStats.missing / liveInventoryStats.records) * 100)}%` }}
                          title={`Missing: ${liveInventoryStats.missing.toLocaleString()}`}
                        />
                      )}
                      {liveInventoryStats.found > 0 && (
                        <div
                          className="bg-purple-500 h-full"
                          style={{ width: `${Math.max(1, (liveInventoryStats.found / liveInventoryStats.records) * 100)}%` }}
                          title={`Found: ${liveInventoryStats.found.toLocaleString()}`}
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Items 6 & 7: User IDs, Encrypted Passwords & Auxiliary Data in Backup */}
                <div className="space-y-2 pt-1 font-mono">
                  {/* 6. Registered Users IDs along with Passwords (extra coding form) */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#081326] border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-amber-500 shrink-0" />
                      <div>
                        <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 block">
                          6. Registered Users ID's & Passwords:
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          Preserved with Bcrypt Cryptographic Hash (Extra Coding Form)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 self-end sm:self-auto">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/50">
                        EXTRA CODING FORM
                      </span>
                      <strong className="text-xs font-bold text-amber-600 dark:text-amber-400">
                        {(liveInventoryStats.users || usersList.length).toLocaleString()} Accounts
                      </strong>
                    </div>
                  </div>

                  {/* 7. Auxiliary Database Entities Exported */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#081326] border border-indigo-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-indigo-500 shrink-0" />
                      <div>
                        <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 block">
                          7. Other Auxiliary Export Items:
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {liveInventoryStats.imports} Batch Imports • {liveInventoryStats.distributed} Handover Ledgers • {liveInventoryStats.actionOverrides ?? 0} Overrides • {liveInventoryStats.notices ?? 0} Notices
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-200 dark:border-indigo-800 self-end sm:self-auto">
                      {liveInventoryStats.hasGoogleSheetsConfig ? 'Sheets Sync: Configured' : 'Offline Mode'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Archive Scope & Download Console Panel */}
              <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#0c1930] border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-4">
                {/* Archive Scope Selector */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold font-mono text-slate-800 dark:text-slate-200 flex items-center justify-between">
                    <span>Backup Scope (ब्याकअपको दायरा):</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                      {backupScope === 'FULL_MASTER_ARCHIVE' ? 'Complete System Vault' : 'Cards & Batches Only'}
                    </span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono">
                    <button
                      type="button"
                      onClick={() => setBackupScope('FULL_MASTER_ARCHIVE')}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        backupScope === 'FULL_MASTER_ARCHIVE'
                          ? 'bg-indigo-50 border-2 border-indigo-600 text-indigo-950 dark:bg-amber-500/15 dark:border-amber-500 dark:text-amber-200 font-bold shadow-xs'
                          : 'bg-slate-50/70 hover:bg-slate-100/80 dark:bg-[#081326] border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <div className="font-bold text-[11px] flex items-center justify-between">
                        <span>Full Master Archive</span>
                        {backupScope === 'FULL_MASTER_ARCHIVE' && (
                          <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-amber-400" />
                        )}
                      </div>
                      <div className="text-[10px] opacity-80 mt-0.5">All 7 categories, logs, users & config</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setBackupScope('RECORDS_ONLY')}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        backupScope === 'RECORDS_ONLY'
                          ? 'bg-indigo-50 border-2 border-indigo-600 text-indigo-950 dark:bg-amber-500/15 dark:border-amber-500 dark:text-amber-200 font-bold shadow-xs'
                          : 'bg-slate-50/70 hover:bg-slate-100/80 dark:bg-[#081326] border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <div className="font-bold text-[11px] flex items-center justify-between">
                        <span>Records & Batches Only</span>
                        {backupScope === 'RECORDS_ONLY' && (
                          <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-amber-400" />
                        )}
                      </div>
                      <div className="text-[10px] opacity-80 mt-0.5">Smart card database items</div>
                    </button>
                  </div>
                </div>

                {/* Primary Action Button */}
                <button
                  type="button"
                  onClick={() => handleExportSystemBackup()}
                  disabled={creatingBackup}
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 dark:bg-amber-500 dark:hover:bg-amber-600 text-white dark:text-slate-950 font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 font-mono uppercase tracking-wider cursor-pointer"
                >
                  {creatingBackup ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-white dark:text-slate-950" />
                  ) : (
                    <HardDriveDownload className="w-4 h-4 text-white dark:text-slate-950" />
                  )}
                  <span>
                    {creatingBackup
                      ? 'Exporting Cryptographic Backup...'
                      : 'Initiate JSON Backup Download'}
                  </span>
                </button>
              </div>
            </div>

            {/* Card 2: Storage Rules & Air-Gapped Disaster Recovery Guide */}
            <div className="lg:col-span-4 bg-slate-50 dark:bg-[#081326] border border-slate-200 dark:border-[#162A4A] rounded-2xl p-5 space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white font-mono flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span>2. Storage Rules & Retention</span>
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/50">
                    AIR-GAPPED COMPATIBLE
                  </span>
                </div>

                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-2.5 list-disc pl-4 leading-relaxed font-mono">
                  <li>
                    Backups are verified with <strong>SHA-256 checksum integrity</strong> to detect any corruption.
                  </li>
                  <li>
                    Carries official location signature of the operating office for seamless importing.
                  </li>
                  <li>
                    All distributions, smart card status logs, and recipient records are archived non-destructively.
                  </li>
                  <li>
                    Includes registered User IDs and passwords safely encrypted with Bcrypt cryptographic hashing.
                  </li>
                  <li>
                    Exported JSON files can be directly uploaded into the <strong>Upload Center &gt; Accidental Recovery Injector</strong> anytime.
                  </li>
                </ul>

                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs font-mono space-y-1.5">
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <HardDriveDownload className="w-3.5 h-3.5 shrink-0" />
                    <span>Testing & Disaster Recovery:</span>
                  </span>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    To test your downloaded backup or recover from accidental data deletion, navigate to Upload Center where all 7 categories start at 0 until your backup file is verified.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Public Citizen Portal Visitor Counter & Permanent Traffic Preservation Registry */}
          <div
            id="permanent-visitor-counter-card"
            className="w-full bg-slate-50 dark:bg-[#081326] border border-slate-200 dark:border-[#162A4A] rounded-2xl p-6 sm:p-7 space-y-5 transition-colors shadow-xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-[#162846] pb-4">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-blue-50 dark:bg-blue-950/80 border border-blue-200 dark:border-blue-700/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0 shadow-xs">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white font-mono flex items-center gap-2">
                    <span>Public Citizen Portal Visitor Counter (Permanent Traffic Registry)</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Indestructible multi-tier traffic counter guaranteed to persist across version remixes, database resets, and server restarts.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/60">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  PERMANENT PRESERVATION ACTIVE
                </span>
              </div>
            </div>

            {/* Status and Metrics Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-white dark:bg-[#060D1B] border border-slate-200 dark:border-[#162846] flex flex-col justify-between">
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Current Permanent Visitor Count
                </span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-2xl sm:text-3xl font-black font-mono text-blue-600 dark:text-blue-400">
                    {adminVisitorCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    searches / visits
                  </span>
                </div>
                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 shrink-0" /> Live & Monotonic (Never Decreases)
                </span>
              </div>

              <div className="p-4 rounded-xl bg-white dark:bg-[#060D1B] border border-slate-200 dark:border-[#162846] flex flex-col justify-between">
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Multi-Tier Storage Redundancy
                </span>
                <div className="space-y-1.5 mt-2 text-xs font-mono">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-400">Primary DB File:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ visitor_counter.json</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-400">Redundant Mirror:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ visitor_counter.backup.json</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 dark:text-slate-400">Master Audit:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ master_visitor_registry.json</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white dark:bg-[#060D1B] border border-slate-200 dark:border-[#162846] flex flex-col justify-between">
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Cross-Version Remix Bridge
                </span>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1.5">
                  When you fork or remix the app into a new container, client browsers carrying the previous high-water mark automatically restore and promote the server count on initial visit.
                </p>
                <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 mt-1 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 shrink-0" /> Auto-Healing Active
                </span>
              </div>
            </div>

            {/* Calibration & Historic Count Configuration Form */}
            {isCurrentUserSuperAdmin && (
              <div className="p-4 sm:p-5 rounded-xl bg-blue-50/50 dark:bg-[#0a1830]/40 border border-blue-200 dark:border-blue-800/60 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white font-mono flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>Calibrate & Lock Historic Visitor Counter</span>
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      If your previous production version had an accumulated count, set it here to permanently lock and resume from that baseline.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleCalibrateVisitorCounter} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={calibrateInputCount}
                      onChange={(e) => setCalibrateInputCount(e.target.value)}
                      placeholder="Enter historic visitor count (e.g. 5000)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#070F1E] border border-slate-300 dark:border-[#1e3458] text-sm font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isCalibratingVisitorCount}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-mono text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-98 transition-all disabled:opacity-50 cursor-pointer shadow-sm shrink-0"
                  >
                    {isCalibratingVisitorCount ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Locking Counter...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Permanently Lock & Apply Baseline</span>
                      </>
                    )}
                  </button>
                </form>

                {calibrateVisitorSuccess && (
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-xs text-emerald-800 dark:text-emerald-300 font-mono flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>{calibrateVisitorSuccess}</span>
                  </div>
                )}

                {calibrateVisitorError && (
                  <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-700 text-xs text-rose-800 dark:text-rose-300 font-mono flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <span>{calibrateVisitorError}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* FINAL SAFEGUARD MODAL: RESET PRODUCTION DATABASE */}
      {/* ========================================================================= */}
      {showFinalSafetyModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#070E1C] border-2 border-rose-500 dark:border-rose-600 rounded-3xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 dark:bg-rose-950 border border-rose-300 dark:border-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 animate-bounce" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white font-mono tracking-tight">
                  FINAL SAFEGUARD: CONFIRM PURGE
                </h3>
                <p className="text-xs text-rose-600 dark:text-rose-300 font-mono font-semibold">
                  Action cannot be undone or reverted.
                </p>
              </div>
            </div>

            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 p-4 rounded-2xl text-xs text-slate-700 dark:text-slate-200 space-y-2 leading-relaxed font-mono">
              <p>
                You are about to permanently purge <strong className="text-rose-700 dark:text-rose-300">{liveDbStats.totalRecords.toLocaleString()} license records</strong>, <strong className="text-rose-700 dark:text-rose-300">{liveDbStats.totalImports.toLocaleString()} batch import jobs</strong>, <strong className="text-rose-700 dark:text-rose-300">{liveDbStats.totalDistributions.toLocaleString()} handover records</strong>, and <strong className="text-rose-700 dark:text-rose-300">{(liveDbStats.totalAuditLogs ?? 0).toLocaleString()} security audit log entries</strong>.
              </p>
              <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                Upon completion, the application database will contain <strong>0 records</strong> and be clean for your fresh official Google Sheet import.
              </p>
            </div>

            {/* Beautiful Backup Prompt Card */}
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-[#120F05] border-2 border-amber-300 dark:border-amber-600/70 flex items-start gap-3.5 font-mono shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-400 dark:border-amber-500/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 shadow-xs">
                <Database className="w-5 h-5 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-xs sm:text-sm font-black text-amber-900 dark:text-amber-300 tracking-tight uppercase">
                    Do you want to keep a Backup JSON file?
                  </h4>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-200 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-400 dark:border-amber-500/40">
                    Recommended Safeguard
                  </span>
                </div>
                <p className="text-[11px] text-amber-800/90 dark:text-amber-200/80 leading-relaxed font-sans sm:font-mono">
                  Before executing database reset, click the <strong className="text-amber-900 dark:text-amber-200 font-bold">YES</strong> button below to save an encrypted JSON archive to your local device.
                </p>
              </div>
            </div>

            {backupSuccess && (
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 border-2 border-emerald-400 dark:border-emerald-500 text-emerald-900 dark:text-emerald-200 text-xs font-mono flex items-center gap-3 shadow-md animate-in fade-in">
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="font-semibold">{backupSuccess}</span>
              </div>
            )}

            {/* 3 Buttons in the Same Line */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-[#1E3050]">
              <button
                type="button"
                onClick={() => setShowFinalSafetyModal(false)}
                disabled={resettingProductionData}
                className="px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer shrink-0 text-center"
              >
                Abort & Keep Data
              </button>

              <button
                type="button"
                onClick={() => handleExportSystemBackup()}
                disabled={creatingBackup || resettingProductionData}
                className="px-5 py-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border-2 border-amber-400 dark:bg-[#120F05] dark:hover:bg-[#1C1708] dark:border-amber-500 text-xs font-mono font-bold text-amber-600 dark:text-amber-400 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 shadow-md whitespace-nowrap"
                title="Download full JSON backup of active database before resetting"
              >
                {creatingBackup ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400" />
                ) : (
                  <Database className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                )}
                <span>
                  {creatingBackup ? (
                    'EXPORTING BACKUP...'
                  ) : (
                    <>
                      <span className="font-black text-amber-600 dark:text-amber-300">YES</span>, KEEP BACKUP JSON
                    </>
                  )}
                </span>
              </button>

              <button
                type="button"
                onClick={handleExecuteProductionReset}
                disabled={resettingProductionData}
                className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-mono font-black flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(244,63,94,0.5)] transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                {resettingProductionData ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Purging Production Database...</span>
                  </>
                ) : (
                  <>
                    <Flame className="w-4 h-4" />
                    <span>CONFIRM & EXECUTE RESET NOW</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CENTERED RESET SUCCESS VIEW MODE NOTICE MODAL */}
      {/* ========================================================================= */}
      {showResetSuccessModal && productionResetResult && (
        <div
          id="production-reset-success-centered-modal"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowResetSuccessModal(false);
            }
          }}
        >
          <div className="bg-emerald-50 dark:bg-[#051512] border-2 border-emerald-500 rounded-3xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl dark:shadow-[0_0_60px_rgba(16,185,129,0.45)] text-slate-900 dark:text-emerald-100 space-y-6 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-emerald-200 dark:border-emerald-800/60">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 border-2 border-emerald-500 dark:border-emerald-400 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-md dark:shadow-[0_0_20px_rgba(16,185,129,0.5)]">
                  <CheckCircle2 className="w-7 h-7 animate-pulse" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-emerald-200 dark:bg-emerald-500/30 text-emerald-900 dark:text-emerald-300 border border-emerald-400/50">
                      OFFICIAL SYSTEM NOTICE • CENTER VIEW MODE
                    </span>
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400/90 font-mono font-semibold">
                      PLSMS Command Center
                    </span>
                  </div>
                  <h2 className="text-sm sm:text-base font-black font-mono tracking-tight text-emerald-950 dark:text-white mt-1">
                    {productionResetResult.message || '✓ PRODUCTION DATA RESET SUCCESSFULLY — BOTH PLSMS APP DATABASE AND GOOGLE SHEET ARE AT 0 RECORDS (RESETTING MODE ACTIVE).'}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                id="btn-close-reset-modal"
                onClick={() => setShowResetSuccessModal(false)}
                className="p-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/80 dark:hover:bg-emerald-900 border border-emerald-300 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                title="Close view mode"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 4 Metric Badges Matching System State */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 font-mono">
              <div className="p-4 bg-white dark:bg-emerald-950/70 rounded-2xl border border-emerald-300 dark:border-emerald-500/40 shadow-xs dark:shadow-inner">
                <div className="text-[10px] sm:text-[11px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-wider">
                  PURGED LICENSE RECORDS
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
                  {(productionResetResult.details?.clearedRecords ?? 0).toLocaleString()} records
                </div>
                <div className="text-[10.5px] text-emerald-600 dark:text-emerald-400/70 mt-1">
                  Reset cleanly to 0 in storage
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-emerald-950/70 rounded-2xl border border-emerald-300 dark:border-emerald-500/40 shadow-xs dark:shadow-inner">
                <div className="text-[10px] sm:text-[11px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-wider">
                  PURGED IMPORT JOBS
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
                  {(productionResetResult.details?.clearedImports ?? 0).toLocaleString()} batches
                </div>
                <div className="text-[10.5px] text-emerald-600 dark:text-emerald-400/70 mt-1">
                  Upload history purged cleanly
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-emerald-950/70 rounded-2xl border border-emerald-300 dark:border-emerald-500/40 shadow-xs dark:shadow-inner">
                <div className="text-[10px] sm:text-[11px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-wider">
                  PURGED DISTRIBUTIONS
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
                  {(productionResetResult.details?.clearedDistributions ?? 0).toLocaleString()} records
                </div>
                <div className="text-[10.5px] text-emerald-600 dark:text-emerald-400/70 mt-1">
                  Handover logs purged cleanly
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-emerald-950/70 rounded-2xl border border-emerald-300 dark:border-emerald-500/40 shadow-xs dark:shadow-inner">
                <div className="text-[10px] sm:text-[11px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-wider">
                  PURGED AUDIT LOGS
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
                  {(productionResetResult.details?.clearedAuditLogs ?? 0).toLocaleString()} events
                </div>
                <div className="text-[10.5px] text-emerald-600 dark:text-emerald-400/70 mt-1">
                  Audit trail reset to clean ledger
                </div>
              </div>
            </div>

            {/* Status & Next Step Guidance */}
            <div className="p-4 rounded-2xl bg-emerald-100/70 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2.5 text-emerald-900 dark:text-emerald-200">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  <strong>Clean Slate Active:</strong> Production data cleared. The system is ready for fresh official Google Sheets Synchronization or Excel dataset upload.
                </span>
              </div>
              <span className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-200 dark:bg-emerald-500/20 text-emerald-900 dark:text-emerald-300 font-bold border border-emerald-300 dark:border-emerald-500/30 whitespace-nowrap self-start sm:self-auto">
                0 Records in System
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-3 border-t border-emerald-200 dark:border-emerald-800/60">
              <button
                type="button"
                onClick={() => {
                  setShowResetSuccessModal(false);
                  const el = document.getElementById('reset-production-data-container');
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }}
                className="px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-emerald-950 dark:hover:bg-emerald-900 border border-slate-300 dark:border-emerald-600 text-slate-800 dark:text-emerald-300 hover:text-slate-950 dark:hover:text-white font-mono font-bold text-xs transition-colors cursor-pointer text-center"
              >
                Keep in Background
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowResetSuccessModal(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 font-mono font-black text-xs uppercase tracking-wider transition-all shadow-md dark:shadow-[0_0_20px_rgba(16,185,129,0.5)] cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Scroll Up to Google Sheets Sync / Upload Tools ↑</span>
              </button>

              <button
                type="button"
                onClick={() => setShowResetSuccessModal(false)}
                className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-100 dark:text-slate-900 font-mono font-black text-xs uppercase tracking-wider transition-all cursor-pointer text-center"
              >
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: EDIT USER PERMISSIONS MODAL (Super Admin Only) */}
      {/* ========================================================================= */}
      {isCurrentUserSuperAdmin && permissionModalUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#1E3B66] rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden transition-colors">
            <div className="p-5 border-b border-slate-200 dark:border-[#162846] flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 font-mono">
                  <Shield className="w-4 h-4 text-indigo-600 dark:text-purple-400" />
                  Edit Granular Permissions: {permissionModalUser.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  User ID: <span className="font-mono text-indigo-600 dark:text-purple-300 font-semibold">{permissionModalUser.id}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPermissionModalUser(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg font-mono p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {(() => {
                const modalTheme = ROLE_THEME_CONFIGS[modalActivePreset];
                return (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-[#162846]">
                      <span className="text-xs font-mono text-slate-700 dark:text-slate-300">
                        Granted:{' '}
                        <strong className={modalPermissions.length > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>
                          {modalPermissions.length}
                        </strong>{' '}
                        / {TOTAL_PERMISSIONS_COUNT}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 font-mono mr-1">PRESETS:</span>
                        <button
                          type="button"
                          onClick={() => {
                            setModalPermissions(ROLE_PRESETS.SUPER_ADMIN);
                            setModalActivePreset('SUPER_ADMIN');
                          }}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border font-mono transition-all ${
                            modalActivePreset === 'SUPER_ADMIN'
                              ? 'bg-amber-100 dark:bg-amber-950/80 border-amber-400 dark:border-amber-500 text-amber-900 dark:text-amber-300 shadow-sm dark:shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                              : 'bg-white dark:bg-[#0A162B] border-slate-300 dark:border-[#1C335A] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          Super Admin
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModalPermissions(ROLE_PRESETS.ADMIN);
                            setModalActivePreset('ADMIN');
                          }}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border font-mono transition-all ${
                            modalActivePreset === 'ADMIN'
                              ? 'bg-purple-100 dark:bg-purple-950/80 border-purple-400 dark:border-purple-500 text-purple-900 dark:text-purple-300 shadow-sm dark:shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                              : 'bg-white dark:bg-[#0A162B] border-slate-300 dark:border-[#1C335A] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          Administrator
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModalPermissions(ROLE_PRESETS.DATA_ENTRY_OFFICER);
                            setModalActivePreset('DATA_ENTRY_OFFICER');
                          }}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border font-mono transition-all ${
                            modalActivePreset === 'DATA_ENTRY_OFFICER'
                              ? 'bg-sky-100 dark:bg-[#0E2A47] border-sky-400 dark:border-[#38BDF8] text-sky-900 dark:text-[#38BDF8] shadow-sm dark:shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                              : 'bg-white dark:bg-[#0A162B] border-slate-300 dark:border-[#1C335A] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          Data Entry Officer
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModalPermissions(ROLE_PRESETS.SMART_CARD_DISTRIBUTOR);
                            setModalActivePreset('SMART_CARD_DISTRIBUTOR');
                          }}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border font-mono transition-all ${
                            modalActivePreset === 'SMART_CARD_DISTRIBUTOR'
                              ? 'bg-emerald-100 dark:bg-emerald-950/80 border-emerald-400 dark:border-emerald-500 text-emerald-900 dark:text-emerald-300 shadow-sm dark:shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                              : 'bg-white dark:bg-[#0A162B] border-slate-300 dark:border-[#1C335A] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          Smart Card Distributer
                        </button>
                        <span className="text-slate-300 dark:text-slate-600 mx-0.5">|</span>
                        <button
                          type="button"
                          onClick={() => setModalPermissions(ALL_PERMISSION_IDS)}
                          className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline font-mono"
                        >
                          Grant All
                        </button>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <button
                          type="button"
                          onClick={() => setModalPermissions([])}
                          className="text-[10px] font-bold text-rose-600 dark:text-rose-400 hover:underline font-mono"
                        >
                          Revoke All
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {PERMISSION_GROUPS.map((group) => {
                        const groupPermIds = group.permissions.map((p) => p.id);
                        const selectedCount = groupPermIds.filter((id) => modalPermissions.includes(id)).length;
                        const totalInGroup = groupPermIds.length;
                        const isFullySelected = selectedCount === totalInGroup && totalInGroup > 0;

                        return (
                          <div key={group.key} className="bg-slate-50 dark:bg-[#081326] border border-slate-200 dark:border-[#162A4A] rounded-xl p-3 space-y-2">
                            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span>{group.title}</span>
                                {selectedCount === 0 ? (
                                  <span
                                    title={`0 Granted, ${totalInGroup} Not Granted (${totalInGroup} Total)`}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border transition-all bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/60 shadow-xs"
                                  >
                                    <span className="text-rose-600 dark:text-rose-400 font-bold">0</span>
                                    <span className="text-rose-400/60 dark:text-rose-400/50 font-normal">/</span>
                                    <span className="text-rose-600/80 dark:text-rose-400/80 font-bold">{totalInGroup}</span>
                                  </span>
                                ) : isFullySelected ? (
                                  <span
                                    title={`All ${totalInGroup} Permissions Granted (${totalInGroup}/${totalInGroup})`}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border transition-all bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/60 shadow-xs"
                                  >
                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{selectedCount}</span>
                                    <span className="text-emerald-500/60 dark:text-emerald-400/50 font-normal">/</span>
                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{totalInGroup}</span>
                                  </span>
                                ) : (
                                  <span
                                    title={`${selectedCount} Granted (Green), ${totalInGroup - selectedCount} Not Granted of ${totalInGroup} Total`}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded font-bold border transition-all bg-slate-100 dark:bg-slate-800/90 border-slate-200 dark:border-slate-700/80 shadow-xs"
                                  >
                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{selectedCount}</span>
                                    <span className="text-slate-400 dark:text-slate-500 font-normal">/</span>
                                    <span className="text-yellow-600 dark:text-yellow-400 font-bold">{totalInGroup}</span>
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const isModalTargetSuperAdmin =
                                    modalActivePreset === 'SUPER_ADMIN' ||
                                    permissionModalUser?.role === 'SUPER ADMIN' ||
                                    permissionModalUser?.role === 'SUPER_ADMIN' ||
                                    permissionModalUser?.id === 'SUPER_ADMIN' ||
                                    permissionModalUser?.id === 'TMODLSUNSARI';
                                  const allowedGroupPermIds = groupPermIds.filter(
                                    (id) => isModalTargetSuperAdmin || (id !== 'dashboard.view' && id !== 'dashboard.tables')
                                  );
                                  if (isFullySelected) {
                                    setModalPermissions((prev) => prev.filter((id) => !groupPermIds.includes(id)));
                                  } else {
                                    setModalPermissions((prev) => Array.from(new Set([...prev, ...allowedGroupPermIds])));
                                  }
                                }}
                                className={`text-[10px] font-bold font-mono hover:underline ${modalTheme.headerTitleClass}`}
                              >
                                {isFullySelected ? 'Deselect Group' : 'Select Group'}
                              </button>
                            </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                            {group.permissions.map((perm) => {
                              const isChecked = modalPermissions.includes(perm.id);
                              const isSuperAdminOnly = perm.id === 'dashboard.view' || perm.id === 'dashboard.tables';
                              const isModalTargetSuperAdmin =
                                modalActivePreset === 'SUPER_ADMIN' ||
                                permissionModalUser?.role === 'SUPER ADMIN' ||
                                permissionModalUser?.role === 'SUPER_ADMIN' ||
                                permissionModalUser?.id === 'SUPER_ADMIN' ||
                                permissionModalUser?.id === 'TMODLSUNSARI';
                              const isRestricted = isSuperAdminOnly && !isModalTargetSuperAdmin;

                              return (
                                <label
                                  key={perm.id}
                                  title={isRestricted ? 'This permission is strictly reserved for Super Administrators only' : undefined}
                                  className={`flex items-start gap-2 p-1.5 rounded text-xs transition-colors ${
                                    isRestricted
                                      ? 'opacity-60 cursor-not-allowed text-slate-400 dark:text-slate-500'
                                      : isChecked
                                      ? modalTheme.itemChecked
                                      : 'cursor-pointer text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/40'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={isRestricted}
                                    onChange={() => {
                                      if (isRestricted) return;
                                      setModalPermissions((prev) =>
                                        prev.includes(perm.id)
                                          ? prev.filter((p) => p !== perm.id)
                                          : [...prev, perm.id]
                                      );
                                    }}
                                    className={`mt-0.5 rounded border-slate-300 dark:border-slate-600 ${modalTheme.checkboxClass} ${
                                      isRestricted ? 'cursor-not-allowed opacity-50' : ''
                                    }`}
                                  />
                                  <span className="leading-tight flex items-center gap-1.5 flex-wrap">
                                    <span>{perm.name}</span>
                                    {isSuperAdminOnly && (
                                      <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-bold">
                                        SUPER ADMIN ONLY
                                      </span>
                                    )}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </>
                );
              })()}
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-[#162846] flex items-center justify-end gap-3 bg-slate-50 dark:bg-[#050C18]">
              <button
                type="button"
                onClick={() => setPermissionModalUser(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-mono font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModalPermissions}
                disabled={savingPermissions}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2 shadow-sm transition-all"
              >
                {savingPermissions && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Permissions</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: RESET PASSWORD MODAL */}
      {/* ========================================================================= */}
      {resetModalUser && (() => {
        const isTargetSuper = getUserRoleCategory(resetModalUser) === 'SUPER_ADMIN';
        const officialDefaultPwd = isTargetSuper ? 'Itahari@PLSMS' : 'Itahari@2026';

        return (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#1E3B66] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 transition-colors">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 font-mono">
                  <Key className="w-4 h-4 text-sky-600 dark:text-[#38BDF8]" />
                  Reset Password: {resetModalUser.name}
                </h3>
                <button
                  type="button"
                  onClick={() => setResetModalUser(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between bg-slate-50 dark:bg-[#091527] p-2.5 rounded-xl border border-slate-200 dark:border-[#162C4E]">
                <div>
                  <span className="text-slate-900 dark:text-white font-bold">{resetModalUser.name}</span>{' '}
                  <span className="font-mono text-slate-400">({resetModalUser.id})</span>
                </div>
                {isTargetSuper ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black font-mono bg-amber-100 dark:bg-amber-950/80 border border-amber-400 text-amber-800 dark:text-amber-300">
                    👑 SUPER ADMIN
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black font-mono bg-sky-100 dark:bg-sky-950/80 border border-sky-400 text-sky-800 dark:text-[#38BDF8]">
                    🛡️ STAFF / OPERATOR
                  </span>
                )}
              </div>

              {/* AUTOMATIC RESET TO SYSTEM DEFAULT CARD */}
              <div className={`p-4 rounded-xl border transition-all ${
                isTargetSuper
                  ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700/60'
                  : 'bg-sky-50/80 dark:bg-sky-950/30 border-sky-300 dark:border-sky-700/60'
              }`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className={`w-4 h-4 ${isTargetSuper ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400'}`} />
                    <span className="text-xs font-black font-mono uppercase tracking-wide text-slate-900 dark:text-white">
                      Official System Default Reset
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-black ${
                    isTargetSuper
                      ? 'bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200'
                      : 'bg-sky-200 dark:bg-sky-900/60 text-sky-900 dark:text-sky-200'
                  }`}>
                    {isTargetSuper ? 'Yellow (Super Admin)' : 'Blue (Staff User)'}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-mono">
                      Target Role Default Password:
                    </span>
                    <span className={`text-base font-black font-mono tracking-wider ${
                      isTargetSuper ? 'text-amber-700 dark:text-amber-300' : 'text-sky-700 dark:text-[#38BDF8]'
                    }`}>
                      {officialDefaultPwd}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleExecuteAutoResetDefaultPassword}
                    disabled={resettingPassword}
                    className={`px-4 py-2 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-2 shadow-sm transition-all ${
                      isTargetSuper
                        ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-amber-500/20'
                        : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-600/20'
                    }`}
                  >
                    {resettingPassword ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Key className="w-3.5 h-3.5" />
                    )}
                    <span>Auto-Reset to Default</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 font-mono">
                  * User will be forced to choose their own personal password upon next login.
                </p>
              </div>

              {/* OR CUSTOM PASSWORD SECTION */}
              <div className="pt-2 border-t border-slate-200 dark:border-[#162846] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono">
                    OR SET CUSTOM TEMPORARY PASSWORD
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-400 font-mono">Presets:</span>
                    <button
                      type="button"
                      onClick={() => setResetNewPassword('Itahari@2026')}
                      className="px-2 py-0.5 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/80 border border-sky-400 text-sky-700 dark:text-[#38BDF8] rounded text-[10px] font-mono font-bold transition-all"
                      title="Staff default password (Blue)"
                    >
                      Itahari@2026
                    </button>
                    <button
                      type="button"
                      onClick={() => setResetNewPassword('Itahari@PLSMS')}
                      className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/80 border border-amber-400 text-amber-700 dark:text-amber-300 rounded text-[10px] font-mono font-bold transition-all"
                      title="Super Admin default password (Yellow)"
                    >
                      Itahari@PLSMS
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                    className="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                    placeholder="Enter custom password..."
                  />
                  <button
                    type="button"
                    onClick={() => setResetNewPassword(generateStrongPassword('Plsms'))}
                    className="px-3 py-2.5 bg-white dark:bg-[#0B172B] hover:bg-slate-100 dark:hover:bg-[#122442] border border-slate-300 dark:border-[#1E3B66] rounded-xl text-xs font-bold text-sky-700 dark:text-[#38BDF8] flex items-center gap-1 font-mono shadow-sm"
                    title="Generate Strong Password"
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>Random</span>
                  </button>
                </div>

                {/* Password Strength Meter */}
                <div>
                  <PasswordStrengthMeter
                    validation={validatePasswordStrength(resetNewPassword)}
                    password={resetNewPassword}
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-[#162846]">
                <button
                  type="button"
                  onClick={() => setResetModalUser(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteResetPassword}
                  disabled={resettingPassword}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2 shadow-sm transition-all"
                >
                  {resettingPassword && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Custom Password</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL 3: REVOKE USER CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {revokeModalUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#070F1E] border border-rose-200 dark:border-rose-900/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 transition-colors">
            <h3 className="text-base font-bold text-rose-600 dark:text-rose-300 flex items-center gap-2 font-mono">
              <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              Revoke User Account: {revokeModalUser.name}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Are you sure you want to revoke and permanently delete User ID <strong className="font-mono text-slate-900 dark:text-white">{revokeModalUser.id}</strong>? This user will immediately lose access to the system.
            </p>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRevokeModalUser(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRevokeUser}
                disabled={revokingUser}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2 shadow transition-all"
              >
                {revokingUser && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Yes, Revoke User</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: STAFF SELF PASSWORD CHANGE MODAL */}
      {/* ========================================================================= */}
      {selfPasswordModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#1E3B66] rounded-2xl max-w-lg w-full p-6 sm:p-7 shadow-2xl space-y-4 transition-colors">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#162846] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 flex items-center justify-center">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white font-mono uppercase tracking-wider">
                    Change My Password
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Logged in as: <strong className="text-slate-800 dark:text-slate-200">{user?.name || 'Staff User'}</strong> ({user?.id})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelfPasswordModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all font-bold text-sm"
              >
                ✕
              </button>
            </div>

            {/* Success or Error Feedback */}
            {selfPasswordError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{selfPasswordError}</span>
              </div>
            )}
            {selfPasswordSuccess && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-900 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                <span>{selfPasswordSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSelfPasswordChange} className="space-y-4">
              {/* Current Password */}
              <div>
                <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono">
                  CURRENT PASSWORD (OPTIONAL IF FIRST LOGIN)
                </label>
                <div className="relative">
                  <input
                    type={showSelfCurrentPassword ? 'text' : 'password'}
                    value={selfCurrentPassword}
                    onChange={(e) => setSelfCurrentPassword(e.target.value)}
                    placeholder="Enter your current password"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSelfCurrentPassword(!showSelfCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showSelfCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono">
                    NEW PASSWORD <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const strong = generateStrongPassword('Komal');
                      setSelfNewPassword(strong);
                      setSelfConfirmPassword(strong);
                    }}
                    className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>Auto-Suggest Strong</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showSelfNewPassword ? 'text' : 'password'}
                    required
                    value={selfNewPassword}
                    onChange={(e) => setSelfNewPassword(e.target.value)}
                    placeholder="At least 6 characters (letters & numbers/symbols)"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#081326] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSelfNewPassword(!showSelfNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showSelfNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Password Strength Meter */}
                <div className="mt-2.5">
                  <PasswordStrengthMeter
                    validation={validatePasswordStrength(selfNewPassword)}
                    password={selfNewPassword}
                  />
                </div>
              </div>

              {/* Confirm New Password */}
              <div>
                <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono">
                  CONFIRM NEW PASSWORD <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSelfConfirmPassword ? 'text' : 'password'}
                    required
                    value={selfConfirmPassword}
                    onChange={(e) => setSelfConfirmPassword(e.target.value)}
                    placeholder="Re-enter your new password"
                    className={`w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#081326] border rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none pr-10 ${
                      selfConfirmPassword && selfConfirmPassword === selfNewPassword
                        ? 'border-emerald-500 ring-1 ring-emerald-500'
                        : 'border-slate-300 dark:border-[#1A3158] focus:border-indigo-500'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSelfConfirmPassword(!showSelfConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showSelfConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {selfConfirmPassword && selfConfirmPassword === selfNewPassword && (
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono mt-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Passwords match!</span>
                  </p>
                )}
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-[#162846]">
                <button
                  type="button"
                  onClick={() => setSelfPasswordModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={selfChangingPassword || !validatePasswordStrength(selfNewPassword).isValid}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2 shadow-sm transition-all"
                >
                  {selfChangingPassword && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Update Password</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* WIDE HORIZONTAL RECTANGULAR DIALOG: PERMISSIONS SAVED & CONFIRMED         */}
      {/* ========================================================================= */}
      {showPermissionsSavedModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#081326] border border-slate-200 dark:border-[#1C335A] rounded-2xl shadow-2xl max-w-2xl w-full p-6 sm:p-7 space-y-5 transition-all text-slate-900 dark:text-white">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#14233C] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black tracking-wide font-mono text-slate-900 dark:text-white uppercase">
                    PERMISSIONS CONFIRMED & SAVED
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                    Printed License Search Management System (PLSMS) • Access Control
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPermissionsSavedModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Horizontal 3-Column Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
              <div className="p-3 bg-slate-50 dark:bg-[#050C18] border border-slate-200 dark:border-[#14233C] rounded-xl">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  SYSTEM ROLE
                </span>
                <span className="text-xs font-bold text-sky-600 dark:text-[#38BDF8] mt-0.5 block truncate">
                  {operationalRole}
                </span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-[#050C18] border border-slate-200 dark:border-[#14233C] rounded-xl">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  GRANTED ACCESS
                </span>
                <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                  {selectedPermissions.length} / {TOTAL_PERMISSIONS_COUNT} Features
                </span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-[#050C18] border border-slate-200 dark:border-[#14233C] rounded-xl">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  ACTION TO UNLOCK
                </span>
                <span className="text-xs font-bold text-sky-600 dark:text-[#38BDF8] mt-0.5 flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5" />
                  + CREATE USER ID
                </span>
              </div>
            </div>

            {/* Explanatory Banner */}
            <div className="p-4 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 rounded-xl text-xs text-sky-900 dark:text-sky-300 space-y-1">
              <p className="font-bold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-sky-500 shrink-0" />
                <span>Please confirm and proceed with the selected permissions for this user profile.</span>
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 pl-6">
                Clicking <strong>"PROCEED TO CREATE USER ID"</strong> will immediately change the button to <strong>"SAVED PERMISSIONS"</strong> and activate the <strong>"+ CREATE USER ID"</strong> button.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowPermissionsSavedModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-full text-xs font-mono font-bold transition-all"
              >
                CANCEL
              </button>
              <button
                type="button"
                id="btn-proceed-create-user-id"
                onClick={handleProceedToCreateUserId}
                className="px-6 py-2.5 bg-[#0284C7] hover:bg-[#0369A1] active:bg-[#075985] text-white font-mono text-xs font-bold uppercase rounded-full shadow-md transition-all flex items-center gap-2 shadow-[0_0_18px_rgba(2,132,199,0.5)] active:scale-[0.98]"
              >
                <span>PROCEED TO CREATE USER ID</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUCCESS DIALOG: USER CREATED SUCCESSFULLY (SUPER USER) */}
      {/* ========================================================================= */}
      <UserCreatedSuccessModal
        isOpen={Boolean(createdUserSuccessInfo)}
        onClose={() => setCreatedUserSuccessInfo(null)}
        user={createdUserSuccessInfo}
      />

      {/* ========================================================================= */}
      {/* 2-STEP VERIFICATION DIALOG MODAL CARD FOR UPLOAD CENTER                   */}
      {/* ========================================================================= */}
      {showUploadCenterVerifyModal && !isUploadCenterCleared && userCanAccessUploadCenter && (
        <UploadCenterVerificationCard
          isModal={true}
          user={user}
          timeoutNotice={uploadCenterTimeoutNotice}
          onClearTimeoutNotice={() => setUploadCenterTimeoutNotice(null)}
          onSuccess={() => {
            setIsUploadCenterCleared(true);
            setUploadCenterTimeoutNotice(null);
            setShowUploadCenterVerifyModal(false);
            setActiveTab('UPLOAD_CENTER');
            handledInitialTabRef.current = 'UPLOAD_CENTER';
            onTabChange?.('UPLOAD_CENTER');
            lastActivityTimestampRef.current = Date.now();
            sessionStorage.setItem('plsms_upload_center_last_active', Date.now().toString());
            setIdleRemainingSeconds(120);
          }}
          onCancel={() => {
            setShowUploadCenterVerifyModal(false);
            setUploadCenterTimeoutNotice(null);
            if (activeTab === 'UPLOAD_CENTER') {
              setActiveTab('USERS_ROLES');
              onTabChange?.('USERS_ROLES');
            }
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* SQUARE SHAPE FLOATING ACCESS DENIED MESSAGE FOR OTHER USERS               */}
      {/* ========================================================================= */}
      <UploadCenterAccessDeniedModal
        isOpen={showAccessDeniedModal}
        onClose={() => {
          setShowAccessDeniedModal(false);
          setActiveTab('USERS_ROLES');
          onTabChange?.('USERS_ROLES');
        }}
        user={user}
      />
    </div>
  );
};
