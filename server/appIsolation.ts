/**
 * Application Architecture Module
 *
 * Standalone Portable Architecture:
 * Standard storage paths, standard configuration keys, and independent database per deployment.
 * No Master/Remix branching or Applet-ID gating.
 */

export function getCurrentAppletId(): string {
  return (process.env.APPLET_ID || '').trim();
}

/**
 * Portable Standalone App: Every instance is an independent, authoritative deployment.
 */
export function isMasterApp(): boolean {
  return true;
}

/**
 * Returns false as there is no Remix state.
 */
export function isRemixedApp(): boolean {
  return false;
}

/**
 * Standard storage filename for all deployments (records.json, google_sheets_config.json, etc.)
 */
export function getAppScopedFilename(baseFilename: string): string {
  return baseFilename;
}

/**
 * Standard PostgreSQL storage directory ('pgdata') for all deployments.
 */
export function getAppScopedPgDir(baseDir: string = 'pgdata'): string {
  return baseDir;
}

/**
 * Detects legacy, template, or bundled demo sheet URLs and IDs that must never leak into a clean app
 */
export function isLegacyOrBundledSheet(urlOrId?: string): boolean {
  if (!urlOrId || typeof urlOrId !== 'string') return false;
  const clean = urlOrId.trim().toLowerCase();
  return (
    clean.includes('1unmaaznod5lyoqmmvxqufm9ok3fqhw7jtc0kbsq3m-w') ||
    clean.includes('1xafqwswrpm3jmnl_o0dyccazbyepy1xvfsp1k_sxmdq') ||
    clean.includes('placeholder') ||
    clean.includes('example') ||
    clean.includes('your-sheet-id') ||
    clean === '<spreadsheet-id>'
  );
}

/**
 * URL validation safeguard: Detects if a configuration is cloned/inherited from another applet
 * or contains stale legacy/bundled demo sheet values.
 */
export function isClonedMasterSheetConfig(config?: {
  appletId?: string;
  spreadsheetId?: string;
  publishedUrl?: string;
}): boolean {
  if (!config) return false;
  const currentAppletId = getCurrentAppletId();
  if (config.appletId && currentAppletId && config.appletId !== currentAppletId) {
    return true;
  }
  if (isLegacyOrBundledSheet(config.spreadsheetId) || isLegacyOrBundledSheet(config.publishedUrl)) {
    return true;
  }
  return false;
}

export function getAppIsolationStatus() {
  return {
    isMaster: true,
    isRemixed: false,
    currentAppletId: getCurrentAppletId(),
    masterAppletId: '',
  };
}
