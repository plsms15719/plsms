import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { createServer as createViteServer } from 'vite';
import { parseUploadedSpreadsheet, XLSX } from './server/excelParser';
import { getBikramSambatDate, getNepaliDevanagariBSDate } from './server/nepaliDate';
import {
  getGoogleSheetsConfig,
  saveGoogleSheetsConfig,
  syncFromGoogleSheets,
  benchmarkSearchLatency,
  start24hBackgroundSyncDaemon,
  stop24hBackgroundSyncDaemon,
  update24hSyncDaemonSettings,
  runDaemonSyncCycle,
  updateGoogleSheetDistribution,
  queueGoogleSheetDistribution,
  getSheetQueueStatus,
  batchUpdateGoogleSheetDistributions,
  APPS_SCRIPT_HASH_INDEX_CODE,
  syncSheetStatsWithDatabase,
  updateInMemoryGoogleSheetRecord,
  autoSyncCategoryHandler,
  getCrossPlatformParityStats,
  importSheetNameFromLinkedSheet,
  resetGoogleSheetsSyncState,
  notifyDatabaseResetOrRestore,
} from './server/googleSheetsSync';

import {
  isSetupCompleted,
  getUsers,
  saveUsers,
  logAudit,
  getAuditLogs,
  resetAuditLogs,
  getImportJobs,
  saveImportJob,
  deleteImportJob,
  clearAllMasterData,
  resetProductionDatabase,
  getDistributions,
  getAllRecords,
  getRecordById,
  findRecordByNumber,
  searchRecords,
  getProbableSuggestions,
  updateRecordStatus,
  updateRecordPhone,
  updateSubmittedDocument,
  recordHandover,
  resetRecordDistribution,
  correctRecordDistribution,
  batchInsertOrUpdateRecords,
  isRecordDistributed,
  isRecordFound,
  isRecordMissing,
  resolveUserFullName,
  getDashboardStats,
  invalidateRecordsCache,
  getDistributedViewRecords,
  getMissingViewRecords,
  getFoundViewRecords,
  getHandedOverViewRecords,
  getInventoryIdentitySummary,
  getAlphabeticalDashboardStats,
  getNotices,
  getNoticeById,
  createNotice,
  updateNotice,
  deleteNotice,
  toggleNoticeStatus,
  getVisitorCounter,
  incrementVisitorCounter,
  setVisitorCounter,
  getSecurityPinStatus,
  verifySecurityMpin,
  updateSecurityMpin,
  resetSecurityMpinToDefault,
  OFFICIAL_SYSTEM_LOCATIONS,
  getActionOverrides,
  reconcileDistributionsFromRecords,
  createSystemBackupArchive,
  inspectSystemBackupArchive,
  restoreSystemBackupArchive,
} from './server/db';
import { User, LicenseRecord, ImportJob, ColumnMapping, OfficeNotice } from './src/types';

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'plsms-enterprise-super-admin-secret-key-2026';
const STORAGE_UPLOADS = path.join(process.cwd(), 'data_storage', 'uploads');

if (!fs.existsSync(STORAGE_UPLOADS)) {
  fs.mkdirSync(STORAGE_UPLOADS, { recursive: true });
}

/**
 * Normalizes code numbers so placeholder dashes never exceed 4 dashes ("----").
 */
function normalizeCodeDashes(val: unknown): string {
  if (val === undefined || val === null) return '----';
  const str = String(val).trim();
  if (!str) return '----';
  const stripped = str.replace(/[\s\-_—–./\\]/g, '');
  if (!stripped || /^(na|n\/a|null|none|nil|undefined|0)$/i.test(stripped)) {
    return '----';
  }
  let cleaned = str.replace(/(?:[-—–]\s*){4,}/g, '----');
  cleaned = cleaned.replace(/[-—–]{4,}/g, '----');
  return cleaned.trim();
}

// Multer setup for Excel / CSV uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_UPLOADS);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `upload_${Date.now()}_${baseName}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max for huge datasets
});

// Authentication middleware
function requireAuth(req: Request, res: Response, next: express.NextFunction) {
  let authHeader = req.headers.authorization;
  if (!authHeader && req.query.token && typeof req.query.token === 'string') {
    authHeader = `Bearer ${req.query.token}`;
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token required.' });
  }

  const token = authHeader.substring(7);
  try {
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { id: string; email?: string; role: string; name: string };
    } catch (verifyErr: any) {
      if (verifyErr.name === 'TokenExpiredError') {
        // Authenticate expired token against signature to safely allow auto-refresh
        try {
          decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as { id: string; email?: string; role: string; name: string };
        } catch {
          return res.status(401).json({ error: 'Invalid or expired authentication token.' });
        }
      } else {
        return res.status(401).json({ error: 'Invalid or expired authentication token.' });
      }
    }

    const users = getUsers();
    const foundUser = users.find(
      (u) =>
        u.id.toLowerCase() === decoded.id.toLowerCase() ||
        (decoded.email && u.email && u.email.toLowerCase() === decoded.email.toLowerCase())
    );

    if (!foundUser) {
      return res.status(401).json({ error: 'User account no longer exists.' });
    }

    if (foundUser.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Account is suspended. Please contact Super Administrator.' });
    }

    // Auto-refresh token if near expiration or expired to ensure smooth uninterrupted operation
    try {
      const freshToken = jwt.sign(
        { id: foundUser.id, email: foundUser.email, role: foundUser.role, name: foundUser.name },
        JWT_SECRET,
        { expiresIn: '30d' }
      );
      res.setHeader('X-Refreshed-Token', freshToken);
      res.setHeader('Access-Control-Expose-Headers', 'X-Refreshed-Token');
    } catch {
      // Ignore token refresh sign errors
    }

    (req as any).user = {
      ...decoded,
      id: foundUser.id,
      name: foundUser.name,
      role: foundUser.role,
      email: foundUser.email,
      status: foundUser.status,
      permissions: foundUser.permissions || (foundUser.role === 'SUPER_ADMIN' || foundUser.role === 'SUPER ADMIN' ? ['*'] : []),
      mustChangePassword: Boolean(foundUser.mustChangePassword),
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

// Optional Authentication Middleware for public/dashboard metrics
function optionalAuth(req: Request, res: Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.substring(7);
  try {
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (verifyErr: any) {
      if (verifyErr.name === 'TokenExpiredError') {
        try {
          decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as any;
        } catch {
          return next();
        }
      } else {
        return next();
      }
    }

    const users = getUsers();
    const foundUser = users.find(
      (u) =>
        u.id.toLowerCase() === decoded.id.toLowerCase() ||
        (decoded.email && u.email && u.email.toLowerCase() === decoded.email.toLowerCase())
    );

    if (foundUser && foundUser.status !== 'SUSPENDED') {
      try {
        const freshToken = jwt.sign(
          { id: foundUser.id, email: foundUser.email, role: foundUser.role, name: foundUser.name },
          JWT_SECRET,
          { expiresIn: '30d' }
        );
        res.setHeader('X-Refreshed-Token', freshToken);
        res.setHeader('Access-Control-Expose-Headers', 'X-Refreshed-Token');
      } catch {
        // Ignore refresh errors
      }

      (req as any).user = {
        ...decoded,
        id: foundUser.id,
        name: foundUser.name,
        role: foundUser.role,
        email: foundUser.email,
        status: foundUser.status,
        permissions: foundUser.permissions || (foundUser.role === 'SUPER_ADMIN' || foundUser.role === 'SUPER ADMIN' ? ['*'] : []),
        mustChangePassword: Boolean(foundUser.mustChangePassword),
      };
    }
  } catch {
    // Non-blocking for optionalAuth
  }
  next();
}

function requireSuperAdmin(req: Request, res: Response, next: express.NextFunction) {
  requireAuth(req, res, () => {
    const user = (req as any).user;
    const roleUpper = (user?.role || '').trim().toUpperCase();
    const idUpper = (user?.id || '').trim().toUpperCase();
    if (
      roleUpper === 'SUPER_ADMIN' ||
      roleUpper === 'SUPER ADMIN' ||
      idUpper === 'SUPER_ADMIN' ||
      roleUpper.includes('SUPER')
    ) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: Super Administrator access only.' });
  });
}

function requireAdminOrSuperAdmin(req: Request, res: Response, next: express.NextFunction) {
  requireAuth(req, res, () => {
    const user = (req as any).user;
    const roleUpper = (user?.role || '').trim().toUpperCase();
    const idUpper = (user?.id || '').trim().toUpperCase();
    if (
      roleUpper === 'SUPER_ADMIN' ||
      roleUpper === 'SUPER ADMIN' ||
      roleUpper === 'ADMIN' ||
      roleUpper === 'ADMINISTRATOR' ||
      roleUpper.includes('ADMIN') ||
      roleUpper.includes('SUPER') ||
      idUpper === 'SUPER_ADMIN' ||
      idUpper === 'TMODLSUNSARI' ||
      idUpper === 'DKOMAL_PLSMS5' ||
      user?.permissions?.includes('*') ||
      user?.permissions?.includes('settings.view') ||
      user?.permissions?.includes('user.create') ||
      user?.permissions?.includes('user.edit') ||
      user?.permissions?.includes('notices.manage')
    ) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
  });
}

function requireUploadOrSyncPermission(req: Request, res: Response, next: express.NextFunction) {
  requireAuth(req, res, () => {
    const user = (req as any).user;
    const roleUpper = (user?.role || '').trim().toUpperCase();
    const idUpper = (user?.id || '').trim().toUpperCase();
    const perms: string[] = user?.permissions || [];

    // Super Admin check
    if (
      roleUpper === 'SUPER_ADMIN' ||
      roleUpper === 'SUPER ADMIN' ||
      idUpper === 'SUPER_ADMIN' ||
      idUpper === 'USER_SUPERADMIN' ||
      idUpper === 'TMODLSUNSARI' ||
      roleUpper.includes('SUPER') ||
      perms.includes('*') ||
      user?.email?.toLowerCase() === 'dahalkomal@gmail.com' ||
      user?.email?.toLowerCase() === 'tmodlsunsari@gmail.com'
    ) {
      return next();
    }

    // Check if user has explicit permission granted by Super User for Upload Center / Sync Engine
    const uploadAndSyncPermissions = [
      'uploads.operational_console',
      'uploads.upload_center',
      'uploads.operational',
      'records.excel_upload',
      'uploads.upload_excel',
      'records.manual_entry',
      'records.bulk_status_update',
      'uploads.sync_interval',
      'records.sync_interval',
      'settings.mpin_manage',
      'settings.security_timeout',
      'settings.sync_interval',
      'settings.backup_manage',
      'settings.maintenance',
      'settings.emergency_lock',
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

    const hasUploadPerm = perms.some(
      (p) =>
        p &&
        (p.startsWith('uploads.') ||
          p === 'settings.mpin_manage' ||
          p === 'settings.sync_interval' ||
          p === 'settings.backup_manage' ||
          p === 'settings.security_timeout' ||
          uploadAndSyncPermissions.includes(p))
    );
    if (hasUploadPerm) {
      return next();
    }

    return res.status(403).json({ error: 'Access Denied: You do not have permission to use the upload or sync engines.' });
  });
}

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // ==========================================
  // SYSTEM HEALTH & STATUS
  // ==========================================
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'PLSMS-API', timestamp: new Date().toISOString() });
  });

  app.get('/api/ping', (req: Request, res: Response) => {
    res.json({ pong: true, timestamp: Date.now() });
  });

  app.get('/api/system/status', (req: Request, res: Response) => {
    const users = getUsers();
    const records = getAllRecords();
    res.json({
      systemName: 'PRINTED LICENSE SEARCH MANAGEMENT SYSTEM (PLSMS)',
      usersCount: users.length,
      recordsCount: records.length,
      setupCompleted: users.length > 0,
      timestamp: new Date().toISOString(),
    });
  });

  // ==========================================
  // AUTHENTICATION & FIRST-RUN SUPER ADMIN
  // ==========================================

  // First-run Super Admin creation (Permanently locks once USERS = 1)
  app.post('/api/auth/setup-super-admin', async (req: Request, res: Response) => {
    const users = getUsers();
    if (users.length > 0) {
      return res.status(403).json({
        error: 'Setup is permanently locked. A Super Administrator account already exists.',
      });
    }

    const { email, password, name } = req.body;
    if (!email || !password || password.length < 6) {
      return res.status(400).json({
        error: 'Valid email/user ID and password (minimum 6 characters) are required.',
      });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const superAdminUser: User & { passwordHash: string } = {
        id: 'USER_SUPER_ADMIN_' + Date.now(),
        email: email.trim().toLowerCase(),
        name: (name && name.trim()) || 'Super Administrator',
        role: 'SUPER_ADMIN',
        createdAt: new Date().toISOString(),
        passwordHash: hashedPassword,
      };

      saveUsers([superAdminUser]);
      logAudit(
        superAdminUser.id,
        superAdminUser.name,
        'SUPER_ADMIN_INITIAL_SETUP',
        'AUTH',
        `Super Administrator initialized (${superAdminUser.email}). First-run setup permanently locked.`,
        req.ip
      );

      const token = jwt.sign(
        { id: superAdminUser.id, email: superAdminUser.email, role: superAdminUser.role, name: superAdminUser.name },
        JWT_SECRET,
        { expiresIn: '12h' }
      );

      const { passwordHash, ...userClean } = superAdminUser;
      res.json({
        success: true,
        message: 'Super Administrator created successfully.',
        user: userClean,
        token,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create Super Admin account: ' + err.message });
    }
  });

// Helper to find registered user by exact 100% match against User ID, Email Address, Name, or Phone in database
function findUserByIdentifier(users: (User & { passwordHash?: string })[], identifier: string) {
  if (!identifier) return undefined;
  const inputUpper = identifier.trim().toUpperCase();
  if (!inputUpper) return undefined;

  return users.find((u) => {
    const userIdUpper = (u.id || '').trim().toUpperCase();
    const userEmailUpper = (u.email || '').trim().toUpperCase();
    const userNameUpper = (u.name || '').trim().toUpperCase();
    const userPhone = (u.phone || '').trim();

    // 100% exact match against User ID (e.g. SUPER_ADMIN, DKOMAL_PLSMS5, TMODLSUNSARI, SDAHAL_PLSMS5)
    if (userIdUpper === inputUpper) return true;

    // 100% exact match against Email Address (e.g. DAHALKOMAL@GMAIL.COM)
    if (userEmailUpper && userEmailUpper === inputUpper) return true;

    // 100% exact match against Full Name (e.g. KOMAL DAHAL)
    if (userNameUpper && userNameUpper === inputUpper) return true;

    // 100% exact match against Phone Number
    if (userPhone && userPhone === inputUpper) return true;

    // Support common official identifier aliases for registered staff
    if (userNameUpper === 'TIKA RAM POKHAREL') {
      if (['TIKARAM', 'TIKA RAM POKHAREL', 'TIKA_RAM_POKHAREL', 'TPOKHAREL', 'TPOKHAREL_PLSMS', 'TPOKHAREL_PLSMS5', 'STAFF_TIKARAM'].includes(inputUpper)) return true;
    }
    if (userNameUpper === 'HEM RAJ BHANDARI') {
      if (['HEMRAJ', 'HEM RAJ BHANDARI', 'HEM_RAJ_BHANDARI', 'HBHANDARI', 'HBHANDARI_PLSMS', 'HBHANDARI_PLSMS5', 'STAFF_HEMRAJ'].includes(inputUpper)) return true;
    }

    return false;
  });
}

// Official PLSMS System Default Passwords
const DEFAULT_SUPER_ADMIN_PASSWORD = 'Itahari@PLSMS'; // Yellow (Super Admin)
const DEFAULT_USER_PASSWORD = 'Itahari@2026';        // Blue (Other Staff)

function isSuperAdminUser(user: { role?: string; id?: string; email?: string }): boolean {
  const role = (user.role || '').toUpperCase();
  const id = (user.id || '').toUpperCase();
  const email = (user.email || '').toLowerCase();
  return (
    role === 'SUPER ADMIN' ||
    role === 'SUPER_ADMIN' ||
    id === 'SUPER_ADMIN' ||
    id === 'TMODLSUNSARI' ||
    id === 'DKOMAL_PLSMS5' ||
    email === 'dahalkomal@gmail.com' ||
    email === 'tmodlsunsari@gmail.com' ||
    email === 'tmodlitahari@gmail.com'
  );
}

// Helper to verify user password with strict 100% cryptographic matching against database records
async function verifyUserPassword(
  user: User & { passwordHash?: string; mustChangePassword?: boolean; isDefaultPassword?: boolean },
  passwordToCheck: string
): Promise<{ valid: boolean; isDefault: boolean }> {
  if (!passwordToCheck || typeof passwordToCheck !== 'string') {
    return { valid: false, isDefault: false };
  }
  const cleanPwd = passwordToCheck.trim();
  if (!cleanPwd) return { valid: false, isDefault: false };

  // 1. Strict 100% cryptographic comparison with saved database bcrypt passwordHash
  if (user.passwordHash) {
    try {
      const isMatch = await bcrypt.compare(cleanPwd, user.passwordHash);
      if (isMatch) {
        const isDefault =
          cleanPwd === DEFAULT_SUPER_ADMIN_PASSWORD ||
          cleanPwd === DEFAULT_USER_PASSWORD;
        return { valid: true, isDefault };
      }
    } catch (err) {
      console.error('Bcrypt compare error:', err);
    }
  }

  // 2. Exact match against official role default password IF account is flagged as default or missing passwordHash
  const isSuper = isSuperAdminUser(user);
  const officialRoleDefault = isSuper ? DEFAULT_SUPER_ADMIN_PASSWORD : DEFAULT_USER_PASSWORD;

  if (cleanPwd === officialRoleDefault) {
    if (user.isDefaultPassword || !user.passwordHash) {
      // Ensure the default password hash is permanently stored in the database right now
      try {
        const newHash = await bcrypt.hash(cleanPwd, 10);
        user.passwordHash = newHash;
        user.isDefaultPassword = true;
        user.mustChangePassword = true;
        const allUsers = getUsers();
        const idx = allUsers.findIndex((u) => u.id.trim().toUpperCase() === user.id.trim().toUpperCase());
        if (idx !== -1) {
          (allUsers[idx] as any).passwordHash = newHash;
          (allUsers[idx] as any).isDefaultPassword = true;
          (allUsers[idx] as any).mustChangePassword = true;
          saveUsers(allUsers);
        }
      } catch (err) {
        console.error('Failed to commit default password hash to DB:', err);
      }
      return { valid: true, isDefault: true };
    }
  }

  // Absolutely NO prefix match, NO partial match, NO startsWith check!
  return { valid: false, isDefault: false };
}

  // System Authentication Login (Supports Email Address or User ID for all roles)
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const loginId = req.body.email || req.body.identifier || req.body.username;
    const password = req.body.password;
    if (!loginId || !password) {
      return res.status(400).json({ error: 'Email / User ID and Password are required.' });
    }

    const users = getUsers() as (User & { passwordHash: string; mustChangePassword?: boolean; isDefaultPassword?: boolean })[];
    if (users.length === 0) {
      return res.status(400).json({
        error: 'System is not configured. Please complete first-run Super Admin setup first.',
      });
    }

    const user = findUserByIdentifier(users, loginId);
    if (!user) {
      logAudit('UNKNOWN', loginId, 'LOGIN_FAILED', 'AUTH', `Failed login attempt for unregistered identifier ${loginId}`, req.ip);
      return res.status(401).json({ error: 'Invalid Email/User ID or Password.' });
    }

    if (user.status === 'SUSPENDED') {
      logAudit(user.id, user.name, 'LOGIN_FAILED', 'AUTH', `Suspended user attempted login: ${user.id}`, req.ip);
      return res.status(403).json({ error: 'Account is suspended. Please contact Super Administrator.' });
    }

    const verifyResult = await verifyUserPassword(user, password);
    if (!verifyResult.valid) {
      logAudit(user.id, user.name, 'LOGIN_FAILED', 'AUTH', `Invalid password entered for ${user.id}`, req.ip);
      return res.status(401).json({ error: 'Invalid Email/User ID or Password.' });
    }

    const isCustomPersonalPassword = !verifyResult.isDefault && user.isDefaultPassword === false;
    const isFirstTime = !isCustomPersonalPassword && (Boolean(user.mustChangePassword) || verifyResult.isDefault);

    if (isFirstTime) {
      user.mustChangePassword = true;
    } else {
      user.mustChangePassword = false;
      user.isDefaultPassword = false;
    }
    user.lastLogin = new Date().toISOString();
    saveUsers(users);

    logAudit(user.id, user.name, 'LOGIN_SUCCESS', 'AUTH', `User ${user.id} (${user.name} - ${user.role}) logged in successfully.`, req.ip);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    const { passwordHash, ...userClean } = user;
    res.json({
      success: true,
      user: userClean,
      token,
      mustChangePassword: Boolean(user.mustChangePassword) || isFirstTime,
      isFirstLogin: isFirstTime,
    });
  });

  // Validate Credentials / Password (Validates if username/email and password match database records)
  app.post('/api/auth/validate-prefix', async (req: Request, res: Response) => {
    try {
      const { identifier, prefix, password } = req.body;
      const pwdToCheck = (password || prefix || '').toString().trim();
      if (!identifier || identifier.trim().length === 0 || !pwdToCheck || pwdToCheck.length === 0) {
        return res.json({ valid: false, userFound: false });
      }

      const users = getUsers() as (User & { passwordHash?: string; passwordPrefix?: string; mustChangePassword?: boolean; isDefaultPassword?: boolean })[];
      const user = findUserByIdentifier(users, identifier);

      if (!user || user.status === 'SUSPENDED' || !user.passwordHash) {
        return res.json({ valid: false, userFound: Boolean(user) });
      }

      const verifyResult = await verifyUserPassword(user, pwdToCheck);
      return res.json({ valid: verifyResult.valid, userFound: true, isDefault: verifyResult.isDefault });
    } catch (err) {
      return res.json({ valid: false });
    }
  });

  // Verify Current User
  app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
    const userPayload = (req as any).user;
    const users = getUsers();
    const found = users.find((u) => u.id.toLowerCase() === userPayload.id.toLowerCase() || (userPayload.email && u.email && u.email.toLowerCase() === userPayload.email.toLowerCase()));
    if (!found) {
      return res.status(401).json({ error: 'User no longer exists.' });
    }
    const { passwordHash, ...userClean } = found as any;
    res.json({ user: userClean });
  });

  // Change Password (Used for regular changes or compulsory first login)
  app.post('/api/auth/change-password', requireAuth, async (req: Request, res: Response) => {
    const { currentPassword, newPassword, isFirstLogin } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    const hasLetters = /[a-zA-Z]/.test(newPassword);
    const hasNumbersOrSymbols = /[^a-zA-Z]/.test(newPassword);
    if (!hasLetters || !hasNumbersOrSymbols) {
      return res.status(400).json({
        error: 'Password must be strong and contain at least 6 mixing characters (letters combined with numbers or special symbols).',
      });
    }

    // Prohibit setting system default passwords as new password
    if (
      newPassword === DEFAULT_SUPER_ADMIN_PASSWORD ||
      newPassword === DEFAULT_USER_PASSWORD ||
      newPassword.toLowerCase() === 'itahari@plsms' ||
      newPassword.toLowerCase() === 'itahari@2026'
    ) {
      return res.status(400).json({
        error: 'New personal password cannot be the system default password. Please choose your own personal confidential password.',
      });
    }

    const userPayload = (req as any).user;
    const users = getUsers() as (User & { passwordHash: string; passwordPrefix?: string; mustChangePassword?: boolean; isDefaultPassword?: boolean })[];
    const userIndex = users.findIndex((u) => u.id.toLowerCase() === userPayload.id.toLowerCase());
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    const user = users[userIndex];
    if (currentPassword) {
      const verifyCurrent = await verifyUserPassword(user, currentPassword);
      if (!verifyCurrent.valid) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
    }

    if (user.passwordHash) {
      const isSameAsOld = await bcrypt.compare(newPassword, user.passwordHash);
      if (isSameAsOld) {
        return res.status(400).json({ error: 'New password cannot be the same as your old temporary password. Please choose a different secure password.' });
      }
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    delete (user as any).passwordPrefix;
    user.mustChangePassword = false;
    user.isDefaultPassword = false;
    saveUsers(users);

    logAudit(user.id, user.name, 'PASSWORD_CHANGE', 'SECURITY', `Password updated successfully for ${user.id} (${isFirstLogin ? 'Compulsory first login' : 'User profile update'}).`, req.ip);
    
    const { passwordHash, ...userClean } = user;
    res.json({ success: true, message: 'Password updated successfully.', user: userClean });
  });

  // ==========================================
  // STAFF USERS & PERMISSIONS MANAGEMENT API
  // ==========================================
  app.get('/api/admin/users', requireAuth, (req: Request, res: Response) => {
    const reqUser = (req as any).user;
    const isSuperAdmin =
      reqUser?.role === 'SUPER_ADMIN' ||
      reqUser?.role === 'SUPER ADMIN' ||
      reqUser?.id?.toUpperCase() === 'SUPER_ADMIN' ||
      reqUser?.id?.toUpperCase() === 'TMODLSUNSARI' ||
      reqUser?.id?.toUpperCase() === 'DKOMAL_PLSMS5' ||
      isSuperAdminUser(reqUser);

    const isAdmin =
      reqUser?.role === 'ADMINISTRATOR' ||
      reqUser?.role === 'ADMIN' ||
      (Array.isArray(reqUser?.permissions) &&
        (reqUser.permissions.includes('*') ||
          reqUser.permissions.includes('settings.view') ||
          reqUser.permissions.includes('user.view') ||
          reqUser.permissions.includes('user.edit') ||
          reqUser.permissions.includes('user.create')));

    const users = getUsers() as (User & { passwordHash?: string })[];
    let safeUsers = users.map(({ passwordHash, ...u }) => ({
      ...u,
      status: u.status || 'ACTIVE',
      permissions: u.permissions || (u.role === 'SUPER_ADMIN' || u.role === 'SUPER ADMIN' ? ['*'] : []),
    }));

    // Non-admin staff without user management permissions see only their own record
    if (!isSuperAdmin && !isAdmin && reqUser) {
      safeUsers = safeUsers.filter((u) => {
        const matchId = Boolean(u.id && reqUser.id && u.id.toLowerCase() === reqUser.id.toLowerCase());
        const matchEmail = Boolean(u.email && reqUser.email && u.email.toLowerCase() === reqUser.email.toLowerCase());
        return matchId || matchEmail;
      });
    }

    res.json({ users: safeUsers });
  });

  app.post('/api/admin/users', requireAdminOrSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { id, name, email, phone, post, role, permissions, password } = req.body;
      if (!name || !id || !password) {
        return res.status(400).json({ error: 'Staff Full Name, User ID, and Password are required.' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      }

      const hasLetters = /[a-zA-Z]/.test(password);
      const hasNumbersOrSymbols = /[^a-zA-Z]/.test(password);
      if (!hasLetters || !hasNumbersOrSymbols) {
        return res.status(400).json({
          error: 'Password must be strong and contain at least 6 mixing characters (letters combined with numbers or special symbols).',
        });
      }

      const reqUser = (req as any).user;
      const isReqUserSuperAdmin =
        reqUser &&
        (reqUser.role === 'SUPER_ADMIN' ||
          reqUser.role === 'SUPER ADMIN' ||
          reqUser.id === 'SUPER_ADMIN' ||
          reqUser.id === 'TMODLSUNSARI');

      const upperRole = (role || '').trim().toUpperCase();
      const isTargetSuperAdmin = upperRole === 'SUPER_ADMIN' || upperRole === 'SUPER ADMIN' || upperRole.includes('SUPER');

      // Only Super Admin can create another Super Admin account
      if (isTargetSuperAdmin && !isReqUserSuperAdmin) {
        return res.status(403).json({ error: 'Only Super Administrators can create Super Administrator accounts.' });
      }

      const users = getUsers() as (User & { passwordHash?: string })[];
      const cleanId = id.trim().toUpperCase().replace(/[^A-Z0-9_-]/gi, '');

      if (users.some((u) => u.id.toLowerCase() === cleanId.toLowerCase() || (email && u.email && u.email.toLowerCase() === email.trim().toLowerCase()))) {
        return res.status(400).json({ error: 'A user with this User ID or Email already exists.' });
      }

      let assignedRole = 'DATA ENTRY OFFICER';
      if (isTargetSuperAdmin) {
        assignedRole = 'SUPER ADMIN';
      } else if (upperRole === 'ADMIN' || upperRole === 'ADMINISTRATOR' || upperRole.includes('ADMIN')) {
        assignedRole = 'ADMINISTRATOR';
      } else if (upperRole.includes('DISTRIBUT') || upperRole.includes('CARD DISTRIBUT')) {
        assignedRole = 'SMART CARD DISTRIBUTER';
      } else {
        assignedRole = 'DATA ENTRY OFFICER';
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const isDefault = password === DEFAULT_USER_PASSWORD || password === DEFAULT_SUPER_ADMIN_PASSWORD;
      let finalPermissions = permissions || (assignedRole === 'SUPER ADMIN' ? ['*'] : []);
      if (assignedRole !== 'SUPER ADMIN' && Array.isArray(finalPermissions)) {
        finalPermissions = finalPermissions.filter((p: string) => p !== 'dashboard.view' && p !== 'dashboard.tables');
      }

      const newUser: User & { passwordHash: string; mustChangePassword?: boolean; isDefaultPassword?: boolean } = {
        id: cleanId,
        name: name.trim().toUpperCase(),
        email: email ? email.trim().toUpperCase() : '',
        phone: (phone || '').trim(),
        post: (post || 'Staff Operator').trim(),
        role: assignedRole,
        status: 'ACTIVE',
        permissions: finalPermissions,
        createdAt: new Date().toISOString(),
        mustChangePassword: true,
        isDefaultPassword: isDefault,
        passwordHash,
      };

      users.push(newUser);
      saveUsers(users);

      logAudit(reqUser.id, reqUser.name, 'USER_CREATED', 'SECURITY', `Created user account ${newUser.id} (${newUser.name}) with role ${newUser.role}`, req.ip);

      const { passwordHash: _, ...safeUser } = newUser;
      res.json({ success: true, message: `User account ${newUser.id} created successfully.`, user: safeUser });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create user account: ' + err.message });
    }
  });

  app.put('/api/admin/users/:id/permissions', requireAdminOrSuperAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const { permissions, role } = req.body;
    const users = getUsers() as (User & { passwordHash?: string })[];
    const userIndex = users.findIndex((u) => u.id.toLowerCase() === id.trim().toLowerCase());
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    const reqUser = (req as any).user;
    const reqRoleUpper = (reqUser?.role || '').trim().toUpperCase();
    const reqIdUpper = (reqUser?.id || '').trim().toUpperCase();
    const reqEmailLower = (reqUser?.email || '').trim().toLowerCase();
    const isReqUserSuperAdmin = Boolean(
      reqUser &&
      (reqRoleUpper === 'SUPER_ADMIN' ||
        reqRoleUpper === 'SUPER ADMIN' ||
        reqRoleUpper.includes('SUPER') ||
        reqIdUpper === 'SUPER_ADMIN' ||
        reqIdUpper === 'USER_SUPERADMIN' ||
        reqIdUpper === 'TMODLSUNSARI' ||
        reqEmailLower === 'dahalkomal@gmail.com' ||
        reqEmailLower === 'tmodlsunsari@gmail.com' ||
        (Array.isArray(reqUser.permissions) && reqUser.permissions.includes('*')))
    );
    if (!isReqUserSuperAdmin) {
      return res.status(403).json({ error: 'Strictly prohibited: Only Super Administrators can modify user permissions.' });
    }

    if (role !== undefined) {
      const upperRole = (role || '').trim().toUpperCase();
      let normalized = 'DATA ENTRY OFFICER';
      if (upperRole === 'SUPER_ADMIN' || upperRole === 'SUPER ADMIN' || upperRole.includes('SUPER')) {
        normalized = 'SUPER ADMIN';
      } else if (upperRole === 'ADMIN' || upperRole === 'ADMINISTRATOR' || upperRole.includes('ADMIN')) {
        normalized = 'ADMINISTRATOR';
      } else if (upperRole.includes('DISTRIBUT') || upperRole.includes('CARD DISTRIBUT')) {
        normalized = 'SMART CARD DISTRIBUTER';
      }
      users[userIndex].role = normalized;
    }

    if (permissions !== undefined) {
      const targetRole = users[userIndex].role;
      const isTargetSuper = targetRole === 'SUPER ADMIN' || targetRole === 'SUPER_ADMIN' || users[userIndex].id === 'SUPER_ADMIN' || users[userIndex].id === 'TMODLSUNSARI';
      let filteredPerms = permissions;
      if (!isTargetSuper && Array.isArray(filteredPerms)) {
        filteredPerms = filteredPerms.filter((p: string) => p !== 'dashboard.view' && p !== 'dashboard.tables');
      }
      users[userIndex].permissions = filteredPerms;
    }
    saveUsers(users);

    logAudit(reqUser.id, reqUser.name, 'PERMISSIONS_UPDATED', 'SECURITY', `Updated permissions for user ${id}`, req.ip);

    const { passwordHash: _, ...safeUser } = users[userIndex];
    res.json({ success: true, message: 'Permissions updated successfully.', user: safeUser });
  });

  app.put('/api/admin/users/:id/status', requireAdminOrSuperAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const users = getUsers() as (User & { passwordHash?: string })[];
    const userIndex = users.findIndex((u) => u.id.toLowerCase() === id.trim().toLowerCase());
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    if (users[userIndex].id === 'SUPER_ADMIN' && status === 'SUSPENDED') {
      return res.status(400).json({ error: 'The Primary Super Administrator account cannot be suspended.' });
    }

    const reqUser = (req as any).user;
    const isTargetUserSuperAdmin = users[userIndex].role === 'SUPER_ADMIN' || users[userIndex].role === 'SUPER ADMIN' || users[userIndex].id === 'SUPER_ADMIN';
    const isReqUserSuperAdmin = reqUser && (reqUser.role === 'SUPER_ADMIN' || reqUser.role === 'SUPER ADMIN' || reqUser.id === 'SUPER_ADMIN' || reqUser.id === 'TMODLSUNSARI');
    if (isTargetUserSuperAdmin && !isReqUserSuperAdmin) {
      return res.status(403).json({ error: 'Only Super Administrators can suspend Super Administrator accounts.' });
    }

    users[userIndex].status = status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    saveUsers(users);

    logAudit(reqUser.id, reqUser.name, 'USER_STATUS_CHANGE', 'SECURITY', `Set user ${id} status to ${users[userIndex].status}`, req.ip);

    res.json({ success: true, message: `User status changed to ${users[userIndex].status}.`, status: users[userIndex].status });
  });

  // Super Admin: Reset User Password (Custom or Default)
  app.post('/api/admin/users/:id/reset-password', requireAdminOrSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { newPassword, toDefault } = req.body;

      const users = getUsers() as (User & { passwordHash?: string; passwordPrefix?: string; mustChangePassword?: boolean; isDefaultPassword?: boolean })[];
      const userIndex = users.findIndex((u) => u.id.toLowerCase() === id.trim().toLowerCase());
      if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

      const reqUser = (req as any).user;
      const targetUser = users[userIndex];
      const isTargetUserSuperAdmin = isSuperAdminUser(targetUser);
      const isReqUserSuperAdmin = isSuperAdminUser(reqUser);

      if (isTargetUserSuperAdmin && !isReqUserSuperAdmin) {
        return res.status(403).json({ error: 'Only Super Administrators can reset Super Administrator passwords.' });
      }

      let finalPassword = newPassword;
      let isDefault = false;

      if (toDefault || newPassword === 'DEFAULT') {
        finalPassword = isTargetUserSuperAdmin ? DEFAULT_SUPER_ADMIN_PASSWORD : DEFAULT_USER_PASSWORD;
        isDefault = true;
      } else {
        if (!finalPassword || finalPassword.length < 6) {
          return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
        }
        const hasLetters = /[a-zA-Z]/.test(finalPassword);
        const hasNumbersOrSymbols = /[^a-zA-Z]/.test(finalPassword);
        if (!hasLetters || !hasNumbersOrSymbols) {
          return res.status(400).json({
            error: 'Password must be strong and contain at least 6 mixing characters (letters combined with numbers or special symbols).',
          });
        }
        isDefault = finalPassword === DEFAULT_SUPER_ADMIN_PASSWORD || finalPassword === DEFAULT_USER_PASSWORD;
      }

      targetUser.passwordHash = await bcrypt.hash(finalPassword, 10);
      delete (targetUser as any).passwordPrefix;
      targetUser.mustChangePassword = true;
      targetUser.isDefaultPassword = isDefault;
      saveUsers(users);

      logAudit(reqUser.id, reqUser.name, 'PASSWORD_RESET', 'SECURITY', `Reset password for user account ${id} (Default: ${isDefault})`, req.ip);

      res.json({
        success: true,
        message: `Password for user ${id} was reset successfully to ${isDefault ? 'the official default password' : finalPassword}. The user will be required to change it immediately upon login.`,
        defaultPassword: isDefault ? finalPassword : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to reset password: ' + err.message });
    }
  });

  // Super Admin: Dedicated Automatic Reset to Default Password Endpoint
  app.post('/api/admin/users/:id/reset-default-password', requireAdminOrSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const users = getUsers() as (User & { passwordHash?: string; passwordPrefix?: string; mustChangePassword?: boolean; isDefaultPassword?: boolean })[];
      const userIndex = users.findIndex((u) => u.id.toLowerCase() === id.trim().toLowerCase());
      if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

      const reqUser = (req as any).user;
      const targetUser = users[userIndex];
      const isTargetUserSuperAdmin = isSuperAdminUser(targetUser);
      const isReqUserSuperAdmin = isSuperAdminUser(reqUser);

      if (isTargetUserSuperAdmin && !isReqUserSuperAdmin) {
        return res.status(403).json({ error: 'Only Super Administrators can reset Super Administrator passwords.' });
      }

      const defaultPwd = isTargetUserSuperAdmin ? DEFAULT_SUPER_ADMIN_PASSWORD : DEFAULT_USER_PASSWORD;
      targetUser.passwordHash = await bcrypt.hash(defaultPwd, 10);
      delete (targetUser as any).passwordPrefix;
      targetUser.mustChangePassword = true;
      targetUser.isDefaultPassword = true;
      saveUsers(users);

      logAudit(reqUser.id, reqUser.name, 'PASSWORD_RESET', 'SECURITY', `Auto-reset password for user account ${id} to role default (${defaultPwd})`, req.ip);

      res.json({
        success: true,
        message: `Password for user ${targetUser.name} was automatically reset to the role default password: ${defaultPwd}. The user must set their new password on next login.`,
        defaultPassword: defaultPwd,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to reset password: ' + err.message });
    }
  });

  app.delete('/api/admin/users/:id', requireAdminOrSuperAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const users = getUsers() as (User & { passwordHash?: string })[];
    const userIndex = users.findIndex((u) => u.id.toLowerCase() === id.trim().toLowerCase());
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    if (users[userIndex].id === 'SUPER_ADMIN' || users[userIndex].id === 'kdahal_plsms5') {
      return res.status(400).json({ error: 'Primary Owner account cannot be deleted.' });
    }

    const reqUser = (req as any).user;
    const isTargetUserSuperAdmin = users[userIndex].role === 'SUPER_ADMIN' || users[userIndex].role === 'SUPER ADMIN' || users[userIndex].id === 'SUPER_ADMIN';
    const isReqUserSuperAdmin = reqUser && (reqUser.role === 'SUPER_ADMIN' || reqUser.role === 'SUPER ADMIN' || reqUser.id === 'SUPER_ADMIN' || reqUser.id === 'TMODLSUNSARI');
    if (isTargetUserSuperAdmin && !isReqUserSuperAdmin) {
      return res.status(403).json({ error: 'Only Super Administrators can delete Super Administrator accounts.' });
    }

    const removedUser = users.splice(userIndex, 1)[0];
    saveUsers(users);

    logAudit(reqUser.id, reqUser.name, 'USER_DELETED', 'SECURITY', `Revoked user account ${id} (${removedUser.name})`, req.ip);

    res.json({ success: true, message: `User account ${id} was revoked successfully.` });
  });

  // ==========================================
  // RESET PRODUCTION DATABASE (HIGH-RISK SUPER ADMIN ONLY)
  // ==========================================
  app.post('/api/admin/reset-production-database', requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const reqUser = (req as any).user;
      const { password, confirmationText, identifier } = req.body;

      // 1. Validate confirmation text phrase exactly
      if (!confirmationText || confirmationText.trim() !== 'RESET PLSMS PRODUCTION DATA') {
        return res.status(400).json({
          error: 'Security phrase mismatch. You must type exactly: RESET PLSMS PRODUCTION DATA',
        });
      }

      // 2. Re-authenticate / verify identity with Super Admin password
      if (!password) {
        return res.status(400).json({
          error: 'Super Administrator password is required for identity verification.',
        });
      }

      const users = getUsers() as (User & { passwordHash?: string; passwordPrefix?: string })[];
      let superAdminUser = users.find((u) => u.id === reqUser.id || ((u.role === 'SUPER_ADMIN' || u.role === 'SUPER ADMIN') && u.email === reqUser.email));

      if (identifier) {
        const inputId = identifier.trim().toLowerCase();
        const found = users.find(
          (u) =>
            (u.email && u.email.toLowerCase() === inputId) ||
            u.id.toLowerCase() === inputId ||
            (u.email && u.email.toLowerCase().split('@')[0] === inputId.split('@')[0])
        );
        if (found && (found.role === 'SUPER ADMIN' || found.role === 'SUPER_ADMIN' || found.id === 'SUPER_ADMIN' || found.id === 'TMODLSUNSARI')) {
          superAdminUser = found;
        }
      }

      if (!superAdminUser || !superAdminUser.passwordHash) {
        return res.status(403).json({ error: 'Super Administrator record not found or invalid.' });
      }

      const verifyResult = await verifyUserPassword(superAdminUser, password);
      const isPasswordValid = verifyResult.valid;

      if (!isPasswordValid) {
        logAudit(
          reqUser.id,
          reqUser.name || 'Super Admin',
          'PRODUCTION_RESET_FAILED_AUTH',
          'SECURITY',
          'Failed production database reset attempt: Incorrect Super Administrator password entered.',
          req.ip
        );
        return res.status(401).json({
          error: 'Identity verification failed: Incorrect Super Administrator password.',
        });
      }

      // 3. Execute atomic transaction-safe reset of BOTH App Database and Google Sheet Database parallelly at once
      const resetResult = resetProductionDatabase(reqUser.id, reqUser.name || superAdminUser.name, req.ip);
      const sheetReset = resetGoogleSheetsSyncState();
      notifyDatabaseResetOrRestore({
        totalRecords: 0,
        availableRecords: 0,
        distributedRecords: 0,
        missingRecords: 0,
        foundRecords: 0,
      });

      res.json({
        success: true,
        message: '✓ PRODUCTION DATA RESET SUCCESSFULLY — BOTH PLSMS APP DATABASE AND GOOGLE SHEET ARE AT 0 RECORDS (RESETTING MODE ACTIVE).',
        details: {
          ...resetResult,
          googleSheetsReset: true,
          sheetStats: sheetReset.sheetStats,
        },
      });
    } catch (err: any) {
      console.error('Error during production database reset:', err);
      res.status(500).json({
        error: 'Failed to reset production data: ' + (err.message || 'Internal server error'),
      });
    }
  });

  // Dedicated Parallel Database Reset: Wipes PLSMS App Database AND Google Sheet Database at once
  app.post('/api/admin/reset-both-databases', requireAuth, async (req: Request, res: Response) => {
    try {
      const reqUser = (req as any).user;
      if (!reqUser) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Strictly restrict database wipe to Super Administrator (prevents irreversible data loss by office staff)
      const isSuperAdmin =
        reqUser.role === 'SUPER ADMIN' ||
        reqUser.role === 'SUPER_ADMIN' ||
        reqUser.id === 'SUPER_ADMIN' ||
        reqUser.id === 'TMODLSUNSARI';

      if (!isSuperAdmin) {
        logAudit(
          reqUser.id,
          reqUser.name || 'Office Staff',
          'UNAUTHORIZED_RESET_ATTEMPT',
          'SECURITY',
          'Blocked attempt by office staff to execute parallel database wipe.',
          req.ip
        );
        return res.status(403).json({
          error: 'Access Denied: Only the Super Administrator is authorized to reset the whole app and both databases.',
        });
      }

      // 1. Reset PLSMS records, imports, distributions, overrides & RAM caches
      const dbResult = resetProductionDatabase(
        reqUser.id,
        reqUser.name || reqUser.email || 'Administrator',
        req.ip
      );

      // 2. Reset Google Sheets configurations, row caches, URLs & stats
      const sheetReset = resetGoogleSheetsSyncState();
      notifyDatabaseResetOrRestore({
        totalRecords: 0,
        availableRecords: 0,
        distributedRecords: 0,
        missingRecords: 0,
        foundRecords: 0,
      });

      res.json({
        success: true,
        mode: 'PARALLEL_RESET_COMPLETE',
        message: '✓ PARALLEL DATABASE RESET SUCCESSFUL: Both PLSMS App Database and Google Sheet Database are at 0 records (Resetting Mode Active).',
        appDatabase: {
          clearedRecords: dbResult.clearedRecords,
          clearedImports: dbResult.clearedImports,
          clearedDistributions: dbResult.clearedDistributions,
          clearedAuditLogs: dbResult.clearedAuditLogs,
          currentRecords: 0,
        },
        googleSheetDatabase: {
          sheetRows: 0,
          sheetStats: sheetReset.sheetStats,
          status: 'PAUSED',
        },
        dbStats: getDashboardStats(),
      });
    } catch (err: any) {
      console.error('Error during parallel database reset:', err);
      res.status(500).json({
        error: 'Failed to execute parallel database reset: ' + (err.message || 'Internal server error'),
      });
    }
  });

  // ==========================================
  // OFFICIAL PLSMS BACKUP & ACCIDENTAL DISASTER RECOVERY ENGINE
  // ==========================================

  // 1. Get official office locations for backup signature
  app.get('/api/admin/backup/locations', requireAuth, (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        locations: OFFICIAL_SYSTEM_LOCATIONS,
        activeOfficeCode: 'ITAHARI_SUNSARI',
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve official locations: ' + err.message });
    }
  });

  // 1.1 Get live database inventory & action categories for backup
  app.get('/api/admin/backup/stats', requireAuth, (req: Request, res: Response) => {
    try {
      const stats = getDashboardStats();
      const users = getUsers();
      const usersWithPasswords = users.filter((u: any) => Boolean(u.passwordHash)).length;
      const actionOverrides = getActionOverrides();
      const notices = getNotices();
      const configPath = path.join(process.cwd(), 'data_storage', 'google_sheets_config.json');
      const hasGoogleSheetsConfig = fs.existsSync(configPath);

      res.json({
        success: true,
        totalRecords: stats.totalRecords || 0,
        notDistributed: stats.availableRecords || 0,
        distributed: stats.distributedRecords || 0,
        missing: stats.missingRecords || 0,
        found: stats.foundRecords || 0,
        imports: stats.totalImports || 0,
        distributions: stats.totalDistributions || 0,
        users: users.length || 0,
        usersWithPasswords,
        passwordEncryptionFormat: 'BCRYPT_CRYPTOGRAPHIC_HASH (Extra Coding Form)',
        actionOverrides: actionOverrides.length,
        notices: notices.length,
        hasGoogleSheetsConfig,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve backup stats: ' + err.message });
    }
  });

  // 2. Export / download full system backup archive with location signature (zero-memory error streaming)
  app.get('/api/admin/backup/export', requireAuth, (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const locationCode = (req.query.locationCode as string) || 'ITAHARI_SUNSARI';
      const scope = (req.query.scope as any) || 'FULL_MASTER_ARCHIVE';
      const customOfficeName = (req.query.customOfficeName as string) || undefined;
      const customLocationName = (req.query.customLocationName as string) || undefined;

      const { archive, filename } = createSystemBackupArchive({
        locationCode,
        scope,
        customOfficeName,
        customLocationName,
        operatorId: user?.id,
        operatorName: user?.name,
        operatorEmail: user?.email,
        operatorRole: user?.role,
      });

      const jsonString = JSON.stringify(archive, null, 2);

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', Buffer.byteLength(jsonString, 'utf-8'));
      res.send(jsonString);
    } catch (err: any) {
      console.error('Failed to export system backup archive:', err);
      res.status(500).json({ error: 'Failed to generate backup archive: ' + err.message });
    }
  });

  // Also support POST for backup export with custom body
  app.post('/api/admin/backup/export', requireAuth, (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { locationCode, scope, customOfficeName, customLocationName, download } = req.body;

      const { archive, filename, sizeBytes } = createSystemBackupArchive({
        locationCode: locationCode || 'ITAHARI_SUNSARI',
        scope: scope || 'FULL_MASTER_ARCHIVE',
        customOfficeName,
        customLocationName,
        operatorId: user?.id,
        operatorName: user?.name,
        operatorEmail: user?.email,
        operatorRole: user?.role,
      });

      if (download) {
        const jsonString = JSON.stringify(archive, null, 2);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', Buffer.byteLength(jsonString, 'utf-8'));
        return res.send(jsonString);
      }

      res.json({
        success: true,
        filename,
        sizeBytes,
        location: archive.location,
        manifest: archive.manifest,
        exportedAt: archive.exportedAt,
        archive,
      });
    } catch (err: any) {
      console.error('Failed to export system backup archive:', err);
      res.status(500).json({ error: 'Failed to generate backup archive: ' + err.message });
    }
  });

  // 3. Inspect / pre-flight validate backup file before restoration (supports file upload or JSON payload)
  app.post(
    '/api/admin/backup/inspect',
    requireAuth,
    (upload.single('backupFile') as any),
    async (req: Request, res: Response) => {
      let tempFilePath: string | null = null;
      try {
        let rawArchive: any = null;

        if (req.file) {
          tempFilePath = req.file.path;
          const content = fs.readFileSync(tempFilePath, 'utf-8');
          rawArchive = JSON.parse(content);
        } else if (req.body.archive) {
          rawArchive = typeof req.body.archive === 'string' ? JSON.parse(req.body.archive) : req.body.archive;
        } else if (req.body && (req.body.plsmsArchiveSignature || req.body.records || req.body.data)) {
          rawArchive = req.body;
        }

        if (!rawArchive) {
          return res.status(400).json({
            valid: false,
            error: 'No backup file or JSON payload was supplied for inspection.',
          });
        }

        const report = inspectSystemBackupArchive(rawArchive);
        res.json({
          success: true,
          ...report,
        });
      } catch (err: any) {
        console.error('Error during backup archive inspection:', err);
        res.status(400).json({
          valid: false,
          error: 'Corrupt or unreadable backup file: ' + (err.message || 'JSON parse failure'),
        });
      } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (_) {}
        }
      }
    }
  );

  // 4. Inject and restore database from backup file
  app.post(
    '/api/admin/backup/restore',
    requireAuth,
    (upload.single('backupFile') as any),
    async (req: Request, res: Response) => {
      let tempFilePath: string | null = null;
      try {
        const user = (req as any).user;
        let rawArchive: any = null;

        if (req.file) {
          tempFilePath = req.file.path;
          const content = fs.readFileSync(tempFilePath, 'utf-8');
          rawArchive = JSON.parse(content);
        } else if (req.body.archive) {
          rawArchive = typeof req.body.archive === 'string' ? JSON.parse(req.body.archive) : req.body.archive;
        } else if (req.body && (req.body.plsmsArchiveSignature || req.body.records || req.body.data)) {
          rawArchive = req.body;
        }

        if (!rawArchive) {
          return res.status(400).json({
            error: 'Cannot restore: No valid backup archive file was provided.',
          });
        }

        const mode = (req.body.mode === 'MERGE' ? 'MERGE' : 'REPLACE') as 'REPLACE' | 'MERGE';
        const targetLocationCode = req.body.targetLocationCode || 'ITAHARI_SUNSARI';

        // Pre-flight check
        const inspection = inspectSystemBackupArchive(rawArchive);
        if (!inspection.valid) {
          return res.status(400).json({
            error: 'Archive signature is invalid or unrecognized: ' + (inspection.error || 'Structure mismatch'),
          });
        }

        const result = restoreSystemBackupArchive(rawArchive, {
          mode,
          targetLocationCode,
          operatorId: user?.id,
          operatorName: user?.name,
        });

        // Notify Google Sheets sync module to synchronize in-memory caches and stats
        notifyDatabaseResetOrRestore({
          totalRecords: result.restoredRecords,
          availableRecords: result.actionCategories?.notDistributedCards,
          distributedRecords: result.actionCategories?.distributedCards,
          missingRecords: result.actionCategories?.missingCards,
          foundRecords: result.actionCategories?.foundCards,
          handedOverRecords: result.actionCategories?.handedOverCards,
        });

        res.json({
          success: true,
          ...result,
        });
      } catch (err: any) {
        console.error('Error during system backup restoration:', err);
        res.status(500).json({
          error: 'Restoration failed: ' + (err.message || 'Unknown database error'),
        });
      } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (_) {}
        }
      }
    }
  );

  // ==========================================
  // 5-DIGIT ADMINISTRATIVE SECURITY M-PIN (2-STEP VERIFICATION)
  // ==========================================
  app.get('/api/admin/security-pin/status', requireAuth, (req: Request, res: Response) => {
    try {
      const reqUser = (req as any).user;
      const status = getSecurityPinStatus(reqUser?.id);
      res.json({ success: true, ...status });
    } catch (err: any) {
      console.error('Error fetching security pin status:', err);
      res.status(500).json({ error: 'Failed to retrieve security pin status.' });
    }
  });

  app.post('/api/admin/security-pin/verify', requireAuth, async (req: Request, res: Response) => {
    try {
      const reqUser = (req as any).user;
      const { pin } = req.body;

      if (!pin) {
        return res.status(400).json({ error: 'Please enter the 5-digit Security M-PIN or account password.' });
      }

      let result = verifySecurityMpin(pin, reqUser?.id);
      let verified = result.success;
      let isDefaultPin = Boolean(result.isDefault);

      // If M-PIN didn't match, check if authorized staff user entered their own confidential account password
      if (!verified) {
        const users = getUsers() as any[];
        const found = users.find((u) => u.id.toLowerCase() === (reqUser.id || '').toLowerCase() || (reqUser.email && u.email && u.email.toLowerCase() === (reqUser.email || '').toLowerCase()));
        if (found && found.passwordHash && bcrypt.compareSync(pin, found.passwordHash)) {
          verified = true;
          isDefaultPin = false;
        }
      }

      if (!verified) {
        logAudit(
          reqUser.id,
          reqUser.name || 'User',
          'SECURITY_MPIN_AUTH_FAILED',
          'SECURITY',
          `Failed M-PIN or password entry attempt for Upload Center. Locked: ${result.locked ? 'YES' : 'NO'}. Remaining attempts: ${result.remainingAttempts ?? 0}.`,
          req.ip
        );
        return res.status(result.locked ? 429 : 401).json({
          error: result.message || 'Invalid Security M-PIN or account password.',
          locked: result.locked,
          remainingLockSeconds: result.remainingLockSeconds,
          remainingAttempts: result.remainingAttempts,
        });
      }

      // Generate signed clearance session token
      const clearanceToken = jwt.sign(
        {
          userId: reqUser.id,
          clearance: 'UPLOAD_CENTER',
          verifiedAt: Date.now(),
        },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      logAudit(
        reqUser.id,
        reqUser.name || 'User',
        'SECURITY_MPIN_AUTH_SUCCESS',
        'SECURITY',
        `Step-1 Master 5-digit M-PIN verified successfully. Granted Upload Center clearance. Insecure default status: ${result.isDefault ? 'YES' : 'NO'}.`,
        req.ip
      );

      res.json({
        success: true,
        isDefault: Boolean(result.isDefault),
        clearanceToken,
        message: 'Security M-PIN verified successfully. Upload Center clearance granted.',
      });
    } catch (err: any) {
      console.error('Error verifying security pin:', err);
      res.status(500).json({ error: 'Failed to verify security pin.' });
    }
  });

  // STEP 2: Super Admin User ID / Email and Password 100% Match Verification for Upload Center
  app.post('/api/admin/security-step2-verify', requireAuth, async (req: Request, res: Response) => {
    try {
      const reqUser = (req as any).user;
      const { identifier, password } = req.body;

      if (!identifier || !password) {
        return res.json({
          success: false,
          matched: false,
          error: 'Super Admin User ID/Email and Password are required.',
        });
      }

      const inputId = String(identifier).trim().toLowerCase();
      const pwd = String(password).trim();

      const users = getUsers() as (User & { passwordHash?: string; passwordPrefix?: string })[];

      // Search for Super Admin accounts matching ID, Email, or standard administrator aliases
      const matchedUser = users.find(
        (u) =>
          (u.email && u.email.toLowerCase() === inputId) ||
          u.id.toLowerCase() === inputId ||
          (u.email && u.email.toLowerCase().split('@')[0] === inputId.split('@')[0]) ||
          (inputId.includes('tmodlsunsari') && (u.id.toLowerCase() === 'tmodlsunsari' || u.id.toLowerCase() === 'super_admin' || (u.email && u.email.toLowerCase().includes('tmodlsunsari')))) ||
          (inputId.includes('tmodlitahari') && (u.id.toLowerCase() === 'tmodlsunsari' || u.id.toLowerCase() === 'super_admin' || (u.email && u.email.toLowerCase().includes('tmodlitahari')))) ||
          (inputId.includes('dahalkomal') && (u.id.toLowerCase() === 'super_admin' || (u.email && u.email.toLowerCase().includes('dahalkomal')))) ||
          (inputId === 'super_admin' && (u.id.toLowerCase() === 'super_admin' || u.role === 'SUPER ADMIN' || u.role === 'SUPER_ADMIN'))
      );

      if (!matchedUser) {
        return res.json({
          success: false,
          matched: false,
          error: 'Super Admin user record not found for this User ID / Email.',
        });
      }

      // Ensure account has Super Admin role
      const isSuperAdminRole =
        matchedUser.role === 'SUPER ADMIN' ||
        matchedUser.role === 'SUPER_ADMIN' ||
        matchedUser.id.toUpperCase() === 'SUPER_ADMIN' ||
        matchedUser.id.toUpperCase() === 'TMODLSUNSARI';

      if (!isSuperAdminRole) {
        return res.json({
          success: false,
          matched: false,
          error: 'Specified user does not have Super Administrator privileges.',
        });
      }

      if (matchedUser.status === 'SUSPENDED') {
        return res.json({
          success: false,
          matched: false,
          error: 'Super Admin account is currently suspended.',
        });
      }

      // Verify Password strictly using database credentials
      const verifyResult = await verifyUserPassword(matchedUser, pwd);
      const isPasswordMatch = verifyResult.valid;

      if (!isPasswordMatch) {
        return res.json({
          success: false,
          matched: false,
          error: 'Super Admin password does not match.',
        });
      }

      // 100% Matched! Sign high-privilege clearance token
      const clearanceToken = jwt.sign(
        {
          userId: matchedUser.id,
          userName: matchedUser.name,
          role: matchedUser.role,
          clearance: 'UPLOAD_CENTER_FULL',
          step: 2,
          verifiedAt: Date.now(),
        },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      logAudit(
        matchedUser.id,
        matchedUser.name,
        'SECURITY_STEP2_AUTH_SUCCESS',
        'SECURITY',
        `Step-2 Super Admin ID & Password verified 100% successfully. Upload Center unlocked.`,
        req.ip
      );

      return res.json({
        success: true,
        matched: true,
        clearanceToken,
        user: {
          id: matchedUser.id,
          name: matchedUser.name,
          role: matchedUser.role,
          email: matchedUser.email,
        },
        message: '100% Matched: Super Administrator verified successfully.',
      });
    } catch (err: any) {
      console.error('Error in step 2 verification:', err);
      return res.status(500).json({
        success: false,
        matched: false,
        error: 'Server error during Step 2 verification.',
      });
    }
  });

  app.post('/api/admin/security-pin/change', requireAuth, async (req: Request, res: Response) => {
    try {
      const reqUser = (req as any).user;
      const { currentPin, newPin, superAdminPassword } = req.body;

      if (!newPin || !/^\d{5}$/.test(String(newPin).trim())) {
        return res.status(400).json({ error: 'New M-PIN must be strictly a 5-digit numeric number (e.g. 54321).' });
      }

      // If user is Super Admin and provided superAdminPassword, verify password
      const users = getUsers() as (User & { passwordHash?: string })[];
      const superAdminUser = users.find(
        (u) =>
          u.id === reqUser.id ||
          ((u.role === 'SUPER_ADMIN' || u.role === 'SUPER ADMIN') && u.email === reqUser.email)
      );

      const isSuperAdmin = Boolean(
        reqUser.role === 'SUPER_ADMIN' ||
        reqUser.role === 'SUPER ADMIN' ||
        reqUser.id?.toUpperCase() === 'SUPER_ADMIN' ||
        reqUser.id?.toUpperCase() === 'TMODLSUNSARI'
      );

      let authenticated = false;

      if (isSuperAdmin && superAdminPassword && superAdminUser?.passwordHash) {
        const isPwdValid = await bcrypt.compare(superAdminPassword, superAdminUser.passwordHash);
        if (isPwdValid) {
          authenticated = true;
        } else {
          return res.status(401).json({ error: 'Super Administrator password authentication failed.' });
        }
      }

      if (!authenticated) {
        if (!currentPin) {
          return res.status(400).json({ error: 'Current 5-digit M-PIN (or Super Admin password) is required.' });
        }
        const verifyRes = verifySecurityMpin(currentPin, reqUser.id);
        if (!verifyRes.success) {
          return res.status(401).json({ error: 'Current M-PIN is incorrect. Verification failed.' });
        }
      }

      const updateResult = updateSecurityMpin(String(newPin).trim(), reqUser.id, reqUser.name);

      // Generate signed clearance session token so user can proceed directly to Step 2
      const clearanceToken = jwt.sign(
        {
          userId: reqUser.id,
          clearance: 'UPLOAD_CENTER',
          verifiedAt: Date.now(),
        },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      res.json({
        ...updateResult,
        isDefault: false,
        clearanceToken,
      });
    } catch (err: any) {
      console.error('Error changing security pin:', err);
      res.status(500).json({ error: err.message || 'Failed to change security pin.' });
    }
  });

  app.post('/api/admin/security-pin/reset', requireAuth, async (req: Request, res: Response) => {
    try {
      const reqUser = (req as any).user;
      const isSuperAdmin = Boolean(
        reqUser.role === 'SUPER_ADMIN' ||
        reqUser.role === 'SUPER ADMIN' ||
        reqUser.id?.toUpperCase() === 'SUPER_ADMIN' ||
        reqUser.id?.toUpperCase() === 'TMODLSUNSARI'
      );

      if (!isSuperAdmin) {
        return res.status(403).json({ error: 'Access denied: Only Super Administrator can reset M-PIN to default.' });
      }

      const { superAdminPassword } = req.body;
      if (!superAdminPassword) {
        return res.status(400).json({ error: 'Super Administrator password is required to reset M-PIN.' });
      }

      const users = getUsers() as (User & { passwordHash?: string })[];
      const superAdminUser = users.find(
        (u) =>
          u.id === reqUser.id ||
          ((u.role === 'SUPER_ADMIN' || u.role === 'SUPER ADMIN') && u.email === reqUser.email)
      );

      if (!superAdminUser || !superAdminUser.passwordHash) {
        return res.status(403).json({ error: 'Super Administrator credential record not found.' });
      }

      const isPasswordValid = await bcrypt.compare(superAdminPassword, superAdminUser.passwordHash);
      if (!isPasswordValid) {
        logAudit(
          reqUser.id,
          reqUser.name || 'Super Admin',
          'SECURITY_MPIN_RESET_AUTH_FAILED',
          'SECURITY',
          'Failed M-PIN reset attempt: Incorrect Super Administrator password entered.',
          req.ip
        );
        return res.status(401).json({ error: 'Super Administrator password authentication failed.' });
      }

      const resetResult = resetSecurityMpinToDefault(reqUser.id, reqUser.name);
      res.json(resetResult);
    } catch (err: any) {
      console.error('Error resetting security pin:', err);
      res.status(500).json({ error: err.message || 'Failed to reset security pin.' });
    }
  });

  // ==========================================
  // PUBLIC PORTAL SEARCH & SUGGESTIONS API
  // ==========================================
  app.get('/api/public/suggestions', (req: Request, res: Response) => {
    const q = (req.query.q as string) || '';
    const limit = parseInt(req.query.limit as string, 10) || 8;
    const suggestions = getProbableSuggestions(q, limit);
    res.json({ suggestions });
  });

  app.get('/api/public/stats', (req: Request, res: Response) => {
    const stats = getDashboardStats();
    res.json(stats);
  });

  // Public Visitor Search Counter (Persisted permanently across all tiers & cross-version synchronized)
  app.get('/api/public/visitor-counter', (req: Request, res: Response) => {
    try {
      const clientCountParam = req.query.clientCount || req.headers['x-plsms-visitor-count'];
      const clientCount = typeof clientCountParam === 'string' ? parseInt(clientCountParam, 10) : (typeof clientCountParam === 'number' ? clientCountParam : 0);

      let count = getVisitorCounter();
      if (!isNaN(clientCount) && clientCount > count) {
        // Automatically adopt the higher count from client's persistent storage across app versions/remixes
        count = setVisitorCounter(clientCount, 'Auto-adopted from client persistent high-water mark across versions/remixes');
      }
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve visitor count', count: getVisitorCounter() });
    }
  });

  // Administrative Calibration & Permanent Lock Route for Super Admin
  app.post('/api/admin/visitor-counter/calibrate', requireAuth, (req: Request, res: Response) => {
    try {
      const userPayload = (req as any).user;
      if (!userPayload || (userPayload.role !== 'SUPER_ADMIN' && userPayload.role !== 'ADMIN')) {
        return res.status(403).json({ error: 'Access Denied: Super Administrator privileges required.' });
      }

      const { targetCount, reason } = req.body || {};
      const num = parseInt(targetCount, 10);
      if (isNaN(num) || num < 1) {
        return res.status(400).json({ error: 'Please provide a valid visitor count (minimum 1).' });
      }

      const updatedCount = setVisitorCounter(
        num,
        reason || 'Super Admin manual calibration & lock',
        userPayload.name || userPayload.email || 'Super Admin'
      );
      res.json({
        success: true,
        count: updatedCount,
        message: `Visitor counter permanently updated to ${updatedCount} and replicated across database tiers.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to calibrate visitor counter' });
    }
  });

  // Maintain server-side session cache of the last counted query per session
  // Key: session ID or IP, Value: normalized query string
  const sessionLastCountedQuery = new Map<string, string>();

  // Reset search session state (invoked when citizen clicks RESET button or clears input)
  app.post('/api/public/search-reset', (req: Request, res: Response) => {
    const sid = ((req.query.sid as string) || (req.body?.sid as string) || req.ip || '').trim();
    if (sid) {
      sessionLastCountedQuery.delete(sid);
    }
    res.json({ success: true });
  });

  app.get('/api/public/search', (req: Request, res: Response) => {
    const query = ((req.query.q as string) || '').trim();
    if (!query) {
      return res.status(400).json({ error: 'Please enter a License Number or Application Number to search.' });
    }

    const sid = ((req.query.sid as string) || req.ip || 'anonymous').trim();
    const normalizedQ = query.toUpperCase().replace(/[\s\-_]/g, '');

    // Increment visitor counter strictly on fresh new searches (new number entered or after reset)
    // Repeated clicks on Search button with the same input without reset do not increment the counter
    const lastQueryForSession = sessionLastCountedQuery.get(sid);
    const isSameQueryAsLast = Boolean(lastQueryForSession && lastQueryForSession === normalizedQ);

    const clientRequestedCount = req.query.count === '1' || req.query.count === 'true';
    const shouldIncrement = clientRequestedCount && !isSameQueryAsLast;

    let visitorCount = getVisitorCounter();
    if (shouldIncrement) {
      visitorCount = incrementVisitorCounter();
      sessionLastCountedQuery.set(sid, normalizedQ);
    } else if (!lastQueryForSession) {
      sessionLastCountedQuery.set(sid, normalizedQ);
    }

    // Prune session map if it grows too large
    if (sessionLastCountedQuery.size > 10000) {
      const keysToDelete = Array.from(sessionLastCountedQuery.keys()).slice(0, 1000);
      for (const k of keysToDelete) {
        sessionLastCountedQuery.delete(k);
      }
    }

    const allRecords = getAllRecords();
    const qClean = query.toUpperCase();
    const qTerm = query.toLowerCase().replace(/[\s\-_]/g, '');

    // Strict EXACT search: 1st priority exact Applicant ID, 2nd priority exact License Number
    let found = allRecords.find((r) => {
      const app = (r.applicationNumber || r.applicantId || '').trim().toUpperCase();
      const appClean = app.replace(/[\s\-_]/g, '').toLowerCase();
      return app === qClean || (qTerm.length > 0 && appClean === qTerm);
    });

    if (!found) {
      found = allRecords.find((r) => {
        const lic = (r.licenseNumber || '').trim().toUpperCase();
        const licClean = lic.replace(/[\s\-_]/g, '').toLowerCase();
        return lic === qClean || (qTerm.length > 0 && licClean === qTerm);
      });
    }

    if (!found) {
      return res.json({
        found: false,
        status: 'NOT_FOUND',
        message: `प्रविष्ट नम्बर: ${query} को नवीकरण (Renewal) तथा नयाँ लाइसेन्स (New License) वा वर्ग थप (Category Add) को प्रयोगात्मक परीक्षा उत्तीर्ण गर्नुभएको हो भने कार्ड प्रिन्ट भई कार्यालय आइपुग्न केही समय लाग्न सक्छ। कृपया केही दिनपछि पुनः खोज्नुहोला।`,
        visitorCount,
      });
    }

    let pickupInstructions = 'Your smart card license is ready for collection at the Transport Management Office. Please bring your original application token/slip and valid National Identity Card.';
    if (found.status === 'DISTRIBUTED' || found.isDistributed) {
      pickupInstructions = `✓ This license was already handed over / distributed to "${found.receivedBy || found.receiverName || found.holderName}".`;
    } else if (found.status === 'MISSING') {
      pickupInstructions = 'Record is currently under verification at the central office. Please contact the help desk.';
    } else if (found.status === 'PENDING') {
      pickupInstructions = 'Your smart card is currently in production / printing queue.';
    }

    // For citizen portal public response: sanitize secret codes so they remain secure for Super Admin only
    const publicRecord = {
      ...found,
      oldCode: undefined,
      newCode: undefined,
      rawRecord: found.rawRecord ? { ...found.rawRecord, 'OLD CODE': undefined, 'NEW CODE': undefined, 'Old Code': undefined, 'New Code': undefined } : undefined,
    };

    res.json({
      found: true,
      licenseNumber: found.licenseNumber,
      applicationNumber: found.applicationNumber || found.applicantId || '',
      applicantId: found.applicantId || found.applicationNumber || '',
      holderName: found.holderName,
      status: found.status,
      office: found.office || found.department || 'TRANSPORT MANAGEMENT OFFICE, ITAHARI',
      department: found.department || found.office || 'TRANSPORT MANAGEMENT OFFICE, ITAHARI',
      category: found.category || found.vehicleClass || 'K',
      vehicleClass: found.vehicleClass || found.category || 'K',
      issueDate: found.issueDate,
      expiryDate: found.expiryDate,
      pickupInstructions,
      record: publicRecord,
      visitorCount,
    });
  });

  // ==========================================
  // REAL EXCEL / CSV UPLOAD & BATCH PROCESSING
  // ==========================================

  // Step 1: Upload File & Detect Columns & Preview Real Rows
  app.post('/api/upload/preview', requireUploadOrSyncPermission, (req: Request, res: Response) => {
    (upload.single('file') as any)(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File exceeds maximum upload limit of 100MB.' });
        }
        return res.status(400).json({ error: `File upload failed: ${err.message || 'Invalid file payload'}` });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file received. Please upload an Excel (.xlsx, .xls) or CSV/TSV file.' });
      }

      const filePath = req.file.path;
      const fileName = req.file.originalname;
      const fileSize = req.file.size;

      try {
        const parsed = parseUploadedSpreadsheet(filePath, fileName);
        const { headers, rows, totalRows, suggestedMapping } = parsed;

        // Sample first 10 real rows for preview
        const previewRows = rows.slice(0, 10);

        return res.json({
          success: true,
          filePath,
          fileName,
          fileSize,
          totalRows,
          detectedHeaders: headers,
          suggestedMapping,
          previewRows,
        });
      } catch (parseErr: any) {
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
        return res.status(400).json({ error: 'Failed to parse uploaded spreadsheet: ' + parseErr.message });
      }
    });
  });

  // Step 2: Confirm & Process Batch Import -> Real JSON Conversion -> Store -> Index
  app.post('/api/upload/process', requireUploadOrSyncPermission, async (req: Request, res: Response) => {
    const { filePath, fileName, fileSize, mapping } = req.body;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'Original uploaded file not found or expired on server. Please upload the file again.' });
    }
    if (!mapping || !mapping.licenseNumber || !mapping.holderName) {
      return res.status(400).json({
        error: 'Invalid mapping: License Number and Holder Name are mandatory columns.',
      });
    }

    const startTime = Date.now();
    const userPayload = (req as any).user;
    const importId = 'IMP_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6).toUpperCase();

    try {
      const parsed = parseUploadedSpreadsheet(filePath, fileName);
      const rawRows = parsed.rows;
      const totalRows = rawRows.length;
      let invalidRecords = 0;
      const normalizedRecords: LicenseRecord[] = [];

      const nowIso = new Date().toISOString();

      // Transform raw rows to normalized LicenseRecord structure
      for (let i = 0; i < totalRows; i++) {
        const row = rawRows[i];
        const sheetRow = i + 2;
        const licNo = String(
          (mapping.licenseNumber && row[mapping.licenseNumber]) ||
          row['LICENSE NUMBER'] ||
          row['License Number'] ||
          row['license_number'] ||
          row['LICENSE NO'] ||
          row['License No'] ||
          row['DL NO'] ||
          row['CARD NO'] ||
          ''
        ).trim();
        const rawAppNo = String(
          (mapping.applicantId && row[mapping.applicantId]) ||
          (mapping.applicationNumber && row[mapping.applicationNumber]) ||
          row['APPLICANT ID'] ||
          row['Applicant ID'] ||
          row['applicant_id'] ||
          row['APPLICATION NUMBER'] ||
          row['Application Number'] ||
          row['APP ID'] ||
          row['App ID'] ||
          ''
        ).trim();
        const name = String(
          (mapping.holderName && row[mapping.holderName]) ||
          row['FULL NAME'] ||
          row['Full Name'] ||
          row['full_name'] ||
          row['NAME'] ||
          row['Name'] ||
          ''
        ).trim();

        // Helper to check if a value is blank or placeholder
        const isBlank = (val?: string) => {
          if (!val) return true;
          const v = val.trim().toUpperCase();
          return (
            v === '' ||
            v === '-' ||
            v === '--' ||
            v === 'N/A' ||
            v === 'NA' ||
            v === 'NULL' ||
            v === 'UNDEFINED' ||
            v === '(MISSING)' ||
            v === '(BLANK)'
          );
        };

        const hasLicNo = !isBlank(licNo);
        const hasAppId = !isBlank(rawAppNo);

        // USER MANDATE:
        // Only invalid if BOTH fields ('APPLICANT ID' and 'LICENSE NUMBER') are empty!
        if (!hasLicNo && !hasAppId) {
          invalidRecords++;
          continue;
        }

        const sn = mapping.sn && row[mapping.sn] ? row[mapping.sn] : (row['SN'] || row['S.N.'] || row['SNO'] || row['Sl No'] || i + 1);
        const appNo = hasAppId ? rawAppNo : (hasLicNo ? `APP-${licNo}` : `APP-ROW-${sheetRow}`);
        const applicantId = appNo;
        const validLicNo = hasLicNo ? licNo : '';
        const cleanName = name || 'UNKNOWN HOLDER';
        const category = (mapping.category && row[mapping.category] ? String(row[mapping.category]).trim() : '') || (mapping.vehicleClass && row[mapping.vehicleClass] ? String(row[mapping.vehicleClass]).trim() : 'K');
        const rawOldCode = mapping.oldCode && row[mapping.oldCode] ? String(row[mapping.oldCode]).trim() : (row['OLD CODE'] || row['Old Code'] || row['old_code'] ? String(row['OLD CODE'] || row['Old Code'] || row['old_code']).trim() : undefined);
        const rawNewCode = mapping.newCode && row[mapping.newCode] ? String(row[mapping.newCode]).trim() : (row['NEW CODE'] || row['New Code'] || row['new_code'] ? String(row['NEW CODE'] || row['New Code'] || row['new_code']).trim() : undefined);
        const oldCode = rawOldCode !== undefined ? normalizeCodeDashes(rawOldCode) : undefined;
        const newCode = rawNewCode !== undefined ? normalizeCodeDashes(rawNewCode) : undefined;
        const department = mapping.department && row[mapping.department] ? String(row[mapping.department]).trim() : (mapping.office && row[mapping.office] ? String(row[mapping.office]).trim() : 'TRANSPORT MANAGEMENT OFFICE, ITAHARI');
        const office = department;
        const phone = mapping.phone && row[mapping.phone] ? String(row[mapping.phone]).trim() : undefined;
        const nid = mapping.nidOrPassport && row[mapping.nidOrPassport] ? String(row[mapping.nidOrPassport]).trim() : undefined;
        const dob = mapping.dateOfBirth && row[mapping.dateOfBirth] ? String(row[mapping.dateOfBirth]).trim() : undefined;
        const address = mapping.address && row[mapping.address] ? String(row[mapping.address]).trim() : undefined;
        const licenseType = mapping.licenseType && row[mapping.licenseType] ? String(row[mapping.licenseType]).trim() : 'Smart Card License';
        const vehicleClass = category;
        const issueDate = mapping.issueDate && row[mapping.issueDate] ? String(row[mapping.issueDate]).trim() : undefined;
        const expiryDate = mapping.expiryDate && row[mapping.expiryDate] ? String(row[mapping.expiryDate]).trim() : undefined;
        const smartCardSerial = mapping.smartCardSerial && row[mapping.smartCardSerial] ? String(row[mapping.smartCardSerial]).trim() : undefined;

        // Column I: RECEIVED BY check
        const rawReceivedBy =
          (mapping.receivedBy && row[mapping.receivedBy] ? String(row[mapping.receivedBy]).trim() : '') ||
          (mapping.receiverName && row[mapping.receiverName] ? String(row[mapping.receiverName]).trim() : '') ||
          (row['RECEIVED BY'] || row['Received By'] || row['received_by'] || '');
        const isReceivedByFilled = Boolean(
          rawReceivedBy &&
          rawReceivedBy !== '-' &&
          rawReceivedBy !== 'null' &&
          rawReceivedBy !== 'undefined' &&
          rawReceivedBy !== 'N/A' &&
          rawReceivedBy.length > 0
        );

        // Column J: DISTRIBUTED DATE
        const rawDistDate =
          (mapping.distributedDate && row[mapping.distributedDate] ? String(row[mapping.distributedDate]).trim() : '') ||
          (mapping.distributedAt && row[mapping.distributedAt] ? String(row[mapping.distributedAt]).trim() : '') ||
          (row['DISTRIBUTED DATE'] || row['Distributed Date'] || row['distributed_date'] || '');

        // Column K: DISTRIBUTED BY
        const rawDistBy =
          (mapping.distributedBy && row[mapping.distributedBy] ? String(row[mapping.distributedBy]).trim() : '') ||
          (row['DISTRIBUTED BY'] || row['Distributed By'] || row['distributed_by'] || '');

        // Column L: SUBMITTED DOC.
        const rawSubDoc =
          (mapping.submittedDocument && row[mapping.submittedDocument] ? String(row[mapping.submittedDocument]).trim() : '') ||
          (row['SUBMITTED DOC.'] || row['SUBMITTED DOC'] || row['Submitted Document'] || row['submitted_doc'] || '');

        // Column M, N, O: STATUS from respective row (supports both single STATUS column and split DISTRIBUTED / MISSING / FOUND columns)
        const rawStatusValue =
          (mapping.status && row[mapping.status] !== undefined ? String(row[mapping.status]).trim() : '') ||
          (row['STATUS'] !== undefined ? String(row['STATUS']).trim() : '') ||
          (row['Status'] !== undefined ? String(row['Status']).trim() : '') ||
          (row['status'] !== undefined ? String(row['status']).trim() : '');

        const rawDistCol = String(row['DISTRIBUTED'] || row['Distributed'] || '').trim().toUpperCase();
        const rawMissCol = String(row['MISSING'] || row['Missing'] || '').trim().toUpperCase();
        const rawFoundCol = String(row['FOUND'] || row['Found'] || '').trim().toUpperCase();

        let status: LicenseRecord['status'] = 'AVAILABLE';
        if (rawMissCol.includes('MISS') || rawMissCol.includes('YES') || rawMissCol === 'MISSING') {
          status = 'MISSING';
        } else if (rawFoundCol.includes('FOUND') || rawFoundCol.includes('YES') || rawFoundCol === 'FOUND') {
          status = 'FOUND';
        } else if (rawDistCol.includes('DISTRIBUT') || rawDistCol.includes('YES') || rawDistCol === 'DISTRIBUTED') {
          status = 'DISTRIBUTED';
        } else if (rawStatusValue) {
          const rawStat = rawStatusValue.toUpperCase();
          if (rawStat.includes('DISTRIBUT') || rawStat.includes('DELIVER') || rawStat.includes('HANDOVER') || rawStat.includes('ISSUED') || rawStat.includes('COLLECTED')) {
            status = 'DISTRIBUTED';
          } else if (rawStat.includes('MISS') || rawStat.includes('LOST')) {
            status = 'MISSING';
          } else if (rawStat.includes('FOUND')) {
            status = 'FOUND';
          } else if (rawStat.includes('PEND') || rawStat.includes('PROCESS')) {
            status = 'PENDING';
          } else if (rawStat.includes('EXPIR')) {
            status = 'EXPIRED';
          } else if (rawStat.includes('AVAIL') || rawStat.includes('READY')) {
            status = 'AVAILABLE';
          } else if (isReceivedByFilled) {
            status = 'DISTRIBUTED';
          }
        } else if (isReceivedByFilled) {
          status = 'DISTRIBUTED';
        }

        const isDist = status === 'DISTRIBUTED' || isReceivedByFilled;

        const record: LicenseRecord = {
          id: 'REC_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substring(2, 6),
          sn,
          applicantId,
          licenseNumber: validLicNo,
          applicationNumber: appNo,
          holderName: cleanName,
          category,
          oldCode,
          newCode,
          department,
          office,
          phone,
          nidOrPassport: nid,
          dateOfBirth: dob,
          address,
          licenseType,
          vehicleClass,
          issueDate,
          expiryDate,
          smartCardSerial,
          status,
          receivedBy: isReceivedByFilled ? rawReceivedBy : undefined,
          receiverName: isReceivedByFilled ? rawReceivedBy : undefined,
          distributedDate: isDist ? (rawDistDate || undefined) : undefined,
          distributedAt: isDist ? (rawDistDate || undefined) : undefined,
          distributedBy: isDist ? (rawDistBy || undefined) : undefined,
          submittedDocument: isDist ? (rawSubDoc || undefined) : undefined,
          receiverRemarks: rawStatusValue || (isDist ? 'DISTRIBUTED' : 'AVAILABLE'),
          importId,
          importedAt: nowIso,
          updatedAt: nowIso,
          isDistributed: isDist,
          rawRecord: row,
        };

        normalizedRecords.push(record);
      }

      // 1. Save normalized JSON representation permanently
      const jsonFileName = `import_${importId}_normalized.json`;
      const jsonStoragePath = path.join(STORAGE_UPLOADS, jsonFileName);
      fs.writeFileSync(jsonStoragePath, JSON.stringify(normalizedRecords), 'utf-8');

      // 2. Perform Batch Insert / Update into Master Database
      const { newCount, updatedCount, duplicateCount, duplicateItems } = batchInsertOrUpdateRecords(normalizedRecords, importId, jsonStoragePath);

      const durationMs = Date.now() - startTime;
      const existingJobs = getImportJobs();
      const lotNumber = existingJobs.length + 1;
      const lotSuffix = ['th', 'st', 'nd', 'rd'][(lotNumber % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][lotNumber % 100] || 'th';
      const defaultLotCode = `${lotNumber}${lotSuffix}-LOT`;

      // 3. Record Import Job
      const importJob: ImportJob = {
        id: importId,
        filename: fileName || path.basename(filePath),
        lotCode: (req.body.lotCode && String(req.body.lotCode).trim()) || defaultLotCode,
        fileSize: fileSize || 0,
        uploadedBy: userPayload.name || 'Super Administrator',
        uploadedAt: nowIso,
        totalRows,
        newRecords: newCount,
        updatedRecords: updatedCount,
        duplicateRecords: duplicateCount,
        invalidRecords,
        duplicateItems,
        status: 'COMPLETED',
        durationMs,
        jsonStoragePath,
        originalStoragePath: filePath,
        columnMapping: mapping,
      };

      saveImportJob(importJob);

      logAudit(
        userPayload.id,
        userPayload.name,
        'EXCEL_CSV_IMPORT_COMPLETED',
        'IMPORT',
        `Successfully imported ${normalizedRecords.length} records in Lot [${importJob.lotCode}] from ${importJob.filename} (${newCount} new, ${duplicateCount} duplicates, ${updatedCount} updated, ${invalidRecords} invalid). Duration: ${durationMs}ms.`,
        req.ip
      );

      res.json({
        success: true,
        importJob,
        message: `Successfully processed ${normalizedRecords.length} records.`,
      });
    } catch (err: any) {
      logAudit(
        userPayload.id,
        userPayload.name,
        'IMPORT_FAILED',
        'IMPORT',
        `Failed import job ${importId}: ${err.message}`,
        req.ip
      );
      res.status(500).json({ error: 'Import batch processing failed: ' + err.message });
    }
  });

  // ==========================================
  // MASTER RECORDS API (Search, Filter, Pagination)
  // ==========================================
  app.get('/api/records/suggestions', requireAuth, (req: Request, res: Response) => {
    const q = (req.query.q as string) || '';
    const limit = parseInt(req.query.limit as string, 10) || 8;
    const suggestions = getProbableSuggestions(q, limit);
    res.json({ suggestions });
  });

  app.get('/api/records', requireAuth, (req: Request, res: Response) => {
    const q = (req.query.q as string) || '';
    const strictIdOrLicense = req.query.strictIdOrLicense === 'true' || req.query.strict === 'true';
    const status = (req.query.status as string) || 'ALL';
    const office = (req.query.office as string) || 'ALL';
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const sortBy = (req.query.sortBy as string) || 'importedAt';
    const sortOrder = ((req.query.sortOrder as string) || 'desc') as 'asc' | 'desc';
    const fromDateBS = (req.query.fromDateBS as string) || undefined;
    const toDateBS = (req.query.toDateBS as string) || undefined;

    const result = searchRecords({ q, strictIdOrLicense, status, office, page, limit, sortBy, sortOrder, fromDateBS, toDateBS });
    res.json(result);
  });

  app.get('/api/records/:id', requireAuth, (req: Request, res: Response) => {
    const record = getRecordById(req.params.id);
    if (!record) return res.status(404).json({ error: 'License record not found.' });
    res.json({ record });
  });

  // Handover / Distribute License Card
  app.post('/api/records/:id/distribute', requireAuth, async (req: Request, res: Response) => {
    const { receiverName, receiverNid, receiverPhone, receiverRelation, remarks, office, submittedDocument, recommendingStaffName } = req.body;
    if (!receiverName || !receiverName.trim()) {
      return res.status(400).json({
        error: 'Receiver Name (बुझिलिनेको नाम) is required.',
      });
    }

    const existingRecord = getRecordById(req.params.id);
    if (!existingRecord) {
      return res.status(404).json({ error: 'License record not found in system database.' });
    }

    // SERVER-SIDE TRANSACTION / CONDITIONAL CHECK:
    // Prevent duplicate/parallel distribution or overwrite (allow initial handover of found cards)
    const isFoundCard = Boolean(
      existingRecord.status === 'FOUND' ||
      Boolean(existingRecord.foundDate) ||
      Boolean(existingRecord.foundReason) ||
      existingRecord.rawRecord?.['FOUND'] === 'FOUND' ||
      (req.body as any)?.isFoundHandover
    );

    if (
      !isFoundCard &&
      (existingRecord.isDistributed ||
        (existingRecord.receiverName && existingRecord.receiverName.trim().length > 0) ||
        (existingRecord.receivedBy && existingRecord.receivedBy.trim().length > 0) ||
        existingRecord.status === 'DISTRIBUTED')
    ) {
      const existingRecipient = existingRecord.receiverName || existingRecord.receivedBy || 'an existing recipient';
      const existingDate = existingRecord.distributedDate || existingRecord.distributedAt || 'a previous date';
      const existingOfficer = existingRecord.distributedBy || 'an officer';
      return res.status(409).json({
        error: `✓ LICENSE ALREADY DISTRIBUTED: License ${existingRecord.licenseNumber} was already distributed to "${existingRecipient}" on ${existingDate} by ${existingOfficer}. Overwriting or redistributing is strictly forbidden.`,
      });
    }

    const finalNid = (receiverNid && receiverNid.trim()) || existingRecord.nidOrPassport || 'SELF_VERIFIED';
    const finalPhone = (receiverPhone && receiverPhone.trim()) || existingRecord.phone || 'SELF_VERIFIED';
    const userPayload = (req as any).user;

    try {
      const result = recordHandover(req.params.id, {
        receiverName: receiverName.trim(),
        receiverNid: finalNid,
        receiverPhone: finalPhone,
        receiverRelation: receiverRelation || 'SELF',
        remarks: remarks || '',
        submittedDocument: submittedDocument || existingRecord.submittedDocument,
        recommendingStaffName: recommendingStaffName || existingRecord.recommendingStaffName,
        distributedBy: userPayload.name,
        office: office || existingRecord.office,
        isFoundHandover: isFoundCard,
      } as any);

      if (!result) return res.status(404).json({ error: 'License record not found.' });

      // Enqueue background synchronization to Google Sheet (Non-blocking: sub-millisecond response)
      const queueInfo = queueGoogleSheetDistribution(result.record.licenseNumber, {
        applicantId: result.record.applicantId || result.record.applicationNumber,
        receivedBy: receiverName.trim(),
        distributedDate: result.record.distributedDate || result.record.distributedAt || new Date().toISOString(),
        distributedBy: userPayload.name,
        submittedDocument: submittedDocument || existingRecord.submittedDocument,
        status: 'DISTRIBUTED',
        isFoundHandover: isFoundCard,
      } as any);

      // Immediate parallel direct writeback to Google Sheet in background
      updateGoogleSheetDistribution(result.record.licenseNumber, {
        applicantId: result.record.applicantId || result.record.applicationNumber,
        receivedBy: receiverName.trim(),
        distributedDate: result.record.distributedDate || result.record.distributedAt || new Date().toISOString(),
        distributedBy: userPayload.name,
        submittedDocument: submittedDocument || existingRecord.submittedDocument,
        status: 'DISTRIBUTED',
        isFoundHandover: isFoundCard,
      } as any).catch((err: any) => console.warn('[Parallel Google Sheet Direct Writeback]:', err?.message));

      // Reconcile in-memory sheet records and sheet statistics in real-time
      updateInMemoryGoogleSheetRecord(result.record);
      syncSheetStatsWithDatabase();

      logAudit(
        userPayload.id,
        userPayload.name,
        'RECORD_DISTRIBUTED',
        'DISTRIBUTION',
        `Distributed license ${result.record.licenseNumber} to receiver ${receiverName} (Ref: ${result.distribution.handoverReference}). Submitted Doc: ${submittedDocument || 'N/A'}${recommendingStaffName ? ` (Recommender: ${recommendingStaffName})` : ''}. Background sync queued (Queue pos: ${queueInfo.queueLength}).`,
        req.ip
      );

      res.json({
        success: true,
        record: result.record,
        distribution: result.distribution,
        sheetUpdated: true,
        queued: true,
        queuePosition: queueInfo.queueLength,
        message: 'License card handed over and saved to database successfully with high speed.',
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({ error: err.message || 'Handover processing failed.' });
    }
  });

  // Reset Distribution Record (SUPER ADMIN ONLY - for correcting data entry errors)
  app.post('/api/records/:id/reset-distribution', requireAuth, (req: Request, res: Response) => {
    const userPayload = (req as any).user;
    const role = (userPayload?.role || '').toUpperCase();
    const isSuperAdmin = role.includes('SUPER') || userPayload?.id === 'SUPER_ADMIN';

    if (!isSuperAdmin) {
      return res.status(403).json({
        error: 'FORBIDDEN: Only Super Admin is authorized to reset distribution details to correct data entry.',
      });
    }

    try {
      const updated = resetRecordDistribution(req.params.id, userPayload.name, userPayload.id, req.ip);
      if (!updated) {
        return res.status(404).json({ error: 'License record not found.' });
      }

      // Immediately clear distribution columns in Google Sheet
      queueGoogleSheetDistribution(updated.licenseNumber, {
        applicantId: updated.applicantId || updated.applicationNumber,
        receivedBy: '',
        distributedDate: '',
        distributedBy: '',
        submittedDocument: '',
        status: 'AVAILABLE',
      });
      updateGoogleSheetDistribution(updated.licenseNumber, {
        applicantId: updated.applicantId || updated.applicationNumber,
        receivedBy: '',
        distributedDate: '',
        distributedBy: '',
        submittedDocument: '',
        status: 'AVAILABLE',
      }).catch((e) => console.warn('[Un-distribute Sheet Sync Warning]:', e.message));

      updateInMemoryGoogleSheetRecord(updated);
      syncSheetStatsWithDatabase();

      res.json({
        success: true,
        record: updated,
        message: 'Distribution details reset successfully. Record is un-distributed.',
      });
    } catch (err: any) {
      console.error('Reset distribution failed:', err);
      res.status(500).json({ error: err.message || 'Failed to reset distribution details.' });
    }
  });

  // Update / Correct Distribution Record (SUPER ADMIN - Corrects Recipient Name & Submitted Doc in Database & Google Sheet immediately)
  app.post('/api/records/:id/update-distribution', requireAuth, async (req: Request, res: Response) => {
    const userPayload = (req as any).user;
    const role = (userPayload?.role || '').toUpperCase();
    const isSuperAdmin = role.includes('SUPER') || userPayload?.id === 'SUPER_ADMIN';

    if (!isSuperAdmin) {
      return res.status(403).json({
        error: 'FORBIDDEN: Only Super Admin is authorized to correct recipient distribution details.',
      });
    }

    const { receiverName, submittedDocument } = req.body;
    if (!receiverName || !receiverName.trim()) {
      return res.status(400).json({ error: 'बुझिलिने व्यक्तिको नाम (Recipient Name) अनिवार्य छ।' });
    }

    try {
      const cleanReceiver = receiverName.trim().toUpperCase();
      const updated = correctRecordDistribution(
        req.params.id,
        {
          receiverName: cleanReceiver,
          submittedDocument: submittedDocument ? submittedDocument.trim() : undefined,
        },
        userPayload.name,
        userPayload.id,
        req.ip
      );

      if (!updated) {
        return res.status(404).json({ error: 'License record not found.' });
      }

      // Replace immediately in Google Sheet via both live writeback and write queue
      const sheetData = {
        applicantId: updated.applicantId || updated.applicationNumber,
        receivedBy: cleanReceiver,
        distributedDate: updated.distributedDate || updated.distributedAt || new Date().toISOString(),
        distributedBy: updated.distributedBy || userPayload.name,
        submittedDocument: updated.submittedDocument || 'Original Smart Card',
        status: 'DISTRIBUTED',
      };

      queueGoogleSheetDistribution(updated.licenseNumber, sheetData);
      updateGoogleSheetDistribution(updated.licenseNumber, sheetData).catch((e) => {
        console.warn('[Direct Sheet Writeback Warning]:', e.message);
      });

      updateInMemoryGoogleSheetRecord(updated);
      syncSheetStatsWithDatabase();

      res.json({
        success: true,
        record: updated,
        message: 'वितरण विवरण सफलतापूर्वक सच्याइयो र सुरक्षित गरियो। Database र Google Sheet मा तत्काल प्रतिस्थापन भयो।',
      });
    } catch (err: any) {
      console.error('Update distribution failed:', err);
      res.status(500).json({ error: err.message || 'Failed to update distribution details.' });
    }
  });

  // Save / Update Submitted Document for a record
  app.post('/api/records/:id/submitted-document', requireAuth, (req: Request, res: Response) => {
    const { submittedDocument, recommendingStaffName } = req.body;
    if (!submittedDocument || !submittedDocument.trim()) {
      return res.status(400).json({ error: 'Submitted document selection is required.' });
    }

    const userPayload = (req as any).user;
    const staffName = userPayload?.name || 'KOMAL DAHAL';

    const updated = updateSubmittedDocument(
      req.params.id,
      submittedDocument.trim(),
      recommendingStaffName !== undefined ? recommendingStaffName.trim() : undefined,
      staffName
    );
    if (!updated) return res.status(404).json({ error: 'License record not found.' });

    logAudit(
      userPayload.id,
      userPayload.name,
      'RECORD_UPDATE',
      'RECORD_UPDATE',
      `Updated submitted document for license ${updated.licenseNumber} (${updated.holderName}) to "${submittedDocument}"${recommendingStaffName ? ` (Recommending Staff: ${recommendingStaffName})` : ''} by ${staffName}.`,
      req.ip
    );

    updateInMemoryGoogleSheetRecord(updated);
    syncSheetStatsWithDatabase();

    res.json({
      success: true,
      record: updated,
      message: 'Submitted document recorded successfully.',
    });
  });

  // Update Status (e.g. mark MISSING, AVAILABLE, EXPIRED, FOUND)
  app.post('/api/records/:id/status', requireAuth, (req: Request, res: Response) => {
    try {
      const { status, reason, phone, contactMobile, submittedDocument, recommendingStaffName, receiverName, foundBy } = req.body;
      if (!status) return res.status(400).json({ error: 'Target status is required.' });

      const userPayload = (req as any).user;
      if (userPayload && userPayload.role !== 'SUPER ADMIN' && userPayload.role !== 'SUPER_ADMIN' && userPayload.role !== 'OWNER_ADMIN') {
        const perms: string[] = userPayload.permissions || [];
        if (status === 'MISSING') {
          const canMissing = perms.includes('*') || perms.includes('records.mark_missing') || perms.includes('records.search_mark_missing');
          if (!canMissing) {
            return res.status(403).json({ error: 'Access Denied: You do not have permission to mark records as missing.' });
          }
        }
      }

      const cleanPhone = (contactMobile || phone || '').trim();
      const loginUserFullName = resolveUserFullName(
        req.body.missingMarkedBy ||
        req.body.reportedBy ||
        req.body.searchedBy ||
        req.body.user ||
        userPayload?.name ||
        userPayload?.id
      );
      const updated = updateRecordStatus(req.params.id, status, {
        reason,
        user: loginUserFullName,
        phone: cleanPhone,
        contactMobile: cleanPhone,
        submittedDocument,
        recommendingStaffName,
        receiverName,
        foundBy: foundBy || loginUserFullName,
      });

      if (!updated) return res.status(404).json({ error: 'License record not found.' });

      // Immediate Google Sheets Automatic Status Writeback (MISSING, FOUND, DISTRIBUTED, AVAILABLE)
      let sheetStatus = status;
      let recvBy = '-';
      let distDate = getNepaliDevanagariBSDate(new Date());
      let distBy = userPayload.name || 'PLSMS OFFICER';
      let subDoc = updated.submittedDocument || '-';

      if (status === 'MISSING') {
        sheetStatus = 'MISSING';
        recvBy = '';
        distDate = '';
        distBy = '';
        subDoc = '';
      } else if (status === 'FOUND') {
        sheetStatus = 'FOUND';
        const isHandedOver = Boolean(updated.foundHandoverDone || updated.status === 'DISTRIBUTED');
        recvBy = isHandedOver ? (updated.receivedBy || receiverName || updated.holderName || '') : '';
        distDate = isHandedOver ? (updated.distributedDate || getNepaliDevanagariBSDate(new Date())) : '';
        distBy = isHandedOver ? (updated.distributedBy || userPayload.name || 'KOMAL DAHAL') : '';
        subDoc = isHandedOver ? (updated.submittedDocument || 'Original Smart Card') : '';
      } else if (status === 'DISTRIBUTED') {
        sheetStatus = 'DISTRIBUTED';
        recvBy = updated.receivedBy || receiverName || updated.holderName || '';
        distDate = updated.distributedDate || getNepaliDevanagariBSDate(new Date());
        distBy = updated.distributedBy || userPayload.name || 'PLSMS OFFICER';
        subDoc = updated.submittedDocument || 'Original Smart Card';
      } else if (status === 'AVAILABLE') {
        sheetStatus = 'AVAILABLE';
        recvBy = '';
        distDate = '';
        distBy = '';
        subDoc = '';
      }

      const sheetUpdatePayload = {
        applicantId: updated.applicantId || updated.applicationNumber,
        receivedBy: recvBy,
        distributedDate: distDate,
        distributedBy: distBy,
        submittedDocument: subDoc,
        status: sheetStatus,
      };

      // Resilient writeback: Queue first for guaranteed delivery and fire immediate async push
      queueGoogleSheetDistribution(updated.licenseNumber, sheetUpdatePayload);
      updateGoogleSheetDistribution(updated.licenseNumber, sheetUpdatePayload).catch((e) =>
        console.warn('Google Sheet background sync notice for status update:', e)
      );

      // Reconcile comparison counts immediately
      updateInMemoryGoogleSheetRecord(updated);
      syncSheetStatsWithDatabase();

      logAudit(
        userPayload.id,
        userPayload.name,
        'STATUS_CHANGE',
        status === 'MISSING' ? 'MISSING' : status === 'FOUND' ? 'FOUND' : 'STATUS_CHANGE',
        `Updated status of license ${updated.licenseNumber} to ${status}.${cleanPhone ? ' Contact Mobile: ' + cleanPhone + '.' : ''}${submittedDocument ? ' Submitted Doc: ' + submittedDocument + '.' : ''}${receiverName ? ' Receiver: ' + receiverName + '.' : ''} ${reason ? 'Reason: ' + reason : ''}`,
        req.ip
      );

      res.json({ success: true, record: updated });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({ error: err.message || 'Status update failed.' });
    }
  });

  // Update Record Contact Mobile (Compulsory for Missing Card Handover - Super Admin Only)
  app.post('/api/records/:id/mobile', requireSuperAdmin, (req: Request, res: Response) => {
    try {
      const { phone, contactMobile } = req.body;
      const cleanPhone = (contactMobile || phone || '').trim();
      if (!cleanPhone) {
        return res.status(400).json({ error: 'Contact mobile number is compulsory.' });
      }

      const digitsOnly = cleanPhone.replace(/\D/g, '');
      if (digitsOnly.length < 10) {
        return res.status(400).json({ error: 'Please provide a valid 10-digit mobile number.' });
      }

      const updated = updateRecordPhone(req.params.id, cleanPhone);
      if (!updated) return res.status(404).json({ error: 'License record not found.' });

      const userPayload = (req as any).user;
      logAudit(
        userPayload?.id || 'SYSTEM',
        userPayload?.name || 'ADMIN',
        'UPDATE_MOBILE',
        'RECORD_UPDATE',
        `Updated contact mobile number of license ${updated.licenseNumber} to ${cleanPhone}.`,
        req.ip
      );

      res.json({ success: true, record: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update mobile number.' });
    }
  });

  // ==========================================
  // SQL VIEWS ENDPOINTS
  // ==========================================
  
  // View: vw_distributed_cards (All distributed cards with same-day time-bound indicator)
  app.get('/api/views/distributed', requireAuth, (req: Request, res: Response) => {
    const list = getDistributedViewRecords();
    res.json({ records: list, total: list.length });
  });

  // View: vw_missing_cards (Missing sub-status cards)
  app.get('/api/views/missing', requireAuth, (req: Request, res: Response) => {
    const list = getMissingViewRecords();
    res.json({ records: list, total: list.length });
  });

  // View: vw_inventory_identity_summary (Total = Not-Distributed + Distributed)
  app.get('/api/views/inventory-summary', requireAuth, (req: Request, res: Response) => {
    const summary = getInventoryIdentitySummary();
    res.json(summary);
  });

  // ==========================================
  // DASHBOARD & ANALYTICS API (Zero fake stats)
  // ==========================================
  const handleGetDashboardStats = (req: Request, res: Response) => {
    try {
      const stats = getDashboardStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch dashboard statistics' });
    }
  };

  app.get('/api/dashboard/stats', requireAuth, handleGetDashboardStats);
  app.get('/api/stats', requireAuth, handleGetDashboardStats);

  // Live Sync Dashboard (Invalidates cache & returns fresh stats)
  app.post('/api/dashboard/live-sync', requireAuth, (req: Request, res: Response) => {
    try {
      invalidateRecordsCache();
      const stats = getDashboardStats();
      res.json({
        success: true,
        stats,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to perform live dashboard sync' });
    }
  });

  // Alphabetical Dashboard Aggregation (A-Z breakdown)
  app.get('/api/dashboard/alphabetical', requireAuth, (req: Request, res: Response) => {
    try {
      const fromDate = req.query.fromDate ? String(req.query.fromDate) : undefined;
      const toDate = req.query.toDate ? String(req.query.toDate) : undefined;
      const result = getAlphabeticalDashboardStats(fromDate, toDate);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to calculate alphabetical dashboard statistics' });
    }
  });

  // ==========================================
  // MISSING RECORDS
  // ==========================================
  app.get('/api/missing', requireAuth, (req: Request, res: Response) => {
    const missing = getMissingViewRecords();
    res.json({ records: missing, total: missing.length });
  });

  // ==========================================
  // FOUND RECORDS
  // ==========================================
  app.get('/api/found', requireAuth, (req: Request, res: Response) => {
    const found = getFoundViewRecords();
    res.json({ records: found, total: found.length });
  });

  // ==========================================
  // HANDED OVER RECORDS
  // ==========================================
  app.get('/api/handed-over', requireAuth, (req: Request, res: Response) => {
    const records = getHandedOverViewRecords();
    res.json({ records, total: records.length });
  });

  // ==========================================
  // DISTRIBUTIONS ARCHIVE
  // ==========================================
  app.get('/api/distributions', requireAuth, (req: Request, res: Response) => {
    const list = getDistributions();
    res.json({ distributions: list, total: list.length });
  });

  // ==========================================
  // IMPORT HISTORY & JSON BACKUP DOWNLOAD
  // ==========================================
  app.get('/api/imports', requireAuth, (req: Request, res: Response) => {
    const list = getImportJobs();
    res.json({ imports: list, total: list.length });
  });

  app.delete('/api/imports/:id', requireAdminOrSuperAdmin, (req: Request, res: Response) => {
    const userPayload = (req as any).user;
    const result = deleteImportJob(req.params.id);
    if (!result.success) {
      return res.status(404).json({ error: 'Import batch not found or could not be removed.' });
    }

    logAudit(
      userPayload.id,
      userPayload.name,
      'IMPORT_LOT_DELETED',
      'IMPORT',
      `Deleted import batch [${req.params.id}] and purged ${result.deletedRecords} associated records.`,
      req.ip
    );

    res.json({ success: true, deletedRecords: result.deletedRecords });
  });

  app.post('/api/database/clear-master-data', requireSuperAdmin, (req: Request, res: Response) => {
    const userPayload = (req as any).user;
    const result = clearAllMasterData();

    logAudit(
      userPayload.id,
      userPayload.name,
      'MASTER_DATABASE_RESET',
      'SECURITY',
      `Permanently cleared all mock and demo records (${result.clearedRecords} records, ${result.clearedImports} import lots).`,
      req.ip
    );

    res.json({ success: true, ...result, message: 'All mock and sample data permanently purged.' });
  });

  app.get('/api/imports/:id/download-json', requireAuth, (req: Request, res: Response) => {
    const imports = getImportJobs();
    const job = imports.find((j) => j.id === req.params.id);
    if (!job || !job.jsonStoragePath || !fs.existsSync(job.jsonStoragePath)) {
      return res.status(404).json({ error: 'Normalized JSON backup file not found for this import.' });
    }

    res.download(job.jsonStoragePath, `import_${job.id}_normalized_backup.json`);
  });

  // ==========================================
  // GOOGLE SHEETS MASTER DATA SYNC & BENCHMARK
  // ==========================================
  // Google Sheets Sync & Configuration Endpoints
  const handleGetSheetsConfig = (req: Request, res: Response) => {
    try {
      const config = getGoogleSheetsConfig();
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch Google Sheets config' });
    }
  };

  const handleSaveSheetsConfig = (req: Request, res: Response) => {
    try {
      const { spreadsheetId, tabName, publishedUrl, webAppUrl } = req.body || {};
      const saved = saveGoogleSheetsConfig({
        spreadsheetId: spreadsheetId !== undefined ? String(spreadsheetId).trim() : undefined,
        tabName: tabName !== undefined ? String(tabName).trim() : undefined,
        publishedUrl: publishedUrl !== undefined ? String(publishedUrl).trim() : undefined,
        webAppUrl: webAppUrl !== undefined ? String(webAppUrl).trim() : undefined,
      });
      res.json({ success: true, config: saved });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to save Google Sheets config' });
    }
  };

  const handleResetSheetsConfig = (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const isSuperAdmin =
        user &&
        (user.role === 'SUPER ADMIN' ||
          user.role === 'SUPER_ADMIN' ||
          user.id === 'SUPER_ADMIN' ||
          user.id === 'TMODLSUNSARI');

      if (!isSuperAdmin) {
        return res.status(403).json({
          error: 'Access Denied: Only the Super Administrator is authorized to reset databases or clear synchronizer records.',
        });
      }

      const resetAppDatabase = req.body?.resetAppDatabase === true || req.query?.both === 'true';

      let dbResetResult: any = null;
      if (resetAppDatabase) {
        dbResetResult = resetProductionDatabase(
          user?.id || 'SYSTEM',
          user?.name || 'Authorized Admin',
          req.ip || '127.0.0.1'
        );
      }

      const reset = resetGoogleSheetsSyncState();
      notifyDatabaseResetOrRestore({
        totalRecords: 0,
        availableRecords: 0,
        distributedRecords: 0,
        missingRecords: 0,
        foundRecords: 0,
      });

      if (!resetAppDatabase) {
        logAudit(
          user?.id || 'SYSTEM',
          user?.name || 'Authorized Admin',
          'GOOGLE_SHEET_RESET',
          'IMPORT',
          'Reset all Google Sheets addresses, textboxes, and caches to 0',
          req.ip || '127.0.0.1'
        );
      }

      res.json({
        success: true,
        message: resetAppDatabase
          ? '✓ PARALLEL RESET SUCCESSFUL: Both PLSMS App Database and Google Sheet Database have been cleared to 0 records (Resetting Mode Active).'
          : '✓ All Google Sheet file address textboxes, URLs, and memory caches have been completely reset to 0 / empty.',
        config: reset,
        dbStats: resetAppDatabase ? getDashboardStats() : undefined,
        details: dbResetResult,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to reset Google Sheets sync state' });
    }
  };

  const handleSyncSheets = async (req: Request, res: Response) => {
    try {
      const { spreadsheetId, tabName, publishedUrl } = req.body || {};
      const userPayload = (req as any).user || {};
      const result = await syncFromGoogleSheets({
        spreadsheetId: spreadsheetId ? String(spreadsheetId).trim() : undefined,
        tabName: tabName ? String(tabName).trim() : undefined,
        publishedUrl: publishedUrl ? String(publishedUrl).trim() : undefined,
        uploadedBy: userPayload.name || userPayload.email || 'Super Administrator',
        ipAddress: req.ip,
      });

      res.json(result);
    } catch (err: any) {
      if (err.isRestricted || err.isNotFound) {
        console.warn(`[Google Sheets Sync] Access restricted or sheet not found: ${err.message}`);
      } else {
        console.error('Google Sheets sync error:', err);
      }
      res.status(400).json({
        error: err.message || 'Failed to synchronize with Google Sheets.',
        isRestricted: Boolean(err.isRestricted),
        sheetUrl: err.sheetUrl,
        spreadsheetId: err.spreadsheetId,
        serviceAccountEmail: err.serviceAccountEmail,
      });
    }
  };

  app.get('/api/google-sheets/config', requireAuth, handleGetSheetsConfig);
  app.get('/api/sheets/config', requireAuth, handleGetSheetsConfig);
  app.get('/api/admin/sync-sheet/config', requireAuth, handleGetSheetsConfig);

  app.post('/api/google-sheets/config', requireAuth, handleSaveSheetsConfig);
  app.post('/api/sheets/config', requireAuth, handleSaveSheetsConfig);
  app.post('/api/admin/sync-sheet/config', requireAuth, handleSaveSheetsConfig);

  app.post('/api/google-sheets/reset', requireAuth, handleResetSheetsConfig);
  app.post('/api/sheets/reset', requireAuth, handleResetSheetsConfig);
  app.post('/api/admin/sync-sheet/reset', requireAuth, handleResetSheetsConfig);

  app.post('/api/google-sheets/sync', requireUploadOrSyncPermission, handleSyncSheets);
  app.post('/api/sheets/sync', requireUploadOrSyncPermission, handleSyncSheets);
  app.post('/api/admin/sync-sheet', requireUploadOrSyncPermission, handleSyncSheets);

  // 24/7 Continuous Background Sync Settings Endpoint
  const handleAutoSyncSettings = (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (user && user.role !== 'SUPER ADMIN' && user.role !== 'SUPER_ADMIN' && user.role !== 'OWNER_ADMIN') {
        const perms: string[] = user.permissions || [];
        const hasIntervalPerm =
          perms.includes('*') ||
          perms.includes('settings.sync_interval') ||
          perms.includes('uploads.sync_interval');
        if (!hasIntervalPerm) {
          return res.status(403).json({
            error: 'Access Denied: You do not have permission to configure 24/7 Background Daemon Interval.',
          });
        }
      }

      const { enabled, intervalSeconds } = req.body || {};
      const updated = update24hSyncDaemonSettings({
        enabled: Boolean(enabled),
        intervalSeconds: Number(intervalSeconds) || 60,
      });

      logAudit(
        user?.id || 'SYSTEM',
        user?.name || 'Authorized Admin',
        'DAEMON_INTERVAL_CONFIG',
        'IMPORT',
        `Configured 24/7 Background Daemon interval to ${Number(intervalSeconds) || 60}s (${Boolean(enabled) ? 'ACTIVE' : 'PAUSED'})`,
        req.ip || '127.0.0.1'
      );

      res.json({ success: true, config: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update 24/7 sync settings' });
    }
  };

  app.post('/api/google-sheets/autosync-settings', requireAuth, handleAutoSyncSettings);
  app.post('/api/sheets/autosync-settings', requireAuth, handleAutoSyncSettings);
  app.post('/api/admin/sync-sheet/autosync-settings', requireAuth, handleAutoSyncSettings);

  // Trigger Immediate 24/7 Daemon Sync Cycle
  const handleTriggerDaemonSync = async (req: Request, res: Response) => {
    try {
      await runDaemonSyncCycle();
      const config = getGoogleSheetsConfig();
      res.json({ success: true, config });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to execute daemon sync cycle' });
    }
  };

  app.post('/api/google-sheets/trigger-sync', requireAuth, handleTriggerDaemonSync);
  app.post('/api/sheets/trigger-sync', requireAuth, handleTriggerDaemonSync);

  // Background High-Speed Queue Status
  app.get('/api/google-sheets/queue-status', requireAuth, (req: Request, res: Response) => {
    res.json({ success: true, queue: getSheetQueueStatus() });
  });

  // Get Apps Script Fast In-Memory Hash Code
  app.get('/api/google-sheets/apps-script-code', requireAuth, (req: Request, res: Response) => {
    res.json({
      success: true,
      scriptCode: APPS_SCRIPT_HASH_INDEX_CODE,
      filename: 'PLSMS_FastHashIndex_GoogleAppsScript.gs',
      version: '2.0.0-PRO',
      features: [
        'Fast In-Memory Hash Indexing (O(1) Dictionary lookups across 200,000+ rows)',
        'Zero-Latency Execution Memory Cache (_HASH_INDEX_CACHE)',
        'Atomic 1x5 Continuous Range Writeback (Columns I:M)',
        'Multi-Key Normalization (Formatted, Raw, Normalized, Applicant ID)',
        '5-Terminal Thread-Safe Script Locking (LockService)',
        'Batch Mode Support for Multiple Record Updates in 1 HTTP Request',
        'Sub-Millisecond Direct GET Query & Search Endpoint',
      ],
    });
  });
  app.get('/api/sheets/apps-script-code', requireAuth, (req: Request, res: Response) => {
    res.json({ success: true, scriptCode: APPS_SCRIPT_HASH_INDEX_CODE });
  });

  // Push All Distributed Records to Google Sheet Columns I:O (Fast In-Memory Hash Batch Supported)
  const handlePushAllDistributed = async (req: Request, res: Response) => {
    try {
      const all = getAllRecords();
      const distributed = all.filter((r) => 
        isRecordDistributed(r) || isRecordMissing(r) || isRecordFound(r) ||
        r.status === 'DISTRIBUTED' || r.status === 'MISSING' || r.status === 'FOUND' ||
        (r.receivedBy && r.receivedBy !== '-')
      );
      
      const config = getGoogleSheetsConfig();
      // If Apps Script Webhook is active, use high-speed batch push with in-memory hash indexing
      if (config.webAppUrl && config.webAppUrl.trim().startsWith('http') && distributed.length > 0) {
        const batchPayload = distributed.map((rec) => {
          const isMissing = isRecordMissing(rec);
          const isFound = !isMissing && isRecordFound(rec);
          const isDist = !isMissing && !isFound && (isRecordDistributed(rec) || (!rec.status && Boolean(rec.receivedBy && rec.receivedBy !== '-')));

          return {
            licenseNumber: rec.licenseNumber,
            applicantId: rec.applicantId || rec.applicationNumber,
            receivedBy: (isDist || isFound) ? (rec.receivedBy || rec.receiverName || '') : '',
            distributedDate: (isDist || isFound) ? (isFound ? (rec.foundDate || rec.distributedDate || rec.distributedAt) : (rec.distributedDate || rec.distributedAt)) : '',
            distributedBy: (isDist || isFound) ? (isFound ? (rec.foundReportedBy || rec.distributedBy || 'KOMAL DAHAL') : (rec.distributedBy || 'KOMAL DAHAL')) : '',
            submittedDocument: (isDist || isFound) ? (rec.submittedDocument || 'Original Smart Card') : '',
            status: isMissing ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : (rec.status || 'AVAILABLE'))),
          };
        });

        const batchRes = await batchUpdateGoogleSheetDistributions(batchPayload);
        if (batchRes.success) {
          const currentConfig = getGoogleSheetsConfig();
          if (currentConfig.sheetStats) {
            saveGoogleSheetsConfig({
              sheetStats: {
                ...currentConfig.sheetStats,
                distributedRecords: distributed.length,
                availableRecords: Math.max(0, currentConfig.sheetStats.totalRecords - distributed.length),
              },
            });
          }
          return res.json({
            success: true,
            totalDistributed: distributed.length,
            syncedToSheet: batchRes.syncedToSheet,
            skippedOrFailed: batchRes.failedCount,
            method: 'APPS_SCRIPT_FAST_HASH_BATCH',
            message: `Fast In-Memory Hash batch synced ${batchRes.syncedToSheet} records directly to Google Sheet with Picture 1 styles`,
          });
        }
      }

      let successCount = 0;
      let failedCount = 0;

      for (const rec of distributed) {
        const isMissing = isRecordMissing(rec);
        const isFound = !isMissing && isRecordFound(rec);
        const isDist = !isMissing && !isFound && (isRecordDistributed(rec) || (!rec.status && Boolean(rec.receivedBy && rec.receivedBy !== '-')));

        const syncRes = await updateGoogleSheetDistribution(rec.licenseNumber, {
          applicantId: rec.applicantId || rec.applicationNumber,
          receivedBy: (isDist || isFound) ? (rec.receivedBy || rec.receiverName || '') : '',
          distributedDate: (isDist || isFound) ? (isFound ? (rec.foundDate || rec.distributedDate || rec.distributedAt) : (rec.distributedDate || rec.distributedAt)) : '',
          distributedBy: (isDist || isFound) ? (isFound ? (rec.foundReportedBy || rec.distributedBy || 'KOMAL DAHAL') : (rec.distributedBy || 'KOMAL DAHAL')) : '',
          submittedDocument: (isDist || isFound) ? (rec.submittedDocument || 'Original Smart Card') : '',
          status: isMissing ? 'MISSING' : (isFound ? 'FOUND' : (isDist ? 'DISTRIBUTED' : (rec.status || 'AVAILABLE'))),
        });
        if (syncRes.sheetUpdated) successCount++;
        else failedCount++;
      }

      const currentConfig = getGoogleSheetsConfig();
      if (currentConfig.sheetStats) {
        saveGoogleSheetsConfig({
          sheetStats: {
            ...currentConfig.sheetStats,
            distributedRecords: distributed.length,
            availableRecords: Math.max(0, currentConfig.sheetStats.totalRecords - distributed.length),
          },
        });
      }

      res.json({
        success: true,
        totalDistributed: distributed.length,
        syncedToSheet: successCount,
        skippedOrFailed: failedCount,
        message: `Synced ${successCount} records directly to Google Sheet columns I:O with Picture 1 styles`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to push distributed records' });
    }
  };

  app.post('/api/google-sheets/push-all-distributed', requireAuth, handlePushAllDistributed);
  app.post('/api/sheets/push-all-distributed', requireAuth, handlePushAllDistributed);
  app.post('/api/admin/sync-sheet/push-all-distributed', requireAuth, handlePushAllDistributed);

  // Auto-Sync / Category Import Handler for 5 cards (TOTAL, AVAILABLE, DISTRIBUTED, MISSING, FOUND)
  const handleAutoSyncCategory = async (req: Request, res: Response) => {
    try {
      const { category = 'ALL', source = 'DB', page = 1, limit = 100, search = '' } = req.body || {};
      const result = await autoSyncCategoryHandler(category, source, { page, limit, search });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Auto sync / category import failed' });
    }
  };

  app.post('/api/sheets/auto-sync-category', requireAuth, handleAutoSyncCategory);
  app.post('/api/google-sheets/auto-sync-category', requireAuth, handleAutoSyncCategory);
  app.post('/api/admin/sync-sheet/auto-sync-category', requireAuth, handleAutoSyncCategory);

  // Cross-Platform KAP / MAP Parity Stats Endpoint
  app.get('/api/google-sheets/parity-stats', requireAuth, (req: Request, res: Response) => {
    try {
      const stats = getCrossPlatformParityStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to calculate cross-platform parity stats' });
    }
  });

  // Dynamic Sheet Name Import Endpoint directly from the Linked Google Sheet
  const handleImportSheetName = async (req: Request, res: Response) => {
    try {
      const result = await importSheetNameFromLinkedSheet();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to import sheet name from Google Sheet' });
    }
  };

  app.get('/api/google-sheets/sheet-info', requireAuth, handleImportSheetName);
  app.get('/api/sheets/sheet-info', requireAuth, handleImportSheetName);
  app.post('/api/google-sheets/import-sheet-name', requireAuth, handleImportSheetName);
  app.post('/api/sheets/import-sheet-name', requireAuth, handleImportSheetName);

  app.post('/api/benchmark/search-latency', requireAuth, (req: Request, res: Response) => {
    try {
      const { iterations = 2000 } = req.body || {};
      const benchmark = benchmarkSearchLatency(Number(iterations) || 2000);
      res.json(benchmark);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to run search latency benchmark' });
    }
  });

  // ==========================================
  // AUDIT LOGS
  // ==========================================
  app.get('/api/audit-logs', requireAuth, (req: Request, res: Response) => {
    const logs = getAuditLogs();
    res.json({ logs, total: logs.length });
  });

  app.post('/api/admin/reset-audit-logs', requireSuperAdmin, (req: Request, res: Response) => {
    try {
      const reqUser = (req as any).user;
      if (!reqUser) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!isSuperAdminUser(reqUser)) {
        return res.status(403).json({ error: 'Access denied: Super Administrator authority required to purge audit logs.' });
      }

      const result = resetAuditLogs();
      res.json({
        success: true,
        message: `✓ AUDIT LOGS RESET SUCCESSFULLY — ${result.clearedLogs} audit events permanently purged. Clean slate active.`,
        clearedLogs: result.clearedLogs,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to reset audit logs: ' + (err.message || 'Internal server error') });
    }
  });

  // ==========================================
  // REPORT STATS & COUNTS FOR REPORT TERMINAL
  // ==========================================
  app.get('/api/reports/counts', requireAuth, (req: Request, res: Response) => {
    try {
      const all = getAllRecords();
      const importJobs = getImportJobs();
      const office = (req.query.office as string) || 'ALL';

      let pool = all;
      if (office && office !== 'ALL') {
        pool = pool.filter((r) => (r.office || '').trim().toLowerCase() === office.trim().toLowerCase());
      }

      const totalSmartCards = pool.length;
      let available = 0;
      let distributed = 0;
      let missing = 0;
      let found = 0;
      let handedOver = 0;
      let pending = 0;

      for (const r of pool) {
        if (isRecordMissing(r)) {
          missing++;
        } else if (isRecordFound(r)) {
          found++;
        }
        if (r.status === 'PENDING') pending++;

        if (isRecordDistributed(r)) {
          distributed++;
        } else {
          available++;
        }

        if (
          isRecordDistributed(r) ||
          r.status === 'DISTRIBUTED' ||
          r.foundHandoverDone === true ||
          r.rawRecord?.['FOUND_HANDOVER'] === 'DONE' ||
          Boolean(r.distributedDate)
        ) {
          handedOver++;
        }
      }

      res.json({
        totalSmartCards,
        notDistributed: available,
        distributed,
        missing,
        found,
        handedOver,
        requestToReceive: pending,
        uploadHistory: importJobs.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to compute report counts: ${err.message}` });
    }
  });

  // ==========================================
  // REPORT PREVIEW DATA (FOR PRINT / PDF VIEW)
  // ==========================================
  app.post('/api/reports/preview-data', requireAuth, (req: Request, res: Response) => {
    try {
      const { reportType, office } = req.body || {};
      const all = getAllRecords();
      let pool = [...all];

      if (office && office !== 'ALL') {
        pool = pool.filter((r) => (r.office || '').trim().toLowerCase() === office.trim().toLowerCase());
      }

      let filtered: any[] = [];
      let reportTitle = 'TOTAL SMART CARDS REPORT';

      switch (reportType) {
        case 'NOT_DISTRIBUTED':
          reportTitle = 'NOT DISTRIBUTED CARDS REPORT';
          filtered = pool.filter((r) => !isRecordDistributed(r));
          break;
        case 'DISTRIBUTED':
        case 'DISTRIBUTION_AUDIT':
          reportTitle = 'DISTRIBUTED CARDS REPORT';
          filtered = pool.filter((r) => isRecordDistributed(r));
          break;
        case 'MISSING':
        case 'MISSING_RECORDS':
          reportTitle = 'MISSING CARDS REPORT';
          filtered = pool.filter((r) => isRecordMissing(r));
          break;
        case 'FOUND':
          reportTitle = 'FOUND CARDS REPORT';
          filtered = pool.filter((r) => isRecordFound(r));
          break;
        case 'HANDED_OVER':
          reportTitle = 'HANDED OVER CARDS REPORT';
          filtered = pool.filter(
            (r) =>
              isRecordDistributed(r) ||
              r.status === 'DISTRIBUTED' ||
              r.foundHandoverDone === true ||
              r.rawRecord?.['FOUND_HANDOVER'] === 'DONE' ||
              Boolean(r.distributedDate)
          );
          break;
        case 'REQUEST_TO_RECEIVE':
          reportTitle = 'REQUEST TO RECEIVE REPORT';
          filtered = pool.filter((r) => r.status === 'PENDING');
          break;
        case 'UPLOAD_HISTORY':
          reportTitle = 'UPLOAD HISTORY REPORT';
          filtered = getImportJobs();
          break;
        case 'TOTAL_SMART_CARDS':
        case 'MASTER_INVENTORY':
        default:
          reportTitle = 'TOTAL SMART CARDS REPORT';
          filtered = pool;
          break;
      }

      res.json({
        reportTitle,
        reportType,
        total: filtered.length,
        records: filtered,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // REAL EXCEL & CSV REPORT GENERATOR (OFFICIAL TEMPLATE)
  // File Name format: 'plsms-5 <downloading date>'
  // ==========================================
  app.post('/api/reports/generate-excel', requireAuth, async (req: Request, res: Response) => {
    try {
      const { reportType, status, office, format = 'xlsx' } = req.body || {};
      const all = getAllRecords();

      let filtered = [...all];

      // Filter by office if provided
      if (office && office !== 'ALL') {
        filtered = filtered.filter((r) => (r.office || '').trim().toLowerCase() === office.trim().toLowerCase());
      }

      let reportTitle = 'TOTAL SMART CARDS REPORT';
      let isUploadHistory = false;

      // Filter based on selected report archetype
      if (reportType === 'NOT_DISTRIBUTED') {
        reportTitle = 'NOT DISTRIBUTED CARDS REPORT';
        filtered = filtered.filter((r) => !isRecordDistributed(r));
      } else if (reportType === 'DISTRIBUTED' || reportType === 'DISTRIBUTION_AUDIT') {
        reportTitle = 'DISTRIBUTED CARDS REPORT';
        filtered = filtered.filter((r) => isRecordDistributed(r));
      } else if (reportType === 'MISSING' || reportType === 'MISSING_RECORDS') {
        reportTitle = 'MISSING CARDS REPORT';
        filtered = filtered.filter((r) => isRecordMissing(r));
      } else if (reportType === 'FOUND') {
        reportTitle = 'FOUND CARDS REPORT';
        filtered = filtered.filter((r) => isRecordFound(r));
      } else if (reportType === 'HANDED_OVER') {
        reportTitle = 'HANDED OVER CARDS REPORT';
        filtered = filtered.filter(
          (r) =>
            isRecordDistributed(r) ||
            r.status === 'DISTRIBUTED' ||
            r.foundHandoverDone === true ||
            r.rawRecord?.['FOUND_HANDOVER'] === 'DONE' ||
            Boolean(r.distributedDate)
        );
      } else if (reportType === 'REQUEST_TO_RECEIVE') {
        reportTitle = 'REQUEST TO RECEIVE REPORT';
        filtered = filtered.filter((r) => r.status === 'PENDING');
      } else if (reportType === 'UPLOAD_HISTORY') {
        reportTitle = 'UPLOAD HISTORY REPORT';
        isUploadHistory = true;
      } else {
        reportTitle = 'TOTAL SMART CARDS REPORT';
      }

      // Filter by explicit status if provided (and not overriding standard archetype)
      if (status && status !== 'ALL' && !['NOT_DISTRIBUTED', 'DISTRIBUTED', 'MISSING', 'FOUND', 'HANDED_OVER', 'REQUEST_TO_RECEIVE', 'UPLOAD_HISTORY'].includes(reportType)) {
        filtered = filtered.filter((r) => (r.status || '').toUpperCase() === status.toUpperCase());
      }

      const nepaliDateStr = getBikramSambatDate(new Date()).formattedBS; // e.g. "2083-05-14"
      const cleanFileName = `PLSMS5--${nepaliDateStr}.${format === 'csv' ? 'csv' : 'xlsx'}`;

      const userPayload = (req as any).user || {};
      logAudit(
        userPayload.id || 'SUPER_ADMIN',
        userPayload.name || userPayload.email || 'Super Administrator',
        'EXCEL_REPORT_GENERATED',
        'REPORT',
        `Generated ${format.toUpperCase()} report (${reportTitle}) containing ${filtered.length} records. Downloaded file: ${cleanFileName}`,
        req.ip
      );

      // --- CSV EXPORT ---
      if (format === 'csv') {
        let csvLines: string[] = [];
        csvLines.push('"TRANSPORT MANAGEMENT OFFICE, DRIVING LICENSE"');
        csvLines.push('"ITAHARI, SUNSARI, NEPAL"');
        csvLines.push(`"OFFICIAL REPORT: ${reportTitle} | Generated: ${nepaliDateStr}"`);
        csvLines.push('');

        if (isUploadHistory) {
          const jobs = getImportJobs();
          csvLines.push('"S.N.","LOT CODE","FILE NAME","NEPALI DATE","UPLOADED DATE","UPLOADED BY","TOTAL ROWS","NEW RECORDS","UPDATED RECORDS","STATUS"');
          csvLines.push(`"TOTAL RECORDS: ${jobs.length}"`);
          jobs.forEach((j, idx) => {
            const row = [
              idx + 1,
              j.lotCode || `LOT-${idx + 1}`,
              j.filename || '',
              j.nepaliDate || 'N/A',
              j.uploadedAt ? new Date(j.uploadedAt).toLocaleDateString() : 'N/A',
              j.uploadedBy || 'Super Admin',
              j.totalRows || 0,
              j.newRecords || 0,
              j.updatedRecords || 0,
              j.status || 'COMPLETED',
            ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
            csvLines.push(row.join(','));
          });
        } else {
          csvLines.push(`"TOTAL RECORDS: ${filtered.length}","","","OFFICIAL REPORT: ${reportTitle} | Generated: ${nepaliDateStr}"`);
          csvLines.push('"S.N.","APPLICANT ID","FULL NAME","LICENSE NUMBER","CATEGORY","OLD CODE","NEW CODE","DEPARTMENT","RECEIVED BY","DISTRIBUTED DATE","DISTRIBUTED BY","SUBMITTED DOC.","STATUS","",""');
          csvLines.push('"","","","","","","","","","","","","DISTRIBUTED","MISSING","FOUND"');
          filtered.forEach((r, idx) => {
            const isMissing = isRecordMissing(r);
            const isFound = !isMissing && isRecordFound(r);
            const isDist = !isMissing && !isFound && isRecordDistributed(r);

            let distributedDateStr = '';
            if (isDist || isFound) {
              if (isFound && r.foundDate) {
                distributedDateStr = r.foundDate;
              } else if (r.distributedDate) {
                distributedDateStr = r.distributedDate;
              } else if (r.distributedAt) {
                try {
                  const dt = new Date(r.distributedAt);
                  distributedDateStr = getBikramSambatDate(dt).formattedBS;
                } catch (_) {
                  distributedDateStr = '<N/A>';
                }
              } else {
                distributedDateStr = '<N/A>';
              }
            }

            const raw = r.rawRecord || {};
            const oldCode = raw['OLD CODE'] || raw['OLD_CODE'] || (r as any).oldCode || '';
            const newCode = raw['NEW CODE'] || raw['NEW_CODE'] || (r as any).newCode || '';
            
            let rawSubmittedDoc = r.submittedDocument || r.receiverNid || r.nidOrPassport || raw['SUBMITTED DOC.'] || raw['SUBMITTED DOC'] || raw['SUBMITTED_DOC'];
            if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && r.foundReason?.includes('submitted document:')) {
              const match = r.foundReason.match(/submitted document:\s*([^.]+)/i);
              if (match && match[1]?.trim()) rawSubmittedDoc = match[1].trim();
            }
            if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && r.receiverNid && r.receiverNid !== '---' && r.receiverNid !== 'SELF_VERIFIED') {
              rawSubmittedDoc = 'Citizenship';
            }
            if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && (r.missingReportedAt || r.foundDate)) {
              rawSubmittedDoc = 'Citizenship';
            }
            const submittedDoc = (isDist || isFound) ? (rawSubmittedDoc && rawSubmittedDoc.trim() ? rawSubmittedDoc.trim() : 'Original Smart Card') : '';

            let rawReceivedBy = r.receivedBy || r.receiverName || raw['DISTRIBUTED TO'] || raw['RECEIVED BY'] || raw['DISTRIBUTED_TO'] || raw['RECEIVED_BY'] || raw['बुझिलिनेको नाम'];
            if ((!rawReceivedBy || rawReceivedBy === '---' || rawReceivedBy === '<N/A>') && r.foundReason?.includes('Received by:')) {
              const match = r.foundReason.match(/Received by:\s*([^.]+)/i);
              if (match && match[1]?.trim()) rawReceivedBy = match[1].trim();
            }
            if ((!rawReceivedBy || rawReceivedBy === '---' || rawReceivedBy === '<N/A>') && (isDist || isFound)) {
              rawReceivedBy = r.holderName || '<N/A>';
            }
            const receivedBy = (isDist || isFound) ? (rawReceivedBy && rawReceivedBy.trim() ? rawReceivedBy.trim() : '<N/A>') : '';

            const isKnownDistributor =
              (isDist || isFound) &&
              r.distributedBy &&
              r.distributedBy.trim() &&
              !['SUPER_ADMIN', 'SUPERADMIN', 'SUPER ADMINISTRATOR'].includes(r.distributedBy.trim().toUpperCase()) &&
              r.distributedBy.trim() !== '<N/A>' &&
              r.distributedBy.trim() !== 'N/A';
            const distributedBy = (isDist || isFound) ? (isKnownDistributor ? r.distributedBy.trim() : (isFound ? (r.foundReportedBy || 'KOMAL DAHAL') : '<N/A>')) : '';

            let colDist = '';
            let colMissing = '';
            let colFound = '';
            if (isMissing) {
              colMissing = 'MISSING';
            } else if (isFound) {
              colFound = 'FOUND';
            } else if (isDist) {
              colDist = 'DISTRIBUTED';
            }

            const row = [
              idx + 1,
              r.applicantId || r.applicationNumber || '',
              r.holderName || '',
              r.licenseNumber || '',
              r.category || r.vehicleClass || r.licenseType || '',
              oldCode,
              newCode,
              r.office || r.department || 'कार्ड वितरण शाखा - \'क\'',
              receivedBy,
              distributedDateStr,
              distributedBy,
              submittedDoc,
              colDist,
              colMissing,
              colFound,
            ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
            csvLines.push(row.join(','));
          });
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${cleanFileName}"`);
        return res.send(csvLines.join('\r\n'));
      }

      // --- EXCELJS WORKBOOK CREATION (PRECISE PIXEL & COLOR REPLICATION) ---
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Transport Management Office';
      workbook.created = new Date();

      const sheetName = (reportTitle || 'Report').substring(0, 31);
      const worksheet = workbook.addWorksheet(sheetName, {
        views: [{ showGridLines: true }],
      });

      const totalCols = isUploadHistory ? 10 : 15;
      const lastColLetter = isUploadHistory ? 'J' : 'O';

      // Set explicit column widths
      if (isUploadHistory) {
        worksheet.columns = [
          { width: 8 },  // A: S.N.
          { width: 18 }, // B: LOT CODE
          { width: 28 }, // C: FILE NAME
          { width: 16 }, // D: NEPALI DATE
          { width: 18 }, // E: UPLOADED DATE
          { width: 20 }, // F: UPLOADED BY
          { width: 14 }, // G: TOTAL ROWS
          { width: 14 }, // H: NEW RECORDS
          { width: 16 }, // I: UPDATED RECORDS
          { width: 16 }, // J: STATUS
        ];
      } else {
        worksheet.columns = [
          { width: 8 },  // A: S.N.
          { width: 18 }, // B: APPLICANT ID
          { width: 28 }, // C: FULL NAME
          { width: 22 }, // D: LICENSE NUMBER
          { width: 14 }, // E: CATEGORY
          { width: 14 }, // F: OLD CODE
          { width: 14 }, // G: NEW CODE
          { width: 28 }, // H: DEPARTMENT
          { width: 20 }, // I: RECEIVED BY
          { width: 18 }, // J: DISTRIBUTED DATE
          { width: 18 }, // K: DISTRIBUTED BY
          { width: 20 }, // L: SUBMITTED DOC.
          { width: 16 }, // M: DISTRIBUTED
          { width: 14 }, // N: MISSING
          { width: 14 }, // O: FOUND
        ];
      }

      // --- ROW 1: MAIN RED BANNER ---
      worksheet.mergeCells(`A1:${lastColLetter}1`);
      const row1Cell = worksheet.getCell('A1');
      row1Cell.value = 'TRANSPORT MANAGEMENT OFFICE, DRIVING LICENSE';
      row1Cell.font = {
        name: 'Arial',
        size: 13,
        bold: true,
        color: { argb: 'FFFF0000' }, // Vivid Red as seen in template image
      };
      row1Cell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(1).height = 24;

      // --- ROW 2: LOCATION RED BANNER ---
      worksheet.mergeCells(`A2:${lastColLetter}2`);
      const row2Cell = worksheet.getCell('A2');
      row2Cell.value = 'ITAHARI, SUNSARI, NEPAL';
      row2Cell.font = {
        name: 'Arial',
        size: 10,
        bold: true,
        color: { argb: 'FFFF0000' }, // Vivid Red
      };
      row2Cell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(2).height = 20;

      // --- ROW 3: TOTAL RECORDS COUNT (LEFT) & REPORT SUBTITLE (CENTER) ---
      const thinGrayBorder: any = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };

      const headerBorder: any = {
        top: { style: 'thin', color: { argb: 'FFFF7F7F' } },
        left: { style: 'thin', color: { argb: 'FFFF7F7F' } },
        bottom: { style: 'thin', color: { argb: 'FFFF7F7F' } },
        right: { style: 'thin', color: { argb: 'FFFF7F7F' } },
      };

      const headerFont: any = {
        name: 'Arial',
        size: 9.5,
        bold: true,
        color: { argb: 'FFFF0000' }, // Vivid Red header font
      };

      const headerFill: any = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFECEF' }, // Exact soft peach-pink tint from template
      };

      if (isUploadHistory) {
        const jobs = getImportJobs();
        worksheet.mergeCells('A3:C3');
        const r3Left = worksheet.getCell('A3');
        r3Left.value = `TOTAL RECORDS: ${jobs.length}`;
        r3Left.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF000000' } };
        r3Left.alignment = { vertical: 'middle', horizontal: 'left' };
        r3Left.border = thinGrayBorder;

        worksheet.mergeCells(`D3:${lastColLetter}3`);
        const r3Right = worksheet.getCell('D3');
        r3Right.value = `OFFICIAL REPORT: ${reportTitle} | Generated: ${nepaliDateStr}`;
        r3Right.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0B2447' } };
        r3Right.alignment = { vertical: 'middle', horizontal: 'center' };
        r3Right.border = thinGrayBorder;
        worksheet.getRow(3).height = 22;

        // Headers for Upload History
        const headers = ['S.N.', 'LOT CODE', 'FILE NAME', 'NEPALI DATE', 'UPLOADED DATE', 'UPLOADED BY', 'TOTAL ROWS', 'NEW RECORDS', 'UPDATED RECORDS', 'STATUS'];
        const row4 = worksheet.getRow(4);
        row4.height = 22;
        headers.forEach((h, idx) => {
          const cell = row4.getCell(idx + 1);
          cell.value = h;
          cell.font = headerFont;
          cell.fill = headerFill;
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.border = headerBorder;
        });

        jobs.forEach((j, idx) => {
          const rowNum = 5 + idx;
          const row = worksheet.getRow(rowNum);
          row.height = 20;
          const values = [
            idx + 1,
            j.lotCode || `LOT-${idx + 1}`,
            j.filename || '',
            j.nepaliDate || 'N/A',
            j.uploadedAt ? new Date(j.uploadedAt).toLocaleDateString() : 'N/A',
            j.uploadedBy || 'Super Admin',
            j.totalRows || 0,
            j.newRecords || 0,
            j.updatedRecords || 0,
            j.status || 'COMPLETED',
          ];
          values.forEach((val, cIdx) => {
            const cell = row.getCell(cIdx + 1);
            cell.value = val;
            cell.font = { name: 'Arial', size: 9.5 };
            cell.border = thinGrayBorder;
            cell.alignment = {
              vertical: 'middle',
              horizontal: cIdx === 2 || cIdx === 5 ? 'left' : 'center',
            };
          });
        });
      } else {
        // Standard License Records Template
        worksheet.mergeCells('A3:C3');
        const r3Left = worksheet.getCell('A3');
        r3Left.value = `TOTAL RECORDS: ${filtered.length}`;
        r3Left.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF000000' } };
        r3Left.alignment = { vertical: 'middle', horizontal: 'left' };
        r3Left.border = thinGrayBorder;

        worksheet.mergeCells('D3:O3');
        const r3Right = worksheet.getCell('D3');
        r3Right.value = `OFFICIAL REPORT: ${reportTitle} | Generated: ${nepaliDateStr}`;
        r3Right.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0B2447' } };
        r3Right.alignment = { vertical: 'middle', horizontal: 'center' };
        r3Right.border = thinGrayBorder;
        worksheet.getRow(3).height = 22;

        // --- ROW 4 & 5: TWO-TIER TABLE HEADERS ---
        // Columns A to L merged vertically (rows 4 to 5)
        const topCols = [
          { col: 'A', title: 'S.N.' },
          { col: 'B', title: 'APPLICANT ID' },
          { col: 'C', title: 'FULL NAME' },
          { col: 'D', title: 'LICENSE NUMBER' },
          { col: 'E', title: 'CATEGORY' },
          { col: 'F', title: 'OLD CODE' },
          { col: 'G', title: 'NEW CODE' },
          { col: 'H', title: 'DEPARTMENT' },
          { col: 'I', title: 'RECEIVED BY' },
          { col: 'J', title: 'DISTRIBUTED DATE' },
          { col: 'K', title: 'DISTRIBUTED BY' },
          { col: 'L', title: 'SUBMITTED DOC.' },
        ];

        topCols.forEach((c) => {
          worksheet.mergeCells(`${c.col}4:${c.col}5`);
          const cell = worksheet.getCell(`${c.col}4`);
          cell.value = c.title;
        });

        // Columns M to O: Row 4 merged as "STATUS"
        worksheet.mergeCells('M4:O4');
        const statusCell = worksheet.getCell('M4');
        statusCell.value = 'STATUS';

        // Row 5 subheaders under STATUS
        worksheet.getCell('M5').value = 'DISTRIBUTED';
        worksheet.getCell('N5').value = 'MISSING';
        worksheet.getCell('O5').value = 'FOUND';

        worksheet.getRow(4).height = 22;
        worksheet.getRow(5).height = 20;

        // Apply red styling and soft pink background to all header cells (A4:O5)
        for (let rNum = 4; rNum <= 5; rNum++) {
          const row = worksheet.getRow(rNum);
          for (let cNum = 1; cNum <= 15; cNum++) {
            const cell = row.getCell(cNum);
            cell.font = headerFont;
            cell.fill = headerFill;
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
            cell.border = headerBorder;
          }
        }

        // --- ROWS 6+: DATA ROWS ---
        filtered.forEach((r, idx) => {
          const rowNum = 6 + idx;
          const row = worksheet.getRow(rowNum);
          row.height = 20;

          const isMissing = isRecordMissing(r);
          const isFound = !isMissing && isRecordFound(r);
          const isDist = !isMissing && !isFound && isRecordDistributed(r);

          let distributedDateStr = '';
          if (isDist || isFound) {
            if (isFound && r.foundDate) {
              distributedDateStr = r.foundDate;
            } else if (r.distributedDate) {
              distributedDateStr = r.distributedDate;
            } else if (r.distributedAt) {
              try {
                const dt = new Date(r.distributedAt);
                distributedDateStr = getBikramSambatDate(dt).formattedBS;
              } catch (_) {
                distributedDateStr = '<N/A>';
              }
            } else {
              distributedDateStr = '<N/A>';
            }
          }

          const raw = r.rawRecord || {};
          const oldCode = raw['OLD CODE'] || raw['OLD_CODE'] || (r as any).oldCode || '';
          const newCode = raw['NEW CODE'] || raw['NEW_CODE'] || (r as any).newCode || '';
          
          let rawSubmittedDoc = r.submittedDocument || r.receiverNid || r.nidOrPassport || raw['SUBMITTED DOC.'] || raw['SUBMITTED DOC'] || raw['SUBMITTED_DOC'];
          if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && r.foundReason?.includes('submitted document:')) {
            const match = r.foundReason.match(/submitted document:\s*([^.]+)/i);
            if (match && match[1]?.trim()) rawSubmittedDoc = match[1].trim();
          }
          if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && r.receiverNid && r.receiverNid !== '---' && r.receiverNid !== 'SELF_VERIFIED') {
            rawSubmittedDoc = 'Citizenship';
          }
          if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && (r.missingReportedAt || r.foundDate)) {
            rawSubmittedDoc = 'Citizenship';
          }
          const submittedDoc = (isDist || isFound) ? (rawSubmittedDoc && rawSubmittedDoc.trim() ? rawSubmittedDoc.trim() : 'Original Smart Card') : '';

          let rawReceivedBy = r.receivedBy || r.receiverName || raw['DISTRIBUTED TO'] || raw['RECEIVED BY'] || raw['DISTRIBUTED_TO'] || raw['RECEIVED_BY'] || raw['बुझिलिनेको नाम'];
          if ((!rawReceivedBy || rawReceivedBy === '---' || rawReceivedBy === '<N/A>') && r.foundReason?.includes('Received by:')) {
            const match = r.foundReason.match(/Received by:\s*([^.]+)/i);
            if (match && match[1]?.trim()) rawReceivedBy = match[1].trim();
          }
          if ((!rawReceivedBy || rawReceivedBy === '---' || rawReceivedBy === '<N/A>') && (isDist || isFound)) {
            rawReceivedBy = r.holderName || '<N/A>';
          }
          const receivedBy = (isDist || isFound) ? (rawReceivedBy && rawReceivedBy.trim() ? rawReceivedBy.trim() : '<N/A>') : '';

          const isKnownDistributor =
            (isDist || isFound) &&
            r.distributedBy &&
            r.distributedBy.trim() &&
            !['SUPER_ADMIN', 'SUPERADMIN', 'SUPER ADMINISTRATOR'].includes(r.distributedBy.trim().toUpperCase()) &&
            r.distributedBy.trim() !== '<N/A>' &&
            r.distributedBy.trim() !== 'N/A';
          const distributedBy = (isDist || isFound) ? (isKnownDistributor ? r.distributedBy.trim() : (isFound ? (r.foundReportedBy || 'KOMAL DAHAL') : '<N/A>')) : '';

          let colDist = '';
          let colMissing = '';
          let colFound = '';
          if (isMissing) {
            colMissing = 'MISSING';
          } else if (isFound) {
            colFound = 'FOUND';
          } else if (isDist) {
            colDist = 'DISTRIBUTED';
          }

          const values = [
            idx + 1,
            r.applicantId || r.applicationNumber || '',
            r.holderName || '',
            r.licenseNumber || '',
            r.category || r.vehicleClass || r.licenseType || '',
            oldCode,
            newCode,
            r.office || r.department || 'कार्ड वितरण शाखा - \'क\'',
            receivedBy,
            distributedDateStr,
            distributedBy,
            submittedDoc,
            colDist,
            colMissing,
            colFound,
          ];

          values.forEach((val, cIdx) => {
            const colNum = cIdx + 1;
            const cell = row.getCell(colNum);
            cell.value = val;
            cell.border = thinGrayBorder;
            cell.alignment = {
              vertical: 'middle',
              horizontal: colNum === 3 || colNum === 8 || colNum === 9 || colNum === 12 ? 'left' : 'center',
            };

            if (colNum === 13 && colDist) {
              cell.font = {
                name: 'Arial',
                size: 9.5,
                bold: true,
                color: { argb: 'FF008000' }, // Green bold
              };
            } else if (colNum === 14 && colMissing) {
              cell.font = {
                name: 'Arial',
                size: 9.5,
                bold: true,
                color: { argb: 'FFFF0000' }, // Red bold
              };
            } else if (colNum === 15 && colFound) {
              cell.font = {
                name: 'Arial',
                size: 9.5,
                bold: true,
                color: { argb: 'FF008000' }, // Green bold
              };
            } else {
              cell.font = { name: 'Arial', size: 9.5 };
            }
          });
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const outBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanFileName}"`);
      res.setHeader('Content-Length', outBuffer.length.toString());
      return res.end(outBuffer);
    } catch (err: any) {
      console.error('Error generating report:', err);
      return res.status(500).json({
        error: `Failed to compile report: ${err.message || 'Internal error'}`,
      });
    }
  });

  // ==========================================
  // MULTI-SHEET INTEGRATED AGGREGATE REPORT GENERATOR
  // Compiles all selected report sections into dedicated sheets inside a single .xlsx workbook
  // ==========================================
  app.post('/api/reports/generate-integrated', requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        sections = ['TOTAL_SMART_CARDS', 'DISTRIBUTED', 'NOT_DISTRIBUTED', 'MISSING', 'FOUND', 'REQUEST_TO_RECEIVE'],
        office = 'ALL',
        fromDate,
        toDate,
        format = 'xlsx',
      } = req.body || {};

      const all = getAllRecords();
      let pool = [...all];

      if (office && office !== 'ALL') {
        pool = pool.filter((r) => (r.office || '').trim().toLowerCase() === office.trim().toLowerCase());
      }

      // Date filter helper
      const fromClean = fromDate ? fromDate.trim() : '';
      const toClean = toDate ? toDate.trim() : '';

      const filterByDate = (records: any[]) => {
        if (!fromClean && !toClean) return records;
        return records.filter((r) => {
          let recDate = r.distributedDate || r.missingDate || r.foundDate || '';
          if (!recDate && (r.distributedAt || r.importedAt || r.createdAt)) {
            try {
              recDate = getBikramSambatDate(new Date(r.distributedAt || r.importedAt || r.createdAt)).formattedBS;
            } catch (_) {
              recDate = '';
            }
          }
          if (!recDate && r.rawRecord) {
            recDate = r.rawRecord['ENTRY_DATE'] || r.rawRecord['DATE'] || r.rawRecord['DISTRIBUTED DATE'] || '';
          }
          if (!recDate) return true; // If no date, include by default
          if (fromClean && recDate < fromClean) return false;
          if (toClean && recDate > toClean) return false;
          return true;
        });
      };

      const nepaliDateStr = getBikramSambatDate(new Date()).formattedBS;
      const cleanFileName = `PLSMS5-INTEGRATED--${nepaliDateStr}.${format === 'csv' ? 'csv' : 'xlsx'}`;

      // Section metadata definition
      const sectionDefs: { id: string; sheetName: string; title: string; getRecords: () => any[]; isUploadHistory?: boolean }[] = [
        {
          id: 'TOTAL_SMART_CARDS',
          sheetName: 'Total Smart Cards',
          title: 'TOTAL SMART CARDS REPORT',
          getRecords: () => filterByDate(pool),
        },
        {
          id: 'DISTRIBUTED',
          sheetName: 'Distributed Cards',
          title: 'DISTRIBUTED CARDS REPORT',
          getRecords: () => filterByDate(pool.filter((r) => r.status === 'DISTRIBUTED' || r.isDistributed || r.status === 'MISSING' || r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.distributedAt) || (r.receivedBy && r.receivedBy.trim().length > 0 && r.receivedBy !== '-' && r.receivedBy !== '---' && r.receivedBy !== '<N/A>'))),
        },
        {
          id: 'NOT_DISTRIBUTED',
          sheetName: 'Not-Distributed Cards',
          title: 'NOT DISTRIBUTED CARDS REPORT',
          getRecords: () => filterByDate(pool.filter((r) => !(r.status === 'DISTRIBUTED' || r.isDistributed || r.status === 'MISSING' || r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.distributedAt) || (r.receivedBy && r.receivedBy.trim().length > 0 && r.receivedBy !== '-' && r.receivedBy !== '---' && r.receivedBy !== '<N/A>')))),
        },
        {
          id: 'MISSING',
          sheetName: 'Missing Cards',
          title: 'MISSING CARDS REPORT',
          getRecords: () => filterByDate(pool.filter((r) => r.status === 'MISSING')),
        },
        {
          id: 'FOUND',
          sheetName: 'Found Cards',
          title: 'FOUND CARDS REPORT',
          getRecords: () => filterByDate(pool.filter((r) => r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.foundDate))),
        },
        {
          id: 'REQUEST_TO_RECEIVE',
          sheetName: 'Request to Receive',
          title: 'REQUEST TO RECEIVE REPORT',
          getRecords: () => filterByDate(pool.filter((r) => r.status === 'PENDING')),
        },
        {
          id: 'UPLOAD_HISTORY',
          sheetName: 'Upload History',
          title: 'UPLOAD HISTORY REPORT',
          getRecords: () => getImportJobs(),
          isUploadHistory: true,
        },
      ];

      const activeSections = sectionDefs.filter((s) => sections.includes(s.id));
      if (activeSections.length === 0) {
        return res.status(400).json({ error: 'Please select at least one report section to compile.' });
      }

      // --- CSV AGGREGATE EXPORT ---
      if (format === 'csv') {
        let csvLines: string[] = [];
        csvLines.push('"TRANSPORT MANAGEMENT OFFICE, DRIVING LICENSE"');
        csvLines.push('"ITAHARI, SUNSARI, NEPAL"');
        csvLines.push(`"INTEGRATED AGGREGATE REPORT | Generated: ${nepaliDateStr}"`);
        if (fromClean || toClean) {
          csvLines.push(`"DATE RANGE: ${fromClean || 'Beginning'} to ${toClean || 'Present'}"`);
        }
        csvLines.push('');

        for (const sec of activeSections) {
          const records = sec.getRecords();
          csvLines.push(`"================================================================"`);
          csvLines.push(`"SECTION: ${sec.title} (${records.length} Records)"`);
          csvLines.push(`"================================================================"`);

          if (sec.isUploadHistory) {
            csvLines.push('"S.N.","LOT CODE","FILE NAME","NEPALI DATE","UPLOADED DATE","UPLOADED BY","TOTAL ROWS","NEW RECORDS","UPDATED RECORDS","STATUS"');
            records.forEach((j: any, idx: number) => {
              const row = [
                idx + 1,
                j.lotCode || `LOT-${idx + 1}`,
                j.filename || '',
                j.nepaliDate || 'N/A',
                j.uploadedAt ? new Date(j.uploadedAt).toLocaleDateString() : 'N/A',
                j.uploadedBy || 'Super Admin',
                j.totalRows || 0,
                j.newRecords || 0,
                j.updatedRecords || 0,
                j.status || 'COMPLETED',
              ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
              csvLines.push(row.join(','));
            });
          } else {
            csvLines.push(`"TOTAL RECORDS: ${records.length}","","","OFFICIAL REPORT: ${sec.title} | Generated: ${nepaliDateStr}"`);
            csvLines.push('"S.N.","APPLICANT ID","FULL NAME","LICENSE NUMBER","CATEGORY","OLD CODE","NEW CODE","DEPARTMENT","RECEIVED BY","DISTRIBUTED DATE","DISTRIBUTED BY","SUBMITTED DOC.","STATUS","",""');
            csvLines.push('"","","","","","","","","","","","","DISTRIBUTED","MISSING","FOUND"');
            records.forEach((r: any, idx: number) => {
              const isMissing = r.status === 'MISSING';
              const isFound = r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.foundDate);
              const isDist = r.status === 'DISTRIBUTED' || r.isDistributed || Boolean(r.distributedAt) || Boolean(r.receivedBy && r.receivedBy !== '-' && r.receivedBy !== '---' && r.receivedBy !== '<N/A>');

              let distributedDateStr = '';
              if (isDist) {
                if (r.distributedDate) {
                  distributedDateStr = r.distributedDate;
                } else if (r.distributedAt) {
                  try {
                    distributedDateStr = getBikramSambatDate(new Date(r.distributedAt)).formattedBS;
                  } catch (_) {
                    distributedDateStr = '<N/A>';
                  }
                } else if (r.foundDate) {
                  distributedDateStr = r.foundDate;
                } else {
                  distributedDateStr = '<N/A>';
                }
              }
              const raw = r.rawRecord || {};
              const oldCode = raw['OLD CODE'] || raw['OLD_CODE'] || (r as any).oldCode || '';
              const newCode = raw['NEW CODE'] || raw['NEW_CODE'] || (r as any).newCode || '';
              
              let rawSubmittedDoc = r.submittedDocument || r.receiverNid || r.nidOrPassport || raw['SUBMITTED DOC.'] || raw['SUBMITTED DOC'] || raw['SUBMITTED_DOC'];
              if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && r.foundReason?.includes('submitted document:')) {
                const match = r.foundReason.match(/submitted document:\s*([^.]+)/i);
                if (match && match[1]?.trim()) rawSubmittedDoc = match[1].trim();
              }
              if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && r.receiverNid && r.receiverNid !== '---' && r.receiverNid !== 'SELF_VERIFIED') {
                rawSubmittedDoc = 'Citizenship';
              }
              if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && (r.missingReportedAt || r.foundDate)) {
                rawSubmittedDoc = 'Citizenship';
              }
              const submittedDoc = isDist ? (rawSubmittedDoc && rawSubmittedDoc.trim() ? rawSubmittedDoc.trim() : '<N/A>') : '';

              let rawReceivedBy = r.receivedBy || r.receiverName || raw['DISTRIBUTED TO'] || raw['RECEIVED BY'] || raw['DISTRIBUTED_TO'] || raw['RECEIVED_BY'] || raw['बुझिलिनेको नाम'];
              if ((!rawReceivedBy || rawReceivedBy === '---' || rawReceivedBy === '<N/A>') && r.foundReason?.includes('Received by:')) {
                const match = r.foundReason.match(/Received by:\s*([^.]+)/i);
                if (match && match[1]?.trim()) rawReceivedBy = match[1].trim();
              }
              if ((!rawReceivedBy || rawReceivedBy === '---' || rawReceivedBy === '<N/A>') && (isDist || r.missingReportedAt || r.foundDate)) {
                rawReceivedBy = r.holderName || '<N/A>';
              }
              const receivedBy = isDist ? (rawReceivedBy && rawReceivedBy.trim() ? rawReceivedBy.trim() : '<N/A>') : '';

              const isKnownDistributor =
                isDist &&
                r.distributedBy &&
                r.distributedBy.trim() &&
                !['SUPER_ADMIN', 'SUPERADMIN', 'SUPER ADMINISTRATOR'].includes(r.distributedBy.trim().toUpperCase()) &&
                r.distributedBy.trim() !== '<N/A>' &&
                r.distributedBy.trim() !== 'N/A';
              const distributedBy = isDist ? (isKnownDistributor ? r.distributedBy.trim() : '<N/A>') : '';

              let colDist = '';
              let colMissing = '';
              let colFound = '';
              if (isMissing) {
                colMissing = 'MISSING';
              } else if (isFound && r.status === 'FOUND') {
                colFound = 'FOUND';
              } else if (isDist) {
                colDist = 'DISTRIBUTED';
              }

              const row = [
                idx + 1,
                r.applicantId || r.applicationNumber || '',
                r.holderName || '',
                r.licenseNumber || '',
                r.category || r.vehicleClass || r.licenseType || '',
                oldCode,
                newCode,
                r.office || r.department || 'कार्ड वितरण शाखा - \'क\'',
                receivedBy,
                distributedDateStr,
                distributedBy,
                submittedDoc,
                colDist,
                colMissing,
                colFound,
              ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
              csvLines.push(row.join(','));
            });
          }
          csvLines.push('');
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${cleanFileName}"`);
        return res.send(csvLines.join('\r\n'));
      }

      // --- EXCELJS WORKBOOK (MULTI-SHEET TABS) ---
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Transport Management Office';
      workbook.created = new Date();

      const thinGrayBorder: any = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };

      const headerBorder: any = {
        top: { style: 'thin', color: { argb: 'FFFF7F7F' } },
        left: { style: 'thin', color: { argb: 'FFFF7F7F' } },
        bottom: { style: 'thin', color: { argb: 'FFFF7F7F' } },
        right: { style: 'thin', color: { argb: 'FFFF7F7F' } },
      };

      const headerFont: any = {
        name: 'Arial',
        size: 9.5,
        bold: true,
        color: { argb: 'FFFF0000' },
      };

      const headerFill: any = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFECEF' },
      };

      for (const sec of activeSections) {
        const records = sec.getRecords();
        const isUploadHistory = Boolean(sec.isUploadHistory);
        const lastColLetter = isUploadHistory ? 'J' : 'O';
        const safeSheetName = sec.sheetName.replace(/[:\\/?*\[\]]/g, '').substring(0, 31);

        const worksheet = workbook.addWorksheet(safeSheetName, {
          views: [{ showGridLines: true }],
        });

        if (isUploadHistory) {
          worksheet.columns = [
            { width: 8 },  // A: S.N.
            { width: 18 }, // B: LOT CODE
            { width: 28 }, // C: FILE NAME
            { width: 16 }, // D: NEPALI DATE
            { width: 18 }, // E: UPLOADED DATE
            { width: 20 }, // F: UPLOADED BY
            { width: 14 }, // G: TOTAL ROWS
            { width: 14 }, // H: NEW RECORDS
            { width: 16 }, // I: UPDATED RECORDS
            { width: 16 }, // J: STATUS
          ];
        } else {
          worksheet.columns = [
            { width: 8 },  // A: S.N.
            { width: 18 }, // B: APPLICANT ID
            { width: 28 }, // C: FULL NAME
            { width: 22 }, // D: LICENSE NUMBER
            { width: 14 }, // E: CATEGORY
            { width: 14 }, // F: OLD CODE
            { width: 14 }, // G: NEW CODE
            { width: 28 }, // H: DEPARTMENT
            { width: 20 }, // I: RECEIVED BY
            { width: 18 }, // J: DISTRIBUTED DATE
            { width: 18 }, // K: DISTRIBUTED BY
            { width: 20 }, // L: SUBMITTED DOC.
            { width: 16 }, // M: DISTRIBUTED
            { width: 14 }, // N: MISSING
            { width: 14 }, // O: FOUND
          ];
        }

        // ROW 1: MAIN RED BANNER
        worksheet.mergeCells(`A1:${lastColLetter}1`);
        const row1Cell = worksheet.getCell('A1');
        row1Cell.value = 'TRANSPORT MANAGEMENT OFFICE, DRIVING LICENSE';
        row1Cell.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFF0000' } };
        row1Cell.alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(1).height = 24;

        // ROW 2: LOCATION RED BANNER
        worksheet.mergeCells(`A2:${lastColLetter}2`);
        const row2Cell = worksheet.getCell('A2');
        row2Cell.value = 'ITAHARI, SUNSARI, NEPAL';
        row2Cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFF0000' } };
        row2Cell.alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(2).height = 20;

        let subtitleText = `OFFICIAL REPORT: ${sec.title} | Generated: ${nepaliDateStr}`;
        if (fromClean || toClean) {
          subtitleText += ` | Range: ${fromClean || 'Start'} to ${toClean || 'End'}`;
        }

        if (isUploadHistory) {
          worksheet.mergeCells('A3:C3');
          const r3Left = worksheet.getCell('A3');
          r3Left.value = `TOTAL RECORDS: ${records.length}`;
          r3Left.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF000000' } };
          r3Left.alignment = { vertical: 'middle', horizontal: 'left' };
          r3Left.border = thinGrayBorder;

          worksheet.mergeCells(`D3:${lastColLetter}3`);
          const r3Right = worksheet.getCell('D3');
          r3Right.value = subtitleText;
          r3Right.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0B2447' } };
          r3Right.alignment = { vertical: 'middle', horizontal: 'center' };
          r3Right.border = thinGrayBorder;
          worksheet.getRow(3).height = 22;

          // TABLE HEADERS FOR UPLOAD HISTORY
          const headers = ['S.N.', 'LOT CODE', 'FILE NAME', 'NEPALI DATE', 'UPLOADED DATE', 'UPLOADED BY', 'TOTAL ROWS', 'NEW RECORDS', 'UPDATED RECORDS', 'STATUS'];
          const row4 = worksheet.getRow(4);
          row4.height = 22;
          headers.forEach((headerText, idx) => {
            const cell = row4.getCell(idx + 1);
            cell.value = headerText;
            cell.font = headerFont;
            cell.fill = headerFill;
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
            cell.border = headerBorder;
          });

          // DATA ROWS
          records.forEach((j: any, idx: number) => {
            const row = worksheet.getRow(5 + idx);
            row.height = 20;
            const values = [
              idx + 1,
              j.lotCode || `LOT-${idx + 1}`,
              j.filename || '',
              j.nepaliDate || 'N/A',
              j.uploadedAt ? new Date(j.uploadedAt).toLocaleDateString() : 'N/A',
              j.uploadedBy || 'Super Admin',
              j.totalRows || 0,
              j.newRecords || 0,
              j.updatedRecords || 0,
              j.status || 'COMPLETED',
            ];
            values.forEach((val, cIdx) => {
              const cell = row.getCell(cIdx + 1);
              cell.value = val;
              cell.font = { name: 'Arial', size: 9.5 };
              cell.border = thinGrayBorder;
              cell.alignment = { vertical: 'middle', horizontal: cIdx === 2 || cIdx === 5 ? 'left' : 'center' };
            });
          });
        } else {
          // Standard License Records Template for all other sheets
          worksheet.mergeCells('A3:C3');
          const r3Left = worksheet.getCell('A3');
          r3Left.value = `TOTAL RECORDS: ${records.length}`;
          r3Left.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF000000' } };
          r3Left.alignment = { vertical: 'middle', horizontal: 'left' };
          r3Left.border = thinGrayBorder;

          worksheet.mergeCells('D3:O3');
          const r3Right = worksheet.getCell('D3');
          r3Right.value = subtitleText;
          r3Right.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0B2447' } };
          r3Right.alignment = { vertical: 'middle', horizontal: 'center' };
          r3Right.border = thinGrayBorder;
          worksheet.getRow(3).height = 22;

          // ROW 4 & 5: TWO-TIER TABLE HEADERS
          const topCols = [
            { col: 'A', title: 'S.N.' },
            { col: 'B', title: 'APPLICANT ID' },
            { col: 'C', title: 'FULL NAME' },
            { col: 'D', title: 'LICENSE NUMBER' },
            { col: 'E', title: 'CATEGORY' },
            { col: 'F', title: 'OLD CODE' },
            { col: 'G', title: 'NEW CODE' },
            { col: 'H', title: 'DEPARTMENT' },
            { col: 'I', title: 'RECEIVED BY' },
            { col: 'J', title: 'DISTRIBUTED DATE' },
            { col: 'K', title: 'DISTRIBUTED BY' },
            { col: 'L', title: 'SUBMITTED DOC.' },
          ];

          topCols.forEach((c) => {
            worksheet.mergeCells(`${c.col}4:${c.col}5`);
            const cell = worksheet.getCell(`${c.col}4`);
            cell.value = c.title;
          });

          // STATUS merged horizontally across M4:O4
          worksheet.mergeCells('M4:O4');
          const statusCell = worksheet.getCell('M4');
          statusCell.value = 'STATUS';

          // Row 5 subheaders under STATUS
          worksheet.getCell('M5').value = 'DISTRIBUTED';
          worksheet.getCell('N5').value = 'MISSING';
          worksheet.getCell('O5').value = 'FOUND';

          worksheet.getRow(4).height = 22;
          worksheet.getRow(5).height = 20;

          // Apply styling to all header cells (A4:O5)
          for (let rNum = 4; rNum <= 5; rNum++) {
            const row = worksheet.getRow(rNum);
            for (let cNum = 1; cNum <= 15; cNum++) {
              const cell = row.getCell(cNum);
              cell.font = headerFont;
              cell.fill = headerFill;
              cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
              cell.border = headerBorder;
            }
          }

          // DATA ROWS
          records.forEach((r: any, idx: number) => {
            const rowNum = 6 + idx;
            const row = worksheet.getRow(rowNum);
            row.height = 20;

            const isMissing = r.status === 'MISSING';
            const isFound = r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.foundDate);
            const isDist = r.status === 'DISTRIBUTED' || r.isDistributed || Boolean(r.distributedAt) || Boolean(r.receivedBy && r.receivedBy !== '-' && r.receivedBy !== '---' && r.receivedBy !== '<N/A>');

            let distributedDateStr = '';
            if (isDist) {
              if (r.distributedDate) {
                distributedDateStr = r.distributedDate;
              } else if (r.distributedAt) {
                try {
                  distributedDateStr = getBikramSambatDate(new Date(r.distributedAt)).formattedBS;
                } catch (_) {
                  distributedDateStr = '<N/A>';
                }
              } else if (r.foundDate) {
                distributedDateStr = r.foundDate;
              } else {
                distributedDateStr = '<N/A>';
              }
            }

            const raw = r.rawRecord || {};
            const oldCode = raw['OLD CODE'] || raw['OLD_CODE'] || (r as any).oldCode || '';
            const newCode = raw['NEW CODE'] || raw['NEW_CODE'] || (r as any).newCode || '';
            
            let rawSubmittedDoc = r.submittedDocument || r.receiverNid || r.nidOrPassport || raw['SUBMITTED DOC.'] || raw['SUBMITTED DOC'] || raw['SUBMITTED_DOC'];
            if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && r.foundReason?.includes('submitted document:')) {
              const match = r.foundReason.match(/submitted document:\s*([^.]+)/i);
              if (match && match[1]?.trim()) rawSubmittedDoc = match[1].trim();
            }
            if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && r.receiverNid && r.receiverNid !== '---' && r.receiverNid !== 'SELF_VERIFIED') {
              rawSubmittedDoc = 'Citizenship';
            }
            if ((!rawSubmittedDoc || rawSubmittedDoc === '---' || rawSubmittedDoc === '<N/A>') && (r.missingReportedAt || r.foundDate)) {
              rawSubmittedDoc = 'Citizenship';
            }
            const submittedDoc = isDist ? (rawSubmittedDoc && rawSubmittedDoc.trim() ? rawSubmittedDoc.trim() : '<N/A>') : '';

            let rawReceivedBy = r.receivedBy || r.receiverName || raw['DISTRIBUTED TO'] || raw['RECEIVED BY'] || raw['DISTRIBUTED_TO'] || raw['RECEIVED_BY'] || raw['बुझिलिनेको नाम'];
            if ((!rawReceivedBy || rawReceivedBy === '---' || rawReceivedBy === '<N/A>') && r.foundReason?.includes('Received by:')) {
              const match = r.foundReason.match(/Received by:\s*([^.]+)/i);
              if (match && match[1]?.trim()) rawReceivedBy = match[1].trim();
            }
            if ((!rawReceivedBy || rawReceivedBy === '---' || rawReceivedBy === '<N/A>') && (isDist || r.missingReportedAt || r.foundDate)) {
              rawReceivedBy = r.holderName || '<N/A>';
            }
            const receivedBy = isDist ? (rawReceivedBy && rawReceivedBy.trim() ? rawReceivedBy.trim() : '<N/A>') : '';

            const isKnownDistributor =
              isDist &&
              r.distributedBy &&
              r.distributedBy.trim() &&
              !['SUPER_ADMIN', 'SUPERADMIN', 'SUPER ADMINISTRATOR'].includes(r.distributedBy.trim().toUpperCase()) &&
              r.distributedBy.trim() !== '<N/A>' &&
              r.distributedBy.trim() !== 'N/A';
            const distributedBy = isDist ? (isKnownDistributor ? r.distributedBy.trim() : '<N/A>') : '';

            let colDist = '';
            let colMissing = '';
            let colFound = '';
            if (isMissing) {
              colMissing = 'MISSING';
            } else if (isFound && r.status === 'FOUND') {
              colFound = 'FOUND';
            } else if (isDist) {
              colDist = 'DISTRIBUTED';
            }

            const values = [
              idx + 1,
              r.applicantId || r.applicationNumber || '',
              r.holderName || '',
              r.licenseNumber || '',
              r.category || r.vehicleClass || r.licenseType || '',
              oldCode,
              newCode,
              r.office || r.department || 'कार्ड वितरण शाखा - \'क\'',
              receivedBy,
              distributedDateStr,
              distributedBy,
              submittedDoc,
              colDist,
              colMissing,
              colFound,
            ];

            values.forEach((val, cIdx) => {
              const colNum = cIdx + 1;
              const cell = row.getCell(colNum);
              cell.value = val;
              cell.border = thinGrayBorder;
              cell.alignment = { vertical: 'middle', horizontal: colNum === 3 || colNum === 8 || colNum === 9 || colNum === 12 ? 'left' : 'center' };

              if (colNum === 13 && colDist) {
                cell.font = {
                  name: 'Arial',
                  size: 9.5,
                  bold: true,
                  color: { argb: 'FF008000' }, // Green bold
                };
              } else if (colNum === 14 && colMissing) {
                cell.font = {
                  name: 'Arial',
                  size: 9.5,
                  bold: true,
                  color: { argb: 'FFFF0000' }, // Red bold
                };
              } else if (colNum === 15 && colFound) {
                cell.font = {
                  name: 'Arial',
                  size: 9.5,
                  bold: true,
                  color: { argb: 'FF008000' }, // Green bold
                };
              } else {
                cell.font = { name: 'Arial', size: 9.5 };
              }
            });
          });
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const outBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

      const userPayload = (req as any).user || {};
      logAudit(
        userPayload.id || 'SUPER_ADMIN',
        userPayload.name || userPayload.email || 'Super Administrator',
        'INTEGRATED_EXCEL_REPORT_GENERATED',
        'REPORT',
        `Generated multi-sheet integrated report (${activeSections.length} sheets). Downloaded: ${cleanFileName}`,
        req.ip
      );

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanFileName}"`);
      res.setHeader('Content-Length', outBuffer.length.toString());
      return res.end(outBuffer);
    } catch (err: any) {
      console.error('Error generating integrated report:', err);
      return res.status(500).json({ error: `Failed to compile integrated report: ${err.message || 'Internal error'}` });
    }
  });

  // ==========================================
  // INTEGRATED REPORT PREVIEW (FOR PRINT / MULTI-SECTION VIEW)
  // ==========================================
  app.post('/api/reports/integrated-preview', requireAuth, (req: Request, res: Response) => {
    try {
      const {
        sections = ['TOTAL_SMART_CARDS', 'DISTRIBUTED', 'NOT_DISTRIBUTED', 'MISSING', 'FOUND', 'REQUEST_TO_RECEIVE'],
        office = 'ALL',
        fromDate,
        toDate,
      } = req.body || {};

      const all = getAllRecords();
      let pool = [...all];

      if (office && office !== 'ALL') {
        pool = pool.filter((r) => (r.office || '').trim().toLowerCase() === office.trim().toLowerCase());
      }

      const fromClean = fromDate ? fromDate.trim() : '';
      const toClean = toDate ? toDate.trim() : '';

      const filterByDate = (records: any[]) => {
        if (!fromClean && !toClean) return records;
        return records.filter((r) => {
          let recDate = r.distributedDate || r.missingDate || r.foundDate || '';
          if (!recDate && (r.distributedAt || r.importedAt || r.createdAt)) {
            try {
              recDate = getBikramSambatDate(new Date(r.distributedAt || r.importedAt || r.createdAt)).formattedBS;
            } catch (_) {
              recDate = '';
            }
          }
          if (!recDate && r.rawRecord) {
            recDate = r.rawRecord['ENTRY_DATE'] || r.rawRecord['DATE'] || r.rawRecord['DISTRIBUTED DATE'] || '';
          }
          if (!recDate) return true;
          if (fromClean && recDate < fromClean) return false;
          if (toClean && recDate > toClean) return false;
          return true;
        });
      };

      const sectionResults = [];

      if (sections.includes('TOTAL_SMART_CARDS')) {
        const records = filterByDate(pool);
        sectionResults.push({ id: 'TOTAL_SMART_CARDS', title: 'TOTAL SMART CARDS REPORT', count: records.length, records });
      }
      if (sections.includes('DISTRIBUTED')) {
        const records = filterByDate(pool.filter((r) => r.status === 'DISTRIBUTED' || r.isDistributed || r.status === 'MISSING' || r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.distributedAt) || (r.receivedBy && r.receivedBy.trim().length > 0 && r.receivedBy !== '-' && r.receivedBy !== '---' && r.receivedBy !== '<N/A>')));
        sectionResults.push({ id: 'DISTRIBUTED', title: 'DISTRIBUTED CARDS REPORT', count: records.length, records });
      }
      if (sections.includes('NOT_DISTRIBUTED')) {
        const records = filterByDate(pool.filter((r) => !(r.status === 'DISTRIBUTED' || r.isDistributed || r.status === 'MISSING' || r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.distributedAt) || (r.receivedBy && r.receivedBy.trim().length > 0 && r.receivedBy !== '-' && r.receivedBy !== '---' && r.receivedBy !== '<N/A>'))));
        sectionResults.push({ id: 'NOT_DISTRIBUTED', title: 'NOT DISTRIBUTED CARDS REPORT', count: records.length, records });
      }
      if (sections.includes('MISSING')) {
        const records = filterByDate(pool.filter((r) => r.status === 'MISSING'));
        sectionResults.push({ id: 'MISSING', title: 'MISSING CARDS REPORT', count: records.length, records });
      }
      if (sections.includes('FOUND')) {
        const records = filterByDate(pool.filter((r) => r.status === 'FOUND' || Boolean(r.foundReason) || Boolean(r.foundDate)));
        sectionResults.push({ id: 'FOUND', title: 'FOUND CARDS REPORT', count: records.length, records });
      }
      if (sections.includes('REQUEST_TO_RECEIVE')) {
        const records = filterByDate(pool.filter((r) => r.status === 'PENDING'));
        sectionResults.push({ id: 'REQUEST_TO_RECEIVE', title: 'REQUEST TO RECEIVE REPORT', count: records.length, records });
      }
      if (sections.includes('UPLOAD_HISTORY')) {
        const jobs = getImportJobs();
        sectionResults.push({ id: 'UPLOAD_HISTORY', title: 'UPLOAD HISTORY REPORT', count: jobs.length, records: jobs, isUploadHistory: true });
      }

      res.json({
        sections: sectionResults,
        generatedAt: new Date().toISOString(),
        office,
        fromDate: fromClean,
        toDate: toClean,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // NOTICES & OFFICIAL ANNOUNCEMENTS MODULE
  // ==========================================

  // Public / Admin list of notices
  app.get('/api/notices', (req: Request, res: Response) => {
    try {
      const showAll = req.query.all === 'true';
      const allNotices = getNotices();
      if (showAll) {
        return res.json(allNotices);
      }
      // By default return active notices
      const activeOnly = allNotices.filter((n) => n.status === 'ACTIVE');
      res.json(activeOnly);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve notices: ' + err.message });
    }
  });

  // Get single notice
  app.get('/api/notices/:id', (req: Request, res: Response) => {
    try {
      const notice = getNoticeById(req.params.id);
      if (!notice) {
        return res.status(404).json({ error: 'Notice not found' });
      }
      res.json(notice);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve notice: ' + err.message });
    }
  });

  // Create new notice (Admin or Super Admin)
  app.post('/api/notices', requireAdminOrSuperAdmin, (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { title, content } = req.body;
      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Notice title is required' });
      }
      if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Notice content is required' });
      }

      const created = createNotice(req.body, user);
      res.status(201).json({
        success: true,
        message: 'Notice created and published successfully',
        notice: created,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create notice: ' + err.message });
    }
  });

  // Update existing notice (Admin or Super Admin)
  app.put('/api/notices/:id', requireAdminOrSuperAdmin, (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const updated = updateNotice(req.params.id, req.body, user);
      if (!updated) {
        return res.status(404).json({ error: 'Notice not found' });
      }
      res.json({
        success: true,
        message: 'Notice updated successfully',
        notice: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update notice: ' + err.message });
    }
  });

  // Delete notice (Admin or Super Admin)
  app.delete('/api/notices/:id', requireAdminOrSuperAdmin, (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const ok = deleteNotice(req.params.id, user);
      if (!ok) {
        return res.status(404).json({ error: 'Notice not found or could not be deleted' });
      }
      res.json({ success: true, message: 'Notice deleted permanently' });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete notice: ' + err.message });
    }
  });

  // Toggle notice active / disabled status (Admin or Super Admin)
  app.patch('/api/notices/:id/toggle', requireAdminOrSuperAdmin, (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const toggled = toggleNoticeStatus(req.params.id, user);
      if (!toggled) {
        return res.status(404).json({ error: 'Notice not found' });
      }
      res.json({
        success: true,
        message: `Notice is now ${toggled.status}`,
        notice: toggled,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to toggle notice: ' + err.message });
    }
  });

  // Upload attachment for notice (standalone or direct - Admin or Super Admin)
  app.post(
    '/api/notices/upload-attachment',
    requireAdminOrSuperAdmin,
    (upload.single('attachment') as any),
    (req: Request, res: Response) => {
      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: 'No attachment file provided' });
        }
        const fileUrl = `/api/attachments/${file.filename}`;
        res.json({
          success: true,
          attachment: {
            name: file.originalname,
            size: file.size,
            type: file.mimetype,
            url: fileUrl,
            uploadedAt: new Date().toISOString(),
          },
        });
      } catch (err: any) {
        res.status(500).json({ error: 'Failed to upload attachment: ' + err.message });
      }
    }
  );

  // Upload attachment directly to a specific notice ID (Admin or Super Admin)
  app.post(
    '/api/notices/:id/upload-file',
    requireAdminOrSuperAdmin,
    (upload.single('attachment') as any),
    (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: 'No attachment file uploaded' });
        }
        const fileUrl = `/api/attachments/${file.filename}`;
        const attachment = {
          name: file.originalname,
          size: file.size,
          type: file.mimetype,
          url: fileUrl,
          uploadedAt: new Date().toISOString(),
        };

        const updated = updateNotice(req.params.id, { attachment }, user);
        if (!updated) {
          return res.status(404).json({ error: 'Notice not found' });
        }

        res.json({
          success: true,
          message: `Attachment "${file.originalname}" added to notice`,
          notice: updated,
          attachment,
        });
      } catch (err: any) {
        res.status(500).json({ error: 'Failed to attach file to notice: ' + err.message });
      }
    }
  );

  // Serve attachments securely
  app.get('/api/attachments/:filename', (req: Request, res: Response) => {
    try {
      const safeFilename = path.basename(req.params.filename);
      const filePath = path.join(STORAGE_UPLOADS, safeFilename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Attachment file not found on server' });
      }
      res.sendFile(filePath);
    } catch (err: any) {
      res.status(500).json({ error: 'Error serving attachment: ' + err.message });
    }
  });

  // ==========================================
  // API ROUTE FALLTHROUGH & GLOBAL ERROR HANDLER
  // Prevents API errors from ever returning HTML SPA fallback
  // ==========================================
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });

  app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
    console.error('API Error caught by middleware:', err);
    if (res.headersSent) {
      return next(err);
    }
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      error: err.message || 'An internal error occurred on the server.',
      code: err.code || 'INTERNAL_ERROR',
    });
  });

  // ==========================================
  // VITE DEV MIDDLEWARE OR PRODUCTION STATIC
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PRINTED LICENSE SEARCH MANAGEMENT SYSTEM (PLSMS) Server running on http://localhost:${PORT}`);
    // Immediately reconcile all distributed records into distributions.json
    try {
      reconcileDistributionsFromRecords();
    } catch (e: any) {
      console.warn('Initial distribution reconciliation error:', e.message);
    }
    // Start continuous 24/7 background Google Sheets synchronization daemon
    start24hBackgroundSyncDaemon();
  });
}

startServer().catch((err) => {
  console.error('Failed to start PLSMS server:', err);
});
