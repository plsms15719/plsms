import React from 'react';
import { X, Printer, ShieldCheck, CheckCircle2, QrCode } from 'lucide-react';
import { DistributionRecord } from '../../types';

interface Props {
  distribution: DistributionRecord | null;
  onClose: () => void;
}

export const PrintSlipModal: React.FC<Props> = ({ distribution, onClose }) => {
  if (!distribution) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 print:p-0 print:bg-white print:fixed print:inset-0">
      <div className="w-full max-w-lg bg-white dark:bg-[#0c1427] rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative print:border-none print:shadow-none print:max-w-none print:rounded-none text-slate-900 dark:text-slate-100 print:text-black">
        {/* Actions Bar (hidden on print) */}
        <div className="p-4 bg-slate-900 dark:bg-[#070d19] text-white flex items-center justify-between border-b border-slate-800 print:hidden">
          <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
            Handover Receipt Slip
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Receipt
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Slip Content */}
        <div className="p-8 space-y-6 text-slate-900 dark:text-slate-100 print:text-black bg-white dark:bg-[#0c1427] print:bg-white">
          {/* Slip Header */}
          <div className="text-center border-b-2 border-slate-900 dark:border-slate-700 print:border-slate-900 pb-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 print:text-slate-500">
              Government Licensing Authority
            </div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white print:text-black mt-1">
              Official Driving License Delivery Slip
            </h2>
            <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 print:text-slate-600 mt-0.5">
              Reference Code: <span className="font-mono text-indigo-700 dark:text-indigo-400 print:text-indigo-700">{distribution.handoverReference}</span>
            </div>
          </div>

          {/* Core Info Grid */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50/90 dark:bg-[#101b33] print:bg-white shadow-xs">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                License Number
              </span>
              <span className="text-sm font-black text-slate-900 dark:text-white print:text-black font-mono mt-0.5 block">
                {distribution.licenseNumber || '---'}
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50/90 dark:bg-[#101b33] print:bg-white shadow-xs">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                License Holder
              </span>
              <span className="text-sm font-bold text-slate-900 dark:text-white print:text-black mt-0.5 block">
                {distribution.holderName}
              </span>
            </div>
          </div>

          {/* Receiver Information */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-2 text-xs bg-white dark:bg-[#101b33] print:bg-white shadow-xs">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 pb-1">
              Receiver & Handover Details
            </div>
            <div className="grid grid-cols-2 gap-2 text-slate-800 dark:text-slate-200 print:text-slate-800">
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Receiver Name:</span>{' '}
                <span className="font-bold text-slate-900 dark:text-white print:text-black">{distribution.receiverName}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold">National ID:</span>{' '}
                <span className="font-mono font-bold text-slate-900 dark:text-white print:text-black">{distribution.receiverNid}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Contact Phone:</span>{' '}
                <span className="font-mono font-bold text-slate-900 dark:text-white print:text-black">{distribution.receiverPhone}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Relationship:</span>{' '}
                <span className="font-bold text-slate-900 dark:text-white print:text-black">{distribution.receiverRelation}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Issuing Office:</span>{' '}
                <span className="font-bold text-slate-900 dark:text-white print:text-black">{distribution.office}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Handover Date:</span>{' '}
                <span className="font-bold text-slate-900 dark:text-white print:text-black">{new Date(distribution.distributedAt).toLocaleString()}</span>
              </div>
            </div>
            {distribution.remarks && (
              <div className="text-[11px] text-slate-600 pt-1 border-t border-slate-100">
                <span className="font-semibold text-slate-500">Status:</span> {distribution.remarks}
              </div>
            )}
          </div>

          {/* Signatures Area */}
          <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs">
            <div>
              <div className="border-t border-slate-400 pt-2 font-bold text-slate-800">
                Receiver Signature
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">I confirm receipt of the smart card</div>
            </div>
            <div>
              <div className="border-t border-slate-400 pt-2 font-bold text-slate-800">
                Authorized Dispatch Officer
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">{distribution.distributedBy}</div>
            </div>
          </div>

          {/* Footer Security Notice */}
          <div className="text-[10px] text-center text-slate-400 pt-2 border-t border-slate-100">
            System Generated Record • PRINTED LICENSE SEARCH MANAGEMENT SYSTEM (PLSMS) • Tamper Evidence Verified
          </div>
        </div>
      </div>
    </div>
  );
};
