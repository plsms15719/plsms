import React from 'react';
import { X, Shield, Calendar, MapPin, User, Phone, CreditCard, Clock, FileText, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import { LicenseRecord } from '../../types';
import { formatDistributedDateBS, isDistributedSameDay, canDisplayMissingButton } from '../../utils/dateUtils';
import { resolveRecordStaff, resolveSubmittedDocument, resolveSearchedByStaff } from '../../utils/staffUtils';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../utils/permissions';

interface Props {
  record: LicenseRecord | null;
  onClose: () => void;
  onDistribute: (record: LicenseRecord) => void;
  onMarkMissing: (record: LicenseRecord) => void;
}

export const LicenseDetailModal: React.FC<Props> = ({
  record,
  onClose,
  onDistribute,
  onMarkMissing,
}) => {
  const { user } = useAuth();
  const canDistribute = hasPermission(user, 'records.distribute');
  const canMarkMissing = hasPermission(user, 'records.mark_missing') || hasPermission(user, 'records.search_mark_missing');

  if (!record) return null;

  const holderNameDisplay =
    record.holderName ||
    record.rawRecord?.['FULL NAME'] ||
    record.rawRecord?.['APPLICANT NAME'] ||
    'N/A';

  const applicationNumberDisplay =
    record.applicationNumber ||
    record.applicantId ||
    (record as any).tokenNo ||
    record.rawRecord?.['APPLICANT ID'] ||
    'Not Recorded';

  const licenseNumberDisplay =
    record.licenseNumber ||
    record.rawRecord?.['LICENSE NUMBER'] ||
    (applicationNumberDisplay !== 'Not Recorded' ? `APP ID: ${applicationNumberDisplay}` : 'N/A');

  const nidOrPassportDisplay =
    record.nidOrPassport ||
    record.rawRecord?.['CITIZENSHIP NO'] ||
    record.rawRecord?.['NID'] ||
    record.rawRecord?.['PASSPORT'] ||
    'Not Recorded';

  const phoneDisplay =
    record.phone ||
    record.mobileNumber ||
    (record as any).mobile ||
    (record as any).contactNumber ||
    record.rawRecord?.['MOBILE NUMBER'] ||
    record.rawRecord?.['PHONE'] ||
    'Not Recorded';

  const officeDisplay =
    record.office ||
    record.department ||
    record.rawRecord?.['DEPARTMENT'] ||
    record.rawRecord?.['OFFICE'] ||
    "कार्ड वितरण शाखा - 'क'";

  const licenseTypeDisplay =
    record.licenseType ||
    (record.category ? 'Smart Card License' : 'Smart Card License');

  const smartCardSerialDisplay =
    record.smartCardSerial ||
    record.rawRecord?.['SERIAL NO'] ||
    record.sn ||
    record.rawRecord?.['S.N.'] ||
    'N/A';

  const issueDateDisplay =
    record.issueDate ||
    record.rawRecord?.['ISSUE DATE'] ||
    'N/A';

  const expiryDateDisplay =
    record.expiryDate ||
    record.rawRecord?.['EXPIRY DATE'] ||
    'N/A';

  const missingDateDisplay =
    record.missingDate ||
    record.rawRecord?.['MISSING DATE'] ||
    record.rawRecord?.['MISSING_DATE'] ||
    record.rawRecord?.['Missing Date'] ||
    (record.missingReportedAt ? formatDistributedDateBS(record.missingReportedAt) : '');

  const foundDateDisplay =
    record.foundDate ||
    record.rawRecord?.['FOUND DATE'] ||
    record.rawRecord?.['FOUND_DATE'] ||
    record.rawRecord?.['Found Date'] ||
    (record.foundReportedAt ? formatDistributedDateBS(record.foundReportedAt) : '');

  const submittedDocDisplay = resolveSubmittedDocument(record);
  const distributedByDisplay = resolveRecordStaff(record);
  const distributedToDisplay =
    record.distributedTo ||
    record.receiverName ||
    record.receivedBy ||
    record.rawRecord?.['DISTRIBUTED TO'] ||
    record.rawRecord?.['DISRTIBUTED TO'] ||
    '';
  const distributedDateDisplay =
    record.distributedDate ||
    record.rawRecord?.['DISTRIBUTED DATE'] ||
    record.rawRecord?.['DISTRIBUTED_DATE'] ||
    (record.distributedAt ? formatDistributedDateBS(record.distributedAt) : '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-[#0c1427] rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 text-slate-900 dark:text-slate-100">
        {/* Modal Header */}
        <div className="p-6 bg-slate-900 dark:bg-[#070d19] text-white flex items-center justify-between border-b border-slate-800 dark:border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider block">
                Master License Record
              </span>
              <h3 className="text-lg font-bold text-white font-mono">{licenseNumberDisplay}</h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                record.status === 'AVAILABLE'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                  : record.status === 'DISTRIBUTED'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                  : record.status === 'MISSING'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
                  : record.status === 'FOUND'
                  ? 'bg-purple-600 text-white border border-purple-400 shadow-sm'
                  : 'bg-slate-700 text-slate-300'
              }`}
            >
              {record.status}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800/80 rounded-lg transition-colors ml-2 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 bg-white dark:bg-[#0c1427] text-slate-800 dark:text-slate-100">
          {/* Holder Main Info */}
          <div className="bg-slate-50/90 dark:bg-[#101b33] border border-slate-200 dark:border-slate-700/80 rounded-2xl p-4.5 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-xs">
            <div>
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Applicant / Holder Name
              </span>
              <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white block mt-0.5 uppercase">
                {holderNameDisplay}
              </span>
            </div>

            <div>
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Application / Token No
              </span>
              <span className="text-sm sm:text-base font-bold text-blue-700 dark:text-[#22D3EE] block mt-0.5 font-mono">
                {applicationNumberDisplay}
              </span>
            </div>

            <div>
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                National ID / Passport No
              </span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 block mt-0.5 font-mono">
                {nidOrPassportDisplay}
              </span>
            </div>

            <div>
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Contact Phone
              </span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 block mt-0.5">
                {phoneDisplay}
              </span>
            </div>
          </div>

          {/* Logistics & Issuing Details */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-white dark:bg-[#101b33] border border-slate-200 dark:border-slate-700/80 rounded-xl shadow-xs">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Issuing / Pickup Office
              </span>
              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mt-1 block">
                {officeDisplay}
              </span>
            </div>

            <div className="p-3.5 bg-white dark:bg-[#101b33] border border-slate-200 dark:border-slate-700/80 rounded-xl shadow-xs">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                License Category
              </span>
              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mt-1 block">
                {licenseTypeDisplay}
              </span>
            </div>

            <div className="p-3.5 bg-white dark:bg-[#101b33] border border-slate-200 dark:border-slate-700/80 rounded-xl shadow-xs">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Smart Card Serial
              </span>
              <span className="text-xs sm:text-sm font-bold text-blue-700 dark:text-[#22D3EE] mt-1 block font-mono">
                {smartCardSerialDisplay}
              </span>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 bg-white dark:bg-[#101b33] border border-slate-200 dark:border-slate-700/80 rounded-xl shadow-xs">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Issue Date
              </span>
              <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 block font-mono">
                {issueDateDisplay}
              </span>
            </div>

            <div className="p-3.5 bg-white dark:bg-[#101b33] border border-slate-200 dark:border-slate-700/80 rounded-xl shadow-xs">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                Expiry Date
              </span>
              <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 block font-mono">
                {expiryDateDisplay}
              </span>
            </div>
          </div>

          {/* Found Smart Card Recovery & Handover Details (Imported from FOUND CARDS table) */}
          {(record.status === 'FOUND' || Boolean(missingDateDisplay) || Boolean(foundDateDisplay) || Boolean(distributedDateDisplay) || (submittedDocDisplay && submittedDocDisplay !== 'Original Smart Card')) && (
            <div className="bg-purple-50/70 dark:bg-[#14122b] border border-purple-200 dark:border-purple-500/40 rounded-2xl p-4.5 space-y-3 shadow-xs">
              <div className="flex items-center gap-2 text-purple-900 dark:text-purple-300 font-bold text-xs uppercase tracking-wider">
                <CheckCircle2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                Found Smart Card & Handover Record (फेला परेको तथा हस्तान्तरण विवरण)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium block text-[11px]">
                    Missing Date (हराएको मिति):
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white font-mono mt-0.5 block">
                    {missingDateDisplay || '---'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium block text-[11px]">
                    Found Date (फेला परेको मिति):
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white font-mono mt-0.5 block">
                    {foundDateDisplay || '---'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium block text-[11px]">
                    Submitted Document (कागजात):
                  </span>
                  <span className="font-bold text-indigo-700 dark:text-indigo-300 mt-0.5 block">
                    {submittedDocDisplay}
                  </span>
                </div>
              </div>

              {(distributedByDisplay !== '---' || distributedToDisplay || distributedDateDisplay) && (
                <div className="pt-2.5 border-t border-purple-200/60 dark:border-purple-900/60 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-600 dark:text-slate-400 font-medium block text-[11px]">
                      Distributed By (कर्मचारी):
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white mt-0.5 block uppercase">
                      {distributedByDisplay}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600 dark:text-slate-400 font-medium block text-[11px]">
                      Distributed To (बुझिलिने):
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white mt-0.5 block uppercase">
                      {distributedToDisplay || holderNameDisplay || '---'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-600 dark:text-slate-400 font-medium block text-[11px]">
                      Distribution Date (वितरण मिति):
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white font-mono mt-0.5 block">
                      {distributedDateDisplay || '---'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Distribution Details if Distributed */}
          {record.status === 'DISTRIBUTED' && (
            <div className="bg-blue-50/70 dark:bg-[#0d1d36] border border-blue-200 dark:border-blue-500/40 rounded-2xl p-4.5 space-y-3 shadow-xs">
              <div className="flex items-center gap-2 text-blue-900 dark:text-[#38BDF8] font-bold text-xs uppercase tracking-wider">
                <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-[#38BDF8]" />
                Handover & Receiver Acknowledgement
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Receiver Name:</span>{' '}
                  <span className="font-bold text-slate-900 dark:text-white">{record.receiverName || record.distributedTo}</span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Receiver NID:</span>{' '}
                  <span className="font-bold text-slate-900 dark:text-white font-mono">{record.receiverNid || '---'}</span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Relationship:</span>{' '}
                  <span className="font-bold text-slate-900 dark:text-white">{record.receiverRelation || 'Self (Applicant)'}</span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Handover Ref:</span>{' '}
                  <span className="font-bold text-blue-700 dark:text-[#38BDF8] font-mono">{record.handoverReference || '---'}</span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Distributed On:</span>{' '}
                  <span className="font-bold text-slate-900 dark:text-white">
                    {record.distributedDate || (record.distributedAt ? formatDistributedDateBS(record.distributedAt) : '<N/A>')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Submitted Document:</span>{' '}
                  <span className="font-bold text-indigo-700 dark:text-indigo-300">
                    {submittedDocDisplay}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Distributed By:</span>{' '}
                  <span className="font-bold text-slate-900 dark:text-white">{distributedByDisplay}</span>
                </div>
              </div>
              {record.receiverRemarks && (
                <div className="text-xs pt-1.5 border-t border-blue-200/60 dark:border-blue-900/60">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">Status:</span>{' '}
                  <span className="text-slate-900 dark:text-slate-200">{record.receiverRemarks}</span>
                </div>
              )}
            </div>
          )}

          {/* Missing Triage Info if Flagged Missing */}
          {record.status === 'MISSING' && (
            <div className="bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/40 rounded-2xl p-4.5 space-y-2 shadow-xs">
              <div className="flex items-center gap-2 text-amber-900 dark:text-amber-300 font-bold text-xs uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Missing License Incident Report
              </div>
              <p className="text-xs text-amber-950 dark:text-amber-100">
                <span className="font-semibold">Reason:</span> {record.missingReason || 'Missing during physical count'}
              </p>
              <div className="text-[11px] text-amber-800 dark:text-amber-300 flex gap-4">
                <span>Reported On: {record.missingReportedAt ? new Date(record.missingReportedAt).toLocaleString() : 'N/A'}</span>
                <span>Officer: {resolveSearchedByStaff(record)}</span>
              </div>
            </div>
          )}

          {/* Metadata & Import Origin */}
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
            <span>Import Job ID: {record.importId || 'GS_SYNC_MASTER'}</span>
            <span>Imported: {record.importedAt ? new Date(record.importedAt).toLocaleDateString() : new Date().toLocaleDateString()}</span>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 bg-slate-100 dark:bg-[#070d19] border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {canMarkMissing && record.status !== 'MISSING' && (record.status !== 'DISTRIBUTED' || isDistributedSameDay(record)) && canDisplayMissingButton(record) && (
              <button
                onClick={() => onMarkMissing(record)}
                className="px-3.5 py-2 bg-red-100 hover:bg-red-200 text-red-900 dark:bg-red-950/70 dark:hover:bg-red-900/80 dark:text-red-200 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 border border-red-300/80 dark:border-red-800/80 cursor-pointer"
                title={record.status === 'DISTRIBUTED' ? 'Report this Distributed Card as Missing (Permitted strictly up to 11:59 PM midnight of Nepali Calendar date)' : 'Flag as Missing'}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-red-700 dark:text-red-400" />
                Flag as Missing
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canDistribute && (
              <button
                onClick={() => onDistribute(record)}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                Handover / Distribute Card
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors border border-black/20 dark:border-slate-700 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
