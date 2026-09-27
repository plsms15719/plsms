import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  UserCheck,
  Edit3,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Save,
  Shield,
  Lock,
  Phone,
  Mail,
  Briefcase,
  User as UserIcon,
  ArrowRight,
  Info,
} from 'lucide-react';
import { User } from '../../types';
import { api } from '../../services/api';

interface UpdateStaffDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser: User | null;
  currentUser?: User | null;
  onSuccess: (updatedUser: User, auditDetails?: string) => void;
}

export const UpdateStaffDetailsModal: React.FC<UpdateStaffDetailsModalProps> = ({
  isOpen,
  onClose,
  targetUser,
  currentUser,
  onSuccess,
}) => {
  if (!isOpen || !targetUser) return null;

  const [fullName, setFullName] = useState(targetUser.name || '');
  const [phone, setPhone] = useState(targetUser.phone || '');
  const [email, setEmail] = useState(targetUser.email || '');
  const [post, setPost] = useState(targetUser.post || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Sync state whenever targetUser changes
  useEffect(() => {
    if (targetUser) {
      setFullName(targetUser.name || '');
      setPhone(targetUser.phone || '');
      setEmail(targetUser.email || '');
      setPost(targetUser.post || '');
      setError('');
      setSuccess('');
    }
  }, [targetUser]);

  // Compute live modifications diff for immediate audit visibility
  const changes = useMemo(() => {
    const list: { field: string; oldVal: string; newVal: string }[] = [];
    const origName = (targetUser.name || '').trim().toUpperCase();
    const curName = fullName.trim().toUpperCase();
    if (curName !== origName) {
      list.push({ field: 'Full Name', oldVal: origName || 'NOT SPECIFIED', newVal: curName });
    }

    const origPhone = (targetUser.phone || '').trim();
    const curPhone = phone.trim();
    if (curPhone !== origPhone) {
      list.push({ field: 'Phone Number', oldVal: origPhone || 'NOT SPECIFIED', newVal: curPhone || 'NONE' });
    }

    const origEmail = (targetUser.email || '').trim().toLowerCase();
    const curEmail = email.trim().toLowerCase();
    if (curEmail !== origEmail) {
      list.push({ field: 'Email Address', oldVal: targetUser.email || 'NOT SPECIFIED', newVal: email.trim() || 'NONE' });
    }

    const origPost = (targetUser.post || '').trim();
    const curPost = post.trim();
    if (curPost !== origPost) {
      list.push({ field: 'Designation / Post', oldVal: origPost || 'NOT SPECIFIED', newVal: curPost || 'NONE' });
    }

    return list;
  }, [targetUser, fullName, phone, email, post]);

  const hasChanges = changes.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = fullName.trim().toUpperCase();

    if (!cleanName) {
      setError('Staff Full Name is required.');
      return;
    }

    // Basic email format check if email is filled
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please provide a valid email format (e.g., name@domain.com).');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccess('');

      const res = await api.updateUserDetails(targetUser.id, {
        name: cleanName,
        phone: phone.trim(),
        email: email.trim(),
        post: post.trim(),
      });

      if (res.success && res.user) {
        setSuccess(res.message || 'Staff profile details updated and permanently saved.');
        onSuccess(res.user, res.auditDetails);
        setTimeout(() => {
          onClose();
        }, 900);
      } else {
        setError(res.message || 'Failed to update staff details.');
      }
    } catch (err: any) {
      setError(err?.message || 'Server error while saving staff details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white dark:bg-[#081326] border border-slate-200 dark:border-[#1C335A] rounded-2xl shadow-2xl max-w-3xl w-full p-6 sm:p-7 space-y-5 transition-all text-slate-900 dark:text-white my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#14233C] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 shadow-xs">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black tracking-wide font-mono text-slate-900 dark:text-white uppercase flex items-center gap-2">
                <span>UPDATE STAFF PROFILE DETAILS</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                Printed License Search Management System (PLSMS) • Super Admin Control Center
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            title="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Horizontal Status Strip (Wide horizontal rectangular card) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
          <div className="p-2.5 bg-slate-50 dark:bg-[#050C18] border border-slate-200 dark:border-[#14233C] rounded-xl">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              PERMANENT USER ID
            </span>
            <span className="text-xs font-black text-slate-900 dark:text-white mt-0.5 block truncate flex items-center gap-1">
              <Lock className="w-3 h-3 text-slate-400 shrink-0" />
              {targetUser.id}
            </span>
          </div>
          <div className="p-2.5 bg-slate-50 dark:bg-[#050C18] border border-slate-200 dark:border-[#14233C] rounded-xl">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              SYSTEM ROLE
            </span>
            <span className="text-xs font-bold text-sky-600 dark:text-[#38BDF8] mt-0.5 block truncate">
              {targetUser.role || 'DATA ENTRY OFFICER'}
            </span>
          </div>
          <div className="p-2.5 bg-slate-50 dark:bg-[#050C18] border border-slate-200 dark:border-[#14233C] rounded-xl">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              ACCOUNT STATUS
            </span>
            <span className={`text-xs font-black mt-0.5 block ${
              targetUser.status === 'SUSPENDED'
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}>
              {targetUser.status || 'ACTIVE'}
            </span>
          </div>
          <div className="p-2.5 bg-slate-50 dark:bg-[#050C18] border border-slate-200 dark:border-[#14233C] rounded-xl">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              CREDENTIAL INTEGRITY
            </span>
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 mt-0.5 block truncate flex items-center gap-1">
              <Shield className="w-3 h-3 text-amber-500 shrink-0" />
              Preserved Safe
            </span>
          </div>
        </div>

        {/* Security Invariant Guarantee Banner */}
        <div className="p-3 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-[11px] leading-relaxed">
            <p className="font-bold font-mono uppercase tracking-wide">
              Official Profile Update Policy
            </p>
            <p className="text-slate-600 dark:text-slate-300 font-sans">
              Super Admin edits staff Full Name, Phone, Email, and Post. The existing user record is updated in-place (never deleted or recreated). <strong>User ID, Role, Access Permissions, and Password/M-PIN security hashes remain strictly untouched.</strong>
            </p>
          </div>
        </div>

        {/* Error / Success Feedback */}
        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-900 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            <span>{success}</span>
          </div>
        )}

        {/* Form Inputs (Generous 2-Column Wide Horizontal Layout) */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Full Name */}
            <div>
              <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                  STAFF FULL NAME <span className="text-rose-500">*</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal">Official Display Name</span>
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value.toUpperCase())}
                placeholder="e.g. SITANSHU DAHAL"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#050C18] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all uppercase"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                Reflected in license search logs, reports, and distribution records.
              </p>
            </div>

            {/* 2. Designation / Post */}
            <div>
              <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                  DESIGNATION / POST
                </span>
                <span className="text-[10px] text-slate-400 font-normal">Official Title</span>
              </label>
              <input
                type="text"
                value={post}
                onChange={(e) => setPost(e.target.value)}
                placeholder="e.g. Officer 6th / Computer Operator / Assistant"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#050C18] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                Administrative designation displayed on staff credentials.
              </p>
            </div>

            {/* 3. Mobile Phone Number */}
            <div>
              <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  MOBILE PHONE NUMBER
                </span>
                <span className="text-[10px] text-slate-400 font-normal">10 Digits</span>
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 9842033214"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#050C18] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                Official contact telephone / mobile number.
              </p>
            </div>

            {/* 4. Email Address */}
            <div>
              <label className="block text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 font-mono flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  EMAIL ADDRESS
                </span>
                <span className="text-[10px] text-slate-400 font-normal">Login Identifier</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. staff@tmodl.gov.np"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#050C18] border border-slate-300 dark:border-[#1A3158] rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                Staff member can use this email or their User ID to sign in.
              </p>
            </div>
          </div>

          {/* Real-time Audit Trail Preview (Old Value → New Value → Changed By → Date/Time) */}
          <div className="p-3.5 bg-slate-50 dark:bg-[#050C18] border border-slate-200 dark:border-[#14233C] rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-amber-500" />
                SECURITY AUDIT LOG PREVIEW (WILL BE RECORDED PERMANENTLY)
              </span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                hasChanges
                  ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}>
                {changes.length} FIELD{changes.length === 1 ? '' : 'S'} MODIFIED
              </span>
            </div>

            {hasChanges ? (
              <div className="space-y-1.5 pt-1">
                {changes.map((ch, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center gap-2 text-xs font-mono bg-white dark:bg-[#091527] p-2 rounded-lg border border-slate-200 dark:border-[#1A3158]"
                  >
                    <span className="font-bold text-slate-600 dark:text-slate-400 min-w-[120px]">
                      {ch.field}:
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 line-through text-[11px]">
                      {ch.oldVal}
                    </span>
                    <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 font-bold text-[11px]">
                      {ch.newVal}
                    </span>
                  </div>
                ))}
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono pt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span><strong>Changed By:</strong> {currentUser?.name || 'SUPER ADMIN'} ({currentUser?.id || 'SUPER_ADMIN'})</span>
                  <span><strong>Date/Time:</strong> Official Server Timestamp</span>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 font-mono italic">
                No modifications detected. Edit any field above to update staff details.
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-[#14233C]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-save-staff-details"
              disabled={loading || !fullName.trim() || !hasChanges}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 rounded-xl text-xs font-mono font-black flex items-center gap-2 shadow-md transition-all cursor-pointer shadow-amber-500/20"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>SAVE & UPDATE DETAILS PERMANENTLY</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
