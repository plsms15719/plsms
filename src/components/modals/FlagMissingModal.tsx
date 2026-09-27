import React, { useState } from 'react';
import { X, AlertTriangle, ShieldAlert } from 'lucide-react';
import { LicenseRecord } from '../../types';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface Props {
  record: LicenseRecord | null;
  onClose: () => void;
  onSuccess: (updatedRecord: LicenseRecord) => void;
}

export const FlagMissingModal: React.FC<Props> = ({ record, onClose, onSuccess }) => {
  const { user } = useAuth();
  const [reason, setReason] = useState('While Searching Not-Found in Sorted Slot');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!record) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide a reason for flagging this license as missing.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const loginUserFullName = user?.name ? user.name.trim().toUpperCase() : (user?.id ? user.id.toUpperCase() : '');
      const res = await api.updateStatus(record.id, {
        status: 'MISSING',
        reason: reason.trim(),
        user: loginUserFullName,
        reportedBy: loginUserFullName,
        searchedBy: loginUserFullName,
        missingMarkedBy: loginUserFullName,
        missingMarkedSource: 'APP_BUTTON',
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('plsms:record-updated', { detail: { record: res.record, type: 'MISSING' } }));
      }
      onSuccess(res.record);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to flag record as missing');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-white dark:bg-[#0c1427] rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative animate-in fade-in zoom-in-95 duration-200 text-slate-900 dark:text-slate-100">
        <div className="p-6 bg-amber-600 dark:bg-amber-700 text-white flex items-center justify-between border-b border-amber-700 dark:border-amber-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white backdrop-blur-sm">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-amber-200 uppercase tracking-wider block">
                Inventory Discrepancy
              </span>
              <h3 className="text-base font-bold text-white">Flag Record as Missing</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white dark:bg-[#0c1427]">
          <div className="p-3.5 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/40 rounded-2xl text-xs space-y-1 shadow-xs">
            <div className="font-bold text-amber-950 dark:text-amber-200">
              License: <span className="font-mono text-amber-900 dark:text-amber-100 font-black">{record.licenseNumber || '---'}</span> ({record.holderName})
            </div>
            <div className="text-amber-800 dark:text-amber-300 text-[11px]">
              Office: {record.office} | App No: {record.applicationNumber}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-500/50 text-red-800 dark:text-red-200 p-3 rounded-xl text-xs font-semibold">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Incident Reason / Investigation Note
            </label>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="While Searching Not-Found in Sorted Slot"
              className="w-full p-3 bg-white dark:bg-[#101b33] border border-slate-300 dark:border-slate-700/80 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-600 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  Confirm Flag as Missing
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
