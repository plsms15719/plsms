import React, { useState, useEffect, useRef } from 'react';
import {
  Megaphone,
  Plus,
  Calendar,
  Pencil,
  Upload,
  XCircle,
  CheckCircle2,
  Trash2,
  FileText,
  Type,
  Bold,
  Italic,
  Palette,
  Highlighter,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Paperclip,
  X,
  Eye,
  AlertTriangle,
  Pin,
  Search,
  Filter,
  Download,
  FileSpreadsheet,
  Check,
  RotateCcw,
  Sparkles,
  ChevronDown,
  Clock,
  Building,
  Tag,
  ExternalLink,
  Link as LinkIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { OfficeNotice, NoticeAttachment } from '../../types';
import { api } from '../../services/api';
import { getNepaliDate } from '../../utils/dateUtils';
import { useAuth } from '../../context/AuthContext';
import { NepaliDatePicker } from '../common/NepaliDatePicker';
import { safeStorage } from '../../utils/storage';
import { hasPermission } from '../../utils/permissions';
import {
  renderNoticeContentWithLinks,
  extractUrls,
  isGoogleDriveUrl,
  getUrlDisplayLabel,
} from '../../utils/linkUtils';

export const formatNoticeUserRoleUpper = (roleStr?: string): string => {
  const clean = (roleStr || '').trim().toUpperCase().replace(/_/g, ' ');
  if (!clean || clean.includes('TRANSPORT') || clean.includes('OFFICE')) return 'SUPER ADMIN';
  if (clean === 'SUPER ADMIN' || clean.includes('SUPER')) return 'SUPER ADMIN';
  if (clean === 'ADMIN' || clean.includes('ADMINISTRATOR')) return 'ADMINISTRATOR';
  if (clean === 'DATA ENTRY OFFICER' || clean.includes('ENTRY')) return 'DATA ENTRY OFFICER';
  return clean;
};

export const getNoticeRoleColorClass = (roleStr?: string): string => {
  const upper = formatNoticeUserRoleUpper(roleStr);
  if (upper === 'SUPER ADMIN') {
    return 'text-amber-600 dark:text-amber-400';
  }
  if (upper === 'ADMINISTRATOR') {
    return 'text-cyan-600 dark:text-cyan-400';
  }
  return 'text-emerald-600 dark:text-emerald-400';
};

export const NoticesView: React.FC = () => {
  const { user } = useAuth();
  const roleOfLoginUser = formatNoticeUserRoleUpper(user?.role || 'SUPER ADMIN');
  const roleColorClass = getNoticeRoleColorClass(roleOfLoginUser);

  // Notices state
  const [notices, setNotices] = useState<OfficeNotice[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // View state: 'LIST' | 'CREATE' | 'EDIT'
  const [viewMode, setViewMode] = useState<'LIST' | 'CREATE' | 'EDIT'>('LIST');
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL');

  // Selected notice for the separate full notice display card
  const [selectedNoticeId, setSelectedNoticeId] = useState<string | null>(null);
  const separateCardRef = useRef<HTMLDivElement>(null);

  // Form state
  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [publishedDateBS, setPublishedDateBS] = useState<string>('');
  const [publishedBy, setPublishedBy] = useState<string>(() => roleOfLoginUser);
  const [priority, setPriority] = useState<'NORMAL' | 'IMPORTANT' | 'URGENT'>('NORMAL');
  const [isPinned, setIsPinned] = useState<boolean>(false);
  const [attachment, setAttachment] = useState<NoticeAttachment | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState<boolean>(false);
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);

  // Editor toolbar dropdowns
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
  const [colorDropdownOpen, setColorDropdownOpen] = useState(false);
  const [highlightDropdownOpen, setHighlightDropdownOpen] = useState(false);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);

  // Dedicated URL pasting area state
  const [urlToPaste, setUrlToPaste] = useState<string>('');

  // Direct file upload modal for card "UPLOAD FILE" button
  const [uploadModalNotice, setUploadModalNotice] = useState<OfficeNotice | null>(null);
  const [modalUploading, setModalUploading] = useState<boolean>(false);

  // Notice detail reading modal for all users
  const [viewingNoticeModal, setViewingNoticeModal] = useState<OfficeNotice | null>(null);

  // Delete confirmation modal
  const [deleteConfirmNotice, setDeleteConfirmNotice] = useState<OfficeNotice | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Attachment preview modal
  const [previewAttachment, setPreviewAttachment] = useState<NoticeAttachment | null>(null);

  // Role validation: Super Admin or Administrator has full write/modify permissions
  const isSuperAdmin = Boolean(
    user && (
      user.role === 'SUPER_ADMIN' ||
      user.role === 'SUPER ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'ADMINISTRATOR' ||
      user.id?.toUpperCase() === 'SUPER_ADMIN' ||
      user.id?.toUpperCase() === 'DKOMAL_PLSMS5' ||
      user.id?.toUpperCase() === 'TMODLSUNSARI' ||
      user.permissions?.includes('*') ||
      user.permissions?.includes('notices.manage') ||
      user.permissions?.includes('settings.view') ||
      (typeof user.role === 'string' && user.role.toUpperCase().includes('ADMIN')) ||
      (typeof user.role === 'string' && user.role.toUpperCase().includes('SUPER'))
    )
  );

  // Super Admin ONLY check: Specifically excludes Admin User, Office Staffs, Data Entry Officer etc.
  const isStrictSuperAdmin = Boolean(
    user && (
      user.role === 'SUPER_ADMIN' ||
      user.role === 'SUPER ADMIN' ||
      user.id?.toUpperCase() === 'SUPER_ADMIN' ||
      user.id?.toUpperCase() === 'DKOMAL_PLSMS5' ||
      user.id?.toUpperCase() === 'TMODLSUNSARI' ||
      (typeof user.role === 'string' && user.role.toUpperCase().includes('SUPER'))
    ) && (
      user.role !== 'ADMIN' &&
      user.role !== 'ADMINISTRATOR' &&
      user.role !== 'DATA_ENTRY_OFFICER' &&
      user.role !== 'DATA ENTRY OFFICER' &&
      user.role !== 'OFFICE_STAFF' &&
      user.role !== 'STAFF'
    )
  );

  const canCreateNotice = hasPermission(user, 'notices.create');
  const canEditNotice = hasPermission(user, 'notices.edit');
  const canDeleteNotice = hasPermission(user, 'notices.delete');
  const canUploadNoticePdf = hasPermission(user, 'notices.upload_pdf');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalFileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Non-privileged users are kept in LIST view
  useEffect(() => {
    if (!canCreateNotice && !canEditNotice && viewMode !== 'LIST') {
      setViewMode('LIST');
    }
  }, [canCreateNotice, canEditNotice, viewMode]);

  // Auto-clear success message after 4s
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Load notices on mount with dual persistent caching
  const loadNotices = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getNotices(true);
      if (data && Array.isArray(data)) {
        setNotices(data);
        try {
          safeStorage.setItem('plsms_notices_cache', JSON.stringify(data));
        } catch {
          // ignore
        }
      } else {
        // Fallback to cache if server returned empty
        const cached = safeStorage.getItem('plsms_notices_cache');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setNotices(parsed);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to load notices:', err);
      // Fallback to cache if network fails
      const cached = safeStorage.getItem('plsms_notices_cache');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setNotices(parsed);
            setError(null);
            return;
          }
        } catch {
          // ignore
        }
      }
      setError(err.message || 'Failed to load notices from server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotices();
  }, []);

  // Initialize form for creation (Permission check)
  const handleOpenCreate = () => {
    if (!canCreateNotice) {
      alert('Access Denied: You do not have permission to create official announcements.');
      return;
    }
    setTitle('');
    setContent('');
    const todayBS = getNepaliDate(new Date());
    setPublishedDateBS(todayBS && todayBS !== '<N/A>' ? todayBS : '2083-05-15');
    setPublishedBy(roleOfLoginUser);
    setPriority('NORMAL');
    setIsPinned(false);
    setAttachment(null);
    setEditingNoticeId(null);
    setViewMode('CREATE');
  };

  // Initialize form for editing (Permission check)
  const handleOpenEdit = (notice: OfficeNotice) => {
    if (!canEditNotice) {
      alert('Access Denied: You do not have permission to edit official announcements.');
      return;
    }
    setTitle(notice.title);
    setContent(notice.content);
    setPublishedDateBS(notice.publishedDateBS || getNepaliDate(new Date()));
    setPublishedBy(formatNoticeUserRoleUpper(notice.publishedBy || roleOfLoginUser));
    setPriority(notice.priority || 'NORMAL');
    setIsPinned(Boolean(notice.isPinned));
    setAttachment(notice.attachment || null);
    setEditingNoticeId(notice.id);
    setViewMode('EDIT');
  };

  const handleCancelForm = () => {
    setViewMode('LIST');
    setEditingNoticeId(null);
  };

  // Editor formatting actions
  const applyTextWrap = (prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    const replacement = selected ? `${prefix}${selected}${suffix}` : `${prefix}Text${suffix}`;
    const newContent = text.substring(0, start) + replacement + text.substring(end);
    setContent(newContent);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + replacement.length - suffix.length);
    }, 50);
  };

  const applyFontStyle = (styleType: string) => {
    setFontDropdownOpen(false);
    if (styleType === 'H1') applyTextWrap('# ', '');
    else if (styleType === 'H2') applyTextWrap('## ', '');
    else if (styleType === 'LEAD') applyTextWrap('**[IMPORTANT] ', '**');
    else if (styleType === 'MONO') applyTextWrap('`', '`');
    else if (styleType === 'BLOCKQUOTE') applyTextWrap('> ', '');
  };

  const applyColor = (colorHex: string, label: string) => {
    setColorDropdownOpen(false);
    applyTextWrap(`<span style="color: ${colorHex}">`, '</span>');
  };

  const applyHighlight = (bgClass: string) => {
    setHighlightDropdownOpen(false);
    if (bgClass === 'none') return;
    applyTextWrap(`<mark style="background-color: ${bgClass}; padding: 2px 4px; border-radius: 4px">`, '</mark>');
  };

  // Insert a pasted URL directly into the notice content
  const handleInsertPastedUrl = (urlToInsert?: string) => {
    const rawUrl = (urlToInsert || urlToPaste).trim();
    if (!rawUrl) return;

    let formattedUrl = rawUrl;
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = 'https://' + formattedUrl;
    }

    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;

      // Ensure clean line breaks around pasted URL
      const needsLeadingBreak = start > 0 && text[start - 1] !== '\n';
      const needsTrailingBreak = end < text.length && text[end] !== '\n';

      const insertText = `${needsLeadingBreak ? '\n' : ''}${formattedUrl}${needsTrailingBreak ? '\n' : '\n'}`;
      const newContent = text.substring(0, start) + insertText + text.substring(end);
      setContent(newContent);

      setTimeout(() => {
        textarea.focus();
        const nextPos = start + insertText.length;
        textarea.setSelectionRange(nextPos, nextPos);
      }, 50);
    } else {
      setContent((prev) => (prev ? `${prev}\n${formattedUrl}\n` : formattedUrl));
    }

    setUrlToPaste('');
  };

  // Load standard smart card collection template
  const loadStandardCollectionTemplate = () => {
    setTemplateDropdownOpen(false);
    if (!content.trim() || confirm('Replace notice text with standard collection announcement template?')) {
      setTitle('Smart Driving License Cards Available for Collection');
      setContent(
        'Smart cards are available in the offices so we announce you to all to contact in office to collect your smart cards. Please bring your original application slip/receipt, citizenship certificate, and valid identification to collect your printed smart driving license.'
      );
    }
  };

  // Load exact Smart Card Alphabet Distribution Schedule template with Google Drive link slots (as per Yatayat / DoTM notice)
  const loadScheduleWithLinksTemplate = () => {
    setTemplateDropdownOpen(false);
    if (!content.trim() || confirm('Replace notice text with Smart Card Alphabet Distribution Schedule template with Google Drive link slots?')) {
      setTitle('सवारीचालक अनुमतिपत्र (Smart Card) वितरण सम्बन्धी समय तालिका');
      setContent(
`यस कार्यालयमा प्राप्त भएका सवारीचालक अनुमतिपत्रहरुको वितरण कार्यलाई व्यवस्थित, सहज र प्रभावकारी बनाउन देहाय बमोजिमको समय तालिका निर्धारण गरिएको व्यहोरा जानकारी गराउँदछौ ।

१- आफ्नो नामको पहिलो अक्षर (English Alphabet)--A,B भएका सेवाग्राहीहरुको सोमबारको दिन वितरण गरिनेछ । आफ्नो Smart Card आए नआएको एकिन गर्नको लागि तलको लिंकमा Click गर्नुहोला ।
https://drive.google.com/file/d/1RP_SAMPLE_DRIVE_LINK_A_B/view

२- आफ्नो नामको पहिलो अक्षर (English Alphabet)--C,D,E,F,G,H भएका सेवाग्राहीहरुको मंगलबारको दिन वितरण गरिनेछ । आफ्नो Smart Card आए नआएको एकिन गर्नको लागि तलको लिंकमा Click गर्नुहोला ।
https://drive.google.com/file/d/1-R0cAZwyaOy9htNgWcD_SAMPLE_LINK_C_H/view

३- आफ्नो नामको पहिलो अक्षर (English Alphabet)--I,J,K,L,M भएका सेवाग्राहीहरुको बुधबारको दिन वितरण गरिनेछ । आफ्नो Smart Card आए नआएको एकिन गर्नको लागि तलको लिंकमा Click गर्नुहोला ।
https://drive.google.com/file/d/1hpVkR0MclpBJHjupkeh_SAMPLE_LINK_I_M/view

४- आफ्नो नामको पहिलो अक्षर (English Alphabet)--N,O,P,Q,R भएका सेवाग्राहीहरुको बिहिबारको दिन वितरण गरिनेछ । आफ्नो Smart Card आए नआएको एकिन गर्नको लागि तलको लिंकमा Click गर्नुहोला ।
https://drive.google.com/file/d/1g_Xbu_SAMPLE_LINK_N_R/view

५- आफ्नो नामको पहिलो अक्षर (English Alphabet)--S,T,U,V,W,X,Y,Z भएका सेवाग्राहीहरुको शुक्रबार दिन वितरण गरिनेछ । आफ्नो Smart Card आए नआएको एकिन गर्नको लागि तलको लिंकमा Click गर्नुहोला ।
https://drive.google.com/file/d/1rTuA9RYqWHGzujlzB_SAMPLE_LINK_S_Z/view`
      );
    }
  };

  // Handle attachment file upload for form
  const handleAttachmentFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (15MB)
    if (file.size > 15 * 1024 * 1024) {
      alert('File size exceeds 15MB limit.');
      return;
    }

    try {
      setUploadingAttachment(true);
      const res = await api.uploadNoticeAttachment(file);
      if (res && res.attachment) {
        setAttachment(res.attachment);
        setSuccessMessage(`Attachment "${file.name}" uploaded successfully`);
      }
    } catch (err: any) {
      console.error('Attachment upload failed:', err);
      alert(err.message || 'Failed to upload attachment.');
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Submit Notice (Create or Update - Admin or Super Admin)
  const handleSubmitNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      alert('Forbidden: Administrator privileges required to publish or update announcements.');
      return;
    }
    if (!title.trim()) {
      alert('Please enter a notice title.');
      return;
    }
    if (!content.trim() && !urlToPaste.trim()) {
      alert('Please enter notice content.');
      return;
    }

    try {
      setFormSubmitting(true);

      // Auto-include any link pasted in the dedicated URL area if not already inserted into content
      let finalContent = content.trim();
      if (urlToPaste.trim()) {
        let extraUrl = urlToPaste.trim();
        if (!/^https?:\/\//i.test(extraUrl)) {
          extraUrl = 'https://' + extraUrl;
        }
        if (!finalContent.includes(extraUrl)) {
          finalContent = finalContent ? `${finalContent}\n\n${extraUrl}` : extraUrl;
        }
      }

      const payload: Partial<OfficeNotice> = {
        title: title.trim(),
        content: finalContent,
        publishedDateBS: publishedDateBS.trim() || getNepaliDate(new Date()),
        publishedBy: formatNoticeUserRoleUpper(publishedBy.trim() || roleOfLoginUser),
        authorName: (viewMode === 'EDIT' && editingNoticeId
          ? (notices.find((n) => n.id === editingNoticeId)?.authorName || user?.name || 'Super Administrator')
          : (user?.name || 'Super Administrator')),
        priority,
        isPinned,
        attachment,
        status: 'ACTIVE',
      };

      let savedNotice: OfficeNotice | null = null;

      if (viewMode === 'CREATE') {
        const res = await api.createNotice(payload);
        savedNotice = res.notice;
        setSuccessMessage('Official notice published successfully!');
      } else if (viewMode === 'EDIT' && editingNoticeId) {
        const res = await api.updateNotice(editingNoticeId, payload);
        savedNotice = res.notice;
        setSuccessMessage('Notice updated successfully!');
      }

      // Reset form & filters so the new/edited notice is immediately visible in the list
      setSearchQuery('');
      setStatusFilter('ALL');
      setUrlToPaste('');
      setTitle('');
      setContent('');
      setAttachment(null);
      setEditingNoticeId(null);
      setViewMode('LIST');

      // Update state locally first for instant UI responsiveness
      if (savedNotice) {
        setNotices((prev) => {
          const filtered = prev.filter((n) => n.id !== savedNotice!.id);
          const updated = [savedNotice!, ...filtered];
          try {
            safeStorage.setItem('plsms_notices_cache', JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }

      // Dispatch global custom event so PublicPortal and any other listener syncs in real-time
      try {
        window.dispatchEvent(new CustomEvent('plsms_notices_updated', { detail: savedNotice }));
      } catch {}

      // Re-fetch true server state to ensure 100% backend consistency
      await loadNotices();
    } catch (err: any) {
      console.error('Failed to submit notice:', err);
      alert(err.message || 'Failed to save notice.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Toggle active / disabled status (Permission check)
  const handleToggleStatus = async (noticeId: string) => {
    if (!canEditNotice) {
      alert('Forbidden: You do not have permission to enable or disable notices.');
      return;
    }
    try {
      const res = await api.toggleNoticeStatus(noticeId);
      const updated = notices.map((n) => (n.id === noticeId ? res.notice : n));
      setNotices(updated);
      try {
        safeStorage.setItem('plsms_notices_cache', JSON.stringify(updated));
      } catch {}
      setSuccessMessage(`Notice marked as ${res.notice.status}`);
    } catch (err: any) {
      console.error('Failed to toggle notice status:', err);
      alert(err.message || 'Failed to toggle status.');
    }
  };

  // Delete notice (Permission check)
  const handleDeleteNotice = async () => {
    if (!canDeleteNotice) {
      alert('Forbidden: You do not have permission to delete official notices.');
      return;
    }
    if (!deleteConfirmNotice) return;
    try {
      setDeleting(true);
      await api.deleteNotice(deleteConfirmNotice.id);
      const updated = notices.filter((n) => n.id !== deleteConfirmNotice.id);
      setNotices(updated);
      try {
        safeStorage.setItem('plsms_notices_cache', JSON.stringify(updated));
      } catch {}
      setSuccessMessage(`Notice "${deleteConfirmNotice.title}" deleted.`);
      setDeleteConfirmNotice(null);
    } catch (err: any) {
      console.error('Failed to delete notice:', err);
      alert(err.message || 'Failed to delete notice.');
    } finally {
      setDeleting(false);
    }
  };

  // Direct file upload from card (Permission check)
  const handleCardUploadClick = (notice: OfficeNotice) => {
    if (!canUploadNoticePdf) {
      alert('Forbidden: You do not have permission to upload files to notices.');
      return;
    }
    setUploadModalNotice(notice);
  };

  const handleModalFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canUploadNoticePdf) {
      alert('Forbidden: You do not have permission to upload files.');
      return;
    }
    const file = e.target.files?.[0];
    if (!file || !uploadModalNotice) return;

    try {
      setModalUploading(true);
      const res = await api.uploadFileToNotice(uploadModalNotice.id, file);
      const updated = notices.map((n) => (n.id === uploadModalNotice.id ? res.notice : n));
      setNotices(updated);
      try {
        safeStorage.setItem('plsms_notices_cache', JSON.stringify(updated));
      } catch {}
      setSuccessMessage(`Attached "${file.name}" to notice successfully!`);
      setUploadModalNotice(null);
    } catch (err: any) {
      console.error('Failed to attach file:', err);
      alert(err.message || 'Failed to upload file.');
    } finally {
      setModalUploading(false);
      if (modalFileInputRef.current) modalFileInputRef.current.value = '';
    }
  };

  // Filtered notices
  const filteredNotices = notices.filter((n) => {
    if (statusFilter === 'ACTIVE' && n.status !== 'ACTIVE') return false;
    if (statusFilter === 'DISABLED' && n.status !== 'DISABLED') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = n.title.toLowerCase().includes(q);
      const matchContent = n.content.toLowerCase().includes(q);
      const matchDate = (n.publishedDateBS || '').toLowerCase().includes(q);
      if (!matchTitle && !matchContent && !matchDate) return false;
    }
    return true;
  });

  // Active notice displayed in the separate full notice display card (no default selection)
  const activeSelectedNotice: OfficeNotice | null =
    selectedNoticeId ? (filteredNotices.find((n) => n.id === selectedNoticeId) || null) : null;

  const activeSelectedNoticeIndex = activeSelectedNotice
    ? filteredNotices.findIndex((n) => n.id === activeSelectedNotice.id)
    : -1;

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
      handleSelectNotice(filteredNotices[activeSelectedNoticeIndex - 1].id, false);
    }
  };

  const handleNextNotice = () => {
    if (activeSelectedNoticeIndex < filteredNotices.length - 1) {
      handleSelectNotice(filteredNotices[activeSelectedNoticeIndex + 1].id, false);
    }
  };

  // Render formatted notice content with active hyperlinks for web and Google Drive URLs
  const renderNoticeContent = (rawContent: string) => {
    return renderNoticeContentWithLinks(rawContent, {
      textColorClass: 'text-slate-900 dark:text-slate-200',
      textSizeClass: 'text-[11.5px] min-[360px]:text-xs sm:text-base',
    });
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 pb-12 transition-colors duration-200">
      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleAttachmentFileSelect}
        accept=".jpg,.jpeg,.png,.svg,.pdf"
        className="hidden"
      />
      <input
        type="file"
        ref={modalFileInputRef}
        onChange={handleModalFileSelect}
        accept=".jpg,.jpeg,.png,.svg,.pdf"
        className="hidden"
      />

      {/* ============================================================ */}
      {/* TOP HEADER SECTION (Matches Picture 1 & Picture 2 exactly)    */}
      {/* ============================================================ */}
      <div className="space-y-3 sm:space-y-4">
        {/* Centered Cyan Title */}
        <div className="text-center">
          <h1 className="text-xs min-[360px]:text-sm sm:text-base md:text-xl font-extrabold tracking-[0.2em] sm:tracking-[0.25em] text-[#00c0f0] dark:text-[#00c0f0] uppercase select-none drop-shadow-sm">
            NOTICES
          </h1>
        </div>

        {/* Subheader with Icon, Title, Description, and Action Button (Auto-shrinking for mobile) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 pt-0.5 sm:pt-1">
          <div className="space-y-0.5 sm:space-y-1 min-w-0 flex-1">
            <div className="flex items-center justify-between sm:justify-start gap-2">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <Megaphone className="w-3.5 h-3.5 min-[360px]:w-4 min-[360px]:h-4 sm:w-5 sm:h-5 text-[#00c0f0] shrink-0" />
                <h2 className="text-xs min-[360px]:text-sm sm:text-base md:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Official Notices & Announcements
                </h2>
              </div>

              {/* Mobile-only compact Create button if in List view */}
              {canCreateNotice && viewMode === 'LIST' && (
                <button
                  onClick={handleOpenCreate}
                  className="sm:hidden px-2.5 py-1 rounded-lg bg-[#0088cc] hover:bg-[#0099e6] active:scale-95 text-white text-[10.5px] font-bold flex items-center gap-1 shadow-xs transition-all cursor-pointer shrink-0"
                >
                  <Plus className="w-3 h-3 text-white stroke-[2.5]" />
                  <span>Create</span>
                </button>
              )}
            </div>
            <p className="text-[10px] min-[360px]:text-[11px] sm:text-xs md:text-sm text-slate-600 dark:text-slate-300 font-medium max-w-2xl leading-snug">
              Keep up to date with license delivery schedules, physical document pickup days, and office bulletins.
            </p>
          </div>

          <div className="shrink-0 hidden sm:block">
            {canCreateNotice ? (
              viewMode === 'LIST' ? (
                <button
                  id="create-announcement-btn"
                  onClick={handleOpenCreate}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#0088cc] hover:bg-[#0099e6] active:scale-95 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-[#0088cc]/20 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-white stroke-[2.5]" />
                  <span>Create Announcement</span>
                </button>
              ) : (
                <button
                  onClick={handleCancelForm}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Back to Notices</span>
                </button>
              )
            ) : (
              <div className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-[#0c182b] border border-slate-200 dark:border-[#162A4A] text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2 select-none shadow-2xs">
                <Eye className="w-3.5 h-3.5 text-[#00c0f0]" />
                <span>Notice Archive (View Only)</span>
              </div>
            )}
          </div>
        </div>

        {/* Subtle Horizontal Divider */}
        <div className="border-b border-slate-200 dark:border-[#162A4A]/80 pt-1 sm:pt-2" />
      </div>

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-600/50 text-emerald-800 dark:text-emerald-200 text-xs sm:text-sm font-semibold shadow-sm animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="flex-1">{successMessage}</span>
          <button onClick={() => setSuccessMessage(null)} className="p-1 hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Notification Banner */}
      {error && (
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-600/50 text-rose-800 dark:text-rose-200 text-xs sm:text-sm font-semibold shadow-sm">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* VIEW: CREATE / EDIT NOTICE FORM (Matches Picture 2 exactly)   */}
      {/* ============================================================ */}
      {(viewMode === 'CREATE' || viewMode === 'EDIT') && (
        <div className="rounded-2xl border border-slate-200 dark:border-[#162A4A] bg-white dark:bg-[#070F1E] shadow-sm dark:shadow-2xl transition-all duration-200">
          {/* Card Header */}
          <div className="px-6 py-4 rounded-t-2xl border-b border-slate-200 dark:border-[#162A4A] flex items-center justify-between bg-slate-50/60 dark:bg-[#060D1A]/60">
            <div className="flex items-center gap-2.5">
              <FileText className="w-5 h-5 text-[#00c0f0]" />
              <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-slate-800 dark:text-white">
                {viewMode === 'CREATE' ? 'ADD NEW OFFICE NOTICE' : 'EDIT OFFICE NOTICE'}
              </span>
            </div>
            <button
              onClick={handleCancelForm}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmitNotice} className="p-6 space-y-6">
            {/* Field 1: NOTICE TITLE */}
            <div className="space-y-2">
              <label className="block text-[11px] sm:text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                NOTICE TITLE <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Itahari TMO: Delayed Handover of Motorcycle Smart Cards"
                className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-[#060D1A] border border-slate-200 dark:border-[#162A4A] text-slate-900 dark:text-white text-sm sm:text-base placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0088cc]/50 focus:border-[#0088cc] transition-all"
                required
              />
            </div>

            {/* Field 2: NOTICE CONTENT with Rich Toolbar (Picture 2 reproduction) */}
            <div className="space-y-2">
              <label className="block text-[11px] sm:text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                NOTICE CONTENT <span className="text-rose-500">*</span>
              </label>

              <div className="rounded-xl border border-slate-200 dark:border-[#162A4A] bg-slate-50 dark:bg-[#060D1A] overflow-hidden focus-within:border-[#0088cc] focus-within:ring-1 focus-within:ring-[#0088cc]/50 transition-all">
                {/* Formatting Toolbar */}
                <div className="p-2 border-b border-slate-200 dark:border-[#162A4A] bg-white/70 dark:bg-[#091526]/80 flex flex-wrap items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  {/* Font Style Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setFontDropdownOpen(!fontDropdownOpen);
                        setColorDropdownOpen(false);
                        setHighlightDropdownOpen(false);
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-[#1e385f] hover:bg-slate-100 dark:hover:bg-[#12243d] flex items-center gap-1.5 transition-colors"
                    >
                      <Type className="w-3.5 h-3.5 text-[#00c0f0]" />
                      <span>Font Style</span>
                      <ChevronDown className="w-3 h-3 text-slate-400" />
                    </button>

                    {fontDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1 w-44 rounded-xl bg-white dark:bg-[#0d1c33] border border-slate-200 dark:border-[#1e385f] shadow-xl p-1.5 z-30 space-y-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                        <button
                          type="button"
                          onClick={() => applyFontStyle('H1')}
                          className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#152a4a] font-bold text-sm"
                        >
                          Heading 1
                        </button>
                        <button
                          type="button"
                          onClick={() => applyFontStyle('H2')}
                          className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#152a4a] font-semibold"
                        >
                          Heading 2
                        </button>
                        <button
                          type="button"
                          onClick={() => applyFontStyle('LEAD')}
                          className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#152a4a]"
                        >
                          Important Callout
                        </button>
                        <button
                          type="button"
                          onClick={() => applyFontStyle('MONO')}
                          className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#152a4a] font-mono"
                        >
                          Code / Lot Code
                        </button>
                        <button
                          type="button"
                          onClick={() => applyFontStyle('BLOCKQUOTE')}
                          className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#152a4a] italic"
                        >
                          Quote / Bulletin
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Bold Button */}
                  <button
                    type="button"
                    onClick={() => applyTextWrap('**', '**')}
                    title="Bold"
                    className="p-1.5 px-2.5 rounded-lg text-xs font-black border border-slate-200 dark:border-[#1e385f] hover:bg-slate-100 dark:hover:bg-[#12243d] flex items-center justify-center transition-colors"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>

                  {/* Italic Button */}
                  <button
                    type="button"
                    onClick={() => applyTextWrap('*', '*')}
                    title="Italic"
                    className="p-1.5 px-2.5 rounded-lg text-xs font-black border border-slate-200 dark:border-[#1e385f] hover:bg-slate-100 dark:hover:bg-[#12243d] flex items-center justify-center transition-colors"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>

                  {/* Text Color Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setColorDropdownOpen(!colorDropdownOpen);
                        setFontDropdownOpen(false);
                        setHighlightDropdownOpen(false);
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-[#1e385f] hover:bg-slate-100 dark:hover:bg-[#12243d] flex items-center gap-1.5 transition-colors"
                    >
                      <Palette className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Text Color</span>
                      <ChevronDown className="w-3 h-3 text-slate-400" />
                    </button>

                    {colorDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1 w-44 rounded-xl bg-white dark:bg-[#0d1c33] border border-slate-200 dark:border-[#1e385f] shadow-xl p-2 z-30 grid grid-cols-4 gap-1.5">
                        <button
                          type="button"
                          onClick={() => applyColor('#00c0f0', 'Cyan')}
                          className="h-7 rounded-lg bg-[#00c0f0] hover:scale-105 transition-transform"
                          title="Cyan"
                        />
                        <button
                          type="button"
                          onClick={() => applyColor('#3b82f6', 'Blue')}
                          className="h-7 rounded-lg bg-blue-500 hover:scale-105 transition-transform"
                          title="Blue"
                        />
                        <button
                          type="button"
                          onClick={() => applyColor('#10b981', 'Green')}
                          className="h-7 rounded-lg bg-emerald-500 hover:scale-105 transition-transform"
                          title="Emerald Green"
                        />
                        <button
                          type="button"
                          onClick={() => applyColor('#f59e0b', 'Amber')}
                          className="h-7 rounded-lg bg-amber-500 hover:scale-105 transition-transform"
                          title="Amber"
                        />
                        <button
                          type="button"
                          onClick={() => applyColor('#f43f5e', 'Rose')}
                          className="h-7 rounded-lg bg-rose-500 hover:scale-105 transition-transform"
                          title="Rose Red"
                        />
                        <button
                          type="button"
                          onClick={() => applyColor('#a855f7', 'Purple')}
                          className="h-7 rounded-lg bg-purple-500 hover:scale-105 transition-transform"
                          title="Purple"
                        />
                        <button
                          type="button"
                          onClick={() => applyColor('#ffffff', 'White')}
                          className="h-7 rounded-lg bg-white border border-slate-300 hover:scale-105 transition-transform"
                          title="White"
                        />
                        <button
                          type="button"
                          onClick={() => applyColor('#0f172a', 'Dark')}
                          className="h-7 rounded-lg bg-slate-900 hover:scale-105 transition-transform"
                          title="Dark Slate"
                        />
                      </div>
                    )}
                  </div>

                  {/* Highlight Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setHighlightDropdownOpen(!highlightDropdownOpen);
                        setFontDropdownOpen(false);
                        setColorDropdownOpen(false);
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-[#1e385f] hover:bg-slate-100 dark:hover:bg-[#12243d] flex items-center gap-1.5 transition-colors"
                    >
                      <Highlighter className="w-3.5 h-3.5 text-amber-400" />
                      <span>Highlight</span>
                      <ChevronDown className="w-3 h-3 text-slate-400" />
                    </button>

                    {highlightDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1 w-44 rounded-xl bg-white dark:bg-[#0d1c33] border border-slate-200 dark:border-[#1e385f] shadow-xl p-2 z-30 space-y-1 text-xs">
                        <button
                          type="button"
                          onClick={() => applyHighlight('#fef08a')}
                          className="w-full text-left px-2.5 py-1.5 rounded bg-yellow-200/90 text-slate-900 font-semibold"
                        >
                          Yellow Marker
                        </button>
                        <button
                          type="button"
                          onClick={() => applyHighlight('#a5f3fc')}
                          className="w-full text-left px-2.5 py-1.5 rounded bg-cyan-200/90 text-slate-900 font-semibold"
                        >
                          Cyan Marker
                        </button>
                        <button
                          type="button"
                          onClick={() => applyHighlight('#bbf7d0')}
                          className="w-full text-left px-2.5 py-1.5 rounded bg-emerald-200/90 text-slate-900 font-semibold"
                        >
                          Green Marker
                        </button>
                        <button
                          type="button"
                          onClick={() => applyHighlight('#fecdd3')}
                          className="w-full text-left px-2.5 py-1.5 rounded bg-rose-200/90 text-slate-900 font-semibold"
                        >
                          Pink Marker
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Underline */}
                  <button
                    type="button"
                    onClick={() => applyTextWrap('<u>', '</u>')}
                    title="Underline"
                    className="p-1.5 px-2 rounded-lg text-xs border border-slate-200 dark:border-[#1e385f] hover:bg-slate-100 dark:hover:bg-[#12243d] transition-colors"
                  >
                    <Underline className="w-3.5 h-3.5" />
                  </button>

                  {/* Bullet list */}
                  <button
                    type="button"
                    onClick={() => applyTextWrap('• ', '')}
                    title="Bullet List"
                    className="p-1.5 px-2 rounded-lg text-xs border border-slate-200 dark:border-[#1e385f] hover:bg-slate-100 dark:hover:bg-[#12243d] transition-colors"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>

                  {/* Template selector */}
                  <div className="relative ml-auto">
                    <button
                      type="button"
                      onClick={() => setTemplateDropdownOpen(!templateDropdownOpen)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 hover:text-[#00c0f0] border border-slate-200 dark:border-[#1e385f] hover:bg-slate-100 dark:hover:bg-[#12243d] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3 text-[#00c0f0]" />
                      <span>Templates</span>
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </button>
                    {templateDropdownOpen && (
                      <div className="absolute right-0 top-full mt-1 w-72 rounded-xl bg-white dark:bg-[#0d1c33] border border-slate-200 dark:border-[#1e385f] shadow-2xl p-2 z-30 space-y-1.5 text-xs">
                        <button
                          type="button"
                          onClick={loadScheduleWithLinksTemplate}
                          className="w-full text-left p-2 rounded-lg hover:bg-cyan-50 dark:hover:bg-cyan-950/40 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
                        >
                          <div className="font-bold text-[#0088cc] dark:text-[#00c0f0] flex items-center gap-1">
                            <span>📅 Alphabet Schedule (with Drive Links)</span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Nepali schedule with Google Drive link slots for A-B, C-H, etc.
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={loadStandardCollectionTemplate}
                          className="w-full text-left p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#12243d] text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
                        >
                          <div className="font-bold text-slate-700 dark:text-slate-300">
                            📋 Standard Collection Notice
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            General notice requesting citizens to collect cards.
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dedicated URL Pasting Area */}
                <div className="p-3 bg-cyan-50/80 dark:bg-[#07172b] border-b border-cyan-200/60 dark:border-[#00c0f0]/30 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 text-xs font-black text-[#0088cc] dark:text-[#00c0f0] uppercase tracking-wider">
                      <LinkIcon className="w-3.5 h-3.5 shrink-0 text-[#00c0f0]" />
                      <span>URL PASTING AREA (Google Drive & Web Documents)</span>
                    </div>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Auto-rendered as active, clickable links for public & all users
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-2">
                    <div className="relative flex-1 w-full">
                      <input
                        type="url"
                        value={urlToPaste}
                        onChange={(e) => setUrlToPaste(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleInsertPastedUrl();
                          }
                        }}
                        placeholder="Paste Google Drive link or web URL here (e.g. https://drive.google.com/...)..."
                        className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#091322] border border-cyan-300 dark:border-cyan-500/50 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#00c0f0]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleInsertPastedUrl()}
                      disabled={!urlToPaste.trim()}
                      className="w-full sm:w-auto px-3.5 py-2 rounded-lg bg-[#0088cc] hover:bg-[#0099e6] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
                    >
                      <LinkIcon className="w-3.5 h-3.5" />
                      <span>Insert Link into Notice</span>
                    </button>
                  </div>
                </div>

                {/* Textarea Area */}
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Provide explicit operational info: batch parameters, collection time windows, and web/drive links..."
                  rows={8}
                  className="w-full p-4 bg-transparent text-slate-900 dark:text-white text-sm sm:text-base leading-relaxed placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none resize-y font-sans"
                  required
                />

                {/* Live URL Detection Bar */}
                {extractUrls(content).length > 0 && (
                  <div className="p-3 bg-cyan-50/70 dark:bg-[#060D1A] border-t border-cyan-200/60 dark:border-[#00c0f0]/30 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#0088cc] dark:text-[#00c0f0] flex items-center gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>{extractUrls(content).length} Active Link(s) Detected in Notice:</span>
                      </span>
                      <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        ✓ Verified interactive for Public Portal & Staff View
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {extractUrls(content).map((u, i) => (
                        <a
                          key={i}
                          href={u}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="px-2.5 py-1 rounded-md bg-white dark:bg-[#0b172a] border border-cyan-300/80 dark:border-[#00c0f0]/40 font-semibold text-xs text-[#0088cc] dark:text-[#00c0f0] hover:underline truncate max-w-[280px] sm:max-w-md flex items-center gap-1 shadow-2xs"
                          title={`Test link in new tab: ${u}`}
                        >
                          <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                          <span className="truncate">{isGoogleDriveUrl(u) ? 'Google Drive Document' : u}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-[#060D1A]/80 border border-slate-200 dark:border-[#162A4A]">
              {/* Priority */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  PRIORITY LEVEL
                </label>
                <select
                  value={priority}
                  onChange={(e: any) => setPriority(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#0b172a] border border-slate-200 dark:border-[#162A4A] text-slate-800 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#0088cc]"
                >
                  <option value="NORMAL">Normal Announcement</option>
                  <option value="IMPORTANT">Important Notice (Amber)</option>
                  <option value="URGENT">Urgent Advisory (Red Alert)</option>
                </select>
              </div>

              {/* Publication Date (Bikram Sambat Calendar Picker) */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  PUBLISH DATE (B.S.)
                </label>
                <NepaliDatePicker
                  id="notice-publish-date-bs"
                  value={publishedDateBS}
                  onChange={(val) => setPublishedDateBS(val)}
                  placeholder="YYYY-MM-DD (B.S.)"
                  align="right"
                  inputClassName="!w-full !px-3 !pl-8 !py-2 !rounded-lg !bg-white dark:!bg-[#0b172a] !border-slate-200 dark:!border-[#162A4A] !text-slate-800 dark:!text-slate-200 !text-xs !font-semibold focus:!outline-none focus:!ring-1 focus:!ring-[#0088cc]"
                />
              </div>
            </div>

            {/* Pin notice toggle */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={(e) => setIsPinned(e.target.checked)}
                  className="w-4 h-4 rounded text-[#0088cc] focus:ring-[#0088cc]"
                />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Pin className="w-3.5 h-3.5 text-amber-500" />
                  Pin this notice to the top of the board
                </span>
              </label>
            </div>

            {/* Field 3: UPLOAD ATTACHMENT (JPG, SVG, PDF) - OPTIONAL */}
            <div className="space-y-2">
              <label className="block text-[11px] sm:text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                UPLOAD ATTACHMENT (JPG, SVG, PDF) - OPTIONAL
              </label>

              <div className="flex flex-wrap items-center gap-3">
                {canUploadNoticePdf && (
                  <button
                    type="button"
                    id="choose-attachment-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAttachment}
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#0c182b] border border-slate-200 dark:border-[#162A4A] hover:border-[#00c0f0] text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4 text-[#00c0f0]" />
                    <span>{uploadingAttachment ? 'Uploading...' : 'Choose Attachment'}</span>
                  </button>
                )}

                {attachment && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-50 dark:bg-[#00c0f0]/10 border border-cyan-200 dark:border-[#00c0f0]/30 text-xs font-semibold text-cyan-800 dark:text-cyan-300">
                    <Paperclip className="w-3.5 h-3.5 text-[#00c0f0]" />
                    <span className="max-w-[200px] truncate">{attachment.name}</span>
                    <span className="text-[10px] opacity-75">
                      ({(attachment.size / 1024).toFixed(0)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      title="Remove attachment"
                      className="p-0.5 hover:text-rose-500 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Right Actions (Cancel & Publish Notice buttons) */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-[#162A4A]">
              <button
                type="button"
                onClick={handleCancelForm}
                className="px-5 py-2.5 rounded-xl bg-slate-200 dark:bg-[#1e293b] hover:bg-slate-300 dark:hover:bg-[#2b394f] text-slate-700 dark:text-slate-300 text-xs sm:text-sm font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                id="publish-notice-btn"
                disabled={formSubmitting}
                className="px-6 py-2.5 rounded-xl bg-[#0088cc] hover:bg-[#0099e6] active:scale-95 text-white text-xs sm:text-sm font-bold shadow-lg shadow-[#0088cc]/25 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                {formSubmitting ? (
                  <span>Publishing...</span>
                ) : (
                  <span>{viewMode === 'CREATE' ? 'Publish Notice' : 'Update Notice'}</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ============================================================ */}
      {/* VIEW: NOTICES LIST (Matches Picture 1 exactly)               */}
      {/* ============================================================ */}
      {viewMode === 'LIST' && (
        <div className="space-y-4">
          {/* Quick Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3 p-2 sm:p-3 rounded-xl sm:rounded-2xl bg-white dark:bg-[#070F1E] border border-slate-200 dark:border-[#162A4A] shadow-xs">
            <div className="flex-1 relative">
              <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600 dark:text-slate-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search official notices, keywords, dates..."
                className="w-full pl-8 sm:pl-9 pr-3 sm:pr-4 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-slate-50 dark:bg-[#060D1A] border border-slate-200 dark:border-[#162A4A] text-slate-900 dark:text-slate-200 text-[11px] sm:text-xs placeholder:text-slate-600 dark:placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0088cc]"
              />
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Status Filter */}
              <div className="flex items-center bg-slate-100 dark:bg-[#060D1A] rounded-lg sm:rounded-xl p-0.5 border border-slate-200 dark:border-[#162A4A] text-[10.5px] sm:text-xs font-bold">
                <button
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-md sm:rounded-lg transition-colors font-bold ${
                    statusFilter === 'ALL'
                      ? 'bg-white dark:bg-[#0088cc] text-slate-950 dark:text-white shadow-xs'
                      : 'text-slate-800 dark:text-slate-300 hover:text-black dark:hover:text-white'
                  }`}
                >
                  All ({notices.length})
                </button>
                <button
                  onClick={() => setStatusFilter('ACTIVE')}
                  className={`px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-md sm:rounded-lg transition-colors font-bold ${
                    statusFilter === 'ACTIVE'
                      ? 'bg-white dark:bg-[#0088cc] text-slate-950 dark:text-white shadow-xs'
                      : 'text-slate-800 dark:text-slate-300 hover:text-black dark:hover:text-white'
                  }`}
                >
                  Active
                </button>
                <button
                  onClick={() => setStatusFilter('DISABLED')}
                  className={`px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-md sm:rounded-lg transition-colors font-bold ${
                    statusFilter === 'DISABLED'
                      ? 'bg-white dark:bg-[#0088cc] text-slate-950 dark:text-white shadow-xs'
                      : 'text-slate-800 dark:text-slate-300 hover:text-black dark:hover:text-white'
                  }`}
                >
                  Disabled
                </button>
              </div>
            </div>
          </div>

          {/* Notices Cards Stream */}
          {loading ? (
            <div className="p-8 sm:p-12 text-center rounded-2xl border border-slate-200 dark:border-[#162A4A] bg-white dark:bg-[#070F1E]">
              <div className="w-7 h-7 sm:w-8 sm:h-8 mx-auto border-3 border-[#00c0f0] border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest text-slate-400">
                Loading official announcements...
              </p>
            </div>
          ) : filteredNotices.length === 0 ? (
            <div className="p-8 sm:p-12 text-center rounded-2xl border border-slate-200 dark:border-[#162A4A] bg-white dark:bg-[#070F1E] space-y-2 sm:space-y-3">
              <Megaphone className="w-8 h-8 sm:w-10 sm:h-10 text-slate-400 dark:text-slate-600 mx-auto" />
              <h3 className="text-sm sm:text-base font-bold text-slate-700 dark:text-slate-300">
                No Notices Found
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 max-w-md mx-auto">
                {searchQuery
                  ? `No announcements matched your search for "${searchQuery}".`
                  : 'There are currently no announcements in this category.'}
              </p>
              {canCreateNotice && (
                <button
                  onClick={handleOpenCreate}
                  className="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl bg-[#0088cc] hover:bg-[#0099e6] text-white text-[11px] sm:text-xs font-bold inline-flex items-center gap-1.5 sm:gap-2 shadow-md cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>Create First Notice</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-6">
              {/* ============================================================ */}
              {/* 1. UPLOADED NOTICES NUMBERED DIRECTORY (1., 2., 3., ...)      */}
              {/* Displayed just below the search text box as requested         */}
              {/* ============================================================ */}
              <div className="rounded-xl sm:rounded-2xl border border-slate-200 dark:border-[#162A4A] bg-white dark:bg-[#070F1E] shadow-xs overflow-hidden">
                {/* Directory Header Bar */}
                <div className="px-2.5 sm:px-4 py-2 sm:py-3 bg-slate-50 dark:bg-[#060D1A] border-b border-slate-200 dark:border-[#162A4A] flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <ListOrdered className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#0088cc] dark:text-[#00c0f0] shrink-0" />
                    <h3 className="text-[11px] sm:text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                      Official Notices List / प्रकाशित सूचनाहरूको सूची
                    </h3>
                    <span className="px-1.5 sm:px-2 py-0.5 rounded-full bg-[#0088cc]/10 text-[#0088cc] dark:text-[#00c0f0] text-[10px] sm:text-[11px] font-black">
                      {filteredNotices.length}
                    </span>
                  </div>
                  <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    Click any notice title to display full notice below ↓
                  </span>
                </div>

                {/* Numbered Notice Items: 1., 2., 3., ... */}
                <div className="divide-y divide-slate-100 dark:divide-[#162A4A]/60">
                  {filteredNotices.map((notice, idx) => {
                    const isSelected = activeSelectedNotice?.id === notice.id;
                    const isDisabled = notice.status === 'DISABLED';
                    const isUrgent = notice.priority === 'URGENT';
                    const isImportant = notice.priority === 'IMPORTANT';

                    return (
                      <div
                        key={notice.id}
                        id={`notice-item-${notice.id}`}
                        className={`p-2.5 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-2 sm:gap-3 transition-colors group/item ${
                          isSelected
                            ? 'bg-blue-50/70 dark:bg-[#0088cc]/12 border-l-4 border-l-[#0088cc] dark:border-l-[#00c0f0]'
                            : isDisabled
                            ? 'bg-slate-50/40 dark:bg-[#060D1A]/30 opacity-75 hover:opacity-100 hover:bg-slate-50 dark:hover:bg-[#0A1526]'
                            : 'hover:bg-slate-50/80 dark:hover:bg-[#0A1526]'
                        }`}
                      >
                        {/* Left: Index (1., 2., 3., ...) + Title as interactive link */}
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

                          {/* Title with link styling, decreased font size, and date always just after notice topic */}
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

                            {/* Additional Sub-meta: Attachment and Web link indicators if any */}
                            {(notice.attachment || extractUrls(notice.content).length > 0) && (
                              <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-500 dark:text-slate-400 pt-0.5">
                                {notice.attachment && (
                                  <span className="flex items-center gap-1 text-[#0088cc] dark:text-[#00c0f0] font-medium text-[10px] sm:text-xs">
                                    <Paperclip className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                    <span className="truncate max-w-[130px] sm:max-w-[160px]">{notice.attachment.name}</span>
                                  </span>
                                )}
                                {extractUrls(notice.content).length > 0 && (
                                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[10px] sm:text-xs">
                                    <ExternalLink className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                    <span>{extractUrls(notice.content).length} Web Link(s)</span>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right: Badges & Action Buttons */}
                        <div
                          className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0 pt-1.5 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-[#162A4A]/50 justify-between md:justify-end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isDisabled && (
                            <span className="px-1.5 sm:px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[9px] min-[360px]:text-[10px] font-black uppercase">
                              DISABLED
                            </span>
                          )}
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

                          {/* Link to Full Notice Button */}
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

                          {/* Super Admin Quick Actions */}
                          {(canEditNotice || canUploadNoticePdf || canDeleteNotice) && (
                            <div className="flex items-center gap-1">
                              {canEditNotice && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(notice)}
                                  title="Edit notice"
                                  className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-indigo-300/60 dark:border-indigo-500/40 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors cursor-pointer"
                                >
                                  <Pencil className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                </button>
                              )}
                              {canUploadNoticePdf && (
                                <button
                                  type="button"
                                  onClick={() => handleCardUploadClick(notice)}
                                  title="Upload document"
                                  className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-cyan-300/60 dark:border-cyan-500/40 text-cyan-600 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-950/50 transition-colors cursor-pointer"
                                >
                                  <Upload className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                </button>
                              )}
                              {canEditNotice && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleStatus(notice.id)}
                                  title={isDisabled ? 'Enable notice' : 'Disable notice'}
                                  className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-amber-300/60 dark:border-amber-500/40 text-amber-600 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 transition-colors cursor-pointer"
                                >
                                  {isDisabled ? <CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-500" /> : <XCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-500" />}
                                </button>
                              )}
                              {canDeleteNotice && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteConfirmNotice(notice)}
                                  title="Delete notice"
                                  className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-rose-300/60 dark:border-rose-500/40 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ============================================================ */}
              {/* 2. SEPARATE NOTICE DISPLAY CARD                               */}
              {/* Displays the full selected official notice card               */}
              {/* ============================================================ */}
              {activeSelectedNotice && (
                <section
                  ref={separateCardRef}
                  id="selected-notice-display-card"
                  className="scroll-mt-6 rounded-xl sm:rounded-2xl border-2 border-[#0088cc]/40 dark:border-[#0088cc]/50 bg-white dark:bg-[#070F1E] shadow-md transition-all duration-200 overflow-hidden"
                >
                  {/* Card Top Navigation & Identity Bar */}
                  <div className="px-2.5 py-2 sm:px-5 sm:py-3.5 bg-slate-50 dark:bg-[#060D1A] border-b border-slate-200 dark:border-[#162A4A] flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                    <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
                      <span className="p-1 sm:p-1.5 rounded-lg bg-[#0088cc]/10 text-[#0088cc] dark:text-[#00c0f0] border border-[#0088cc]/20 shrink-0">
                        <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </span>
                      <div className="min-w-0">
                        <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-[#0088cc] dark:text-[#00c0f0] block truncate">
                          Official Notice Display / पूर्ण आधिकारिक सूचना पत्र
                        </span>
                        <span className="text-[10.5px] sm:text-xs font-bold text-slate-700 dark:text-slate-300">
                          Notice #{activeSelectedNoticeIndex + 1} of {filteredNotices.length}
                        </span>
                      </div>
                    </div>

                    {/* Quick Navigation Between Notices & Fullscreen/Print & Close X */}
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
                        disabled={activeSelectedNoticeIndex >= filteredNotices.length - 1}
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
                          {activeSelectedNotice.status === 'DISABLED' && (
                            <span className="px-1.5 sm:px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-500">
                              DISABLED / HIDDEN
                            </span>
                          )}
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
                      {renderNoticeContent(activeSelectedNotice.content)}
                    </div>

                    {/* External Web / Cloud Document Links (e.g. Google Drive) */}
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

                    {/* Attachment preview if present */}
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
                          <span>Download</span>
                        </a>
                      </div>
                    )}

                    {/* Bottom Footer Row: Published By (Left) + Action Buttons (Right) */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 pt-3 sm:pt-4 border-t border-slate-200 dark:border-[#162A4A]/70">
                      {/* Left: Published by: SUPER ADMIN-KOMAL DAHAL (Strictly Super Admin Only) */}
                      {isStrictSuperAdmin ? (
                        <div className="text-[10.5px] sm:text-xs text-slate-700 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold">Published by:</span>
                          <span className="inline-flex items-center">
                            <span className={`font-black uppercase tracking-wider ${getNoticeRoleColorClass(activeSelectedNotice.publishedBy)}`}>
                              {formatNoticeUserRoleUpper(activeSelectedNotice.publishedBy)}
                            </span>
                            <span className="font-black text-slate-400 dark:text-slate-500 mx-0.5">-</span>
                            <span className="font-black uppercase tracking-wider text-[#15803d] dark:text-[#34d399]">
                              {(activeSelectedNotice.authorName && activeSelectedNotice.authorName !== 'Super Administrator'
                                ? activeSelectedNotice.authorName
                                : (user?.name || 'KOMAL DAHAL')).toUpperCase()}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <div />
                      )}

                      {/* Right: Action Buttons Group (Restricted by permissions) */}
                      {(canEditNotice || canUploadNoticePdf || canDeleteNotice) && (
                        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                          {canEditNotice && (
                            <button
                              onClick={() => handleOpenEdit(activeSelectedNotice)}
                              title="Edit this announcement"
                              className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-md sm:rounded-lg border border-indigo-400/40 dark:border-indigo-500/40 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-[9.5px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer"
                            >
                              <Pencil className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-indigo-500 dark:text-indigo-400" />
                              <span>EDIT</span>
                            </button>
                          )}

                          {canUploadNoticePdf && (
                            <button
                              onClick={() => handleCardUploadClick(activeSelectedNotice)}
                              title="Attach document (PDF/JPG/SVG) to this notice"
                              className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-md sm:rounded-lg border border-cyan-400/40 dark:border-cyan-500/40 text-cyan-600 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-950/50 text-[9.5px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer"
                            >
                              <Upload className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#00c0f0]" />
                              <span>UPLOAD FILE</span>
                            </button>
                          )}

                          {canEditNotice && (
                            <button
                              onClick={() => handleToggleStatus(activeSelectedNotice.id)}
                              title={activeSelectedNotice.status === 'DISABLED' ? 'Enable notice for public' : 'Disable notice'}
                              className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-md sm:rounded-lg border border-amber-400/40 dark:border-amber-500/40 text-amber-600 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 text-[9.5px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer"
                            >
                              {activeSelectedNotice.status === 'DISABLED' ? (
                                <>
                                  <CheckCircle2 className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-500" />
                                  <span>ENABLE NOTICE</span>
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-500" />
                                  <span>DISABLE NOTICE</span>
                                </>
                              )}
                            </button>
                          )}

                          {canDeleteNotice && (
                            <button
                              onClick={() => setDeleteConfirmNotice(activeSelectedNotice)}
                              title="Permanently remove notice"
                              className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-md sm:rounded-lg border border-rose-400/40 dark:border-rose-500/40 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-[9.5px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer"
                            >
                              <Trash2 className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-rose-500" />
                              <span>DELETE</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: DIRECT FILE ATTACHMENT (From card UPLOAD FILE button)  */}
      {/* ============================================================ */}
      {uploadModalNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-[#162A4A] bg-white dark:bg-[#070F1E] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#162A4A] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#00c0f0]" />
                <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">
                  Upload Document Attachment
                </h3>
              </div>
              <button
                onClick={() => setUploadModalNotice(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#060D1A] border border-slate-200 dark:border-[#162A4A] text-xs">
                <span className="text-slate-400">Attaching to: </span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {uploadModalNotice.title}
                </span>
              </div>

              <div
                onClick={() => modalFileInputRef.current?.click()}
                className="p-8 border-2 border-dashed border-slate-300 dark:border-[#162A4A] hover:border-[#0088cc] rounded-2xl bg-slate-50/50 dark:bg-[#060D1A]/50 text-center cursor-pointer transition-colors group"
              >
                <Upload className="w-8 h-8 text-slate-400 group-hover:text-[#00c0f0] mx-auto mb-2 transition-colors" />
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Click to select document or image
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Supported: JPG, PNG, SVG, PDF (Max 15MB)
                </p>
              </div>

              {uploadModalNotice.attachment && (
                <div className="text-xs text-amber-500 font-medium">
                  Note: Uploading a new file will replace current attachment: "{uploadModalNotice.attachment.name}".
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setUploadModalNotice(null)}
                  className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => modalFileInputRef.current?.click()}
                  disabled={modalUploading}
                  className="px-4 py-2 rounded-xl bg-[#0088cc] hover:bg-[#0099e6] text-white text-xs font-bold shadow-md"
                >
                  {modalUploading ? 'Uploading...' : 'Choose File'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: DELETE CONFIRMATION                                   */}
      {/* ============================================================ */}
      {deleteConfirmNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-rose-300 dark:border-rose-900/60 bg-white dark:bg-[#070F1E] shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-500">
              <div className="p-2.5 rounded-full bg-rose-500/10 border border-rose-500/30">
                <Trash2 className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Delete Official Notice?
                </h3>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#060D1A] border border-slate-200 dark:border-[#162A4A] text-xs space-y-1">
              <p className="font-bold text-slate-800 dark:text-slate-200">
                "{deleteConfirmNotice.title}"
              </p>
              <p className="text-slate-400">
                Published on BS: {deleteConfirmNotice.publishedDateBS}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmNotice(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteNotice}
                disabled={deleting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleting ? 'Deleting...' : 'Confirm Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: VIEW FULL NOTICE DETAILS (Available to all users)     */}
      {/* ============================================================ */}
      {viewingNoticeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-[#162A4A] bg-white dark:bg-[#070F1E] shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-[#162A4A] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <Megaphone className="w-5 h-5 text-[#00c0f0]" />
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Official Notice Details
                </h3>
              </div>
              <button
                onClick={() => setViewingNoticeModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-200 dark:border-[#162A4A]/70 pb-4">
                <div className="space-y-1.5 min-w-0">
                  <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white leading-snug">
                    {viewingNoticeModal.title}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                    {viewingNoticeModal.status === 'DISABLED' && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-500">
                        DISABLED / HIDDEN
                      </span>
                    )}
                    {viewingNoticeModal.priority === 'URGENT' && (
                      <span className="px-2 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-500 animate-pulse">
                        URGENT
                      </span>
                    )}
                    {viewingNoticeModal.priority === 'IMPORTANT' && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400">
                        IMPORTANT
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-[#00c0f0]">
                      {viewingNoticeModal.category || 'ANNOUNCEMENT'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-300 shrink-0">
                  <Calendar className="w-4 h-4 text-slate-700 dark:text-slate-400 shrink-0" />
                  <span>BS: {viewingNoticeModal.publishedDateBS || '2083-05-15'}</span>
                </div>
              </div>

              {/* Department & Author */}
              <div className={`grid ${isStrictSuperAdmin ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'} gap-2 p-3 rounded-xl bg-slate-50 dark:bg-[#060D1A] border border-slate-200 dark:border-[#162A4A] text-xs`}>
                {isStrictSuperAdmin && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Published by:</span>
                    <span className="inline-flex items-center">
                      <span className={`font-black uppercase tracking-wider ${getNoticeRoleColorClass(viewingNoticeModal.publishedBy)}`}>
                        {formatNoticeUserRoleUpper(viewingNoticeModal.publishedBy)}
                      </span>
                      <span className="font-black text-slate-400 dark:text-slate-500 mx-0.5">-</span>
                      <span className="font-black uppercase tracking-wider text-[#15803d] dark:text-[#34d399]">
                        {(viewingNoticeModal.authorName && viewingNoticeModal.authorName !== 'Super Administrator'
                          ? viewingNoticeModal.authorName
                          : (user?.name || 'KOMAL DAHAL')).toUpperCase()}
                      </span>
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-slate-400 font-medium">Department: </span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {viewingNoticeModal.department || 'Department - क & Department - ख'}
                  </span>
                </div>
              </div>

              {/* Notice Content */}
              <div className="py-2">
                {renderNoticeContent(viewingNoticeModal.content)}
              </div>

              {/* External web links attached in text (e.g. Google Drive) */}
              {extractUrls(viewingNoticeModal.content).length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Linked Web / Cloud Documents:
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
                          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-50 dark:bg-[#00c0f0]/10 border border-cyan-200 dark:border-[#00c0f0]/30 text-xs font-bold text-[#0088cc] dark:text-[#00c0f0] hover:bg-cyan-100 dark:hover:bg-[#00c0f0]/20 transition-all shadow-2xs group/ext cursor-pointer"
                          title={`Open ${url}`}
                        >
                          <ExternalLink className="w-4 h-4 text-[#00c0f0] group-hover/ext:scale-110 transition-transform" />
                          <span className="truncate max-w-[320px]">
                            {isDrive ? 'Open Google Drive File / List' : `Open: ${getUrlDisplayLabel(url)}`}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Attachment if present */}
              {viewingNoticeModal.attachment && (
                <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-[#0c182b] border border-slate-200 dark:border-[#162A4A] flex items-center justify-between gap-3 text-xs font-semibold">
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip className="w-4 h-4 text-[#00c0f0] shrink-0" />
                    <span className="truncate text-slate-800 dark:text-slate-200">
                      {viewingNoticeModal.attachment.name}
                    </span>
                    <span className="text-slate-400 shrink-0">
                      ({(viewingNoticeModal.attachment.size / 1024).toFixed(0)} KB)
                    </span>
                  </div>
                  <a
                    href={viewingNoticeModal.attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-[#0088cc] hover:bg-[#0099e6] text-white font-bold text-xs shrink-0 shadow-sm flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </a>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-200 dark:border-[#162A4A] flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={() => setViewingNoticeModal(null)}
                className="px-5 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
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
