import React from 'react';
import { OFFICE_CONFIG } from '../../utils/officeConfig';

interface Props {
  reportTitleNp?: string;
  reportTitleEn?: string;
  subTitle?: string;
  dateRangeLabel?: string;
  totalCount?: number;
  branchName?: string;
  showEmblem?: boolean;
  className?: string;
  isEnglishOnly?: boolean;
}

export const OfficialReportHeader: React.FC<Props> = ({
  reportTitleNp = 'दैनिक स्मार्ट कार्ड वितरण अभिलेख दर्ता किताब',
  reportTitleEn = 'DISTRIBUTION REGISTER',
  subTitle,
  dateRangeLabel,
  totalCount,
  branchName,
  showEmblem = true,
  className = '',
  isEnglishOnly = false,
}) => {
  const branch = branchName || (isEnglishOnly ? OFFICE_CONFIG.defaultBranchEn : OFFICE_CONFIG.defaultBranchNp);

  return (
    <div className={`official-header text-center pb-3 border-b-2 border-slate-900 mb-3 ${className}`}>
      {/* Top Banner with Emblem */}
      <div className="flex items-center justify-center gap-3 sm:gap-4 mb-2">
        {showEmblem && (
          <img
            src={OFFICE_CONFIG.emblemPath}
            alt="Emblem of Nepal"
            className="w-12 h-12 sm:w-14 sm:h-14 object-contain shrink-0 drop-shadow-xs"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        )}
        <div className="flex flex-col items-center">
          {/* Province Government */}
          <span className="text-xs sm:text-sm font-bold text-red-600 dark:text-red-500 uppercase tracking-wide">
            {isEnglishOnly ? OFFICE_CONFIG.provinceGovEn : OFFICE_CONFIG.provinceGovNp}
          </span>
          
          {/* Ministry */}
          <span className="text-[11px] sm:text-xs font-semibold text-blue-900 dark:text-blue-300">
            {isEnglishOnly ? OFFICE_CONFIG.ministryEn : OFFICE_CONFIG.ministryNp}
          </span>

          {/* Office Name */}
          <h1 className="text-base sm:text-lg font-black text-slate-900 dark:text-white leading-tight mt-0.5 tracking-tight">
            {isEnglishOnly ? OFFICE_CONFIG.officeNameEn : OFFICE_CONFIG.officeNameNp}
          </h1>

          {/* Location */}
          <span className="text-[11px] sm:text-xs font-semibold text-slate-600 dark:text-slate-300">
            {isEnglishOnly ? OFFICE_CONFIG.fullLocationEn : OFFICE_CONFIG.fullLocationNp}
          </span>
        </div>
      </div>

      {/* Branch / Department badge */}
      <div className="inline-block bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-3 py-0.5 rounded text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-tight mb-2">
        {branch}
      </div>

      {/* Report Title */}
      <div className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white uppercase tracking-wide">
        {reportTitleNp}
        {reportTitleEn && (
          <span className="text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-400 font-sans ml-1">
            ({reportTitleEn})
          </span>
        )}
      </div>

      {subTitle && (
        <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mt-0.5">
          {subTitle}
        </div>
      )}

      {/* Meta Bar */}
      {(dateRangeLabel || totalCount !== undefined) && (
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-xs font-medium text-slate-600 dark:text-slate-400 mt-2 pt-1 border-t border-slate-200 dark:border-slate-800">
          {dateRangeLabel && <span>{dateRangeLabel}</span>}
          <span>•</span>
          <span>कार्यालय: <strong className="text-slate-800 dark:text-slate-200">{OFFICE_CONFIG.locationNp}</strong></span>
          {totalCount !== undefined && (
            <>
              <span>•</span>
              <span>कुल संख्या: <strong className="text-slate-900 dark:text-white text-xs font-bold">{totalCount}</strong></span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
