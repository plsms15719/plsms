import React, { useState } from 'react';
import { X, Lock, AlertOctagon, Loader2 } from 'lucide-react';
import { LicenseRecord } from '../../types';
import { api } from '../../services/api';
import { HistoryInput, saveInputHistory } from '../common/HistoryInput';
import { useAuth } from '../../context/AuthContext';

interface Props {
  record: LicenseRecord | null;
  onClose: () => void;
  onSuccess: (updatedRecord: LicenseRecord) => void;
}

export const ReportMissingModal: React.FC<Props> = ({ record, onClose, onSuccess }) => {
  const { user } = useAuth();
  if (!record) return null;

  // Keep only digits and maximum 10 digits
  const initialDigits = (
    record.phone ||
    record.receiverPhone ||
    record.rawRecord?.['CONTACT'] ||
    record.rawRecord?.['PHONE'] ||
    record.rawRecord?.['MOBILE'] ||
    ''
  ).replace(/\D/g, '').slice(0, 10);

  const [contactMobile, setContactMobile] = useState<string>(initialDigits);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const digitsOnly = contactMobile.replace(/\D/g, '');
  const isValid10Digits = digitsOnly.length === 10;

  // Extract Father / Husband name
  const fhName =
    record.fatherOrSpouseName ||
    record.rawRecord?.['F/H NAME'] ||
    record.rawRecord?.['FATHER/HUSBAND NAME'] ||
    record.rawRecord?.['FATHER NAME'] ||
    record.rawRecord?.['SPOUSE NAME'] ||
    record.rawRecord?.['FATHER / SPOUSE NAME'] ||
    '';

  // Category
  const category = record.category || record.vehicleClass || record.rawRecord?.['CATEGORY'] || 'K';

  // Applicant ID / App Number
  const applicantId = record.applicantId || record.applicationNumber || record.rawRecord?.['APPLICANT ID'] || '<N/A>';

  // License Number
  const licenseNo = record.licenseNumber || record.rawRecord?.['LICENSE NUMBER'] || '<N/A>';

  // Distribution Date
  const distributionDate =
    record.distributedDate ||
    record.rawRecord?.['DISTRIBUTION DATE'] ||
    (record.distributedAt ? record.distributedAt.split('T')[0] : '<N/A>');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNumber = contactMobile.trim();

    if (!cleanNumber) {
      setError('Contact mobile number is required to dispatch notifications.');
      return;
    }

    // Strip non-digit characters to validate length
    const digitsOnly = cleanNumber.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      setError('Please provide a valid 10-digit contact mobile number (e.g. 9841234567).');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const loginUserFullName = user?.name ? user.name.trim().toUpperCase() : (user?.id ? user.id.toUpperCase() : '');
      const res = await api.updateStatus(record.id, {
        status: 'MISSING',
        reason: 'While Searching Not-Found in Sorted Slot',
        phone: cleanNumber,
        contactMobile: cleanNumber,
        user: loginUserFullName,
        reportedBy: loginUserFullName,
        searchedBy: loginUserFullName,
        missingMarkedBy: loginUserFullName,
        missingMarkedSource: 'APP_BUTTON',
      });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('plsms:record-updated', { detail: { record: res.record, type: 'MISSING' } }));
      }

      saveInputHistory('missing_contact', cleanNumber);

      onSuccess(res.record);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update record status to MISSING.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white dark:bg-[#0f1d32] border-2 border-slate-300 dark:border-[#1e3458] rounded-2xl p-6 sm:p-7 text-slate-900 dark:text-white shadow-2xl relative animate-in zoom-in-95 duration-200">
        {/* Top Header */}
        <div className="flex items-start justify-between">
          <div>
            <span className="text-red-600 dark:text-[#F87171] font-mono text-[11px] font-black uppercase tracking-wider block">
              PLSMS REGISTRY ACTION
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1 tracking-tight">
              Report Card as Missing
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-black dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Card Ledger Details Box */}
        <div className="mt-5 rounded-xl border-2 border-slate-300 dark:border-slate-700/80 bg-slate-50/90 dark:bg-[#081220] p-4 sm:p-5 space-y-3 shadow-xs">
          <div className="flex items-center gap-1.5 text-red-600 dark:text-[#F87171] font-mono text-xs font-black uppercase tracking-wider">
            <Lock className="w-3.5 h-3.5 text-red-600 dark:text-[#F87171]" />
            <span>CURRENT CARD LEDGER DETAILS</span>
          </div>

          <div className="space-y-2.5 pt-1 text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-slate-600 dark:text-slate-400 font-mono font-bold uppercase tracking-wider text-[11px] min-w-[125px]">
                FULL NAME:
              </span>
              <span className="text-slate-900 dark:text-white font-black uppercase tracking-wide text-sm">
                {record.holderName || '<N/A>'}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-slate-600 dark:text-slate-400 font-mono font-bold uppercase tracking-wider text-[11px] min-w-[125px]">
                APPLICANT ID:
              </span>
              <span className="text-slate-900 dark:text-white font-mono font-black text-sm">
                {applicantId}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-slate-600 dark:text-slate-400 font-mono font-bold uppercase tracking-wider text-[11px] min-w-[125px]">
                LICENSE NO.:
              </span>
              <span className="text-blue-700 dark:text-[#38BDF8] font-mono font-black text-sm tracking-wide">
                {licenseNo}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-slate-600 dark:text-slate-400 font-mono font-bold uppercase tracking-wider text-[11px] min-w-[125px]">
                F/H NAME:
              </span>
              <span className="text-slate-900 dark:text-white font-bold uppercase text-xs">
                {fhName || ''}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-600 dark:text-slate-400 font-mono font-bold uppercase tracking-wider text-[11px] min-w-[125px]">
                CATEGORY:
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-[#162744] text-blue-800 dark:text-[#38BDF8] border border-blue-300 dark:border-[#2b426b] font-mono font-bold text-xs">
                {category}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-slate-600 dark:text-slate-400 font-mono font-bold uppercase tracking-wider text-[11px] min-w-[125px]">
                DISTRIBUTION DATE:
              </span>
              <span className="text-slate-900 dark:text-white font-mono font-bold text-sm">
                {distributionDate}
              </span>
            </div>
          </div>
        </div>

        {/* Form for Contact Mobile & Submission */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-mono font-bold text-slate-800 dark:text-slate-300 uppercase tracking-wider">
                CONTACT MOBILE NUMBER (10 DIGITS) <span className="text-red-500">*</span>
              </label>
              <span className={`text-[11px] font-mono font-bold ${isValid10Digits ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                {digitsOnly.length}/10 digits
              </span>
            </div>
            <HistoryInput
              historyKey="missing_contact"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              required
              value={contactMobile}
              onChange={(e) => {
                const onlyNums = e.target.value.replace(/\D/g, '').slice(0, 10);
                setContactMobile(onlyNums);
                if (error) setError('');
              }}
              placeholder="Enter 10-digit mobile number (e.g. 9841234567)"
              className={`w-full bg-white dark:bg-[#081220] border rounded-xl px-4 py-2.5 text-slate-900 dark:text-white font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none transition-all ${
                isValid10Digits
                  ? 'border-emerald-500 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500'
                  : 'border-slate-300 dark:border-slate-700/90 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500'
              }`}
            />
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-2 font-medium">
              Providing a valid 10-digit mobile number is compulsory before we can dispatch notifications and register this record in the secondary missing index.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-950/60 border border-red-300 dark:border-red-500/50 rounded-xl text-red-900 dark:text-red-300 text-xs font-bold flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-[#22334e] dark:hover:bg-[#2e476b] text-slate-800 dark:text-slate-200 text-xs font-bold transition-all shadow cursor-pointer disabled:opacity-50"
            >
              No, Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !isValid10Digits}
              title={isValid10Digits ? 'Click to send to missing cards list' : 'Please enter exactly 10 digits mobile number'}
              className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg flex items-center gap-2 ${
                isValid10Digits && !loading
                  ? 'bg-[#b91c1c] hover:bg-[#991B1B] text-white cursor-pointer active:scale-95 shadow-red-900/30'
                  : 'bg-red-200 dark:bg-[#3b1919] text-red-400/80 dark:text-red-300/40 cursor-not-allowed opacity-50 border border-red-300 dark:border-red-900/30'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>SEND TO MISSING CARDS LIST</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
