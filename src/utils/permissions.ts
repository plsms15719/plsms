import { User } from '../types';

/**
 * Equivalent / interchangeable permission IDs across different menus and legacy naming
 */
const PERMISSION_EQUIVALENTS: Record<string, string[]> = {
  'dashboard.view': ['dashboard.view'],
  'dashboard.export': ['dashboard.export_summary', 'dashboard.export', 'reports.view_analytics'],
  'records.search': ['records.search'],
  'records.view': ['records.view', 'records.search'],
  'records.distribute': ['records.distribute'],
  'records.undo_distribution': ['records.undo_distribution'],
  'records.mark_missing': ['records.mark_missing', 'records.search_mark_missing'],
  'records.search_mark_missing': ['records.search_mark_missing', 'records.mark_missing'],
  'records.unmark_missing': ['records.unmark_missing', 'found.verify'],
  'found.view': ['found.view', 'records.unmark_missing', 'found.verify'],
  'found.verify': ['found.verify', 'records.unmark_missing'],
  'found.details': ['found.details', 'records.view', 'found.view'],
  'found.export': ['found.export', 'records.export_excel', 'reports.export_csv'],
  'records.excel_upload': ['records.excel_upload', 'uploads.upload_excel'],
  'uploads.operational_console': ['uploads.operational_console', 'uploads.upload_center', 'uploads.operational'],
  'uploads.upload_center': ['uploads.upload_center', 'uploads.operational_console', 'uploads.operational'],
  'records.export_excel': ['records.export_excel', 'reports.export_csv'],
  'records.export_pdf': ['records.export_pdf', 'reports.generate_ledger'],
  'records.edit': ['records.edit'],
  'records.delete': ['records.delete'],
  'notices.view': ['notices.view'],
  'notices.manage': ['notices.manage'],
  'notices.delete': ['notices.delete'],
  'reports.view': ['reports.generate_ledger', 'reports.view_analytics', 'reports.export_csv', 'reports.audit_summary', 'records.export_excel', 'records.export_pdf'],
  'audit.view': ['security.view_audit_logs', 'audit.view'],
  'audit.export': ['security.export_audit_logs', 'audit.export'],
  'users.view': ['user.edit', 'user.create', 'user.permissions', 'user.delete', 'user.suspend', 'users.view'],
  'users.create': ['user.create', 'users.create'],
  'users.edit': ['user.edit', 'users.edit'],
  'users.password_reset': ['user.password_reset', 'users.password_reset'],
  'users.permissions': ['user.permissions', 'users.permissions'],
  'users.status': ['user.suspend', 'users.status', 'user.status'],
  'users.delete': ['user.delete', 'users.delete'],
  'cloud.sheets_sync': ['cloud.sheets_sync', 'uploads.google_sheets_sync'],
  'cloud.sheets_config': ['cloud.sheets_config'],
  'database.backup': ['cloud.backup_create', 'cloud.backup_download', 'database.backup'],
  'database.restore': ['cloud.backup_restore', 'database.restore'],
  'database.reset': ['cloud.database_purge', 'database.reset'],
  'settings.sync_interval': ['settings.sync_interval', 'uploads.sync_interval', 'records.sync_interval'],
  'uploads.sync_interval': ['uploads.sync_interval', 'settings.sync_interval', 'records.sync_interval'],
  'settings.view': ['settings.view', 'settings.general'],
  'settings.general': ['settings.general', 'settings.view'],
  'settings.mpin_manage': ['settings.mpin_manage'],
  'settings.security_timeout': ['settings.security_timeout'],
  'settings.print_layout': ['settings.print_layout'],
  'settings.backup_manage': ['settings.backup_manage', 'cloud.backup_create', 'database.backup'],
  'settings.maintenance': ['settings.maintenance'],
  'settings.emergency_lock': ['settings.emergency_lock'],
};

/**
 * Checks whether a user possesses a specific permission.
 * Strict Logic:
 * -- If the items are ticked (or wildcard '*' granted), the user has access (returns true).
 * -- If the item is unticked / not selected, the user has NO access (returns false).
 */
export const hasPermission = (
  user: User | { role?: string; permissions?: string[]; id?: string; email?: string } | null | undefined,
  permissionId: string
): boolean => {
  if (!user) return false;

  // Strict policy: 'dashboard.view' and 'dashboard.tables' are strictly reserved for SUPER ADMIN users only
  if (permissionId === 'dashboard.view' || permissionId === 'dashboard.tables') {
    return isSuperAdminUser(user);
  }

  // 1. If user has an explicit permissions array, evaluate strictly against it
  if (Array.isArray(user.permissions)) {
    if (user.permissions.includes('*')) return true;
    if (user.permissions.includes(permissionId)) return true;

    // Check equivalents
    const eqList = PERMISSION_EQUIVALENTS[permissionId];
    if (eqList && eqList.some((eq) => user.permissions!.includes(eq))) {
      return true;
    }

    // Also check reverse alias lookup
    for (const [canonical, aliases] of Object.entries(PERMISSION_EQUIVALENTS)) {
      if (aliases.includes(permissionId) && user.permissions.includes(canonical)) {
        return true;
      }
    }

    // Strict unticked: not found in user's permissions
    return false;
  }

  // 2. Fallback only if permissions array is undefined:
  // Root Super Admin / Owner has full access by default
  const roleUpper = (user.role || '').toUpperCase();
  if (
    roleUpper === 'SUPER ADMIN' ||
    roleUpper === 'SUPER_ADMIN' ||
    roleUpper === 'OWNER_ADMIN' ||
    user.id === 'user_superadmin'
  ) {
    return true;
  }

  return false;
};

/**
 * Checks if user has ANY of the specified permissions
 */
export const hasAnyPermission = (
  user: User | { role?: string; permissions?: string[]; id?: string } | null | undefined,
  permissionIds: string[]
): boolean => {
  if (!user || !permissionIds || permissionIds.length === 0) return false;
  return permissionIds.some((pid) => hasPermission(user, pid));
};

/**
 * Checks whether a user is strictly a Super Administrator.
 * Only returns true for official Super Admin roles / accounts.
 * Returns false for all other users (Administrators, Data Entry Officers, Smart Card Distributors, etc.).
 */
export const isSuperAdminUser = (
  user: User | { role?: string; id?: string; email?: string } | null | undefined
): boolean => {
  if (!user) return false;
  const roleUpper = (user.role || '').trim().toUpperCase();
  const idUpper = (user.id || '').trim().toUpperCase();
  const emailLower = (user.email || '').trim().toLowerCase();

  return (
    roleUpper === 'SUPER_ADMIN' ||
    roleUpper === 'SUPER ADMIN' ||
    roleUpper === 'SUPERADMIN' ||
    roleUpper === 'SUPER ADMINISTRATOR' ||
    idUpper === 'SUPER_ADMIN' ||
    idUpper === 'TMODLSUNSARI' ||
    idUpper === 'USER_SUPERADMIN' ||
    idUpper.startsWith('USER_SUPER_ADMIN_') ||
    emailLower === 'dahalkomal@gmail.com' ||
    emailLower === 'tmodlsunsari@gmail.com'
  );
};

/**
 * Checks whether a user has permission to access the Upload Center console / features.
 * - Super Administrators have full access by default.
 * - Subordinate / created users have access ONLY IF the Super Admin explicitly granted them
 *   Upload Center or Cloud / Sync permissions (e.g., 'records.excel_upload', 'records.manual_entry',
 *   'records.bulk_status_update', 'uploads.sync_interval', 'cloud.sheets_sync', 'cloud.sheets_config', etc.)
 * - Users without these permissions are stopped completely and strictly.
 */
export const canAccessUploadCenter = (
  user: User | { role?: string; permissions?: string[]; id?: string; email?: string } | null | undefined
): boolean => {
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;

  const uploadAndSyncPermissions = [
    // Direct Upload Center permissions
    'uploads.operational_console',
    'uploads.upload_center',
    'uploads.operational',
    'records.excel_upload',
    'uploads.upload_excel',
    'records.manual_entry',
    'records.bulk_status_update',
    'uploads.sync_interval',
    'records.sync_interval',
    // System Settings permissions ticked by Super Admin (Security mPIN & Authorization keys, Sync schedule, etc.)
    'settings.mpin_manage',
    'settings.security_timeout',
    'settings.sync_interval',
    'settings.backup_manage',
    'settings.maintenance',
    'settings.emergency_lock',
    // Database & Cloud Control permissions
    'cloud.sheets_sync',
    'uploads.google_sheets_sync',
    'cloud.sheets_config',
    'cloud.backup_create',
    'cloud.backup_download',
    'cloud.backup_restore',
    'cloud.database_purge',
    'database.backup',
    'database.restore',
    'database.reset',
    'menu_upload',
    'menu_cloud',
  ];

  if (Array.isArray(user.permissions)) {
    if (user.permissions.includes('*')) return true;
    if (
      user.permissions.some(
        (p) =>
          p &&
          (p.startsWith('uploads.') ||
            p === 'settings.mpin_manage' ||
            p === 'settings.sync_interval' ||
            p === 'settings.backup_manage' ||
            p === 'settings.security_timeout' ||
            uploadAndSyncPermissions.includes(p))
      )
    ) {
      return true;
    }
  }

  return hasAnyPermission(user, uploadAndSyncPermissions);
};

/**
 * Checks if the user has permission to use the upload or sync engines.
 * Strictly checks that the user is either a Super Admin OR has been explicitly granted
 * Upload / Sync / Upload Center permission by the Super Admin.
 */
export const hasUploadOrSyncPermission = (
  user: User | { role?: string; permissions?: string[]; id?: string; email?: string } | null | undefined
): boolean => {
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;
  return canAccessUploadCenter(user);
};

/**
 * Checks if user has ALL of the specified permissions
 */
export const hasAllPermissions = (
  user: User | { role?: string; permissions?: string[]; id?: string } | null | undefined,
  permissionIds: string[]
): boolean => {
  if (!user || !permissionIds || permissionIds.length === 0) return false;
  return permissionIds.every((pid) => hasPermission(user, pid));
};
