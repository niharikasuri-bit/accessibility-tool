/**
 * Thin typed wrapper around fetch for talking to the scanner API.
 *
 * Centralised here so:
 *   - error handling is uniform (throws ApiClientError with code + message)
 *   - the API-key header is added in one place
 *   - upgrading to a different transport later is a single change
 *
 * Day 7 additions:
 *   - getScreenshotUrl(scanId) — returns the URL for the scan's screenshot
 *     so React can use it directly as an `<img src>`. Not fetched here;
 *     the browser handles loading + caching.
 *   - getExportUrl(scanId, format) — same idea for JSON / PDF downloads.
 *     These are GET endpoints the browser follows for downloads.
 */

const DEFAULT_HEADERS = { 'content-type': 'application/json' };

// When deployed separately, set VITE_API_BASE_URL in Vercel env settings
// to the URL of the running API server (e.g. https://api.myapp.railway.app).
// Leave unset in local dev — the Vite proxy handles /api/* transparently.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/**
 * Provide an API key by setting localStorage.A11Y_API_KEY before any call,
 * or by passing it in via the apiKey arg. Falls back to no auth.
 */
function getApiKey(apiKey) {
  if (apiKey) return apiKey;
  try {
    return window.localStorage.getItem('A11Y_API_KEY') ?? '';
  } catch {
    return '';
  }
}

async function request(path, { method = 'GET', body, apiKey } = {}) {
  const headers = { ...DEFAULT_HEADERS };
  const k = getApiKey(apiKey);
  if (k) headers['x-api-key'] = k;

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new ApiClientError('INVALID_RESPONSE', `Non-JSON response from ${path} (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw new ApiClientError(
      json.code ?? 'API_ERROR',
      json.message ?? `Request to ${path} failed.`,
      json.details,
    );
  }
  return json;
}

export class ApiClientError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name    = 'ApiClientError';
    this.code    = code;
    this.details = details;
  }
}

/** @returns {Promise<object>} HealthResponse */
export const getHealth = () => request('/api/health');

/**
 * Enqueue a new scan.
 * @param {object} scanRequest - { url, auth?, options? }
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 * @returns {Promise<{ scanId: string, status: string, statusUrl: string }>}
 */
export const createScan = (scanRequest, opts) =>
  request('/api/scan', { method: 'POST', body: scanRequest, ...opts });

/**
 * Poll for a scan's current status / result.
 * @param {string} scanId
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 */
export const getScan = (scanId, opts) =>
  request(`/api/scan/${encodeURIComponent(scanId)}`, opts);

/**
 * URL for fetching the screenshot of a scan. Used as <img src>; the browser
 * handles loading + caching. Returns a relative URL — assumes the Vite proxy
 * (or production routing) forwards /api/* to the API server.
 *
 * @param {string} scanId
 * @returns {string} URL string
 */
export const getScreenshotUrl = (scanId) =>
  `${API_BASE}/api/scan/${encodeURIComponent(scanId)}/screenshot`;

/**
 * URL for downloading the report in a given format.
 * @param {string} scanId
 * @param {'json'|'pdf'} format
 * @returns {string} URL string
 */
export const getExportUrl = (scanId, format) =>
  `${API_BASE}/api/scan/${encodeURIComponent(scanId)}/export.${format}`;

/* ───────────────────────── Site (multi-page) ───────────────────────────── */

/**
 * Enqueue a whole-site (multi-page) scan.
 * @param {object} siteRequest - { urls, auth?, options? }
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 * @returns {Promise<{ siteId: string, status: string, statusUrl: string }>}
 */
export const createSiteScan = (siteRequest, opts) =>
  request('/api/site', { method: 'POST', body: siteRequest, ...opts });

/**
 * Poll a site scan's status / live progress / scored report.
 * @param {string} siteId
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 */
export const getSiteScan = (siteId, opts) =>
  request(`/api/site/${encodeURIComponent(siteId)}`, opts);

/**
 * URL for downloading the site report as JSON. Used as an <a href download>.
 * @param {string} siteId
 * @returns {string}
 */
export const getSiteExportUrl = (siteId) =>
  `${API_BASE}/api/site/${encodeURIComponent(siteId)}/export.json`;

/**
 * URL for downloading the consolidated site report as a PDF.
 * @param {string} siteId
 * @returns {string}
 */
export const getSitePdfUrl = (siteId) =>
  `${API_BASE}/api/site/${encodeURIComponent(siteId)}/export.pdf`;

/**
 * URL for a page's base-state screenshot within a site scan (an <img src>).
 * @param {string} siteId
 * @param {number} pageIndex
 * @returns {string}
 */
export const getSiteScreenshotUrl = (siteId, pageIndex) =>
  `${API_BASE}/api/site/${encodeURIComponent(siteId)}/screenshot/${pageIndex}`;

/* ──────────────────────────── Email ────────────────────────────────────── */

/**
 * Send a test email to verify sender credentials.
 * @param {{ fromName?: string, fromEmail: string, appPassword: string, toEmail: string }} opts
 * @returns {Promise<{ ok: boolean, messageId?: string }>}
 */
export const testEmailDelivery = (opts) =>
  request('/api/email/test', { method: 'POST', body: opts });

/**
 * Send a rendered report email to one or more recipients.
 * @param {{ fromName?: string, fromEmail: string, appPassword?: string, to: string|string[], subject: string, html: string }} opts
 * @returns {Promise<{ ok: boolean, messageId?: string }>}
 */
export const sendReportEmail = (opts) =>
  request('/api/email/send-report', { method: 'POST', body: opts });

/**
 * Generate the PDF and send it as an email attachment — no localhost links needed.
 * The backend renders the PDF from the completed scan and attaches it directly.
 * @param {string} scanId
 * @param {{ fromName?, fromEmail, appPassword?, to, cc?, projectName? }} opts
 */
export const sendScanEmail = (scanId, opts) =>
  request(`/api/scan/${encodeURIComponent(scanId)}/send-email`, { method: 'POST', body: opts });

/**
 * Same as sendScanEmail but for whole-site scans.
 * @param {string} siteId
 * @param {{ fromName?, fromEmail, appPassword?, to, cc?, projectName? }} opts
 */
export const sendSiteEmail = (siteId, opts) =>
  request(`/api/site/${encodeURIComponent(siteId)}/send-email`, { method: 'POST', body: opts });

/* ──────────────────────────── Scheduler ────────────────────────────────────── */

/**
 * Push all projects + settings to the backend scheduler so it knows what to run and when.
 * Call this whenever projects or settings are saved, and on AdminLayout mount.
 * @param {{ projects: object[], settings: object, frontendUrl: string }} opts
 */
export const syncSchedule = (opts) =>
  request('/api/schedule/sync', { method: 'POST', body: opts });

/**
 * Cascade-delete all backend state for a project: scheduler maps, PDF artifacts, email logs.
 * Call this after removing a project from localStorage.
 * @param {string} projectId
 * @param {string} [projectName]
 */
export const clearProjectData = (projectId, projectName) =>
  request('/api/schedule/clear-project', { method: 'POST', body: { projectId, projectName } });

/**
 * Fetch the persistent email send log for a project.
 * @param {string} projectId
 * @returns {Promise<{ ok: boolean, entries: object[] }>}
 */
export const getEmailLog = (projectId) =>
  request(`/api/schedule/email-log/${encodeURIComponent(projectId)}`);

/**
 * Reset a project's email state (firstEmailSent + scan history) so the next
 * dispatch routes back to a Type 1 (initial) report.  Called when a project's
 * URL or scanMode is changed in the admin form.
 * @param {string} projectId
 */
export const resetEmailState = (projectId) =>
  request('/api/schedule/reset-email-state', { method: 'POST', body: { projectId } });

/**
 * Fetch local PDF storage usage stats (count and totalBytes on disk).
 * @returns {Promise<{ ok: boolean, count: number, totalBytes: number }>}
 */
export const getStorageStats = () =>
  request('/api/schedule/storage-stats');
