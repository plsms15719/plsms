import React, { useState, useEffect } from 'react';
import { FileText, X, Loader2, UserCheck } from 'lucide-react';
import { LicenseRecord } from '../../types';
import { api } from '../../services/api';
import { isRecommenderDoc, cleanStaffRecommenderName, formatRecommenderDoc } from '../../utils/staffUtils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  record: LicenseRecord;
  onSaved: (updatedRecord: LicenseRecord) => void;
}

export const SUBMITTED_DOCUMENT_OPTIONS = [
  'Original Smart Card',
  'Payment Receipt Bill',
  'Citizenship',
  'Traffic Police Letter',
  'Office Staff Recommendation',
] as const;

export type SubmittedDocumentType = (typeof SUBMITTED_DOCUMENT_OPTIONS)[number];

export const SubmittedDocumentsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  record,
  onSaved,
}) => {
  const [selectedDoc, setSelectedDoc] = useState<string>(
    record.submittedDocument || ''
  );
  const [staffName, setStaffName] = useState<string>(
    cleanStaffRecommenderName(record.recommendingStaffName) || ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const isOfficeStaff =
        Boolean(record.recommendingStaffName) ||
        isRecommenderDoc(record.submittedDocument);

      if (isOfficeStaff) {
        setSelectedDoc('Office Staff Recommendation');
        setStaffName(
          cleanStaffRecommenderName(record.recommendingStaffName) ||
            cleanStaffRecommenderName(record.submittedDocument)
        );
      } else {
        setSelectedDoc(record.submittedDocument || '');
        setStaffName('');
      }
      setError(null);
    }
  }, [isOpen, record]);

  if (!isOpen) return null;

  const isSaveEnabled =
    Boolean(selectedDoc) &&
    (selectedDoc !== 'Office Staff Recommendation' || Boolean(staffName.trim()));

  const handleSave = async () => {
    if (!selectedDoc) {
      setError('कृपया बुझाइएको कागजात छान्नुहोस् (Please select a submitted document option).');
      return;
    }

    if (selectedDoc === 'Office Staff Recommendation' && !staffName.trim()) {
      setError('कृपया सिफारिस गर्ने कार्यालयका कर्मचारीको नाम लेख्नुहोस् (Please enter the recommending office staff name).');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const cleanStaff = cleanStaffRecommenderName(staffName);
      const finalDocName =
        selectedDoc === 'Office Staff Recommendation' ? formatRecommenderDoc(cleanStaff) : selectedDoc;
      const finalStaffName =
        selectedDoc === 'Office Staff Recommendation' ? cleanStaff : undefined;

      const res = await api.updateSubmittedDocument(
        record.id,
        finalDocName,
        finalStaffName
      );
      if (res && res.record) {
        onSaved(res.record);
        onClose();
      }
    } catch (err: any) {
      console.error('Failed to save submitted document:', err);
      setError(err.message || 'Failed to save submitted document.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-white dark:bg-[#0D1829] border-2 border-slate-300 dark:border-[#1e2f4d] rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white relative"
        role="dialog"
        aria-modal="true"
      >
        {/* Header Row (Icon + Title + Close button) */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#13233c] border-2 border-slate-300 dark:border-[#1e355c] flex items-center justify-center text-slate-700 dark:text-slate-200">
              <FileText className="w-5 h-5 text-slate-700 dark:text-slate-200" />
            </div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
              Submitted Documents
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-[#1b2b45] dark:hover:bg-[#25395a] text-slate-600 hover:text-black dark:text-slate-300 dark:hover:text-white flex items-center justify-center transition-colors focus:outline-none cursor-pointer border-2 border-slate-300 dark:border-slate-700"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Subtitle */}
        <div>
          <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-bold">
            Select document submitted by the receiver.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-100 dark:bg-red-950/90 border border-red-300 dark:border-red-500/60 rounded-xl text-xs text-red-900 dark:text-red-300 font-bold animate-in fade-in duration-150">
            {error}
          </div>
        )}

        {/* Option Cards */}
        <div className="space-y-3 pt-1">
          {SUBMITTED_DOCUMENT_OPTIONS.map((option) => {
            const isSelected = selectedDoc === option;
            const isOfficeStaff = option === 'Office Staff Recommendation';

            return (
              <div
                key={option}
                className={`w-full rounded-2xl border transition-all ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-[#10223D] border-blue-500 dark:border-[#3B82F6] ring-1 ring-blue-500/50 dark:ring-[#3B82F6]/50 shadow-md'
                    : 'bg-white dark:bg-[#081120] border-slate-200 dark:border-[#182a47] hover:bg-slate-50 dark:hover:bg-[#0c192e] shadow-xs'
                }`}
              >
                {/* Main Option Row */}
                <div
                  onClick={() => {
                    setSelectedDoc(option);
                    setError(null);
                  }}
                  className="w-full p-4 flex items-center gap-3.5 cursor-pointer select-none"
                >
                  {/* Radio button indicator (Matching exact picture style) */}
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center transition-all shrink-0 ${
                      isSelected
                        ? 'border-2 border-blue-600 dark:border-white bg-transparent'
                        : 'border-2 border-slate-400 dark:border-slate-500 bg-transparent'
                    }`}
                  >
                    {isSelected && (
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-600 dark:bg-white shadow-sm" />
                    )}
                  </div>

                  {/* Option Text */}
                  <span className="text-sm font-black text-slate-900 dark:text-white tracking-wide flex-1">
                    {option}
                  </span>
                </div>

                {/* Text box just below Office Staff Recommendation when selected */}
                {isOfficeStaff && isSelected && (
                  <div className="px-4 pb-4 pt-1 animate-in fade-in slide-in-from-top-1 duration-200 space-y-2 border-t border-slate-200 dark:border-[#1e375e]/80">
                    <label className="block text-[11px] font-black text-slate-800 dark:text-slate-300 uppercase tracking-wider">
                      सिफारिस गर्ने कर्मचारीको नाम (Office Staff Name) *
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        autoFocus
                        value={staffName}
                        onChange={(e) => {
                          setStaffName(e.target.value);
                          setError(null);
                        }}
                        placeholder="सिफारिस गर्ने कर्मचारीको नाम लेख्नुहोस् (e.g. Ramesh Shrestha)..."
                        className="w-full px-4 py-2.5 bg-white dark:bg-[#040914] border border-slate-300 dark:border-[#25426e] focus:border-blue-600 rounded-xl text-xs font-bold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-600 shadow-inner"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer Actions (CANCEL and SAVE buttons) */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-[#1a2942]">
          {/* CANCEL */}
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-800 dark:bg-[#1F2F47] dark:hover:bg-[#2A3F60] dark:active:bg-[#162337] dark:text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all active:scale-[0.98] cursor-pointer"
          >
            CANCEL
          </button>

          {/* SAVE */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isSaveEnabled}
            className={`px-8 py-2.5 font-black text-xs uppercase tracking-wider rounded-xl transition-all active:scale-[0.98] flex items-center gap-2 ${
              isSaveEnabled
                ? 'bg-[#2563EB] hover:bg-[#1D4ED8] active:bg-[#1E40AF] text-white shadow-lg shadow-blue-600/30 cursor-pointer'
                : 'bg-slate-100 dark:bg-[#1b2b45] text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700/60 cursor-not-allowed font-black shadow-xs'
            }`}
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>SAVING...</span>
              </>
            ) : (
              <span>SAVE</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
