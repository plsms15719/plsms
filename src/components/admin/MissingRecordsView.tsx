import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Search,
  CheckCircle2,
  RefreshCw,
  Eye,
  ShieldCheck,
  Building2,
  Calendar,
  Check,
  PhoneCall,
  Edit2,
} from 'lucide-react';
import { LicenseRecord } from '../../types';
import { api } from '../../services/api';
import { ConfirmFoundModal } from '../modals/ConfirmFoundModal';
import { UpdateMobileModal } from '../modals/UpdateMobileModal';
import { HistoryInput } from '../common/HistoryInput';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, isSuperAdminUser } from '../../utils/permissions';
import { resolveSearchedByStaff } from '../../utils/staffUtils';

interface Props {
  onSelectRecord: (record: LicenseRecord) => void;
  onRefreshStats: () => void;
}

export const MissingRecordsView: React.FC<Props> = ({ onSelectRecord, onRefreshStats }) => {
  const { user } = useAuth();
  const canUnmarkMissing = hasPermission(user, 'records.unmark_missing');
  const isSuperAdmin = isSuperAdminUser(user);

  const [missingRecords, setMissingRecords] = useState<LicenseRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [selectedRecordForFound, setSelectedRecordForFound] = useState<LicenseRecord | null>(null);
  const [selectedRecordForMobile, setSelectedRecordForMobile] = useState<LicenseRecord | null>(null);

  const fetchMissing = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getMissingRecords();
      setMissingRecords(res.records || []);
    } catch (err: any) {
      console.error('Failed to load missing records:', err);
      setError(err?.message || 'डाटाबेस वा सर्भरमा सम्पर्क हुन सकेन। वास्तविक रेकर्डहरू मात्र प्रयोग गरिन्छ। (Database connection unavailable. Real records only.)');
      setMissingRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMissing();

    const handleRecordUpdate = (e: any) => {
      fetchMissing();
      if (onRefreshStats) onRefreshStats();
    };
    window.addEventListener('plsms:record-updated', handleRecordUpdate);
    return () => {
      window.removeEventListener('plsms:record-updated', handleRecordUpdate);
    };
  }, []);

  const handleReinstate = async (recordId: string) => {
    try {
      setActionLoadingId(recordId);
      await api.updateStatus(recordId, { status: 'AVAILABLE' });
      await fetchMissing();
      onRefreshStats();
    } catch (err) {
      console.error('Failed to reinstate record:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filtered = missingRecords.filter((r) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      (r.applicantId && r.applicantId.toLowerCase().includes(q)) ||
      (r.applicationNumber && r.applicationNumber.toLowerCase().includes(q)) ||
      r.licenseNumber.toLowerCase().includes(q) ||
      r.holderName.toLowerCase().includes(q) ||
      (r.category && r.category.toLowerCase().includes(q)) ||
      r.office.toLowerCase().includes(q) ||
      (r.missingReason && r.missingReason.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            Missing Records Room & Triage
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Audit discrepancies, misplaced smart cards, and physical vault search reconciliation workflows.
          </p>
        </div>

        <button
          onClick={fetchMissing}
          className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300/80 dark:bg-[#101b2e] dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-700 font-bold rounded-xl text-xs transition-colors self-start sm:self-auto flex items-center gap-1.5 shadow-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Search with History */}
      <div className="bg-white dark:bg-[#101b2e] p-4 rounded-3xl border border-slate-200 dark:border-slate-800/90 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-3 z-10" />
          <HistoryInput
            historyKey="missing_search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search missing records by License No, Name, or Incident Reason..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-[#091220] border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-600 dark:focus:ring-amber-500 focus:bg-white dark:focus:bg-[#0c1626] transition-all"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#101b2e] rounded-3xl border border-slate-200 dark:border-slate-800/90 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center">
            <RefreshCw className="w-8 h-8 text-amber-600 dark:text-amber-400 animate-spin mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Scanning Missing Records Inventory...
            </p>
          </div>
        ) : error ? (
          <div className="py-16 text-center space-y-3 bg-rose-50/60 dark:bg-rose-950/20 p-6">
            <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto border border-rose-200 dark:border-rose-800">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-700 dark:text-rose-300">{error}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto mt-1">
                कुनै पनि नक्कली वा डमी डाटा लोड गरिएको छैन। केवल प्रमाणित वास्तविक डाटाबेस रेकर्डहरू मात्र प्रयोग गरिन्छ।
              </p>
              <button
                onClick={fetchMissing}
                className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>पुन: प्रयास गर्नुहोस् (Retry Connection)</span>
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border border-emerald-200 dark:border-emerald-800/60">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Zero Missing Records</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
                All uploaded physical license cards are fully accounted for across active office circles.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border-2 border-[#b8d2eb] dark:border-[#1e2d4a] bg-white dark:bg-[#030914] shadow-md dark:shadow-xl">
            <table className="w-full text-left text-[13px] border-collapse">
              <thead>
                <tr className="bg-[#deecf9] dark:bg-[#08101E] border-b-2 border-[#b8d2eb] dark:border-[#1e2d4a]">
                  {/* 1. S.N. */}
                  <th className="py-2.5 px-3 text-center border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 w-12 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      S.N.
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (क्र.सं.)
                    </div>
                  </th>

                  {/* 2. APPLICANT ID */}
                  <th className="py-2.5 px-3 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      APPLICANT ID
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (आवेदन नम्बर)
                    </div>
                  </th>

                  {/* 3. FULL NAME */}
                  <th className="py-2.5 px-3 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      FULL NAME
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (पुरा नाम)
                    </div>
                  </th>

                  {/* 4. LICENSE NUMBER */}
                  <th className="py-2.5 px-3 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      LICENSE NUMBER
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (लाइसेन्स नम्बर)
                    </div>
                  </th>

                  {/* 5. CATEGORY */}
                  <th className="py-2.5 px-3 text-center border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 w-20 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      CATEGORY
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (वर्ग)
                    </div>
                  </th>

                  {/* 6. MOBILE NUMBER */}
                  <th className="py-2.5 px-3 text-center border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      MOBILE NUMBER
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (मोबाइल नम्बर)
                    </div>
                  </th>

                  {/* 7. MISSING DATE */}
                  <th className="py-2.5 px-3 text-center border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      MISSING DATE
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (हराएको मिति)
                    </div>
                  </th>

                  {/* 8. DEPARTMENT */}
                  <th className="py-2.5 px-3 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      DEPARTMENT
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (शाखा / कार्यालय)
                    </div>
                  </th>

                  {/* 9. INCIDENT REASON */}
                  <th className="py-2.5 px-3 border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      INCIDENT REASON
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (कारण)
                    </div>
                  </th>

                  {/* 10. SEARCHED BY */}
                  <th className="py-2.5 px-3 text-center border-r border-[#b8d2eb] dark:border-[#1e2d4a]/80 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      SEARCHED BY
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (खोज्ने कर्मचारी)
                    </div>
                  </th>

                  {/* 11. ACTION */}
                  <th className="py-2.5 px-3 text-center pr-4 whitespace-nowrap">
                    <div className="text-[12px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider leading-tight">
                      ACTION
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                      (कार्य)
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#cde0f2] dark:divide-[#1e2d4a]/70 font-normal text-slate-800 dark:text-slate-200 text-[13px]">
                {filtered.map((r, index) => {
                  const isOdd = index % 2 === 1;
                  const rowBg = isOdd
                    ? 'bg-[#e7f1fc] dark:bg-[#0b162b]'
                    : 'bg-white dark:bg-[#030914]';

                  const rawPhone =
                    r.phone ||
                    r.receiverPhone ||
                    r.rawRecord?.['PHONE'] ||
                    r.rawRecord?.['MOBILE'] ||
                    r.rawRecord?.['Mobile'] ||
                    r.rawRecord?.['MOBILE NUMBER'] ||
                    r.rawRecord?.['CONTACT'] ||
                    r.rawRecord?.['Mobile Number'] ||
                    '';
                  const cleanDigits = rawPhone.replace(/\D/g, '').slice(0, 10);
                  const phoneVal = cleanDigits.length >= 7 ? cleanDigits : (rawPhone.trim() || '---');
                  const missingDateVal = r.missingDate || (r.missingReportedAt ? new Date(r.missingReportedAt).toLocaleDateString() : '---');
                  const reasonVal =
                    !r.missingReason ||
                    r.missingReason === 'Not found in physical dispatch batch / shelf slot' ||
                    r.missingReason === 'Reported missing during inventory scan'
                      ? 'While Searching Not-Found in Sorted Slot'
                      : r.missingReason;
                  const applicantIdVal =
                    r.applicantId ||
                    r.applicationNumber ||
                    (r.rawRecord && (r.rawRecord['APPLICANT ID'] || r.rawRecord['Applicant ID'] || r.rawRecord['applicant_id'])) ||
                    '---';

                  return (
                    <tr
                      key={r.id}
                      className={`${rowBg} hover:bg-[#d5e7fa] dark:hover:bg-[#112445] transition-colors border-b border-[#cde0f2] dark:border-[#1e2d4a]/70`}
                    >
                      <td className="p-2 pl-3 text-center font-mono font-medium text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {index + 1}
                      </td>
                      <td className="p-2 pl-3 font-mono font-bold text-sky-700 dark:text-sky-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {applicantIdVal}
                      </td>
                      <td className="p-2 pl-3 font-semibold text-slate-900 dark:text-white border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {r.holderName}
                      </td>
                      <td className="p-2 pl-3 font-mono font-bold text-slate-900 dark:text-white border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {r.licenseNumber}
                      </td>
                      <td className="p-2 text-center border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700">
                          {r.category || r.vehicleClass || '---'}
                        </span>
                      </td>
                      <td className="p-1.5 text-center border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {phoneVal !== '---' ? (
                          <div className="inline-flex items-center justify-center gap-1.5 font-mono text-[13px] text-slate-900 dark:text-white">
                            <span className="font-bold text-slate-900 dark:text-white">
                              {phoneVal}
                            </span>
                            {isSuperAdmin && (
                              <button
                                type="button"
                                onClick={() => setSelectedRecordForMobile(r)}
                                className="p-1 text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 rounded transition-colors cursor-pointer ml-0.5"
                                title="Update contact mobile number (Super Admin only)"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ) : isSuperAdmin ? (
                          <button
                            type="button"
                            onClick={() => setSelectedRecordForMobile(r)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-300 dark:border-amber-600/50 text-amber-800 dark:text-amber-300 text-[11px] font-bold tracking-tight cursor-pointer shadow-2xs transition-all animate-pulse"
                            title="Mobile number is compulsory to call cardholder when found. Click to enter mobile number (Super Admin only)."
                          >
                            <PhoneCall className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                            <span>+ Add Mobile (Compulsory)</span>
                          </button>
                        ) : (
                          <span className="font-mono text-slate-400 dark:text-slate-500 text-xs">
                            ---
                          </span>
                        )}
                      </td>
                      <td className="p-1.5 text-center text-slate-700 dark:text-slate-300 font-mono text-[13px] border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {missingDateVal}
                      </td>
                      <td className="p-1.5 text-slate-700 dark:text-slate-300 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap">
                        {r.office}
                      </td>
                      <td className="p-1.5 text-amber-800 dark:text-amber-300 max-w-xs truncate font-normal border-r border-[#cde0f2] dark:border-[#1e2d4a]/70">
                        {reasonVal}
                      </td>
                      <td className="p-1.5 text-slate-800 dark:text-slate-200 border-r border-[#cde0f2] dark:border-[#1e2d4a]/70 whitespace-nowrap font-medium text-center">
                        {resolveSearchedByStaff(r) === '-----' ? (
                          <span className="font-mono text-slate-500 dark:text-slate-400 font-bold tracking-widest">-----</span>
                        ) : (
                          <span className="font-bold text-slate-900 dark:text-slate-100">{resolveSearchedByStaff(r)}</span>
                        )}
                      </td>
                      <td className="p-1.5 pr-3 text-center whitespace-nowrap">
                        {canUnmarkMissing ? (
                          <div className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={actionLoadingId === r.id}
                              onClick={() => setSelectedRecordForFound(r)}
                              className="px-3 py-1 bg-purple-600 hover:bg-purple-500 border border-purple-400 text-white rounded text-[13px] font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                              title="Confirm Found Card"
                            >
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                              <span>FOUND</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm Found Card Modal */}
      {selectedRecordForFound && (
        <ConfirmFoundModal
          record={selectedRecordForFound}
          onClose={() => setSelectedRecordForFound(null)}
          onSuccess={() => {
            setSelectedRecordForFound(null);
            fetchMissing();
            onRefreshStats();
          }}
        />
      )}

      {/* Update Compulsory Mobile Modal (Super Admin only) */}
      {selectedRecordForMobile && isSuperAdmin && (
        <UpdateMobileModal
          record={selectedRecordForMobile}
          onClose={() => setSelectedRecordForMobile(null)}
          onSuccess={() => {
            setSelectedRecordForMobile(null);
            fetchMissing();
            onRefreshStats();
          }}
        />
      )}
    </div>
  );
};
