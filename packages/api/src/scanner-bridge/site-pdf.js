/**
 * Site (multi-page) PDF report generator.
 *
 * Mirrors the on-screen site report layout (minus the hover interaction, which
 * a PDF can't do):
 *   1. overall score (averaged)
 *   2. per-page results — each page: header (score + counts) + base-state
 *      screenshot + that page's full issue list
 *   3. standards compliance
 *   4. priority fixes ("Start here")
 *   5. the full site-wide issue list (every distinct rule across all pages)
 *
 * Reuses pdf.js's building blocks (score block, standards, start-here, issue
 * cards, styles, screenshot embedding) so it looks identical to the single-page
 * report. Each per-page block starts on its own PDF page.
 *
 * @see ../routes/site.js
 */

import { chromium } from 'playwright';
import {
  escapeHtml,
  baseStyles,
  renderScoreBlock,
  renderStandards,
  renderStartHere,
  renderIssue,
  embedAsDataUri,
  pageName,
  renderHowToReadForPdf,
  renderPagewiseSectionForPdf,
  renderAllIssuesList,
  buildScreenshotHtml,
  buildIssueOverlayTable,
  renderHowToReadSection,
  renderSnapshotSection,
  renderComplianceCards,
  renderSeveritySnapshot,
  formatPdfDate,
  pdfFirstPageHeading,
} from './pdf.js';

function extractSiteHostname(request) {
  const url = request?.urls?.[0] ?? '';
  try { return new URL(url).hostname; } catch { return url || 'Accessibility Report'; }
}

/**
 * @param {object} input
 * @param {string} input.siteId
 * @param {object} input.request - the (redacted) site request: { urls, auth? }
 * @param {object} input.report  - the site report (buildSiteReport output)
 * @param {string} [input.projectName]
 * @returns {Promise<Buffer>} the PDF bytes
 */
export async function renderSiteReportPdf({ siteId, request, report, projectName }) {
  const name = projectName || extractSiteHostname(request);
  const date = formatPdfDate(new Date());
  const html = renderSiteHtml({ siteId, request, report, projectName: name, date });
  return _sitePrintPdf(html);
}

export async function renderSiteIssuesPdf({ siteId, request, report, projectName }) {
  const name = projectName || extractSiteHostname(request);
  const date = formatPdfDate(new Date());
  const html = renderSiteIssuesHtml({ siteId, request, report, projectName: name, date });
  return _sitePrintPdf(html);
}

export async function renderSitePagesPdf({ siteId, request, report, projectName }) {
  const name = projectName || extractSiteHostname(request);
  const date = formatPdfDate(new Date());
  const html = renderSitePagesHtml({ siteId, request, report, projectName: name, date });
  return _sitePrintPdf(html);
}

const _siteFooterTemplate =
  '<div style="width:100%;padding:0 14mm;box-sizing:border-box;text-align:right;' +
  'font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#aaaaaa">' +
  'Page <span class="pageNumber"></span></div>';

async function _sitePrintPdf(html) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: _siteFooterTemplate,
      margin: { top: '12mm', bottom: '14mm', left: '0', right: '0' },
      preferCSSPageSize: false,
    });
  } finally {
    await browser.close();
  }
}

/* ─────────── HTML composition ─────────── */

function renderSiteHtml({ siteId, request, report, projectName, date }) {
  const m     = report.meta || {};
  const pages = report.pages || [];

  const siteReport = {
    score:   report.overallScore ?? 0,
    summary: report.summary ?? {},
    standardsBreakdown: report.standardsBreakdown,
    issues: report.issues,
  };

  const pageRows = pages.map((p) => ({
    url:     p.url ?? '',
    name:    p.name ?? pageName(p.url ?? ''),
    score:   p.score ?? 0,
    summary: p.summary ?? {},
  }));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Whole-site accessibility report — ${escapeHtml(siteId)}</title>
<style>
  ${baseStyles()}
  ${siteStyles()}
</style>
</head>
<body>
  ${pdfFirstPageHeading(projectName, date)}
  <div class="content">
    ${renderHowToReadSection(siteReport.score)}
    ${renderSnapshotSection(siteReport)}
    ${renderComplianceCards(siteReport.standardsBreakdown)}
    ${renderSeveritySnapshot(siteReport.summary)}
    ${renderPagewiseSectionForPdf(pageRows)}
    ${renderAllIssuesList(siteReport.issues, siteReport.summary, '')}
    <footer class="ftr">DIGIT Accessibility Scanner &nbsp;·&nbsp; Built on Playwright + axe-core</footer>
  </div>
</body>
</html>`;
}

function renderSiteIssuesHtml({ siteId, request, report, projectName, date }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Issues Report &mdash; ${escapeHtml(siteId)}</title>
<style>${baseStyles()}${siteStyles()}</style>
</head>
<body>
  ${pdfFirstPageHeading(projectName, date)}
  <div class="content">
    <section>
      ${renderSiteWideIssues(report.issues, report.summary)}
    </section>
    <footer class="ftr">DIGIT Accessibility Scanner &nbsp;&middot;&nbsp; Built on Playwright + axe-core</footer>
  </div>
</body>
</html>`;
}

function renderSitePagesHtml({ siteId, request, report, projectName, date }) {
  const pages = report.pages || [];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Page-wise Report &mdash; ${escapeHtml(siteId)}</title>
<style>${baseStyles()}${siteStyles()}</style>
</head>
<body>
  ${pdfFirstPageHeading(projectName, date)}
  <div class="content">
    ${renderPageSummaryTable(pages)}
    <footer class="ftr">DIGIT Accessibility Scanner &nbsp;&middot;&nbsp; Built on Playwright + axe-core</footer>
  </div>
</body>
</html>`;
}

function renderPageSummaryTable(pages) {
  if (!pages.length) return '<p class="muted">No pages scanned.</p>';
  const rows = pages.map((p, i) => {
    const s = p.summary ?? {};
    const score = p.score ?? 0;
    const scoreColor = score >= 90 ? '#2e7d32' : score >= 70 ? '#f57c00' : '#c62828';
    const name = pageName(p.url || '');
    const rowBg = i % 2 === 0 ? '#fff' : '#f9f9f9';
    return `
    <tr>
      <td style="vertical-align:top">
        <p style="font-weight:700;margin:0;font-size:8.5pt;color:#1a1a2e">${escapeHtml(name)}</p>
        <p style="color:#888888;font-size:7pt;margin:2pt 0 0;font-family:'Courier New',monospace;word-break:break-all">${escapeHtml(p.url || '')}</p>
      </td>
      <td style="text-align:center;font-weight:700;color:${scoreColor};font-size:13pt;white-space:nowrap">${score}</td>
      <td style="text-align:center;font-weight:700;color:#333333">${s.totalIssues ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:#c62828">${s.critical ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:#e65100">${s.serious ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:#b45309">${s.moderate ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:#00796b">${s.minor ?? 0}</td>
    </tr>`;
  }).join('');

  return `
  <section>
    <h2 class="section-heading">Page-wise Detail (${pages.length} pages)</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Page</th>
          <th style="text-align:center;width:44pt">Score</th>
          <th style="text-align:center;width:48pt">Total</th>
          <th style="text-align:center;width:40pt">Severe</th>
          <th style="text-align:center;width:40pt">High</th>
          <th style="text-align:center;width:44pt">Medium</th>
          <th style="text-align:center;width:36pt">Low</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function scoreToneClass(score) {
  return score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'bad';
}

/* ─────────── how to read (overview) ─────────── */

function renderHowToRead(pageCount) {
  return `
  <section class="howto">
    <h2 class="section-heading">How to Read This Report</h2>
    <p>The score above is the average across all ${pageCount} pages — 90+ is excellent, 70–89 is moderate, below 70 needs work. Issues are grouped by severity: <strong>Severe</strong> blocks some users entirely (fix first), <strong>High</strong> makes pages hard to use, and <strong>Medium</strong> / <strong>Low</strong> are smaller improvements. Each page section below shows that page's screenshot with on-load issues boxed. <strong>All issues across the site</strong> at the end collects every distinct issue once.</p>
  </section>`;
}

/* ─────────── most common issues (summary table) ─────────── */

function renderSummaryTable(issueSummary, summary) {
  if (!issueSummary || issueSummary.length === 0) return '';
  const s = summary || {};
  const rows = issueSummary.map((it) => `
    <tr>
      <td class="st-issue">${escapeHtml(it.title)}</td>
      <td><span class="pill pill-${it.tone}">${escapeHtml(it.severity)}</span></td>
      <td class="st-num">${it.pagesAffected}</td>
      <td class="st-num">${it.elements}</td>
    </tr>`).join('');
  return `
  <section class="summary-section">
    <h2 class="section-heading">Most Common Issues</h2>
    <p class="muted">${s.totalIssues ?? issueSummary.length} distinct issue types, sorted by severity. "Pages" is how many scanned pages each appears on; "Elements" is the total across all pages.</p>
    <table class="data-table summary-table">
      <thead>
        <tr><th>Issue</th><th>Severity</th><th class="st-num">Pages</th><th class="st-num">Elements</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

/* ─────────── per-page results: header + screenshot + that page's issues ─────────── */

function renderPerPageSections(pages) {
  if (!pages.length) return '';
  return `
  <section class="per-page-wrap">
    <h2 class="section-heading">Per-page Results</h2>
    ${pages.map((p, i) => renderPageBlock(p, i)).join('')}
  </section>`;
}

function renderPageBlock(p) {
  const name = pageName(p.url);

  // Page that couldn't load — muted, no screenshot/issues.
  if (!p.summary) {
    const where = (p.landed && p.landed !== p.url) ? ` → ${escapeHtml(p.landed)}` : '';
    return `
    <section class="page-block page-break">
      <div class="pb-head">
        <div class="pb-headtext">
          <h3 class="pb-title">${escapeHtml(name)}</h3>
          <p class="pb-url">${escapeHtml(p.url)}</p>
          <p class="pp-failed">Couldn't load (${escapeHtml(p.loadStatus ?? 'unknown')})${where}</p>
        </div>
      </div>
    </section>`;
  }

  const s = p.summary;
  const tone = scoreToneClass(p.score);
  const shot = p.screenshot?.path ? embedAsDataUri(p.screenshot.path) : null;

  return `
  <section class="page-block page-break">
    <div class="pb-head">
      <span class="pb-score score-${tone}">${p.score}</span>
      <div class="pb-headtext">
        <h3 class="pb-title">${escapeHtml(name)}</h3>
        <p class="pb-url">${escapeHtml(p.url)}</p>
        <p class="pb-counts">
          ${s.totalIssues ?? 0} issues —
          <span class="c-crit">${s.critical ?? 0} critical</span> ·
          <span class="c-ser">${s.serious ?? 0} serious</span> ·
          <span class="c-mod">${s.moderate ?? 0} moderate</span> ·
          <span class="c-min">${s.minor ?? 0} minor</span>
        </p>
      </div>
    </div>

    ${shot ? `
    <div class="pb-shot">
      <p class="pb-shot-label">Page screenshot — base state (as the page loads). Issues only reachable after a click are listed below but not marked here.</p>
      <img class="screenshot pb-screenshot" src="${shot}" alt="Base-state screenshot of ${escapeHtml(name)}" />
    </div>` : ''}

    <div class="pb-issues">
      <p class="pb-issues-title">Issues on this page (${s.totalIssues ?? 0})</p>
      ${(p.issues ?? []).length
        ? p.issues.map((iss, j) => renderIssue(iss, j + 1, false)).join('')
        : '<p class="muted">No issues found on this page.</p>'}
    </div>
  </section>`;
}

/* ─────────── Section 6: screenshots with marked issues ─────────── */

function renderSiteScreenshotSection(pages) {
  if (!pages.length) return '';

  const heading = `
  <section class="page-break">
    <h2 class="section-heading">Page Screenshots with Marked Issues</h2>
  </section>`;

  const pageBlocks = pages.map((p) => {
    const name = p.name ?? pageName(p.url ?? '');

    if (!p.summary) {
      return `
      <section class="page-break">
        <div style="border-bottom:2px solid #191D88;padding-bottom:8pt;margin-bottom:14pt">
          <p style="font-weight:700;font-size:11pt;color:#1a1a2e;margin:0">${escapeHtml(name || p.url)}</p>
          <p style="font-size:7.5pt;color:#888888;margin:2pt 0 0;word-break:break-all">${escapeHtml(p.url ?? '')}</p>
        </div>
        <p style="color:#f57c00;font-style:italic;font-size:8.5pt">Page could not be loaded (${escapeHtml(p.loadStatus ?? 'unknown')})</p>
      </section>`;
    }

    const issues  = p.issues ?? [];
    const shot    = p.screenshot?.path ? embedAsDataUri(p.screenshot.path) : null;
    const shotW   = p.screenshot?.width;
    const shotH   = p.screenshot?.height;

    return `
    <section class="page-break">
      <div style="border-bottom:2px solid #191D88;padding-bottom:8pt;margin-bottom:14pt">
        <p style="font-weight:700;font-size:11pt;color:#1a1a2e;margin:0">${escapeHtml(name || p.url)}</p>
        <p style="font-size:7.5pt;color:#888888;margin:2pt 0 0;word-break:break-all">${escapeHtml(p.url ?? '')}</p>
      </div>
      ${buildScreenshotHtml(shot, shotW, shotH, issues)}
      ${buildIssueOverlayTable(issues)}
    </section>`;
  }).join('');

  return heading + pageBlocks;
}

/* ─────────── site-wide issue list (used by Issues PDF — do not change) ─────────── */

function renderSiteWideIssues(issues, summary) {
  if (!issues || issues.length === 0) {
    return `<section class="page-break"><h2 class="section-heading">All Issues Across the Site</h2><p class="muted">No accessibility issues were found across the scanned pages.</p></section>`;
  }
  return `
  <section class="page-break">
    <h2 class="section-heading">All Issues Across the Site (${summary?.totalIssues ?? issues.length})</h2>
    <p class="muted">Every distinct issue across all pages, one entry per rule. Element counts span all pages and states.</p>
    ${issues.map((iss, i) => renderIssue(iss, i + 1, false)).join('')}
  </section>`;
}

/* ─────────── site-specific styles (added to baseStyles) ─────────── */

function siteStyles() {
  return `
    .per-page-wrap > .section-heading { margin-bottom: 4pt; }
    .page-block { margin-bottom: 18pt; }
    .pb-head { display: flex; gap: 12pt; align-items: flex-start; padding-bottom: 8pt; border-bottom: 1px solid #e0e0e0; margin-bottom: 12pt; page-break-inside: avoid; break-inside: avoid; }
    .pb-score { flex: 0 0 auto; width: 42pt; height: 42pt; border-radius: 50%; border: 3pt solid; display: flex; align-items: center; justify-content: center; font-size: 15pt; font-weight: 700; }
    .pb-score.score-ok   { border-color: #2e7d32; color: #2e7d32; }
    .pb-score.score-warn { border-color: #f57c00; color: #f57c00; }
    .pb-score.score-bad  { border-color: #c62828; color: #c62828; }
    .pb-headtext { flex: 1; min-width: 0; }
    .pb-title { font-size: 11pt; font-weight: 700; margin: 0; word-break: break-all; line-height: 1.2; color: #1a1a2e; }
    .pb-url { font-size: 7.5pt; color: #888888; margin: 2pt 0; word-break: break-all; }
    .pb-counts { font-size: 8.5pt; color: #555555; margin: 3pt 0 0; }
    .pb-counts .c-crit { color: #c62828; font-weight: 700; }
    .pb-counts .c-ser  { color: #e65100; font-weight: 700; }
    .pb-counts .c-mod  { color: #b45309; font-weight: 700; }
    .pb-counts .c-min  { color: #00796b; font-weight: 700; }
    .pb-shot { margin-bottom: 14pt; text-align: center; }
    .pb-shot-label { font-size: 8pt; color: #888888; margin: 0 0 5pt; text-align: left; }
    .pb-screenshot { max-height: 560pt; width: auto; max-width: 100%; height: auto; margin: 0 auto; display: block; }
    .pb-issues-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #1a1a2e; margin: 14pt 0 8pt; border-bottom: 1px solid #e0e0e0; padding-bottom: 4pt; }
    .pp-failed { color: #f57c00; font-style: italic; margin: 4pt 0 0; font-size: 8.5pt; }

    .howto { background: #f5f5f5; border-left: 3px solid #191D88; border-radius: 0 5pt 5pt 0; padding: 10pt 14pt; margin-bottom: 16pt; }
    .howto .section-heading { color: #191D88; border-color: #e0e0e0; margin-top: 0; }
    .howto p { font-size: 8.5pt; color: #444444; margin: 0; line-height: 1.6; }

    .summary-table { margin-top: 8pt; }
    .summary-table th.st-num { text-align: right; }
    .summary-table td.st-issue { width: 52%; }
    .summary-table td.st-num { text-align: right; white-space: nowrap; color: #555555; }
  `;
}
