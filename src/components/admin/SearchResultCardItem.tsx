import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Check,
  Shield,
  ShieldCheck,
  Lock,
  Pencil,
  FileText,
  RefreshCw,
  AlertOctagon,
  Save,
  RotateCcw,
  X,
} from 'lucide-react';
import { HistoryInput, saveInputHistory } from '../common/HistoryInput';
import { SubmittedDocumentsModal } from '../modals/SubmittedDocumentsModal';
import { ReportMissingModal } from '../modals/ReportMissingModal';
import { ConfirmFoundModal } from '../modals/ConfirmFoundModal';
import { FoundCardHandoverModal } from '../modals/FoundCardHandoverModal';
import { api } from '../../services/api';
import { LicenseRecord } from '../../types';
import { getRecordCodeParts } from '../../utils/codeUtils';
import {
  resolveSubmittedDocument,
  isRecommenderDoc,
  cleanStaffRecommenderName,
  formatRecommenderDoc,
} from '../../utils/staffUtils';
import {
  formatDistributedDateBS,
  isDistributedSameDay,
  canDisplayMissingButton,
} from '../../utils/dateUtils';
import { hasPermission } from '../../utils/permissions';

interface SearchResultCardItemProps {
  record: LicenseRecord;
  index: number;
  totalCards: number;
  isSelected: boolean;
  onSelect: () => void;
  onRecordUpdated: (updatedRecord: LicenseRecord) => void;
  onRequestDriverName: (
    record: LicenseRecord,
    target: 'STANDARD' | 'EDIT_MODE',
    setReceiverFn: (name: string) => void
  ) => void;
  user: any;
  isSuperAdmin: boolean;
  canDistribute: boolean;
  canResetDistribution: boolean;
  canMarkMissing: boolean;
  canUnmarkMissing: boolean;
  onHandoverSaved: (savedRecord: LicenseRecord, receiverName: string) => void;
  setSaveSuccessMsg: (msg: string | null) => void;
  setLastActionRecord: (record: LicenseRecord) => void;
  setLastActionType: (type: 'MISSING' | 'FOUND' | 'RESET' | 'EDIT' | 'GENERAL') => void;
  loadStats: () => void;
}

function resolveDistributedTo(rec: LicenseRecord): string {
  const raw =
    (rec.distributedTo && typeof rec.distributedTo === 'string' ? rec.distributedTo.trim() : '') ||
    (rec.receiverName && typeof rec.receiverName === 'string' ? rec.receiverName.trim() : '') ||
    (rec.receivedBy && typeof rec.receivedBy === 'string' ? rec.receivedBy.trim() : '') ||
    (rec.rawRecord?.['DISTRIBUTED TO'] ? String(rec.rawRecord['DISTRIBUTED TO']).trim() : '') ||
    (rec.rawRecord?.['Distributed To'] ? String(rec.rawRecord['Distributed To']).trim() : '') ||
    (rec.rawRecord?.['DISRTIBUTED TO'] ? String(rec.rawRecord['DISRTIBUTED TO']).trim() : '') ||
    (rec.rawRecord?.['Disrtibuted To'] ? String(rec.rawRecord['Disrtibuted To']).trim() : '') ||
    (rec.rawRecord?.['DISTRIBUTED_TO'] ? String(rec.rawRecord['DISTRIBUTED_TO']).trim() : '') ||
    (rec.rawRecord?.['Distributed_To'] ? String(rec.rawRecord['Distributed_To']).trim() : '') ||
    (rec.rawRecord?.['RECEIVER NAME'] ? String(rec.rawRecord['RECEIVER NAME']).trim() : '') ||
    (rec.rawRecord?.['Receiver Name'] ? String(rec.rawRecord['Receiver Name']).trim() : '') ||
    (rec.rawRecord?.['RECEIVER'] ? String(rec.rawRecord['RECEIVER']).trim() : '') ||
    (rec.rawRecord?.['Receiver'] ? String(rec.rawRecord['Receiver']).trim() : '') ||
    (rec.rawRecord?.['RECEIVED BY'] ? String(rec.rawRecord['RECEIVED BY']).trim() : '') ||
    (rec.rawRecord?.['Received By'] ? String(rec.rawRecord['Received By']).trim() : '') ||
    (rec.rawRecord?.['received_by'] ? String(rec.rawRecord['received_by']).trim() : '') ||
    (rec.rawRecord?.['बुझिलिनेको नाम'] ? String(rec.rawRecord['बुझिलिनेको नाम']).trim() : '') ||
    (rec.rawRecord?.['बुझिलिने'] ? String(rec.rawRecord['बुझिलिने']).trim() : '');

  const upper = raw.toUpperCase();
  if (
    !raw ||
    upper === '-' ||
    upper === '--' ||
    upper === '---' ||
    upper === 'NULL' ||
    upper === 'UNDEFINED' ||
    upper === 'N/A' ||
    upper === 'NA' ||
    upper === '<N/A>'
  ) {
    return '<N/A>';
  }
  return raw;
}

export const SearchResultCardItem: React.FC<SearchResultCardItemProps> = ({
  record,
  index,
  totalCards,
  isSelected,
  onSelect,
  onRecordUpdated,
  onRequestDriverName,
  user,
  isSuperAdmin,
  canDistribute,
  canResetDistribution,
  canMarkMissing,
  canUnmarkMissing,
  onHandoverSaved,
  setSaveSuccessMsg,
  setLastActionRecord,
  setLastActionType,
  loadStats,
}) => {
  // Handover state
  const [receiverName, setReceiverName] = useState('');
  const [savingHandover, setSavingHandover] = useState(false);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  // Super Admin Edit Mode state
  const [isSuperAdminEditMode, setIsSuperAdminEditMode] = useState(false);
  const [editReceiverName, setEditReceiverName] = useState('');
  const [editSubmittedDoc, setEditSubmittedDoc] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Modals
  const [showDocModal, setShowDocModal] = useState(false);
  const [showMissingModal, setShowMissingModal] = useState(false);
  const [showFoundModal, setShowFoundModal] = useState(false);
  const [showFoundHandoverModal, setShowFoundHandoverModal] = useState(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [isResettingDistribution, setIsResettingDistribution] = useState(false);

  // Office staff permission check for unmarking missing / verifying found cards
  const effectiveCanUnmark =
    canUnmarkMissing ||
    isSuperAdmin ||
    hasPermission(user, 'records.unmark_missing') ||
    hasPermission(user, 'found.verify');

  const canHandover =
    canDistribute ||
    isSuperAdmin ||
    hasPermission(user, 'records.distribute') ||
    hasPermission(user, 'found.verify');

  // Reset or initialize input fields when record changes
  useEffect(() => {
    setReceiverName('');
    setEditReceiverName((record.receiverName || record.receivedBy || '').toUpperCase());
    setEditSubmittedDoc(record.submittedDocument || '');
    setIsSuperAdminEditMode(false);
    setSaveErrorMsg(null);
  }, [record.id]);

  // Helper to check if Column I (RECEIVED BY) is already populated or was previously distributed
  const isDistributed = (rec: LicenseRecord): boolean => {
    return Boolean(
      rec.isDistributed ||
      (rec.receivedBy && rec.receivedBy.trim().length > 0 && rec.receivedBy !== '-' && rec.receivedBy !== '---' && rec.receivedBy !== '<N/A>') ||
      (rec.receiverName && rec.receiverName.trim().length > 0 && rec.receiverName !== '-' && rec.receiverName !== '---' && rec.receiverName !== '<N/A>') ||
      (rec.distributedDate && rec.distributedDate.trim().length > 0 && rec.distributedDate !== '-' && rec.distributedDate !== '---' && rec.distributedDate !== '<N/A>') ||
      (rec as any).wasDistributed ||
      rec.status === 'DISTRIBUTED' ||
      (rec.status === 'FOUND' && Boolean(rec.foundHandoverDone))
    );
  };

  const alreadyHandedOver = isDistributed(record);

  // Check if record is currently Missing
  const isMissing = Boolean(
    record.status === 'MISSING' ||
    record.issueFlag === 'MISSING' ||
    record.rawRecord?.['MISSING'] === 'MISSING' ||
    record.rawRecord?.['STATUS'] === 'MISSING' ||
    record.missingReason ||
    record.missingDate
  ) && !Boolean(record.foundDate || record.foundReason || record.status === 'FOUND');

  // Check if record is currently Found (and not yet handed over)
  const isFound = Boolean(
    record.status === 'FOUND' ||
    (record.issueFlag as any) === 'FOUND' ||
    record.foundDate ||
    record.foundReportedAt ||
    record.foundReason ||
    record.rawRecord?.['FOUND'] === 'FOUND' ||
    record.rawRecord?.['STATUS'] === 'FOUND'
  ) && !Boolean(record.foundHandoverDone || record.rawRecord?.['FOUND_HANDOVER'] === 'DONE');

  // Check if handover is completed
  const isHandedOver = Boolean(
    record.foundHandoverDone === true ||
    record.rawRecord?.['FOUND_HANDOVER'] === 'DONE' ||
    (!isMissing && !isFound && (alreadyHandedOver || record.status === 'DISTRIBUTED' || record.isDistributed))
  );

  const showDistributedSection = alreadyHandedOver || isMissing || isFound || isHandedOver;
  const isCodeUnlocked = isSuperAdmin || showDistributedSection;

  // Helper to extract category cleanly (e.g. K, A, B, etc.)
  const getCategoryDisplay = (rec: LicenseRecord) => {
    if (rec.vehicleClass && rec.vehicleClass.trim()) {
      return rec.vehicleClass.trim();
    }
    if (rec.licenseType && rec.licenseType.trim() && rec.licenseType !== 'Smart Card') {
      return rec.licenseType.trim();
    }
    return 'K';
  };

  // Helper to extract Codes in format '<old code>/<new code>' from OLD CODE / NEW CODE columns
  const getCodesParts = (rec: LicenseRecord): { oldPart: string; newPart: string } => {
    const parts = getRecordCodeParts(rec);
    return {
      oldPart: parts.oldPart,
      newPart: parts.newPart,
    };
  };

  // Resolve Department display for Department Confirmation Modal & Metric Cards directly from Database Record
  const resolveDepartmentDisplay = (rec: LicenseRecord): string => {
    const rawDept = String(
      rec.department ||
      rec.office ||
      rec.rawRecord?.['DEPARTMENT'] ||
      rec.rawRecord?.['OFFICE'] ||
      ''
    ).trim();

    if (!rawDept) return "कार्ड वितरण शाखा - 'क'";

    const isKha = Boolean(
      /(?:शाखा|branch|department|dept)\s*[-–—:]*\s*['"‘’“”]?\s*ख['"‘’“”]?/i.test(rawDept) ||
      rawDept.includes("'ख'") ||
      rawDept.includes('"ख"') ||
      rawDept.includes('‘ख’') ||
      rawDept.includes('“ख”') ||
      /[-–—:]\s*['"‘’“”]?\s*ख/i.test(rawDept) ||
      /(?:^|\s)ख\s*(?:$|['"‘’“”]?)/i.test(rawDept) ||
      /\b(?:branch|dept|department)\s*[-–—:]*\s*b\b/i.test(rawDept) ||
      /\b(?:branch|dept|department)\s*[-–—:]*\s*kha\b/i.test(rawDept) ||
      /\bkha\b/i.test(rawDept)
    );

    const isKa = Boolean(
      /(?:शाखा|branch|department|dept)\s*[-–—:]*\s*['"‘’“”]?\s*क['"‘’“”]?/i.test(rawDept) ||
      rawDept.includes("'क'") ||
      rawDept.includes('"क"') ||
      rawDept.includes('‘क’') ||
      rawDept.includes('“क”') ||
      /[-–—:]\s*['"‘’“”]?\s*क/i.test(rawDept) ||
      /(?:^|\s)क\s*(?:$|['"‘’“”]?)/i.test(rawDept) ||
      /\b(?:branch|dept|department)\s*[-–—:]*\s*a\b/i.test(rawDept) ||
      /\b(?:branch|dept|department)\s*[-–—:]*\s*ka\b/i.test(rawDept) ||
      /\bka\b/i.test(rawDept)
    );

    if (isKha && !isKa) {
      if (rawDept.includes('कार्ड वितरण शाखा')) return rawDept;
      return "कार्ड वितरण शाखा - 'ख'";
    }

    if (isKa && !isKha) {
      if (rawDept.includes('कार्ड वितरण शाखा')) return rawDept;
      return "कार्ड वितरण शाखा - 'क'";
    }

    return rawDept || "कार्ड वितरण शाखा - 'क'";
  };

  const handleUseDriverName = () => {
    onRequestDriverName(record, 'STANDARD', (name) => {
      setReceiverName(name);
      setSaveErrorMsg(null);
    });
  };

  const handleEditUseDriverName = () => {
    onRequestDriverName(record, 'EDIT_MODE', (name) => {
      setEditReceiverName(name.toUpperCase());
      setSaveErrorMsg(null);
    });
  };

  const handleResetReceiver = () => {
    setReceiverName('');
    setSaveErrorMsg(null);
  };

  const handleSaveHandover = async () => {
    if (!record.submittedDocument) {
      setSaveErrorMsg(
        'कृपया पहिले "Submitted Documents" बटन थिचेर बुझाइएको कागजात अनिवार्य रूपमा छान्नुहोस् (Please select submitted document first - Compulsory).'
      );
      setShowDocModal(true);
      return;
    }
    if (!receiverName.trim()) {
      setSaveErrorMsg('कृपया बुझिलिने व्यक्तिको नाम लेख्नुहोस् (Please enter receiver name).');
      return;
    }

    try {
      setSavingHandover(true);
      setSaveErrorMsg(null);

      const cleanStaff = record.recommendingStaffName?.trim()
        ? cleanStaffRecommenderName(record.recommendingStaffName)
        : (isRecommenderDoc(record.submittedDocument)
            ? cleanStaffRecommenderName(record.submittedDocument)
            : undefined);
      const finalDocName = cleanStaff
        ? formatRecommenderDoc(cleanStaff)
        : record.submittedDocument;
      const finalStaffName = cleanStaff || undefined;

      const res = await api.distributeRecord(record.id, {
        receiverName: receiverName.trim(),
        receiverNid: record.nidOrPassport || 'SELF_VERIFIED',
        receiverPhone: record.phone || 'SELF_VERIFIED',
        receiverRelation:
          receiverName.trim().toUpperCase() === (record.holderName || '').trim().toUpperCase()
            ? 'SELF'
            : 'AUTHORIZED_REPRESENTATIVE',
        remarks: 'Direct single-card handover logged from Search terminal',
        office: record.office,
        submittedDocument: finalDocName,
        recommendingStaffName: finalStaffName,
      });

      if (res && res.record) {
        saveInputHistory('receiver_name', receiverName.trim());
        onRecordUpdated(res.record);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('plsms:record-updated', { detail: { record: res.record, records: (res as any).records || (res as any).updatedRecords || [res.record] } })
          );
        }
        onHandoverSaved(res.record, receiverName.trim());
        loadStats();
      }
    } catch (err: any) {
      console.error('Save handover failed:', err);
      setSaveErrorMsg(err.message || 'Failed to save handover.');
    } finally {
      setSavingHandover(false);
    }
  };

  // Super Admin Action: Reset Distribution to un-distribute record completely
  const handleConfirmResetDistribution = async () => {
    setIsResettingDistribution(true);
    setSaveErrorMsg(null);
    try {
      const res = await api.resetDistribution(record.id);
      if (res && res.record) {
        setReceiverName('');
        setEditReceiverName('');
        setShowResetConfirmModal(false);
        setIsSuperAdminEditMode(false);
        onRecordUpdated(res.record);
        setLastActionRecord(res.record);
        setLastActionType('RESET');
        setSaveSuccessMsg(
          '✓ हस्तान्तरण विवरण पूर्ण रूपमा रिसेट गरियो। लाइसेन्स अब पुनः वितरण योग्य भयो र Google Sheet मा पनि खाली भयो।'
        );
        loadStats();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('plsms:record-updated', { detail: { record: res.record } })
          );
        }
      }
    } catch (err: any) {
      console.error('Reset distribution failed:', err);
      setSaveErrorMsg(err.message || 'वितरण विवरण रिसेट गर्न सकिएन।');
    } finally {
      setIsResettingDistribution(false);
    }
  };

  // Super Admin Action: Save edited recipient name & document immediately to database & Google Sheet
  const handleSaveEditedDistribution = async () => {
    if (!editReceiverName.trim()) {
      setSaveErrorMsg('कृपया बुझिलिने व्यक्तिको नाम लेख्नुहोस्। (Recipient name is required)');
      return;
    }
    setIsSavingEdit(true);
    setSaveErrorMsg(null);
    try {
      const cleanReceiver = editReceiverName.trim().toUpperCase();
      const targetDoc = editSubmittedDoc || record.submittedDocument;
      let finalEditedDoc = targetDoc;
      if (isRecommenderDoc(targetDoc) || record.recommendingStaffName) {
        const staff =
          cleanStaffRecommenderName(record.recommendingStaffName) ||
          cleanStaffRecommenderName(targetDoc);
        if (staff) {
          finalEditedDoc = formatRecommenderDoc(staff);
        }
      }
      const res = await api.updateDistribution(record.id, {
        receiverName: cleanReceiver,
        submittedDocument: finalEditedDoc,
      });
      if (res && res.record) {
        setIsSuperAdminEditMode(false);
        onRecordUpdated(res.record);
        setLastActionRecord(res.record);
        setLastActionType('EDIT');
        setSaveSuccessMsg(
          '✓ विवरण सफलतापूर्वक सच्याइयो र सुरक्षित गरियो। Database र Google Sheet मा तत्काल प्रतिस्थापन भयो।'
        );
        loadStats();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('plsms:record-updated', { detail: { record: res.record } })
          );
        }
      }
    } catch (err: any) {
      console.error('Save edited distribution failed:', err);
      setSaveErrorMsg(err.message || 'वितरण विवरण सच्याउन सकिएन।');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const isLatestCopy =
    index === 0 &&
    totalCards > 1 &&
    (!alreadyHandedOver || (record.sheetRow && Number(record.sheetRow) > 1));

  return (
    <div
      id={`search-result-card-${index}`}
      onClick={onSelect}
      className={`bg-white dark:bg-[#0B1528] rounded-2xl p-4 sm:p-5 border-2 ${
        isSelected
          ? 'border-blue-500 dark:border-blue-500 shadow-lg'
          : 'border-slate-300 dark:border-[#1e2d4a] shadow-md dark:shadow-2xl'
      } space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300 transition-all`}
    >
      {/* Top Header Row for Multi-Record Search (Card #1 of 2, etc.) */}
      {totalCards > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-[#1a2d4c] pb-3">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-blue-600 dark:bg-blue-500 text-white font-mono font-black text-xs shadow-xs">
              Card #{index + 1} of {totalCards}
            </span>
            {isLatestCopy && (
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 uppercase">
                ★ LATEST COPY
              </span>
            )}
            {record.sheetRow && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                (Row #{record.sheetRow})
              </span>
            )}
          </div>
          <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
            <span className="font-bold text-slate-700 dark:text-slate-200">
              {record.licenseNumber || record.applicantId || '---'}
            </span>
          </div>
        </div>
      )}

      {/* Error Message (if any) */}
      {saveErrorMsg && (
        <div className="bg-red-50 dark:bg-red-950/80 border-2 border-red-400 dark:border-red-500/50 rounded-xl p-4 text-xs font-bold text-red-700 dark:text-red-300 flex items-center gap-2 animate-in fade-in duration-200">
          <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" />
          <span>{saveErrorMsg}</span>
        </div>
      )}

      {/* Header Status Indicator */}
      <div className="text-center">
        {showDistributedSection ? (
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-xl bg-rose-50 dark:bg-red-500/15 border-2 border-rose-300 dark:border-red-500/40 text-rose-700 dark:text-[#EF4444] text-sm sm:text-base font-black tracking-wider uppercase font-mono shadow-xs dark:shadow-lg dark:shadow-red-950/30">
            <CheckCircle2 className="w-4 h-4 text-rose-600 dark:text-[#EF4444]" />
            <span>✓ LICENSE ALREADY DISTRIBUTED</span>
          </div>
        ) : (
          <div className="inline-flex items-center justify-center gap-2 px-4 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border-2 border-emerald-400 dark:border-emerald-500/40 text-emerald-800 dark:text-[#10B981] text-sm sm:text-base font-black tracking-wider uppercase font-mono shadow-xs">
            <div className="w-5 h-5 rounded-full bg-[#10B981] flex items-center justify-center text-white shrink-0 shadow-xs">
              <Check className="w-3.5 h-3.5 stroke-[3.5] text-white" />
            </div>
            <span>Smart Card Found</span>
          </div>
        )}
      </div>

      {/* 6 Metric / Info Cards Grid (3 cols x 2 rows) - Clear Deep Borders & Attractive Colors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-3.5">
        {/* Card 1: APPLICANT ID */}
        <div className="bg-slate-50 dark:bg-[#070e1c] border-2 border-slate-300 dark:border-[#1e2f4d] rounded-xl p-3.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 shadow-xs dark:shadow-lg dark:shadow-black/40 hover:border-blue-500 dark:hover:border-[#2b4c80] hover:bg-blue-50/40 dark:hover:bg-[#0c1930] transition-all">
          <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide">
            APPLICANT ID
          </span>
          <span className="text-base sm:text-lg font-black text-blue-700 dark:text-[#22D3EE] font-mono tracking-tight">
            {record.applicantId || record.applicationNumber || '---'}
          </span>
        </div>

        {/* Card 2: FULL NAME */}
        <div className="bg-slate-50 dark:bg-[#070e1c] border-2 border-slate-300 dark:border-[#1e2f4d] rounded-xl p-3.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 shadow-xs dark:shadow-lg dark:shadow-black/40 hover:border-blue-500 dark:hover:border-[#2b4c80] hover:bg-blue-50/40 dark:hover:bg-[#0c1930] transition-all">
          <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide">
            FULL NAME
          </span>
          <span className="text-sm sm:text-base font-black text-blue-700 dark:text-[#22D3EE] font-sans uppercase tracking-wide">
            {record.holderName}
          </span>
        </div>

        {/* Card 3: LICENSE NUMBER */}
        <div className="bg-slate-50 dark:bg-[#070e1c] border-2 border-slate-300 dark:border-[#1e2f4d] rounded-xl p-3.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 shadow-xs dark:shadow-lg dark:shadow-black/40 hover:border-blue-500 dark:hover:border-[#2b4c80] hover:bg-blue-50/40 dark:hover:bg-[#0c1930] transition-all">
          <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide">
            LICENSE NUMBER
          </span>
          <span className="text-base sm:text-lg font-black text-blue-700 dark:text-[#22D3EE] font-mono tracking-tight">
            {record.licenseNumber || '---'}
          </span>
        </div>

        {/* Card 4: CATEGORY */}
        <div className="bg-slate-50 dark:bg-[#070e1c] border-2 border-slate-300 dark:border-[#1e2f4d] rounded-xl p-3.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 shadow-xs dark:shadow-lg dark:shadow-black/40 hover:border-blue-500 dark:hover:border-[#2b4c80] hover:bg-blue-50/40 dark:hover:bg-[#0c1930] transition-all">
          <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide">
            CATEGORY
          </span>
          <span className="text-base sm:text-lg font-black text-blue-700 dark:text-[#22D3EE] font-mono tracking-tight">
            {getCategoryDisplay(record)}
          </span>
        </div>

        {/* Card 5: CODE NO */}
        <div className="bg-slate-50 dark:bg-[#070e1c] border-2 border-slate-300 dark:border-[#1e2f4d] rounded-xl p-3.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 shadow-xs dark:shadow-lg dark:shadow-black/40 hover:border-blue-500 dark:hover:border-[#2b4c80] hover:bg-blue-50/40 dark:hover:bg-[#0c1930] transition-all">
          <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide">
            CODE NO
          </span>
          {isCodeUnlocked ? (
            (() => {
              const { oldPart, newPart } = getCodesParts(record);
              return (
                <span className="text-base sm:text-lg font-black font-mono tracking-tight inline-flex items-center justify-center gap-1 whitespace-nowrap">
                  <span className="text-base sm:text-lg font-black font-mono tracking-tight text-blue-700 dark:text-[#22D3EE]">
                    {oldPart}
                  </span>
                  <span className="text-base sm:text-lg font-black font-mono tracking-tight text-slate-500 dark:text-[#22D3EE]">
                    /
                  </span>
                  <span className="text-base sm:text-lg font-black font-mono tracking-tight text-red-600 dark:text-[#EF4444]">
                    {newPart}
                  </span>
                </span>
              );
            })()
          ) : (
            <span className="text-xs sm:text-sm font-extrabold font-mono tracking-wide text-slate-800 dark:text-slate-200 uppercase bg-slate-200/80 dark:bg-slate-800/80 px-2.5 py-0.5 rounded-lg border border-slate-300 dark:border-slate-700">
              LOCKED (SAVE REQUIRED)
            </span>
          )}
        </div>

        {/* Card 6: DEPARTMENT */}
        <div className="bg-slate-50 dark:bg-[#070e1c] border-2 border-slate-300 dark:border-[#1e2f4d] rounded-xl p-3.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 shadow-xs dark:shadow-lg dark:shadow-black/40 hover:border-blue-500 dark:hover:border-[#2b4c80] hover:bg-blue-50/40 dark:hover:bg-[#0c1930] transition-all">
          <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide">
            DEPARTMENT
          </span>
          <span className="text-xs sm:text-sm md:text-base font-black text-blue-700 dark:text-[#22D3EE] uppercase tracking-wide text-center leading-tight">
            {resolveDepartmentDisplay(record)}
          </span>
        </div>
      </div>

      {/* CONDITIONAL SECTION: IF ALREADY DISTRIBUTED vs NOT YET DISTRIBUTED */}
      {showDistributedSection ? (
        isSuperAdminEditMode ? (
          /* SUPER ADMIN EDIT MODE */
          <div className="bg-slate-50 dark:bg-[#030914] border-2 border-slate-300 dark:border-slate-700/80 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xl animate-in fade-in duration-150">
            {/* Burgundy Banner */}
            <div className="bg-rose-50 dark:bg-[#1c0b12] border-2 border-rose-300 dark:border-red-800/60 rounded-xl p-3 sm:p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-xs sm:text-sm">
                <Shield className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" />
                <span className="leading-snug">
                  <strong className="text-amber-700 dark:text-amber-400 font-bold font-mono">
                    SUPER ADMIN EDIT MODE:{' '}
                  </strong>
                  <span className="text-slate-800 dark:text-slate-100 font-medium">
                    बुझिलिने व्यक्तिको नाम (Recipient Name) सच्याउनुहोस् र पुनः{' '}
                  </span>
                  <strong className="text-amber-700 dark:text-amber-400 font-bold">
                    सुरक्षित (SAVE)
                  </strong>
                  <span className="text-slate-800 dark:text-slate-100 font-medium"> गर्नुहोस् ।</span>
                </span>
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  id={`btn-edit-mode-cancel-${index}`}
                  onClick={() => {
                    setIsSuperAdminEditMode(false);
                    setSaveErrorMsg(null);
                  }}
                  className="px-3 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-[#283d5a] dark:hover:bg-[#344d70] text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  रद्द (Cancel)
                </button>
                {canResetDistribution && (
                  <button
                    type="button"
                    id={`btn-edit-mode-undistribute-${index}`}
                    onClick={() => setShowResetConfirmModal(true)}
                    className="px-3 py-1 bg-red-100 hover:bg-red-200 dark:bg-[#450a0a] dark:hover:bg-[#581010] border-2 border-red-300 dark:border-red-800/80 text-red-800 dark:text-red-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    पूर्ण रिसेट (Un-distribute)
                  </button>
                )}
              </div>
            </div>

            {/* Instruction text */}
            <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 font-medium">
              लाइसेन्स लिन आउने वा बुझिलिने व्यक्तिको नाम तलको कोठामा लेख्नुहोस् र सुरक्षित गर्नुहोस् ।
            </p>

            {/* Wide Input Box */}
            <div className="w-full">
              <input
                type="text"
                id={`input-edit-recipient-name-${index}`}
                value={editReceiverName}
                onChange={(e) => {
                  setEditReceiverName(e.target.value.toUpperCase());
                  setSaveErrorMsg(null);
                }}
                placeholder="बुझिलिने व्यक्तिको नाम लेख्नुहोस्............"
                className="w-full px-4 py-3 bg-white dark:bg-[#0a1220] border-2 border-slate-300 dark:border-slate-700/90 focus:border-blue-600 dark:focus:border-blue-500 rounded-xl text-sm sm:text-base font-bold font-mono tracking-wide text-slate-900 dark:text-white uppercase focus:outline-none focus:ring-1 focus:ring-blue-600 dark:focus:ring-blue-500 transition-all shadow-xs dark:shadow-inner"
                autoFocus
              />
            </div>

            {/* Action Buttons Row */}
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                id={`btn-edit-clear-input-${index}`}
                onClick={() => setEditReceiverName('')}
                className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 dark:bg-[#283d5a] dark:hover:bg-[#344d70] text-slate-800 dark:text-white font-bold text-xs sm:text-sm rounded-xl border-2 border-slate-300 dark:border-slate-600/50 transition-all active:scale-98 cursor-pointer shadow-xs"
              >
                रिसेट (RESET) गर्नुहोस्
              </button>

              <button
                type="button"
                id={`btn-edit-use-driver-name-${index}`}
                onClick={handleEditUseDriverName}
                className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 dark:bg-[#283d5a] dark:hover:bg-[#344d70] text-slate-800 dark:text-white font-bold text-xs sm:text-sm rounded-xl border-2 border-slate-300 dark:border-slate-600/50 transition-all active:scale-98 cursor-pointer shadow-xs"
              >
                सवारी चालकको नाम प्रयोग गर्नुहोस्
              </button>

              <button
                type="button"
                id={`btn-edit-submitted-document-${index}`}
                onClick={() => setShowDocModal(true)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 dark:bg-[#1d4ed8] dark:hover:bg-[#2563eb] text-white font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 border border-blue-400/40 transition-all active:scale-98 cursor-pointer shadow-md"
                title={editSubmittedDoc || record.submittedDocument || 'Traffic Police License Letter'}
              >
                <FileText className="w-4 h-4 shrink-0" />
                <span className="truncate max-w-[220px]">
                  Submitted: {editSubmittedDoc || record.submittedDocument || 'Traffic Police License Letter'}
                </span>
              </button>

              <button
                type="button"
                id={`btn-edit-save-corrected-distribution-${index}`}
                onClick={handleSaveEditedDistribution}
                disabled={isSavingEdit}
                className="px-6 py-2.5 bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs sm:text-sm rounded-xl transition-all active:scale-98 cursor-pointer shadow-lg shadow-orange-950/40 disabled:opacity-50 flex items-center gap-2"
              >
                {isSavingEdit ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>सुरक्षित हुँदैछ...</span>
                  </>
                ) : (
                  <span>सच्याएर सुरक्षित (SAVE) गर्नुहोस्</span>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* READ-ONLY DISTRIBUTED DETAILS */
          <div className="bg-rose-50/40 dark:bg-[#070e1c] border-2 border-rose-300 dark:border-red-500/40 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xs dark:shadow-xl">
            <div className="flex items-center justify-between border-b-2 border-rose-200 dark:border-red-500/20 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-rose-100 dark:bg-red-500/15 border-2 border-rose-300 dark:border-red-500/30 flex items-center justify-center text-rose-700 dark:text-[#EF4444] shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-black text-rose-700 dark:text-[#EF4444] uppercase tracking-wider font-mono">
                    हस्तान्तरण विवरण (OFFICIAL DISTRIBUTION AUDIT DETAILS)
                  </h4>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 dark:bg-red-950/80 border-2 border-rose-300 dark:border-red-500/40 text-rose-800 dark:text-red-400 text-xs font-mono font-bold shrink-0">
                  <Lock className="w-3.5 h-3.5" />
                  <span>RECORD SEALED</span>
                </div>

                {canResetDistribution && (
                  <button
                    type="button"
                    id={`btn-super-admin-reset-distribution-${index}`}
                    onClick={() => {
                      const recName = (record.receiverName || record.receivedBy || '').toUpperCase();
                      setEditReceiverName(recName);
                      setEditSubmittedDoc(record.submittedDocument || 'Traffic Police License Letter');
                      setIsSuperAdminEditMode(true);
                      setSaveErrorMsg(null);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 hover:bg-rose-200 dark:bg-red-950/80 dark:hover:bg-red-900 border-2 border-rose-300 hover:border-rose-400 dark:border-red-500/40 dark:hover:border-red-400 text-rose-800 dark:text-red-400 hover:text-rose-900 dark:hover:text-red-200 text-xs font-mono font-bold transition-all shadow-xs active:scale-95 cursor-pointer shrink-0"
                    title="Reset Distribution Data (Super Admin: Edit recipient or un-distribute)"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>RESET</span>
                  </button>
                )}
              </div>
            </div>

            {/* 6 Details Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-3.5">
              {/* 1. SUBMITTED DOC. */}
              <div className="bg-white dark:bg-[#030914] border-2 border-slate-300 dark:border-[#1e2d4a] hover:border-slate-400 dark:hover:border-slate-600 rounded-xl p-3 sm:p-3.5 text-center flex flex-col justify-center items-center space-y-1.5 shadow-xs dark:shadow-inner transition-all">
                <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide block text-center">
                  SUBMITTED DOC.
                </span>
                <span className="text-xs sm:text-sm font-black text-emerald-800 dark:text-emerald-400 font-sans uppercase tracking-tight block text-center max-w-full">
                  {resolveSubmittedDocument(record)}
                </span>
              </div>

              {/* 2. DISTRIBUTED TO */}
              <div className="bg-white dark:bg-[#030914] border-2 border-slate-300 dark:border-[#1e2d4a] hover:border-slate-400 dark:hover:border-slate-600 rounded-xl p-3 sm:p-3.5 text-center flex flex-col justify-center items-center space-y-1.5 shadow-xs dark:shadow-inner transition-all">
                <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide block text-center">
                  DISTRIBUTED TO
                </span>
                <span className="text-xs sm:text-sm font-black text-emerald-800 dark:text-emerald-400 font-sans uppercase tracking-tight block text-center max-w-full">
                  {resolveDistributedTo(record)}
                </span>
              </div>

              {/* 3. DISTRIBUTED DATE */}
              <div className="bg-white dark:bg-[#030914] border-2 border-slate-300 dark:border-[#1e2d4a] hover:border-slate-400 dark:hover:border-slate-600 rounded-xl p-3 sm:p-3.5 text-center flex flex-col justify-center items-center space-y-1.5 shadow-xs dark:shadow-inner transition-all">
                <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide block text-center">
                  DISTRIBUTED DATE
                </span>
                <span className="text-xs sm:text-sm font-black text-emerald-800 dark:text-emerald-400 font-sans uppercase tracking-tight block text-center max-w-full font-mono">
                  {record.distributedDate || record.distributedAt
                    ? formatDistributedDateBS(record.distributedDate || record.distributedAt)
                    : '<N/A>'}
                </span>
              </div>

              {/* 4. DISTRIBUTED BY */}
              <div className="bg-white dark:bg-[#030914] border-2 border-slate-300 dark:border-[#1e2d4a] hover:border-slate-400 dark:hover:border-slate-600 rounded-xl p-3 sm:p-3.5 text-center flex flex-col justify-center items-center space-y-1.5 shadow-xs dark:shadow-inner transition-all">
                <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide block text-center">
                  DISTRIBUTED BY
                </span>
                <span className="text-xs sm:text-sm font-black text-emerald-800 dark:text-emerald-400 font-sans uppercase tracking-tight block text-center max-w-full">
                  {record.distributedBy || '<N/A>'}
                </span>
              </div>

              {/* 5. STATUS */}
              <div className="bg-white dark:bg-[#030914] border-2 border-slate-300 dark:border-[#1e2d4a] hover:border-slate-400 dark:hover:border-slate-600 rounded-xl p-3 sm:p-3.5 text-center flex flex-col justify-center items-center space-y-1.5 shadow-xs dark:shadow-inner @container transition-all">
                <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide block text-center">
                  STATUS
                </span>
                <div className="w-full flex items-center justify-center">
                  {(() => {
                    const isHandedOverDone = Boolean(
                      record.foundHandoverDone === true ||
                      record.rawRecord?.['FOUND_HANDOVER'] === 'DONE'
                    );
                    const isFoundCard = Boolean(
                      record.status === 'FOUND' ||
                      (record.issueFlag as any) === 'FOUND' ||
                      record.foundDate ||
                      record.foundReportedAt ||
                      record.foundReason ||
                      record.rawRecord?.['FOUND'] === 'FOUND' ||
                      record.rawRecord?.['STATUS'] === 'FOUND' ||
                      isHandedOverDone
                    );

                    if (isMissing) {
                      return (
                        <div className="inline-flex flex-row items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-red-50 dark:bg-[#2c0a0a] border-2 border-red-500 dark:border-red-500/50 text-red-800 dark:text-[#F87171] text-xs font-bold uppercase tracking-tight font-mono shadow-xs whitespace-nowrap">
                          <span className="w-2 h-2 rounded-full bg-red-600 dark:bg-[#F87171] animate-pulse shrink-0" />
                          <span>MISSING</span>
                        </div>
                      );
                    }

                    if (isFoundCard) {
                      return (
                        <div className="inline-flex flex-row items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-purple-50 dark:bg-[#25103a] border-2 border-purple-500 dark:border-purple-500/50 text-purple-800 dark:text-[#c084fc] text-xs font-bold uppercase tracking-tight font-mono shadow-xs whitespace-nowrap">
                          <span className="w-2 h-2 rounded-full bg-purple-600 dark:bg-purple-400 animate-pulse shrink-0" />
                          <span>FOUND</span>
                        </div>
                      );
                    }

                    return (
                      <div className="inline-flex flex-row items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 dark:bg-[#062c20] border-2 border-emerald-500 dark:border-emerald-500/50 text-emerald-800 dark:text-[#10B981] text-xs font-bold uppercase tracking-tight font-mono shadow-xs whitespace-nowrap">
                        <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-[#10B981] animate-pulse shrink-0" />
                        <span>DISTRIBUTED</span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* 6. ACTION */}
              <div className="bg-white dark:bg-[#030914] border-2 border-slate-300 dark:border-[#1e2d4a] hover:border-slate-400 dark:hover:border-slate-600 rounded-xl p-3 sm:p-3.5 text-center flex flex-col justify-center items-center space-y-1.5 shadow-xs dark:shadow-inner @container transition-all">
                <span className="text-xs sm:text-[13px] font-black font-sans text-slate-800 dark:text-slate-100 uppercase tracking-wide block text-center">
                  ACTION
                </span>
                <div className="w-full flex items-center justify-center">
                  {(() => {
                    const isHandedOverDone = Boolean(
                      record.foundHandoverDone === true ||
                      record.rawRecord?.['FOUND_HANDOVER'] === 'DONE'
                    );
                    const isFoundCard = Boolean(
                      record.status === 'FOUND' ||
                      (record.issueFlag as any) === 'FOUND' ||
                      record.foundDate ||
                      record.foundReportedAt ||
                      record.foundReason ||
                      record.rawRecord?.['FOUND'] === 'FOUND' ||
                      record.rawRecord?.['STATUS'] === 'FOUND' ||
                      isHandedOverDone
                    );

                    // 1. Missing card: ACTION: [current action] (Confirm found button or REPORTED MISSING)
                    if (isMissing) {
                      if (effectiveCanUnmark) {
                        return (
                          <button
                            type="button"
                            onClick={() => setShowFoundModal(true)}
                            className="px-3 py-1 bg-purple-600 hover:bg-purple-500 border border-purple-400 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer whitespace-nowrap"
                            title="Confirm Found Card"
                          >
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            <span>FOUND</span>
                          </button>
                        );
                      }
                      return (
                        <span className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-tight">
                          REPORTED MISSING
                        </span>
                      );
                    }

                    // 2. Found and handed over: ACTION: HANDED OVER
                    if (isFoundCard && isHandedOverDone) {
                      return (
                        <div className="inline-flex flex-row items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 dark:bg-[#062c20] border-2 border-emerald-500 dark:border-emerald-500/50 text-emerald-800 dark:text-[#10B981] text-xs font-bold uppercase tracking-tight font-mono shadow-xs whitespace-nowrap">
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-[#10B981] stroke-[2.5]" />
                          <span>HANDED OVER</span>
                        </div>
                      );
                    }

                    // 3. Found but not handed over: ACTION: [current action] (HAND OVER button or AWAITING HANDOVER)
                    if (isFoundCard) {
                      if (canHandover) {
                        return (
                          <button
                            type="button"
                            onClick={() => setShowFoundHandoverModal(true)}
                            className="inline-flex flex-row items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white border border-emerald-400/80 dark:border-emerald-500/50 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs whitespace-nowrap hover:shadow-md"
                            title="हराएको स्मार्ट कार्ड फेला परेपछि सेवाग्राहीलाई हस्तान्तरण गर्नुहोस् (Click to Hand Over Found Smart Card to Cardholder)"
                          >
                            <Check className="w-3.5 h-3.5 shrink-0 text-emerald-100" />
                            <span>HAND OVER</span>
                          </button>
                        );
                      }
                      return (
                        <span className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-tight">
                          AWAITING HANDOVER
                        </span>
                      );
                    }

                    // 4. Normal: ACTION: [normal action] (Report missing button if permitted same-day, or —)
                    if (
                      isDistributedSameDay(record) &&
                      canMarkMissing &&
                      canDisplayMissingButton(record)
                    ) {
                      return (
                        <button
                          type="button"
                          onClick={() => setShowMissingModal(true)}
                          className="inline-flex flex-row items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border-2 border-red-400 dark:bg-red-950/40 dark:hover:bg-red-900/60 dark:border-red-500/50 dark:hover:border-red-400 dark:text-red-400 dark:hover:text-red-200 text-xs font-bold font-mono transition-all cursor-pointer shadow-xs active:scale-95 whitespace-nowrap"
                          title="Report this Distributed Card as Missing (Permitted strictly up to 11:59 PM midnight of Nepali Calendar date)"
                        >
                          <AlertOctagon className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
                          <span>MISSING</span>
                        </button>
                      );
                    }

                    return (
                      <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 font-mono">
                        —
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        /* AVAILABLE / NOT YET DISTRIBUTED HANDOVER BOX */
        <div className="bg-slate-50/90 dark:bg-[#070e1c] border-2 border-slate-300 dark:border-[#17253d] rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xs dark:shadow-inner">
          <div className="flex flex-col sm:flex-row sm:items-center items-start gap-3">
            <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 font-bold shrink-0">
              लाइसेन्स लिन आउने वा बुझिलिने व्यक्तिको नाम दाँया कोठामा लेख्नुहोस् र सुरक्षित गर्नुहोस् ।
            </p>

            <div className="w-full sm:w-64 lg:w-72 shrink-0">
              <HistoryInput
                historyKey="receiver_name"
                value={receiverName}
                onChange={(e) => {
                  setReceiverName(e.target.value);
                  setSaveErrorMsg(null);
                }}
                placeholder="बुझिलिनेको नाम लेख्नुहोस्............"
                className="w-full px-3.5 py-2.5 bg-white dark:bg-[#030914] border-2 border-slate-300 dark:border-[#1e293b] focus:border-blue-600 rounded-xl text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-600 transition-all shadow-xs dark:shadow-inner"
              />
            </div>
          </div>

          {/* 4 Action Buttons Row */}
          <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
            {/* 1. रिसेट (RESET) गर्नुहोस् */}
            <button
              type="button"
              onClick={handleResetReceiver}
              className="px-5 py-3 bg-white dark:bg-[#1e293b] hover:bg-slate-100 dark:hover:bg-[#334155] text-slate-800 dark:text-slate-100 font-bold text-xs rounded-xl border border-slate-300 dark:border-slate-700 transition-all active:scale-[0.98] shadow-xs cursor-pointer"
            >
              रिसेट (RESET) गर्नुहोस्
            </button>

            {/* 2. सवारी चालकको नाम प्रयोग गर्नुहोस् */}
            <button
              type="button"
              id={`btn-use-driver-name-${index}`}
              onClick={handleUseDriverName}
              className="px-5 py-3 bg-white dark:bg-[#1e293b] hover:bg-slate-100 dark:hover:bg-[#334155] text-slate-800 dark:text-slate-100 font-bold text-xs rounded-xl border border-slate-300 dark:border-slate-700 transition-all active:scale-[0.98] shadow-xs cursor-pointer"
            >
              सवारी चालकको नाम प्रयोग गर्नुहोस्
            </button>

            {/* 3. Submitted Documents (Blue) */}
            <button
              type="button"
              id={`btn-submitted-documents-${index}`}
              onClick={() => setShowDocModal(true)}
              className={`px-5 py-3 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-[0.98] flex items-center gap-2 cursor-pointer border border-blue-600 ${
                record.submittedDocument
                  ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                  : 'bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-400/80 animate-pulse'
              }`}
            >
              <FileText className="w-4 h-4 text-white shrink-0" />
              <span className="flex items-center gap-1.5">
                Submitted Documents
                {record.submittedDocument || record.recommendingStaffName ? (
                  <span className="font-semibold text-blue-100">
                    ({resolveSubmittedDocument(record)})
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 font-black tracking-wide shadow-xs">
                    छान्नुहोस् *
                  </span>
                )}
              </span>
            </button>

            {/* 4. सुरक्षित गर्नुहोस् (SAVE) */}
            {canDistribute && (() => {
              const isSaveActive =
                Boolean(record.submittedDocument) &&
                Boolean(receiverName.trim()) &&
                !savingHandover;

              return (
                <button
                  type="button"
                  id={`btn-handover-save-${index}`}
                  onClick={handleSaveHandover}
                  disabled={!isSaveActive}
                  className={`px-7 py-3 font-black text-xs uppercase tracking-wider rounded-xl transition-all ml-auto flex items-center gap-2 ${
                    isSaveActive
                      ? 'bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white shadow-lg shadow-orange-600/30 dark:shadow-orange-950/40 cursor-pointer active:scale-[0.98] border border-orange-700'
                      : 'bg-orange-100 dark:bg-orange-950/50 text-orange-950 dark:text-orange-200 border-2 border-orange-300 dark:border-orange-800/70 cursor-not-allowed shadow-xs'
                  }`}
                  title={
                    !record.submittedDocument
                      ? 'कृपया पहिले Submitted Documents छान्नुहोस्'
                      : !receiverName.trim()
                      ? 'कृपया बुझिलिनेको नाम लेख्नुहोस्'
                      : 'सुरक्षित गर्नुहोस्'
                  }
                >
                  <Save
                    className={`w-4 h-4 shrink-0 ${
                      isSaveActive ? 'text-white' : 'text-orange-800 dark:text-orange-400'
                    }`}
                  />
                  <span
                    className={
                      isSaveActive
                        ? 'text-white font-black'
                        : 'text-orange-950 dark:text-orange-200 font-black'
                    }
                  >
                    {savingHandover ? 'सुरक्षित गर्दै...' : 'सुरक्षित गर्नुहोस् (SAVE)'}
                  </span>
                </button>
              );
            })()}
          </div>
        </div>
      )}

      {/* Render Submitted Documents Modal */}
      {showDocModal && (
        <SubmittedDocumentsModal
          isOpen={showDocModal}
          onClose={() => setShowDocModal(false)}
          record={record}
          onSaved={(updated) => {
            onRecordUpdated(updated);
            setEditSubmittedDoc(updated.submittedDocument || '');
          }}
        />
      )}

      {/* Render Report Missing Modal */}
      {showMissingModal && (
        <ReportMissingModal
          record={record}
          onClose={() => setShowMissingModal(false)}
          onSuccess={(updated) => {
            onRecordUpdated(updated);
            setShowMissingModal(false);
            setLastActionRecord(updated);
            setLastActionType('MISSING');
            setSaveSuccessMsg(
              `स्मार्ट कार्ड स्थिति सफलतापूर्वक 'MISSING' मा परिवर्तन गरियो । (License card flagged as MISSING)`
            );
            loadStats();
          }}
        />
      )}

      {/* Render Confirm Found Modal */}
      {showFoundModal && (
        <ConfirmFoundModal
          record={record}
          onClose={() => setShowFoundModal(false)}
          onSuccess={(updated) => {
            onRecordUpdated(updated);
            setShowFoundModal(false);
            setLastActionRecord(updated);
            setLastActionType('FOUND');
            setSaveSuccessMsg(
              `स्मार्ट कार्ड स्थिति सफलतापूर्वक 'FOUND' मा प्रमाणित र सुरक्षित भयो । (License card verified & marked as FOUND)`
            );
            loadStats();
          }}
        />
      )}

      {/* Render Found Card Handover Modal */}
      {showFoundHandoverModal && (
        <FoundCardHandoverModal
          record={record}
          onClose={() => setShowFoundHandoverModal(false)}
          onSuccess={(updated) => {
            onRecordUpdated(updated);
            setShowFoundHandoverModal(false);
            setLastActionRecord(updated);
            setLastActionType('GENERAL');
            setSaveSuccessMsg(
              `स्मार्ट कार्ड सफलतापूर्वक हस्तान्तरण गरियो । (License card handed over successfully)`
            );
            loadStats();
          }}
        />
      )}

      {/* Render Super Admin Distribution Reset Modal */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="bg-white dark:bg-[#0c1626] border-2 border-red-400 dark:border-red-500/50 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200"
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="bg-red-50 dark:bg-red-950/40 border-b-2 border-red-200 dark:border-red-500/30 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/20 border-2 border-red-300 dark:border-red-500/40 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-red-800 dark:text-red-300 font-mono">
                    हस्तान्तरण विवरण रिसेट (Super Admin Reset)
                  </h3>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                    डेटा प्रविष्टिमा भएको त्रुटि सच्याउन वितरण विवरण रिसेट गर्नुहोस्
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                disabled={isResettingDistribution}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 text-xs sm:text-sm">
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-300 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>चेतावनी / Warning (Super Admin Action)</span>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300/90 leading-relaxed">
                  यो कार्यले हालको वितरण विवरण हटाई लाइसेन्सलाई पुन: वितरण योग्य बनाउनेछ ताकि कार्यालयबाट भएको गलत डेटा प्रविष्टि (Mistake) तुरुन्तै सच्याउन सकियोस्।
                </p>
              </div>

              {/* Record Summary */}
              <div className="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-[#070e1c] border-2 border-slate-300 dark:border-slate-800 font-mono text-xs">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                    LICENSE NUMBER
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {record.licenseNumber || '---'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                    APPLICANT ID
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {record.applicantId || record.applicationNumber}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                    DISTRIBUTED TO
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 truncate block">
                    {resolveDistributedTo(record)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                    DISTRIBUTED DATE
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {record.distributedDate || '---'}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 dark:bg-[#070e1c] border-t border-slate-200 dark:border-slate-800 px-5 py-3.5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                disabled={isResettingDistribution}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                रद्द गर्नुहोस् (Cancel)
              </button>
              <button
                type="button"
                onClick={handleConfirmResetDistribution}
                disabled={isResettingDistribution}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold font-mono text-white bg-red-600 hover:bg-red-500 active:scale-98 rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50"
              >
                {isResettingDistribution ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>रिसेट हुँदैछ...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>रिसेट गरी सच्याउनुहोस् (Reset & Unlock)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
