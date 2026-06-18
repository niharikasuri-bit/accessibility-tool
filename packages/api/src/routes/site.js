/**
 * Site (multi-page) scan routes — the explorer's HTTP surface.
 *
 *   POST /api/site                      → enqueue a whole-site exploration; returns siteId
 *   GET  /api/site/:siteId              → poll status / live progress / scored site report
 *   GET  /api/site/:siteId/export.json  → download the site report as JSON
 *
 * Reuses the same in-memory job store as single-page scans (site jobs are
 * tagged with kind:'site' so the two never get confused); the runner is the
 * multi-page one (site-runner.js).
 *
 * NOTE: this path runs server-side and headless, so auth must be AUTOMATED
 * (credentials in the request body — e.g. a 'form' auth with contextStrategy
 * 'single' for DIGIT Studio). The CLI's manual-login flow does not apply here.
 *
 * Auth (API key): protected by the API-key middleware mounted at the parent.
 */

import { Router } from 'express';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { createSiteScanSchema } from '../schemas.js';
import { jobStore } from '../store/jobs.js';
import { readSiteReport } from '../store/site-report-cache.js';
import { startSiteJobInBackground } from '../scanner-bridge/site-runner.js';
import { sendEmail } from '../services/email.js';
import { buildSiteEmailData, buildSiteEmailDataSubsequent, buildScanSnapshot, renderEmailHtml, renderEmailHtmlSubsequent } from '../services/emailHtml.js';
import { getEmailPdfUrl } from '../services/pdfStorage.js';
import { appendEmailLog } from '../services/emailLogStore.js';
import { getProjectFlags, setFirstEmailSent } from '../services/projectFlags.js';
import { appendScanSnapshot, getProjectHistory } from '../services/scanHistory.js';
import { NotFound, BadRequest, Internal } from '../errors.js';

export const siteRouter = Router();

/* ─────────── POST /api/site ─────────── */
siteRouter.post('/', validateBody(createSiteScanSchema), (req, res, next) => {
  try {
    const job = jobStore.create({ kind: 'site', ...req.body });
    startSiteJobInBackground(jobStore, job);
    res.status(202).json({
      siteId:    job.id,
      status:    job.status,
      statusUrl: `/api/site/${job.id}`,
    });
  } catch (err) {
    next(err);
  }
});

/* ─────────── GET /api/site/:siteId ─────────── */
siteRouter.get('/:siteId', (req, res, next) => {
  const job = siteJobOr404(req.params.siteId, next);
  if (!job) return;

  res.json({
    siteId:      job.id,
    status:      job.status,
    createdAt:   job.createdAt,
    updatedAt:   job.updatedAt,
    ...(job.startedAt  ? { startedAt:  job.startedAt  } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.progress   ? { progress:   job.progress   } : {}),
    ...(job.request            ? { request:            redactSiteRequest(job.request) } : {}),
    ...(job.report             ? { report:             job.report             } : {}),
    ...(job.previousCompliance ? { previousCompliance: job.previousCompliance } : {}),
    ...(job.error              ? { error:              job.error              } : {}),
  });
});

/* ─────────── GET /api/site/:siteId/export.json ─────────── */
siteRouter.get('/:siteId/export.json', async (req, res, next) => {
  const data = await loadSiteExport(req.params.siteId);
  if (!data) {
    return next(NotFound('SITE_SCAN_NOT_FOUND', `No site scan found with id "${req.params.siteId}".`));
  }

  const filename = `${req.params.siteId}-site-report.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(data, null, 2));
});

/* ─────────── GET /api/site/:siteId/export.pdf ─────────── */
//
// Consolidated PDF: overall score + standards + per-page summary table +
// priority fixes + the full site-wide issue list. Heavy (boots Chromium), so
// it's request-scoped and not cached — same trade-off as the single-page PDF.
siteRouter.get('/:siteId/export.pdf', async (req, res, next) => {
  const data = await loadSiteExport(req.params.siteId);
  if (!data) {
    return next(NotFound('SITE_SCAN_NOT_FOUND', `No site scan found with id "${req.params.siteId}".`));
  }

  try {
    const { renderSiteReportPdf } = await import('../scanner-bridge/site-pdf.js');
    const pdfBuffer = await renderSiteReportPdf({
      siteId:  data.siteId ?? req.params.siteId,
      request: data.request,
      report:  data.report,
    });

    const filename = `${req.params.siteId}-site-report.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (err) {
    return next(Internal('PDF_GENERATION_FAILED',
      `Could not generate the site PDF for ${req.params.siteId}: ${err.message}`));
  }
});

/* ─────────── GET /api/site/:siteId/screenshot/:pageIndex ─────────── */
//
// Streams a page's base-state screenshot PNG. The path comes from the job's
// own report (written by our scanner, not the user), but we validate the index
// and confirm the file is readable before streaming. Pages with only dynamic
// issues — or where capture failed — have no screenshot and return 404.
siteRouter.get('/:siteId/screenshot/:pageIndex', async (req, res, next) => {
  const data = await loadSiteExport(req.params.siteId);
  if (!data) {
    return next(NotFound('SITE_SCAN_NOT_FOUND', `No site scan found with id "${req.params.siteId}".`));
  }

  const idx  = Number.parseInt(req.params.pageIndex, 10);
  const page = data.report?.pages?.[idx];
  if (!Number.isInteger(idx) || !page) {
    return next(NotFound('PAGE_NOT_FOUND',
      `Site scan ${req.params.siteId} has no page at index ${req.params.pageIndex}.`));
  }
  if (!page.screenshot?.path) {
    return next(NotFound('SCREENSHOT_NOT_AVAILABLE',
      `Page ${idx} of ${req.params.siteId} has no screenshot.`));
  }

  const shotPath = path.resolve(page.screenshot.path);
  try {
    await fs.access(shotPath, fs.constants.R_OK);
  } catch {
    return next(Internal('SCREENSHOT_FILE_MISSING',
      `Screenshot for page ${idx} of ${req.params.siteId} is missing from disk.`));
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Image-Width',  String(page.screenshot.width  ?? ''));
  res.setHeader('X-Image-Height', String(page.screenshot.height ?? ''));
  createReadStream(shotPath)
    .on('error', (err) => next(Internal('SCREENSHOT_STREAM_ERROR', `Failed to stream screenshot: ${err.message}`)))
    .pipe(res);
});

/* ─────────── POST /api/site/:siteId/send-email ─────────── */
const sendSiteEmailSchema = z.object({
  fromName:    z.string().optional(),
  fromEmail:   z.string().email(),
  appPassword: z.string().optional(),
  to:          z.union([z.string().email(), z.array(z.string().email())]),
  cc:          z.union([z.string().email(), z.array(z.string().email())]).optional(),
  projectName: z.string().optional(),
  projectId:   z.string().optional(),
  baseUrl:     z.string().url().optional(),
});

siteRouter.post('/:siteId/send-email', async (req, res, next) => {
  const data = await loadSiteExport(req.params.siteId);
  if (!data) {
    return next(NotFound('SITE_SCAN_NOT_FOUND', `No site scan found with id "${req.params.siteId}".`));
  }

  const parsed = sendSiteEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(BadRequest('INVALID_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid request.'));
  }
  const { fromName, fromEmail, appPassword, to, cc, projectName, projectId, baseUrl } = parsed.data;

  // Determine email type before any expensive PDF work.
  const { firstEmailSent } = projectId
    ? await getProjectFlags(projectId)
    : { firstEmailSent: false };
  const emailType = firstEmailSent ? 'subsequent' : 'first';
  const history   = (emailType === 'subsequent' && projectId)
    ? await getProjectHistory(projectId)
    : [];

  try {
    const [{ renderSiteReportPdf, renderSiteIssuesPdf, renderSitePagesPdf }, { renderUnresolvedIssuesPdf, renderReportPdfSubsequent }] = await Promise.all([
      import('../scanner-bridge/site-pdf.js'),
      import('../scanner-bridge/pdf.js'),
    ]);
    const siteId  = data.siteId ?? req.params.siteId;
    const name    = projectName || 'Accessibility Report';
    const dateStr = new Date().toISOString().slice(0, 10);
    const safe    = name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const apiBase = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

    let pagesUrl = null, issuesUrl = null, unresolvedPdfUrl = null, fullReportUrl = null, viewFullReportUrl = null;
    let attachments = [];

    if (emailType === 'subsequent') {
      // Unresolved: issues present in both current and previous scan
      const prevRuleIds   = new Set((history[0]?.issues ?? []).map((i) => i.ruleId));
      const allUnresolved = (data.report?.issues ?? []).filter((iss) => prevRuleIds.has(iss.ruleId));

      const pagesFilename       = `${safe}-pagewise-${dateStr}.pdf`;
      const issuesFilename      = `${safe}-issues-${dateStr}.pdf`;
      const unresolvedFilename  = `${safe}-unresolved-${dateStr}.pdf`;
      const fullReportFilename  = `${safe}-full-report-${dateStr}.pdf`;
      const viewFullFilename    = `${safe}-site-report-${dateStr}.pdf`;

      const [pagesPdf, issuesPdf, unresolvedPdf, fullPdf, viewFullPdf] = await Promise.allSettled([
        renderSitePagesPdf({ siteId, request: data.request, report: data.report, projectName: name }),
        renderSiteIssuesPdf({ siteId, request: data.request, report: data.report, projectName: name }),
        allUnresolved.length > 0
          ? renderUnresolvedIssuesPdf({ scanId: siteId, request: data.request, report: data.report, projectName: name, unresolvedIssues: allUnresolved, history })
          : Promise.resolve(null),
        renderReportPdfSubsequent({ scanId: siteId, request: data.request, report: data.report, projectName: name, history }),
        renderSiteReportPdf({ siteId, request: data.request, report: data.report, projectName: name }),
      ]);

      for (const [label, r] of [['pagesPdf', pagesPdf], ['issuesPdf', issuesPdf], ['unresolvedPdf', unresolvedPdf], ['fullPdf', fullPdf], ['viewFullPdf', viewFullPdf]]) {
        if (r.status === 'rejected') console.error(`[site email] ${label} generation failed:`, r.reason?.stack ?? r.reason?.message ?? String(r.reason));
      }

      [pagesUrl, issuesUrl, unresolvedPdfUrl, fullReportUrl, viewFullReportUrl] = await Promise.all([
        pagesPdf.status      === 'fulfilled' && pagesPdf.value      ? getEmailPdfUrl(pagesPdf.value,      pagesFilename,      apiBase) : Promise.resolve(null),
        issuesPdf.status     === 'fulfilled' && issuesPdf.value     ? getEmailPdfUrl(issuesPdf.value,     issuesFilename,     apiBase) : Promise.resolve(null),
        unresolvedPdf.status === 'fulfilled' && unresolvedPdf.value ? getEmailPdfUrl(unresolvedPdf.value, unresolvedFilename, apiBase) : Promise.resolve(null),
        fullPdf.status       === 'fulfilled' && fullPdf.value       ? getEmailPdfUrl(fullPdf.value,       fullReportFilename, apiBase) : Promise.resolve(null),
        viewFullPdf.status   === 'fulfilled' && viewFullPdf.value   ? getEmailPdfUrl(viewFullPdf.value,   viewFullFilename,   apiBase) : Promise.resolve(null),
      ]);

      attachments = [
        pagesPdf.status      === 'fulfilled' && pagesPdf.value      ? { filename: pagesFilename,      content: pagesPdf.value,      contentType: 'application/pdf' } : null,
        issuesPdf.status     === 'fulfilled' && issuesPdf.value     ? { filename: issuesFilename,     content: issuesPdf.value,     contentType: 'application/pdf' } : null,
        unresolvedPdf.status === 'fulfilled' && unresolvedPdf.value ? { filename: unresolvedFilename, content: unresolvedPdf.value, contentType: 'application/pdf' } : null,
        fullPdf.status       === 'fulfilled' && fullPdf.value       ? { filename: fullReportFilename,  content: fullPdf.value,       contentType: 'application/pdf' } : null,
        viewFullPdf.status   === 'fulfilled' && viewFullPdf.value   ? { filename: viewFullFilename,    content: viewFullPdf.value,   contentType: 'application/pdf' } : null,
      ].filter(Boolean);
    } else {
      // Type 1 — pagewise + issues + full site report
      const pagesFilename      = `${safe}-pagewise-${dateStr}.pdf`;
      const issuesFilename     = `${safe}-issues-${dateStr}.pdf`;
      const fullReportFilename = `${safe}-full-report-${dateStr}.pdf`;

      const [pagesPdf, issuesPdf, fullPdf] = await Promise.allSettled([
        renderSitePagesPdf({ siteId, request: data.request, report: data.report, projectName: name }),
        renderSiteIssuesPdf({ siteId, request: data.request, report: data.report, projectName: name }),
        renderSiteReportPdf({ siteId, request: data.request, report: data.report, projectName: name }),
      ]);

      for (const [label, r] of [['pagesPdf', pagesPdf], ['issuesPdf', issuesPdf], ['fullPdf', fullPdf]]) {
        if (r.status === 'rejected') console.error(`[site email] ${label} generation failed:`, r.reason?.stack ?? r.reason?.message ?? String(r.reason));
      }

      [pagesUrl, issuesUrl, fullReportUrl] = await Promise.all([
        pagesPdf.status  === 'fulfilled' ? getEmailPdfUrl(pagesPdf.value,  pagesFilename,      apiBase) : Promise.resolve(null),
        issuesPdf.status === 'fulfilled' ? getEmailPdfUrl(issuesPdf.value, issuesFilename,     apiBase) : Promise.resolve(null),
        fullPdf.status   === 'fulfilled' ? getEmailPdfUrl(fullPdf.value,   fullReportFilename, apiBase) : Promise.resolve(null),
      ]);

      attachments = [
        pagesPdf.status  === 'fulfilled' ? { filename: pagesFilename,      content: pagesPdf.value,  contentType: 'application/pdf' } : null,
        issuesPdf.status === 'fulfilled' ? { filename: issuesFilename,     content: issuesPdf.value, contentType: 'application/pdf' } : null,
        fullPdf.status   === 'fulfilled' ? { filename: fullReportFilename,  content: fullPdf.value,   contentType: 'application/pdf' } : null,
      ].filter(Boolean);
    }

    const siteArg = { report: data.report, request: data.request };
    let emailData;
    try {
      emailData = emailType === 'subsequent'
        ? buildSiteEmailDataSubsequent({ site: siteArg, projectName: name, siteId, frontendUrl: baseUrl ?? null, history })
        : buildSiteEmailData({ site: siteArg, projectName: name, siteId, frontendUrl: baseUrl ?? null });
    } catch (buildErr) {
      console.error('[site email] buildEmailData failed:', buildErr.stack ?? buildErr.message);
      return next(Internal('EMAIL_BUILD_FAILED', `Email data build failed: ${buildErr.message}`));
    }
    emailData.pagesUrl           = pagesUrl;
    emailData.issuesUrl          = issuesUrl;
    emailData.unresolvedPdfUrl   = unresolvedPdfUrl;
    emailData.fullReportUrl      = fullReportUrl;
    emailData.viewFullReportUrl  = viewFullReportUrl;

    console.log('[site email PDF URLs]', { pagesUrl: emailData.pagesUrl, issuesUrl: emailData.issuesUrl, unresolvedPdfUrl: emailData.unresolvedPdfUrl, fullReportUrl: emailData.fullReportUrl, viewFullReportUrl: emailData.viewFullReportUrl });

    let html;
    try {
      html = emailType === 'subsequent'
        ? renderEmailHtmlSubsequent(emailData)
        : renderEmailHtml(emailData);
    } catch (renderErr) {
      console.error('[site email] renderEmailHtml failed:', renderErr.stack ?? renderErr.message);
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
      await appendScanSnapshot(projectId, buildScanSnapshot({ report: data.report, scanDate: new Date().toISOString() }));
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
      `Could not send email for ${req.params.siteId}: ${err.message}`));
  }
});

/* ─────────── helpers ─────────── */

/**
 * Load a completed site export ({ siteId, request, completedAt, report }) for the
 * download routes. Prefers the in-memory job; falls back to the on-disk cache so
 * downloads survive an API restart or the 30-min in-memory eviction. The cache
 * file lives under the scan's own artifacts dir, so it's inherently site-scoped.
 * Returns null if neither source has a report.
 */
async function loadSiteExport(id) {
  const job = jobStore.get(id);
  if (job && job.request?.kind === 'site' && job.report) {
    return {
      siteId:      id,
      request:     redactSiteRequest(job.request),
      completedAt: job.finishedAt,
      report:      job.report,
    };
  }
  const cached = await readSiteReport(id);
  if (cached?.report) return cached;
  return null;
}

/**
 * Look up a job and ensure it's a site job. Calls next(NotFound) and returns
 * null on miss, so single-page scan ids can't be read through this route.
 */
function siteJobOr404(id, next) {
  const job = jobStore.get(id);
  if (!job || job.request?.kind !== 'site') {
    next(NotFound('SITE_SCAN_NOT_FOUND', `No site scan found with id "${id}".`));
    return null;
  }
  return job;
}

/**
 * Strip credentials before exposing the request to GET callers. The sitemap
 * URLs and auth strategy are visible (the siteId is unguessable); passwords and
 * tokens never are.
 */
function redactSiteRequest(req) {
  if (!req) return req;
  const out = {
    urls: (req.urls ?? []).map((u) => (typeof u === 'string' ? u : u.url)),
  };
  if (req.auth?.type) {
    out.auth = { type: req.auth.type };
    if (req.auth.contextStrategy) out.auth.contextStrategy = req.auth.contextStrategy;
  }
  return out;
}
