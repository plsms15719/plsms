import React, { useRef, useState } from 'react';
import { X, Printer, Download, FileText, CheckCircle2, ShieldCheck } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AlphabeticalDashboardData } from '../../types';
import { getNepaliDate } from '../../utils/dateUtils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  data: AlphabeticalDashboardData | null;
  fromDate?: string;
  toDate?: string;
}

export const AlphabeticalPrintModal: React.FC<Props> = ({
  isOpen,
  onClose,
  data,
  fromDate,
  toDate,
}) => {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const todayBS = getNepaliDate(new Date());
  const formattedToday = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const totalCount = data?.totalCount || 0;
  const totalDistributed = data?.totalDistributed || 0;
  const totalRemained = data?.totalRemained || 0;

  const items = data?.items && data.items.length > 0
    ? data.items
    : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => ({
        letter: l,
        label: `Alphabet ${l}`,
        count: 0,
        distributed: 0,
        remained: 0,
      }));

  // Handle direct print
  const handlePrint = () => {
    const printContent = printAreaRef.current;
    if (!printContent) {
      window.print();
      return;
    }

    // Create a hidden iframe for 100% reliable printing inside iFrame environments
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Smart Card Alphabetical Dashboard Report</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 15mm;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #0f172a;
              background: #ffffff;
              margin: 0;
              padding: 0;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .header-title {
              text-align: center;
              border-bottom: 2px solid #0f172a;
              padding-bottom: 12px;
              margin-bottom: 14px;
            }
            .org-sub {
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 1px;
              color: #475569;
            }
            .org-main {
              font-size: 18px;
              font-weight: 900;
              margin: 3px 0;
              color: #0f172a;
            }
            .report-title {
              font-size: 13px;
              font-weight: 800;
              color: #0284c7;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .meta-bar {
              display: flex;
              justify-content: space-between;
              font-size: 11px;
              margin-bottom: 12px;
              padding: 6px 10px;
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 16px;
              font-size: 11px;
            }
            th {
              background-color: #0f172a !important;
              color: #ffffff !important;
              font-weight: 800;
              text-transform: uppercase;
              padding: 6px 8px;
              border: 1px solid #0f172a;
              text-align: center;
              font-size: 10px;
              letter-spacing: 0.5px;
            }
            th.text-left {
              text-align: left;
            }
            td {
              padding: 4.5px 8px;
              border: 1px solid #cbd5e1;
              color: #1e293b;
            }
            td.text-left {
              text-align: left;
            }
            td.text-center {
              text-align: center;
            }
            tr:nth-child(even) td {
              background-color: #f8fafc;
            }
            tr.total-row td {
              background-color: #f1f5f9 !important;
              font-weight: 900;
              border-top: 2px solid #0f172a;
              border-bottom: 2px solid #0f172a;
              font-size: 11px;
            }
            .signatures {
              margin-top: 36px;
              display: flex;
              justify-content: space-between;
              font-size: 11px;
              padding-top: 10px;
            }
            .sig-block {
              text-align: center;
              width: 160px;
            }
            .sig-line {
              border-top: 1px dashed #64748b;
              margin-bottom: 4px;
            }
            .footer-note {
              margin-top: 24px;
              font-size: 9px;
              color: #64748b;
              text-align: center;
              border-top: 1px solid #e2e8f0;
              padding-top: 6px;
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }, 400);
  };

  // Generate & Download PDF
  const handleDownloadPdf = () => {
    try {
      setIsGeneratingPdf(true);
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      // Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      doc.text('GOVERNMENT OF NEPAL / LICENSING AUTHORITY', 105, 14, { align: 'center' });

      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42);
      doc.text('SMART CARD AGGREGATE ALPHABETICAL REPORT', 105, 21, { align: 'center' });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      const filterRangeStr = fromDate || toDate
        ? `Filtered Period: ${fromDate || 'Start'} to ${toDate || 'Present'} (वि.सं.)`
        : 'All-Time Cumulative Master Registry Records';
      doc.text(filterRangeStr, 105, 27, { align: 'center' });

      // Meta Box
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 31, 182, 9, 1.5, 1.5, 'FD');

      doc.setFontSize(8.5);
      doc.setTextColor(30, 41, 59);
      doc.text(`Generated Date (वि.सं.): ${todayBS} (${formattedToday})`, 18, 37);
      doc.text(`Total Records: ${totalCount} Cards`, 140, 37);

      // Table data
      const tableData = items.map((row) => [
        row.label,
        row.count.toString(),
        row.distributed.toString(),
        row.remained.toString(),
      ]);

      // Add summary row
      tableData.push([
        'TOTAL (जम्मा)',
        totalCount.toString(),
        totalDistributed.toString(),
        totalRemained.toString(),
      ]);

      autoTable(doc, {
        startY: 43,
        head: [['ALPHABET (वर्ण)', 'COUNT (कुल संख्या)', 'DISTRIBUTED (वितरित)', 'REMAINED (बाँकी)']],
        body: tableData,
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
          fontSize: 8.5,
          cellPadding: 2,
        },
        bodyStyles: {
          fontSize: 8,
          cellPadding: 1.8,
          textColor: [30, 41, 59],
        },
        columnStyles: {
          0: { halign: 'left', fontStyle: 'bold', cellWidth: 55 },
          1: { halign: 'center', cellWidth: 42 },
          2: { halign: 'center', cellWidth: 42 },
          3: { halign: 'center', cellWidth: 43 },
        },
        didParseCell: (dataCell) => {
          // Style total row
          if (dataCell.row.index === items.length) {
            dataCell.cell.styles.fontStyle = 'bold';
            dataCell.cell.styles.fillColor = [241, 245, 249];
            dataCell.cell.styles.textColor = [15, 23, 42];
          }
        },
        margin: { left: 14, right: 14 },
      });

      // Signatures at bottom
      const finalY = (doc as any).lastAutoTable.finalY + 14;
      if (finalY < 270) {
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);

        // Prepared by
        doc.line(18, finalY + 12, 65, finalY + 12);
        doc.text('Prepared By (Operator)', 22, finalY + 16);

        // Verified by
        doc.line(80, finalY + 12, 128, finalY + 12);
        doc.text('Verified By (Supervisor)', 84, finalY + 16);

        // Authorized officer
        doc.line(145, finalY + 12, 192, finalY + 12);
        doc.text('Authorized Officer', 152, finalY + 16);
      }

      const fileName = `SmartCard_Alphabetical_Report_${todayBS.replace(/-/g, '')}.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error('Error generating PDF:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-white dark:bg-[#071120] rounded-2xl shadow-2xl border border-slate-700/70 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Top Action Toolbar */}
        <div className="p-3.5 bg-[#050c18] border-b border-slate-800 flex items-center justify-between text-white select-none">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-500/50 text-cyan-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black tracking-wide text-white uppercase font-mono">
                Alphabetical Dashboard Print / PDF Preview
              </h3>
              <p className="text-[11px] text-slate-400">
                Official Government Smart Card Inventory & Distribution Report
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Direct Print Button */}
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 bg-[#008ba8] hover:bg-[#007790] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
              title="Print to printer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print (प्रिन्ट)</span>
            </button>

            {/* Download PDF Button */}
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isGeneratingPdf}
              className="px-3 py-1.5 bg-[#12223a] hover:bg-[#1a3154] border border-cyan-500/40 text-cyan-300 hover:text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              title="Download as PDF document"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isGeneratingPdf ? 'Generating...' : 'PDF'}</span>
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              title="Close Preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Document Container */}
        <div className="p-4 sm:p-6 overflow-y-auto bg-slate-100 dark:bg-slate-900 flex justify-center">
          <div
            ref={printAreaRef}
            className="w-full max-w-2xl bg-white text-slate-900 p-6 sm:p-8 rounded-xl shadow-lg border border-slate-200"
            style={{ minHeight: '840px' }}
          >
            {/* Printable Report Header */}
            <div className="header-title text-center border-b-2 border-slate-900 pb-3 mb-4">
              <div className="org-sub text-[11px] font-bold uppercase tracking-widest text-slate-500">
                Government Licensing & Smart Card Authority
              </div>
              <h2 className="org-main text-lg sm:text-xl font-black text-slate-900 mt-0.5 uppercase tracking-wide">
                Smart Card Aggregate Alphabetical Report
              </h2>
              <div className="report-title text-xs font-bold text-cyan-700 tracking-wider mt-0.5">
                वर्णमाला अनुसार स्मार्ट कार्ड मौज्दात तथा वितरण प्रतिवेदन (A–Z)
              </div>
            </div>

            {/* Report Meta Info Bar */}
            <div className="meta-bar flex flex-wrap items-center justify-between text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-2.5 mb-3 text-slate-700 font-mono">
              <div>
                <span className="text-slate-500 font-bold">Generated Date (वि.सं.):</span>{' '}
                <strong className="text-slate-900">{todayBS}</strong> ({formattedToday})
              </div>
              <div>
                <span className="text-slate-500 font-bold">Filter Period:</span>{' '}
                <strong className="text-slate-900">
                  {fromDate || toDate
                    ? `${fromDate || 'Beginning'} to ${toDate || 'Current Date'}`
                    : 'Cumulative Master Records'}
                </strong>
              </div>
            </div>

            {/* Report Table */}
            <table className="w-full border-collapse text-left text-[13px] mb-4">
              <thead>
                <tr className="bg-slate-900 text-white text-[11px] font-bold uppercase tracking-wider font-mono">
                  <th className="py-1.5 px-3 text-left border border-slate-900 text-white bg-slate-900">
                    ALPHABET (वर्ण)
                  </th>
                  <th className="py-1.5 px-3 text-center border border-slate-900 text-white bg-slate-900">
                    COUNT (कुल संख्या)
                  </th>
                  <th className="py-1.5 px-3 text-center border border-slate-900 text-emerald-400 bg-slate-900">
                    DISTRIBUTED (वितरित)
                  </th>
                  <th className="py-1.5 px-3 text-center border border-slate-900 text-amber-300 bg-slate-900">
                    REMAINED (बाँकी)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono text-[13px]">
                {items.map((row, idx) => (
                  <tr
                    key={row.letter}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}
                  >
                    <td className="py-1 px-3 border border-slate-200 font-semibold text-slate-900">
                      {row.label}
                    </td>
                    <td className="py-1 px-3 border border-slate-200 text-center font-bold text-slate-800">
                      {row.count.toLocaleString()}
                    </td>
                    <td className="py-1 px-3 border border-slate-200 text-center font-bold text-emerald-700">
                      {row.distributed.toLocaleString()}
                    </td>
                    <td className="py-1 px-3 border border-slate-200 text-center font-bold text-amber-700">
                      {row.remained.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total-row bg-slate-100 text-slate-900 text-[13px] font-black font-mono border-t-2 border-b-2 border-slate-900">
                  <td className="py-2 px-3 border border-slate-300 text-left uppercase tracking-wider">
                    TOTAL (जम्मा)
                  </td>
                  <td className="py-2 px-3 border border-slate-300 text-center text-blue-700 font-black">
                    {totalCount.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 border border-slate-300 text-center text-emerald-700 font-black">
                    {totalDistributed.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 border border-slate-300 text-center text-amber-700 font-black">
                    {totalRemained.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Formula verification tag */}
            <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between border-t border-slate-100 pt-2 mb-8">
              <span>* Computation Formula: REMAINED = COUNT - DISTRIBUTED</span>
              <span>
                Verified Balance: {totalCount} = {totalDistributed} + {totalRemained}
              </span>
            </div>

            {/* Official Signatures */}
            <div className="signatures flex justify-between items-end pt-6 text-[11px] text-slate-600 font-mono">
              <div className="sig-block text-center w-36">
                <div className="border-t border-dashed border-slate-400 pt-1">
                  Prepared By (Operator)
                </div>
              </div>
              <div className="sig-block text-center w-36">
                <div className="border-t border-dashed border-slate-400 pt-1">
                  Verified By (Supervisor)
                </div>
              </div>
              <div className="sig-block text-center w-36">
                <div className="border-t border-dashed border-slate-400 pt-1">
                  Authorized Officer
                </div>
              </div>
            </div>

            {/* Document footer note */}
            <div className="footer-note text-center text-[9px] text-slate-400 mt-8 pt-3 border-t border-slate-200">
              This is a system-generated official summary from the Smart Card Management System.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
