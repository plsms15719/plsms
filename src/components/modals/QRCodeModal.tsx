import React, { useState, useEffect, useRef } from 'react';
import { QrCode, X, Download, Printer, Copy, Check } from 'lucide-react';
import { generateQrMatrix } from '../../utils/qrCodeGen';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const QRCodeModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Use current live app URL
  const appUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}${window.location.pathname === '/' ? '' : window.location.pathname}`
      : 'https://tmodl-sunsari.onrender.com/';

  // Render QR Code onto canvas whenever modal opens or appUrl changes
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      const matrix = generateQrMatrix(appUrl, 'H');
      const cells = matrix.length;
      const size = 220;
      const margin = 8;
      const availableSize = size - margin * 2;
      const cellSize = availableSize / cells;

      canvas.width = size;
      canvas.height = size;

      // Clean white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);

      // Royal navy blue modules matching Picture 2 (#1c3987)
      ctx.fillStyle = '#1c3987';
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          if (matrix[r][c]) {
            const x = Math.round(margin + c * cellSize);
            const y = Math.round(margin + r * cellSize);
            const w = Math.ceil(cellSize);
            const h = Math.ceil(cellSize);
            ctx.fillRect(x, y, w, h);
          }
        }
      }
    } catch (err) {
      console.error('Failed to render QR Code:', err);
    }
  }, [isOpen, appUrl]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadPng = () => {
    const canvas = document.getElementById('plsms-qr-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    // Create high-resolution branded poster canvas
    const printCanvas = document.createElement('canvas');
    const ctx = printCanvas.getContext('2d');
    if (!ctx) return;

    const width = 640;
    const height = 670;
    printCanvas.width = width;
    printCanvas.height = height;

    // Card background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Top Header - Royal Navy
    ctx.fillStyle = '#1c3987';
    ctx.fillRect(0, 0, width, 60);

    // Red Divider Line
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(0, 60, width, 6);

    // Header Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Share PLSMS', width / 2, 38);

    // Office Text at top just above QR Code
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Transport Management Office, Driving License', width / 2, 98);

    ctx.fillStyle = '#64748b';
    ctx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Itahari, Sunsari', width / 2, 124);

    // Draw QR Code
    const qrSize = 380;
    const qrX = (width - qrSize) / 2;
    const qrY = 155;

    // Dashed border around QR
    ctx.strokeStyle = '#1c3987';
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(qrX - 22, qrY - 22, qrSize + 44, qrSize + 44);
    ctx.setLineDash([]);

    ctx.drawImage(canvas, qrX, qrY, qrSize, qrSize);

    // System Title below QR Code
    ctx.fillStyle = '#1c3987';
    ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Printed License Search Management System (PLSMS)', width / 2, qrY + qrSize + 52);

    const dataUrl = printCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'PLSMS-QR-Code.png';
    link.href = dataUrl;
    link.click();
  };

  const handlePrint = () => {
    const canvas = document.getElementById('plsms-qr-canvas') as HTMLCanvasElement | null;
    const qrDataUrl = canvas ? canvas.toDataURL('image/png') : '';
    
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>PLSMS QR Code Poster</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                margin: 0;
                padding: 40px 20px;
                display: flex;
                justify-content: center;
                align-items: center;
                background-color: #f8fafc;
              }
              .card {
                background: #ffffff;
                border-radius: 20px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                width: 100%;
                max-width: 420px;
                overflow: hidden;
                text-align: center;
                border: 1px solid #e2e8f0;
              }
              .header {
                background: #1c3987;
                color: #ffffff;
                padding: 16px;
                font-size: 18px;
                font-weight: bold;
                border-bottom: 4px solid #dc2626;
              }
              .content {
                padding: 30px 24px;
              }
              .qr-box {
                border: 3px dashed #1c3987;
                border-radius: 24px;
                padding: 18px;
                display: inline-block;
                margin-bottom: 20px;
              }
              .qr-box img {
                display: block;
                width: 240px;
                height: 240px;
              }
              .title-1 {
                color: #1c3987;
                font-size: 14px;
                font-weight: bold;
                margin: 0 0 6px 0;
              }
              .title-2 {
                color: #0f172a;
                font-size: 15px;
                font-weight: bold;
                margin: 0 0 4px 0;
              }
              .subtitle {
                color: #64748b;
                font-size: 12px;
                margin: 0 0 18px 0;
              }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="header">Share PLSMS</div>
              <div class="content">
                <div class="title-2" style="white-space: nowrap; margin-bottom: 2px;">Transport Management Office, Driving License</div>
                <div class="subtitle" style="margin-bottom: 16px;">Itahari, Sunsari</div>
                <div class="qr-box">
                  <img src="${qrDataUrl}" alt="PLSMS QR Code" />
                </div>
                <div class="title-1">Printed License Search Management System (PLSMS)</div>
              </div>
            </div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(function() { window.close(); }, 1500);
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    } else {
      window.print();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 min-[360px]:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[370px] min-[400px]:max-w-[390px] sm:max-w-[400px] bg-white dark:bg-[#0c162c] border border-slate-200/80 dark:border-slate-800 text-slate-900 dark:text-white rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col relative font-sans animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header: Deep Navy Blue with Share PLSMS & Close '✕' */}
        <div className="bg-[#1c3987] dark:bg-[#14285e] px-4 sm:px-5 py-3.5 flex items-center justify-between text-white select-none">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-white shrink-0" />
            <h3 className="text-[15px] sm:text-base font-bold text-white tracking-wide">
              Share PLSMS
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR Code Dialog"
            className="p-1 rounded-md text-white/90 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nepal Red Divider Line right beneath blue header */}
        <div className="h-[3px] bg-[#dc2626] w-full" />

        {/* Modal Main Body */}
        <div className="p-4 min-[360px]:p-5 sm:p-6 flex flex-col items-center bg-white dark:bg-[#0c162c]">
          {/* Office Name & Location at the top of the page just below the red horizontal line */}
          <div className="text-center mb-3 sm:mb-4 px-1 w-full">
            <h3 className="font-bold text-[11px] min-[340px]:text-[11.8px] min-[390px]:text-[12.8px] sm:text-[13.5px] text-slate-900 dark:text-white leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
              Transport Management Office, Driving License
            </h3>
            <p className="text-[10px] min-[360px]:text-[11px] sm:text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
              Itahari, Sunsari
            </p>
          </div>

          {/* Dashed Rounded Frame enclosing Navy Blue QR Code */}
          <div className="border-2 border-dashed border-[#1c3987] dark:border-[#38bdf8] rounded-2xl sm:rounded-3xl p-3.5 sm:p-4 bg-white shadow-xs flex items-center justify-center">
            <canvas
              id="plsms-qr-canvas"
              ref={canvasRef}
              width={220}
              height={220}
              className="w-[185px] h-[185px] rounded-lg block"
            />
          </div>

          {/* Office System Title */}
          <div className="text-center mt-3 sm:mt-3.5 px-1 w-full">
            <h4 className="font-bold text-[11.5px] min-[360px]:text-[12px] sm:text-[13px] text-[#1c3987] dark:text-[#60a5fa] leading-tight">
              Printed License Search Management System (PLSMS)
            </h4>
          </div>
        </div>

        {/* Footer: 2x2 Action Button Grid */}
        <div className="bg-[#f8fafc] dark:bg-[#070e1c] p-3.5 min-[360px]:p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {/* 1. Download PNG Button (Navy Blue) */}
            <button
              type="button"
              onClick={handleDownloadPng}
              className="bg-[#1c3987] hover:bg-[#162e6e] text-white font-bold py-2.5 px-2.5 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 sm:gap-2 text-[11.5px] min-[360px]:text-xs sm:text-[13px] shadow-sm transition-all active:scale-95 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Download PNG</span>
            </button>

            {/* 2. Print QR Button (Red) */}
            <button
              type="button"
              onClick={handlePrint}
              className="bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold py-2.5 px-2.5 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 sm:gap-2 text-[11.5px] min-[360px]:text-xs sm:text-[13px] shadow-sm transition-all active:scale-95 cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Print QR</span>
            </button>

            {/* 3. Copy Website Link Button (White/Slate with Border) */}
            <button
              type="button"
              onClick={handleCopyLink}
              className="bg-white dark:bg-[#162238] hover:bg-slate-50 dark:hover:bg-[#1f304f] border border-slate-200 dark:border-slate-700 text-[#1c3987] dark:text-sky-300 font-bold py-2.5 px-2.5 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 sm:gap-2 text-[11.5px] min-[360px]:text-xs sm:text-[13px] shadow-xs transition-all active:scale-95 cursor-pointer whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-emerald-700 dark:text-emerald-300">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>Copy Website Link</span>
                </>
              )}
            </button>

            {/* 4. Close Button (Slate Gray) */}
            <button
              type="button"
              onClick={onClose}
              className="bg-[#475569] hover:bg-[#334155] dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold py-2.5 px-2.5 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 sm:gap-2 text-[11.5px] min-[360px]:text-xs sm:text-[13px] shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <span>Close</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
