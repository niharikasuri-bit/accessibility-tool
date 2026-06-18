import { Router } from 'express';
import { z } from 'zod';
import { syncSchedule, getSchedulerStatus, clearProjectState } from '../services/scheduler.js';
import { getEmailLogForProject } from '../services/emailLogStore.js';
import { clearFirstEmailSent } from '../services/projectFlags.js';
import { clearProjectHistory } from '../services/scanHistory.js';
import { getStorageStats } from '../services/pdfStorage.js';
import { logger } from '../logger.js';

export const scheduleRouter = Router();

const syncSchema = z.object({
  projects:    z.array(z.any()).default([]),
  settings:    z.record(z.string(), z.any()).default({}),
  frontendUrl: z.string().optional(),
});

scheduleRouter.post('/sync', (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, message: 'Invalid sync payload' });
  }
  syncSchedule(parsed.data);
  res.json({ ok: true });
});

/** GET /api/schedule/status — shows current scheduler state for debugging */
scheduleRouter.get('/status', (_req, res) => {
  res.json(getSchedulerStatus());
});

/** GET /api/schedule/email-log/:projectId — fetch persistent email send history for a project */
scheduleRouter.get('/email-log/:projectId', async (req, res, next) => {
  try {
    const entries = await getEmailLogForProject(req.params.projectId);
    res.json({ ok: true, entries: Array.isArray(entries) ? entries : [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to fetch email logs', details: err.message });
  }
});

/** POST /api/schedule/clear-project — cascade-delete all data for a deleted project */
scheduleRouter.post('/clear-project', async (req, res, next) => {
  const { projectId, projectName } = req.body ?? {};
  if (!projectId) return res.status(400).json({ ok: false, message: 'projectId required' });
  try {
    await clearProjectState(projectId, projectName ?? null);
    logger.info({ projectId, projectName }, 'Project state cleared on delete');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message, projectId }, 'Failed to clear project state');
    next(err);
  }
});

/** POST /api/schedule/reset-email-state — reset firstEmailSent + scan history when URL/scanMode changes */
scheduleRouter.post('/reset-email-state', async (req, res, next) => {
  const { projectId } = req.body ?? {};
  if (!projectId) return res.status(400).json({ ok: false, message: 'projectId required' });
  try {
    await clearFirstEmailSent(projectId);
    await clearProjectHistory(projectId);
    logger.info({ projectId }, 'Email state reset — next dispatch will be Type 1');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message, projectId }, 'Failed to reset email state');
    next(err);
  }
});

/** GET /api/schedule/storage-stats — local PDF storage count and approximate size */
scheduleRouter.get('/storage-stats', async (_req, res, next) => {
  try {
    const stats = await getStorageStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    next(err);
  }
});

/** GET /api/schedule/email-preview?type=2 — server-rendered mock Type 2 email HTML for preview */
scheduleRouter.get('/email-preview', async (req, res, next) => {
  if (req.query.type !== '2') {
    return res.status(400).json({ ok: false, message: 'Only type=2 is supported; Type 1 is rendered client-side.' });
  }
  try {
    const { renderEmailHtmlSubsequent } = await import('../services/emailHtml.js');
    const mockData = buildMockType2EmailData();
    const html = renderEmailHtmlSubsequent(mockData);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to render email preview');
    next(err);
  }
});

function buildMockType2EmailData() {
  const prevDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    projectName:  'DIGIT HCM Portal',
    scanDate:     'Monday, June 16, 2026 at 9:00 AM IST',
    score:        74,
    severity:           { severe: 3, high: 8, medium: 9, low: 3 },
    scanMode:           'site',
    pages: [
      { name: 'Dashboard',     url: '/dashboard',    score: 52, issueCount: 8 },
      { name: 'Reports List',  url: '/reports',       score: 67, issueCount: 6 },
      { name: 'User Settings', url: '/settings/user', score: 71, issueCount: 5 },
      { name: 'Complaints',    url: '/complaints',    score: 78, issueCount: 4 },
    ],
    previous: {
      score:       68,
      totalIssues: 29,
      severity:    { severe: 5, high: 10, medium: 11, low: 3 },
    },
    chartPoints: [
      { date: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(), score: 61, totalIssues: 35 },
      { date: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(), score: 64, totalIssues: 32 },
      { date: prevDate,                                                        score: 68, totalIssues: 29 },
      { date: new Date().toISOString(),                                        score: 74, totalIssues: 23 },
    ],
    unresolvedIssues: [
      {
        sevKey:       'severe',
        title:        'Interactive elements not keyboard accessible',
        affectedPage: '/reports',
        compliance:   'WCAG 2.1 2.1.1 · ADA Title III',
      },
      {
        sevKey:       'high',
        title:        'Insufficient color contrast on text',
        affectedPage: '/settings/user',
        compliance:   'WCAG 2.1 1.4.3',
      },
      {
        sevKey:       'medium',
        title:        'Page missing main landmark region',
        affectedPage: '/dashboard',
        compliance:   'WCAG 2.1 1.3.6',
      },
    ],
    totalPages:  8,
    totalIssues: 10,
    topIssues: [
      { sevKey: 'severe', title: 'Interactive elements not keyboard accessible', affectedPage: '/dashboard', compliance: 'WCAG 2.1 2.1.1 · ADA Title III' },
      { sevKey: 'high',   title: 'Insufficient color contrast on text',           affectedPage: '/settings/user', compliance: 'WCAG 2.1 1.4.3' },
      { sevKey: 'high',   title: 'Missing alternative text on images',             affectedPage: '/reports', compliance: 'WCAG 2.1 1.1.1' },
    ],
    totalUnresolved:   4,
    pagesUrl:          '#',
    issuesUrl:         '#',
    unresolvedPdfUrl:  '#',
    fullReportUrl:     '#',
    viewFullReportUrl: '#',
    reportUrl:         null,
  };
}
