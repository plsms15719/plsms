import React, { useState, useEffect } from 'react';
import {
  Search,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  Eye,
  FileCheck,
  FileSpreadsheet,
  ShieldAlert,
  Lock,
  Check,
} from 'lucide-react';
import { LicenseRecord } from '../../types';
import { api } from '../../services/api';
import { HistoryInput } from '../common/HistoryInput';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, isSuperAdminUser } from '../../utils/permissions';
import { FoundCardHandoverModal } from '../modals/FoundCardHandoverModal';

interface Props {
  onSelectRecord: (record: LicenseRecord) => void;
  onRefreshStats?: () => void;
}

export const FoundSmartCardsView: React.FC<Props> = ({
  onSelectRecord,
  onRefreshStats,
}) => {
  const { user } = useAuth();
  const isSuperAdmin = isSuperAdminUser(user);

  // Permission access checks
  const canAccessFoundView =
    hasPermission(user, 'found.view') ||
    hasPermission(user, 'records.unmark_missing') ||
    hasPermission(user, 'found.verify') ||
    isSuperAdmin;

  const canViewRecord =
    hasPermission(user, 'found.details') ||
    hasPermission(user, 'records.view') ||
    isSuperAdmin;

  const canHandover =
    hasPermission(user, 'found.verify') ||
    hasPermission(user, 'records.unmark_missing') ||
    hasPermission(user, 'records.distribute') ||
    isSuperAdmin;

  const canExport =
    hasPermission(user, 'found.export') ||
    hasPermission(user, 'records.export_excel') ||
    isSuperAdmin;

  const [records, setRecords] = useState<LicenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deniedAlertMessage, setDeniedAlertMessage] = useState<string | null>(null);
  const [selectedRecordForHandover, setSelectedRecordForHandover] = useState<LicenseRecord | null>(null);

  const fetchFound = async () => {
    try {
      setLoading(true);
      const res = await api.getFoundRecords();
      setRecords(res.records || []);
    } catch (err) {
      console.error('Failed to load found smart cards:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canAccessFoundView) {
      fetchFound();
    } else {
      setLoading(false);
    }

    const handleRecordUpdate = (e: any) => {
      if (e?.detail?.type === 'FOUND' || e?.detail?.type === 'RECORD_UPDATE') {
        if (canAccessFoundView) fetchFound();
        if (onRefreshStats) onRefreshStats();
      }
    };
    window.addEventListener('plsms:record-updated', handleRecordUpdate);
    return () => {
      window.removeEventListener('plsms:record-updated', handleRecordUpdate);
    };
  }, [canAccessFoundView]);

  const filtered = records.filter((r) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    const phoneCandidates = [
      r.phone,
      r.rawRecord?.['PHONE'],
      r.rawRecord?.['MOBILE NUMBER'],
      r.rawRecord?.['Mobile Number'],
      r.rawRecord?.['MOBILE'],
      r.rawRecord?.['Mobile'],
      r.rawRecord?.['CONTACT'],
      r.receiverPhone,
    ];
    const phoneMatch = phoneCandidates.some(
      (c) => typeof c === 'string' && c.trim() && c.trim() !== 'SELF_VERIFIED' && c.toLowerCase().includes(q)
    );
    const distBy = r.distributedBy || r.rawRecord?.['DISTRIBUTED BY'] || r.foundReportedBy || 'KOMAL DAHAL';
    const distTo = r.receiverName || r.receivedBy || r.rawRecord?.['DISTRIBUTED TO'] || r.holderName || '';

    return (
      (r.applicantId && r.applicantId.toLowerCase().includes(q)) ||
      (r.applicationNumber && r.applicationNumber.toLowerCase().includes(q)) ||
      r.licenseNumber.toLowerCase().includes(q) ||
      (r.category && r.category.toLowerCase().includes(q)) ||
      (r.vehicleClass && r.vehicleClass.toLowerCase().includes(q)) ||
      r.holderName.toLowerCase().includes(q) ||
      (r.office && r.office.toLowerCase().includes(q)) ||
      (r.department && r.department.toLowerCase().includes(q)) ||
      phoneMatch ||
      distBy.toLowerCase().includes(q) ||
      distTo.toLowerCase().includes(q) ||
      (r.foundReason && r.foundReason.toLowerCase().includes(q))
    );
  });

  const handleExportCsv = () => {
    if (!canExport) {
      setDeniedAlertMessage('Access Denied: You do not have permission to export found smart cards registry (found.export required).');
      return;
    }
    if (filtered.length === 0) {
      alert('No found smart card records to export.');
      return;
    }
    const headers = [
      'SN',
      'Applicant ID',
      'Full Name',
      'License No',
      'Category',
      'Missing Date',
      'Found Date',
      'Department',
      'Mobile Number',
      'Submitted Doc',
      'Handovered Date',
      'Handovered By',
      'Handoverd To',
    ];
    const rows = filtered.map((r, i) => {
      const applicantIdVal =
        r.applicantId ||
        r.applicationNumber ||
        r.rawRecord?.['APPLICANT ID'] ||
        r.rawRecord?.['Applicant Id'] ||
        r.rawRecord?.['APPLICANT_ID'] ||
        '---';
      const categoryVal =
        r.category ||
        r.vehicleClass ||
        r.rawRecord?.['CATEGORY'] ||
        r.rawRecord?.['Category'] ||
        '---';
      
      const phoneCandidates = [
        r.phone,
        r.rawRecord?.['PHONE'],
        r.rawRecord?.['MOBILE NUMBER'],
        r.rawRecord?.['Mobile Number'],
        r.rawRecord?.['MOBILE'],
        r.rawRecord?.['Mobile'],
        r.rawRecord?.['CONTACT'],
        r.rawRecord?.['Contact'],
        r.receiverPhone,
      ];
      let phoneVal = '---';
      for (const c of phoneCandidates) {
        if (typeof c === 'string') {
          const trimmed = c.trim();
          if (trimmed && trimmed !== 'SELF_VERIFIED' && trimmed !== '---' && !/^self/i.test(trimmed)) {
            phoneVal = trimmed;
            break;
          }
        }
      }

      const missingDateVal =
        r.missingDate ||
        r.rawRecord?.['MISSING DATE'] ||
        r.rawRecord?.['MISSING_DATE'] ||
        r.rawRecord?.['Missing Date'] ||
        (r.missingReportedAt ? new Date(r.missingReportedAt).toLocaleDateString() : '') ||
        '---';
      const foundDateVal =
        r.foundDate ||
        r.rawRecord?.['FOUND DATE'] ||
        r.rawRecord?.['FOUND_DATE'] ||
        r.distributedDate ||
        (r.foundReportedAt ? new Date(r.foundReportedAt).toLocaleDateString() : '---');

      const isHandedOver =
        r.foundHandoverDone === true ||
        r.rawRecord?.['FOUND_HANDOVER'] === 'DONE' ||
        (r.status === 'DISTRIBUTED' && r.foundHandoverDone !== false);

      const submittedDocVal = isHandedOver
        ? (r.submittedDocument || r.rawRecord?.['SUBMITTED DOC.'] || r.rawRecord?.['SUBMITTED DOC'] || 'Original Smart Card')
        : '-------';

      const handoveredDateVal = isHandedOver
        ? (r.distributedDate ||
           r.rawRecord?.['DISTRIBUTED DATE'] ||
           r.rawRecord?.['HANDOVER_DATE'] ||
           r.rawRecord?.['HANDOVER DATE'] ||
           (r.distributedAt ? new Date(r.distributedAt).toLocaleDateString() : '') ||
           r.foundDate ||
           '---')
        : '-------';

      const handoveredByVal = isHandedOver
        ? (r.distributedBy ||
           r.rawRecord?.['DISTRIBUTED BY'] ||
           r.rawRecord?.['HANDOVER_BY'] ||
           r.rawRecord?.['HANDOVERED BY'] ||
           r.foundReportedBy ||
           'KOMAL DAHAL')
        : '-------';

      const handoveredToVal = isHandedOver
        ? (r.receiverName ||
           r.receivedBy ||
           r.rawRecord?.['DISTRIBUTED TO'] ||
           r.rawRecord?.['DISRTIBUTED TO'] ||
           r.rawRecord?.['RECEIVED BY'] ||
           r.holderName ||
           '-------')
        : '-------';

      return [
        i + 1,
        `"${applicantIdVal.replace(/"/g, '""')}"`,
        `"${(r.holderName || '').replace(/"/g, '""')}"`,
        `"${(r.licenseNumber || '').replace(/"/g, '""')}"`,
        `"${categoryVal.replace(/"/g, '""')}"`,
        `"${missingDateVal.replace(/"/g, '""')}"`,
        `"${foundDateVal.replace(/"/g, '""')}"`,
        `"${(r.department || r.office || '').replace(/"/g, '""')}"`,
        `"${phoneVal.replace(/"/g, '""')}"`,
        `"${submittedDocVal.replace(/"/g, '""')}"`,
        `"${handoveredDateVal.replace(/"/g, '""')}"`,
        `"${handoveredByVal.replace(/"/g, '""')}"`,
        `"${handoveredToVal.replace(/"/g, '""')}"`,
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `found_smart_cards_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // If user lacks permission to access the Found Smart Cards module
  if (!canAccessFoundView) {
    return (
      <div className="bg-white dark:bg-[#070F1E] border border-rose-300 dark:border-rose-900/60 rounded-3xl p-8 text-center max-w-xl mx-auto my-12 space-y-4 shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto border border-rose-300 dark:border-rose-800">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider font-mono">
            Access Denied (पहुँच अस्वीकृत)
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            तपाईंको प्रयोगकर्ता खातामा फेला परेका स्मार्ट कार्ड अभिलेख हेर्ने अनुमति (found.view वा records.unmark_missing) प्रदान गरिएको छैन ।
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-500 font-mono">
            (Permission: FOUND SMART CARDS - View Found Smart Cards Archive required. Please contact your Super Administrator.)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Found Smart Cards Archive
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Audit logs and registry of recovered smart cards that were previously misplaced or flagged.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={handleExportCsv}
            title={canExport ? 'Export found records ledger to CSV' : 'Access Denied: found.export permission required'}
            className={`p-2.5 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-xs ${
              canExport
                ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-800/70 cursor-pointer'
                : 'bg-slate-100 dark:bg-slate-800/60 text-slate-400 border border-slate-300 dark:border-slate-700 cursor-not-allowed opacity-75'
            }`}
          >
            {canExport ? (
              <FileSpreadsheet className="w-3.5 h-3.5" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>Export Ledger</span>
          </button>

          <button
            onClick={fetchFound}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300/80 dark:bg-[#101b2e] dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-700 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {deniedAlertMessage && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border-2 border-rose-300 dark:border-rose-500/50 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{deniedAlertMessage}</span>
          </div>
          <button
            onClick={() => setDeniedAlertMessage(null)}
            className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline ml-2"
          >
            ✕ Dismiss
          </button>
        </div>
      )}

      {/* Search with History */}
      <div className="bg-white dark:bg-[#101b2e] p-4 rounded-3xl border border-slate-200 dark:border-slate-800/90 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-3 z-10" />
          <HistoryInput
            historyKey="found_search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search found smart cards by Applicant ID, License No, Category, Full Name, Department, Handovered By, Handoverd To..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-[#091220] border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 dark:focus:ring-emerald-500 focus:bg-white dark:focus:bg-[#0c1626] transition-all"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#101b2e] rounded-3xl border border-slate-200 dark:border-slate-800/90 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center">
            <RefreshCw className="w-8 h-8 text-emerald-600 dark:text-emerald-400 animate-spin mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Scanning Found Smart Cards Inventory...
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 dark:bg-[#08101E] text-slate-400 dark:text-slate-500 flex items-center justify-center mx-auto border border-slate-200 dark:border-slate-800">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">No Found Smart Cards</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
                {searchTerm
                  ? 'No found cards match your search criteria.'
                  : 'Recovered cards flagged as found during audits or distribution will be archived here.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border-2 border-[#b8d2eb] dark:border-[#1e2d4a] bg-white dark:bg-[#030914] shadow-md dark:shadow-xl">
            <table className="w-full text-left text-[13px] border-collapse">
              <thead>
                <tr className="bg-[#deecf9] dark:bg-[#08101E] border-b-2 border-[#b8d2eb] dark:border-[#1e2d4a]">
                  {/* 1. S.N. */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 w-12 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      S.N.
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (क्र.सं.)
                    </div>
                  </th>

                  {/* 2. APPLICANT ID */}
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      APPLICANT ID
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (आवेदन नम्बर)
                    </div>
                  </th>

                  {/* 3. FULL NAME */}
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      FULL NAME
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (पुरा नाम)
                    </div>
                  </th>

                  {/* 4. LICENSE NUMBER */}
                  <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      LICENSE NUMBER
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (लाइसेन्स नम्बर)
                    </div>
                  </th>

                  {/* 5. CATEGORY */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 w-20 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      CATEGORY
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (वर्ग)
                    </div>
                  </th>

                  {/* 6. MISSING DATE */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      MISSING DATE
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (हराएको मिति)
                    </div>
                  </th>

                  {/* 7. FOUND DATE */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      FOUND DATE
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (फेला परेको मिति)
                    </div>
                  </th>

                  {/* 8. DEPARTMENT */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      DEPARTMENT
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (शाखा / विभाग)
                    </div>
                  </th>

                  {/* 9. MOBILE NUMBER */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      MOBILE NUMBER
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (सम्पर्क नम्बर)
                    </div>
                  </th>

                  {/* 10. SUBMITTED DOC. */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      SUBMITTED DOC.
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (पेश गरिएको कागजात)
                    </div>
                  </th>

                  {/* 11. HANDOVERED DATE */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      DISTRIBUTION DATE
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (वितरण मिति BS)
                    </div>
                  </th>

                  {/* 12. HANDOVERED BY */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      DISTRIBUTED BY
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (वितरण गर्ने कर्मचारी)
                    </div>
                  </th>

                  {/* 13. HANDOVERED TO */}
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      DISTRIBUTED TO
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (बुझिलिनेको नाम)
                    </div>
                  </th>

                  {/* 14. ACTION */}
                  <th className="py-2.5 px-3 text-center whitespace-nowrap">
                    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      ACTION
                    </div>
                    <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (कार्य)
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#cde0f2] dark:divide-[#1e2d4a]/70 font-normal text-slate-800 dark:text-slate-200 text-[13px]">
                {filtered.map((r, index) => {
                  const isEven = index % 2 === 0;
                  const rowBg = isEven
                    ? 'bg-[#eaf3fc] dark:bg-[#081224]'
                    : 'bg-[#f4f9fe] dark:bg-[#0c182e]';

                  const applicantIdVal =
                    r.applicantId ||
                    r.applicationNumber ||
                    r.rawRecord?.['APPLICANT ID'] ||
                    r.rawRecord?.['Applicant Id'] ||
                    r.rawRecord?.['APPLICANT_ID'] ||
                    '---';

                  const categoryVal =
                    r.category ||
                    r.vehicleClass ||
                    r.rawRecord?.['CATEGORY'] ||
                    r.rawRecord?.['Category'] ||
                    '---';

                  const phoneCandidates = [
                    r.phone,
                    r.rawRecord?.['PHONE'],
                    r.rawRecord?.['MOBILE NUMBER'],
                    r.rawRecord?.['Mobile Number'],
                    r.rawRecord?.['MOBILE'],
                    r.rawRecord?.['Mobile'],
                    r.rawRecord?.['CONTACT'],
                    r.rawRecord?.['Contact'],
                    r.receiverPhone,
                  ];
                  let phoneVal = '---';
                  for (const c of phoneCandidates) {
                    if (typeof c === 'string') {
                      const trimmed = c.trim();
                      if (trimmed && trimmed !== 'SELF_VERIFIED' && trimmed !== '---' && !/^self/i.test(trimmed)) {
                        phoneVal = trimmed;
                        break;
                      }
                    }
                  }

                  const missingDateVal =
                    r.missingDate ||
                    r.rawRecord?.['MISSING DATE'] ||
                    r.rawRecord?.['MISSING_DATE'] ||
                    r.rawRecord?.['Missing Date'] ||
                    (r.missingReportedAt ? new Date(r.missingReportedAt).toLocaleDateString() : '') ||
                    '---';

                  const foundDateVal =
                    r.foundDate ||
                    r.rawRecord?.['FOUND DATE'] ||
                    r.rawRecord?.['FOUND_DATE'] ||
                    r.distributedDate ||
                    (r.foundReportedAt ? new Date(r.foundReportedAt).toLocaleDateString() : '---');

                  const isHandedOver =
                    r.foundHandoverDone === true ||
                    r.rawRecord?.['FOUND_HANDOVER'] === 'DONE' ||
                    (r.status === 'DISTRIBUTED' && r.foundHandoverDone !== false);

                  const submittedDocVal = isHandedOver
                    ? (r.submittedDocument || r.rawRecord?.['SUBMITTED DOC.'] || r.rawRecord?.['SUBMITTED DOC'] || 'Original Smart Card')
                    : '-------';

                  const handoveredDateVal = isHandedOver
                    ? (r.distributedDate ||
                       r.rawRecord?.['DISTRIBUTED DATE'] ||
                       r.rawRecord?.['HANDOVER_DATE'] ||
                       r.rawRecord?.['HANDOVER DATE'] ||
                       (r.distributedAt ? new Date(r.distributedAt).toLocaleDateString() : '') ||
                       r.foundDate ||
                       '---')
                    : '-------';

                  const handoveredByVal = isHandedOver
                    ? (r.distributedBy ||
                       r.rawRecord?.['DISTRIBUTED BY'] ||
                       r.rawRecord?.['HANDOVER_BY'] ||
                       r.rawRecord?.['HANDOVERED BY'] ||
                       r.foundReportedBy ||
                       'KOMAL DAHAL')
                    : '-------';

                  const handoveredToVal = isHandedOver
                    ? (r.receiverName ||
                       r.receivedBy ||
                       r.rawRecord?.['DISTRIBUTED TO'] ||
                       r.rawRecord?.['DISRTIBUTED TO'] ||
                       r.rawRecord?.['RECEIVED BY'] ||
                       r.holderName ||
                       '-------')
                    : '-------';

                  return (
                    <tr
                      key={r.id}
                      className={`${rowBg} hover:bg-[#d5e7fa] dark:hover:bg-[#112445] transition-colors border-b border-[#cde0f2] dark:border-[#1e2d4a]/70`}
                    >
                      {/* 1. S.N. */}
                      <td className="p-1.5 pl-3 text-center font-mono font-medium text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {index + 1}
                      </td>

                      {/* 2. APPLICANT ID */}
                      <td className="p-1.5 pl-3 font-mono font-normal text-slate-900 dark:text-white border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {applicantIdVal}
                      </td>

                      {/* 3. FULL NAME */}
                      <td className="p-1.5 pl-3 font-normal text-slate-900 dark:text-white border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {r.holderName || '---'}
                      </td>

                      {/* 4. LICENSE NUMBER */}
                      <td className="p-1.5 pl-3 font-mono font-normal text-slate-900 dark:text-white border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {r.licenseNumber || '---'}
                      </td>

                      {/* 5. CATEGORY */}
                      <td className="p-1.5 px-3 text-center font-mono font-normal text-slate-900 dark:text-white border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {categoryVal}
                      </td>

                      {/* 6. MISSING DATE */}
                      <td className="p-1.5 px-3 text-center font-mono text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap font-normal">
                        {missingDateVal}
                      </td>

                      {/* 7. FOUND DATE */}
                      <td className="p-1.5 px-3 text-center font-mono text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap font-normal">
                        {foundDateVal}
                      </td>

                      {/* 8. DEPARTMENT */}
                      <td className="p-1.5 px-3 text-center text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap font-normal">
                        {r.department || r.office}
                      </td>

                      {/* 9. MOBILE NUMBER */}
                      <td className="p-1.5 px-3 text-center font-mono text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap font-normal">
                        {phoneVal}
                      </td>

                      {/* 10. SUBMITTED DOC. */}
                      <td className="p-1.5 px-3 text-center text-emerald-700 dark:text-emerald-400 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap font-normal">
                        {submittedDocVal}
                      </td>

                      {/* 11. DISTRIBUTION DATE */}
                      <td className="p-1.5 px-3 text-center font-mono text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap font-normal">
                        {handoveredDateVal}
                      </td>

                      {/* 12. DISTRIBUTED BY */}
                      <td className="p-1.5 px-3 text-center text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap font-normal">
                        {handoveredByVal}
                      </td>

                      {/* 13. DISTRIBUTED TO */}
                      <td className="p-1.5 px-3 text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap font-normal">
                        {handoveredToVal}
                      </td>

                      {/* 14. ACTION */}
                      <td className="p-1.5 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {isHandedOver ? (
                            <div
                              className="inline-flex flex-row items-center justify-center gap-1.5 px-3 py-1 rounded-md bg-emerald-700 dark:bg-emerald-800 border border-emerald-500 text-white text-[11px] font-bold uppercase tracking-wider shadow-xs whitespace-nowrap shrink-0 select-none cursor-default animate-in fade-in"
                              title="हस्तान्तरण सम्पन्न भइसकेको (Smart Card Handover Complete)"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200 shrink-0" />
                              <span>HANDED OVER</span>
                            </div>
                          ) : canHandover ? (
                            <button
                              type="button"
                              onClick={() => setSelectedRecordForHandover(r)}
                              className="inline-flex flex-row items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white border border-emerald-400/80 dark:border-emerald-500/50 text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-xs whitespace-nowrap hover:shadow-md"
                              title="हराएको स्मार्ट कार्ड फेला परेपछि सेवाग्राहीलाई हस्तान्तरण गर्नुहोस् (Click to Hand Over Found Smart Card to Cardholder)"
                            >
                              <Check className="w-3.5 h-3.5 shrink-0 text-emerald-100" />
                              <span>HAND OVER</span>
                            </button>
                          ) : null}

                          {canViewRecord ? (
                            <button
                              onClick={() => onSelectRecord(r)}
                              className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 transition-colors shadow-xs cursor-pointer"
                              title="View Record Details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              title="Access Denied: View Details permission (found.details / records.view) required"
                              className="px-2 py-1 bg-slate-200 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-not-allowed opacity-60"
                            >
                              <Lock className="w-3 h-3" />
                              <span>Locked</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Found Card Handover Modal */}
      {selectedRecordForHandover && (
        <FoundCardHandoverModal
          record={selectedRecordForHandover}
          onClose={() => setSelectedRecordForHandover(null)}
          onSuccess={(_updated) => {
            setSelectedRecordForHandover(null);
            fetchFound();
            if (onRefreshStats) onRefreshStats();
            window.dispatchEvent(new CustomEvent('records-updated'));
          }}
        />
      )}
    </div>
  );
};
