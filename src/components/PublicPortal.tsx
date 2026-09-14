import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  CheckCircle2,
  AlertCircle,
  FileText,
  CreditCard,
  Building2,
  Calendar,
  ShieldCheck,
  Lock,
  Check,
  X,
  RefreshCw,
  RotateCcw,
  Megaphone,
  Paperclip,
  Pin,
  ChevronRight,
  ChevronLeft,
  Clock,
  ExternalLink,
  ListOrdered,
  Eye,
  Download,
  Printer,
} from 'lucide-react';
import { api } from '../services/api';
import { LicenseRecord, PublicSearchResult, OfficeNotice } from '../types';
import { formatDistributedDateBS } from '../utils/dateUtils';
import { resolveSubmittedDocument } from '../utils/staffUtils';
import {
  renderNoticeContentWithLinks,
  extractUrls,
  isGoogleDriveUrl,
  getUrlDisplayLabel,
} from '../utils/linkUtils';
import { safeStorage } from '../utils/storage';
import { formatLicenseOrApplicantInput } from '../utils/codeUtils';

interface DistributedGuidanceNoticeProps {
  receiverName: string;
}

const DistributedGuidanceNotice: React.FC<DistributedGuidanceNoticeProps> = ({ receiverName }) => {
  return (
    <div className="bg-emerald-50/40 dark:bg-[#070e1c] border border-emerald-200 dark:border-emerald-900/50 rounded-lg sm:rounded-xl p-3 sm:p-4 text-center space-y-2">
      <p className="text-[13px] sm:text-[17px] font-bold text-emerald-800 dark:text-emerald-400 leading-relaxed text-center">
        तपाईंको स्मार्ट कार्ड यस कार्यालयको कार्ड वितरण शाखाबाट{' '}
        <span className="text-white bg-emerald-800 px-1 sm:px-1.5 py-0.5 rounded font-black dark:bg-transparent dark:text-white dark:px-0 uppercase tracking-wide inline-block">
          {receiverName}
        </span>{' '}
        लाई बुझाई सकिएको छ ।
      </p>
      <p className="text-[11px] sm:text-[15px] font-bold text-emerald-800 dark:text-emerald-400 leading-relaxed text-center">
        थप सोधपुछ वा आवश्यक जानकारीका लागि कार्यालयको वितरण शाखामा सम्पर्क गर्नुहोला ।
      </p>
    </div>
  );
};

export const PublicPortal: React.FC = () => {
  const [searchInput, setSearchInput] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchResult, setSearchResult] = useState<PublicSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Official Public Notices State
  const [publicNotices, setPublicNotices] = useState<OfficeNotice[]>([]);
  const [showNoticesModal, setShowNoticesModal] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<'SEARCH_RECORDS' | 'NOTICES'>('SEARCH_RECORDS');
  const [loadingNotices, setLoadingNotices] = useState(false);
  const [noticeSearchQuery, setNoticeSearchQuery] = useState('');
  const [selectedNoticeId, setSelectedNoticeId] = useState<string | null>(null);
  const [viewingNoticeModal, setViewingNoticeModal] = useState<OfficeNotice | null>(null);
  const separateCardRef = useRef<HTMLDivElement>(null);

  const filteredPublicNotices = React.useMemo(() => {
    return publicNotices.filter((notice) => {
      if (!noticeSearchQuery.trim()) return true;
      const q = noticeSearchQuery.toLowerCase();
      const titleMatch = (notice.title || '').toLowerCase().includes(q);
      const contentMatch = (notice.content || '').toLowerCase().includes(q);
      const dateMatch = (notice.publishedDateBS || '').toLowerCase().includes(q);
      return titleMatch || contentMatch || dateMatch;
    });
  }, [publicNotices, noticeSearchQuery]);

  const activeSelectedNotice = React.useMemo(() => {
    if (!selectedNoticeId) return null;
    return publicNotices.find((n) => n.id === selectedNoticeId) || null;
  }, [publicNotices, selectedNoticeId]);

  const activeSelectedNoticeIndex = activeSelectedNotice
    ? filteredPublicNotices.findIndex((n) => n.id === activeSelectedNotice.id)
    : -1;

  // Clear notice selection whenever view changes (ensures no default selection on mobile or desktop)
  useEffect(() => {
    setSelectedNoticeId(null);
  }, [activeView]);

  const handleSelectNotice = (id: string, shouldScroll = true) => {
    // If clicking the already selected notice, toggle it off / deselect
    if (selectedNoticeId === id) {
      setSelectedNoticeId(null);
      return;
    }
    setSelectedNoticeId(id);
    if (shouldScroll) {
      setTimeout(() => {
        separateCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  };

  const handlePrevNotice = () => {
    if (activeSelectedNoticeIndex > 0) {
      handleSelectNotice(filteredPublicNotices[activeSelectedNoticeIndex - 1].id, false);
    }
  };

  const handleNextNotice = () => {
    if (activeSelectedNoticeIndex < filteredPublicNotices.length - 1) {
      handleSelectNotice(filteredPublicNotices[activeSelectedNoticeIndex + 1].id, false);
    }
  };

  const publicNavItems = [
    {
      id: 'SEARCH_RECORDS' as const,
      label: 'SEARCH SMART CARD',
      icon: Search,
      iconColor: 'text-cyan-500 dark:text-cyan-400',
      activeIconColor: 'text-cyan-200',
    },
    {
      id: 'NOTICES' as const,
      label: 'NOTICES',
      icon: Megaphone,
      iconColor: 'text-rose-500 dark:text-rose-400',
      activeIconColor: 'text-rose-200',
    },
  ];

  // Search history state for previous searchable entries
  const DEFAULT_SEARCH_HISTORY = [
    '01-02-00614488',
    '01-02-00769940',
    '7316547',
    '01-02-00857744',
    '01-02-89093407',
  ];

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const stored = safeStorage.getItem('plsms_recent_searches');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return DEFAULT_SEARCH_HISTORY;
  });

  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(-1);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  // Track last successfully counted query to prevent duplicate counting on repeated Search clicks without reset or text change
  const lastCountedQueryRef = useRef<string | null>(
    safeStorage.getItem('plsms_last_counted_search') || null
  );

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

  const fetchPublicNotices = () => {
    setLoadingNotices(true);
    api.getNotices(false)
      .then((data) => {
        if (data && Array.isArray(data)) {
          setPublicNotices(data);
        }
      })
      .catch((err) => {
        console.warn('Could not load public notices:', err);
      })
      .finally(() => {
        setLoadingNotices(false);
      });
  };

  useEffect(() => {
    // Load active public notices initially
    fetchPublicNotices();

    // Listen to real-time custom event triggered when admin creates or updates a notice
    const handleNoticesUpdated = () => {
      fetchPublicNotices();
    };

    window.addEventListener('plsms_notices_updated', handleNoticesUpdated);
    window.addEventListener('focus', fetchPublicNotices);

    return () => {
      window.removeEventListener('plsms_notices_updated', handleNoticesUpdated);
      window.removeEventListener('focus', fetchPublicNotices);
    };
  }, []);

  const executeSearch = async (queryText?: string) => {
    const q = (queryText !== undefined ? queryText : searchInput).trim();
    if (!q) {
      setSearchResult(null);
      setSearchAttempted(false);
      setSearchError(null);
      setSearchedQuery('');
      return;
    }

    saveToSearchHistory(q);
    setShowHistoryDropdown(false);
    setSelectedHistoryIndex(-1);

    // Strict increment condition: Only count on a fresh new license number/Applicant ID or after pressing RESET
    // Repeated clicks on Search button with the same input without reset do NOT increment
    const normalizedQ = q.toUpperCase().replace(/[\s\-_]/g, '');
    const isNewSearch = lastCountedQueryRef.current === null || lastCountedQueryRef.current !== normalizedQ;

    try {
      setSearching(true);
      setSearchAttempted(true);
      setSearchedQuery(q);
      setSearchError(null);
      setSearchResult(null);

      const res = await api.publicSearch(q, isNewSearch);
      
      // On new search execution, lock this query so clicking Search button again will NOT increment
      if (isNewSearch) {
        lastCountedQueryRef.current = normalizedQ;
        try {
          safeStorage.setItem('plsms_last_counted_search', normalizedQ);
        } catch (e) {}
      }

      if (typeof res?.visitorCount === 'number') {
        try {
          safeStorage.setItem('plsms_permanent_visitor_counter', String(res.visitorCount));
        } catch (e) {}
        window.dispatchEvent(
          new CustomEvent('plsms_visitor_counter_updated', {
            detail: res.visitorCount,
          })
        );
      }
      if (res && res.found) {
        setSearchResult(res);
        setSearchError(null);
      } else {
        setSearchResult(null);
        setSearchError(
          res?.message ||
            `तपाईंको लाइसेन्स कार्ड हाल कार्यालयमा उपलब्ध छैन !!`
        );
      }
    } catch (err: any) {
      setSearchResult(null);
      setSearchError(err.message || 'सवारी चालक अनुमतिपत्र खोजी गर्दा त्रुटि भयो। कृपया पुन: प्रयास गर्नुहोस् ।');
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
    setSearchResult(null);
    setSearchError(null);
    setSearchAttempted(false);
    setShowHistoryDropdown(false);
    setSelectedHistoryIndex(-1);
    // Explicitly reset counted query on Reset button click: allows the next search to count as a fresh search
    lastCountedQueryRef.current = null;
    try {
      safeStorage.removeItem('plsms_last_counted_search');
    } catch (e) {}
    api.resetSearchSession();
  };

  // Helper to extract category cleanly (e.g. K, A, B, etc.)
  const getCategoryDisplay = (record?: LicenseRecord | null, fallbackCategory?: string) => {
    if (!record) return fallbackCategory || 'K';
    if (record.vehicleClass && record.vehicleClass.trim()) {
      return record.vehicleClass.trim();
    }
    if (record.category && record.category.trim()) {
      return record.category.trim();
    }
    if (record.licenseType && record.licenseType.trim() && record.licenseType !== 'Smart Card') {
      return record.licenseType.trim();
    }
    return fallbackCategory || 'K';
  };

  const isDistributedCard = searchResult
    ? searchResult.status === 'DISTRIBUTED' ||
      searchResult.record?.status === 'DISTRIBUTED' ||
      String(searchResult.status || '').toUpperCase().includes('DISTRIBUTED') ||
      String(searchResult.record?.status || '').toUpperCase().includes('DISTRIBUTED') ||
      Boolean(searchResult.record?.isDistributed) ||
      Boolean(
        searchResult.record?.receivedBy &&
          searchResult.record.receivedBy.trim().length > 0 &&
          searchResult.record.receivedBy !== '-' &&
          searchResult.record.receivedBy !== '---' &&
          searchResult.record.receivedBy !== '<N/A>'
      ) ||
      Boolean(
        searchResult.record?.receiverName &&
          searchResult.record.receiverName.trim().length > 0 &&
          searchResult.record.receiverName !== '-' &&
          searchResult.record.receiverName !== '---' &&
          searchResult.record.receiverName !== '<N/A>'
      ) ||
      Boolean(searchResult.record?.distributedDate) ||
      Boolean(searchResult.record?.distributedAt)
    : false;

  const recordData = searchResult?.record;

  // Department and Counter Location logic:
  // If DEPARTMENT field is "कार्ड वितरण शाखा - 'क'" -> Collection Room: कोठा नं. १६, Distribution Room: कोठा नं. १७
  // If DEPARTMENT field is "कार्ड वितरण शाखा - 'ख'" -> Collection Room: कोठा नं. १४, Distribution Room: कोठा नं. १५
  const departmentFieldData = String(
    searchResult?.department ||
    recordData?.department ||
    searchResult?.office ||
    recordData?.office ||
    ''
  ).trim();

  // Specifically check for Branch Kha ('ख') without falsely matching the letter 'ख' inside the word 'शाखा'
  const isBranchKha = Boolean(
    departmentFieldData &&
    (/(?:शाखा|branch)\s*[-–—:]*\s*['"‘’“”]?\s*ख['"‘’“”]?/i.test(departmentFieldData) ||
      departmentFieldData.includes("'ख'") ||
      departmentFieldData.includes('"ख"') ||
      departmentFieldData.includes('‘ख’') ||
      departmentFieldData.includes('“ख”') ||
      /[-–—]\s*ख/i.test(departmentFieldData) ||
      /(?:^|\s)ख\s*$/i.test(departmentFieldData) ||
      /(?:branch|shakha)\s*[-–—:]*\s*b/i.test(departmentFieldData))
  );

  const counterCollectionRoom = isBranchKha ? 'कोठा नं. १४' : 'कोठा नं. १६';
  const counterDistributionRoom = isBranchKha ? 'कोठा नं. १५' : 'कोठा नं. १७';

  const defaultBranchName = isBranchKha ? "कार्ड वितरण शाखा - 'ख'" : "कार्ड वितरण शाखा - 'क'";

  let locationDisplayText = defaultBranchName;
  if (departmentFieldData) {
    if (isBranchKha) {
      locationDisplayText = "कार्ड वितरण शाखा - 'ख'";
    } else if (
      /(?:शाखा|branch)\s*[-–—:]*\s*['"‘’“”]?\s*क['"‘’“”]?/i.test(departmentFieldData) ||
      departmentFieldData.includes("'क'") ||
      departmentFieldData.includes('"क"') ||
      departmentFieldData.includes('‘क’') ||
      departmentFieldData.includes('“क”')
    ) {
      locationDisplayText = "कार्ड वितरण शाखा - 'क'";
    } else if (departmentFieldData.includes('शाखा')) {
      locationDisplayText = departmentFieldData;
    } else {
      locationDisplayText = defaultBranchName;
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-[#0B0F19] flex flex-col md:flex-row transition-colors duration-200">
      {/* Mobile Menus Bar (Exact to Picture 2: Touching horizontal line of Office banner, very tight borders around text) */}
      <div className="md:hidden bg-slate-50/95 dark:bg-[#070e1c] px-3 pt-1 pb-1 border-b border-slate-200/70 dark:border-slate-800/70 flex items-center justify-start transition-colors duration-200">
        <div className="inline-flex items-center p-[2px] rounded-lg border border-slate-300 dark:border-[#1a3152] bg-white dark:bg-[#071325]/90 shadow-2xs">
          <button
            type="button"
            id="mobile-menu-search-btn"
            onClick={() => {
              setSelectedNoticeId(null);
              setActiveView('SEARCH_RECORDS');
            }}
            className={`px-2 py-0.5 rounded-md text-[9.5px] font-bold tracking-wider uppercase transition-all cursor-pointer leading-tight ${
              activeView === 'SEARCH_RECORDS'
                ? 'border border-cyan-500 dark:border-[#00c0f0] bg-cyan-500/10 text-cyan-600 dark:text-[#00c0f0]'
                : 'border border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            SEARCH
          </button>
          <button
            type="button"
            id="mobile-menu-notices-btn"
            onClick={() => {
              setSelectedNoticeId(null);
              fetchPublicNotices();
              setActiveView('NOTICES');
            }}
            className={`px-2 py-0.5 rounded-md text-[9.5px] font-bold tracking-wider uppercase transition-all cursor-pointer leading-tight ${
              activeView === 'NOTICES'
                ? 'border border-cyan-500 dark:border-[#00c0f0] bg-cyan-500/10 text-cyan-600 dark:text-[#00c0f0]'
                : 'border border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            NOTICES
          </button>
        </div>
      </div>

      {/* Sidebar Navigation (Desktop only) */}
      <aside className="hidden md:block w-72 bg-white dark:bg-[#111827] border-r border-slate-200 dark:border-slate-800 p-4 space-y-2 shrink-0 transition-colors duration-200">
        <div className="px-3 py-2 text-[14.5px] font-black uppercase tracking-wider text-slate-900 dark:text-slate-200">
          Management Console
        </div>

        <nav className="space-y-1">
          {publicNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all whitespace-nowrap group cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-black'
                    : 'text-slate-800 dark:text-slate-300 hover:text-black dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 font-extrabold'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                    isActive ? item.activeIconColor : item.iconColor
                  }`}
                />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-3 sm:p-6 lg:p-8 w-full overflow-y-auto">
        {activeView === 'SEARCH_RECORDS' && (
          <div className="w-full max-w-5xl mx-auto space-y-4 sm:space-y-6 animate-in fade-in duration-300">
            {/* Title: PRINTED LICENSE SEARCH MANAGEMENT SYSTEM (Auto-fitted to 1 single line on all mobile screens) */}
            <div className="text-center py-0.5 sm:py-1 px-1">
              <h1 className="text-[11.5px] min-[360px]:text-[12.5px] min-[400px]:text-[14px] sm:text-lg md:text-xl lg:text-2xl font-bold text-slate-800 dark:text-white tracking-tight sm:tracking-widest uppercase font-mono drop-shadow-sm transition-colors whitespace-nowrap overflow-hidden text-ellipsis">
                PRINTED LICENSE SEARCH MANAGEMENT SYSTEM
              </h1>
            </div>

            {/* ========================================================================= */}
            {/* SEARCH BOX CONTAINER */}
            {/* ========================================================================= */}
        <div className="bg-white dark:bg-[#0B1528] rounded-xl p-3 sm:px-6 sm:py-4 border border-slate-200 dark:border-[#1e2d4a] shadow-md sm:shadow-2xl relative space-y-2.5 sm:space-y-3 transition-colors">
          {/* Top Note Notice */}
          <div className="text-center px-1">
            <p className="text-[11px] sm:text-[16px] font-medium text-slate-700 dark:text-slate-200 tracking-normal sm:tracking-wide leading-snug sm:leading-tight transition-colors">
              नोट: यस कार्यालयबाट नयाँ, वर्ग थप, नविकरण र प्रतिलिपिको सेवा लिएका{' '}
              <span className="font-bold text-slate-900 dark:text-white font-mono">License</span> मात्र{' '}
              <span className="font-bold text-slate-900 dark:text-white font-mono">Search</span> गर्नुहोस् ।
            </p>
          </div>

          {/* Search Form: Input + Search Button + Reset Button in the same line */}
          <form onSubmit={handleFormSubmit} className="relative">
            <div className="flex flex-row items-center gap-1.5 sm:gap-2">
              <div className="relative flex-1 min-w-0" ref={searchContainerRef}>
                <input
                  type="text"
                  value={searchInput}
                  maxLength={15}
                  onChange={(e) => {
                    const formatted = formatLicenseOrApplicantInput(e.target.value, searchInput);
                    setSearchInput(formatted);
                    // Do not show typing history on mobile screens (< 640px)
                    if (typeof window !== 'undefined' && window.innerWidth >= 640) {
                      setShowHistoryDropdown(true);
                    }
                    setSelectedHistoryIndex(-1);
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = e.clipboardData.getData('text');
                    const formatted = formatLicenseOrApplicantInput(text, '');
                    setSearchInput(formatted);
                    // Do not show typing history on mobile screens (< 640px)
                    if (typeof window !== 'undefined' && window.innerWidth >= 640) {
                      setShowHistoryDropdown(true);
                    }
                    setSelectedHistoryIndex(-1);
                  }}
                  onFocus={() => {
                    // Do not show typing history on mobile screens (< 640px)
                    if (typeof window !== 'undefined' && window.innerWidth < 640) {
                      setShowHistoryDropdown(false);
                      return;
                    }
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
                  placeholder="Applicant ID / License No"
                  className="w-full px-2.5 py-1.5 sm:px-4 sm:py-2.5 bg-slate-50 dark:bg-[#030914] border border-slate-300 dark:border-[#1e293b] focus:border-blue-500 rounded-lg text-xs sm:text-sm font-bold font-mono text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-inner transition-colors"
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
                      lastCountedQueryRef.current = null;
                      try {
                        safeStorage.removeItem('plsms_last_counted_search');
                      } catch (e) {}
                      api.resetSearchSession();
                    }}
                    className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 p-0.5 sm:p-1"
                  >
                    <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                )}

                {/* History / Probable Previous Entry Dropdown (hidden exclusively on mobile screens to keep view uncluttered) */}
                {showHistoryDropdown && filteredHistory.length > 0 && (
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    className="hidden sm:block absolute left-0 right-0 top-full mt-1.5 z-50 bg-white dark:bg-[#071325] border-2 border-slate-300 dark:border-[#1a2d4c] rounded-xl overflow-hidden shadow-2xl backdrop-blur-md divide-y divide-slate-100 dark:divide-[#0f2139] animate-in fade-in slide-in-from-top-1 duration-150"
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

              {/* Action Buttons: Search and Reset on the same line as input */}
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {/* SEARCH BUTTON */}
                <button
                  type="submit"
                  disabled={searching}
                  className="px-2 sm:px-6 py-1.5 sm:py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-black text-[10px] min-[360px]:text-[11px] sm:text-xs uppercase tracking-wider rounded-lg shadow-xs shadow-blue-600/20 dark:shadow-blue-900/40 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  {searching ? (
                    <>
                      <RefreshCw className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" />
                      <span className="hidden min-[360px]:inline">...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      <span>SEARCH</span>
                    </>
                  )}
                </button>

                {/* RESET BUTTON */}
                <button
                  type="button"
                  onClick={handleResetSearch}
                  className="px-2 sm:px-5 py-1.5 sm:py-2.5 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-black text-[10px] min-[360px]:text-[11px] sm:text-xs uppercase tracking-wider rounded-lg shadow-xs shadow-teal-600/20 dark:shadow-teal-950/40 transition-all active:scale-[0.98] flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span>RESET</span>
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* ========================================================================= */}
        {/* SEARCH ERROR / NOT FOUND ALERT                                            */}
        {/* ========================================================================= */}
        {searchError && (
          <div className="bg-white dark:bg-[#0B1528] border border-red-200 dark:border-[#1e2d4a] rounded-xl sm:rounded-2xl p-3.5 sm:p-6 shadow-md sm:shadow-2xl space-y-2 animate-in fade-in duration-200 transition-colors">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#EF4444] flex items-center justify-center text-white shrink-0 shadow-md">
                <X className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[3.5]" />
              </div>
              <h3 className="text-xs sm:text-base md:text-lg font-bold text-[#DC2626] dark:text-[#EF4444] tracking-tight">
                तपाईंको लाइसेन्स कार्ड हाल कार्यालयमा उपलब्ध छैन !!
              </h3>
            </div>
            <div className="text-[11px] sm:text-sm text-slate-700 dark:text-slate-200 font-sans leading-relaxed pl-8 sm:pl-10">
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
        {/* RESULT CONTAINER (Detailed 6-Card Single Result Scaled for Mobile/Desktop)  */}
        {/* ========================================================================= */}
        {searchResult && searchResult.found && (
          <div className="bg-white dark:bg-[#0B1528] rounded-xl sm:rounded-2xl p-2.5 sm:p-5 border border-slate-200 dark:border-[#1e2d4a] shadow-md sm:shadow-2xl space-y-2.5 sm:space-y-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300 transition-colors">
            {isDistributedCard ? (
              /* ========================================================================= */
              /* CITIZEN NOTIFICATION VIEW: ALREADY DISTRIBUTED (OPTION 2)                 */
              /* ========================================================================= */
              <div className="space-y-2.5 sm:space-y-3.5">
                {/* Header Status Indicator */}
                <div className="text-center">
                  <div className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-lg sm:rounded-xl bg-red-500/10 dark:bg-red-500/15 border border-red-500/30 dark:border-red-500/40 text-red-600 dark:text-[#EF4444] text-[10px] min-[360px]:text-[11px] sm:text-base font-black tracking-wider uppercase font-mono shadow-sm sm:shadow-md dark:shadow-red-950/30">
                    <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-600 dark:text-[#EF4444]" />
                    <span>✓ LICENSE ALREADY DISTRIBUTED</span>
                  </div>
                </div>

                {/* 4 Cards Grid (Option 2): Larger English Labels, Cyan Bold All-Caps Data */}
                <div className="grid grid-cols-2 gap-1.5 sm:gap-3.5">
                  {/* Card 1: APPLICANT NAME */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 sm:space-y-1.5 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span className="text-[11px] min-[360px]:text-xs sm:text-sm font-black font-sans text-slate-700 dark:text-slate-200 uppercase tracking-wide sm:tracking-wider">
                      APPLICANT NAME
                    </span>
                    <span className="text-[10px] min-[360px]:text-xs sm:text-sm md:text-base font-black text-cyan-600 dark:text-[#22D3EE] font-sans uppercase tracking-tight sm:tracking-wide dark:drop-shadow-[0_0_12px_rgba(34,211,238,0.25)] truncate max-w-full">
                      {((searchResult.holderName || recordData?.holderName || '----') as string).toUpperCase()}
                    </span>
                  </div>

                  {/* Card 2: LICENSE NUMBER */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 sm:space-y-1.5 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span className="text-[11px] min-[360px]:text-xs sm:text-sm font-black font-sans text-slate-700 dark:text-slate-200 uppercase tracking-wide sm:tracking-wider">
                      LICENSE NUMBER
                    </span>
                    <span className="text-xs min-[360px]:text-sm sm:text-base md:text-lg font-black text-cyan-600 dark:text-[#22D3EE] font-mono uppercase tracking-tight sm:tracking-wide dark:drop-shadow-[0_0_12px_rgba(34,211,238,0.25)] truncate max-w-full">
                      {((searchResult.licenseNumber || recordData?.licenseNumber || '----') as string).toUpperCase()}
                    </span>
                  </div>

                  {/* Card 3: DISTRIBUTED DATE */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 sm:space-y-1.5 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span className="text-[11px] min-[360px]:text-xs sm:text-sm font-black font-sans text-slate-700 dark:text-slate-200 uppercase tracking-wide sm:tracking-wider">
                      DISTRIBUTED DATE
                    </span>
                    <span className="text-xs min-[360px]:text-sm sm:text-base md:text-lg font-black text-cyan-600 dark:text-[#22D3EE] font-mono uppercase tracking-tight sm:tracking-wide dark:drop-shadow-[0_0_12px_rgba(34,211,238,0.25)] truncate max-w-full">
                      {(recordData?.distributedDate || recordData?.distributedAt
                        ? formatDistributedDateBS(recordData?.distributedDate || recordData?.distributedAt)
                        : '----').toUpperCase()}
                    </span>
                  </div>

                  {/* Card 4: DISTRIBUTED TO */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2.5 sm:p-4 text-center flex flex-col justify-center items-center space-y-1 sm:space-y-1.5 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span className="text-[11px] min-[360px]:text-xs sm:text-sm font-black font-sans text-slate-700 dark:text-slate-200 uppercase tracking-wide sm:tracking-wider">
                      DISTRIBUTED TO
                    </span>
                    <span className="text-[10px] min-[360px]:text-xs sm:text-sm md:text-base font-black text-cyan-600 dark:text-[#22D3EE] font-sans uppercase tracking-tight sm:tracking-wide dark:drop-shadow-[0_0_12px_rgba(34,211,238,0.25)] truncate max-w-full">
                      {((recordData?.receivedBy || recordData?.receiverName || searchResult.holderName || '----') as string).toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Option 2 Citizen Guidance Note with Dynamic Automatic Shrink Logic */}
                <DistributedGuidanceNotice
                  receiverName={((recordData?.receivedBy || recordData?.receiverName || searchResult.holderName || '----') as string).toUpperCase()}
                />
              </div>
            ) : (
              /* ========================================================================= */
              /* CITIZEN NOTIFICATION VIEW: AVAILABLE / READY FOR COLLECTION               */
              /* ========================================================================= */
              <>
                {/* Header Status Indicator */}
                <div className="text-center">
                  <div className="inline-flex items-center justify-center gap-1.5 sm:gap-2 pt-0.5 pb-0.5">
                    <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-[#10B981] flex items-center justify-center text-white shrink-0 shadow-sm shadow-emerald-950/40">
                      <Check className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 stroke-[3.5] text-white" />
                    </div>
                    <span className="text-sm sm:text-xl font-black text-emerald-600 dark:text-[#10B981] tracking-tight">
                      Smart Card Found
                    </span>
                  </div>
                </div>

                {/* 6 Metric / Info Cards Grid: Exactly 2 cols and 3 rows on mobile, 3 cols on desktop */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5 sm:gap-3.5">
                  {/* Card 1: APPLICANT ID (Col 1, Row 1) */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2 sm:p-4 text-center flex flex-col justify-center items-center space-y-0.5 sm:space-y-1 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span
                      style={{ fontWeight: 900 }}
                      className="text-[9px] min-[360px]:text-[10px] sm:text-xs md:text-sm font-black font-sans text-slate-700 dark:text-white uppercase tracking-tight sm:tracking-wide drop-shadow-none dark:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
                    >
                      APPLICANT ID
                    </span>
                    <span className="text-[10.5px] min-[360px]:text-[11.5px] sm:text-base md:text-lg font-black text-blue-600 dark:text-[#22D3EE] font-mono tracking-tight dark:drop-shadow-[0_0_12px_rgba(34,211,238,0.25)] truncate max-w-full">
                      {searchResult.applicantId || searchResult.applicationNumber || recordData?.applicantId || '----'}
                    </span>
                  </div>

                  {/* Card 2: FULL NAME (Col 2, Row 1) */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2 sm:p-4 text-center flex flex-col justify-center items-center space-y-0.5 sm:space-y-1 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span
                      style={{ fontWeight: 900 }}
                      className="text-[9px] min-[360px]:text-[10px] sm:text-xs md:text-sm font-black font-sans text-slate-700 dark:text-white uppercase tracking-tight sm:tracking-wide drop-shadow-none dark:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
                    >
                      FULL NAME
                    </span>
                    <span className="text-[10.5px] min-[360px]:text-[11.5px] sm:text-sm md:text-base font-black text-blue-600 dark:text-[#22D3EE] font-sans uppercase tracking-tight sm:tracking-wide dark:drop-shadow-[0_0_12px_rgba(34,211,238,0.25)] truncate max-w-full">
                      {searchResult.holderName || recordData?.holderName || '----'}
                    </span>
                  </div>

                  {/* Card 3: LICENSE NUMBER (Col 1, Row 2) */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2 sm:p-4 text-center flex flex-col justify-center items-center space-y-0.5 sm:space-y-1 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span
                      style={{ fontWeight: 900 }}
                      className="text-[9px] min-[360px]:text-[10px] sm:text-xs md:text-sm font-black font-sans text-slate-700 dark:text-white uppercase tracking-tight sm:tracking-wide drop-shadow-none dark:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
                    >
                      LICENSE NUMBER
                    </span>
                    <span className="text-[10.5px] min-[360px]:text-[11.5px] sm:text-base md:text-lg font-black text-blue-600 dark:text-[#22D3EE] font-mono tracking-tight dark:drop-shadow-[0_0_12px_rgba(34,211,238,0.25)] truncate max-w-full">
                      {searchResult.licenseNumber || recordData?.licenseNumber || '----'}
                    </span>
                  </div>

                  {/* Card 4: CATEGORY (Col 2, Row 2) */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2 sm:p-4 text-center flex flex-col justify-center items-center space-y-0.5 sm:space-y-1 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span
                      style={{ fontWeight: 900 }}
                      className="text-[9px] min-[360px]:text-[10px] sm:text-xs md:text-sm font-black font-sans text-slate-700 dark:text-white uppercase tracking-tight sm:tracking-wide drop-shadow-none dark:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
                    >
                      CATEGORY
                    </span>
                    <span className="text-[10.5px] min-[360px]:text-[11.5px] sm:text-base md:text-lg font-black text-blue-600 dark:text-[#22D3EE] font-mono tracking-tight dark:drop-shadow-[0_0_12px_rgba(34,211,238,0.25)]">
                      {getCategoryDisplay(recordData, searchResult.category)}
                    </span>
                  </div>

                  {/* Card 5: CODE NO (Col 1, Row 3) */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2 sm:p-4 text-center flex flex-col justify-center items-center space-y-0.5 sm:space-y-1 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span
                      style={{ fontWeight: 900 }}
                      className="text-[9px] min-[360px]:text-[10px] sm:text-xs md:text-sm font-black font-sans text-slate-700 dark:text-white uppercase tracking-tight sm:tracking-wide drop-shadow-none dark:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
                    >
                      CODE NO
                    </span>
                    <span className="text-[9px] min-[360px]:text-[10px] sm:text-xs md:text-sm font-bold font-mono tracking-tight sm:tracking-wide text-slate-500 dark:text-slate-300 uppercase">
                      LOCKED
                    </span>
                  </div>

                  {/* Card 6: DEPARTMENT (Col 2, Row 3 - completing exactly 2 columns and 3 rows on mobile) */}
                  <div className="bg-slate-50 dark:bg-[#070e1c] border border-slate-200 dark:border-[#1e2f4d] rounded-lg sm:rounded-xl p-2 sm:p-4 text-center flex flex-col justify-center items-center space-y-0.5 sm:space-y-1 shadow-sm dark:shadow-lg dark:shadow-black/40 hover:border-blue-400 dark:hover:border-[#2b4c80] transition-all">
                    <span
                      style={{ fontWeight: 900 }}
                      className="text-[9px] min-[360px]:text-[10px] sm:text-xs md:text-sm font-black font-sans text-slate-700 dark:text-white uppercase tracking-tight sm:tracking-wide drop-shadow-none dark:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
                    >
                      DEPARTMENT
                    </span>
                    <span className="text-[9px] min-[360px]:text-[10px] sm:text-xs md:text-base font-black text-blue-700 dark:text-[#22D3EE] uppercase tracking-tight sm:tracking-wide text-center leading-tight truncate max-w-full">
                      {searchResult.department || searchResult.office || recordData?.department || 'TRANSPORT MANAGEMENT OFFICE, ITAHARI'}
                    </span>
                  </div>
                </div>

                {/* READY FOR COLLECTION BANNER */}
                <div className="bg-emerald-50/60 dark:bg-[#071324] border border-emerald-200 dark:border-emerald-500/40 rounded-xl sm:rounded-2xl p-2.5 sm:p-6 space-y-2.5 sm:space-y-3.5 shadow-sm dark:shadow-xl transition-colors">
                  <div className="flex items-start sm:items-center gap-1.5 sm:gap-2 text-emerald-700 dark:text-emerald-400 border-b border-emerald-200 dark:border-emerald-500/20 pb-2 sm:pb-3">
                    <CheckCircle2 className="w-3.5 h-3.5 sm:w-5 sm:h-5 shrink-0 mt-0.5 sm:mt-0" />
                    <h4 className="text-[9.5px] min-[360px]:text-[10.5px] min-[400px]:text-[11.5px] sm:text-sm font-bold tracking-normal font-sans leading-tight sm:leading-snug flex-1">
                      तपाईको लाईसेन्स कार्यालयमा उपलब्ध छ । उक्त लाईसेन्स लिन आउँदा उल्लिखित कागजातहरू सहित कार्यालयमा सम्पर्क गर्नु होला ।
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-4 text-xs font-sans leading-relaxed">
                    <div className="space-y-1.5 sm:space-y-2 bg-white dark:bg-[#040C1A] p-2.5 sm:p-4 rounded-lg sm:rounded-xl border border-emerald-100 dark:border-[#172A47] shadow-sm transition-colors">
                      <div className="font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide text-[9.5px] sm:text-[11px] flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        अनिवार्य कागजातहरू (Required Documents)
                      </div>
                      <ul className="space-y-1 sm:space-y-2 text-slate-700 dark:text-slate-200 text-[10px] min-[360px]:text-[11px] sm:text-xs">
                        <li className="flex items-start gap-1.5">
                          <span className="text-emerald-500 dark:text-emerald-400 font-black text-xs leading-tight shrink-0">•</span>
                          <span>लाईसेन्स वापतको राजस्व बुझाएको सक्कल रसिद (Original Receipt Bill) ।</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="text-emerald-500 dark:text-emerald-400 font-black text-xs leading-tight shrink-0">•</span>
                          <span>सक्कल लाईसेन्स वा राजस्व बुझाएको सक्कल रसिद हराएको/नासिएको हकमा ट्राफिक कार्यालयको सिफारिस पत्र ।</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="text-emerald-500 dark:text-emerald-400 font-black text-xs leading-tight shrink-0">•</span>
                          <span>अनलाइन भुक्तानी गरेको भए सोको प्रिन्ट प्रतिलिपि (Online Payment Receipt) ।</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="text-emerald-500 dark:text-emerald-400 font-black text-xs leading-tight shrink-0">•</span>
                          <span>अन्य व्यक्तिले बुझिलिने भएमा सम्बन्धित व्यक्तिको मन्जुरीनामा र नागरिकता कपी।</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="text-emerald-500 dark:text-emerald-400 font-black text-xs leading-tight shrink-0">•</span>
                          <span>कार्ड वितरण कार्यको लागि सक्कल रसिद लिने समय: सोमबार देखि शुक्रबार (बिहान ९:३० देखि दिउँसो ४:०० सम्म) ।</span>
                        </li>
                      </ul>
                    </div>

                    <div className="space-y-1.5 sm:space-y-2 bg-white dark:bg-[#040C1A] p-2.5 sm:p-4 rounded-lg sm:rounded-xl border border-emerald-100 dark:border-[#172A47] shadow-sm transition-colors text-[10px] min-[360px]:text-[11px] sm:text-xs">
                      <div className="font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wide text-[9.5px] sm:text-[11px] flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5" />
                        कार्यालय तथा काउन्टर (Office & Counter Location)
                      </div>
                      {/* Karyalaya (Office) with hanging indent */}
                      <div className="flex items-start text-slate-700 dark:text-slate-300">
                        <strong className="shrink-0">कार्यालय</strong>
                        <span className="font-bold px-1 shrink-0">:</span>
                        <span className="flex-1 min-w-0 leading-snug">
                          यातायात व्यवस्था कार्यालय, सवारी चालक अनुमतिपत्र, ईटहरी, सुनसरी ।
                        </span>
                      </div>
                      {/* Sthan (Location & Counters) */}
                      <div className="space-y-1 text-slate-700 dark:text-slate-300">
                        <div className="flex items-start">
                          <strong className="shrink-0">स्थान</strong>
                          <span className="font-bold px-1 shrink-0">:</span>
                          <span className="flex-1 min-w-0 leading-snug">
                            कार्ड वितरण शाखा -{' '}
                            <strong className="text-emerald-800 dark:text-emerald-400 font-bold">
                              {isBranchKha ? "'ख'" : "'क'"}
                            </strong>
                          </span>
                        </div>
                        <div className="flex items-start">
                          <span className="shrink-0 select-none invisible" aria-hidden="true">
                            <strong className="opacity-0">स्थान</strong>
                          </span>
                          <span className="font-bold px-1 shrink-0">:</span>
                          <span className="flex-1 min-w-0 leading-snug">
                            पुरानो सक्कल लाइसेन्स वा रसिद बुझाउने ठाँउ (Collection Counter){' '}
                            <strong className="text-emerald-800 dark:text-emerald-400 font-bold">
                              {counterCollectionRoom}
                            </strong>
                          </span>
                        </div>
                        <div className="flex items-start">
                          <span className="shrink-0 select-none invisible" aria-hidden="true">
                            <strong className="opacity-0">स्थान</strong>
                          </span>
                          <span className="font-bold px-1 shrink-0">:</span>
                          <span className="flex-1 min-w-0 leading-snug">
                            स्मार्ट कार्ड वितरण काउन्टर (Distribution Counter){' '}
                            <strong className="text-emerald-800 dark:text-emerald-400 font-bold">
                              {counterDistributionRoom}
                            </strong>
                          </span>
                        </div>
                      </div>
                      {/* Samaya (Time) with hanging indent */}
                      <div className="flex items-start text-slate-700 dark:text-slate-300">
                        <strong className="shrink-0">समय</strong>
                        <span className="font-bold px-1 shrink-0">:</span>
                        <span className="flex-1 min-w-0 leading-snug">
                          सोमबार देखि शुक्रबार (बिहान ९:३० देखि दिउँसो ४:०० सम्म)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )}

    {/* ========================================================================= */}
    {/* NOTICES VIEW IN MAIN CONTENT AREA (Exact match to Admin Portal)           */}
    {/* ========================================================================= */}
    {activeView === 'NOTICES' && (
      <div className="w-full max-w-5xl mx-auto space-y-3 sm:space-y-6 animate-in fade-in duration-300">
        {/* Title: Centered NOTICES in Cyan */}
        <div className="text-center">
          <h1 className="text-xs min-[360px]:text-sm sm:text-base md:text-xl font-extrabold tracking-[0.2em] sm:tracking-[0.25em] text-[#00c0f0] uppercase select-none drop-shadow-sm">
            NOTICES
          </h1>
        </div>

        {/* Subheader: Auto-shrinking Megaphone icon, Title, Description, and Refresh Button for mobile */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 pt-0.5 sm:pt-1">
          <div className="space-y-0.5 sm:space-y-1 min-w-0 flex-1">
            <div className="flex items-center justify-between sm:justify-start gap-2">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <Megaphone className="w-3.5 h-3.5 min-[360px]:w-4 min-[360px]:h-4 sm:w-5 sm:h-5 text-[#00c0f0] shrink-0" />
                <h2 className="text-xs min-[360px]:text-sm sm:text-base md:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Official Notices & Announcements
                </h2>
              </div>
              {/* Mobile-only compact Refresh button directly in header row */}
              <button
                type="button"
                onClick={fetchPublicNotices}
                disabled={loadingNotices}
                className="sm:hidden px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-[#0c182b] dark:hover:bg-[#162A4A] text-slate-700 dark:text-slate-200 text-[10px] font-bold flex items-center gap-1 border border-slate-200 dark:border-[#162A4A] transition-all cursor-pointer shadow-2xs shrink-0"
                title="Refresh notices"
              >
                <RefreshCw className={`w-3 h-3 text-[#00c0f0] ${loadingNotices ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
            <p className="text-[10px] min-[360px]:text-[11px] sm:text-xs md:text-sm text-slate-600 dark:text-slate-300 font-medium max-w-2xl leading-snug">
              Keep up to date with license delivery schedules, physical document pickup days, and office bulletins.
            </p>
          </div>

          {/* Desktop Refresh Button */}
          <div className="hidden sm:flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={fetchPublicNotices}
              disabled={loadingNotices}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#0c182b] dark:hover:bg-[#162A4A] text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-2 border border-slate-200 dark:border-[#162A4A] transition-all cursor-pointer shadow-2xs"
              title="Refresh notices"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#00c0f0] ${loadingNotices ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Subtle Horizontal Divider */}
        <div className="border-b border-slate-200 dark:border-[#162A4A]/80 pt-0.5 sm:pt-1" />

        {/* Quick Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3 p-2 sm:p-3 rounded-xl sm:rounded-2xl bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162A4A] shadow-xs">
          <div className="flex-1 relative">
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500 dark:text-slate-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={noticeSearchQuery}
              onChange={(e) => setNoticeSearchQuery(e.target.value)}
              placeholder="Search official notices, keywords, dates..."
              className="w-full pl-8 sm:pl-9 pr-3 sm:pr-4 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-slate-50 dark:bg-[#060D1A] border border-slate-200 dark:border-[#162A4A] text-slate-900 dark:text-slate-200 text-[11px] sm:text-xs placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0088cc]"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center bg-slate-100 dark:bg-[#060D1A] rounded-lg sm:rounded-xl p-0.5 border border-slate-200 dark:border-[#162A4A] text-[10.5px] sm:text-xs font-bold">
              <span className="px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-md sm:rounded-lg bg-white dark:bg-[#0088cc] text-slate-950 dark:text-white shadow-xs">
                All ({filteredPublicNotices.length})
              </span>
            </div>
          </div>
        </div>

        {/* Notice List / Directory & Separate Display Card */}
        {loadingNotices ? (
          <div className="p-8 sm:p-12 text-center rounded-2xl border border-slate-200 dark:border-[#162A4A] bg-white dark:bg-[#070F1E]">
            <div className="w-7 h-7 sm:w-8 sm:h-8 mx-auto border-3 border-[#00c0f0] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest text-slate-400">
              Loading official announcements...
            </p>
          </div>
        ) : filteredPublicNotices.length === 0 ? (
          <div className="p-8 sm:p-12 text-center rounded-2xl border border-slate-200 dark:border-[#162A4A] bg-white dark:bg-[#070F1E] space-y-2 sm:space-y-3">
            <Megaphone className="w-8 h-8 sm:w-10 sm:h-10 text-slate-400 dark:text-slate-600 mx-auto" />
            <h3 className="text-sm sm:text-base font-bold text-slate-700 dark:text-slate-300">
              No Notices Found
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-500 max-w-md mx-auto">
              {noticeSearchQuery
                ? `No announcements matched your search for "${noticeSearchQuery}".`
                : 'There are currently no announcements published.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {/* 1. UPLOADED NOTICES NUMBERED DIRECTORY (1., 2., 3., ...) */}
            <div className="rounded-xl sm:rounded-2xl border border-slate-200 dark:border-[#162A4A] bg-white dark:bg-[#070F1E] shadow-xs overflow-hidden">
              {/* Directory Header Bar */}
              <div className="px-2.5 sm:px-4 py-2 sm:py-3 bg-slate-50 dark:bg-[#060D1A] border-b border-slate-200 dark:border-[#162A4A] flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <ListOrdered className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#0088cc] dark:text-[#00c0f0] shrink-0" />
                  <h3 className="text-[11px] sm:text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                    Official Notices List / प्रकाशित सूचनाहरूको सूची
                  </h3>
                  <span className="px-1.5 sm:px-2 py-0.5 rounded-full bg-[#0088cc]/10 text-[#0088cc] dark:text-[#00c0f0] text-[10px] sm:text-[11px] font-black">
                    {filteredPublicNotices.length}
                  </span>
                </div>
                <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Click any notice title to display full notice below ↓
                </span>
              </div>

              {/* Numbered Notice Items: 1., 2., 3., ... */}
              <div className="divide-y divide-slate-100 dark:divide-[#162A4A]/60">
                {filteredPublicNotices.map((notice, idx) => {
                  const isSelected = activeSelectedNotice?.id === notice.id;
                  const isUrgent = notice.priority === 'URGENT';
                  const isImportant = notice.priority === 'IMPORTANT';

                  return (
                    <div
                      key={notice.id}
                      id={`public-notice-item-${notice.id}`}
                      className={`p-2.5 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-2 sm:gap-3 transition-colors group/item ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-[#0088cc]/12 border-l-4 border-l-[#0088cc] dark:border-l-[#00c0f0]'
                          : 'hover:bg-slate-50/80 dark:hover:bg-[#0A1526]'
                      }`}
                    >
                      {/* Left: Index + Title link + Date BS directly after notice topic */}
                      <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
                        {/* Index badge: 1., 2., 3. */}
                        <span
                          className={`inline-flex items-center justify-center font-black text-[10.5px] sm:text-xs md:text-sm px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md sm:rounded-lg min-w-[24px] sm:min-w-[32px] shrink-0 border ${
                            isSelected
                              ? 'bg-[#0088cc] text-white border-[#0088cc] shadow-xs'
                              : 'bg-slate-100 dark:bg-[#0c182b] text-slate-800 dark:text-slate-200 border-slate-200 dark:border-[#162A4A]'
                          }`}
                        >
                          {idx + 1}.
                        </span>

                        {/* Title with link styling and date always just after notice topic */}
                        <div className="space-y-0.5 sm:space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 gap-y-1">
                            {notice.isPinned && (
                              <span
                                title="Pinned Notice"
                                className="p-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30 shrink-0"
                              >
                                <Pin className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-amber-500" />
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectNotice(notice.id, true);
                              }}
                              className={`font-bold text-[11.5px] min-[360px]:text-xs sm:text-sm text-left leading-snug break-words transition-colors hover:underline cursor-pointer ${
                                isSelected
                                  ? 'text-[#0088cc] dark:text-[#00c0f0]'
                                  : 'text-slate-900 dark:text-white group-hover/item:text-[#0088cc] dark:group-hover/item:text-[#00c0f0]'
                              }`}
                            >
                              {notice.title}
                            </button>

                            {/* Uploaded/Created Date BS — Always placed just after respective notice topic */}
                            <span className="inline-flex items-center gap-1 text-[10px] min-[360px]:text-[10.5px] sm:text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100/90 dark:bg-[#0c182b] px-1.5 sm:px-2 py-0.5 rounded-md border border-slate-200 dark:border-[#162A4A]/80 shrink-0 select-none">
                              <Calendar className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-400 shrink-0" />
                              <span>BS: {notice.publishedDateBS || '2083-05-15'}</span>
                            </span>

                            {isSelected && (
                              <span className="text-[9px] min-[360px]:text-[10px] font-black uppercase px-1.5 sm:px-2 py-0.5 rounded bg-blue-100 dark:bg-[#0088cc]/20 text-[#0088cc] dark:text-[#00c0f0] border border-[#0088cc]/30 shrink-0">
                                Displayed Below ↓
                              </span>
                            )}
                          </div>

                          {/* Additional Sub-meta: Attachment and Web link indicators */}
                          {(notice.attachment || extractUrls(notice.content).length > 0) && (
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-500 dark:text-slate-400 pt-0.5">
                              {notice.attachment && (
                                <span className="flex items-center gap-1 text-[#0088cc] dark:text-[#00c0f0] font-medium text-[10px] sm:text-xs">
                                  <Paperclip className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />
                                  <span className="truncate max-w-[130px] sm:max-w-[200px]">{notice.attachment.name}</span>
                                </span>
                              )}
                              {extractUrls(notice.content).length > 0 && (
                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[10px] sm:text-xs">
                                  <ExternalLink className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />
                                  <span>{extractUrls(notice.content).length} Web Link(s)</span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Badges & View Notice Action Button */}
                      <div
                        className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0 pt-1 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-[#162A4A]/50 justify-between md:justify-end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1">
                          {isUrgent && (
                            <span className="px-1.5 sm:px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[9px] min-[360px]:text-[10px] font-black uppercase animate-pulse">
                              URGENT
                            </span>
                          )}
                          {isImportant && (
                            <span className="px-1.5 sm:px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[9px] min-[360px]:text-[10px] font-black uppercase">
                              IMPORTANT
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSelectNotice(notice.id, true)}
                          className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-md sm:rounded-lg text-[10.5px] sm:text-xs font-bold flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-[#0088cc] text-white shadow-xs'
                              : 'bg-slate-100 hover:bg-[#0088cc] hover:text-white dark:bg-[#0c182b] dark:hover:bg-[#0088cc] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#162A4A]'
                          }`}
                          title="Display full notice card below"
                        >
                          <Eye className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          <span>{isSelected ? 'Viewing Below' : 'View Notice'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ============================================================ */}
            {/* 2. SEPARATE NOTICE DISPLAY CARD                               */}
            {/* (Displays ONLY when a notice title/link is clicked)           */}
            {/* ============================================================ */}
            {activeSelectedNotice && (
              <section
                ref={separateCardRef}
                id="public-selected-notice-display-card"
                className="scroll-mt-6 rounded-xl sm:rounded-2xl border-2 border-[#0088cc]/40 dark:border-[#0088cc]/50 bg-white dark:bg-[#070F1E] shadow-md transition-all duration-200 overflow-hidden"
              >
                {/* Card Top Navigation & Identity Bar */}
                <div className="px-2.5 py-2 sm:px-5 sm:py-3 bg-slate-50 dark:bg-[#060D1A] border-b border-slate-200 dark:border-[#162A4A] flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
                    <span className="p-1 sm:p-1.5 rounded-lg bg-[#0088cc]/10 text-[#0088cc] dark:text-[#00c0f0] border border-[#0088cc]/20 shrink-0">
                      <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </span>
                    <div className="min-w-0">
                      <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-[#0088cc] dark:text-[#00c0f0] block truncate">
                        Official Notice Display / पूर्ण आधिकारिक सूचना पत्र
                      </span>
                      <span className="text-[10.5px] sm:text-xs font-bold text-slate-700 dark:text-slate-300">
                        Notice #{activeSelectedNoticeIndex + 1} of {filteredPublicNotices.length}
                      </span>
                    </div>
                  </div>

                  {/* Navigation buttons: Prev, Next, Fullscreen/Print, Close X */}
                  <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={handlePrevNotice}
                      disabled={activeSelectedNoticeIndex <= 0}
                      title="Previous Notice"
                      className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg border border-slate-200 dark:border-[#162A4A] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-colors text-[10px] sm:text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      <span className="hidden min-[360px]:inline">Prev</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleNextNotice}
                      disabled={activeSelectedNoticeIndex >= filteredPublicNotices.length - 1}
                      title="Next Notice"
                      className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg border border-slate-200 dark:border-[#162A4A] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-colors text-[10px] sm:text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <span className="hidden min-[360px]:inline">Next</span>
                      <ChevronRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setViewingNoticeModal(activeSelectedNotice)}
                      title="Open notice in modal dialog / print"
                      className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg border border-cyan-400/40 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-950/50 text-[10px] sm:text-xs font-bold flex items-center gap-1 sm:gap-1.5 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#00c0f0]" />
                      <span className="hidden min-[420px]:inline">Fullscreen / Print</span>
                    </button>

                    {/* X (Close) Button at Top Right Corner */}
                    <button
                      type="button"
                      onClick={() => setSelectedNoticeId(null)}
                      title="Close Notice (X)"
                      aria-label="Close Notice"
                      className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 text-[10px] min-[360px]:text-[11px] sm:text-xs font-black flex items-center gap-1 transition-all cursor-pointer shadow-xs ml-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Close</span>
                    </button>
                  </div>
                </div>

                {/* Card Content Area */}
                <div className="p-3 sm:p-7 space-y-3.5 sm:space-y-5">
                  {/* Notice Title & Date Row */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-3 pb-3 sm:pb-4 border-b border-slate-200 dark:border-[#162A4A]/80">
                    <div className="space-y-1 sm:space-y-2 min-w-0 flex-1">
                      <div className="flex items-start gap-1.5 sm:gap-2">
                        {activeSelectedNotice.isPinned && (
                          <span
                            title="Pinned Notice"
                            className="shrink-0 mt-0.5 p-0.5 sm:p-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30"
                          >
                            <Pin className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-amber-500" />
                          </span>
                        )}
                        <h2 className="text-sm min-[360px]:text-base sm:text-xl font-black text-slate-900 dark:text-white leading-snug tracking-tight break-words">
                          {activeSelectedNotice.title}
                        </h2>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[9px] min-[360px]:text-[10px] font-bold uppercase tracking-wider">
                        {activeSelectedNotice.priority === 'URGENT' && (
                          <span className="px-1.5 sm:px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-500 animate-pulse">
                            URGENT ADVISORY
                          </span>
                        )}
                        {activeSelectedNotice.priority === 'IMPORTANT' && (
                          <span className="px-1.5 sm:px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
                            IMPORTANT
                          </span>
                        )}
                        <span className="px-1.5 sm:px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-[#00c0f0]">
                          {activeSelectedNotice.category || 'OFFICIAL ANNOUNCEMENT'}
                        </span>
                      </div>
                    </div>

                    {/* Calendar Date BS */}
                    <div className="flex items-center gap-1 text-[11px] sm:text-sm font-bold text-slate-800 dark:text-slate-300 shrink-0 bg-slate-100 dark:bg-[#0c182b] px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg sm:rounded-xl border border-slate-200 dark:border-[#162A4A] self-start select-none">
                      <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-slate-700 dark:text-slate-400 shrink-0" />
                      <span>BS: {activeSelectedNotice.publishedDateBS || '2083-05-15'}</span>
                    </div>
                  </div>

                  {/* Notice Body */}
                  <div className="text-slate-900 dark:text-slate-200 leading-relaxed text-xs min-[360px]:text-[13px] sm:text-base break-words">
                    {renderNoticeContentWithLinks(activeSelectedNotice.content, {
                      textColorClass: 'text-slate-900 dark:text-slate-200',
                      textSizeClass: 'text-xs min-[360px]:text-[13px] sm:text-base leading-relaxed',
                    })}
                  </div>

                  {/* External Web / Cloud Document Links */}
                  {extractUrls(activeSelectedNotice.content).length > 0 && (
                    <div className="space-y-1.5 sm:space-y-2 pt-1 sm:pt-2">
                      <div className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Linked Cloud Documents & External Links:
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        {extractUrls(activeSelectedNotice.content).map((url, uIdx) => {
                          const isDrive = isGoogleDriveUrl(url);
                          return (
                            <a
                              key={uIdx}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 sm:px-3.5 sm:py-2 rounded-lg sm:rounded-xl bg-cyan-50 dark:bg-[#00c0f0]/10 border border-cyan-200 dark:border-[#00c0f0]/30 text-[10.5px] sm:text-xs font-bold text-[#0088cc] dark:text-[#00c0f0] hover:bg-cyan-100 dark:hover:bg-[#00c0f0]/20 transition-all shadow-2xs group/ext cursor-pointer max-w-full"
                              title={`Open ${url}`}
                            >
                              <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#00c0f0] group-hover/ext:scale-110 transition-transform shrink-0" />
                              <span className="truncate max-w-[200px] min-[360px]:max-w-[240px] sm:max-w-md">
                                {isDrive ? 'Open Google Drive File / List' : `Open Link: ${getUrlDisplayLabel(url)}`}
                              </span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Attachment if present */}
                  {activeSelectedNotice.attachment && (
                    <div className="p-2.5 sm:p-3.5 rounded-lg sm:rounded-xl bg-slate-100 dark:bg-[#0c182b] border border-slate-200 dark:border-[#162A4A] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 text-[11px] sm:text-xs font-semibold">
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#00c0f0] shrink-0" />
                        <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[180px] sm:max-w-sm">
                          {activeSelectedNotice.attachment.name}
                        </span>
                        <span className="text-[10px] sm:text-[11px] text-slate-400 shrink-0">
                          ({(activeSelectedNotice.attachment.size / 1024).toFixed(0)} KB)
                        </span>
                      </div>
                      <a
                        href={activeSelectedNotice.attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-md sm:rounded-lg bg-[#0088cc] hover:bg-[#0099e6] text-white font-bold text-[10.5px] sm:text-xs inline-flex items-center justify-center gap-1.5 transition-colors shadow-xs shrink-0 self-start sm:self-auto"
                      >
                        <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span>Download Attachment</span>
                      </a>
                    </div>
                  )}

                  {/* Bottom Footer Row: Published By */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-slate-200 dark:border-[#162A4A]/70">
                    <div className="text-[10.5px] sm:text-xs text-slate-700 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold">Published by:</span>
                      <span className="inline-flex items-center">
                        <span className="font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          SUPER ADMIN
                        </span>
                        <span className="font-black text-slate-400 dark:text-slate-500 mx-0.5">-</span>
                        <span className="font-black uppercase tracking-wider text-[#15803d] dark:text-[#34d399]">
                          {(activeSelectedNotice.authorName && activeSelectedNotice.authorName !== 'Super Administrator'
                            ? activeSelectedNotice.authorName
                            : 'KOMAL DAHAL').toUpperCase()}
                        </span>
                      </span>
                    </div>

                    <div className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400">
                      Department: <span className="font-bold text-slate-700 dark:text-slate-300">{activeSelectedNotice.department || 'Department - क & Department - ख'}</span>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    )}
  </main>

  {/* ========================================================================= */}
  {/* FULLSCREEN / PRINT NOTICE MODAL DIALOG                                     */}
  {/* ========================================================================= */}
  {viewingNoticeModal && (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-white dark:bg-[#070F1E] rounded-2xl border border-slate-200 dark:border-[#162A4A] shadow-2xl overflow-hidden">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-[#162A4A] bg-slate-50 dark:bg-[#060D1A] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-lg bg-[#0088cc]/10 text-[#0088cc] dark:text-[#00c0f0] border border-[#0088cc]/20 shrink-0">
              <Megaphone className="w-4 h-4" />
            </span>
            <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 truncate">
              Official Notice Details / आधिकारिक सूचना
            </span>
          </div>
          <button
            type="button"
            onClick={() => setViewingNoticeModal(null)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-7 overflow-y-auto space-y-5 flex-1">
          <div className="space-y-2 pb-4 border-b border-slate-200 dark:border-[#162A4A]">
            <div className="flex items-start gap-2">
              {viewingNoticeModal.isPinned && (
                <span className="shrink-0 mt-0.5 p-1 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/30">
                  <Pin className="w-4 h-4 fill-amber-500" />
                </span>
              )}
              <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white leading-snug tracking-tight break-words">
                {viewingNoticeModal.title}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-[#0c182b] px-2.5 py-1 rounded-md border border-slate-200 dark:border-[#162A4A] text-slate-700 dark:text-slate-300 font-bold">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>BS: {viewingNoticeModal.publishedDateBS || '2083-05-15'}</span>
              </span>
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-[#00c0f0] font-bold text-[10px] uppercase">
                {viewingNoticeModal.category || 'OFFICIAL ANNOUNCEMENT'}
              </span>
            </div>
          </div>

          {/* Notice Body */}
          <div className="text-slate-900 dark:text-slate-200 text-sm sm:text-base leading-relaxed break-words whitespace-pre-wrap">
            {renderNoticeContentWithLinks(viewingNoticeModal.content, {
              textColorClass: 'text-slate-900 dark:text-slate-200',
              textSizeClass: 'text-sm sm:text-base leading-relaxed',
            })}
          </div>

          {/* Linked URLs */}
          {extractUrls(viewingNoticeModal.content).length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                External & Cloud Document Links:
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {extractUrls(viewingNoticeModal.content).map((url, uIdx) => {
                  const isDrive = isGoogleDriveUrl(url);
                  return (
                    <a
                      key={uIdx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-cyan-50 dark:bg-[#00c0f0]/10 border border-cyan-200 dark:border-[#00c0f0]/30 text-xs font-bold text-[#0088cc] dark:text-[#00c0f0] hover:bg-cyan-100 dark:hover:bg-[#00c0f0]/20 transition-all cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[#00c0f0] shrink-0" />
                      <span className="truncate max-w-[260px] sm:max-w-md">
                        {isDrive ? 'Open Google Drive File / List' : `Open Link: ${getUrlDisplayLabel(url)}`}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Attachment */}
          {viewingNoticeModal.attachment && (
            <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-[#0c182b] border border-slate-200 dark:border-[#162A4A] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip className="w-4 h-4 text-[#00c0f0] shrink-0" />
                <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-xs">
                  {viewingNoticeModal.attachment.name}
                </span>
                <span className="text-[11px] text-slate-400">
                  ({(viewingNoticeModal.attachment.size / 1024).toFixed(0)} KB)
                </span>
              </div>
              <a
                href={viewingNoticeModal.attachment.url}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg bg-[#0088cc] hover:bg-[#0099e6] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-colors shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Attachment</span>
              </a>
            </div>
          )}

          {/* Published by footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-[#162A4A]/60 text-xs text-slate-500">
            <div>
              Published by:{' '}
              <span className="font-black text-indigo-600 dark:text-indigo-400">
                SUPER ADMIN
              </span>
              <span className="mx-1 text-slate-400">-</span>
              <span className="font-black text-[#15803d] dark:text-[#34d399]">
                {(viewingNoticeModal.authorName && viewingNoticeModal.authorName !== 'Super Administrator'
                  ? viewingNoticeModal.authorName
                  : 'KOMAL DAHAL').toUpperCase()}
              </span>
            </div>
            <div>
              Department:{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {viewingNoticeModal.department || 'Department - क & Department - ख'}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Action Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-[#162A4A] bg-slate-50 dark:bg-[#060D1A] flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-[#162A4A] bg-white dark:bg-[#0B1528] text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Printer className="w-3.5 h-3.5 text-[#00c0f0]" />
            <span>Print Notice</span>
          </button>
          <button
            type="button"
            onClick={() => setViewingNoticeModal(null)}
            className="px-4 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )}
    </div>
  );
};
