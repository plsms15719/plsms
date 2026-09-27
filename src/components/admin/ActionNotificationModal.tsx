import React, { useEffect } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  KeyRound,
  ShieldCheck,
  UserCheck,
  UserX,
  UserPlus,
  UserMinus,
  Lock,
  RefreshCw,
  X,
  SlidersHorizontal,
  Sparkles,
  Database,
  ArrowRight,
  Shield,
  User as UserIcon,
} from 'lucide-react';

export type ActionNotificationType = 'success' | 'error' | 'info' | 'warning';

export type SpecificActionType =
  | 'PERMISSIONS_UPDATED'
  | 'USER_CREATED'
  | 'USER_STATUS_ACTIVE'
  | 'USER_STATUS_SUSPENDED'
  | 'PASSWORD_RESET'
  | 'PASSWORD_DEFAULT_RESTORED'
  | 'USER_REVOKED'
  | 'SHEETS_CONFIG_SAVED'
  | 'VALIDATION_ERROR'
  | 'GENERAL_SUCCESS'
  | 'GENERAL_ERROR';

export interface ActionNotificationData {
  type: ActionNotificationType;
  text: string;
  title?: string;
  actionType?: SpecificActionType;
  targetName?: string;
  targetId?: string;
  targetRole?: string;
  details?: string;
}

interface ActionNotificationModalProps {
  notification: ActionNotificationData | null;
  onClose: () => void;
}

export const ActionNotificationModal: React.FC<ActionNotificationModalProps> = ({
  notification,
  onClose,
}) => {
  // Listen for Enter / Escape key for rapid dismissal
  useEffect(() => {
    if (!notification) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [notification, onClose]);

  if (!notification) return null;

  // Derive action details if not explicitly passed
  const rawText = notification.text || '';
  const isSuccess = notification.type === 'success';

  // Detect action category from text if actionType was not specified
  let action: SpecificActionType = notification.actionType || (isSuccess ? 'GENERAL_SUCCESS' : 'GENERAL_ERROR');

  if (!notification.actionType) {
    const lower = rawText.toLowerCase();
    if (lower.includes('permission')) {
      action = 'PERMISSIONS_UPDATED';
    } else if (lower.includes('created successfully') || lower.includes('user created')) {
      action = 'USER_CREATED';
    } else if (lower.includes('is now active') || lower.includes('now active')) {
      action = 'USER_STATUS_ACTIVE';
    } else if (lower.includes('is now suspended') || lower.includes('now suspended')) {
      action = 'USER_STATUS_SUSPENDED';
    } else if (lower.includes('default password restored') || lower.includes('automatically reset to official default')) {
      action = 'PASSWORD_DEFAULT_RESTORED';
    } else if (lower.includes('password') && lower.includes('reset')) {
      action = 'PASSWORD_RESET';
    } else if (lower.includes('revoked') || lower.includes('deleted')) {
      action = 'USER_REVOKED';
    } else if (lower.includes('sheet') || lower.includes('google sheets')) {
      action = 'SHEETS_CONFIG_SAVED';
    }
  }

  // Extract target name if not explicitly passed
  let targetName = notification.targetName;
  if (!targetName) {
    if (rawText.includes('for ')) {
      const parts = rawText.split(/for\s+/i);
      if (parts[1]) {
        targetName = parts[1].split(/[\.\,\"\']/)[0].trim();
      }
    } else if (rawText.includes('User account ')) {
      const match = rawText.match(/User account\s+([^\s]+)/i);
      if (match && match[1]) targetName = match[1];
    } else if (rawText.includes('User ')) {
      const match = rawText.match(/User\s+([^\s]+)/i);
      if (match && match[1]) targetName = match[1];
    }
  }

  // Configure action UI styling, icons, badges, titles, and understandable sentences
  let badgeText = 'PLSMS SYSTEM NOTIFICATION';
  let title = notification.title || (isSuccess ? 'Action Completed Successfully' : 'Action Notification');
  let sentence = notification.details || rawText;
  let nepaliSentence = '';
  let IconComponent = isSuccess ? CheckCircle2 : AlertCircle;
  let themeColor = isSuccess ? 'emerald' : 'rose';

  switch (action) {
    case 'PERMISSIONS_UPDATED': {
      IconComponent = KeyRound;
      badgeText = 'ACCESS CONTROL • PERMISSIONS UPDATED';
      title = notification.title || 'Staff Permissions Updated Successfully';
      sentence =
        notification.details ||
        `The operational permissions and system access rights for staff member ${
          targetName ? `"${targetName}"` : ''
        } have been successfully updated and applied in the PLSMS official records.`;
      nepaliSentence = targetName
        ? `कर्मचारी ${targetName} को प्रणाली पहुँच अधिकारहरू सफलतापूर्वक अद्यावधिक गरियो।`
        : 'कर्मचारीको प्रणाली अधिकारहरू सफलतापूर्वक अद्यावधिक गरियो।';
      themeColor = 'emerald';
      break;
    }
    case 'USER_CREATED': {
      IconComponent = UserPlus;
      badgeText = 'STAFF DIRECTORY • ACCOUNT CREATED';
      title = notification.title || 'Staff User Created Successfully';
      sentence =
        notification.details ||
        `Official staff account credentials for ${
          targetName ? `"${targetName}"` : 'the designated officer'
        } have been securely registered and synchronized in the PLSMS directory.`;
      nepaliSentence = 'नयाँ कर्मचारीको खाता सफलतापूर्वक सिर्जना गरियो।';
      themeColor = 'emerald';
      break;
    }
    case 'USER_STATUS_ACTIVE': {
      IconComponent = UserCheck;
      badgeText = 'ACCOUNT STATUS • ACTIVE';
      title = notification.title || 'Staff Account Activated';
      sentence =
        notification.details ||
        `The user profile for ${
          targetName ? `"${targetName}"` : 'the staff member'
        } has been activated. Full system login privileges have been restored.`;
      nepaliSentence = 'कर्मचारीको खाता सक्रिय गरिएको छ।';
      themeColor = 'emerald';
      break;
    }
    case 'USER_STATUS_SUSPENDED': {
      IconComponent = UserX;
      badgeText = 'ACCOUNT STATUS • SUSPENDED';
      title = notification.title || 'Staff Account Suspended';
      sentence =
        notification.details ||
        `The user account for ${
          targetName ? `"${targetName}"` : 'the staff member'
        } has been placed on SUSPENDED status. System access is temporarily restricted.`;
      nepaliSentence = 'कर्मचारीको खाता निलम्बित गरिएको छ।';
      themeColor = 'rose';
      break;
    }
    case 'PASSWORD_RESET': {
      IconComponent = Lock;
      badgeText = 'SECURITY CREDENTIALS • PASSWORD RESET';
      title = notification.title || 'Password Reset Successfully';
      sentence =
        notification.details ||
        `The temporary login password for ${
          targetName ? `"${targetName}"` : 'the staff member'
        } has been reset. The user will be required to choose a personal confidential password upon next login.`;
      nepaliSentence = 'गोप्य पासवर्ड सफलतापूर्वक परिवर्तन गरियो।';
      themeColor = 'emerald';
      break;
    }
    case 'PASSWORD_DEFAULT_RESTORED': {
      IconComponent = RefreshCw;
      badgeText = 'SECURITY CREDENTIALS • DEFAULT RESTORED';
      title = notification.title || 'Default Password Restored';
      sentence =
        notification.details ||
        `The password for ${
          targetName ? `"${targetName}"` : 'the staff member'
        } was restored to the official system default. A mandatory password change will occur on their next login.`;
      nepaliSentence = 'प्रणालीको पूर्वनिर्धारित पासवर्ड पुनःस्थापना गरियो।';
      themeColor = 'emerald';
      break;
    }
    case 'USER_REVOKED': {
      IconComponent = UserMinus;
      badgeText = 'STAFF DIRECTORY • ACCOUNT REVOKED';
      title = notification.title || 'Staff Account Revoked';
      sentence =
        notification.details ||
        `The user profile for ${
          targetName ? `"${targetName}"` : 'the staff member'
        } has been permanently revoked from the PLSMS government directory.`;
      nepaliSentence = 'कर्मचारीको खाता खारेज गरिएको छ।';
      themeColor = 'rose';
      break;
    }
    case 'SHEETS_CONFIG_SAVED': {
      IconComponent = Database;
      badgeText = 'CLOUD SYNCHRONIZATION • SAVED';
      title = notification.title || 'Google Sheets Configuration Saved';
      sentence =
        notification.details ||
        'Google Sheets integration credentials and auto-sync schedules have been saved and applied to the 24/7 background sync engine.';
      nepaliSentence = 'गुगल सिट समक्रमण सेटिङहरू सुरक्षित गरियो।';
      themeColor = 'emerald';
      break;
    }
    case 'VALIDATION_ERROR':
    case 'GENERAL_ERROR': {
      IconComponent = AlertTriangle;
      badgeText = 'SYSTEM VALIDATION • ACTION FAILED';
      title = notification.title || 'Action Could Not Be Completed';
      sentence = notification.details || rawText || 'An unexpected issue occurred while processing your request.';
      nepaliSentence = 'प्रक्रिया पूरा गर्न सकिएन, कृपया पुन: प्रयास गर्नुहोस्।';
      themeColor = 'rose';
      break;
    }
    default: {
      IconComponent = isSuccess ? CheckCircle2 : AlertCircle;
      badgeText = isSuccess ? 'PLSMS SUCCESS NOTIFICATION' : 'PLSMS SYSTEM NOTICE';
      title = notification.title || (isSuccess ? 'Action Completed Successfully' : 'Action Notification');
      sentence = notification.details || rawText;
      themeColor = isSuccess ? 'emerald' : 'rose';
      break;
    }
  }

  const isEmerald = themeColor === 'emerald';

  return (
    <div
      id="action-notification-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 dark:bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/*
        Horizontal Rectangular Card (Wide shape adhering strictly to user guidelines)
        - min width max-w-2xl (672px)
        - wide horizontal aspect ratio with ample breathing room
      */}
      <div
        id="action-notification-modal-card"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-2xl rounded-3xl bg-white dark:bg-[#070F1E] border-2 shadow-2xl overflow-hidden relative transition-all animate-in zoom-in-95 duration-200 ${
          isEmerald
            ? 'border-emerald-500/50 dark:border-emerald-500/60 shadow-emerald-950/30'
            : 'border-rose-500/50 dark:border-rose-500/60 shadow-rose-950/30'
        }`}
      >
        {/* Top Decorative Glowing Color Strip */}
        <div
          className={`h-2 w-full ${
            isEmerald
              ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500'
              : 'bg-gradient-to-r from-rose-500 via-red-500 to-amber-500'
          }`}
        />

        {/* Close Button Top Right */}
        <button
          type="button"
          id="btn-close-action-notification"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors z-10"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Ambient Subtle Background Glow */}
        <div
          className={`absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-20 ${
            isEmerald ? 'bg-emerald-500' : 'bg-rose-500'
          }`}
        />

        <div className="p-6 sm:p-8 space-y-5">
          {/* Main Horizontal Row: Icon + Content */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            {/* Meaningful Action Icon with glowing background */}
            <div className="relative shrink-0">
              <div
                className={`w-16 h-16 sm:w-18 sm:h-18 rounded-2xl border-2 flex items-center justify-center shadow-lg transition-transform ${
                  isEmerald
                    ? 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-300 dark:border-emerald-600/70 text-emerald-600 dark:text-emerald-400 shadow-emerald-500/10'
                    : 'bg-rose-50 dark:bg-rose-950/80 border-rose-300 dark:border-rose-600/70 text-rose-600 dark:text-rose-400 shadow-rose-500/10'
                }`}
              >
                <IconComponent className="w-8 h-8 sm:w-9 sm:h-9" />
              </div>

              {/* Secondary corner sparkle/shield accent */}
              <div
                className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center shadow-sm text-white ${
                  isEmerald ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
              >
                {action === 'PERMISSIONS_UPDATED' ? (
                  <ShieldCheck className="w-3.5 h-3.5" />
                ) : isEmerald ? (
                  <Sparkles className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
              </div>
            </div>

            {/* Content Area */}
            <div className="space-y-1.5 flex-1 min-w-0">
              {/* Action Badge */}
              <div className="flex items-center gap-2 flex-wrap">
                <div
                  className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full border text-[10px] sm:text-[11px] font-mono font-bold uppercase tracking-wider ${
                    isEmerald
                      ? 'bg-emerald-100 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                      : 'bg-rose-100 dark:bg-rose-950/90 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                  }`}
                >
                  <Shield className="w-3 h-3 shrink-0" />
                  <span>{badgeText}</span>
                </div>

                {targetName && (
                  <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-[10px] sm:text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300">
                    <UserIcon className="w-3 h-3 text-slate-500" />
                    <span>{targetName}</span>
                  </div>
                )}
              </div>

              {/* Main Title */}
              <h3
                className={`text-lg sm:text-xl font-black tracking-tight uppercase leading-snug ${
                  isEmerald
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {title}
              </h3>

              {/* Optional Nepali context subtitle */}
              {nepaliSentence && (
                <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400">
                  {nepaliSentence}
                </p>
              )}
            </div>
          </div>

          {/* Understandable Beautiful Sentence Box */}
          <div className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-[#0B172B] border border-slate-200 dark:border-[#1A2E4C] text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed space-y-2">
            <p>
              {sentence}
            </p>

            {/* Additional context pills if target user details available */}
            {(targetName || notification.targetId || notification.targetRole) && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {targetName && (
                  <span>
                    Staff Member: <strong className="text-slate-900 dark:text-white">{targetName}</strong>
                  </span>
                )}
                {notification.targetId && (
                  <>
                    <span>•</span>
                    <span>
                      ID: <strong className="text-indigo-600 dark:text-indigo-400">{notification.targetId}</strong>
                    </span>
                  </>
                )}
                {notification.targetRole && (
                  <>
                    <span>•</span>
                    <span>
                      Role: <strong className="text-amber-600 dark:text-amber-400">{notification.targetRole}</strong>
                    </span>
                  </>
                )}
                <span>•</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  PLSMS Verified Record
                </span>
              </div>
            )}
          </div>

          {/* Action Button Row */}
          <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-1">
            <button
              type="button"
              id="btn-action-notification-dismiss"
              onClick={onClose}
              className={`w-full sm:w-auto px-6 py-2.5 rounded-xl font-mono text-xs sm:text-sm font-bold uppercase tracking-wider text-white shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] ${
                isEmerald
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 shadow-emerald-900/20'
                  : 'bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-700 hover:to-red-800 shadow-rose-900/20'
              }`}
            >
              <span>UNDERSTOOD — CONTINUE</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
