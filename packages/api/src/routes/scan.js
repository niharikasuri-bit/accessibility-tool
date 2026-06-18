/**
 * Scan routes.
 *
 *   POST /api/scan                       → enqueue a scan; returns scanId immediately
 *   GET  /api/scan/:scanId               → poll for status / result
 *   GET  /api/scan/:scanId/screenshot    → stream the screenshot PNG (Day 7)
 *   GET  /api/scan/:scanId/export.json   → download the report as JSON (Day 7)
 *   GET  /api/scan/:scanId/export.pdf    → generate a PDF of the report (Day 7)
 *
 * Auth: protected by the API-key middleware mounted at the parent level.
 *
 * Day 7 additions:
 *   - Screenshot streaming with safe path resolution (the scanId is validated
 *     against the in-memory job store before any file IO — no path traversal
 *     via crafted scanIds).
 *   - Report exports for downstream consumption: JSON (raw FriendlyReport for
 *     audit trails / regression diffs) and PDF (printable artefact for
 *     stakeholder share-outs).
 */

import { Router } from 'express';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { createScanSchema } from '../schemas.js';
import { jobStore } from '../store/jobs.js';
import { startJobInBackground } from '../scanner-bridge/runner.js';
import { sendEmail } from '../services/email.js';
import { buildScanEmailData, buildScanEmailDataSubsequent, buildScanSnapshot, renderEmailHtml, renderEmailHtmlSubsequent } from '../services/emailHtml.js';
import { getEmailPdfUrl } from '../services/pdfStorage.js';
import { appendEmailLog } from '../services/emailLogStore.js';
import { getProjectFlags, setFirstEmailSent } from '../services/projectFlags.js';
import { appendScanSnapshot, getProjectHistory } from '../services/scanHistory.js';
import { NotFound, BadRequest, Internal } from '../errors.js';

export const scanRouter = Router();

/* ─────────── POST /api/scan ─────────── */
scanRouter.post('/', validateBody(createScanSchema), (req, res, next) => {
  try {
    const job = jobStore.create(req.body);
    startJobInBackground(jobStore, job);
    res.status(202).json({ scanId: job.id, status: job.status, statusUrl: `/api/scan/${job.id}` });
  } catch (err) {
    next(err);
  }
});

/* ─────────── GET /api/scan/:scanId ─────────── */
scanRouter.get('/:scanId', (req, res, next) => {
  const job = jobStore.get(req.params.scanId);
  if (!job) {
    return next(NotFound('SCAN_NOT_FOUND', `No scan found with id "${req.params.scanId}".`));
  }

  const body = {
    scanId:      job.id,
    status:      job.status,
    createdAt:   job.createdAt,
    updatedAt:   job.updatedAt,
    ...(job.startedAt  ? { startedAt:  job.startedAt  } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.request    ? { request:    redactRequest(job.request) } : {}),
    ...(job.report             ? { report:             job.report             } : {}),
    ...(job.previousCompliance ? { previousCompliance: job.previousCompliance } : {}),
    ...(job.error              ? { error:              job.error              } : {}),
  };
  return res.json(body);
});

/* ─────────── GET /api/scan/:scanId/screenshot ─────────── */
scanRouter.get('/:scanId/screenshot', async (req, res, next) => {
  const job = jobStore.get(req.params.scanId);
  if (!job) {
    return next(NotFound('SCAN_NOT_FOUND', `No scan found with id "${req.params.scanId}".`));
  }
  if (!job.report?.screenshot?.path) {
    return next(NotFound('SCREENSHOT_NOT_AVAILABLE',
      `Scan ${req.params.scanId} has no screenshot. Either the scan hasn't finished, or it failed before the screenshot step.`));
  }

  // Path safety: the path comes from the job's own report (written by the
  // scanner, not by the user), but we double-check it exists and is readable
  // before streaming.
  const screenshotPath = path.resolve(job.report.screenshot.path);
  try {
    await fs.access(screenshotPath, fs.constants.R_OK);
  } catch {
    return next(Internal('SCREENSHOT_FILE_MISSING',
      `Screenshot for ${req.params.scanId} is missing from disk.`));
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Image-Width',  String(job.report.screenshot.width  ?? ''));
  res.setHeader('X-Image-Height', String(job.report.screenshot.height ?? ''));
  createReadStream(screenshotPath)
    .on('error', (err) => next(Internal('SCREENSHOT_STREAM_ERROR', `Failed to stream screenshot: ${err.message}`)))
    .pipe(res);
});

/* ─────────── GET /api/scan/:scanId/export.json ─────────── */
scanRouter.get('/:scanId/export.json', (req, res, next) => {
  const job = jobStore.get(req.params.scanId);
  if (!job) {
    return next(NotFound('SCAN_NOT_FOUND', `No scan found with id "${req.params.scanId}".`));
  }
  if (!job.report) {
    return next(BadRequest('REPORT_NOT_READY',
      `Scan ${req.params.scanId} has no report yet (status: ${job.status}).`));
  }

  const filename = `${job.id}-report.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Include the request (redacted) alongside the report so the JSON file is
  // self-contained for audit purposes.
  const payload = {
    scanId:       job.id,
    request:      redactRequest(job.request),
    completedAt:  job.finishedAt,
    durationMs:   job.report.meta?.durationMs,
    report:       job.report,
  };
  res.send(JSON.stringify(payload, null, 2));
});

/* ─────────── GET /api/scan/:scanId/export.pdf ─────────── */
//
// PDF generation uses Playwright to print the report's HTML representation.
// We construct the HTML server-side (a streamlined version of the report
// page) and pipe it through Chromium's print-to-PDF. This is heavy (~5-10s
// per export) so the endpoint is request-scoped — not cached. If we wanted
// to cache, we'd persist into the artifacts dir; deferred to Phase 2.
scanRouter.get('/:scanId/export.pdf', async (req, res, next) => {
  const job = jobStore.get(req.params.scanId);
  if (!job) {
    return next(NotFound('SCAN_NOT_FOUND', `No scan found with id "${req.params.scanId}".`));
  }
  if (!job.report) {
    return next(BadRequest('REPORT_NOT_READY',
      `Scan ${req.params.scanId} has no report yet (status: ${job.status}).`));
  }

  try {
    const { renderReportPdf } = await import('../scanner-bridge/pdf.js');
    const pdfBuffer = await renderReportPdf({
      scanId:  job.id,
      request: redactRequest(job.request),
      report:  job.report,
      screenshotPath: job.report.screenshot?.path,
    });

    const filename = `${job.id}-report.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (err) {
    return next(Internal('PDF_GENERATION_FAILED',
      `Could not generate PDF for ${req.params.scanId}: ${err.message}`));
  }
});

/* ─────────── POST /api/scan/:scanId/send-email ─────────── */
//
// Generates the PDF attachment server-side, builds the email body, and sends
// in one call. The frontend passes only email credentials + recipients —
// no localhost PDF links involved.
const sendEmailSchema = z.object({
  fromName:    z.string().optional(),
  fromEmail:   z.string().email(),
  appPassword: z.string().optional(),
  to:          z.union([z.string().email(), z.array(z.string().email())]),
  cc:          z.union([z.string().email(), z.array(z.string().email())]).optional(),
  projectName: z.string().optional(),
  projectId:   z.string().optional(),
  baseUrl:     z.string().url().optional(),
});

scanRouter.post('/:scanId/send-email', async (req, res, next) => {
  const job = jobStore.get(req.params.scanId);
  if (!job) {
    return next(NotFound('SCAN_NOT_FOUND', `No scan found with id "${req.params.scanId}".`));
  }
  if (!job.report) {
    return next(BadRequest('REPORT_NOT_READY',
      `Scan ${req.params.scanId} has no report yet (status: ${job.status}).`));
  }

  const parsed = sendEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(BadRequest('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid request.'));
  }
  const { fromName, fromEmail, appPassword, to, cc, projectName, projectId, baseUrl } = parsed.data;

  // Determine email type before any expensive PDF work.
  // Only meaningful when a projectId is present — one-off sends without a project
  // context have no state to track and are treated as first-sends by default.
  const { firstEmailSent } = projectId
    ? await getProjectFlags(projectId)
    : { firstEmailSent: false };
  const emailType = firstEmailSent ? 'subsequent' : 'first';
  const history   = (emailType === 'subsequent' && projectId)
    ? await getProjectHistory(projectId)
    : [];

  try {
    const { renderReportPdf, renderIssuesPdf, renderUnresolvedIssuesPdf, renderReportPdfSubsequent } = await import('../scanner-bridge/pdf.js');
    const req2    = redactRequest(job.request);
    const dateStr = new Date().toISOString().slice(0, 10);
    const name    = projectName || 'Accessibility Report';
    const safe    = name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const apiBase = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

    let issuesUrl = null, unresolvedPdfUrl = null, fullReportUrl = null, viewFullReportUrl = null;
    let attachments = [];

    if (emailType === 'subsequent') {
      // Unresolved: issues present in both current and previous scan
      const prevRuleIds   = new Set((history[0]?.issues ?? []).map((i) => i.ruleId));
      const allUnresolved = (job.report?.issues ?? []).filter((iss) => prevRuleIds.has(iss.ruleId));

      const issuesFilename     = `${safe}-issues-${dateStr}.pdf`;
      const unresolvedFilename = `${safe}-unresolved-${dateStr}.pdf`;
      const fullReportFilename = `${safe}-comparison-${dateStr}.pdf`;
      const viewFullFilename   = `${safe}-full-report-${dateStr}.pdf`;

      const [issuesPdf, unresolvedPdf, fullPdf, viewFullPdf] = await Promise.allSettled([
        renderIssuesPdf({ scanId: job.id, request: req2, report: job.report, projectName: name }),
        allUnresolved.length > 0
          ? renderUnresolvedIssuesPdf({ scanId: job.id, request: req2, report: job.report, projectName: name, unresolvedIssues: allUnresolved, history })
          : Promise.resolve(null),
        renderReportPdfSubsequent({ scanId: job.id, request: req2, report: job.report, projectName: name, history }),
        renderReportPdf({ scanId: job.id, request: req2, report: job.report, screenshotPath: job.report?.screenshot?.path, projectName: name }),
      ]);

      for (const [label, r] of [['issuesPdf', issuesPdf], ['unresolvedPdf', unresolvedPdf], ['fullPdf', fullPdf], ['viewFullPdf', viewFullPdf]]) {
        if (r.status === 'rejected') console.error(`[scan email] ${label} generation failed:`, r.reason?.stack ?? r.reason?.message ?? String(r.reason));
      }

      [issuesUrl, unresolvedPdfUrl, fullReportUrl, viewFullReportUrl] = await Promise.all([
        issuesPdf.status     === 'fulfilled' && issuesPdf.value     ? getEmailPdfUrl(issuesPdf.value,     issuesFilename,     apiBase) : Promise.resolve(null),
        unresolvedPdf.status === 'fulfilled' && unresolvedPdf.value ? getEmailPdfUrl(unresolvedPdf.value, unresolvedFilename, apiBase) : Promise.resolve(null),
        fullPdf.status       === 'fulfilled' && fullPdf.value       ? getEmailPdfUrl(fullPdf.value,       fullReportFilename, apiBase) : Promise.resolve(null),
        viewFullPdf.status   === 'fulfilled' && viewFullPdf.value   ? getEmailPdfUrl(viewFullPdf.value,   viewFullFilename,   apiBase) : Promise.resolve(null),
      ]);

      attachments = [
        issuesPdf.status     === 'fulfilled' && issuesPdf.value     ? { filename: issuesFilename,     content: issuesPdf.value,     contentType: 'application/pdf' } : null,
        unresolvedPdf.status === 'fulfilled' && unresolvedPdf.value ? { filename: unresolvedFilename, content: unresolvedPdf.value, contentType: 'application/pdf' } : null,
        fullPdf.status       === 'fulfilled' && fullPdf.value       ? { filename: fullReportFilename,  content: fullPdf.value,       contentType: 'application/pdf' } : null,
        viewFullPdf.status   === 'fulfilled' && viewFullPdf.value   ? { filename: viewFullFilename,    content: viewFullPdf.value,   contentType: 'application/pdf' } : null,
      ].filter(Boolean);
    } else {
      // Type 1 — issues + full report (single-page scans have no pagewise PDF)
      const issuesFilename     = `${safe}-issues-${dateStr}.pdf`;
      const fullReportFilename = `${safe}-full-report-${dateStr}.pdf`;

      const [issuesPdf, fullPdf] = await Promise.allSettled([
        renderIssuesPdf({ scanId: job.id, request: req2, report: job.report, projectName: name }),
        renderReportPdf({ scanId: job.id, request: req2, report: job.report, screenshotPath: job.report.screenshot?.path, projectName: name }),
      ]);

      for (const [label, r] of [['issuesPdf', issuesPdf], ['fullPdf', fullPdf]]) {
        if (r.status === 'rejected') console.error(`[scan email] ${label} generation failed:`, r.reason?.stack ?? r.reason?.message ?? String(r.reason));
      }

      [issuesUrl, fullReportUrl] = await Promise.all([
        issuesPdf.status === 'fulfilled' ? getEmailPdfUrl(issuesPdf.value, issuesFilename,     apiBase) : Promise.resolve(null),
        fullPdf.status   === 'fulfilled' ? getEmailPdfUrl(fullPdf.value,   fullReportFilename, apiBase) : Promise.resolve(null),
      ]);

      attachments = [
        issuesPdf.status === 'fulfilled' ? { filename: issuesFilename,    content: issuesPdf.value, contentType: 'application/pdf' } : null,
        fullPdf.status   === 'fulfilled' ? { filename: fullReportFilename, content: fullPdf.value,   contentType: 'application/pdf' } : null,
      ].filter(Boolean);
    }

    let emailData;
    try {
      emailData = emailType === 'subsequent'
        ? buildScanEmailDataSubsequent({ scan: job, projectName: name, scanId: job.id, frontendUrl: baseUrl ?? null, history })
        : buildScanEmailData({ scan: job, projectName: name, scanId: job.id, frontendUrl: baseUrl ?? null });
    } catch (buildErr) {
      console.error('[scan email] buildEmailData failed:', buildErr.stack ?? buildErr.message);
      return next(Internal('EMAIL_BUILD_FAILED', `Email data build failed: ${buildErr.message}`));
    }
    emailData.pagesUrl          = null;
    emailData.issuesUrl         = issuesUrl;
    emailData.unresolvedPdfUrl  = unresolvedPdfUrl;
    emailData.fullReportUrl     = fullReportUrl;
    emailData.viewFullReportUrl = viewFullReportUrl;

    console.log('[scan email PDF URLs]', { pagesUrl: emailData.pagesUrl, issuesUrl: emailData.issuesUrl, unresolvedPdfUrl: emailData.unresolvedPdfUrl, fullReportUrl: emailData.fullReportUrl, viewFullReportUrl: emailData.viewFullReportUrl });

    let html;
    try {
      html = emailType === 'subsequent'
        ? renderEmailHtmlSubsequent(emailData)
        : renderEmailHtml(emailData);
    } catch (renderErr) {
      console.error('[scan email] renderEmailHtml failed:', renderErr.stack ?? renderErr.message);
      return next(Internal('EMAIL_RENDER_FAILED', `Email render failed: ${renderErr.message}`));
    }

    const toArr = Array.isArray(to) ? to : [to];
    const ccArr = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
    await sendEmail({
      fromName, fromEmail, appPassword,
      to: toArr, cc: ccArr.length ? ccArr : undefined,
      subject: `Accessibility Report of ${name}`,
      html,
      attachments,
    });

    // Flag and snapshot set only after confirmed successful send.
    if (projectId) {
      await setFirstEmailSent(projectId);
      await appendScanSnapshot(projectId, buildScanSnapshot({ report: job.report, scanDate: new Date().toISOString() }));
    }

    if (projectId) {
      appendEmailLog({
        projectId,
        timestamp:      new Date().toISOString(),
        status:         'sent',
        triggeredBy:    'manual',
        recipientCount: toArr.length + ccArr.length,
        fullReportUrl,
        error:          null,
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    return next(Internal('SEND_EMAIL_FAILED',
      `Could not send email for ${req.params.scanId}: ${err.message}`));
  }
});

/* ─────────── helpers ─────────── */

/**
 * Strip credentials before exposing the request to GET callers.
 *
 * Anyone who has the scanId (which is unguessable) can see the target
 * URL and the auth strategy, but never passwords or tokens.
 */
function redactRequest(req) {
  if (!req) return req;
  const out = { url: req.url };
  if (req.auth?.type) {
    out.auth = { type: req.auth.type };
    if (req.auth.contextStrategy) out.auth.contextStrategy = req.auth.contextStrategy;
  }
  if (req.options?.captureScreenshot !== undefined) {
    out.options = { captureScreenshot: req.options.captureScreenshot };
  }
  if (req.options?.waitForSelector) {
    out.options = { ...(out.options ?? {}), waitForSelector: req.options.waitForSelector };
  }
  return out;
}
