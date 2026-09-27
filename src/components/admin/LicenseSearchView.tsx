import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  CheckCircle2,
  FileText,
  Save,
  RotateCcw,
  User,
  AlertCircle,
  AlertOctagon,
  Shield,
  ShieldCheck,
  Building2,
  Calendar,
  Sparkles,
  Printer,
  FileCheck,
  Lock,
  Clock,
  Bell,
  Layers,
  FileSpreadsheet,
  CheckSquare,
  Check,
  X,
  ChevronRight,
  Info,
  RefreshCw,
  CreditCard,
  History,
  Pencil,
} from 'lucide-react';
import { LicenseRecord, DashboardStats, AdminActiveView } from '../../types';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { SubmittedDocumentsModal } from '../modals/SubmittedDocumentsModal';
import { ReportMissingModal } from '../modals/ReportMissingModal';
import { ConfirmFoundModal } from '../modals/ConfirmFoundModal';
import { toNepaliDevanagariDigits, getNepaliDevanagariDate, formatDistributedDateBS, isDistributedSameDay, canDisplayMissingButton } from '../../utils/dateUtils';
import { resolveSubmittedDocument, isRecommenderDoc, cleanStaffRecommenderName, formatRecommenderDoc } from '../../utils/staffUtils';
import { HistoryInput, saveInputHistory } from '../common/HistoryInput';
import { getRecordCodeParts, normalizeCodeNumber, formatLicenseOrApplicantInput } from '../../utils/codeUtils';
import { safeStorage } from '../../utils/storage';
import { hasPermission } from '../../utils/permissions';
import { SearchResultCardItem } from './SearchResultCardItem';

interface Props {
  onSelectRecord: (record: LicenseRecord) => void;
  onDistribute: (record: LicenseRecord) => void;
  onMarkMissing: (record: LicenseRecord) => void;
  onNavigate?: (view: AdminActiveView) => void;
}

type TopicFilter = 'ALL' | 'NOT_DISTRIBUTED' | 'DISTRIBUTED' | 'MISSING' | 'FOUND' | 'HANDED_OVER';

export const LicenseSearchView: React.FC<Props> = ({
  onSelectRecord,
  onDistribute,
  onMarkMissing,
  onNavigate,
}) => {
  const { user } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [activeRecord, setActiveRecord] = useState<LicenseRecord | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Topic Filter state
  const [activeTopic, setActiveTopic] = useState<TopicFilter>('ALL');
  const [selectedLetter, setSelectedLetter] = useState<string>('ALL');
  const [showNoticeModal, setShowNoticeModal] = useState(false);

  // Live Real-Time Stats
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Submitted Documents Modal state
  const [showDocModal, setShowDocModal] = useState(false);
  const [showMissingModal, setShowMissingModal] = useState(false);
  const [showFoundModal, setShowFoundModal] = useState(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [isResettingDistribution, setIsResettingDistribution] = useState(false);

  // Multi-Record matching state for license holders with multiple legitimate cards (e.g. original + COPY)
  const [matchingRecords, setMatchingRecords] = useState<LicenseRecord[]>([]);
  const [selectedRecordIndex, setSelectedRecordIndex] = useState<number>(0);

  // Super Admin Edit Mode state (Matching user uploaded screenshot)
  const [isSuperAdminEditMode, setIsSuperAdminEditMode] = useState(false);
  const [editReceiverName, setEditReceiverName] = useState('');
  const [editSubmittedDoc, setEditSubmittedDoc] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Department confirmation modal state (when user clicks "सवारी चालकको नाम प्रयोग गर्नुहोस्")
  const [showDepartmentConfirmModal, setShowDepartmentConfirmModal] = useState(false);
  const [pendingDriverNameTarget, setPendingDriverNameTarget] = useState<'STANDARD' | 'EDIT_MODE'>('STANDARD');
  const [pendingDriverTarget, setPendingDriverTarget] = useState<{
    record: LicenseRecord;
    target: 'STANDARD' | 'EDIT_MODE';
    setReceiverFn: (name: string) => void;
  } | null>(null);

  // Handover state for available card
  const [receiverName, setReceiverName] = useState('');
  const [savingHandover, setSavingHandover] = useState(false);
  const [handoverSavedCard, setHandoverSavedCard] = useState<{ message: string } | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
  const [lastActionRecord, setLastActionRecord] = useState<LicenseRecord | null>(null);
  const [lastActionType, setLastActionType] = useState<'MISSING' | 'FOUND' | 'RESET' | 'EDIT' | 'GENERAL'>('GENERAL');

  // Auto-dismiss floating action notification banner after 15 seconds
  useEffect(() => {
    if (!saveSuccessMsg) return;
    const timer = setTimeout(() => {
      setSaveSuccessMsg(null);
    }, 15000);
    return () => clearTimeout(timer);
  }, [saveSuccessMsg]);

  // Dismiss floating banner on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && saveSuccessMsg) {
        setSaveSuccessMsg(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveSuccessMsg]);

  // Real search history stored from actual user searches
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const stored = safeStorage.getItem('plsms_recent_searches');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });

  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(-1);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close history dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowHistoryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const saveToSearchHistory = (qStr: string) => {
    const trimmed = qStr.trim();
    if (!trimmed || trimmed.length < 2) return;
    setSearchHistory((prev) => {
      const filtered = prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, 25);
      try {
        safeStorage.setItem('plsms_recent_searches', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const handleRemoveHistoryItem = (e: React.MouseEvent, itemToRemove: string) => {
    e.stopPropagation();
    e.preventDefault();
    setSearchHistory((prev) => {
      const updated = prev.filter((item) => item !== itemToRemove);
      try {
        safeStorage.setItem('plsms_recent_searches', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const handleSelectHistoryItem = (item: string) => {
    const formatted = formatLicenseOrApplicantInput(item, '');
    setSearchInput(formatted);
    setShowHistoryDropdown(false);
    setSelectedHistoryIndex(-1);
    executeSearch(formatted);
  };

  // Filter history entries that approximately match what the user is typing
  const filteredHistory = React.useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) {
      return searchHistory.slice(0, 6);
    }
    const cleanQ = q.replace(/[^a-zA-Z0-9]/g, '');
    return searchHistory.filter((item) => {
      const itemLower = item.toLowerCase();
      const cleanItem = itemLower.replace(/[^a-zA-Z0-9]/g, '');
      return itemLower.includes(q) || (cleanQ.length >= 2 && cleanItem.includes(cleanQ));
    }).slice(0, 6);
  }, [searchInput, searchHistory]);

  // Fetch real-time dashboard counts for the topic buttons
  const loadStats = async (retryAttempt = 0) => {
    try {
      if (!stats) setLoadingStats(true);
      const res = await api.getDashboardStats();
      if (res) {
        setStats(res);
      }
    } catch (err: any) {
      console.warn('Dashboard stats temporarily warming up in Search View:', err?.message || err);
      if (!stats && retryAttempt < 3) {
        setTimeout(() => {
          loadStats(retryAttempt + 1);
        }, 1500 * (retryAttempt + 1));
      }
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    loadStats();

    // Auto-polling interval every 6 seconds to ensure data matches SMART CARD DASHBOARD exactly
    const interval = setInterval(() => {
      loadStats();
    }, 6000);

    const handleRecordUpdated = () => {
      loadStats();
    };

    window.addEventListener('plsms:record-updated', handleRecordUpdated);
    window.addEventListener('focus', () => loadStats());
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadStats();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('plsms:record-updated', handleRecordUpdated);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const executeSearch = async (queryText?: string) => {
    const q = (queryText !== undefined ? queryText : searchInput).trim();
    if (!q) {
      setActiveRecord(null);
      setSearchAttempted(false);
      setSearchError(null);
      return;
    }

    saveToSearchHistory(q);
    setShowHistoryDropdown(false);
    setSelectedHistoryIndex(-1);

    try {
      setSearching(true);
      setSearchAttempted(true);
      setSearchedQuery(q);
      setSearchError(null);
      setHandoverSavedCard(null);
      setSaveSuccessMsg(null);
      setSaveErrorMsg(null);

      // Perform strict search: 1st by Applicant ID, 2nd by License Number ONLY
      let statusParam: string | undefined = undefined;
      if (activeTopic === 'NOT_DISTRIBUTED') statusParam = 'NOT_DISTRIBUTED';
      if (activeTopic === 'DISTRIBUTED') statusParam = 'DISTRIBUTED';
      if (activeTopic === 'MISSING') statusParam = 'MISSING';
      if (activeTopic === 'FOUND') statusParam = 'FOUND';
      if (activeTopic === 'HANDED_OVER') statusParam = 'HANDED_OVER';

      const res = await api.getRecords({
        q,
        strictIdOrLicense: true,
        status: statusParam,
        page: 1,
        limit: 10,
      });

      if (res && res.records && res.records.length > 0) {
        setMatchingRecords(res.records);
        setSelectedRecordIndex(0);
        const found = res.records[0];
        setActiveRecord(found);
        setReceiverName('');
      } else {
        setMatchingRecords([]);
        setSelectedRecordIndex(0);
        setActiveRecord(null);
        setSearchError(
          `तपाईंको लाइसेन्स कार्ड हाल कार्यालयमा उपलब्ध छैन !!`
        );
      }
    } catch (err: any) {
      console.error('Search failed:', err);
      setSearchError(err.message || 'Search failed. Please try again.');
      setActiveRecord(null);
      setMatchingRecords([]);
      setSelectedRecordIndex(0);
    } finally {
      setSearching(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch();
  };

  const handleResetSearch = () => {
    setSearchInput('');
    setSearchedQuery('');
    setActiveRecord(null);
    setMatchingRecords([]);
    setSelectedRecordIndex(0);
    setSearchAttempted(false);
    setSearchError(null);
    setReceiverName('');
    setHandoverSavedCard(null);
    setSaveSuccessMsg(null);
    setSaveErrorMsg(null);
    setSelectedLetter('ALL');
    setShowHistoryDropdown(false);
    setSelectedHistoryIndex(-1);
  };

  const handleTopicClick = (topic: TopicFilter) => {
    setActiveTopic(topic);
    setActiveRecord(null);
    setSearchError(null);
    setSearchAttempted(false);
  };

  // Resolve Department display for Department Confirmation Modal & Metric Cards directly from Database Record
  const resolveDepartmentDisplay = (record: LicenseRecord | null): string => {
    if (!record) return "कार्ड वितरण शाखा - 'क'";
    const rawDept = String(
      record.department ||
      record.office ||
      record.rawRecord?.['DEPARTMENT'] ||
      record.rawRecord?.['OFFICE'] ||
      ''
    ).trim();

    if (!rawDept) return "कार्ड वितरण शाखा - 'क'";

    // Distinctly check for Branch Kha ('ख') without false-positives on the letter 'ख' inside the Nepali word 'शाखा'
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

    // Distinctly check for Branch Ka ('क')
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

  const handleRequestDriverName = (
    record: LicenseRecord,
    target: 'STANDARD' | 'EDIT_MODE',
    setReceiverFn: (name: string) => void
  ) => {
    setActiveRecord(record);
    setPendingDriverTarget({ record, target, setReceiverFn });
    setShowDepartmentConfirmModal(true);
  };

  const handleUseDriverName = () => {
    if (activeRecord) {
      setPendingDriverNameTarget('STANDARD');
      setShowDepartmentConfirmModal(true);
    }
  };

  const handleEditUseDriverName = () => {
    if (activeRecord) {
      setPendingDriverNameTarget('EDIT_MODE');
      setShowDepartmentConfirmModal(true);
    }
  };

  const handleConfirmDepartmentYes = () => {
    if (pendingDriverTarget) {
      pendingDriverTarget.setReceiverFn((pendingDriverTarget.record.holderName || '').toUpperCase());
      setSaveSuccessMsg(null);
      setSaveErrorMsg(null);
    } else if (activeRecord) {
      if (pendingDriverNameTarget === 'EDIT_MODE') {
        setEditReceiverName((activeRecord.holderName || '').toUpperCase());
      } else {
        setReceiverName(activeRecord.holderName || '');
      }
      setSaveSuccessMsg(null);
      setSaveErrorMsg(null);
    }
    setShowDepartmentConfirmModal(false);
    setPendingDriverTarget(null);
  };

  const handleConfirmDepartmentNo = () => {
    setShowDepartmentConfirmModal(false);
    setPendingDriverTarget(null);
    handleResetSearch();
  };

  const handleRecordUpdated = (index: number, updatedRecord: LicenseRecord) => {
    setMatchingRecords((prev) => {
      const targetLic = updatedRecord.licenseNumber ? updatedRecord.licenseNumber.trim().toUpperCase() : '';
      const targetApp = (updatedRecord.applicationNumber || updatedRecord.applicantId || '').trim();

      return prev.map((item, idx) => {
        if (idx === index || item.id === updatedRecord.id) {
          return updatedRecord;
        }
        // If distributed, update all copies/prints for the same applicant or license
        const itemLic = item.licenseNumber ? item.licenseNumber.trim().toUpperCase() : '';
        const itemApp = (item.applicationNumber || item.applicantId || '').trim();
        const isMatch = (targetLic && itemLic && targetLic === itemLic) ||
                        (targetApp && itemApp && targetApp !== '---' && targetApp === itemApp);

        if (isMatch && updatedRecord.isDistributed) {
          return {
            ...item,
            status: updatedRecord.status,
            mainStatus: updatedRecord.mainStatus,
            isDistributed: true,
            distributedAt: updatedRecord.distributedAt,
            distributedDate: updatedRecord.distributedDate,
            distributedBy: updatedRecord.distributedBy,
            receivedBy: updatedRecord.receivedBy,
            receiverName: updatedRecord.receiverName,
            receiverNid: updatedRecord.receiverNid,
            receiverPhone: updatedRecord.receiverPhone,
            receiverRelation: updatedRecord.receiverRelation,
            receiverRemarks: updatedRecord.receiverRemarks,
            submittedDocument: updatedRecord.submittedDocument,
            recommendingStaffName: updatedRecord.recommendingStaffName,
            handoverReference: updatedRecord.handoverReference,
            updatedAt: updatedRecord.updatedAt,
          };
        }
        return item;
      });
    });
    if (index === selectedRecordIndex || activeRecord?.id === updatedRecord.id) {
      setActiveRecord(updatedRecord);
    }
    setLastActionRecord(updatedRecord);
    loadStats();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('plsms:record-updated', { detail: { record: updatedRecord } })
      );
    }
  };

  const handleHandoverSaved = (
    savedRecord: LicenseRecord,
    rName: string,
    index: number
  ) => {
    handleRecordUpdated(index, savedRecord);
    setHandoverSavedCard({
      message: `सवारी चालक अनुमतिपत्र (Smart Card) सफलतापूर्वक "${rName}" लाई हस्तान्तरण भयो र डाटाबेसमा सुरक्षित गरियो!`,
    });
  };

  const handleResetReceiver = () => {
    setReceiverName('');
    setHandoverSavedCard(null);
    setSaveSuccessMsg(null);
    setSaveErrorMsg(null);
  };

  const handleSaveHandover = async () => {
    if (!activeRecord) return;
    if (!activeRecord.submittedDocument) {
      setSaveErrorMsg('कृपया पहिले "Submitted Documents" बटन थिचेर बुझाइएको कागजात अनिवार्य रूपमा छान्नुहोस् (Please select submitted document first - Compulsory).');
      setShowDocModal(true);
      return;
    }
    if (!receiverName.trim()) {
      setSaveErrorMsg('कृपया बुझिलिने व्यक्तिको नाम लेख्नुहोस् (Please enter receiver name).');
      return;
    }

    try {
      setSavingHandover(true);
      setHandoverSavedCard(null);
      setSaveSuccessMsg(null);
      setSaveErrorMsg(null);

      const cleanStaff = activeRecord.recommendingStaffName?.trim()
        ? cleanStaffRecommenderName(activeRecord.recommendingStaffName)
        : (isRecommenderDoc(activeRecord.submittedDocument) ? cleanStaffRecommenderName(activeRecord.submittedDocument) : undefined);
      const finalDocName = cleanStaff
        ? formatRecommenderDoc(cleanStaff)
        : activeRecord.submittedDocument;
      const finalStaffName = cleanStaff || undefined;

      const res = await api.distributeRecord(activeRecord.id, {
        receiverName: receiverName.trim(),
        receiverNid: activeRecord.nidOrPassport || 'SELF_VERIFIED',
        receiverPhone: activeRecord.phone || 'SELF_VERIFIED',
        receiverRelation: receiverName.trim().toUpperCase() === activeRecord.holderName.trim().toUpperCase() ? 'SELF' : 'AUTHORIZED_REPRESENTATIVE',
        remarks: 'Direct single-card handover logged from Search terminal',
        office: activeRecord.office,
        submittedDocument: finalDocName,
        recommendingStaffName: finalStaffName,
      });

      if (res && res.record) {
        saveInputHistory('receiver_name', receiverName.trim());
        setActiveRecord(res.record);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('plsms:record-updated', { detail: { record: res.record } }));
        }
        setHandoverSavedCard({
          message: `सवारी चालक अनुमतिपत्र (Smart Card) सफलतापूर्वक "${receiverName.trim()}" लाई हस्तान्तरण भयो र डाटाबेसमा सुरक्षित गरियो!`,
        });
        setSaveSuccessMsg(null);
        loadStats();
      }
    } catch (err: any) {
      console.error('Save handover failed:', err);
      setSaveErrorMsg(err.message || 'Failed to save handover.');
    } finally {
      setSavingHandover(false);
    }
  };

  // Helper to check if Column I (RECEIVED BY) is already populated
  const isDistributed = (record: LicenseRecord): boolean => {
    return Boolean(
      record.isDistributed ||
      (record.receivedBy && record.receivedBy.trim().length > 0 && record.receivedBy !== '-') ||
      (record.receiverName && record.receiverName.trim().length > 0 && record.receiverName !== '-') ||
      record.status === 'DISTRIBUTED'
    );
  };

  // Super Admin Action: Reset Distribution to un-distribute record completely
  const handleConfirmResetDistribution = async () => {
    if (!activeRecord) return;
    setIsResettingDistribution(true);
    setSaveErrorMsg(null);
    try {
      const res = await api.resetDistribution(activeRecord.id);
      if (res && res.record) {
        setReceiverName('');
        setEditReceiverName('');
        setActiveRecord(res.record);
        setShowResetConfirmModal(false);
        setIsSuperAdminEditMode(false);
        setLastActionRecord(res.record);
        setLastActionType('RESET');
        setSaveSuccessMsg('✓ हस्तान्तरण विवरण पूर्ण रूपमा रिसेट गरियो। लाइसेन्स अब पुनः वितरण योग्य भयो र Google Sheet मा पनि खाली भयो।');
        setHandoverSavedCard(null);
        loadStats();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('plsms:record-updated', { detail: { record: res.record } }));
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
    if (!activeRecord) return;
    if (!editReceiverName.trim()) {
      setSaveErrorMsg('कृपया बुझिलिने व्यक्तिको नाम लेख्नुहोस्। (Recipient name is required)');
      return;
    }
    setIsSavingEdit(true);
    setSaveErrorMsg(null);
    try {
      const cleanReceiver = editReceiverName.trim().toUpperCase();
      const targetDoc = editSubmittedDoc || activeRecord.submittedDocument;
      let finalEditedDoc = targetDoc;
      if (isRecommenderDoc(targetDoc) || activeRecord.recommendingStaffName) {
        const staff = cleanStaffRecommenderName(activeRecord.recommendingStaffName) || cleanStaffRecommenderName(targetDoc);
        if (staff) {
          finalEditedDoc = formatRecommenderDoc(staff);
        }
      }
      const res = await api.updateDistribution(activeRecord.id, {
        receiverName: cleanReceiver,
        submittedDocument: finalEditedDoc,
      });
      if (res && res.record) {
        setActiveRecord(res.record);
        setIsSuperAdminEditMode(false);
        setLastActionRecord(res.record);
        setLastActionType('EDIT');
        setSaveSuccessMsg('✓ विवरण सफलतापूर्वक सच्याइयो र सुरक्षित गरियो। Database र Google Sheet मा तत्काल प्रतिस्थापन भयो।');
        loadStats();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('plsms:record-updated', { detail: { record: res.record } }));
        }
      }
    } catch (err: any) {
      console.error('Save edited distribution failed:', err);
      setSaveErrorMsg(err.message || 'वितरण विवरण सच्याउन सकिएन।');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Helper to extract category cleanly (e.g. K, A, B, etc.)
  const getCategoryDisplay = (record: LicenseRecord) => {
    if (record.vehicleClass && record.vehicleClass.trim()) {
      return record.vehicleClass.trim();
    }
    if (record.licenseType && record.licenseType.trim() && record.licenseType !== 'Smart Card') {
      return record.licenseType.trim();
    }
    return 'K';
  };

  // Helper to extract Codes in format '<old code>/<new code>' from OLD CODE / NEW CODE columns
  // Strictly respects user directive: never show more than 4 dashes (always "----" for placeholders)
  const getCodesParts = (record: LicenseRecord): { oldPart: string; newPart: string } => {
    const parts = getRecordCodeParts(record);
    return {
      oldPart: parts.oldPart,
      newPart: parts.newPart,
    };
  };

  const getCodesDisplay = (record: LicenseRecord): string => {
    const { oldPart, newPart } = getCodesParts(record);
    return `${oldPart}/${newPart}`;
  };

  const isSuperAdmin = Boolean(
    user?.role === 'SUPER_ADMIN' ||
    user?.id === 'SUPER_ADMIN' ||
    user?.role?.toUpperCase().includes('SUPER')
  );

  const canResetDistribution = hasPermission(user, 'distribution.reset_distribution');
  const canDistribute = hasPermission(user, 'records.distribute');
  const canMarkMissing = isSuperAdmin || hasPermission(user, 'records.mark_missing') || hasPermission(user, 'records.search_mark_missing');
  const canUnmarkMissing = isSuperAdmin || hasPermission(user, 'records.unmark_missing');

  const alreadyHandedOver = activeRecord ? isDistributed(activeRecord) : false;
  const isCodeUnlocked = isSuperAdmin || alreadyHandedOver;

  // Counts derived from stats or total ledger - ALWAYS unified with SMART CARD DASHBOARD
  const totalCardsCount = stats?.totalRecords || 0;
  const notDistributedCount = stats?.notDistributedRecords ?? stats?.availableRecords ?? 0;
  const distributedCount = stats?.distributedRecords || 0;
  const missingCount = stats?.missingRecords || 0;
  const foundCount = stats?.foundRecords || 0;
  const handedOverCount = stats?.handedOverRecords ?? distributedCount;

  // Dynamic action details for Floating Action Notification Banner
  const displayActionRecord = lastActionRecord || activeRecord;
  const displayLicenseNo =
    displayActionRecord?.licenseNumber ||
    displayActionRecord?.rawRecord?.['LICENSE NUMBER'] ||
    displayActionRecord?.applicantId ||
    displayActionRecord?.rawRecord?.['APPLICANT ID'] ||
    '';
  const displayApplicantName =
    displayActionRecord?.holderName ||
    (displayActionRecord as any)?.name ||
    displayActionRecord?.rawRecord?.['APPLICANT NAME'] ||
    displayActionRecord?.rawRecord?.['FULL NAME'] ||
    '';
  const displayFhName =
    displayActionRecord?.fatherOrSpouseName ||
    displayActionRecord?.rawRecord?.['F/H NAME'] ||
    displayActionRecord?.rawRecord?.['FATHER/HUSBAND NAME'] ||
    '';
  const displayCategory =
    displayActionRecord?.category ||
    displayActionRecord?.vehicleClass ||
    displayActionRecord?.rawRecord?.['CATEGORY'] ||
    '';
  const displayContactPhone =
    displayActionRecord?.phone ||
    displayActionRecord?.receiverPhone ||
    (displayActionRecord as any)?.contactMobile ||
    displayActionRecord?.rawRecord?.['CONTACT'] ||
    displayActionRecord?.rawRecord?.['PHONE'] ||
    displayActionRecord?.rawRecord?.['MOBILE'] ||
    '';

  const recordsToDisplay = matchingRecords.length > 0 ? matchingRecords : (activeRecord ? [activeRecord] : []);

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300 relative">
      {/* ========================================================================= */}
      {/* FLOATING ACTION NOTIFICATION BANNER (CENTERED RECTANGULAR DIALOG BOX)      */}
      {/* Rectangular Shape with Length 50% more than Breadth (Aspect Ratio 3:2)     */}
      {/* Centered directly over the working/clicking area in the center of screen   */}
      {/* ========================================================================= */}
      {saveSuccessMsg && !handoverSavedCard && (
        <div
          role="alert"
          aria-live="assertive"
          onClick={() => setSaveSuccessMsg(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ aspectRatio: '3 / 2' }}
            className="w-full max-w-[640px] sm:max-w-[700px] aspect-[3/2] min-h-[300px] max-h-[90vh] bg-[#021c16]/98 dark:bg-[#021812]/98 border-2 border-emerald-500 rounded-2xl p-5 sm:p-6 shadow-[0_25px_60px_rgba(0,0,0,0.85)] ring-1 ring-emerald-400/40 backdrop-blur-md text-white transition-all flex flex-col justify-between overflow-y-auto animate-in zoom-in-95 duration-200 relative"
          >
            {/* Top row: Action header badges & close button */}
            <div className="flex items-center justify-between gap-3 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10.5px] sm:text-xs font-black font-mono tracking-wider uppercase bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 shadow-xs">
                  <Check className="w-3.5 h-3.5 stroke-[3] text-emerald-400" />
                  ACTION TAKEN • कार्य सम्पन्न
                </span>

                {lastActionType === 'MISSING' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] sm:text-xs font-black font-mono uppercase bg-rose-500/25 text-rose-300 border border-rose-500/50 shadow-xs">
                    <AlertOctagon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    स्थिति: MISSING (कार्ड हराएको)
                  </span>
                )}

                {lastActionType === 'FOUND' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] sm:text-xs font-black font-mono uppercase bg-emerald-500/30 text-emerald-200 border border-emerald-400/50 shadow-xs">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    स्थिति: FOUND (कार्ड फेला परेको)
                  </span>
                )}

                {lastActionType === 'RESET' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] sm:text-xs font-black font-mono uppercase bg-amber-500/25 text-amber-200 border border-amber-500/50 shadow-xs">
                    <RotateCcw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    वितरण विवरण रिसेट (RESET)
                  </span>
                )}

                {lastActionType === 'EDIT' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] sm:text-xs font-black font-mono uppercase bg-sky-500/25 text-sky-200 border border-sky-500/50 shadow-xs">
                    <Pencil className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    विवरण सच्याइयो (EDITED)
                  </span>
                )}

                <span className="text-[11px] font-mono text-emerald-400/80 hidden sm:inline-flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  PLSMS REGISTRY
                </span>
              </div>

              {/* Close Button X */}
              <button
                type="button"
                onClick={() => setSaveSuccessMsg(null)}
                className="p-1.5 rounded-lg text-emerald-400 hover:text-white hover:bg-emerald-800/50 border border-emerald-500/30 hover:border-emerald-400 transition-all cursor-pointer shrink-0"
                title="Close notification (बन्द गर्नुहोस्)"
                aria-label="Close notification"
              >
                <X className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>

            {/* Middle row: Related action icon and exact message focused in the center */}
            <div className="py-4 my-auto flex items-center gap-3.5">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-emerald-500/20 border-2 border-emerald-500/60 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
                {lastActionType === 'MISSING' ? (
                  <AlertOctagon className="w-6 h-6 text-rose-400 stroke-[2.5]" />
                ) : (
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 stroke-[2.5]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm sm:text-base md:text-[17px] font-bold text-emerald-100 tracking-wide leading-relaxed font-sans">
                  {saveSuccessMsg}
                </p>
              </div>
            </div>

            {/* Bottom row: Related card metadata, icons & sync status */}
            <div className="pt-3 border-t border-emerald-500/25 space-y-2.5 shrink-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {displayLicenseNo && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 border border-emerald-500/30 text-emerald-200">
                    <CreditCard className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>लाइसेन्स नं: <strong className="text-white">{displayLicenseNo}</strong></span>
                  </div>
                )}

                {displayApplicantName && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 border border-emerald-500/30 text-emerald-200">
                    <User className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>सेवाग्राही: <strong className="text-white">{displayApplicantName}</strong></span>
                    {displayFhName && (
                      <span className="text-emerald-300/75 text-[11px]">({displayFhName})</span>
                    )}
                  </div>
                )}

                {displayCategory && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 border border-emerald-500/30 text-emerald-200">
                    <span>वर्ग: <strong className="text-white">{displayCategory}</strong></span>
                  </div>
                )}

                {displayContactPhone && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 border border-emerald-500/30 text-emerald-200">
                    <span>सम्पर्क: <strong className="text-white">{displayContactPhone}</strong></span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="text-[11px] text-emerald-300/80 flex items-center gap-1.5 font-mono">
                  <FileCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Google Sheets तथा प्रणाली डाटाबेसमा तत्काल अद्यावधिक भयो ।</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSaveSuccessMsg(null)}
                  className="px-3 py-1 rounded-lg bg-emerald-600/50 hover:bg-emerald-600 text-white text-xs font-bold font-mono transition-all border border-emerald-400/40 cursor-pointer"
                >
                  ठिक छ (Dismiss)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ========================================================================= */}
      {/* TOPIC-WISE METRIC STAT CARDS (6 Interactive Synchronized Metric Stat Cards)*/}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. TOTAL SMART CARDS */}
        <button
          type="button"
          onClick={() => handleTopicClick('ALL')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#0B1528] border-2 text-center flex flex-col justify-center items-center space-y-1.5 transition-all select-none cursor-pointer active:scale-[0.98] ${
            activeTopic === 'ALL'
              ? 'border-blue-500 ring-2 ring-blue-500/30 dark:ring-blue-500/50 shadow-sm dark:shadow-[0_0_12px_rgba(59,130,246,0.25)]'
              : 'border-slate-300 dark:border-blue-500/40 hover:border-blue-400'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-blue-600 dark:text-blue-300 uppercase tracking-tight font-mono">
            TOTAL SMART CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
            {totalCardsCount.toLocaleString()}
          </span>
        </button>

        {/* 2. NOT-DISTRIBUTED CARDS */}
        <button
          type="button"
          onClick={() => handleTopicClick('NOT_DISTRIBUTED')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#0B1528] border-2 text-center flex flex-col justify-center items-center space-y-1.5 transition-all select-none cursor-pointer active:scale-[0.98] ${
            activeTopic === 'NOT_DISTRIBUTED'
              ? 'border-emerald-500 ring-2 ring-emerald-500/30 dark:ring-emerald-500/50 shadow-sm dark:shadow-[0_0_12px_rgba(16,185,129,0.25)]'
              : 'border-slate-300 dark:border-emerald-500/40 hover:border-emerald-400'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-emerald-600 dark:text-[#10B981] uppercase tracking-tight font-mono">
            NOT -DISTRIBUTED CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-[#10B981] font-mono">
            {notDistributedCount.toLocaleString()}
          </span>
        </button>

        {/* 3. DISTRIBUTED CARDS */}
        <button
          type="button"
          onClick={() => handleTopicClick('DISTRIBUTED')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#0B1528] border-2 text-center flex flex-col justify-center items-center space-y-1.5 transition-all select-none cursor-pointer active:scale-[0.98] ${
            activeTopic === 'DISTRIBUTED'
              ? 'border-sky-500 dark:border-sky-400 ring-2 ring-sky-500/30 dark:ring-sky-400/50 shadow-sm dark:shadow-[0_0_12px_rgba(56,189,248,0.25)]'
              : 'border-slate-300 dark:border-sky-500/40 hover:border-sky-400'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-sky-600 dark:text-[#38BDF8] uppercase tracking-tight font-mono">
            DISTRIBUTED CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-sky-600 dark:text-[#38BDF8] font-mono">
            {distributedCount.toLocaleString()}
          </span>
        </button>

        {/* 4. MISSING CARDS */}
        <button
          type="button"
          onClick={() => handleTopicClick('MISSING')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#0B1528] border-2 text-center flex flex-col justify-center items-center space-y-1.5 transition-all select-none cursor-pointer active:scale-[0.98] ${
            activeTopic === 'MISSING'
              ? 'border-red-500 ring-2 ring-red-500/30 dark:ring-red-500/50 shadow-sm dark:shadow-[0_0_12px_rgba(239,68,68,0.25)]'
              : 'border-slate-300 dark:border-red-500/40 hover:border-red-400'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-red-600 dark:text-[#F87171] uppercase tracking-tight font-mono">
            MISSING CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-red-600 dark:text-[#F87171] font-mono">
            {missingCount.toLocaleString()}
          </span>
        </button>

        {/* 5. FOUND CARDS */}
        <button
          type="button"
          onClick={() => handleTopicClick('FOUND')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#0B1528] border-2 text-center flex flex-col justify-center items-center space-y-1.5 transition-all select-none cursor-pointer active:scale-[0.98] ${
            activeTopic === 'FOUND'
              ? 'border-purple-500 ring-2 ring-purple-500/30 dark:ring-purple-500/50 shadow-sm dark:shadow-[0_0_12px_rgba(168,85,247,0.25)]'
              : 'border-slate-300 dark:border-purple-500/40 hover:border-purple-400'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-purple-600 dark:text-[#C084FC] uppercase tracking-tight font-mono">
            FOUND CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-purple-600 dark:text-[#C084FC] font-mono">
            {foundCount.toLocaleString()}
          </span>
        </button>

        {/* 6. HANDOVER CARDS */}
        <button
          type="button"
          onClick={() => handleTopicClick('HANDED_OVER')}
          className={`p-4 rounded-2xl bg-white dark:bg-[#0B1528] border-2 text-center flex flex-col justify-center items-center space-y-1.5 transition-all select-none cursor-pointer active:scale-[0.98] ${
            activeTopic === 'HANDED_OVER'
              ? 'border-teal-500 ring-2 ring-teal-500/30 dark:ring-teal-500/50 shadow-sm dark:shadow-[0_0_12px_rgba(45,212,191,0.25)]'
              : 'border-slate-300 dark:border-teal-500/40 hover:border-teal-400'
          }`}
        >
          <span className="text-xs sm:text-[13px] font-bold text-teal-600 dark:text-[#2DD4BF] uppercase tracking-tight font-mono">
            HANDOVER CARDS
          </span>
          <span className="text-2xl sm:text-3xl font-black text-teal-600 dark:text-[#2DD4BF] font-mono">
            {handedOverCount.toLocaleString()}
          </span>
        </button>
      </div>

      {/* Title: PRINTED LICENSE SEARCH MANAGEMENT SYSTEM */}
      <div className="text-center py-1">
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 dark:text-white tracking-widest uppercase font-mono drop-shadow-sm transition-colors">
          PRINTED LICENSE SEARCH MANAGEMENT SYSTEM
        </h1>
      </div>

      {/* ========================================================================= */}
      {/* SEARCH BOX CONTAINER                                                      */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-[#0B1528] rounded-xl px-4 py-3.5 sm:px-6 sm:py-4 border-2 border-slate-300 dark:border-[#1e2d4a] shadow-sm dark:shadow-xl relative space-y-3">
        {/* Top Note Notice */}
        <div className="text-center">
          <p className="text-xs sm:text-[13px] font-medium text-slate-700 dark:text-slate-200 tracking-wide leading-tight">
            नोट: यस कार्यालयबाट नयाँ, वर्ग थप, नविकरण र प्रतिलिपिको सेवा लिएका{' '}
            <span className="font-bold text-slate-900 dark:text-white font-mono">License</span> मात्र{' '}
            <span className="font-bold text-slate-900 dark:text-white font-mono">Search</span> गर्नुहोस् ।
          </p>
        </div>

        {/* Search Input Bar with SEARCH and RESET buttons */}
        <form onSubmit={handleFormSubmit} className="relative">
          <div className="flex flex-col sm:flex-row items-stretch gap-2">
            <div className="relative flex-1" ref={searchContainerRef}>
              <input
                ref={searchInputRef}
                type="text"
                value={searchInput}
                maxLength={15}
                onChange={(e) => {
                  const formatted = formatLicenseOrApplicantInput(e.target.value, searchInput);
                  setSearchInput(formatted);
                  setShowHistoryDropdown(true);
                  setSelectedHistoryIndex(-1);
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData('text');
                  const formatted = formatLicenseOrApplicantInput(text, '');
                  setSearchInput(formatted);
                  setShowHistoryDropdown(true);
                  setSelectedHistoryIndex(-1);
                }}
                onFocus={() => {
                  setShowHistoryDropdown(true);
                  setSelectedHistoryIndex(-1);
                }}
                onKeyDown={(e) => {
                  if (showHistoryDropdown && filteredHistory.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedHistoryIndex((prev) => (prev < filteredHistory.length - 1 ? prev + 1 : 0));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedHistoryIndex((prev) => (prev > 0 ? prev - 1 : filteredHistory.length - 1));
                    } else if (e.key === 'Enter' && selectedHistoryIndex >= 0 && selectedHistoryIndex < filteredHistory.length) {
                      e.preventDefault();
                      handleSelectHistoryItem(filteredHistory[selectedHistoryIndex]);
                    } else if (e.key === 'Escape') {
                      setShowHistoryDropdown(false);
                    }
                  }
                }}
                placeholder="Enter Applicant ID or License Number (e.g. 8628075 or 01-06-00123456)"
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-[#030914] border-2 border-slate-300 dark:border-[#1e293b] focus:border-blue-600 dark:focus:border-blue-500 rounded-lg text-sm font-bold font-mono text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-600 dark:focus:ring-blue-500 shadow-xs dark:shadow-inner transition-all"
                autoComplete="off"
                spellCheck="false"
              />

              {/* Clear quick text icon */}
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSelectedHistoryIndex(-1);
                  }}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {/* History / Probable Previous Entry Dropdown matching light & dark themes */}
              {showHistoryDropdown && filteredHistory.length > 0 && (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white dark:bg-[#071325] border-2 border-slate-300 dark:border-[#1a2d4c] rounded-xl overflow-hidden shadow-2xl divide-y divide-slate-100 dark:divide-[#0f2139] animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  {filteredHistory.map((item, index) => {
                    const isSelected = selectedHistoryIndex === index;
                    return (
                      <div
                        key={item}
                        onClick={() => handleSelectHistoryItem(item)}
                        onMouseEnter={() => setSelectedHistoryIndex(index)}
                        className={`w-full px-4 py-2.5 sm:py-3 flex items-center justify-between transition-colors cursor-pointer group ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-[#0d2342] text-blue-700 dark:text-[#22D3EE]'
                            : 'hover:bg-slate-50 dark:hover:bg-[#0a1b32] text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Clock
                            className={`w-4 h-4 shrink-0 transition-colors ${
                              isSelected ? 'text-blue-600 dark:text-[#22D3EE]' : 'text-blue-500 dark:text-[#22D3EE]/80'
                            }`}
                          />
                          <span
                            className={`font-mono text-xs sm:text-sm tracking-wider truncate ${
                              isSelected
                                ? 'text-blue-700 dark:text-[#22D3EE] font-bold'
                                : 'text-slate-800 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-[#22D3EE] font-medium'
                            }`}
                          >
                            {item}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleRemoveHistoryItem(e, item)}
                          title="Remove from search history"
                          className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-slate-700/50 transition-colors ml-2 shrink-0 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SEARCH BUTTON (Vibrant Blue/Indigo) */}
            <button
              type="submit"
              disabled={searching}
              className="px-6 py-2.5 bg-[#3B52F6] hover:bg-[#2563EB] active:bg-[#1D4ED8] text-white font-black text-xs uppercase tracking-wider rounded-lg shadow-md shadow-blue-900/20 dark:shadow-blue-900/40 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
            >
              {searching ? (
                <span>SEARCHING...</span>
              ) : (
                <span>SEARCH</span>
              )}
            </button>

            {/* RESET BUTTON (Vibrant Emerald / Teal) */}
            <button
              type="button"
              onClick={handleResetSearch}
              className="px-5 py-2.5 bg-[#059669] hover:bg-[#10B981] active:bg-[#047857] text-white font-black text-xs uppercase tracking-wider rounded-lg shadow-md shadow-emerald-950/20 dark:shadow-emerald-950/40 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shrink-0"
            >
              <span>RESET</span>
            </button>
          </div>
        </form>
      </div>

      {/* SEARCH ERROR / NOT FOUND ALERT */}
      {searchError && (
        <div className="bg-white dark:bg-[#0B1528] border-2 border-red-300 dark:border-[#1e2d4a] rounded-2xl p-5 sm:p-6 shadow-md dark:shadow-2xl space-y-2.5 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-[#EF4444] flex items-center justify-center text-white shrink-0 shadow-md">
              <X className="w-4 h-4 stroke-[3.5]" />
            </div>
            <h3 className="text-sm sm:text-base md:text-lg font-bold text-[#EF4444] tracking-tight">
              तपाईंको लाइसेन्स कार्ड हाल कार्यालयमा उपलब्ध छैन !!
            </h3>
          </div>
          <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 font-sans leading-relaxed pl-10 sm:pl-10">
            <p>
              प्रविष्ट नम्बर:{' '}
              <span className="font-bold underline text-slate-900 dark:text-white font-mono tracking-wide">
                {searchedQuery || searchInput}
              </span>{' '}
              को नवीकरण (Renewal) तथा नयाँ लाइसेन्स (New License) वा वर्ग थप (Category Add) को प्रयोगात्मक परीक्षा उत्तीर्ण गर्नुभएको हो भने कार्ड प्रिन्ट भई कार्यालय आइपुग्न केही समय लाग्न सक्छ। कृपया केही दिनपछि पुनः खोज्नुहोला।
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7.5. MULTI-RECORD COMPARISON BANNER (When 2+ Cards Exist)                  */}
      {/* ========================================================================= */}
      {matchingRecords.length > 1 && (
        <div className="w-full bg-linear-to-r from-blue-50/80 via-indigo-50/70 to-slate-50 dark:from-[#0b1b36] dark:via-[#09152b] dark:to-[#081022] rounded-2xl p-4 sm:p-5 border-2 border-blue-300 dark:border-[#204070] shadow-md dark:shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-600 dark:bg-blue-500 text-white flex items-center justify-center font-black text-sm shadow-xs shrink-0">
                {matchingRecords.length}
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-black text-blue-900 dark:text-blue-200 tracking-tight flex items-center gap-2">
                  <span>Multiple Records Found For This License Holder</span>
                  <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-blue-200/70 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 font-bold uppercase tracking-wider">
                    {matchingRecords.length} Legitimate Cards
                  </span>
                </h3>
                <p className="text-xs text-blue-700 dark:text-blue-300/80 font-medium">
                  Original and replacement/COPY license records are preserved as separate cards. Compare details below to process the latest card.
                </p>
              </div>
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
              Active: <span className="font-bold text-blue-600 dark:text-cyan-400">Card #{selectedRecordIndex + 1} of {matchingRecords.length}</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 8. RESULT CONTAINER: DISPLAY ALL SEARCHED RECORDS ONE BELOW ANOTHER        */}
      {/* ========================================================================= */}
      {recordsToDisplay.length > 0 && (
        <div className="space-y-6">
          {recordsToDisplay.map((rec, idx) => (
            <SearchResultCardItem
              key={rec.id || ('card-' + idx)}
              record={rec}
              index={idx}
              totalCards={recordsToDisplay.length}
              isSelected={idx === selectedRecordIndex}
              onSelect={() => {
                setSelectedRecordIndex(idx);
                setActiveRecord(rec);
              }}
              onRecordUpdated={(updatedRecord) => handleRecordUpdated(idx, updatedRecord)}
              onRequestDriverName={(targetRec, target, setReceiverFn) =>
                handleRequestDriverName(targetRec, target, setReceiverFn)
              }
              user={user}
              isSuperAdmin={isSuperAdmin}
              canDistribute={canDistribute}
              canResetDistribution={canResetDistribution}
              canMarkMissing={canMarkMissing}
              canUnmarkMissing={canUnmarkMissing}
              onHandoverSaved={(savedRec, rName) => handleHandoverSaved(savedRec, rName, idx)}
              setSaveSuccessMsg={setSaveSuccessMsg}
              setLastActionRecord={setLastActionRecord}
              setLastActionType={setLastActionType}
              loadStats={loadStats}
            />
          ))}
        </div>
      )}

      {/* ========================================================================= */}
      {/* FLOATING HANDOVER SUCCESS NOTIFICATION (Centered Floating Message)        */}
      {/* ========================================================================= */}
      {handoverSavedCard && (lastActionRecord || activeRecord || matchingRecords[0]) && (() => {
        const savedRecord = lastActionRecord || activeRecord || matchingRecords[0]!;
        const isSavedCodeUnlocked = isSuperAdmin || isDistributed(savedRecord);
        const { oldPart, newPart } = getCodesParts(savedRecord);
        return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setHandoverSavedCard(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            id="handover-success-card"
            onClick={(e) => e.stopPropagation()}
            className="bg-emerald-50/98 dark:bg-[#022419] border-2 border-emerald-500 dark:border-emerald-500/80 rounded-2xl p-5 sm:p-6 shadow-2xl shadow-emerald-950/40 max-w-4xl w-full space-y-4 animate-in zoom-in-95 duration-200 relative text-slate-800 dark:text-emerald-100"
          >
            {/* Top Row: Beautiful message with checkmark and dismiss button */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-emerald-600 dark:bg-emerald-500/20 border-2 border-emerald-600 dark:border-emerald-400 flex items-center justify-center text-white dark:text-emerald-300 shrink-0 shadow-xs">
                  <Check className="w-4 h-4 sm:w-5 sm:h-5 stroke-[3]" />
                </div>
                <p className="text-xs sm:text-sm md:text-[14px] font-bold text-emerald-950 dark:text-emerald-200 leading-snug tracking-tight">
                  {handoverSavedCard.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHandoverSavedCard(null)}
                className="text-emerald-700 hover:text-emerald-950 hover:bg-emerald-200/60 dark:text-emerald-400 dark:hover:text-white dark:hover:bg-emerald-800/40 p-1.5 rounded-lg transition-colors shrink-0 cursor-pointer"
                title="Dismiss notification"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>

            {/* Items just below with big fonts */}
            <div className="border-t-2 border-emerald-200 dark:border-emerald-500/30" />

            {(() => {
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-0.5">
                  {/* Item 1: FULL NAME */}
                  <div className="bg-white dark:bg-[#071912] border-2 border-slate-300 dark:border-emerald-500/50 hover:border-emerald-500 rounded-xl p-3.5 text-center flex flex-col justify-center items-center shadow-xs dark:shadow-inner transition-all">
                    <span className="text-[11px] sm:text-xs font-bold font-sans uppercase tracking-wider text-slate-700 dark:text-emerald-400 mb-1">
                      FULL NAME:
                    </span>
                    <span className="text-base sm:text-lg font-black font-sans uppercase text-slate-900 dark:text-white truncate max-w-full tracking-wide">
                      {savedRecord.holderName}
                    </span>
                  </div>

                  {/* Item 2: LICENSE NUMBER */}
                  <div className="bg-white dark:bg-[#071912] border-2 border-slate-300 dark:border-emerald-500/50 hover:border-emerald-500 rounded-xl p-3.5 text-center flex flex-col justify-center items-center shadow-xs dark:shadow-inner transition-all">
                    <span className="text-[11px] sm:text-xs font-bold font-sans uppercase tracking-wider text-slate-700 dark:text-emerald-400 mb-1">
                      LICENSE NUMBER:
                    </span>
                    <span className="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-white tracking-wide">
                      {savedRecord.licenseNumber || '---'}
                    </span>
                  </div>

                  {/* Item 3: APPLICANT ID */}
                  <div className="bg-white dark:bg-[#071912] border-2 border-slate-300 dark:border-emerald-500/50 hover:border-emerald-500 rounded-xl p-3.5 text-center flex flex-col justify-center items-center shadow-xs dark:shadow-inner transition-all">
                    <span className="text-[11px] sm:text-xs font-bold font-sans uppercase tracking-wider text-slate-700 dark:text-emerald-400 mb-1">
                      APPLICANT ID:
                    </span>
                    <span className="text-2xl sm:text-3xl lg:text-4xl font-black font-mono tracking-wider text-cyan-600 dark:text-[#22D3EE]">
                      {savedRecord.applicantId || savedRecord.applicationNumber || '---'}
                    </span>
                  </div>

                  {/* Item 4: CODE NO */}
                  <div className="bg-white dark:bg-[#071912] border-2 border-slate-300 dark:border-emerald-500/50 hover:border-emerald-500 rounded-xl p-3.5 text-center flex flex-col justify-center items-center shadow-xs dark:shadow-inner transition-all">
                    <span className="text-[11px] sm:text-xs font-bold font-sans uppercase tracking-wider text-slate-700 dark:text-emerald-400 mb-1">
                      CODE NO:
                    </span>
                    {isSavedCodeUnlocked ? (
                      <span className="text-2xl sm:text-3xl lg:text-4xl font-black font-mono tracking-wider inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                        <span className="text-2xl sm:text-3xl lg:text-4xl font-black font-mono tracking-wider text-blue-600 dark:text-[#22D3EE]">{oldPart}</span>
                        <span className="text-2xl sm:text-3xl lg:text-4xl font-black font-mono tracking-wider text-slate-400 dark:text-[#22D3EE]">/</span>
                        <span className="text-2xl sm:text-3xl lg:text-4xl font-black font-mono tracking-wider text-red-600 dark:text-[#EF4444]">{newPart}</span>
                      </span>
                    ) : (
                      <span className="text-xs sm:text-sm font-extrabold font-mono tracking-wide text-slate-800 dark:text-slate-200 uppercase">
                        LOCKED (SAVE REQUIRED)
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Bottom action button: OK / Close */}
            <div className="pt-1.5 flex justify-end">
              <button
                type="button"
                onClick={() => setHandoverSavedCard(null)}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all cursor-pointer flex items-center gap-2"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>ठिक छ (OK)</span>
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* DEPARTMENT CONFIRMATION MODAL (ON CLICK 'सवारी चालकको नाम प्रयोग गर्नुहोस्') */}
      {/* ========================================================================= */}
      {showDepartmentConfirmModal && (pendingDriverTarget?.record || activeRecord || matchingRecords[0]) && (() => {
        const targetDeptRecord = pendingDriverTarget?.record || activeRecord || matchingRecords[0]!;
        return (
        <div 
          id="department-confirm-modal-overlay"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          {/* Wide Horizontal Rectangular Dialog per PLSMS Design Rules */}
          <div 
            id="department-confirm-modal"
            className="w-full max-w-xl sm:max-w-2xl bg-white dark:bg-[#0c1a30] text-slate-900 dark:text-slate-100 rounded-2xl shadow-2xl border-2 border-slate-300 dark:border-[#1e345e] p-5 sm:p-7 space-y-4 font-sans relative overflow-hidden"
          >
            {/* Top Badge & Header */}
            <div className="text-center space-y-1 pb-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-300 dark:border-cyan-700/60 text-cyan-800 dark:text-cyan-300 text-[11px] font-mono font-black uppercase tracking-wider mb-1">
                <Building2 className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                <span>DEPARTMENT VERIFICATION • शाखा प्रमाणीकरण</span>
              </div>
              <h3 className="text-lg sm:text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-snug">
                के &apos;{resolveDepartmentDisplay(targetDeptRecord)}&apos; तपाईकोमा पर्छ ???
              </h3>
              <p className="text-xs sm:text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                IS {resolveDepartmentDisplay(targetDeptRecord)} YOURS?
              </p>
            </div>

            {/* Department Card matching Picture 2 */}
            <div className="bg-[#070e1c] border-2 border-[#1e2f4d] rounded-2xl py-4 sm:py-5 px-6 text-center flex flex-col justify-center items-center shadow-lg shadow-black/40 my-2">
              <span className="text-xs sm:text-[13px] font-black font-sans text-slate-200 uppercase tracking-[0.25em]">
                DEPARTMENT
              </span>
              <span className="text-xl sm:text-2xl md:text-3xl font-black text-[#22D3EE] uppercase tracking-wide text-center mt-1">
                {resolveDepartmentDisplay(targetDeptRecord)}
              </span>
            </div>

            {/* Explanatory Message Box */}
            <div className="bg-slate-50 dark:bg-[#071326] border-2 border-slate-200 dark:border-[#182c50] rounded-xl p-3.5 sm:p-4 text-xs sm:text-sm text-slate-700 dark:text-slate-300 space-y-2 leading-relaxed">
              <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0 animate-pulse" />
                <span>
                  सवारी चालक <strong>{targetDeptRecord.holderName}</strong> को नाम बुझिलिने व्यक्तिको रूपमा प्रयोग गर्नु अगाडि शाखा पुष्टि गर्नुहोस्:
                </span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] sm:text-xs pt-1">
                <div className="p-2.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200">
                  <strong className="block text-emerald-700 dark:text-emerald-400 font-bold mb-0.5">
                    ✓ &quot;YES&quot; थिचेमा:
                  </strong>
                  यो कार्ड तपाईंकै शाखा ({resolveDepartmentDisplay(targetDeptRecord)}) को हो भनी प्रमाणित भई सवारी चालकको नाम प्रयोग गरी वितरण प्रक्रिया जारी रहनेछ।
                </div>
                <div className="p-2.5 rounded-lg bg-rose-50/80 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800/60 text-rose-900 dark:text-rose-200">
                  <strong className="block text-rose-700 dark:text-rose-400 font-bold mb-0.5">
                    ✕ &quot;NO&quot; थिचेमा:
                  </strong>
                  यो कार्ड अर्को शाखाको भएकोले हालको खोजी परिणाम (Search Card Found) तुरुन्त रिसेट हुनेछ।
                </div>
              </div>
            </div>

            {/* Action Buttons Row: YES and NO in Horizontal Floating Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-3 border-t-2 border-slate-200 dark:border-[#1e2d4a]">
              <button
                type="button"
                id="btn-department-confirm-no"
                onClick={handleConfirmDepartmentNo}
                className="w-full sm:w-auto px-6 py-3 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-black text-xs sm:text-sm rounded-xl transition-all shadow-md active:scale-98 cursor-pointer flex items-center justify-center gap-2 border border-rose-500"
              >
                <X className="w-4 h-4 stroke-[3]" />
                <span>NO (होइन / रिसेट गर्नुहोस्)</span>
              </button>

              <button
                type="button"
                id="btn-department-confirm-yes"
                onClick={handleConfirmDepartmentYes}
                className="w-full sm:w-auto px-8 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-xs sm:text-sm rounded-xl transition-all shadow-lg shadow-emerald-950/40 active:scale-98 cursor-pointer flex items-center justify-center gap-2 border border-emerald-500"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>YES (हो / जारी राख्नुहोस्)</span>
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* NOTICES MODAL                                                             */}
      {/* ========================================================================= */}
      {showNoticeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0b1528] border-2 border-slate-300 dark:border-[#1e2d4a] rounded-2xl max-w-2xl w-full p-6 text-slate-800 dark:text-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-200 dark:border-[#1e2d4a]">
              <div className="flex items-center gap-2.5">
                <Bell className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  कार्यालयको आधिकारिक सूचना (OFFICE NOTICES)
                </h3>
              </div>
              <button
                onClick={() => setShowNoticeModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
              <div className="p-3.5 bg-slate-50 dark:bg-[#070e1c] rounded-xl border-2 border-slate-200 dark:border-[#17253d] space-y-1">
                <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                  १. स्मार्ट कार्ड बुझ्न आउँदा ल्याउनुपर्ने कागजातहरू:
                </h4>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">
                  - सक्कल पुरानो स्मार्ट कार्ड वा सक्कल नागरिकताको प्रमाण पत्र ।<br />
                  - राजस्व बुझाएको सक्कल रसिद वा यातायात व्यवस्था कार्यालयको भौचर ।<br />
                  - अन्य व्यक्तिको कार्ड बुझ्न सिफारिस पत्र वा आधिकारिक मञ्जुरीनामा ।
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 dark:bg-[#070e1c] rounded-xl border-2 border-slate-200 dark:border-[#17253d] space-y-1">
                <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                  २. कार्यालय समय र वितरण काउन्टर:
                </h4>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">
                  - आइतबार देखि बिहीबार: बिहान १०:०० बजे देखि दिउँसो ३:०० बजे सम्म ।<br />
                  - शुक्रबार: बिहान १०:०० बजे देखि दिउँसो १:०० बजे सम्म ।<br />
                  - काउन्टर नं १ देखि ५ बाट एकैसाथ कार्ड वितरण भइरहेको छ ।
                </p>
              </div>
            </div>

            <div className="pt-3 border-t-2 border-slate-200 dark:border-[#1e2d4a] flex justify-end">
              <button
                onClick={() => setShowNoticeModal(false)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-cyan-600 dark:hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-sm"
              >
                बन्द गर्नुहोस् (Close)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

