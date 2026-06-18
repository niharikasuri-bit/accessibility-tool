/**
 * PDF report generator.
 *
 * Renders a print-friendly HTML version of the FriendlyReport, then uses
 * Playwright's Chromium to print-to-PDF. The visual design mirrors the
 * on-screen ScanReport page: DIGIT blue (#191D88) header, KPI score cards,
 * severity KPI boxes, and a left-border issue table.
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

/**
 * @param {object} input
 * @param {string} input.scanId
 * @param {object} input.request - The (redacted) scan request
 * @param {object} input.report  - The FriendlyReport object
 * @param {string} [input.screenshotPath] - Absolute path to the screenshot PNG
 * @returns {Promise<Buffer>} - The PDF bytes
 */
export async function renderReportPdf({ scanId, request, report, screenshotPath, projectName }) {
  const name = projectName || extractHostname(request?.url);
  const date = formatPdfDate(new Date());
  const html = renderHtml({ scanId, request, report, screenshotPath, projectName: name, date });
  return _printPdf(html);
}

export async function renderIssuesPdf({ scanId, request, report, projectName }) {
  const name = projectName || extractHostname(request?.url);
  const date = formatPdfDate(new Date());
  const html = renderIssuesOnlyHtml({ scanId, request, report, projectName: name, date });
  return _printPdf(html);
}

export async function renderPagewisePdf({ scanId, request, report, projectName }) {
  const name = projectName || extractHostname(request?.url);
  const date = formatPdfDate(new Date());
  const html = renderPagewiseHtml({ scanId, request, report, projectName: name, date });
  return _printPdf(html);
}

/**
 * Unresolved Issues PDF — only generated if unresolvedIssues is non-empty.
 * Returns null (not a buffer) when there are no unresolved issues so callers
 * can skip uploading and omit the CTA.
 */
export async function renderUnresolvedIssuesPdf({ scanId, request, report, projectName, unresolvedIssues, history }) {
  if (!unresolvedIssues || unresolvedIssues.length === 0) return null;
  const name = projectName || extractHostname(request?.url);
  const date = formatPdfDate(new Date());
  const html = renderUnresolvedIssuesHtml({ projectName: name, date, unresolvedIssues, history, report });
  return _printPdf(html);
}

/**
 * Type 2 (subsequent) full-report PDF — includes comparison sections using
 * the scan history stored after each successful email send.
 */
export async function renderReportPdfSubsequent({ scanId, request, report, projectName, history }) {
  const name = projectName || extractHostname(request?.url);
  const date = formatPdfDate(new Date());
  const html = renderReportHtmlSubsequent({ request, report, projectName: name, date, history });
  return _printPdf(html);
}

const _footerTemplate =
  '<div style="width:100%;padding:0 14mm;box-sizing:border-box;text-align:right;' +
  'font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#aaaaaa">' +
  'Page <span class="pageNumber"></span></div>';

async function _printPdf(html) {
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
      footerTemplate: _footerTemplate,
      margin: { top: '12mm', bottom: '14mm', left: '0', right: '0' },
      preferCSSPageSize: false,
    });
  } finally {
    await browser.close();
  }
}

/* ─────────── HTML composition ─────────── */

function renderIssuesOnlyHtml({ scanId, request, report, projectName, date }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Issues Report &mdash; ${escapeHtml(request.url)}</title>
<style>${baseStyles()}</style>
</head>
<body>
  ${pdfFirstPageHeading(projectName, date)}
  <div class="content">
    <section>
      ${renderIssueTable(report.issues, report.summary)}
    </section>
    <footer class="ftr">DIGIT Accessibility Scanner &nbsp;&middot;&nbsp; Built on Playwright + axe-core</footer>
  </div>
</body>
</html>`;
}

function renderPagewiseHtml({ scanId, request, report, projectName, date }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Page-wise Report &mdash; ${escapeHtml(request.url)}</title>
<style>${baseStyles()}</style>
</head>
<body>
  ${pdfFirstPageHeading(projectName, date)}
  <div class="content">
    ${renderSinglePageTable(request, report)}
    <footer class="ftr">DIGIT Accessibility Scanner &nbsp;&middot;&nbsp; Built on Playwright + axe-core</footer>
  </div>
</body>
</html>`;
}

function renderSinglePageTable(request, report) {
  const s = report.summary ?? {};
  const score = report.score ?? 0;
  const scoreColor = score >= 90 ? '#2e7d32' : score >= 70 ? '#f57c00' : '#c62828';
  const th = (label, w, align) => {
    const s = [align === 'center' ? 'text-align:center' : '', w ? 'width:' + w : ''].filter(Boolean).join(';');
    return `<th${s ? ' style="' + s + '"' : ''}>${label}</th>`;
  };
  return `
  <section>
    <h2 class="section-heading">Page-wise Detail</h2>
    <table class="data-table">
      <thead>
        <tr>
          ${th('Page URL',  null,   'left')}
          ${th('Score',     '46pt')}
          ${th('Total',     '52pt')}
          ${th('Severe',    '42pt')}
          ${th('High',      '38pt')}
          ${th('Medium',    '46pt')}
          ${th('Low',       '34pt')}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="font-family:'Courier New',monospace;font-size:7.5pt;color:#333333;word-break:break-all">${escapeHtml(request.url)}</td>
          <td style="text-align:center;font-weight:700;color:${scoreColor};font-size:12pt">${score}</td>
          <td style="text-align:center;font-weight:700;color:#333333">${s.totalIssues ?? 0}</td>
          <td style="text-align:center;font-weight:700;color:#c62828">${s.critical ?? 0}</td>
          <td style="text-align:center;font-weight:700;color:#e65100">${s.serious ?? 0}</td>
          <td style="text-align:center;font-weight:700;color:#b45309">${s.moderate ?? 0}</td>
          <td style="text-align:center;font-weight:700;color:#00796b">${s.minor ?? 0}</td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

/* ─────────── Section divider ─────────── */

export function renderSectionDivider() {
  return `<hr style="border:none;border-top:1px solid #e0e0e0;margin:8pt 0 24pt" />`;
}

/* ─────────── Section 1: How to Read ─────────── */

export function renderHowToReadSection(score) {
  const fixed = 'This report summarises the accessibility audit findings for your website. The Accessibility Score reflects overall compliance health. Compliance Detail shows how well your site meets each standard. The Severity Snapshot breaks down issues by urgency. Use the Page-wise table to drill into individual pages, and the Issue List to explore, filter, and prioritise fixes.';
  const contextual = score >= 90
    ? 'This page/site is performing well. Keep monitoring for regressions.'
    : score >= 70
    ? 'This page has some important issues that make it hard to use for people with disabilities. Fixing the top issues will make a big difference.'
    : 'This page/site has critical accessibility issues that block users with disabilities. Immediate fixes are recommended.';
  return `
  <section class="no-break">
    <h2 class="section-heading">How to Read This Report</h2>
    <p style="font-size:9pt;color:#333333;margin:10pt 0 8pt;line-height:1.6">${fixed}</p>
    <table style="border-collapse:separate;border-spacing:6pt 0;margin-bottom:8pt">
      <tr>
        <td style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4pt;padding:4pt 12pt;white-space:nowrap">
          <span style="font-size:7.5pt;font-weight:700;color:#2e7d32">Excellent</span><span style="font-size:7.5pt;color:#2e7d32;opacity:0.75"> &nbsp;90–100</span>
        </td>
        <td style="background:#fff8e1;border:1px solid #ffe082;border-radius:4pt;padding:4pt 12pt;white-space:nowrap">
          <span style="font-size:7.5pt;font-weight:700;color:#f57c00">Moderate</span><span style="font-size:7.5pt;color:#f57c00;opacity:0.75"> &nbsp;70–89</span>
        </td>
        <td style="background:#ffebee;border:1px solid #ef9a9a;border-radius:4pt;padding:4pt 12pt;white-space:nowrap">
          <span style="font-size:7.5pt;font-weight:700;color:#c62828">Poor</span><span style="font-size:7.5pt;color:#c62828;opacity:0.75"> &nbsp;0–69</span>
        </td>
      </tr>
    </table>
    <p style="font-size:8.5pt;color:#555555;margin:0;font-style:italic;line-height:1.5">${contextual}</p>
  </section>`;
}

/* ─────────── Section 2: Accessibility Snapshot ─────────── */

export function renderSnapshotSection(report) {
  const score    = report.score ?? report.overallScore ?? 0;
  const s        = report.summary ?? {};
  const scoreCol = score >= 90 ? '#2e7d32' : score >= 70 ? '#f57c00' : '#c62828';
  const band     = score >= 90 ? 'Excellent' : score >= 70 ? 'Moderate' : 'Poor';
  const bandBg   = score >= 90 ? '#e8f5e9'  : score >= 70 ? '#fff3e0'  : '#ffebee';
  return `
  <section class="no-break">
    <h2 class="section-heading">Accessibility Snapshot</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:8pt;page-break-inside:avoid;break-inside:avoid">
      <tr>
        <td style="background:#fff;border:1px solid #e0e0e0;border-left:4px solid ${scoreCol};border-radius:6pt;padding:14pt 16pt;vertical-align:top;width:50%">
          <p style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666666;margin:0 0 6pt">Accessibility Score</p>
          <p style="font-size:22pt;font-weight:700;color:${scoreCol};line-height:1.1;margin:0 0 4pt">${score}<span style="font-size:9pt;font-weight:400;color:#888888"> / 100</span></p>
          <p style="margin:0"><span style="display:inline-block;padding:2pt 8pt;background:${bandBg};color:${scoreCol};font-size:7.5pt;font-weight:700;border-radius:10pt">${band}</span></p>
        </td>
        <td style="background:#fff;border:1px solid #e0e0e0;border-left:3px solid #1a1a2e;border-radius:6pt;padding:14pt 16pt;vertical-align:top;width:50%">
          <p style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666666;margin:0 0 6pt">Total Issues</p>
          <p style="font-size:22pt;font-weight:700;color:#1a1a2e;line-height:1.1;margin:0 0 4pt">${s.totalIssues ?? 0}</p>
          <p style="font-size:8pt;color:#888888;margin:0">Found this scan</p>
        </td>
      </tr>
    </table>
  </section>`;
}

/* ─────────── Section 3: Compliance Detail (KPI cards) ─────────── */

export function renderComplianceCards(breakdown) {
  const standards = [
    { key: 'wcag',   badge: 'W3C',   name: 'WCAG 2.1',     desc: 'Web Content Accessibility Guidelines' },
    { key: 'gigw',   badge: 'IN',    name: 'GIGW',          desc: 'Guidelines for Indian Government Websites' },
    { key: 'sesmag', badge: 'EU/US', name: 'SesMag',        desc: 'Section 508 / EN 301 549 compatibility' },
    { key: 'ada',    badge: 'US',    name: 'ADA Title III', desc: 'Americans with Disabilities Act' },
  ];
  const cells = standards.map(({ key, badge, name, desc }) => {
    const d = breakdown?.[key];
    if (!d) return `
      <td style="background:#fff;border:1px solid #e0e0e0;border-radius:6pt;padding:14pt 16pt;vertical-align:top">
        <p style="font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888888;margin:0 0 2pt">${escapeHtml(badge)}</p>
        <p style="font-weight:700;font-size:9pt;color:#1a1a2e;margin:0 0 2pt;line-height:1.3">${escapeHtml(name)}</p>
        <p style="font-size:7.5pt;color:#888888;margin:0 0 10pt;line-height:1.4">${escapeHtml(desc)}</p>
        <p style="font-size:16pt;font-weight:700;color:#cccccc;margin:0;line-height:1">—</p>
        <p style="font-size:7.5pt;color:#bbbbbb;margin:4pt 0 0;font-style:italic">No data</p>
      </td>`;
    const pct = Math.round(d.compliancePercent ?? 0);
    const col = pct >= 90 ? '#2e7d32' : pct >= 70 ? '#f57c00' : '#c62828';
    return `
      <td style="background:#fff;border:1px solid #e0e0e0;border-radius:6pt;padding:14pt 16pt;vertical-align:top">
        <p style="font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888888;margin:0 0 2pt">${escapeHtml(badge)}</p>
        <p style="font-weight:700;font-size:9pt;color:#1a1a2e;margin:0 0 2pt;line-height:1.3">${escapeHtml(name)}</p>
        <p style="font-size:7.5pt;color:#888888;margin:0 0 10pt;line-height:1.4">${escapeHtml(desc)}</p>
        <p style="font-size:22pt;font-weight:700;color:${col};margin:0;line-height:1">${pct}%</p>
        <p style="font-size:7.5pt;color:#888888;margin:4pt 0 0">
          <span style="color:#2e7d32;font-weight:600">${d.rulesPassed ?? 0}</span> passed
          &nbsp;&middot;&nbsp;
          <span style="color:#c62828;font-weight:600">${d.rulesFailed ?? 0}</span> failed
        </p>
      </td>`;
  }).join('');
  return `
  <section class="no-break">
    <h2 class="section-heading">Standards Compliance</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:6pt;page-break-inside:avoid;break-inside:avoid">
      <tr>${cells}</tr>
    </table>
  </section>`;
}

function pdfDeltaBadge(delta, lowerIsBetter, unit, upLabel, downLabel) {
  const greyStyle = 'display:inline-block;padding:2pt 8pt;background:#f5f5f5;color:#616161;font-size:7.5pt;font-weight:700;border-radius:99pt;font-family:Arial,Helvetica,sans-serif';
  if (delta == null) return `<span style="${greyStyle}">First scan baseline</span>`;
  if (delta === 0)   return `<span style="${greyStyle}">Same as last scan</span>`;
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const bg    = improved ? '#e8f5e9' : '#ffebee';
  const color = improved ? '#2e7d32' : '#c62828';
  const sign  = delta > 0 ? '+' : '-';
  const absD  = Math.abs(delta);
  const label = delta > 0 ? upLabel : downLabel;
  const unitStr = unit ?? '';
  return `<span style="display:inline-block;padding:2pt 8pt;background:${bg};color:${color};font-size:7.5pt;font-weight:700;border-radius:99pt;font-family:Arial,Helvetica,sans-serif">${sign}${absD}${unitStr} (${label})</span>`;
}

function renderComplianceCardsComparison(breakdown, prevCompliance) {
  const standards = [
    { key: 'wcag',   badge: 'W3C',   name: 'WCAG 2.1',     desc: 'Web Content Accessibility Guidelines' },
    { key: 'gigw',   badge: 'IN',    name: 'GIGW',          desc: 'Guidelines for Indian Government Websites' },
    { key: 'sesmag', badge: 'EU/US', name: 'SesMag',        desc: 'Section 508 / EN 301 549 compatibility' },
    { key: 'ada',    badge: 'US',    name: 'ADA Title III', desc: 'Americans with Disabilities Act' },
  ];

  const buildCell = ({ key, badge, name, desc }) => {
    const d    = breakdown?.[key];
    const prev = prevCompliance?.[key];
    if (!d) return `
      <td style="width:50%;background:#fff;border:1px solid #e0e0e0;border-radius:6pt;padding:14pt 16pt;vertical-align:top">
        <p style="font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888888;margin:0 0 2pt">${escapeHtml(badge)}</p>
        <p style="font-weight:700;font-size:9pt;color:#1a1a2e;margin:0 0 2pt;line-height:1.3">${escapeHtml(name)}</p>
        <p style="font-size:7.5pt;color:#888888;margin:0 0 10pt;line-height:1.4">${escapeHtml(desc)}</p>
        <p style="font-size:16pt;font-weight:700;color:#cccccc;margin:0;line-height:1">—</p>
        <p style="font-size:7.5pt;color:#bbbbbb;margin:4pt 0 0;font-style:italic">No data</p>
      </td>`;
    const pct     = Math.round(d.compliancePercent ?? 0);
    const col     = pct >= 90 ? '#2e7d32' : pct >= 70 ? '#f57c00' : '#c62828';
    const prevPct = prev?.percentage ?? null;
    const delta   = prevPct != null ? pct - prevPct : null;
    const prevHtml = prevPct != null
      ? `<span style="font-size:9pt;font-weight:600;color:#999999">${prevPct}%</span><span style="font-size:9pt;color:#555555"> &#8594; </span>`
      : '';
    return `
      <td style="width:50%;background:#fff;border:1px solid #e0e0e0;border-radius:6pt;padding:14pt 16pt;vertical-align:top">
        <p style="font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888888;margin:0 0 2pt">${escapeHtml(badge)}</p>
        <p style="font-weight:700;font-size:9pt;color:#1a1a2e;margin:0 0 2pt;line-height:1.3">${escapeHtml(name)}</p>
        <p style="font-size:7.5pt;color:#888888;margin:0 0 8pt;line-height:1.4">${escapeHtml(desc)}</p>
        <p style="margin:0 0 4pt;line-height:1.2">${prevHtml}<span style="font-size:22pt;font-weight:700;color:${col}">${pct}%</span></p>
        <p style="font-size:7.5pt;color:#888888;margin:0 0 4pt">
          <span style="color:#2e7d32;font-weight:600">${d.rulesPassed ?? 0}</span> passed
          &nbsp;&middot;&nbsp;
          <span style="color:#c62828;font-weight:600">${d.rulesFailed ?? 0}</span> failed
        </p>
        ${pdfDeltaBadge(delta, false, '%', 'Increased', 'Decreased')}
      </td>`;
  };

  const row1 = `<tr>${buildCell(standards[0])}${buildCell(standards[1])}</tr>`;
  const row2 = `<tr>${buildCell(standards[2])}${buildCell(standards[3])}</tr>`;

  return `
  <section class="no-break">
    <h2 class="section-heading">Standards Compliance</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:6pt;page-break-inside:avoid;break-inside:avoid">
      ${row1}
      ${row2}
    </table>
  </section>`;
}

/* ─────────── Section 4: Severity Snapshot (KPI cards) ─────────── */

export function renderSeveritySnapshot(summary) {
  const s = summary ?? {};
  const card = (label, val, borderCol, textCol) => `
    <td style="background:#fff;border:1px solid #e0e0e0;border-left:3px solid ${borderCol};border-radius:6pt;padding:14pt 16pt;vertical-align:top">
      <p style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${textCol};margin:0 0 6pt">${label}</p>
      <p style="font-size:22pt;font-weight:700;color:${textCol};line-height:1.1;margin:0">${val}</p>
    </td>`;
  return `
  <section class="no-break">
    <h2 class="section-heading">Severity Snapshot</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:6pt;page-break-inside:avoid;break-inside:avoid">
      <tr>
        ${card('Severe', s.critical ?? 0, '#c62828', '#c62828')}
        ${card('High',   s.serious  ?? 0, '#e65100', '#e65100')}
        ${card('Medium', s.moderate ?? 0, '#f9a825', '#b45309')}
        ${card('Low',    s.minor    ?? 0, '#00796b', '#00796b')}
      </tr>
    </table>
  </section>`;
}

/* ─────────── Full report HTML composition ─────────── */

function renderHtml({ scanId, request, report, projectName, date }) {
  const score   = report.score ?? 0;
  const s       = report.summary ?? {};
  const pageRow = { url: request.url, name: pageName(request.url) || request.url, score, summary: s };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Accessibility Report — ${escapeHtml(request.url)}</title>
<style>${baseStyles()}</style>
</head>
<body>
  ${pdfFirstPageHeading(projectName, date)}
  <div class="content">
    ${renderHowToReadSection(score)}
    ${renderSnapshotSection(report)}
    ${renderComplianceCards(report.standardsBreakdown)}
    ${renderSeveritySnapshot(s)}
    ${renderPagewiseSectionForPdf([pageRow])}
    ${renderAllIssuesList(report.issues, report.summary, request.url)}
    <footer class="ftr">DIGIT Accessibility Scanner &nbsp;·&nbsp; Built on Playwright + axe-core</footer>
  </div>
</body>
</html>`;
}

/* ─────────── Metrics row (Section 1) ─────────── */

export function renderScoreBlock(report) {
  const score    = report.score ?? report.overallScore ?? 0;
  const s        = report.summary ?? {};
  const scoreCol = score >= 90 ? '#2e7d32' : score >= 70 ? '#f57c00' : '#c62828';
  const band     = score >= 90 ? 'Excellent' : score >= 70 ? 'Moderate' : 'Poor';
  const bandBg   = score >= 90 ? '#e8f5e9'  : score >= 70 ? '#fff3e0'  : '#ffebee';

  const sev = (borderCol, textCol, label, val) => `
    <td style="background:#fff;border:1px solid #e0e0e0;border-left:3px solid ${borderCol};border-radius:6pt;padding:12pt 14pt;vertical-align:top">
      <p style="font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${textCol};margin:0 0 5pt">${label}</p>
      <p style="font-size:20pt;font-weight:700;color:${textCol};line-height:1.1;margin:0">${val}</p>
    </td>`;

  return `
  <section style="margin-bottom:28pt">
    <table style="width:100%;border-collapse:separate;border-spacing:6pt;page-break-inside:avoid;break-inside:avoid">
      <tr>
        <td style="background:#fff;border:1px solid #e0e0e0;border-left:4px solid ${scoreCol};border-radius:6pt;padding:12pt 16pt;vertical-align:top;width:26%">
          <p style="font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666666;margin:0 0 5pt">Accessibility Score</p>
          <p style="font-size:22pt;font-weight:700;color:${scoreCol};line-height:1.1;margin:0 0 4pt">${score}<span style="font-size:9pt;font-weight:400;color:#888888"> / 100</span></p>
          <p style="margin:0"><span style="display:inline-block;padding:2pt 8pt;background:${bandBg};color:${scoreCol};font-size:7.5pt;font-weight:700;border-radius:10pt">${band}</span></p>
        </td>
        <td style="background:#fff;border:1px solid #e0e0e0;border-left:3px solid #1a1a2e;border-radius:6pt;padding:12pt 16pt;vertical-align:top;width:22%">
          <p style="font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666666;margin:0 0 5pt">Total Issues</p>
          <p style="font-size:22pt;font-weight:700;color:#1a1a2e;line-height:1.1;margin:0 0 4pt">${s.totalIssues ?? 0}</p>
          <p style="font-size:7.5pt;color:#888888;margin:0">Found this scan</p>
        </td>
        ${sev('#c62828', '#c62828', 'Severe', s.critical ?? 0)}
        ${sev('#e65100', '#e65100', 'High',   s.serious  ?? 0)}
        ${sev('#b45309', '#b45309', 'Medium', s.moderate ?? 0)}
        ${sev('#00796b', '#00796b', 'Low',    s.minor    ?? 0)}
      </tr>
    </table>
  </section>`;
}

/* ─────────── Compliance Detail (Section 3) ─────────── */

export function renderStandards(breakdown) {
  if (!breakdown) return '';
  const standards = [
    { key: 'wcag',   name: 'WCAG 2.1',      desc: 'W3C Web Content Accessibility Guidelines' },
    { key: 'gigw',   name: 'GIGW',           desc: 'Guidelines for Indian Government Websites' },
    { key: 'sesmag', name: 'SesMag',         desc: 'Section 508 / EN 301 549' },
    { key: 'ada',    name: 'ADA Title III',  desc: 'Americans with Disabilities Act' },
  ];

  const rows = standards.map(({ key, name, desc }, i) => {
    const d = breakdown[key];
    const rowBg = i % 2 === 0 ? '#fff' : '#f9f9f9';
    if (!d) {
      return `<tr>
        <td style="font-weight:700;font-size:8.5pt;white-space:nowrap">${escapeHtml(name)}</td>
        <td style="font-size:8pt;color:#555555">${escapeHtml(desc)}</td>
        <td colspan="4" style="text-align:center;color:#bbbbbb;font-style:italic;font-size:8pt">No data</td>
      </tr>`;
    }
    const pct   = Math.round(d.compliancePercent ?? 0);
    const color = pct >= 90 ? '#2e7d32' : pct >= 70 ? '#f57c00' : '#c62828';
    return `<tr>
      <td style="font-weight:700;font-size:8.5pt;white-space:nowrap">${escapeHtml(name)}</td>
      <td style="font-size:8pt;color:#555555">${escapeHtml(desc)}</td>
      <td style="text-align:center;font-weight:700;font-size:13pt;color:${color}">${pct}%</td>
      <td style="text-align:center;font-weight:700;color:#2e7d32">${d.rulesPassed ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:#c62828">${d.rulesFailed ?? 0}</td>
      <td style="text-align:center;color:#888888">${d.totalRulesChecked ?? 0}</td>
    </tr>`;
  }).join('');

  return `
  <section>
    <h2 class="section-heading">Compliance Detail</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Standard</th>
          <th>Description</th>
          <th style="text-align:center;width:60pt">% Compliant</th>
          <th style="text-align:center;width:45pt">Passed</th>
          <th style="text-align:center;width:45pt">Failed</th>
          <th style="text-align:center;width:45pt">of Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

/* ─────────── Warnings ─────────── */

function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) return '';
  return `
  <section class="warnings-section">
    <h2 class="section-heading">Scanner Notes</h2>
    <ul>
      ${warnings.map((w) => `
        <li><strong>${escapeHtml(w.code)}:</strong> ${escapeHtml(w.message)}</li>
      `).join('')}
    </ul>
  </section>`;
}

/* ─────────── Priority issues (Start here) ─────────── */

export function renderStartHere(startHere) {
  if (!startHere || startHere.length === 0) return '';
  return `
  <section>
    <h2 class="section-heading">Priority Issues — Start Here</h2>
    ${startHere.map((iss, i) => renderIssue(iss, i + 1, true)).join('')}
  </section>`;
}

/* ─────────── Issue table ─────────── */

function renderIssueTable(issues, summary) {
  if (!issues || issues.length === 0) {
    return `
    <section>
      <h2 class="section-heading">Issue List</h2>
      <p class="muted">No accessibility issues were found on this page.</p>
    </section>`;
  }
  return `
  <section>
    <h2 class="section-heading">Issue List (${summary?.totalIssues ?? issues.length})</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Issue Title</th>
          <th class="col-sev">Severity</th>
          <th class="col-comp">Affected Page</th>
          <th class="col-rule">Compliance Rule</th>
          <th class="col-fix">Recommended Fix</th>
        </tr>
      </thead>
      <tbody>
        ${issues.map((iss) => renderIssueRow(iss)).join('')}
      </tbody>
    </table>
    <p class="table-footer">Sorted by severity &nbsp;·&nbsp; ${issues.length} issues total</p>
  </section>`;
}

function renderIssueRow(iss) {
  const tone      = severityTone(iss.severity);
  const pillClass = { crit: 'pill-crit', ser: 'pill-ser', mod: 'pill-mod', min: 'pill-min' }[tone];
  const sevLabel  = { crit: 'Severe', ser: 'High', mod: 'Medium', min: 'Low' }[tone];
  const rawUrl    = iss.pageUrl ?? iss.url ?? '';
  let pagePath    = rawUrl;
  try { pagePath  = new URL(rawUrl).pathname || rawUrl; } catch {}
  const display   = pagePath.length > 38 ? pagePath.slice(0, 35) + '…' : pagePath || 'Unknown Page';
  const standards = renderStandardsForIssue(iss.standards);
  return `
  <tr>
    <td class="td-title">${escapeHtml(iss.icon ?? '')} ${escapeHtml(iss.title ?? '')}</td>
    <td class="td-sev"><span class="pill ${pillClass}">${sevLabel}</span></td>
    <td class="td-comp">${escapeHtml(display)}</td>
    <td class="td-rule">${standards || '—'}</td>
    <td class="td-fix">
      <div class="fix-box">
        <p class="fix-label">Fix</p>
        <p class="fix-text">${escapeHtml(iss.whatYouCanDo ?? '')}</p>
      </div>
    </td>
  </tr>`;
}

/* ─────────── Shared helpers for full report sections 2–6 ─────────── */

export function pageName(url) {
  if (!url) return '';
  try {
    const p = new URL(url).pathname;
    const seg = p.split('/').filter(Boolean);
    return seg.length ? seg[seg.length - 1] : '(Home)';
  } catch {
    return String(url).split('/').pop().split('?')[0] || url;
  }
}

export function renderHowToReadForPdf(isSite, pageCount) {
  const text = isSite
    ? `The score above is the average across all ${pageCount ?? '?'} pages — 90+ is excellent, 70–89 is moderate, below 70 needs work. Issues are grouped by severity: <strong>Severe</strong> blocks some users entirely (fix first), <strong>High</strong> makes pages hard to use, <strong>Medium</strong> and <strong>Low</strong> are smaller improvements. The page table shows per-page counts; the screenshot section marks each issue on the corresponding page. The complete issue list below collects every distinct rule once across all pages.`
    : `The score above reflects how well this page meets accessibility guidelines — 90+ is excellent, 70–89 is moderate, below 70 needs work. Issues are grouped by severity: <strong>Severe</strong> blocks some users entirely (fix first), <strong>High</strong> makes pages hard to use, <strong>Medium</strong> and <strong>Low</strong> are smaller improvements. The screenshot section marks each issue's location on the page.`;
  return `
  <section style="background:#f5f5f5;border-left:3px solid #191D88;border-radius:0 5pt 5pt 0;padding:10pt 14pt">
    <h2 style="font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#191D88;margin:0 0 5pt;border:none;padding:0">How to Read This Report</h2>
    <p style="font-size:8.5pt;color:#444444;margin:0;line-height:1.6">${text}</p>
  </section>`;
}

function pageStatusBadge(score) {
  if (score >= 90) return `<span style="background:#e8f5e9;color:#2e7d32;border-radius:3pt;padding:2pt 6pt;font-size:7pt;font-weight:700">Pass</span>`;
  if (score >= 70) return `<span style="background:#fff8e1;color:#f57c00;border-radius:3pt;padding:2pt 6pt;font-size:7pt;font-weight:700">Review</span>`;
  return `<span style="background:#ffebee;color:#c62828;border-radius:3pt;padding:2pt 6pt;font-size:7pt;font-weight:700">Needs Work</span>`;
}

export function renderPagewiseSectionForPdf(pageRows) {
  const th = (label, w, align) => {
    const s = [align === 'center' ? 'text-align:center' : '', w ? 'width:' + w : ''].filter(Boolean).join(';');
    return `<th${s ? ' style="' + s + '"' : ''}>${label}</th>`;
  };

  const rows = pageRows.map((p, i) => {
    const s    = p.summary ?? {};
    const sc   = p.score ?? 0;
    const name = p.name || pageName(p.url) || p.url;
    const bg   = i % 2 === 0 ? '#fff' : '#f9f9f9';
    return `
    <tr>
      <td>
        <p style="font-weight:700;margin:0;font-size:8.5pt;color:#1a1a2e">${escapeHtml(name)}</p>
        <p style="color:#888888;font-size:7pt;margin:2pt 0 0;font-family:'Courier New',monospace;word-break:break-all">${escapeHtml(p.url || '')}</p>
      </td>
      <td style="text-align:center;font-weight:700;color:#333333">${s.totalIssues ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:#c62828">${s.critical ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:#e65100">${s.serious ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:#b45309">${s.moderate ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:#00796b">${s.minor ?? 0}</td>
      <td style="text-align:center">${pageStatusBadge(sc)}</td>
    </tr>`;
  }).join('');

  return `
  <section>
    <h2 class="section-heading">Page-wise Detail</h2>
    <table class="data-table">
      <thead>
        <tr>
          ${th('Page Name',   null,   'left')}
          ${th('Total',       '52pt')}
          ${th('Severe',      '42pt')}
          ${th('High',        '38pt')}
          ${th('Medium',      '46pt')}
          ${th('Low',         '34pt')}
          ${th('Status',      '70pt')}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

export function renderAllIssuesList(issues, summary, defaultPageUrl) {
  if (!issues || issues.length === 0) {
    return `
    <section>
      <h2 class="section-heading">Issue List</h2>
      <p class="muted">No accessibility issues were found.</p>
    </section>`;
  }
  const rows = issues.map((iss, i) => renderAllIssuesRow(iss, defaultPageUrl, i)).join('');
  return `
  <section>
    <h2 class="section-heading">Issue List (${summary?.totalIssues ?? issues.length})</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Issue Title</th>
          <th style="width:54pt">Severity</th>
          <th style="width:100pt">Affected Page</th>
          <th style="width:80pt">Compliance Rule</th>
          <th style="width:130pt">Recommended Fix</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="table-footer">Sorted: Severe &rarr; High &rarr; Medium &rarr; Low &nbsp;&middot;&nbsp; ${issues.length} issues</p>
  </section>`;
}

function renderAllIssuesRow(iss, defaultPageUrl, rowIndex) {
  const tone      = severityTone(iss.severity);
  const pillClass = { crit: 'pill-crit', ser: 'pill-ser', mod: 'pill-mod', min: 'pill-min' }[tone];
  const sevLabel  = { crit: 'Severe',    ser: 'High',     mod: 'Medium',   min: 'Low'     }[tone];
  const rawUrl    = iss.pageUrl ?? iss.url ?? defaultPageUrl ?? '';
  let pagePath = rawUrl;
  try { pagePath = new URL(rawUrl).pathname || rawUrl; } catch {}
  const standards = renderStandardsForIssue(iss.standards);
  return `
  <tr>
    <td class="td-title">${escapeHtml(iss.title ?? '')}</td>
    <td><span class="pill ${pillClass}">${sevLabel}</span></td>
    <td style="font-size:7.5pt;vertical-align:top;color:#555555;word-break:break-all">
      ${escapeHtml(pagePath || 'Unknown Page')}
    </td>
    <td class="td-rule">${standards || '—'}</td>
    <td><div class="fix-box"><p class="fix-label">Fix</p><p class="fix-text">${escapeHtml(iss.whatYouCanDo ?? iss.fix ?? iss.description ?? '')}</p></div></td>
  </tr>`;
}

export function buildScreenshotHtml(shot, w, h, issues) {
  if (!shot) return `<p class="muted" style="font-style:italic;margin:10pt 0">No screenshot available.</p>`;

  if (w && h) {
    const boxes = (issues ?? []).flatMap((iss, idx) => {
      const color = severityColorForOverlay(iss.severity);
      return (iss.targets ?? []).slice(0, 10).map((t) => {
        if (!t.rect) return null;
        const { x = 0, y = 0, width: rw = 0, height: rh = 0 } = t.rect;
        if (!rw || !rh) return null;
        const lx = Math.max(x + 1, 0);
        const ly = y > 18 ? y - 4 : y + rh;
        return `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${color}1a" stroke="${color}" stroke-width="3" rx="2"/>
<rect x="${lx}" y="${Math.max(y, 0)}" width="18" height="18" fill="${color}" rx="3"/>
<text x="${lx + 9}" y="${Math.max(y, 0) + 13}" fill="#fff" font-size="11" font-weight="bold" font-family="Arial,sans-serif" text-anchor="middle">${idx + 1}</text>`;
      }).filter(Boolean);
    }).join('\n');

    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;border:1pt solid #e2e8f0;border-radius:4pt;margin-bottom:14pt" xmlns="http://www.w3.org/2000/svg">
  <image href="${shot}" x="0" y="0" width="${w}" height="${h}"/>
  ${boxes}
</svg>`;
  }

  return `<img src="${shot}" style="max-width:100%;border:1pt solid #e2e8f0;border-radius:4pt;margin-bottom:14pt;display:block" alt="Page screenshot"/>`;
}

export function buildIssueOverlayTable(issues) {
  if (!issues || issues.length === 0) {
    return `<p class="muted">No accessibility issues found on this page.</p>`;
  }
  const rows = issues.map((iss, i) => {
    const tone      = severityTone(iss.severity);
    const border    = { crit: '#c62828', ser: '#e65100', mod: '#f9a825', min: '#00796b' }[tone];
    const pillClass = { crit: 'pill-crit', ser: 'pill-ser', mod: 'pill-mod', min: 'pill-min' }[tone];
    const sevLabel  = { crit: 'Severe',    ser: 'High',    mod: 'Medium',   min: 'Low'   }[tone];
    const rawUrl    = iss.pageUrl ?? iss.url ?? '';
    let pagePath    = rawUrl;
    try { pagePath  = new URL(rawUrl).pathname || rawUrl; } catch {}
    const display   = pagePath.length > 55 ? pagePath.slice(0, 52) + '…' : pagePath || 'Unknown Page';
    return `
    <tr style="border-left:3px solid ${border}">
      <td style="text-align:center;font-weight:700;color:#555555;font-size:10pt">${i + 1}</td>
      <td style="font-weight:600;color:#1a1a2e">${escapeHtml(iss.title ?? iss.ruleId ?? '')}</td>
      <td><span class="pill ${pillClass}">${sevLabel}</span></td>
      <td style="font-size:7.5pt;color:#555555;word-break:break-all">${escapeHtml(display)}</td>
    </tr>`;
  }).join('');

  return `
  <table class="data-table" style="margin-top:10pt">
    <thead>
      <tr>
        <th style="text-align:center;width:28pt">#</th>
        <th>Issue Title</th>
        <th style="width:60pt">Severity</th>
        <th style="width:140pt">Affected Page</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function severityColorForOverlay(severity) {
  switch (severity) {
    case 'Needs Immediate Fix': return '#c62828';
    case 'Important':           return '#e65100';
    case 'Can Improve':         return '#f9a825';
    case 'Minor':               return '#00796b';
    default:                    return '#888888';
  }
}

/* ─────────── Individual issue card (used by site-pdf.js) ─────────── */

export function renderIssue(issue, idx, isPriority) {
  const tone = severityTone(issue.severity);
  const borderColor = { crit: '#c62828', ser: '#e65100', mod: '#f9a825', min: '#00796b' }[tone];
  const pillClass   = { crit: 'pill-crit', ser: 'pill-ser', mod: 'pill-mod', min: 'pill-min' }[tone];
  const sevLabel    = { crit: 'Severe', ser: 'High', mod: 'Medium', min: 'Low' }[tone];
  const standards = renderStandardsForIssue(issue.standards);
  return `
  <article class="issue-card" style="border-left-color:${borderColor}">
    <div class="issue-header">
      <span class="pill ${pillClass}">${sevLabel}</span>
      ${isPriority ? `<span class="priority-idx">#${idx}</span>` : ''}
      <h3 class="issue-title">${escapeHtml(issue.icon ?? '')} ${escapeHtml(issue.title ?? '')}</h3>
    </div>
    <p class="issue-impact"><strong>Impact:</strong> ${escapeHtml(issue.whyItMatters ?? '')}</p>
    <div class="fix-box">
      <p class="fix-label">Recommended Fix</p>
      <p class="fix-text">${escapeHtml(issue.whatYouCanDo ?? '')}</p>
    </div>
    ${standards ? `<p class="standards-line">${standards}</p>` : ''}
    ${(issue.targets && issue.targets.length > 0) ? `
    <details>
      <summary>${issue.targets.length} affected element${issue.targets.length === 1 ? '' : 's'}</summary>
      <ul class="targets">
        ${issue.targets.slice(0, 20).map((t) => `<li><code>${escapeHtml(t.selector ?? '')}</code></li>`).join('')}
        ${issue.targets.length > 20 ? `<li class="muted">&hellip; and ${issue.targets.length - 20} more</li>` : ''}
      </ul>
    </details>` : ''}
  </article>`;
}

/* ─────────── helpers ─────────── */

function renderStandardsForIssue(standards) {
  if (!standards) return '';
  const parts = [];
  for (const key of ['wcag', 'gigw', 'sesmag', 'ada']) {
    const refs = standards[key];
    if (refs && refs.length > 0) {
      parts.push(`<strong>${key.toUpperCase()}:</strong> ${escapeHtml(refs.join(' · '))}`);
    }
  }
  return parts.join(' &nbsp;&middot;&nbsp; ');
}

function severityTone(severity) {
  switch (severity) {
    case 'Needs Immediate Fix': return 'crit';
    case 'Important':           return 'ser';
    case 'Can Improve':         return 'mod';
    case 'Minor':               return 'min';
    default:                    return 'min';
  }
}

/* ─────────── utilities ─────────── */

function extractHostname(url) {
  try { return new URL(url).hostname; } catch { return url || 'Accessibility Report'; }
}

export function formatPdfDate(d) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ist  = new Date(d.getTime() + 19800000); // UTC+5:30
  const day  = ist.getUTCDate();
  const mon  = MONTHS[ist.getUTCMonth()];
  const yr   = ist.getUTCFullYear();
  let h      = ist.getUTCHours();
  const m    = String(ist.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${day} ${mon} ${yr}, ${h}:${m} ${ampm} IST`;
}

export function pdfFirstPageHeading(projectName, date) {
  const len = (projectName || '').length;
  // A4 = 210mm; 40% = 84mm ≈ 238pt. Arial avg char width ≈ 0.55 × fontSize (pt).
  // Thresholds: 12pt→36 chars, 11pt→39, 10pt→43, 9pt→48, 8pt→54
  const fontSize =
    len <= 36 ? '12pt' :
    len <= 39 ? '11pt' :
    len <= 43 ? '10pt' :
    len <= 48 ? '9pt'  : '8pt';
  return (
    `<div class="fph-wrap">` +
    `<span class="fph-name" style="font-size:${fontSize}">${escapeHtml(projectName)}</span>` +
    `<span class="fph-subtitle">Accessibility Report</span>` +
    `<span class="fph-date">${escapeHtml(date)}</span>` +
    `</div>`
  );
}

export function pdfCompactHeader(projectName, date) {
  return (
    `<div class="chdr-wrap">` +
    `<span class="chdr-left">${escapeHtml(projectName)}</span>` +
    `<span class="chdr-right">Accessibility Report &nbsp;&middot;&nbsp; ${escapeHtml(date)}</span>` +
    `</div>`
  );
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function embedAsDataUri(filePath) {
  try {
    const bytes = readFileSync(filePath);
    const ext   = extname(filePath).toLowerCase();
    const mime  = ext === '.png' ? 'image/png'
                : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
                : 'application/octet-stream';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/* ─────────── styles ─────────── */

export function baseStyles() {
  return `
    * { box-sizing: border-box; }
    @page:first { margin-top: 0; }

    /* ── First-page header (page 1 only — not fixed, not repeated) ── */
    .fph-wrap { background: #191D88; width: 100%; height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; box-sizing: border-box; position: relative; z-index: 2; gap: 10px; }
    .fph-name { color: #fff; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1 1 0; min-width: 0; max-width: 60%; }
    .fph-subtitle { color: rgba(255,255,255,0.9); font-size: 10pt; font-weight: normal; white-space: nowrap; flex-shrink: 0; }
    .fph-date { color: rgba(255,255,255,0.7); font-size: 9pt; white-space: nowrap; flex-shrink: 0; }

    /* ── Base ── */
    body { font-family: Arial, Helvetica, sans-serif; color: #333333; line-height: 1.5; padding: 0; margin: 0; font-size: 9pt; }
    code { font-family: 'Courier New', Courier, monospace; font-size: 0.85em; }
    .muted { color: #888888; }
    .content { padding: 18pt 14mm 14pt; }

    /* ── Sections ── */
    section { margin-bottom: 28pt; orphans: 3; widows: 3; }
    .section-heading { font-size: 10.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #1a1a2e; margin: 0 0 10pt; padding-bottom: 8pt; border-bottom: 1px solid #d0d0d0; page-break-after: avoid; break-after: avoid; }
    .no-break { page-break-inside: avoid; break-inside: avoid; }
    thead { display: table-header-group; }

    /* ── Data tables (Issue List, Compliance, Page-wise) ── */
    .data-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; border: 1px solid #cbd5e1; }
    .data-table thead tr { background: #f8fafc; }
    .data-table th { color: #64748b; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 10px 14px; text-align: left; border-bottom: 2px solid #cbd5e1; }
    .data-table th:not(:last-child) { border-right: 1px solid #cbd5e1; }
    .data-table td { padding: 10px 14px; border-bottom: 1px solid #cbd5e1; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; }
    .data-table td:not(:last-child) { border-right: 1px solid #cbd5e1; }
    .data-table tbody tr:nth-child(even) td { background: #f8fafc; }
    .data-table tr { page-break-inside: avoid; }
    .col-sev { width: 54pt; }
    .col-comp { width: 78pt; }
    .col-rule { width: 85pt; }
    .col-fix { width: 120pt; }
    .td-title { font-weight: 600; color: #1a1a2e; }
    .td-comp code { font-size: 7pt; color: #555555; word-break: break-all; }
    .td-rule { font-size: 8pt; color: #555555; }
    .table-footer { font-size: 7.5pt; color: #888888; text-align: right; margin-top: 6pt; }

    /* ── Severity pills ── */
    .pill { display: inline-block; padding: 2pt 5pt; border-radius: 3pt; font-size: 6.5pt; font-weight: 700; }
    .pill-crit { background: #c62828; color: #fff; }
    .pill-ser  { background: #e65100; color: #fff; }
    .pill-mod  { background: #f9a825; color: #333333; }
    .pill-min  { background: #00796b; color: #fff; }

    /* ── Issue cards (site-pdf) ── */
    .issue-card { background: #fff; border: 1px solid #e8e8e8; border-left-width: 3px; border-radius: 0 5pt 5pt 0; padding: 12pt 14pt; margin-bottom: 8pt; page-break-inside: avoid; }
    .issue-header { display: flex; align-items: center; gap: 6pt; flex-wrap: wrap; margin-bottom: 5pt; }
    .issue-title { font-size: 9pt; font-weight: 600; color: #1a1a2e; margin: 0; }
    .issue-impact { font-size: 8.5pt; color: #444444; margin: 3pt 0 6pt; }
    .priority-idx { color: #888888; font-size: 7.5pt; }

    /* ── Fix box ── */
    .fix-box { background: #f1fdf4; border-left: 2px solid #4caf50; border-radius: 0 4pt 4pt 0; padding: 8pt 12pt; margin: 6pt 0; }
    .fix-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; color: #2e7d32; margin: 0 0 3pt; letter-spacing: 0.06em; }
    .fix-text { font-size: 8.5pt; color: #1b5e20; margin: 0; word-wrap: break-word; overflow-wrap: break-word; }

    /* ── Standards reference ── */
    .standards-line { font-size: 7.5pt; color: #555555; margin-top: 6pt; }

    /* ── Targets ── */
    .targets { padding-left: 14pt; font-size: 7.5pt; margin: 4pt 0; }
    .targets li { margin: 2pt 0; }
    details { margin-top: 6pt; font-size: 8pt; }
    summary { color: #2d2d6b; cursor: pointer; font-weight: 600; }

    /* ── Warnings ── */
    .warnings-section { background: #fffbeb; border: 1pt solid #fde68a; border-radius: 4pt; padding: 12pt 14pt; }
    .warnings-section li { margin: 3pt 0; font-size: 8.5pt; }

    /* ── Screenshot ── */
    .screenshot { max-width: 100%; border: 1pt solid #e0e0e0; border-radius: 4pt; margin-top: 8pt; }

    /* ── Footer ── */
    .ftr { margin-top: 24pt; padding-top: 10pt; border-top: 1pt solid #e0e0e0; font-size: 7.5pt; color: #888888; text-align: center; }
  `;
}

// ─────────── Type 2 (subsequent) internal renderers ───────────────────────────

function pdfUnresolvedHeader(projectName, date) {
  const len = (projectName || '').length;
  const fontSize =
    len <= 36 ? '12pt' :
    len <= 39 ? '11pt' :
    len <= 43 ? '10pt' :
    len <= 48 ? '9pt'  : '8pt';
  return (
    `<div class="fph-wrap">` +
    `<span class="fph-name" style="font-size:${fontSize}">${escapeHtml(projectName)}</span>` +
    `<span class="fph-subtitle">Unresolved Issues Report</span>` +
    `<span class="fph-date">${escapeHtml(date)}</span>` +
    `</div>`
  );
}

function countConsecutiveScans(ruleId, history) {
  // history is newest-first; start from 1 (current scan) and walk back through
  // consecutive snapshots that also contain this ruleId.
  let count = 1;
  for (const snap of history) {
    if (snap.issues?.some((i) => i.ruleId === ruleId)) count++;
    else break;
  }
  return count;
}

function renderUnresolvedTableRows(unresolvedIssues, history) {
  const SEV_ORDER = { 'Needs Immediate Fix': 0, 'Important': 1, 'Can Improve': 2, 'Minor': 3 };
  const sorted = [...unresolvedIssues].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4),
  );
  return { rows: sorted.map((iss) => {
    const tone      = severityTone(iss.severity);
    const pillClass = { crit: 'pill-crit', ser: 'pill-ser', mod: 'pill-mod', min: 'pill-min' }[tone];
    const sevLabel  = { crit: 'Severe', ser: 'High', mod: 'Medium', min: 'Low' }[tone];
    const rawUrl    = iss.pageUrl ?? iss.url ?? '';
    let pagePath = rawUrl;
    try { pagePath = new URL(rawUrl).pathname || rawUrl; } catch {}
    const pageAndComp = pagePath || 'Unknown Page';
    const standards   = renderStandardsForIssue(iss.standards);
    const count       = countConsecutiveScans(iss.ruleId, history ?? []);
    return `
    <tr>
      <td class="td-title">${escapeHtml(iss.title ?? '')}</td>
      <td><span class="pill ${pillClass}">${sevLabel}</span></td>
      <td style="font-size:8pt">${escapeHtml(pageAndComp)}</td>
      <td class="td-rule">${standards || '—'}</td>
      <td><div class="fix-box"><p class="fix-label">Fix</p><p class="fix-text">${escapeHtml(iss.whatYouCanDo ?? iss.fix ?? iss.description ?? '')}</p></div></td>
      <td style="text-align:center;font-weight:700;color:#191D88">${count}</td>
    </tr>`;
  }).join(''), count: sorted.length };
}

/* ─── Shared narrative helper used by both the standalone PDF and the full-report section ─── */

function renderUnresolvedNarrativeHtml({ unresolvedIssues, history, report, date }) {
  const prev       = history && history.length > 0 ? history[0] : null;
  const curScore   = report?.score ?? report?.overallScore ?? 0;
  const prevScore  = prev?.score ?? null;
  const scoreDelta = prevScore != null ? curScore - prevScore : null;

  const curSev = {
    severe: report?.summary?.critical ?? 0,
    high:   report?.summary?.serious  ?? 0,
    medium: report?.summary?.moderate ?? 0,
    low:    report?.summary?.minor    ?? 0,
  };
  const prevSev    = prev?.severity ?? null;
  const curTotal   = report?.summary?.totalIssues ?? (report?.issues ?? []).length;
  const prevTotal  = prev?.totalIssues ?? null;
  const issuesDelta = prevTotal != null ? curTotal - prevTotal : null;

  // Section 1 headline
  const verdictColor = scoreDelta == null ? '#191D88'
    : scoreDelta > 0 ? '#2e7d32'
    : scoreDelta < 0 ? '#c62828'
    : '#64748B';
  const verdictHeadline = scoreDelta == null ? 'Accessibility Scan Report'
    : scoreDelta > 0 ? 'Accessibility score improved this scan'
    : scoreDelta < 0 ? 'Accessibility score declined this scan'
    : 'Accessibility score unchanged since last scan';

  const scoreCol       = curScore >= 90 ? '#2e7d32' : curScore >= 70 ? '#f57c00' : '#c62828';
  const band           = curScore >= 90 ? 'Excellent' : curScore >= 70 ? 'Moderate' : 'Poor';
  const bandBg         = curScore >= 90 ? '#e8f5e9'  : curScore >= 70 ? '#fff3e0'  : '#ffebee';
  const prevScoreHtml  = prevScore != null ? `<span style="color:#888;font-size:14pt;font-weight:600">${prevScore} &#8594; </span>` : '';
  const prevIssuesHtml = prevTotal != null ? `<span style="color:#888;font-size:14pt;font-weight:600">${prevTotal} &#8594; </span>` : '';

  // Sections 2+3: improvements and regressions
  const improvements = [];
  const regressions  = [];
  if (prevSev) {
    if (scoreDelta > 0) improvements.unshift(`Accessibility score improved by <strong>${scoreDelta} point${scoreDelta !== 1 ? 's' : ''}</strong> (${prevScore} to ${curScore})`);
    if (scoreDelta < 0) regressions.unshift(`Accessibility score declined by <strong>${Math.abs(scoreDelta)} point${Math.abs(scoreDelta) !== 1 ? 's' : ''}</strong> (${prevScore} to ${curScore})`);
    for (const [key, label] of [['severe','Severe'],['high','High'],['medium','Medium'],['low','Low']]) {
      const cur = curSev[key] ?? 0;
      const prv = prevSev[key] ?? 0;
      const d   = cur - prv;
      if (d < 0) improvements.push(`<strong>${label}</strong> issues reduced by ${Math.abs(d)} (${prv} to ${cur})`);
      if (d > 0) regressions.push(`<strong>${label}</strong> issues increased by ${d} (${prv} to ${cur})`);
    }
  }

  // Section 4: severity breakdown
  const SEV_LABELS   = { 'Needs Immediate Fix': 'Severe', 'Important': 'High', 'Can Improve': 'Medium', 'Minor': 'Low' };
  const SEV_COLORS   = { 'Needs Immediate Fix': '#c62828', 'Important': '#e65100', 'Can Improve': '#b45309', 'Minor': '#00796b' };
  const SEV_SNAPKEYS = { 'Needs Immediate Fix': 'severe',  'Important': 'high',   'Can Improve': 'medium',  'Minor': 'low'    };
  const SEV_PILLCLS  = { 'Needs Immediate Fix': 'pill-crit','Important': 'pill-ser','Can Improve': 'pill-mod','Minor': 'pill-min' };
  const SEV_ORDER    = ['Needs Immediate Fix', 'Important', 'Can Improve', 'Minor'];

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtShort = (d) => {
    try { const dt = new Date(d); return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`; }
    catch { return '—'; }
  };
  const prevDateLabel = prev?.date ? fmtShort(prev.date) : null;

  const bySev = {};
  for (const sev of SEV_ORDER) bySev[sev] = [];
  for (const iss of unresolvedIssues) {
    if (bySev[iss.severity]) bySev[iss.severity].push(iss);
    else bySev['Minor'].push(iss);
  }

  const sevBreakdownHtml = SEV_ORDER.map(sev => {
    const issues = bySev[sev];
    if (!issues || issues.length === 0) return '';
    const label   = SEV_LABELS[sev];
    const color   = SEV_COLORS[sev];
    const snapKey = SEV_SNAPKEYS[sev];
    const pillCls = SEV_PILLCLS[sev];
    const prevCnt = prevSev?.[snapKey] ?? null;
    const curCnt  = curSev[snapKey]   ?? 0;
    const d       = prevCnt != null ? curCnt - prevCnt : null;

    const newCnt  = issues.filter(i => countConsecutiveScans(i.ruleId, history ?? []) <= 2).length;
    const persCnt = issues.length - newCnt;

    const summaryText = newCnt > 0 && persCnt > 0
      ? `${issues.length} ${label.toLowerCase()} issue${issues.length !== 1 ? 's' : ''} remain unresolved — ${newCnt} new this scan, ${persCnt} persistent.`
      : newCnt > 0
      ? `${issues.length} ${label.toLowerCase()} issue${issues.length !== 1 ? 's' : ''} newly unresolved this scan.`
      : `${issues.length} ${label.toLowerCase()} issue${issues.length !== 1 ? 's' : ''} persistent across multiple scans.`;

    const headerRow = prevDateLabel
      ? `<tr style="background:#f1f5f9"><td colspan="4" style="padding:4pt 8pt;font-size:7pt;color:#64748b;font-style:italic">Last scan: <strong>${prevDateLabel}</strong> &nbsp;·&nbsp; This scan: <strong>${date}</strong></td></tr>`
      : '';

    const issueRows = issues.map(iss => {
      const cnt   = countConsecutiveScans(iss.ruleId, history ?? []);
      const isNew = cnt <= 2;
      const badge = isNew
        ? `<span style="background:#FEE2E2;color:#991B1B;font-size:6.5pt;font-weight:700;padding:2pt 5pt;border-radius:3pt;white-space:nowrap">New</span>`
        : `<span style="background:#FEF3C7;color:#92400E;font-size:6.5pt;font-weight:700;padding:2pt 5pt;border-radius:3pt;white-space:nowrap">Persists</span>`;
      const rawUrl2   = iss.pageUrl ?? iss.url ?? '';
      let pagePath2   = rawUrl2;
      try { pagePath2 = new URL(rawUrl2).pathname || rawUrl2; } catch {}
      const comp      = pagePath2.length > 32 ? pagePath2.slice(0, 29) + '…' : pagePath2 || 'Unknown Page';
      return `<tr>
        <td style="vertical-align:middle;white-space:nowrap">${badge}</td>
        <td style="font-weight:600;color:#1a1a2e">${escapeHtml(iss.title ?? '')}</td>
        <td style="font-size:7.5pt;color:#555">${escapeHtml(comp)}</td>
        <td style="text-align:center;font-weight:700;color:#191D88">${cnt}</td>
      </tr>`;
    }).join('');

    const deltaTag = `<span style="margin-left:6pt;vertical-align:middle">${pdfDeltaBadge(d, true, '', 'Increased', 'Decreased')}</span>`;

    return `
    <div style="margin-bottom:16pt;border:1px solid #e0e0e0;border-top:3px solid ${color};border-radius:0 4pt 4pt 0;overflow:hidden">
      <div style="background:#f8fafc;padding:8pt 12pt;border-bottom:1px solid #e0e0e0">
        <span class="pill ${pillCls}">${label}</span>
        <span style="font-size:9pt;font-weight:700;color:${color};margin-left:6pt">${issues.length} issue${issues.length !== 1 ? 's' : ''}</span>
        ${deltaTag}
      </div>
      <p style="font-size:8.5pt;color:#555;margin:6pt 12pt 4pt;font-style:italic">${summaryText}</p>
      <table class="data-table" style="margin:0;border:none;border-top:1px solid #e0e0e0">
        <thead>
          ${headerRow}
          <tr>
            <th style="width:52pt">Status</th>
            <th>Issue</th>
            <th style="width:110pt">Component</th>
            <th style="width:58pt;text-align:center">Scans Unresolved</th>
          </tr>
        </thead>
        <tbody>${issueRows}</tbody>
      </table>
    </div>`;
  }).filter(Boolean).join('');

  // Section 5: full unresolved table
  const { rows, count } = renderUnresolvedTableRows(unresolvedIssues, history);

  return `
  <section class="no-break">
    <h2 class="section-heading" style="color:${verdictColor}">${escapeHtml(verdictHeadline)}</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:8pt">
      <tr>
        <td style="background:#fff;border:1px solid #e0e0e0;border-left:4px solid ${scoreCol};border-radius:6pt;padding:14pt 16pt;vertical-align:top;width:50%">
          <p style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin:0 0 6pt">Accessibility Score</p>
          <p style="margin:0 0 4pt;line-height:1.2">${prevScoreHtml}<span style="font-size:22pt;font-weight:700;color:${scoreCol}">${curScore}</span> <span style="font-size:8pt;color:#888">/ 100</span></p>
          <p style="margin:0 0 4pt"><span style="display:inline-block;padding:2pt 8pt;background:${bandBg};color:${scoreCol};font-size:7.5pt;font-weight:700;border-radius:10pt">${band}</span></p>
          ${pdfDeltaBadge(scoreDelta, false, ' Points', 'Improved', 'Regressed')}
        </td>
        <td style="background:#fff;border:1px solid #e0e0e0;border-radius:6pt;padding:14pt 16pt;vertical-align:top;width:50%">
          <p style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin:0 0 6pt">Total Issues</p>
          <p style="margin:0 0 4pt;line-height:1.2">${prevIssuesHtml}<span style="font-size:22pt;font-weight:700;color:#1a1a2e">${curTotal}</span></p>
          ${pdfDeltaBadge(issuesDelta, true, ' Issues', 'Increased', 'Decreased')}
        </td>
      </tr>
    </table>
  </section>

  ${improvements.length > 0 ? `
  <section class="no-break">
    <h2 class="section-heading" style="color:#2e7d32">What Went Well</h2>
    <ul style="font-size:9pt;color:#333;line-height:1.7;margin:0;padding-left:18pt">
      ${improvements.map(t => `<li>${t}</li>`).join('')}
    </ul>
  </section>` : ''}

  ${regressions.length > 0 ? `
  <section class="no-break">
    <h2 class="section-heading" style="color:#c62828">What Needs Attention</h2>
    <ul style="font-size:9pt;color:#333;line-height:1.7;margin:0;padding-left:18pt">
      ${regressions.map(t => `<li>${t}</li>`).join('')}
    </ul>
  </section>` : ''}

  <section>
    <h2 class="section-heading">Severity Breakdown</h2>
    ${sevBreakdownHtml}
  </section>

  <section>
    <h2 class="section-heading">All Unresolved Issues (${count})</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Issue Title</th>
          <th style="width:54pt">Severity</th>
          <th style="width:110pt">Affected Page</th>
          <th style="width:80pt">Compliance Rule</th>
          <th style="width:120pt">Recommended Fix</th>
          <th style="width:58pt;text-align:center">Scans Unresolved</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="table-footer">${count} unresolved issues &nbsp;&middot;&nbsp; Sorted: Severe &rarr; High &rarr; Medium &rarr; Low</p>
  </section>`;
}

function renderUnresolvedIssuesHtml({ projectName, date, unresolvedIssues, history }) {
  const { rows, count } = renderUnresolvedTableRows(unresolvedIssues, history);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Unresolved Issues Report &mdash; ${escapeHtml(projectName)}</title>
<style>${baseStyles()}</style>
</head>
<body>
  ${pdfUnresolvedHeader(projectName, date)}
  <div class="content">
    <section>
      <h2 class="section-heading">All Unresolved Issues</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Issue Title</th>
            <th style="width:54pt">Severity</th>
            <th style="width:110pt">Affected Page</th>
            <th style="width:80pt">Compliance Rule</th>
            <th style="width:120pt">Recommended Fix</th>
            <th style="width:58pt;text-align:center">Scans Unresolved</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="table-footer">${count} unresolved issue${count !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; Sorted: Severe &rarr; High &rarr; Medium &rarr; Low</p>
    </section>
    <footer class="ftr">DIGIT Accessibility Scanner &nbsp;&middot;&nbsp; Built on Playwright + axe-core</footer>
  </div>
</body>
</html>`;
}

function renderSnapshotComparisonPdf(report, prev) {
  const score       = report.score ?? report.overallScore ?? 0;
  const s           = report.summary ?? {};
  const totalIssues = s.totalIssues ?? (report.issues ?? []).length;
  const scoreCol    = score >= 90 ? '#2e7d32' : score >= 70 ? '#f57c00' : '#c62828';
  const band        = score >= 90 ? 'Excellent' : score >= 70 ? 'Moderate' : 'Poor';
  const bandBg      = score >= 90 ? '#e8f5e9'  : score >= 70 ? '#fff3e0'  : '#ffebee';

  const scoreDelta  = prev ? score       - prev.score       : null;
  const issuesDelta = prev ? totalIssues - prev.totalIssues : null;
  const prevScoreHtml  = prev ? `<span style="color:#888;font-size:14pt;font-weight:600">${prev.score} &#8594; </span>` : '';
  const prevIssuesHtml = prev ? `<span style="color:#888;font-size:14pt;font-weight:600">${prev.totalIssues} &#8594; </span>` : '';

  return `
  <section class="no-break">
    <h2 class="section-heading">Accessibility Snapshot</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:8pt">
      <tr>
        <td style="background:#fff;border:1px solid #e0e0e0;border-left:4px solid ${scoreCol};border-radius:6pt;padding:14pt 16pt;vertical-align:top;width:50%">
          <p style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin:0 0 6pt">Accessibility Score</p>
          <p style="margin:0 0 4pt;line-height:1.2">${prevScoreHtml}<span style="font-size:22pt;font-weight:700;color:${scoreCol}">${score}</span> <span style="font-size:8pt;color:#888">/ 100</span></p>
          <p style="margin:0 0 4pt"><span style="display:inline-block;padding:2pt 8pt;background:${bandBg};color:${scoreCol};font-size:7.5pt;font-weight:700;border-radius:10pt">${band}</span></p>
          ${pdfDeltaBadge(scoreDelta, false, ' Points', 'Improved', 'Regressed')}
        </td>
        <td style="background:#fff;border:1px solid #e0e0e0;border-radius:6pt;padding:14pt 16pt;vertical-align:top;width:50%">
          <p style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin:0 0 6pt">Total Issues</p>
          <p style="margin:0 0 4pt;line-height:1.2">${prevIssuesHtml}<span style="font-size:22pt;font-weight:700;color:#1a1a2e">${totalIssues}</span></p>
          <p style="font-size:8pt;color:#888;margin:0 0 4pt">Found this scan</p>
          ${pdfDeltaBadge(issuesDelta, true, ' Issues', 'Increased', 'Decreased')}
        </td>
      </tr>
    </table>
  </section>`;
}

function renderSeverityComparisonPdf(summary, prev) {
  const s    = summary ?? {};
  const prevSev = prev?.severity ?? null;

  function card(label, cur, prevVal, borderCol, textCol) {
    const delta = prevVal != null ? cur - prevVal : null;
    const prevHtml = prevVal != null
      ? `<span style="color:#888;font-size:12pt;font-weight:600">${prevVal} &#8594; </span>`
      : '';
    return `
    <td style="background:#fff;border:1px solid #e0e0e0;border-top:3px solid ${borderCol};border-radius:6pt;padding:12pt 14pt;vertical-align:top">
      <p style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${textCol};margin:0 0 4pt">${label}</p>
      <p style="margin:0 0 4pt;line-height:1.2">${prevHtml}<span style="font-size:20pt;font-weight:700;color:${textCol}">${cur}</span></p>
      ${pdfDeltaBadge(delta, true, '', 'Increased', 'Decreased')}
    </td>`;
  }

  return `
  <section class="no-break">
    <h2 class="section-heading">Severity Snapshot</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:6pt">
      <tr>
        ${card('Severe', s.critical ?? 0, prevSev?.severe ?? null, '#c62828', '#c62828')}
        ${card('High',   s.serious  ?? 0, prevSev?.high   ?? null, '#e65100', '#e65100')}
        ${card('Medium', s.moderate ?? 0, prevSev?.medium ?? null, '#f9a825', '#b45309')}
        ${card('Low',    s.minor    ?? 0, prevSev?.low    ?? null, '#00796b', '#00796b')}
      </tr>
    </table>
  </section>`;
}

/* ─────────────── Score Trend SVG charts (PDF A only) ─────────────────────── */

function _fmtChartDate(d) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return '—';
    return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
  } catch { return '—'; }
}

function svgScoreTrend(pts) {
  const W = 500, H = 190;
  const ML = 42, MR = 64, MT = 26, MB = 46;
  const PW = W - ML - MR;  // 394
  const PH = H - MT - MB;  // 118

  const N = pts.length;
  const groupW = PW / N;
  const barW = Math.min(72, Math.max(22, groupW * 0.58));
  const bandCol = (s) => s >= 90 ? '#2e7d32' : s >= 70 ? '#f57c00' : '#c62828';
  const yS = (v) => MT + PH * (1 - v / 100);

  let o = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible" xmlns="http://www.w3.org/2000/svg">`;

  // Grid lines + Y-axis ticks
  for (const v of [0, 25, 50, 75, 100]) {
    const y = yS(v).toFixed(1);
    o += `<line x1="${ML}" y1="${y}" x2="${ML + PW}" y2="${y}" stroke="#ebebeb" stroke-width="1"/>`;
    o += `<text x="${ML - 4}" y="${(yS(v) + 3.5).toFixed(1)}" font-size="9" text-anchor="end" fill="#aaa" font-family="Arial,sans-serif">${v}</text>`;
  }

  // Y-axis label (rotated)
  const midY = (MT + PH / 2).toFixed(1);
  o += `<text x="10" y="${midY}" font-size="9" fill="#666" text-anchor="middle" font-family="Arial,sans-serif" transform="rotate(-90,10,${midY})">Accessibility Score</text>`;

  // Dashed reference lines at 70 and 90
  for (const { v, label } of [{ v: 90, label: 'Excellent' }, { v: 70, label: 'Moderate' }]) {
    const y = yS(v).toFixed(1);
    o += `<line x1="${ML}" y1="${y}" x2="${ML + PW}" y2="${y}" stroke="#ccc" stroke-width="1" stroke-dasharray="5 3"/>`;
    o += `<text x="${ML + PW + 4}" y="${(yS(v) + 3.5).toFixed(1)}" font-size="8" fill="#bbb" font-family="Arial,sans-serif">${label}</text>`;
  }

  // Axes
  o += `<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + PH}" stroke="#bbb" stroke-width="1"/>`;
  o += `<line x1="${ML}" y1="${MT + PH}" x2="${ML + PW}" y2="${MT + PH}" stroke="#bbb" stroke-width="1"/>`;

  // Bars
  for (let i = 0; i < N; i++) {
    const pt = pts[i];
    const gx = ML + i * groupW;
    const bx = (gx + (groupW - barW) / 2).toFixed(1);
    const col = bandCol(pt.score);
    const darkerBorder = i === N - 1;
    const barH = (PH * pt.score / 100).toFixed(1);
    const by = yS(pt.score).toFixed(1);
    const cx = (gx + groupW / 2).toFixed(1);
    const borderAttr = darkerBorder
      ? ` stroke="${col === '#2e7d32' ? '#1b5e20' : col === '#f57c00' ? '#e65100' : '#b71c1c'}" stroke-width="2"`
      : '';
    o += `<rect x="${bx}" y="${by}" width="${barW.toFixed(1)}" height="${barH}" fill="${col}" rx="2"${borderAttr}/>`;
    o += `<text x="${cx}" y="${(yS(pt.score) - 5).toFixed(1)}" font-size="9" font-weight="bold" text-anchor="middle" fill="${col}" font-family="Arial,sans-serif">${pt.score}</text>`;
    o += `<text x="${cx}" y="${(MT + PH + 16).toFixed(1)}" font-size="9" text-anchor="middle" fill="#666" font-family="Arial,sans-serif">${_fmtChartDate(pt.date)}</text>`;
  }

  // Legend
  const legY = H - 14;
  const legItems = [
    { col: '#2e7d32', label: 'Excellent' },
    { col: '#f57c00', label: 'Moderate' },
    { col: '#c62828', label: 'Poor' },
  ];
  const legStep = 110;
  const legStart = (W - legStep * legItems.length) / 2;
  for (let i = 0; i < legItems.length; i++) {
    const { col, label } = legItems[i];
    const lx = legStart + i * legStep;
    o += `<rect x="${lx}" y="${legY - 9}" width="10" height="10" fill="${col}" rx="1"/>`;
    o += `<text x="${lx + 14}" y="${legY}" font-size="9" fill="#555" font-family="Arial,sans-serif">${label}</text>`;
  }

  o += `</svg>`;
  return o;
}

function svgSeverityTrend(pts) {
  const W = 500, H = 210;
  const ML = 42, MR = 10, MT = 26, MB = 54;
  const PW = W - ML - MR;  // 448
  const PH = H - MT - MB;  // 130

  const SEV_KEYS   = ['severe', 'high', 'medium', 'low'];
  const SEV_COLORS = ['#c62828', '#e65100', '#f9a825', '#00796b'];
  const SEV_LABELS = ['Severe', 'High', 'Medium', 'Low'];

  const N = pts.length;
  const groupW = PW / N;
  const innerGap = 1.5;
  const groupPad = Math.max(6, groupW * 0.14);
  const barW = Math.max(4, (groupW - groupPad * 2 - innerGap * 3) / 4);

  // Compute Y max
  let maxVal = 1;
  for (const pt of pts) {
    const sev = pt.severity ?? {};
    for (const k of SEV_KEYS) maxVal = Math.max(maxVal, sev[k] ?? 0);
  }
  const maxY = Math.ceil(maxVal / 10) * 10 || 10;
  const step = maxY <= 20 ? 5 : maxY <= 50 ? 10 : maxY <= 100 ? 20 : 50;
  const yS = (v) => MT + PH * (1 - v / maxY);

  let o = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible" xmlns="http://www.w3.org/2000/svg">`;

  // Grid lines + Y-axis ticks
  for (let v = 0; v <= maxY; v += step) {
    const y = yS(v).toFixed(1);
    o += `<line x1="${ML}" y1="${y}" x2="${ML + PW}" y2="${y}" stroke="#ebebeb" stroke-width="1"/>`;
    o += `<text x="${ML - 4}" y="${(yS(v) + 3.5).toFixed(1)}" font-size="9" text-anchor="end" fill="#aaa" font-family="Arial,sans-serif">${v}</text>`;
  }

  // Y-axis label
  const midY = (MT + PH / 2).toFixed(1);
  o += `<text x="10" y="${midY}" font-size="9" fill="#666" text-anchor="middle" font-family="Arial,sans-serif" transform="rotate(-90,10,${midY})">Issue Count</text>`;

  // Axes
  o += `<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + PH}" stroke="#bbb" stroke-width="1"/>`;
  o += `<line x1="${ML}" y1="${MT + PH}" x2="${ML + PW}" y2="${MT + PH}" stroke="#bbb" stroke-width="1"/>`;

  // Bars
  for (let i = 0; i < N; i++) {
    const pt = pts[i];
    const sev = pt.severity ?? {};
    const gx = ML + i * groupW + groupPad;

    for (let j = 0; j < 4; j++) {
      const val = sev[SEV_KEYS[j]] ?? 0;
      const bx = (gx + j * (barW + innerGap)).toFixed(1);
      const barH = (PH * val / maxY).toFixed(1);
      const by = yS(val).toFixed(1);
      const cx = (gx + j * (barW + innerGap) + barW / 2).toFixed(1);
      o += `<rect x="${bx}" y="${by}" width="${barW.toFixed(1)}" height="${barH}" fill="${SEV_COLORS[j]}" rx="1"/>`;
      // Count on top when bar is tall enough (> 18 SVG units)
      if (PH * val / maxY > 18) {
        o += `<text x="${cx}" y="${(yS(val) - 4).toFixed(1)}" font-size="8" font-weight="bold" text-anchor="middle" fill="${SEV_COLORS[j]}" font-family="Arial,sans-serif">${val}</text>`;
      }
    }

    // Date label
    const dateCx = (ML + i * groupW + groupW / 2).toFixed(1);
    o += `<text x="${dateCx}" y="${(MT + PH + 16).toFixed(1)}" font-size="9" text-anchor="middle" fill="#666" font-family="Arial,sans-serif">${_fmtChartDate(pt.date)}</text>`;
  }

  // Legend
  const legStep = 90;
  const legStart = (W - legStep * SEV_LABELS.length) / 2;
  const legY = H - 18;
  for (let i = 0; i < SEV_LABELS.length; i++) {
    const lx = legStart + i * legStep;
    o += `<rect x="${lx}" y="${legY - 9}" width="10" height="10" fill="${SEV_COLORS[i]}" rx="1"/>`;
    o += `<text x="${lx + 14}" y="${legY}" font-size="9" fill="#555" font-family="Arial,sans-serif">${SEV_LABELS[i]}</text>`;
  }

  o += `</svg>`;
  return o;
}

function renderScoreTrendGraphsPdf(chartPoints, prev, report) {
  if (!chartPoints || chartPoints.length < 2) return '';

  const curSev = {
    severe: report?.summary?.critical ?? 0,
    high:   report?.summary?.serious  ?? 0,
    medium: report?.summary?.moderate ?? 0,
    low:    report?.summary?.minor    ?? 0,
  };
  const prevSev = prev?.severity ?? null;

  // Improvement / regression text compared to last scan
  const improvements = [];
  const regressions  = [];
  if (prevSev) {
    for (const [key, label] of [['severe','Severe'],['high','High'],['medium','Medium'],['low','Low']]) {
      const d = curSev[key] - (prevSev[key] ?? 0);
      if (d < 0) improvements.push(`${label} issues reduced by ${Math.abs(d)} (${prevSev[key]} to ${curSev[key]})`);
      if (d > 0) regressions.push(`${label} issues increased by ${d} (${prevSev[key]} to ${curSev[key]})`);
    }
  }

  const changeHtml = (improvements.length === 0 && regressions.length === 0)
    ? `<p style="font-size:8.5pt;color:#64748b;margin:10pt 0 0;font-style:italic">No change since last scan.</p>`
    : [
        improvements.length > 0
          ? `<p style="font-size:8.5pt;color:#2e7d32;margin:10pt 0 2pt"><strong>Improved since last scan:</strong> ${improvements.join('; ')}.</p>`
          : '',
        regressions.length > 0
          ? `<p style="font-size:8.5pt;color:#c62828;margin:2pt 0 0"><strong>Regressed since last scan:</strong> ${regressions.join('; ')}.</p>`
          : '',
      ].join('');

  return `
  <section>
    <h2 class="section-heading">Score Trend</h2>
    ${svgScoreTrend(chartPoints)}
    <div style="height:16pt"></div>
    ${svgSeverityTrend(chartPoints)}
    ${changeHtml}
  </section>`;
}

function renderUnresolvedSectionPdf({ unresolvedIssues, history }) {
  if (!unresolvedIssues || unresolvedIssues.length === 0) return '';
  const { rows, count } = renderUnresolvedTableRows(unresolvedIssues, history);
  return `
  <section>
    <h2 class="section-heading">Unresolved Issues</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Issue Title</th>
          <th style="width:54pt">Severity</th>
          <th style="width:110pt">Affected Page</th>
          <th style="width:80pt">Compliance Rule</th>
          <th style="width:120pt">Recommended Fix</th>
          <th style="width:58pt;text-align:center">Scans Unresolved</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="table-footer">${count} unresolved issue${count !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; Sorted: Severe &rarr; High &rarr; Medium &rarr; Low</p>
  </section>`;
}

function renderReportHtmlSubsequent({ request, report, projectName, date, history }) {
  const score       = report.score ?? report.overallScore ?? 0;
  const s           = report.summary ?? {};
  const pages       = report.pages ?? [];
  const issues      = report.issues ?? [];
  const prev        = history && history.length > 0 ? history[0] : null;

  // Chart: up to 4 previous snapshots (oldest first) + current
  const histForChart = (history ?? []).slice(0, 4).reverse();
  const currentSnap  = {
    date:        new Date().toISOString(),
    score:       score,
    totalIssues: s.totalIssues ?? issues.length,
    severity:    { severe: s.critical ?? 0, high: s.serious ?? 0, medium: s.moderate ?? 0, low: s.minor ?? 0 },
  };
  const chartPoints = [...histForChart, currentSnap];

  // Unresolved: same ruleId in current AND previous scan
  const prevRuleIds   = new Set((prev?.issues ?? []).map((i) => i.ruleId));
  const allUnresolved = issues.filter((iss) => prevRuleIds.has(iss.ruleId));

  // Page rows: use multi-page report pages or synthesise a single-page row
  const pageRows = pages.length > 0
    ? pages
    : [{ url: request?.url ?? '', name: pageName(request?.url ?? '') || request?.url, score, summary: s }];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Full Report (Comparison) &mdash; ${escapeHtml(projectName)}</title>
<style>${baseStyles()}</style>
</head>
<body>
  ${pdfFirstPageHeading(projectName, date)}
  <div class="content">
    ${renderHowToReadForComparisonPdf(score)}
    ${renderSnapshotComparisonPdf(report, prev)}
    ${renderComplianceCardsComparison(report.standardsBreakdown, prev?.compliance)}
    ${renderSeverityComparisonPdf(s, prev)}
    ${renderScoreTrendGraphsPdf(chartPoints, prev, report)}
    ${renderUnresolvedSectionPdf({ unresolvedIssues: allUnresolved, history: history ?? [] })}
    ${renderPagewiseSectionForPdf(pageRows)}
    ${renderAllIssuesList(issues, report.summary, request?.url ?? '')}
    <footer class="ftr">DIGIT Accessibility Scanner &nbsp;&middot;&nbsp; Built on Playwright + axe-core</footer>
  </div>
</body>
</html>`;
}

function renderHowToReadForComparisonPdf(score) {
  const contextual = score >= 90
    ? 'The site is performing well. Monitor for regressions across future scans.'
    : score >= 70
    ? 'Focus on issues that have appeared across multiple scans — these are persistent problems with the most impact.'
    : 'Critical accessibility issues are present. Prioritise issues in the Unresolved section as they have persisted across scans.';
  return `
  <section class="no-break">
    <h2 class="section-heading">How to Read This Report</h2>
    <p style="font-size:9pt;color:#333333;margin:10pt 0 8pt;line-height:1.6">This report compares the current scan against the previous one. Arrows (Previous &rarr; Current) show how key metrics have changed. The Unresolved Issues section lists issues that appeared in both scans and have not yet been fixed.</p>
    <p style="font-size:8.5pt;color:#555555;margin:0;font-style:italic;line-height:1.5">${contextual}</p>
  </section>`;
}
