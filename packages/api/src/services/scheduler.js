/**
 * Backend scheduler — checks every 60s for due projects, starts scans,
 * and dispatches report emails on completion.
 *
 * Synced from the frontend via POST /api/schedule/sync whenever the user
 * saves a project or settings, and on AdminLayout mount (after restart).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { jobStore } from '../store/jobs.js';
import { startJobInBackground } from '../scanner-bridge/runner.js';
import { startSiteJobInBackground } from '../scanner-bridge/site-runner.js';
import { sendEmail } from './email.js';
import {
  buildScanEmailData, buildSiteEmailData,
  buildScanEmailDataSubsequent, buildSiteEmailDataSubsequent,
  buildScanSnapshot,
  renderEmailHtml, renderEmailHtmlSubsequent,
  renderFailureEmailHtml,
} from './emailHtml.js';
import { appendScanSnapshot, getProjectHistory, clearProjectHistory } from './scanHistory.js';
import { getEmailPdfUrl, deleteProjectPdfs, cleanupOldSendPdfs } from './pdfStorage.js';
import { appendEmailLog, getEmailLogForProject, deleteEmailLogForProject } from './emailLogStore.js';
import { renderReportPdf, renderIssuesPdf, renderPagewisePdf, renderUnresolvedIssuesPdf, renderReportPdfSubsequent } from '../scanner-bridge/pdf.js';
import { renderSiteReportPdf, renderSiteIssuesPdf, renderSitePagesPdf } from '../scanner-bridge/site-pdf.js';
import { getProjectFlags, setFirstEmailSent, clearProjectFlags } from './projectFlags.js';

const SETTINGS_FILE = path.resolve('./artifacts/scheduler-settings.json');

async function persistSettings(settings) {
  try {
    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to persist scheduler settings');
  }
}

async function loadPersistedSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

let _projects = [];
let _settings = {};
let _frontendUrl = null;

/** Map<projectId, { dateKey, year, month, day }> */
const lastRunAt = new Map();
/** Map<projectId, { jobId: string, type: 'scan'|'site' }> */
const runningJobs = new Map();
/** Map<projectId, { at, jobId, to, cc, status, error? }> */
const emailLog = new Map();
/** Set of projectIds that have been deleted — immediate guard against email dispatch */
const _deletedProjectIds = new Set();
/** In-memory lock: prevents concurrent email dispatches for the same project */
const _activeDispatches  = new Set();

export function getSettings() {
  return { ..._settings };
}

export function syncSchedule({ projects, settings, frontendUrl }) {
  const incoming = Array.isArray(projects) ? projects : [];
  const incomingIds = new Set(incoming.map((p) => p.id));

  // Purge in-memory state for projects that no longer exist
  for (const projectId of lastRunAt.keys()) {
    if (!incomingIds.has(projectId)) lastRunAt.delete(projectId);
  }
  for (const projectId of runningJobs.keys()) {
    if (!incomingIds.has(projectId)) runningJobs.delete(projectId);
  }
  // Clear tombstones for projects that have been re-added
  for (const projectId of _deletedProjectIds) {
    if (incomingIds.has(projectId)) _deletedProjectIds.delete(projectId);
  }

  _projects = incoming;
  _settings = settings ?? {};
  if (frontendUrl) _frontendUrl = String(frontendUrl);
  logger.info(
    { projectCount: _projects.length, hasEmail: Boolean(_settings.senderEmail) },
    'Schedule synced from frontend',
  );
  // Persist settings to disk so they survive API restarts
  persistSettings(_settings).catch(() => {});
  // Run a tick immediately after sync so the newly-saved schedule is checked right away
  tick().catch((err) => logger.error({ err: err.message }, 'Post-sync tick error'));
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function getNowParts(timezone) {
  const tz  = timezone || 'UTC';
  const now = new Date();
  const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(now);

  let hour = parseInt(fmt({ hour: '2-digit', hour12: false }), 10);
  if (hour === 24) hour = 0; // some locales return 24 at midnight

  const minute  = parseInt(fmt({ minute: '2-digit' }), 10);
  const weekday = fmt({ weekday: 'short' }).toLowerCase().slice(0, 3);
  const day     = parseInt(fmt({ day: '2-digit' }), 10);
  const month   = parseInt(fmt({ month: '2-digit' }), 10);
  const year    = parseInt(fmt({ year: 'numeric' }), 10);
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { hour, minute, weekday, day, month, year, dateKey };
}

function isNthWeekdayOfMonth(now, nth, weekday) {
  if (now.weekday !== weekday) return false;
  const nthMap = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };
  const n = nthMap[nth ?? 'first'] ?? 1;
  if (n > 0) return Math.ceil(now.day / 7) === n;
  // 'last': the next same-weekday falls outside the month
  const daysInMonth = new Date(now.year, now.month, 0).getDate();
  return (now.day + 7) > daysInMonth;
}

function isDue(project) {
  const { frequency, time, timezone, daysOfWeek, monthlyType, monthlyDay, monthlyNth, monthlyWeekday } = project;
  if (!frequency || frequency === 'none') return false;
  // Only skip if explicitly paused — treat undefined/null status as active
  if (project.status === 'paused') return false;

  const now  = getNowParts(timezone || 'UTC');
  const [sH, sM] = (time || '09:00').split(':').map(Number);

  // Allow ±1 minute around the scheduled time to absorb tick drift
  if (Math.abs(now.hour * 60 + now.minute - sH * 60 - sM) > 1) return false;

  const last = lastRunAt.get(project.id);

  if (frequency === 'today' || frequency === 'once') return !last;

  if (frequency === 'daily') {
    return !(last && last.dateKey === now.dateKey);
  }

  if (frequency === 'weekly') {
    const days = Array.isArray(daysOfWeek) && daysOfWeek.length ? daysOfWeek : ['mon'];
    if (!days.includes(now.weekday)) return false;
    return !(last && last.dateKey === now.dateKey);
  }

  if (frequency === 'monthly') {
    if (monthlyType === 'day') {
      if (now.day !== (monthlyDay ?? 1)) return false;
    } else {
      if (!isNthWeekdayOfMonth(now, monthlyNth ?? 'first', monthlyWeekday ?? 'mon')) return false;
    }
    return !(last && last.year === now.year && last.month === now.month);
  }

  return false;
}

// ─── Email dispatch ───────────────────────────────────────────────────────────

function parseUrls(text) {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function splitEmailRecipients(project) {
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s ?? '').trim());
  const toEmails = [project.productOwner?.email]
    .filter((e) => isEmail(e ?? '')).map((e) => e.trim());
  const ccEmails = [
    ...(project.members ?? []).map((m) => m.email),
    ...(project.ccList  ?? []).map((c) => c.email),
  ].filter((e) => isEmail(e ?? '')).map((e) => e.trim());
  // Deduplicate cc against to
  const toSet = new Set(toEmails);
  return { toEmails, ccEmails: [...new Set(ccEmails)].filter((e) => !toSet.has(e)) };
}

function toPlainErrorReason(error) {
  const code = error?.code ?? '';
  const msg  = error?.message ?? '';
  const MAP = {
    PAGE_NOT_FOUND:   'The page could not be reached.',
    TIMEOUT:          'The scan timed out — the page took too long to load.',
    AUTH_FAILED:      'Authentication failed — credentials may be incorrect or expired.',
    NETWORK_ERROR:    'A network error occurred — the server could not be contacted.',
    PROJECT_DELETED:  'The project was deleted while the scan was in progress.',
    SCAN_FAILED:      'An unexpected error occurred during the scan.',
  };
  return MAP[code] ?? (msg || 'An unexpected error occurred during the scan.');
}

async function dispatchFailureEmail({ job, project }) {
  if (_deletedProjectIds.has(project.id)) {
    logger.info({ projectId: project.id }, 'Failure email skipped — project was deleted');
    return;
  }
  // Only notify if a previous scan has already succeeded — skip on very first attempt
  const { firstEmailSent } = await getProjectFlags(project.id);
  if (!firstEmailSent) {
    logger.info({ projectId: project.id }, 'Failure email skipped — no previous successful scan for this project');
    return;
  }

  if (!_settings.senderEmail || !_settings.gmailAppPassword) return;

  // Send only to product owner — not engineering team or CC list
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s ?? '').trim());
  const ownerEmail = project.productOwner?.email?.trim();
  if (!isEmail(ownerEmail)) return;

  const projectName = project.name || 'Accessibility Report';
  const scanUrl     = project.scanMode === 'site'
    ? (project.urlsText ?? '').split('\n').find((l) => l.trim()) ?? ''
    : (project.url ?? '');
  const error = job?.error ?? {};
  const now   = new Date();
  const scheduledAt = now.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';

  const html = renderFailureEmailHtml({
    projectName,
    url:           scanUrl,
    failureReason: toPlainErrorReason(error),
    scheduledAt,
  });

  try {
    await sendEmail({
      fromName:    _settings.senderName || 'DIGIT Accessibility Bot',
      fromEmail:   _settings.senderEmail,
      appPassword: _settings.gmailAppPassword,
      to:          [ownerEmail],
      subject:     `Scan Failed — ${projectName}`,
      html,
    });
    appendEmailLog({
      projectId:      project.id,
      timestamp:      now.toISOString(),
      status:         'scan-failed',
      triggeredBy:    'scheduled',
      recipientCount: 1,
      fullReportUrl:  null,
      error:          toPlainErrorReason(error),
    }).catch(() => {});
    logger.info({ projectId: project.id, projectName }, 'Scan failure notification email sent to product owner');
  } catch (err) {
    logger.warn({ err: err.message, projectId: project.id }, 'Failed to send scan failure notification email');
  }
}

async function dispatchEmail({ jobId, type, project }) {
  if (_activeDispatches.has(project.id)) {
    logger.warn({ projectId: project.id, jobId }, 'Email dispatch skipped — another dispatch is already in progress for this project');
    return;
  }
  _activeDispatches.add(project.id);
  const logEntry = { at: new Date().toISOString(), jobId, to: [], cc: [], status: 'pending', error: null };
  emailLog.set(project.id, logEntry);

  if (_deletedProjectIds.has(project.id)) {
    _activeDispatches.delete(project.id);
    logger.info({ projectId: project.id }, 'Email dispatch skipped — project was deleted');
    return;
  }

  const job = jobStore.get(jobId);
  if (!job || !job.report) {
    logEntry.status = 'skipped';
    logEntry.error  = !job ? 'Job not found in store (API may have restarted)' : 'Job has no report yet';
    logger.warn({ projectId: project.id, jobId, reason: logEntry.error }, 'Email skipped');
    appendEmailLog({ projectId: project.id, timestamp: logEntry.at, status: 'skipped', triggeredBy: 'scheduled', recipientCount: 0, fullReportUrl: null, error: logEntry.error }).catch(() => {});
    _activeDispatches.delete(project.id);
    return;
  }

  const { toEmails, ccEmails } = splitEmailRecipients(project);
  logEntry.to = toEmails;
  logEntry.cc = ccEmails;
  const effectiveTo = toEmails.length ? toEmails : ccEmails;
  if (!effectiveTo.length) {
    logEntry.status = 'skipped';
    logEntry.error  = 'No recipient email addresses configured on this project';
    logger.warn({ projectId: project.id }, logEntry.error);
    appendEmailLog({ projectId: project.id, timestamp: logEntry.at, status: 'skipped', triggeredBy: 'scheduled', recipientCount: 0, fullReportUrl: null, error: logEntry.error }).catch(() => {});
    _activeDispatches.delete(project.id);
    return;
  }
  if (!_settings.senderEmail || !_settings.gmailAppPassword) {
    logEntry.status = 'skipped';
    logEntry.error  = 'No sender credentials configured in settings — go to Admin → Settings and save your email password';
    logger.warn({ projectId: project.id }, logEntry.error);
    appendEmailLog({ projectId: project.id, timestamp: logEntry.at, status: 'skipped', triggeredBy: 'scheduled', recipientCount: 0, fullReportUrl: null, error: logEntry.error }).catch(() => {});
    _activeDispatches.delete(project.id);
    return;
  }

  // ── Email type routing ─────────────────────────────────────────────────────
  // 'first'      — project has never successfully sent an email before
  // 'subsequent' — at least one email has been delivered; use the repeat template
  const { firstEmailSent } = await getProjectFlags(project.id);
  const emailType = firstEmailSent ? 'subsequent' : 'first';
  const history   = emailType === 'subsequent' ? await getProjectHistory(project.id) : [];

  const projectName = project.name || 'Accessibility Report';
  const dateStr     = new Date().toISOString().slice(0, 10);
  const safeName    = projectName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

  const isSite  = type === 'site';
  const apiBase = process.env.API_PUBLIC_URL ?? null;

  let pagesUrl = null, issuesUrl = null, unresolvedPdfUrl = null, fullReportUrl = null, viewFullReportUrl = null;
  let attachments = [];

  if (emailType === 'subsequent') {
    // Unresolved: issues present in both current and previous scan
    const prevRuleIds   = new Set((history[0]?.issues ?? []).map((i) => i.ruleId));
    const allUnresolved = (job.report?.issues ?? []).filter((iss) => prevRuleIds.has(iss.ruleId));

    const pagesFilename          = isSite ? `${safeName}-pagewise-${dateStr}.pdf`   : null;
    const issuesFilename         = `${safeName}-issues-${dateStr}.pdf`;
    const unresolvedFilename     = `${safeName}-unresolved-${dateStr}.pdf`;
    const fullReportFilename     = `${safeName}-comparison-${dateStr}.pdf`;
    const viewFullReportFilename = `${safeName}-full-report-${dateStr}.pdf`;

    const pdfTasks = isSite
      ? [
          renderSitePagesPdf({ siteId: jobId, request: job.request, report: job.report, projectName }),
          renderSiteIssuesPdf({ siteId: jobId, request: job.request, report: job.report, projectName }),
          allUnresolved.length > 0
            ? renderUnresolvedIssuesPdf({ scanId: jobId, request: job.request, report: job.report, projectName, unresolvedIssues: allUnresolved, history })
            : Promise.resolve(null),
          renderReportPdfSubsequent({ scanId: jobId, request: job.request, report: job.report, projectName, history }),
          renderSiteReportPdf({ siteId: jobId, request: job.request, report: job.report, projectName }),
        ]
      : [
          renderIssuesPdf({ scanId: jobId, request: job.request, report: job.report, projectName }),
          allUnresolved.length > 0
            ? renderUnresolvedIssuesPdf({ scanId: jobId, request: job.request, report: job.report, projectName, unresolvedIssues: allUnresolved, history })
            : Promise.resolve(null),
          renderReportPdfSubsequent({ scanId: jobId, request: job.request, report: job.report, projectName, history }),
          renderReportPdf({ scanId: jobId, request: job.request, report: job.report, screenshotPath: job.report?.screenshot?.path, projectName }),
        ];

    const pdfResults = await Promise.allSettled(pdfTasks);
    pdfResults.forEach((r, i) => {
      if (r.status === 'rejected') logger.warn({ err: r.reason?.message, projectId: project.id, pdfIndex: i }, 'PDF generation failed (subsequent)');
    });

    try {
      if (isSite) {
        const [pagesPdf, issuesPdf, unresolvedPdf, fullPdf, viewFullPdf] = pdfResults;
        [pagesUrl, issuesUrl, unresolvedPdfUrl, fullReportUrl, viewFullReportUrl] = await Promise.all([
          pagesPdf.status      === 'fulfilled' && pagesPdf.value      ? getEmailPdfUrl(pagesPdf.value,      pagesFilename,          apiBase) : Promise.resolve(null),
          issuesPdf.status     === 'fulfilled' && issuesPdf.value     ? getEmailPdfUrl(issuesPdf.value,     issuesFilename,         apiBase) : Promise.resolve(null),
          unresolvedPdf.status === 'fulfilled' && unresolvedPdf.value ? getEmailPdfUrl(unresolvedPdf.value, unresolvedFilename,     apiBase) : Promise.resolve(null),
          fullPdf.status       === 'fulfilled' && fullPdf.value       ? getEmailPdfUrl(fullPdf.value,       fullReportFilename,     apiBase) : Promise.resolve(null),
          viewFullPdf.status   === 'fulfilled' && viewFullPdf.value   ? getEmailPdfUrl(viewFullPdf.value,   viewFullReportFilename, apiBase) : Promise.resolve(null),
        ]);
        attachments = [
          pagesPdf.status      === 'fulfilled' && pagesPdf.value      ? { filename: pagesFilename,          content: pagesPdf.value,      contentType: 'application/pdf' } : null,
          issuesPdf.status     === 'fulfilled' && issuesPdf.value     ? { filename: issuesFilename,         content: issuesPdf.value,     contentType: 'application/pdf' } : null,
          unresolvedPdf.status === 'fulfilled' && unresolvedPdf.value ? { filename: unresolvedFilename,     content: unresolvedPdf.value, contentType: 'application/pdf' } : null,
          fullPdf.status       === 'fulfilled' && fullPdf.value       ? { filename: fullReportFilename,     content: fullPdf.value,       contentType: 'application/pdf' } : null,
          viewFullPdf.status   === 'fulfilled' && viewFullPdf.value   ? { filename: viewFullReportFilename, content: viewFullPdf.value,   contentType: 'application/pdf' } : null,
        ].filter(Boolean);
      } else {
        const [issuesPdf, unresolvedPdf, fullPdf, viewFullPdf] = pdfResults;
        [issuesUrl, unresolvedPdfUrl, fullReportUrl, viewFullReportUrl] = await Promise.all([
          issuesPdf.status     === 'fulfilled' && issuesPdf.value     ? getEmailPdfUrl(issuesPdf.value,     issuesFilename,         apiBase) : Promise.resolve(null),
          unresolvedPdf.status === 'fulfilled' && unresolvedPdf.value ? getEmailPdfUrl(unresolvedPdf.value, unresolvedFilename,     apiBase) : Promise.resolve(null),
          fullPdf.status       === 'fulfilled' && fullPdf.value       ? getEmailPdfUrl(fullPdf.value,       fullReportFilename,     apiBase) : Promise.resolve(null),
          viewFullPdf.status   === 'fulfilled' && viewFullPdf.value   ? getEmailPdfUrl(viewFullPdf.value,   viewFullReportFilename, apiBase) : Promise.resolve(null),
        ]);
        attachments = [
          issuesPdf.status     === 'fulfilled' && issuesPdf.value     ? { filename: issuesFilename,         content: issuesPdf.value,     contentType: 'application/pdf' } : null,
          unresolvedPdf.status === 'fulfilled' && unresolvedPdf.value ? { filename: unresolvedFilename,     content: unresolvedPdf.value, contentType: 'application/pdf' } : null,
          fullPdf.status       === 'fulfilled' && fullPdf.value       ? { filename: fullReportFilename,     content: fullPdf.value,       contentType: 'application/pdf' } : null,
          viewFullPdf.status   === 'fulfilled' && viewFullPdf.value   ? { filename: viewFullReportFilename, content: viewFullPdf.value,   contentType: 'application/pdf' } : null,
        ].filter(Boolean);
      }
    } catch (urlErr) {
      logger.warn({ err: urlErr.message, projectId: project.id }, 'PDF upload failed (subsequent) — email will send without attachment links');
    }
  } else {
    // Type 1 — same as before: site gets pages+issues+full, single-page gets issues+full
    const pagesFilename      = isSite ? `${safeName}-pagewise-${dateStr}.pdf`    : null;
    const issuesFilename     = `${safeName}-issues-${dateStr}.pdf`;
    const fullReportFilename = `${safeName}-full-report-${dateStr}.pdf`;

    const pdfTasks = isSite
      ? [
          renderSitePagesPdf({ siteId: jobId, request: job.request, report: job.report, projectName }),
          renderSiteIssuesPdf({ siteId: jobId, request: job.request, report: job.report, projectName }),
          renderSiteReportPdf({ siteId: jobId, request: job.request, report: job.report, projectName }),
        ]
      : [
          renderIssuesPdf({ scanId: jobId, request: job.request, report: job.report, projectName }),
          renderReportPdf({ scanId: jobId, request: job.request, report: job.report, screenshotPath: job.report.screenshot?.path, projectName }),
        ];

    const pdfResults = await Promise.allSettled(pdfTasks);
    pdfResults.forEach((r, i) => {
      if (r.status === 'rejected') logger.warn({ err: r.reason?.message, projectId: project.id, pdfIndex: i }, 'PDF generation failed (first)');
    });

    try {
      if (isSite) {
        const [pagesPdf, issuesPdf, fullPdf] = pdfResults;
        [pagesUrl, issuesUrl, fullReportUrl] = await Promise.all([
          pagesPdf.status  === 'fulfilled' && pagesPdf.value  ? getEmailPdfUrl(pagesPdf.value,  pagesFilename,      apiBase) : Promise.resolve(null),
          issuesPdf.status === 'fulfilled' && issuesPdf.value ? getEmailPdfUrl(issuesPdf.value, issuesFilename,     apiBase) : Promise.resolve(null),
          fullPdf.status   === 'fulfilled' && fullPdf.value   ? getEmailPdfUrl(fullPdf.value,   fullReportFilename, apiBase) : Promise.resolve(null),
        ]);
        attachments = [
          pagesPdf.status  === 'fulfilled' && pagesPdf.value  ? { filename: pagesFilename,      content: pagesPdf.value,  contentType: 'application/pdf' } : null,
          issuesPdf.status === 'fulfilled' && issuesPdf.value ? { filename: issuesFilename,     content: issuesPdf.value, contentType: 'application/pdf' } : null,
          fullPdf.status   === 'fulfilled' && fullPdf.value   ? { filename: fullReportFilename, content: fullPdf.value,   contentType: 'application/pdf' } : null,
        ].filter(Boolean);
      } else {
        const [issuesPdf, fullPdf] = pdfResults;
        [issuesUrl, fullReportUrl] = await Promise.all([
          issuesPdf.status === 'fulfilled' && issuesPdf.value ? getEmailPdfUrl(issuesPdf.value, issuesFilename,     apiBase) : Promise.resolve(null),
          fullPdf.status   === 'fulfilled' && fullPdf.value   ? getEmailPdfUrl(fullPdf.value,   fullReportFilename, apiBase) : Promise.resolve(null),
        ]);
        attachments = [
          issuesPdf.status === 'fulfilled' && issuesPdf.value ? { filename: issuesFilename,    content: issuesPdf.value, contentType: 'application/pdf' } : null,
          fullPdf.status   === 'fulfilled' && fullPdf.value   ? { filename: fullReportFilename, content: fullPdf.value,   contentType: 'application/pdf' } : null,
        ].filter(Boolean);
      }
    } catch (urlErr) {
      logger.warn({ err: urlErr.message, projectId: project.id }, 'PDF upload failed (first) — email will send without attachment links');
    }
  }

  const data = isSite
    ? (emailType === 'subsequent'
        ? buildSiteEmailDataSubsequent({ site: job, projectName, siteId: jobId, frontendUrl: _frontendUrl, history })
        : buildSiteEmailData({ site: job, projectName, siteId: jobId, frontendUrl: _frontendUrl }))
    : (emailType === 'subsequent'
        ? buildScanEmailDataSubsequent({ scan: job, projectName, scanId: jobId, frontendUrl: _frontendUrl, history })
        : buildScanEmailData({ scan: job, projectName, scanId: jobId, frontendUrl: _frontendUrl }));

  data.pagesUrl           = pagesUrl;
  data.issuesUrl          = issuesUrl;
  data.unresolvedPdfUrl   = unresolvedPdfUrl;
  data.fullReportUrl      = fullReportUrl;
  data.viewFullReportUrl  = viewFullReportUrl;
  data.reportUrl        = (_frontendUrl && (data.scanId || data.siteId))
    ? `${_frontendUrl}/scan/${data.scanId ?? data.siteId}/report`
    : null;

  logger.info({ projectId: project.id, emailType, scanMode: isSite ? 'site' : 'single', attachments: attachments.length, pdfUrls: { pagesUrl, issuesUrl, unresolvedPdfUrl, fullReportUrl, viewFullReportUrl } }, 'Rendering email HTML');

  let html;
  try {
    html = emailType === 'subsequent'
      ? renderEmailHtmlSubsequent(data)
      : renderEmailHtml(data);
  } catch (renderErr) {
    logger.error({ err: renderErr.message, projectId: project.id, emailType }, 'Email HTML render failed — dispatch aborted');
    logEntry.status = 'failed';
    logEntry.error  = `HTML render failed: ${renderErr.message}`;
    appendEmailLog({ projectId: project.id, timestamp: logEntry.at, status: 'failed', triggeredBy: 'scheduled', recipientCount: 0, fullReportUrl, error: logEntry.error }).catch(() => {});
    _activeDispatches.delete(project.id);
    return;
  }

  logger.info({ projectId: project.id, emailType, to: effectiveTo }, 'Sending email');

  try {
    await sendEmail({
      fromName:    _settings.senderName || 'DIGIT Accessibility Bot',
      fromEmail:   _settings.senderEmail,
      appPassword: _settings.gmailAppPassword,
      to:          effectiveTo,
      cc:          toEmails.length && ccEmails.length ? ccEmails : undefined,
      subject:     `Accessibility Report of ${projectName}`,
      html,
      attachments,
    });
    logEntry.status = 'sent';
    logger.info({ projectId: project.id, projectName, to: effectiveTo, emailType }, 'Scheduled report email sent');
    await setFirstEmailSent(project.id);
    await appendScanSnapshot(project.id, buildScanSnapshot({ report: job.report, scanDate: new Date().toISOString() }));
  } catch (err) {
    logEntry.status = 'failed';
    logEntry.error  = err.message;
    logger.warn({ err: err.message, projectId: project.id, emailType }, 'Scheduled report email failed');
  }

  if (logEntry.status === 'sent' || logEntry.status === 'failed') {
    const recipientCount = toEmails.length + ccEmails.length;
    appendEmailLog({
      projectId:      project.id,
      timestamp:      logEntry.at,
      status:         logEntry.status,
      triggeredBy:    'scheduled',
      recipientCount,
      fullReportUrl,
      error:          logEntry.error,
    }).catch((err) => logger.warn({ err: err.message }, 'Failed to persist email log entry'));
  }

  // PDF retention: keep the most recent 5 send-date groups; fire-and-forget
  getEmailLogForProject(project.id)
    .then((entries) => {
      const referencedUrls = new Set(entries.map((e) => e.fullReportUrl).filter(Boolean));
      return cleanupOldSendPdfs(safeName, referencedUrls);
    })
    .catch(() => {});

  _activeDispatches.delete(project.id);
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

async function tick() {
  // 1. Check running jobs — dispatch email when complete
  for (const [projectId, jobMeta] of runningJobs.entries()) {
    const job = jobStore.get(jobMeta.jobId);
    if (!job) { runningJobs.delete(projectId); continue; }

    if (job.status === 'complete') {
      runningJobs.delete(projectId);
      if (_deletedProjectIds.has(projectId)) {
        logger.info({ projectId, jobId: jobMeta.jobId }, 'Scan completed for deleted project — email suppressed');
        continue;
      }
      const project = _projects.find((p) => p.id === projectId);
      if (project?.emailEnabled) {
        try {
          await dispatchEmail({ jobId: jobMeta.jobId, type: jobMeta.type, project });
        } catch (dispatchErr) {
          logger.error({ err: dispatchErr.message, projectId }, 'Unexpected error in dispatchEmail — clearing dispatch lock');
          _activeDispatches.delete(projectId);
        }
      }
    } else if (job.status === 'failed') {
      runningJobs.delete(projectId);
      if (_deletedProjectIds.has(projectId)) {
        logger.info({ projectId, jobId: jobMeta.jobId }, 'Scan failed for deleted project — failure email suppressed');
        continue;
      }
      logger.warn({ projectId, jobId: jobMeta.jobId }, 'Scheduled scan failed');
      const project = _projects.find((p) => p.id === projectId);
      if (project?.emailEnabled) {
        await dispatchFailureEmail({ job, project });
      }
    }
  }

  // 2. Start due projects
  for (const project of _projects) {
    if (_deletedProjectIds.has(project.id)) continue;
    if (runningJobs.has(project.id)) continue;
    if (!isDue(project)) continue;

    const now = getNowParts(project.timezone || 'UTC');
    lastRunAt.set(project.id, now);

    try {
      let previousCompliance = null;
      const prevFlags = await getProjectFlags(project.id);
      if (prevFlags.firstEmailSent) {
        const prevHistory = await getProjectHistory(project.id);
        if (prevHistory.length > 0) {
          const lastSnap = prevHistory[0];
          if (lastSnap.compliance && Object.keys(lastSnap.compliance).length > 0) {
            previousCompliance = {};
            for (const [k, v] of Object.entries(lastSnap.compliance)) {
              previousCompliance[k] = {
                compliancePercent: v.percentage ?? 0,
                rulesPassed:       v.passed     ?? 0,
                rulesFailed:       v.failed     ?? 0,
                totalRulesChecked: (v.passed ?? 0) + (v.failed ?? 0),
              };
            }
          }
        }
      }

      if (project.scanMode === 'site') {
        const urls = parseUrls(project.urlsText);
        if (!urls.length) {
          logger.warn({ projectId: project.id }, 'Scheduled site scan skipped: no URLs');
          continue;
        }
        const job = jobStore.create({ kind: 'site', urls, auth: project.auth });
        if (previousCompliance) jobStore.update(job.id, { previousCompliance });
        startSiteJobInBackground(jobStore, job);
        runningJobs.set(project.id, { jobId: job.id, type: 'site' });
        logger.info({ projectId: project.id, jobId: job.id }, 'Scheduled site scan started');
      } else {
        if (!project.url) {
          logger.warn({ projectId: project.id }, 'Scheduled scan skipped: no URL');
          continue;
        }
        const job = jobStore.create({ url: project.url, auth: project.auth });
        if (previousCompliance) jobStore.update(job.id, { previousCompliance });
        startJobInBackground(jobStore, job);
        runningJobs.set(project.id, { jobId: job.id, type: 'scan' });
        logger.info({ projectId: project.id, jobId: job.id }, 'Scheduled scan started');
      }
    } catch (err) {
      logger.error({ err: err.message, projectId: project.id }, 'Failed to start scheduled scan');
    }
  }
}

export function getSchedulerStatus() {
  return {
    projectCount: _projects.length,
    runningCount: runningJobs.size,
    projects: _projects.map((p) => ({
      id:          p.id,
      name:        p.name,
      frequency:   p.frequency,
      time:        p.time,
      timezone:    p.timezone,
      status:      p.status,
      emailEnabled: p.emailEnabled,
      isDue:       isDue(p),
      lastRunAt:   lastRunAt.get(p.id) ?? null,
      running:     runningJobs.has(p.id) ? runningJobs.get(p.id) : null,
      lastEmail:   emailLog.get(p.id) ?? null,
      recipients:  (() => { const r = splitEmailRecipients(p); return { to: r.toEmails, cc: r.ccEmails }; })(),
      authType:    p.auth?.type ?? null,
    })),
    settingsPresent: {
      senderEmail:      Boolean(_settings.senderEmail),
      gmailAppPassword: Boolean(_settings.gmailAppPassword),
    },
    frontendUrl: _frontendUrl,
  };
}

/**
 * Remove all in-memory state for a deleted project and clean up its PDF artifacts.
 * Called from DELETE /api/schedule/clear-project.
 */
export async function clearProjectState(projectId, projectName) {
  _deletedProjectIds.add(projectId);  // Immediate guard — stops any in-flight email dispatch

  // Remove from active project list immediately so the scheduler won't schedule
  // new scans even if syncSchedule is delayed or never called (e.g. tab closed).
  _projects = _projects.filter((p) => p.id !== projectId);

  emailLog.delete(projectId);

  // Cancel the running job (if any) before removing the reference so a completing
  // scan cannot be picked up by a concurrent tick after deletion.
  const jobMeta = runningJobs.get(projectId);
  if (jobMeta) {
    jobStore.markFailed(jobMeta.jobId, {
      code: 'PROJECT_DELETED',
      message: 'Project was deleted while scan was in progress',
    });
  }
  runningJobs.delete(projectId);
  lastRunAt.delete(projectId);

  await Promise.all([
    projectName ? deleteProjectPdfs(projectName.replace(/[^a-z0-9]/gi, '-').toLowerCase()) : Promise.resolve(),
    deleteEmailLogForProject(projectId),
    clearProjectFlags(projectId),
    clearProjectHistory(projectId),
  ]);
}

export async function startScheduler() {
  // Restore settings persisted from the last sync so emails work across API restarts
  // even before the admin panel re-syncs.
  const saved = await loadPersistedSettings();
  if (saved && Object.keys(saved).length > 0) {
    _settings = saved;
    logger.info({ hasEmail: Boolean(saved.senderEmail) }, 'Scheduler settings restored from disk');
  }
  logger.info('Scheduler started (30s tick interval)');
  tick().catch((err) => logger.error({ err: err.message }, 'Scheduler initial tick error'));
  setInterval(() => {
    tick().catch((err) => logger.error({ err: err.message }, 'Scheduler tick error'));
  }, 30_000);
}
