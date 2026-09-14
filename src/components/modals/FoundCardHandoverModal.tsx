import React, { useState, useEffect } from 'react';
import { X, AlertCircle, RefreshCw, PhoneCall, CheckCircle2 } from 'lucide-react';
import { LicenseRecord } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, isSuperAdminUser } from '../../utils/permissions';
import { api } from '../../services/api';
import { getNepaliDate, formatDistributedDateBS } from '../../utils/dateUtils';
import { HistoryInput, saveInputHistory } from '../common/HistoryInput';
import { cleanStaffRecommenderName, formatRecommenderDoc } from '../../utils/staffUtils';

interface Props {
  record: LicenseRecord | null;
  onClose: () => void;
  onSuccess: (updatedRecord: LicenseRecord) => void;
}

interface HandoverSuccessData {
  licenseNumber: string;
  cardHolderName: string;
  applicantId: string;
  receiverName: string;
  submittedDocument: string;
  distributedDate: string;
  distributedBy: string;
}

export const FoundCardHandoverModal: React.FC<Props> = ({ record, onClose, onSuccess }) => {
  const { user } = useAuth();
  const isSuperAdmin = isSuperAdminUser(user);
  const canVerify =
    hasPermission(user, 'found.verify') ||
    hasPermission(user, 'records.unmark_missing') ||
    hasPermission(user, 'records.distribute') ||
    isSuperAdmin;

  // By mandate: By default, make the options in the list unselected first in the dialogbox
  const [submittedDocument, setSubmittedDocument] = useState<string>('');
  const [recommendingStaffName, setRecommendingStaffName] = useState<string>('');
  const [receiverName, setReceiverName] = useState<string>('');
  const [contactMobile, setContactMobile] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successData, setSuccessData] = useState<HandoverSuccessData | null>(null);

  // Nepali Calendar BS Date calculation
  const [foundDate, setFoundDate] = useState<string>('');

  useEffect(() => {
    if (record) {
      // Default receiver name to holder name or existing receiver
      const defaultReceiver =
        record.holderName ||
        record.receiverName ||
        record.receivedBy ||
        record.rawRecord?.['FULL NAME'] ||
        record.rawRecord?.['APPLICANT NAME'] ||
        record.rawRecord?.['DISTRIBUTED TO'] ||
        record.rawRecord?.['DISRTIBUTED TO'] ||
        '';
      setReceiverName(defaultReceiver);

      // Found Date resolution
      const rawFoundDate =
        record.foundDate ||
        record.rawRecord?.['FOUND DATE'] ||
        record.rawRecord?.['FOUND_DATE'] ||
        record.rawRecord?.['Found Date'] ||
        (record.foundReportedAt ? formatDistributedDateBS(record.foundReportedAt) : '') ||
        getNepaliDate(new Date());
      setFoundDate(rawFoundDate);

      // Contact mobile resolution
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

      // MANDATE: By default, make the options in the list unselected first in the dialogbox
      setSubmittedDocument('');
      setRecommendingStaffName('');
      setSuccessData(null);
      setError('');
    }
  }, [record]);

  if (!record) return null;

  // Field display values matching Picture 2
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
    record.distributedBy ||
    user?.name ||
    'KOMAL DAHAL';

  const documentOptions = [
    'Original Smart Card',
    'Payment Receipt Bill',
    'Citizenship',
    'Traffic Police Letter',
    'Office Staff Recommendation',
  ];

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!canVerify) {
      setError('Access Denied: You do not have permission to record card handover (records.distribute / found.verify required).');
      return;
    }
    if (!receiverName.trim()) {
      setError('Please provide Receiver Name (बुझिलिनेको नाम).');
      return;
    }
    if (!submittedDocument) {
      setError('Please select document submitted by the receiver before handover.');
      return;
    }
    if (submittedDocument === 'Office Staff Recommendation' && !recommendingStaffName.trim()) {
      setError('Please enter the recommending office staff name.');
      return;
    }

    const cleanMobile = contactMobile.trim().replace(/\D/g, '');

    try {
      setLoading(true);
      setError('');

      const cleanStaff = cleanStaffRecommenderName(recommendingStaffName);
      const finalSubmittedDoc =
        submittedDocument === 'Office Staff Recommendation' && cleanStaff
          ? formatRecommenderDoc(cleanStaff)
          : submittedDocument;

      let updatedRecord: LicenseRecord;

      // Primary: Call distributeRecord API to perform official handover
      try {
        const res = await api.distributeRecord(record.id, {
          receiverName: receiverName.trim(),
          receiverNid: record.nidOrPassport || 'SELF_VERIFIED',
          receiverPhone: cleanMobile || record.phone || 'SELF_VERIFIED',
          receiverRelation: 'SELF',
          remarks: `Handover of found card against document: ${finalSubmittedDoc}`,
          office: record.office,
          submittedDocument: finalSubmittedDoc,
          recommendingStaffName: submittedDocument === 'Office Staff Recommendation' ? cleanStaff : undefined,
          isFoundHandover: true,
        } as any);
        updatedRecord = res.record;
      } catch (distErr: any) {
        // Fallback: update status to DISTRIBUTED directly via updateStatus endpoint
        const fallbackRes = await api.updateStatus(record.id, {
          status: 'DISTRIBUTED',
          reason: `Handover of found card against document: ${finalSubmittedDoc}. Received by: ${receiverName.trim()}`,
          submittedDocument: finalSubmittedDoc,
          recommendingStaffName: submittedDocument === 'Office Staff Recommendation' ? cleanStaff : undefined,
          receiverName: receiverName.trim(),
          foundBy: foundByText,
          phone: cleanMobile || record.phone || undefined,
          contactMobile: cleanMobile || record.phone || undefined,
          foundHandoverDone: true,
          isFoundHandover: true,
        } as any);
        updatedRecord = fallbackRes.record;
      }

      // Broadcast update event across all windows/listeners
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('plsms:record-updated', {
            detail: { record: updatedRecord, type: 'DISTRIBUTED' },
          })
        );
      }

      saveInputHistory('receiver_name', receiverName.trim());
      if (recommendingStaffName.trim()) {
        saveInputHistory('recommending_staff', recommendingStaffName.trim());
      }

      // MANDATE: Immediately notify parent so 'FOUND CARDS' table's 'HANDOVER' button immediately turns into 'DISTRIBUTED'
      onSuccess(updatedRecord);

      // MANDATE: Immediately show a very beautiful Handover message with content matching icon in rectangular dialogbox in floating feature with 'CLOSE' button
      setSuccessData({
        licenseNumber: licenseNumberDisplay,
        cardHolderName: cardHolderNameDisplay,
        applicantId: applicantIdDisplay,
        receiverName: receiverName.trim(),
        submittedDocument: finalSubmittedDoc,
        distributedDate: updatedRecord.distributedDate || updatedRecord.foundDate || getNepaliDate(new Date()),
        distributedBy: user?.name || foundByText,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to record card handover.');
    } finally {
      setLoading(false);
    }
  };

  // MANDATE: Disable the action button 'Handover/Distribute Card' until the office staffs select any one of the list items
  const isDocumentSelected = Boolean(submittedDocument && submittedDocument.trim());
  const isSubmitDisabled =
    !canVerify ||
    loading ||
    !isDocumentSelected ||
    !receiverName.trim() ||
    (submittedDocument === 'Office Staff Recommendation' && !recommendingStaffName.trim());

  // MANDATE: Floating Handover Message Dialog with content matching icon and 'CLOSE' button
  if (successData) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-200">
        {/* Wide horizontal rectangular dialogbox per UI rules */}
        <div className="w-full max-w-2xl sm:max-w-[700px] bg-white dark:bg-[#0c1a30] text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl border-2 border-emerald-500/60 overflow-hidden flex flex-col relative font-sans animate-in zoom-in-95 duration-200">
          
          {/* Top official banner */}
          <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 px-6 py-3.5 text-white flex items-center justify-between shadow-xs shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-200 animate-ping shrink-0" />
              <span className="text-[11px] font-extrabold tracking-widest uppercase font-mono text-emerald-100">
                PLSMS OFFICIAL HANDOVER CONFIRMATION
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              title="Close Dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Dialog Body */}
          <div className="p-6 sm:p-7 flex flex-col gap-5">
            {/* Header with content matching icon: distributing cards in hand */}
            <div className="flex items-start gap-4 sm:gap-5">
              {/* Custom detailed SVG: distributing cards in hand */}
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border-2 border-emerald-500/60 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-600/15">
                <svg
                  className="w-10 h-10 sm:w-12 sm:h-12 text-emerald-600 dark:text-emerald-400"
                  viewBox="0 0 48 48"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  {/* Smart License Card in handover motion */}
                  <rect
                    x="10"
                    y="7"
                    width="28"
                    height="18"
                    rx="3"
                    fill="currentColor"
                    fillOpacity="0.16"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Gold EMV Chip */}
                  <rect x="14" y="12" width="6" height="5" rx="1" fill="#F59E0B" />
                  {/* Card text lines */}
                  <path d="M23 13H33M23 16H29" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  {/* Distributing Hand (Office Staff) presenting / extending card */}
                  <path
                    d="M4 33C8 32 13 32 17 31C21 30 25 28 28 26C30 24.5 33 22 35 21C36.5 20 38.5 20.5 39 22C39.5 23.5 38 25.5 35.5 28L31 33C28 35.5 24 37 19 38L4 40"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Receiving Hand receiving card underneath */}
                  <path
                    d="M26 36L32 38C36 39.5 40 38.5 44 36"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Verification green checkmark badge */}
                  <circle cx="38" cy="11" r="6.5" fill="#10B981" />
                  <path
                    d="M35.2 11.2L37.2 13.2L41 9.2"
                    stroke="white"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              {/* Title & Subtitle */}
              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-[11px] font-black uppercase tracking-wider mb-1">
                  <span>✓ STATUS: DISTRIBUTED</span>
                </div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight leading-snug">
                  Found Smart Card Handed Over Successfully!
                </h3>
                <p className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 mt-0.5">
                  The found smart driving license has been officially handed over and permanently recorded in the PLSMS registry.
                </p>
              </div>
            </div>

            {/* Handover Details Cards in wide horizontal rectangular layout */}
            <div className="bg-slate-50 dark:bg-[#071326] border border-slate-200 dark:border-[#182c50] rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs sm:text-[13px]">
              <div>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  License Number (लाइसेन्स नं.)
                </span>
                <span className="font-mono font-black text-slate-900 dark:text-white text-sm sm:text-base text-sky-700 dark:text-[#00E5FF]">
                  {successData.licenseNumber}
                </span>
              </div>

              <div>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Card Holder Name (नाम)
                </span>
                <span className="font-black text-slate-900 dark:text-white text-sm">
                  {successData.cardHolderName}
                </span>
              </div>

              <div>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Handed Over To / Receiver (बुझिलिने)
                </span>
                <span className="font-black text-emerald-700 dark:text-emerald-300 text-sm">
                  {successData.receiverName}
                </span>
              </div>

              <div>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Submitted Document (पेश कागजात)
                </span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {successData.submittedDocument}
                </span>
              </div>

              <div>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Handover Date (हस्तान्तरण मिति)
                </span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {successData.distributedDate} (BS)
                </span>
              </div>

              <div>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Handed Over By (हस्तान्तरण कर्ता)
                </span>
                <span className="font-bold text-slate-800 dark:text-slate-200 uppercase">
                  {successData.distributedBy}
                </span>
              </div>
            </div>

            {/* Floating Footer with Prominent 'CLOSE' button */}
            <div className="flex items-center justify-end pt-2 border-t border-slate-200 dark:border-[#182c50]">
              <button
                type="button"
                onClick={onClose}
                className="px-8 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-[#1e293b] dark:hover:bg-[#283b5c] font-black text-xs sm:text-sm tracking-wider uppercase transition-all shadow-md active:scale-95 cursor-pointer"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
      {/* Wide horizontal rectangular popup card matching Picture 2 */}
      <div className="w-full max-w-[820px] max-h-[94vh] bg-white dark:bg-[#0c1a30] text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl border-2 border-slate-300 dark:border-[#1e345e] overflow-hidden flex flex-col relative font-sans">
        
        {/* Header matching Picture 2: Renamed to 'Confirm To Handover Found Card' */}
        <div className="pt-4 px-6 pb-2.5 border-b border-slate-200 dark:border-[#182c50] flex items-start justify-between shrink-0 bg-slate-50/50 dark:bg-[#071326]/50">
          <div>
            <span className="text-[11px] font-bold text-sky-600 dark:text-[#00E5FF] tracking-wider uppercase font-mono block mb-0.5">
              PLSMS REGISTRY ACTION
            </span>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
              Confirm To Handover Found Card
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

        {/* Form Content matching Picture 2 */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col justify-between">
          <div>
            {!canVerify && (
              <div className="mb-3.5 p-3 bg-rose-50 dark:bg-rose-950/60 border-2 border-rose-300 dark:border-rose-500/50 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span className="font-semibold">
                  Access Denied: You do not have permission to distribute or verify cards.
                </span>
              </div>
            )}

            {error && (
              <div className="mb-3.5 p-3 bg-red-50 dark:bg-red-950/60 border-2 border-red-300 dark:border-red-500/50 rounded-xl text-xs text-red-800 dark:text-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Horizontal 2-Column Grid Layout matching Picture 2 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              
              {/* Left Column: CARD HOLDER'S DETAILS */}
              <div className="bg-slate-50/90 dark:bg-[#071326] border-2 border-slate-300 dark:border-[#182c50] rounded-xl p-3.5 space-y-2 text-xs shadow-xs">
                <div className="flex items-center justify-between pb-0.5 border-b border-slate-200 dark:border-[#182c50]">
                  <label className="block text-[11px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                    CARD HOLDER&apos;S DETAILS
                  </label>
                </div>

                {/* 1. License Number */}
                <div className="flex items-center justify-between py-1 border-b border-slate-200 dark:border-[#12223f]/80">
                  <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                    LICENSE NUMBER:
                  </span>
                  <span className="font-mono font-black text-sky-700 dark:text-[#00E5FF] text-xs sm:text-sm">
                    {licenseNumberDisplay}
                  </span>
                </div>

                {/* 2. Card Holder Name */}
                <div className="flex items-center justify-between py-1 border-b border-slate-200 dark:border-[#12223f]/80">
                  <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                    CARD HOLDER NAME:
                  </span>
                  <span className="font-black text-slate-900 dark:text-white text-xs sm:text-[13px] uppercase">
                    {cardHolderNameDisplay}
                  </span>
                </div>

                {/* 3. Applicant ID */}
                <div className="flex items-center justify-between py-1 border-b border-slate-200 dark:border-[#12223f]/80">
                  <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                    APPLICANT ID:
                  </span>
                  <span className="font-mono font-black text-slate-900 dark:text-white text-xs sm:text-sm">
                    {applicantIdDisplay}
                  </span>
                </div>

                {/* 4. Found Date */}
                <div className="flex items-center justify-between py-1 border-b border-slate-200 dark:border-[#12223f]/80">
                  <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                    FOUND DATE:
                  </span>
                  <span className="font-mono font-black text-slate-900 dark:text-white text-xs sm:text-sm">
                    {foundDate || '---'}
                  </span>
                </div>

                {/* 5. Mobile Number */}
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

                {/* 6. Found By */}
                <div className="flex items-center justify-between py-1">
                  <span className="text-[11px] font-black tracking-wide text-slate-700 dark:text-slate-200 uppercase">
                    FOUND BY:
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-[13px] truncate max-w-[180px] sm:max-w-[210px] uppercase">
                    {foundByText}
                  </span>
                </div>
              </div>

              {/* Right Column: SELECT DOCUMENT SUBMITTED BY THE RECEIVER */}
              <div className="bg-slate-50/90 dark:bg-[#071326] border-2 border-slate-300 dark:border-[#182c50] rounded-xl p-3.5 space-y-2.5 shadow-xs flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[11px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                    SELECT DOCUMENT SUBMITTED BY THE RECEIVER. <span className="text-red-500 font-bold">*</span>
                  </label>
                  {submittedDocument && (
                    <button
                      type="button"
                      onClick={() => setSubmittedDocument('')}
                      className="text-[10px] font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white uppercase tracking-wider underline cursor-pointer shrink-0"
                    >
                      Deselect Option
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  {documentOptions.map((doc) => {
                    const isSelected = submittedDocument === doc;
                    return (
                      <button
                        key={doc}
                        type="button"
                        onClick={() => setSubmittedDocument((prev) => (prev === doc ? '' : doc))}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-sky-50 dark:bg-[#0f284e] border-sky-500 dark:border-sky-400 text-sky-950 dark:text-white shadow-xs ring-1 ring-sky-500/40 font-bold'
                            : 'bg-white dark:bg-[#08162d] border-slate-200 dark:border-[#182e54] text-slate-800 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-[#0c1f3d]'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                            isSelected
                              ? 'border-sky-600 dark:border-sky-400 bg-transparent'
                              : 'border-slate-400 dark:border-slate-500 bg-transparent'
                          }`}
                        >
                          {isSelected && (
                            <div className="w-2 h-2 rounded-full bg-sky-600 dark:bg-white" />
                          )}
                        </div>
                        <span className="text-xs sm:text-[12.5px]">{doc}</span>
                      </button>
                    );
                  })}
                </div>

                {submittedDocument === 'Office Staff Recommendation' && (
                  <div className="pt-2 animate-in fade-in duration-200 border-t border-slate-200 dark:border-[#182c50]/80 mt-1">
                    <label className="block text-[11px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">
                      OFFICE STAFF NAME <span className="text-red-500 font-bold">*</span>
                    </label>
                    <HistoryInput
                      historyKey="recommending_staff"
                      required
                      value={recommendingStaffName}
                      onChange={(e) => setRecommendingStaffName(e.target.value)}
                      placeholder="Enter recommending office staff name"
                      className="w-full px-3.5 py-2 bg-white dark:bg-[#071326] border border-blue-400 dark:border-blue-500 focus:border-blue-600 focus:ring-1 focus:ring-blue-500 rounded-xl text-slate-900 dark:text-white text-xs sm:text-[13px] font-bold outline-none transition-all placeholder:text-slate-400"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Section: Receiver's Name on Left, Action Buttons of Picture 3 on Right */}
          <div className="pt-3.5 mt-3 border-t border-slate-200 dark:border-[#182c50] flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-3 shrink-0">
            {/* Receiver Name with inner clear 'X' button matching Picture 2 */}
            <div className="flex-1 space-y-1">
              <label className="block text-[11px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                RECEIVER&apos;S NAME <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={receiverName}
                  onChange={(e) => setReceiverName(e.target.value)}
                  placeholder="Full name of receiver"
                  className="w-full pl-3.5 pr-8 py-2.5 bg-white dark:bg-[#071326] border border-slate-300 dark:border-[#1c335a] focus:border-sky-500 focus:ring-1 focus:ring-sky-500 rounded-xl text-slate-900 dark:text-white text-xs sm:text-[13px] font-bold outline-none transition-all placeholder:text-slate-400 uppercase"
                />
                {receiverName && (
                  <button
                    type="button"
                    onClick={() => setReceiverName('')}
                    title="Clear Name"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Action Buttons of Picture 3 at the end of card */}
            <div className="flex items-center gap-2.5 shrink-0 justify-end">
              {/* Handover / Distribute Card Button: Disabled until office staff selects an option */}
              <button
                type="submit"
                disabled={isSubmitDisabled}
                title={
                  !isDocumentSelected
                    ? 'Please select any one of the list items to enable handover'
                    : !receiverName.trim()
                    ? 'Please provide receiver name'
                    : (submittedDocument === 'Office Staff Recommendation' && !recommendingStaffName.trim())
                    ? 'Please provide recommending office staff name'
                    : undefined
                }
                className={`px-5 sm:px-6 py-2.5 rounded-2xl font-bold text-xs sm:text-[13px] transition-all shadow-md flex items-center gap-2 h-[42px] select-none ${
                  isSubmitDisabled
                    ? 'bg-emerald-600/40 dark:bg-emerald-800/40 text-white/50 cursor-not-allowed shadow-none border border-emerald-500/20'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/30 cursor-pointer active:scale-95'
                }`}
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-white" />
                )}
                <span className="whitespace-nowrap">Handover / Distribute Card</span>
              </button>

              {/* Close Button matching Picture 3 */}
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white dark:bg-[#1e293b] dark:hover:bg-[#283b5c] font-bold text-xs sm:text-[13px] transition-all cursor-pointer active:scale-95 h-[42px] whitespace-nowrap"
              >
                Close
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
