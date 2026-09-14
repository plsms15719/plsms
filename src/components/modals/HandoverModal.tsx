import React, { useState } from 'react';
import { X, CheckCircle2, UserCheck, ShieldCheck, AlertCircle, Phone, CreditCard, User, FileText } from 'lucide-react';
import { LicenseRecord } from '../../types';
import { api } from '../../services/api';
import { HistoryInput, saveInputHistory } from '../common/HistoryInput';
import { isRecommenderDoc, cleanStaffRecommenderName, formatRecommenderDoc } from '../../utils/staffUtils';

interface Props {
  record: LicenseRecord | null;
  onClose: () => void;
  onSuccess: (updatedRecord: LicenseRecord) => void;
}

export const HandoverModal: React.FC<Props> = ({ record, onClose, onSuccess }) => {
  const isAlreadyDistributed = Boolean(
    record && (
      record.isDistributed ||
      (record.receivedBy && record.receivedBy.trim().length > 0 && record.receivedBy !== '-') ||
      (record.receiverName && record.receiverName.trim().length > 0 && record.receiverName !== '-') ||
      record.status === 'DISTRIBUTED'
    )
  );

  const [receiverName, setReceiverName] = useState(record?.holderName || '');
  const [receiverNid, setReceiverNid] = useState(record?.nidOrPassport || '');
  const [receiverPhone, setReceiverPhone] = useState(record?.phone || '');
  const [receiverRelation, setReceiverRelation] = useState<'SELF' | 'AUTHORIZED_REPRESENTATIVE' | 'FAMILY_MEMBER' | 'COURIER' | 'OTHER'>('SELF');

  const isExistingOfficeStaff =
    Boolean(record?.recommendingStaffName) ||
    record?.submittedDocument === 'Office Staff Recommendation' ||
    isRecommenderDoc(record?.submittedDocument);

  const [submittedDocument, setSubmittedDocument] = useState<string>(
    isExistingOfficeStaff ? 'Office Staff Recommendation' : (record?.submittedDocument || 'Original Smart Card')
  );
  const [recommendingStaffName, setRecommendingStaffName] = useState<string>(
    cleanStaffRecommenderName(record?.recommendingStaffName) ||
      (isExistingOfficeStaff ? cleanStaffRecommenderName(record?.submittedDocument) : '')
  );
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!record) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAlreadyDistributed) {
      setError('✓ LICENSE ALREADY DISTRIBUTED: Redistribution or overwriting is strictly disabled.');
      return;
    }
    if (!receiverName || !receiverNid || !receiverPhone) {
      setError('Please provide Receiver Name, National ID / Passport, and Contact Phone number.');
      return;
    }
    if (submittedDocument === 'Office Staff Recommendation' && !recommendingStaffName.trim()) {
      setError('Please enter the recommending office staff name.');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const cleanStaff = cleanStaffRecommenderName(recommendingStaffName);
      const finalDocName =
        submittedDocument === 'Office Staff Recommendation' && cleanStaff
          ? formatRecommenderDoc(cleanStaff)
          : submittedDocument;
      const finalStaffName =
        submittedDocument === 'Office Staff Recommendation' ? (cleanStaff || undefined) : undefined;

      const res = await api.distributeRecord(record.id, {
        receiverName,
        receiverNid,
        receiverPhone,
        receiverRelation,
        remarks,
        office: record.office,
        submittedDocument: finalDocName,
        recommendingStaffName: finalStaffName,
      });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('plsms:record-updated', { detail: { record: res.record } }));
      }

      saveInputHistory('receiver_name', receiverName);
      saveInputHistory('receiver_nid', receiverNid);
      saveInputHistory('receiver_phone', receiverPhone);
      if (recommendingStaffName) saveInputHistory('recommending_staff', recommendingStaffName);
      if (remarks) saveInputHistory('handover_remarks', remarks);

      onSuccess(res.record);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record distribution handover');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white dark:bg-[#0c1427] rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="p-6 bg-emerald-700 dark:bg-emerald-800 text-white flex items-center justify-between border-b border-emerald-800 dark:border-emerald-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white backdrop-blur-sm">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-emerald-200 uppercase tracking-wider block">
                Physical Card Handover
              </span>
              <h3 className="text-base font-bold text-white">Record License Distribution</h3>
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

        {/* License Summary Banner */}
        <div className="bg-emerald-50/80 dark:bg-[#0c2420] px-6 py-3 border-b border-emerald-200/80 dark:border-emerald-800/40 flex items-center justify-between text-xs">
          <div>
            <span className="text-slate-600 dark:text-emerald-300/80 font-semibold">
              {record.licenseNumber ? 'License:' : 'Applicant ID:'}
            </span>{' '}
            <span className="font-bold text-slate-900 dark:text-white font-mono">
              {record.licenseNumber || record.applicantId || record.applicationNumber || 'N/A'}
            </span>
          </div>
          <div>
            <span className="text-slate-600 dark:text-emerald-300/80 font-semibold">Holder:</span>{' '}
            <span className="font-bold text-slate-900 dark:text-white">{record.holderName}</span>
          </div>
          <div>
            <span className="text-slate-600 dark:text-emerald-300/80 font-semibold">Office:</span>{' '}
            <span className="font-bold text-slate-900 dark:text-white">{record.office}</span>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 bg-white dark:bg-[#0c1427]">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-500/50 text-red-800 dark:text-red-200 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Relationship to Holder
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { id: 'SELF', label: 'Self (Applicant)' },
                { id: 'AUTHORIZED_REPRESENTATIVE', label: 'Authorized Rep' },
                { id: 'FAMILY_MEMBER', label: 'Family Member' },
                { id: 'COURIER', label: 'Official Courier' },
                { id: 'OTHER', label: 'Other' },
              ].map((rel) => (
                <button
                  key={rel.id}
                  type="button"
                  onClick={() => {
                    setReceiverRelation(rel.id as any);
                    if (rel.id === 'SELF') {
                      setReceiverName(record.holderName);
                      setReceiverNid(record.nidOrPassport || '');
                      setReceiverPhone(record.phone || '');
                    }
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                    receiverRelation === rel.id
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-white dark:bg-[#101b33] text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-[#162444]'
                  }`}
                >
                  {rel.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Receiver Full Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 z-10" />
              <HistoryInput
                historyKey="receiver_name"
                required
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder="Receiver name..."
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-[#101b33] border border-slate-300 dark:border-slate-700/80 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Receiver National ID / Passport
              </label>
              <div className="relative">
                <CreditCard className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 z-10" />
                <HistoryInput
                  historyKey="receiver_nid"
                  required
                  value={receiverNid}
                  onChange={(e) => setReceiverNid(e.target.value)}
                  placeholder="e.g. 198926925..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-[#101b33] border border-slate-300 dark:border-slate-700/80 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Receiver Contact Phone
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 z-10" />
                <HistoryInput
                  historyKey="receiver_phone"
                  type="tel"
                  required
                  value={receiverPhone}
                  onChange={(e) => setReceiverPhone(e.target.value)}
                  placeholder="017XXXXXXXX"
                  className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-[#101b33] border border-slate-300 dark:border-slate-700/80 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 font-mono"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Submitted Document (बुझाएको कागजात)
            </label>
            <select
              value={submittedDocument}
              onChange={(e) => setSubmittedDocument(e.target.value)}
              className="w-full px-4 py-2.5 bg-white dark:bg-[#101b33] border border-slate-300 dark:border-slate-700/80 rounded-xl text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="Original Smart Card">Original Smart Card</option>
              <option value="Payment Receipt Bill">Payment Receipt Bill</option>
              <option value="Citizenship">Citizenship</option>
              <option value="Traffic Police Letter">Traffic Police Letter</option>
              <option value="Office Staff Recommendation">Office Staff Recommendation</option>
            </select>

            {submittedDocument === 'Office Staff Recommendation' && (
              <div className="mt-2.5">
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                  सिफारिस गर्ने कर्मचारीको नाम (Office Staff Name) *
                </label>
                <HistoryInput
                  historyKey="recommending_staff"
                  required
                  value={recommendingStaffName}
                  onChange={(e) => setRecommendingStaffName(e.target.value)}
                  placeholder="e.g. Ramesh Shrestha"
                  className="w-full px-3.5 py-2 bg-white dark:bg-[#101b33] border border-slate-300 dark:border-slate-700/80 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Handover Status / Token Reference (Optional)
            </label>
            <div className="relative">
              <FileText className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 z-10" />
              <HistoryInput
                historyKey="handover_remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Verified original application slip and signature"
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-[#101b33] border border-slate-300 dark:border-slate-700/80 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="p-4 bg-slate-50/90 dark:bg-[#101b33] border border-slate-200 dark:border-slate-700/80 rounded-2xl text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
            <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Official Handover Acknowledgement
            </p>
            <p>
              By confirming, this license record status will permanently change to <strong className="text-slate-900 dark:text-slate-100">DISTRIBUTED</strong> with an immutable cryptographic timestamp and audit reference.
            </p>
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
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Confirm Handover & Issue Slip
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
