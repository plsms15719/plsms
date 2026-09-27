import React, { useState, useEffect } from 'react';
import { X, AlertCircle, RefreshCw, PhoneCall } from 'lucide-react';
import { LicenseRecord } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, isSuperAdminUser } from '../../utils/permissions';
import { api } from '../../services/api';
import { getNepaliDate, formatDistributedDateBS } from '../../utils/dateUtils';

interface Props {
  record: LicenseRecord | null;
  onClose: () => void;
  onSuccess: (updatedRecord: LicenseRecord) => void;
}

export const ConfirmFoundModal: React.FC<Props> = ({ record, onClose, onSuccess }) => {
  const { user } = useAuth();
  const isSuperAdmin = isSuperAdminUser(user);
  const canVerify = hasPermission(user, 'found.verify') || hasPermission(user, 'records.unmark_missing') || isSuperAdmin;

  const [contactMobile, setContactMobile] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Nepali Calendar BS Date calculation
  const [foundDate, setFoundDate] = useState<string>('');

  useEffect(() => {
    if (record) {
      const rawFoundDate =
        record.foundDate ||
        record.rawRecord?.['FOUND DATE'] ||
        record.rawRecord?.['FOUND_DATE'] ||
        record.rawRecord?.['Found Date'] ||
        (record.foundReportedAt ? formatDistributedDateBS(record.foundReportedAt) : '') ||
        getNepaliDate(new Date());
      setFoundDate(rawFoundDate);

      const rawMobile = (
        record.phone ||
        record.mobileNumber ||
        record.receiverPhone ||
        record.rawRecord?.['MOBILE NUMBER'] ||
        record.rawRecord?.['PHONE'] ||
        record.rawRecord?.['MOBILE'] ||
        record.rawRecord?.['CONTACT'] ||
        ''
      )
        .replace(/\D/g, '')
        .slice(0, 10);
      setContactMobile(rawMobile);
    }
  }, [record]);

  if (!record) return null;

  const licenseNumberDisplay =
    record.licenseNumber ||
    record.rawRecord?.['LICENSE NUMBER'] ||
    (record.applicantId ? `APP ID: ${record.applicantId}` : record.applicationNumber ? `APP ID: ${record.applicationNumber}` : '---');

  const cardHolderNameDisplay =
    record.holderName ||
    record.rawRecord?.['FULL NAME'] ||
    record.rawRecord?.['APPLICANT NAME'] ||
    'N/A';

  const applicantIdDisplay =
    record.applicantId ||
    record.applicationNumber ||
    record.rawRecord?.['APPLICANT ID'] ||
    '---';

  const foundByText =
    record.foundBy ||
    record.foundReportedBy ||
    record.rawRecord?.['FOUND BY'] ||
    record.rawRecord?.['FOUND_BY'] ||
    user?.name ||
    'KOMAL DAHAL';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canVerify) {
      setError('Access Denied: You do not have permission to verify and mark cards found (found.verify / records.unmark_missing required).');
      return;
    }

    const cleanMobile = contactMobile.trim().replace(/\D/g, '');

    try {
      setLoading(true);
      setError('');

      const res = await api.updateStatus(record.id, {
        status: 'FOUND',
        reason: `Smart card recovered and verified as FOUND by ${foundByText}. Found Date: ${foundDate}`,
        foundBy: foundByText,
        foundDate: foundDate,
        phone: cleanMobile || record.phone || undefined,
        contactMobile: cleanMobile || record.phone || undefined,
      } as any);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('plsms:record-updated', { detail: { record: res.record, type: 'FOUND' } }));
      }

      onSuccess(res.record);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to confirm found card.');
    } finally {
      setLoading(false);
    }
  };

  const isSubmitDisabled = !canVerify || loading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
      {/* Wide horizontal rectangular modal */}
      <div className="w-full max-w-[620px] max-h-[94vh] bg-white dark:bg-[#0c1a30] text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl border-2 border-slate-300 dark:border-[#1e345e] overflow-hidden flex flex-col relative font-sans">
        
        {/* Header */}
        <div className="pt-4 px-6 pb-2.5 border-b border-slate-200 dark:border-[#182c50] flex items-start justify-between shrink-0 bg-slate-50/50 dark:bg-[#071326]/50">
          <div>
            <span className="text-[11px] font-bold text-sky-600 dark:text-[#00E5FF] tracking-wider uppercase font-mono block mb-0.5">
              PLSMS REGISTRY ACTION
            </span>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
              Confirm Found Card
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#182c50] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col justify-between">
          <div>
            {!canVerify && (
              <div className="mb-3.5 p-3 bg-rose-50 dark:bg-rose-950/60 border-2 border-rose-300 dark:border-rose-500/50 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span className="font-semibold">Access Denied: You do not have permission to verify and mark cards found (found.verify / records.unmark_missing required).</span>
              </div>
            )}

            {error && (
              <div className="mb-3.5 p-3 bg-red-50 dark:bg-red-950/60 border-2 border-red-300 dark:border-red-500/50 rounded-xl text-xs text-red-800 dark:text-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* CARD HOLDER'S DETAILS Card */}
            <div className="bg-slate-50/90 dark:bg-[#071326] border-2 border-slate-300 dark:border-[#182c50] rounded-xl p-3.5 sm:p-4 space-y-2 text-xs shadow-xs">
              <div className="flex items-center justify-between pb-1 border-b border-slate-200 dark:border-[#182c50]">
                <label className="block text-[11px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                  CARD HOLDER&apos;S DETAILS
                </label>
              </div>

              {/* License Number */}
              <div className="flex items-center justify-between py-1 border-b border-slate-200 dark:border-[#12223f]/80">
                <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                  LICENSE NUMBER:
                </span>
                <span className="font-mono font-black text-sky-700 dark:text-[#00E5FF] text-xs sm:text-sm">
                  {licenseNumberDisplay}
                </span>
              </div>

              {/* Card Holder Name */}
              <div className="flex items-center justify-between py-1 border-b border-slate-200 dark:border-[#12223f]/80">
                <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                  CARD HOLDER NAME:
                </span>
                <span className="font-black text-slate-900 dark:text-white text-xs sm:text-[13px] uppercase">
                  {cardHolderNameDisplay}
                </span>
              </div>

              {/* Applicant ID */}
              <div className="flex items-center justify-between py-1 border-b border-slate-200 dark:border-[#12223f]/80">
                <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                  APPLICANT ID:
                </span>
                <span className="font-mono font-black text-slate-900 dark:text-white text-xs sm:text-sm">
                  {applicantIdDisplay}
                </span>
              </div>

              {/* Found Date */}
              <div className="flex items-center justify-between py-1 border-b border-slate-200 dark:border-[#12223f]/80">
                <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                  FOUND DATE:
                </span>
                <span className="font-mono font-black text-slate-900 dark:text-white text-xs sm:text-sm">
                  {foundDate || '---'}
                </span>
              </div>

              {/* Contact Mobile */}
              <div className="flex items-center justify-between py-1 border-b border-slate-200 dark:border-[#12223f]/80">
                <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                  MOBILE NUMBER:
                </span>
                {contactMobile.replace(/\D/g, '').length >= 10 ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 text-xs sm:text-[13px]">
                      {contactMobile}
                    </span>
                    {isSuperAdmin && (
                      <a
                        href={`tel:${contactMobile}`}
                        className="px-2 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1 border border-emerald-300 dark:border-emerald-600/50 transition-colors"
                        title={`Call ${cardHolderNameDisplay}`}
                      >
                        <PhoneCall className="w-2.5 h-2.5" />
                        <span>Call</span>
                      </a>
                    )}
                  </div>
                ) : (
                  <span className="font-mono text-slate-500 dark:text-slate-400 text-xs sm:text-[13px]">
                    {contactMobile || '---'}
                  </span>
                )}
              </div>

              {/* Found By */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                  FOUND BY:
                </span>
                <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-[13px] truncate max-w-[220px] uppercase">
                  {foundByText}
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Row: Action Buttons (Safe and kept exactly as in Picture 1) */}
          <div className="pt-3.5 mt-3 border-t border-slate-200 dark:border-[#182c50] flex items-center justify-end gap-2.5 shrink-0">
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className={`px-5 sm:px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-md flex items-center gap-1.5 h-[42px] ${
                isSubmitDisabled
                  ? 'bg-purple-300 dark:bg-purple-950/40 text-purple-700/60 dark:text-purple-300/40 cursor-not-allowed border border-purple-200 dark:border-purple-900/40 shadow-none'
                  : 'bg-purple-600 hover:bg-purple-700 text-white cursor-pointer active:scale-95 shadow-purple-600/30'
              }`}
            >
              {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>SAVE & MARK AS FOUND</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-[#1e2d47] dark:hover:bg-[#283b5c] dark:text-slate-200 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer active:scale-95 h-[42px]"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
