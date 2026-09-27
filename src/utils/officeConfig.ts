/**
 * Official Administrative & Departmental Details
 * Transport Management Office, Driving License - Itahari, Sunsari
 * Ministry of Physical Infrastructure Development, Koshi Province Government
 */

export const OFFICE_CONFIG = {
  // Provincial Government
  provinceGovNp: 'कोशी प्रदेश सरकार',
  provinceGovEn: 'Government of Koshi Province',

  // Parent Ministry
  ministryNp: 'भौतिक पूर्वाधार विकास मन्त्रालय',
  ministryEn: 'Ministry of Physical Infrastructure Development',

  // Transport Management Office (Driving License)
  officeNameNp: 'यातायात व्यवस्था कार्यालय (सवारी चालक अनुमतिपत्र)',
  officeNameEn: 'Transport Management Office, Driving License',

  // Location Details
  locationNp: 'इटहरी, सुनसरी',
  locationEn: 'Itahari, Sunsari, Nepal',
  fullLocationNp: 'इटहरी, सुनसरी, कोशी प्रदेश, नेपाल',
  fullLocationEn: 'Itahari, Sunsari, Koshi Province, Nepal',

  // Distribution Branches / Departments (as present in system records)
  defaultBranchNp: 'सवारी चालक अनुमतिपत्र स्मार्ट कार्ड वितरण शाखा',
  defaultBranchEn: 'Smart Driving License Card Distribution Branch',

  // System Details
  systemNameNp: 'सवारी चालक अनुमतिपत्र स्मार्ट कार्ड वितरण तथा व्यवस्थापन प्रणाली',
  systemNameEn: 'Smart Driving License Management & Distribution System',

  // Contact / Reference from app
  contactEmail: 'tmodlsunsari@gmail.com',
  emblemPath: '/emblem_of_nepal.png',
};

/**
 * Smartly extract branch or department name from records if consistent
 */
export function resolveBranchFromRecords(
  records: Array<{ department?: string; office?: string; rawRecord?: any }>
): string {
  if (!records || records.length === 0) {
    return OFFICE_CONFIG.defaultBranchNp;
  }

  const depts = new Set<string>();
  for (const r of records) {
    const dept =
      r.department?.trim() ||
      r.office?.trim() ||
      r.rawRecord?.['DEPARTMENT'] ||
      r.rawRecord?.['शाखा'] ||
      r.rawRecord?.['कार्यालय'];
    if (dept && dept !== '<N/A>' && dept !== 'N/A' && dept !== '---') {
      depts.add(dept);
    }
  }

  if (depts.size === 1) {
    const singleDept = Array.from(depts)[0];
    if (singleDept.includes('शाखा') || singleDept.includes('Department')) {
      return singleDept;
    }
    return `${singleDept} (${OFFICE_CONFIG.defaultBranchNp})`;
  }

  return OFFICE_CONFIG.defaultBranchNp;
}

/**
 * Generates an official, beautifully styled HTML header banner for print registers & reports
 */
export function generatePrintHeaderHtml(options: {
  reportTitleNp: string;
  reportTitleEn?: string;
  dateRangeLabel: string;
  totalCount: number;
  branchName?: string;
  origin?: string;
}): string {
  const origin = options.origin || (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
  const emblemUrl = `${origin}${OFFICE_CONFIG.emblemPath}`;
  const branch = options.branchName || OFFICE_CONFIG.defaultBranchNp;

  return `
    <div class="official-office-banner" style="text-align: center; margin-bottom: 14px; border-bottom: 2px solid #0f172a; padding-bottom: 10px;">
      <div style="display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 4px;">
        <img 
          src="${emblemUrl}" 
          alt="Emblem of Nepal" 
          style="width: 50px; height: 50px; object-fit: contain;" 
          onerror="this.style.display='none'"
        />
        <div>
          <div style="font-size: 13px; font-weight: 700; color: #dc2626; letter-spacing: 0.5px; text-transform: uppercase;">
            ${OFFICE_CONFIG.provinceGovNp}
          </div>
          <div style="font-size: 12px; font-weight: 600; color: #1e3a8a; margin-top: 1px;">
            ${OFFICE_CONFIG.ministryNp}
          </div>
          <h1 style="margin: 3px 0 1px 0; font-size: 17px; font-weight: 800; color: #0f172a; line-height: 1.2;">
            ${OFFICE_CONFIG.officeNameNp}
          </h1>
          <div style="font-size: 12px; font-weight: 600; color: #334155;">
            ${OFFICE_CONFIG.fullLocationNp}
          </div>
        </div>
      </div>

      <div style="display: inline-block; background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 12px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #1e293b; margin-top: 4px; text-transform: uppercase;">
        ${branch}
      </div>

      <div style="margin-top: 6px; font-size: 13.5px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.3px;">
        ${options.reportTitleNp}
        ${options.reportTitleEn ? `<span style="font-size: 12px; color: #475569; font-weight: 700;"> (${options.reportTitleEn})</span>` : ''}
      </div>

      <div style="display: flex; justify-content: center; gap: 16px; margin-top: 4px; font-size: 11px; color: #475569; font-weight: 600;">
        <span>${options.dateRangeLabel}</span>
        <span>|</span>
        <span>कार्यालय: <strong style="color: #0f172a;">${OFFICE_CONFIG.locationNp}</strong></span>
        <span>|</span>
        <span>कुल संख्या: <strong style="color: #0f172a; font-size: 12px;">${options.totalCount}</strong></span>
      </div>
    </div>
  `;
}
