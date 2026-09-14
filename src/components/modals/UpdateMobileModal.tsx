import React, { useState, useEffect } from 'react';
import { X, Phone, PhoneCall, AlertCircle, RefreshCw, Check } from 'lucide-react';
import { LicenseRecord } from '../../types';
import { api } from '../../services/api';
import { saveInputHistory } from '../common/HistoryInput';

interface Props {
  record: LicenseRecord | null;
  onClose: () => void;
  onSuccess: (updatedRecord: LicenseRecord) => void;
}

export const UpdateMobileModal: React.FC<Props> = ({ record, onClose, onSuccess }) => {
  if (!record) return null;

  const initialDigits = (
    record.phone ||
    record.receiverPhone ||
    record.rawRecord?.['PHONE'] ||
    record.rawRecord?.['MOBILE'] ||
    record.rawRecord?.['MOBILE NUMBER'] ||
    record.rawRecord?.['CONTACT'] ||
    ''
  ).replace(/\D/g, '').slice(0, 10);

  const [mobileNumber, setMobileNumber] = useState<string>(initialDigits);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setMobileNumber(initialDigits);
  }, [record]);

  const digitsOnly = mobileNumber.replace(/\D/g, '');
  const isValid10Digits = digitsOnly.length === 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!digitsOnly) {
      setError('Mobile number is compulsory to contact the applicant.');
      return;
    }
    if (digitsOnly.length < 10) {
      setError('Please enter a valid 10-digit mobile number (e.g. 9841234567).');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const res = await api.updateRecordMobile(record.id, digitsOnly);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('plsms:record-updated', {
            detail: { record: res.record, type: 'MOBILE_UPDATED' },
          })
        );
      }

      saveInputHistory('missing_contact', digitsOnly);
      onSuccess(res.record);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update contact mobile number.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-[460px] bg-white dark:bg-[#0c1a30] text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl border-2 border-slate-300 dark:border-[#1e345e] overflow-hidden flex flex-col relative font-sans">
        {/* Header */}
        <div className="pt-5 px-6 pb-2 flex items-start justify-between border-b border-slate-200 dark:border-[#182c50]">
          <div>
            <span className="text-[11px] font-bold text-sky-600 dark:text-[#00E5FF] tracking-wider uppercase font-mono block mb-1">
              PLSMS CONTACT REGISTRY
            </span>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <Phone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span>Cardholder Mobile Number</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compulsory for contacting the applicant to handover the recovered card.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-black dark:hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-950/60 border border-red-300 dark:border-red-500/50 rounded-xl text-xs text-red-900 dark:text-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Record Summary Box */}
          <div className="bg-slate-50/90 dark:bg-[#071326] border border-slate-200 dark:border-[#182c50] rounded-xl p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                Card Holder Name:
              </span>
              <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-[13px] uppercase">
                {record.holderName || '---'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                License Number:
              </span>
              <span className="font-mono font-bold text-sky-700 dark:text-[#00E5FF] text-xs">
                {record.licenseNumber || '---'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                Applicant ID:
              </span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 text-xs">
                {record.applicantId || record.applicationNumber || '---'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                Card Status:
              </span>
              <span className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400 text-[10px] font-bold uppercase tracking-wider">
                {record.status || 'MISSING'}
              </span>
            </div>
          </div>

          {/* Mobile Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                MOBILE NUMBER (मोबाईल नम्बर) <span className="text-red-500 font-bold">* (Compulsory)</span>
              </label>
              {isValid10Digits && (
                <a
                  href={`tel:${digitsOnly}`}
                  className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                >
                  <PhoneCall className="w-3 h-3" />
                  <span>Test Call</span>
                </a>
              )}
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">+977</span>
              </div>
              <input
                type="tel"
                required
                autoFocus
                maxLength={10}
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="98XXXXXXXX (10 digits)"
                className="w-full pl-14 pr-3.5 py-2.5 bg-white dark:bg-[#071326] border-2 border-slate-300 dark:border-[#1c335a] focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-slate-900 dark:text-white text-sm font-mono font-bold outline-none transition-all placeholder:text-slate-400"
              />
            </div>
            <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
              Enter the applicant's reachable 10-digit mobile number so office staff can call to coordinate card handover.
            </p>
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-200 dark:border-[#182c50] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-[#1e2d47] dark:hover:bg-[#283b5c] dark:text-slate-200 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !isValid10Digits}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              {loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>Save Mobile Number</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
