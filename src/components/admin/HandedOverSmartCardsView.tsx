import React, { useState, useEffect, useMemo } from 'react';
import {
  Handshake,
  Search,
  RefreshCw,
  Eye,
  FileSpreadsheet,
  ShieldAlert,
  Lock,
  Filter,
  CheckCircle2,
} from 'lucide-react';
import { LicenseRecord } from '../../types';
import { api } from '../../services/api';
import { HistoryInput } from '../common/HistoryInput';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, isSuperAdminUser } from '../../utils/permissions';

interface Props {
  onSelectRecord: (record: LicenseRecord) => void;
  onRefreshStats?: () => void;
}

export const HandedOverSmartCardsView: React.FC<Props> = ({
  onSelectRecord,
  onRefreshStats,
}) => {
  const { user } = useAuth();
  const isSuperAdmin = isSuperAdminUser(user);

  // Permissions: Access Handed Over Smart Cards
  const canAccessView =
    hasPermission(user, 'records.distribute') ||
    hasPermission(user, 'found.view') ||
    hasPermission(user, 'records.view') ||
    isSuperAdmin;

  const canExport =
    hasPermission(user, 'records.export_excel') ||
    hasPermission(user, 'found.export') ||
    hasPermission(user, 'distribution.export_csv') ||
    isSuperAdmin;

  const [records, setRecords] = useState<LicenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchHandedOver = async () => {
    try {
      setLoading(true);
      const res = await api.getHandedOverRecords();
      setRecords(res.records || []);
    } catch (err) {
      console.error('Failed to load handed over smart cards:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHandedOver();
  }, []);

  // Filtered dataset based on search term
  const filteredRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return records.filter((r) => {
      if (!q) return true;

      const applicantId = (r.applicantId || r.applicationNumber || r.rawRecord?.['APPLICANT ID'] || '').toLowerCase();
      const holderName = (r.holderName || r.rawRecord?.['FULL NAME'] || '').toLowerCase();
      const licenseNumber = (r.licenseNumber || r.rawRecord?.['LICENSE NUMBER'] || '').toLowerCase();
      const category = (r.category || r.rawRecord?.['CATEGORY'] || '').toLowerCase();
      const department = (r.department || r.office || r.rawRecord?.['DEPARTMENT'] || '').toLowerCase();
      const phone = (r.phone || r.rawRecord?.['PHONE'] || r.rawRecord?.['MOBILE NUMBER'] || '').toLowerCase();
      const subDoc = (r.submittedDocument || r.rawRecord?.['SUBMITTED DOC'] || '').toLowerCase();
      const handoveredBy = (r.distributedBy || r.rawRecord?.['DISTRIBUTED BY'] || '').toLowerCase();
      const handoveredTo = (r.receiverName || r.receivedBy || r.rawRecord?.['DISTRIBUTED TO'] || r.holderName || '').toLowerCase();
      const missingDate = (r.missingDate || r.rawRecord?.['MISSING DATE'] || '').toLowerCase();
      const foundDate = (r.foundDate || r.rawRecord?.['FOUND DATE'] || '').toLowerCase();
      const handoveredDate = (r.distributedDate || r.rawRecord?.['DISTRIBUTED DATE'] || '').toLowerCase();

      return (
        applicantId.includes(q) ||
        holderName.includes(q) ||
        licenseNumber.includes(q) ||
        category.includes(q) ||
        department.includes(q) ||
        phone.includes(q) ||
        subDoc.includes(q) ||
        handoveredBy.includes(q) ||
        handoveredTo.includes(q) ||
        missingDate.includes(q) ||
        foundDate.includes(q) ||
        handoveredDate.includes(q)
      );
    });
  }, [records, searchTerm]);

  // CSV Export handler
  const handleExportCsv = () => {
    if (!canExport) return;
    if (filteredRecords.length === 0) return;

    const headers = [
      'S.N.',
      'APPLICANT ID',
      'FULL NAME',
      'LICENSE NO',
      'CATEGORY',
      'MISSING DATE',
      'FOUND DATE',
      'DEPARTMENT',
      'MOBILE NUMBER',
      'SUBMITTED DOC',
      'HANDOVERED DATE',
      'HANDOVERED BY',
      'HANDOVERD TO',
    ];

    const rows = filteredRecords.map((r, idx) => {
      const applicantIdVal = r.applicantId || r.applicationNumber || r.rawRecord?.['APPLICANT ID'] || '';
      const categoryVal = r.category || r.rawRecord?.['CATEGORY'] || 'K';
      const missingDateVal = r.missingDate || r.rawRecord?.['MISSING DATE'] || '---';
      const foundDateVal = r.foundDate || r.rawRecord?.['FOUND DATE'] || '---';
      const phoneVal = r.phone || r.rawRecord?.['PHONE'] || r.rawRecord?.['MOBILE NUMBER'] || '---';
      const submittedDocVal = r.submittedDocument || r.rawRecord?.['SUBMITTED DOC'] || 'Original Smart Card';
      const handoveredDateVal = r.distributedDate || r.rawRecord?.['DISTRIBUTED DATE'] || '---';
      const handoveredByVal = r.distributedBy || r.rawRecord?.['DISTRIBUTED BY'] || 'KOMAL DAHAL';
      const handoveredToVal = r.receiverName || r.receivedBy || r.rawRecord?.['DISTRIBUTED TO'] || r.holderName || '';

      return [
        idx + 1,
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
    link.setAttribute('download', `handed_over_smart_cards_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Lacks access check
  if (!canAccessView) {
    return (
      <div className="bg-white dark:bg-[#070F1E] border border-rose-300 dark:border-rose-900/60 rounded-2xl p-8 text-center max-w-xl mx-auto my-12 space-y-4 shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto border border-rose-300 dark:border-rose-800">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider font-mono">
            Access Denied (पहुँच अस्वीकृत)
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            तपाईंको प्रयोगकर्ता खातामा हस्तान्तरण गरिएका स्मार्ट कार्डहरूको अभिलेख हेर्ने अनुमति प्रदान गरिएको छैन ।
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-500 font-mono">
            (Permission: HANDED OVER SMART CARDS - View Handed Over Records required. Please contact your Super Administrator.)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Handshake className="w-6 h-6 text-purple-600 dark:text-purple-400 shrink-0" />
            <span>HANDED OVER SMART CARDS</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              हस्तान्तरण गरिएका स्मार्ट कार्डहरू
            </span>
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Official registry and audit ledger of smart cards recovered from missing/found status and handed over to applicants.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            onClick={handleExportCsv}
            title={canExport ? 'Export handed over cards ledger to CSV' : 'Access Denied: Export permission required'}
            className={`px-3.5 py-2 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-xs ${
              canExport
                ? 'bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-300 dark:bg-purple-950/40 dark:hover:bg-purple-900/60 dark:text-purple-300 dark:border-purple-800/70 cursor-pointer'
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
            onClick={fetchHandedOver}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300/80 dark:bg-[#101b2e] dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-700 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-[#0c1626] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input with History */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <HistoryInput
              historyKey="handed_over_search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search handed over smart cards by Applicant ID, License No, Category, Full Name, Department, Handovered By, Handoverd To..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-[#091220] border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-600 dark:focus:ring-purple-500 focus:bg-white dark:focus:bg-[#0c1626] transition-all"
            />
          </div>

          {/* Ledger Tag Badge */}
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-[#091220] p-1 rounded-xl border border-slate-200 dark:border-slate-800 shrink-0">
            <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 text-white shadow-xs flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Found & Handed Over ({records.length})</span>
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
          <div>
            Showing <strong className="text-purple-600 dark:text-purple-400">{filteredRecords.length}</strong> of{' '}
            <strong>{records.length}</strong> handed over cards
          </div>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="text-xs text-rose-500 hover:text-rose-600 font-bold hover:underline cursor-pointer"
            >
              Clear Search
            </button>
          )}
        </div>
      </div>

      {/* Main Ledger Table */}
      <div className="overflow-x-auto rounded-xl border-2 border-[#b8d2eb] dark:border-[#1e2d4a] bg-white dark:bg-[#030914] shadow-md dark:shadow-xl">
        <table className="w-full text-left text-[13px] border-collapse min-w-[1300px]">
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
              <th className="py-2.5 px-3 border-r border-slate-200 dark:border-[#1e2d4a]/70 whitespace-nowrap min-w-[170px]">
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
              <th className="py-2.5 px-3 text-center w-20 whitespace-nowrap">
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
            {loading ? (
              <tr>
                <td colSpan={14} className="py-12 text-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
                  <span>Loading handed over smart cards ledger...</span>
                </td>
              </tr>
            ) : filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-12 text-center text-slate-500 dark:text-slate-400">
                  <div className="max-w-md mx-auto space-y-2">
                    <Handshake className="w-8 h-8 mx-auto text-slate-400 dark:text-slate-600" />
                    <p className="font-bold">No handed over smart cards found matching your query.</p>
                    <p className="text-[11px] text-slate-400">
                      {searchTerm ? 'Try checking for typos or searching by license number or applicant name.' : 'No handed over smart cards recorded yet.'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredRecords.map((record, index) => {
                const isEven = index % 2 === 0;
                const rowBg = isEven
                  ? 'bg-[#eaf3fc] dark:bg-[#081224]'
                  : 'bg-[#f4f9fe] dark:bg-[#0c182e]';

                const applicantIdVal =
                  record.applicantId || record.applicationNumber || record.rawRecord?.['APPLICANT ID'] || '---';
                const categoryVal = record.category || record.rawRecord?.['CATEGORY'] || 'K';
                const missingDateVal =
                  record.missingDate ||
                  record.rawRecord?.['MISSING DATE'] ||
                  record.rawRecord?.['MISSING_DATE'] ||
                  '---';
                const foundDateVal =
                  record.foundDate ||
                  record.rawRecord?.['FOUND DATE'] ||
                  record.rawRecord?.['FOUND_DATE'] ||
                  '---';
                const phoneVal =
                  record.phone ||
                  record.rawRecord?.['PHONE'] ||
                  record.rawRecord?.['MOBILE NUMBER'] ||
                  record.rawRecord?.['Mobile'] ||
                  '---';
                const submittedDocVal =
                  record.submittedDocument ||
                  record.rawRecord?.['SUBMITTED DOC'] ||
                  record.rawRecord?.['SUBMITTED DOC.'] ||
                  (foundDateVal !== '---' ? 'Original Smart Card' : 'Citizenship / License Slip');
                const handoveredDateVal =
                  record.distributedDate || record.rawRecord?.['DISTRIBUTED DATE'] || '---';
                const handoveredByVal =
                  record.distributedBy || record.rawRecord?.['DISTRIBUTED BY'] || 'KOMAL DAHAL';
                const handoveredToVal =
                  record.receiverName ||
                  record.receivedBy ||
                  record.rawRecord?.['DISTRIBUTED TO'] ||
                  record.rawRecord?.['DISRTIBUTED TO'] ||
                  record.holderName ||
                  '---';

                return (
                  <tr
                    key={record.id || `${record.licenseNumber}-${index}`}
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
                      {record.holderName || '---'}
                    </td>

                    {/* 4. LICENSE NUMBER */}
                    <td className="p-1.5 pl-3 font-mono font-normal text-slate-900 dark:text-white border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                      {record.licenseNumber || '---'}
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
                      {record.department || record.office || "कार्ड वितरण शाखा - 'क'"}
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
                      <button
                        onClick={() => onSelectRecord(record)}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 transition-colors shadow-xs cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
