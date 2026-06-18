/**
 * Pure-JS HTML email generator — visually matches EmailTemplate.jsx.
 * No React dependency; works reliably in any browser or Node context.
 *
 * Severity vocabulary used by the API (summary counts):
 *   critical / serious / moderate / minor
 * Severity labels used in per-issue objects:
 *   'Needs Immediate Fix' / 'Important' / 'Can Improve' / 'Minor'
 * EmailTemplate's internal vocabulary (mapped here):
 *   severe / high / medium / low
 */

// ── Design tokens (match EmailTemplate.jsx) ──────────────────────────────────

const SEV_CONFIG = {
  severe: { bg: '#FEE2E2', text: '#B91C1C', border: '#FECACA', bar: '#DC2626', label: 'Severe' },
  high:   { bg: '#FFF7ED', text: '#C2410C', border: '#FED7AA', bar: '#EA580C', label: 'High'   },
  medium: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A', bar: '#D97706', label: 'Medium' },
  low:    { bg: '#F8FAFC', text: '#475569', border: '#E2E8F0', bar: '#94A3B8', label: 'Low'    },
};

const ISSUE_SEV_MAP = {
  'Needs Immediate Fix': 'severe',
  'Important':           'high',
  'Can Improve':         'medium',
  'Minor':               'low',
};

const ISSUE_RANK = {
  'Needs Immediate Fix': 0,
  'Important':           1,
  'Can Improve':         2,
  'Minor':               3,
};

function scoreColor(score) {
  if (score >= 90) return { bg: '#DCFCE7', text: '#15803D', bar: '#16A34A', label: 'Good' };
  if (score >= 70) return { bg: '#FEF3C7', text: '#B45309', bar: '#D97706', label: 'Needs Improvement' };
  return { bg: '#FEE2E2', text: '#B91C1C', bar: '#DC2626', label: 'Poor' };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate() {
  return new Date().toLocaleString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function getPageName(url) {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '');
    if (!path) return 'Home';
    const last = path.split('/').filter(Boolean).pop();
    return last ? last.replace(/-/g, ' ') : path;
  } catch { return url; }
}

function mapIssues(issues, defaultPageUrl) {
  return [...issues]
    .sort((a, b) => (ISSUE_RANK[a.severity] ?? 4) - (ISSUE_RANK[b.severity] ?? 4))
    .slice(0, 5)
    .map((iss) => ({
      sevKey:      ISSUE_SEV_MAP[iss.severity] ?? 'low',
      title:       iss.title ?? iss.ruleId ?? 'Accessibility issue',
      affectedPage: iss.pageUrl ?? iss.url ?? defaultPageUrl ?? '',
      component:   iss.targets?.[0]?.selector ?? iss.ruleId ?? '',
      wcagRule:    iss.standards?.wcag?.length ? `WCAG ${iss.standards.wcag[0]}` : 'WCAG 2.1',
      fix:         iss.fix ?? iss.description ?? iss.help ?? iss.title ?? `Remediate "${iss.ruleId}".`,
    }));
}

// ── Block renderers ───────────────────────────────────────────────────────────

function renderDivider() {
  return `<tr><td style="height:1px;background:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>`;
}

function renderHeader(projectName, scanDate, pdfUrl) {
  return `
  <tr>
    <td style="background:#191D88;padding:32px 32px 28px 32px;border-radius:12px 12px 0 0;">
      <p style="margin:0 0 18px 0;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.55);font-family:Arial,Helvetica,sans-serif;">
        DIGIT &nbsp;&middot;&nbsp; Accessibility
      </p>
      <h1 style="margin:0 0 6px 0;font-size:24px;font-weight:800;color:#fff;line-height:1.2;font-family:Arial,Helvetica,sans-serif;">
        ${esc(projectName)}
      </h1>
      <p style="margin:0 0 24px 0;font-size:13px;color:rgba(255,255,255,.65);line-height:1.5;font-family:Arial,Helvetica,sans-serif;">
        Scanned on ${esc(scanDate)}
      </p>
      <table cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td style="background:#fff;border-radius:8px;">
          <a href="${esc(pdfUrl)}" style="display:inline-block;padding:10px 22px;color:#191D88;font-size:13px;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">
            Download Full Report (PDF) &rarr;
          </a>
        </td>
      </tr></tbody></table>
    </td>
  </tr>`;
}

function renderSnapshot(score, totalIssues) {
  const sc = scoreColor(score);
  return `
  <tr>
    <td style="padding:24px 32px 20px 32px;">
      <p style="margin:0 0 14px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">
        Accessibility Snapshot
      </p>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tbody><tr>
        <td style="width:48%;vertical-align:top;">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
            <td style="padding:18px 20px;background:${sc.bg};border-radius:10px;">
              <p style="margin:0 0 4px 0;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${sc.text};font-family:Arial,Helvetica,sans-serif;">Accessibility Score</p>
              <p style="margin:2px 0;font-size:40px;font-weight:800;color:${sc.text};line-height:1;font-family:Arial,Helvetica,sans-serif;">${Math.round(score)}</p>
              <p style="margin:0;font-size:12px;font-weight:600;color:${sc.text};font-family:Arial,Helvetica,sans-serif;">${sc.label}</p>
            </td>
          </tr></tbody></table>
        </td>
        <td style="width:4%;"></td>
        <td style="width:48%;vertical-align:top;">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
            <td style="padding:18px 20px;background:#F8FAFC;border-radius:10px;border:1px solid #E2E8F0;">
              <p style="margin:0 0 4px 0;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748B;font-family:Arial,Helvetica,sans-serif;">Total Issues</p>
              <p style="margin:2px 0;font-size:40px;font-weight:800;color:#0F172A;line-height:1;font-family:Arial,Helvetica,sans-serif;">${totalIssues}</p>
              <p style="margin:0;font-size:12px;font-weight:600;color:#64748B;font-family:Arial,Helvetica,sans-serif;">Found this scan</p>
            </td>
          </tr></tbody></table>
        </td>
      </tr></tbody></table>
    </td>
  </tr>`;
}

function renderSeveritySnapshot(severity) {
  const rows = [
    { key: 'severe', count: severity.severe },
    { key: 'high',   count: severity.high   },
    { key: 'medium', count: severity.medium },
    { key: 'low',    count: severity.low    },
  ];
  const maxSev = Math.max(...rows.map((r) => r.count), 1);

  const rowsHtml = rows.map(({ key, count }) => {
    const c    = SEV_CONFIG[key];
    const barW = count > 0 ? Math.max(6, Math.round((count / maxSev) * 200)) : 0;
    return `
    <tr>
      <td style="width:90px;padding-right:12px;vertical-align:middle;">
        <span style="display:inline-block;padding:3px 10px;background:${c.bg};color:${c.text};font-size:11px;font-weight:700;border-radius:99px;border:1px solid ${c.border};font-family:Arial,Helvetica,sans-serif;">
          ${c.label}
        </span>
      </td>
      <td style="width:28px;text-align:right;padding-right:14px;font-size:14px;font-weight:800;color:#0F172A;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;">
        ${count}
      </td>
      <td style="vertical-align:middle;">
        <table cellpadding="0" cellspacing="0" border="0"><tbody><tr>
          <td style="width:${barW > 0 ? barW : 8}px;height:8px;background:${barW > 0 ? c.bar : '#E5E7EB'};border-radius:4px;"></td>
        </tr></tbody></table>
      </td>
    </tr>`;
  }).join('');

  return `
  <tr>
    <td style="padding:20px 32px 24px 32px;">
      <p style="margin:0 0 14px 0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">
        Severity Snapshot
      </p>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0 6px;">
        <tbody>${rowsHtml}</tbody>
      </table>
    </td>
  </tr>`;
}

function renderLowestPages(pages, pdfUrl) {
  const sorted = [...pages].sort((a, b) => a.score - b.score).slice(0, 5);
  const cards = sorted.map((page, idx) => {
    const sc = scoreColor(page.score);
    return `
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:8px;"><tbody>
      <tr><td style="padding:12px 16px;">
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
          <td style="vertical-align:middle;">
            <table cellpadding="0" cellspacing="0" border="0"><tbody><tr>
              <td style="width:30px;height:30px;background:${sc.bar};border-radius:15px;text-align:center;vertical-align:middle;color:#fff;font-weight:700;font-size:12px;font-family:Arial,Helvetica,sans-serif;">
                ${idx + 1}
              </td>
              <td style="width:12px;"></td>
              <td>
                <p style="margin:0;font-size:14px;font-weight:700;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">${esc(page.name)}</p>
                <p style="margin:2px 0 0 0;font-size:11px;color:#94A3B8;font-family:'Courier New',monospace;">${esc(page.url)}&nbsp;&nbsp;&middot;&nbsp;&nbsp;${page.issueCount} issue${page.issueCount !== 1 ? 's' : ''}</p>
              </td>
            </tr></tbody></table>
          </td>
          <td style="text-align:right;vertical-align:middle;white-space:nowrap;">
            <span style="display:inline-block;width:40px;height:40px;background:${sc.bg};border-radius:20px;text-align:center;line-height:40px;border:2px solid ${sc.bar};font-size:13px;font-weight:800;color:${sc.text};font-family:Arial,Helvetica,sans-serif;">
              ${page.score}
            </span>
          </td>
        </tr></tbody></table>
      </td></tr>
    </tbody></table>`;
  }).join('');

  return `
  <tr>
    <td style="padding:20px 32px 12px 32px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
        <td><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Lowest Scoring Pages</span></td>
        <td style="text-align:right;"><a href="${esc(pdfUrl)}" style="font-size:12px;color:#191D88;text-decoration:none;font-weight:600;font-family:Arial,Helvetica,sans-serif;">&rarr; View All Pages (PDF)</a></td>
      </tr></tbody></table>
    </td>
  </tr>
  <tr>
    <td style="padding:0 32px 24px 32px;">${cards}</td>
  </tr>`;
}

function renderTopIssues(issues, pdfUrl) {
  const cards = issues.map((issue) => {
    const c = SEV_CONFIG[issue.sevKey] ?? SEV_CONFIG.low;
    return `
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:12px;overflow:hidden;"><tbody>
      <tr><td style="padding:14px 16px 12px 16px;">
        <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;"><tbody><tr>
          <td style="padding:3px 10px;background:${c.bg};color:${c.text};font-size:11px;font-weight:700;border-radius:99px;border:1px solid ${c.border};font-family:Arial,Helvetica,sans-serif;">
            ${c.label}
          </td>
        </tr></tbody></table>
        <p style="margin:0 0 5px 0;font-size:14px;font-weight:700;color:#0F172A;line-height:1.4;font-family:Arial,Helvetica,sans-serif;">${esc(issue.title)}</p>
        <p style="margin:0;font-size:11px;color:#94A3B8;line-height:1.5;font-family:Arial,Helvetica,sans-serif;">
          ${esc(issue.affectedPage)}&nbsp;&middot;&nbsp;<span style="font-family:'Courier New',monospace;">${esc(issue.component)}</span>&nbsp;&middot;&nbsp;${esc(issue.wcagRule)}
        </p>
      </td></tr>
      <tr><td style="height:1px;background:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:12px 16px;background:#F0FDF4;">
        <p style="margin:0 0 4px 0;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#15803D;font-family:Arial,Helvetica,sans-serif;">Recommended Fix</p>
        <p style="margin:0;font-size:13px;color:#15803D;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${esc(issue.fix)}</p>
      </td></tr>
    </tbody></table>`;
  }).join('');

  return `
  <tr>
    <td style="padding:20px 32px 12px 32px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
        <td><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Top Issues to Fix</span></td>
        <td style="text-align:right;"><a href="${esc(pdfUrl)}" style="font-size:12px;color:#191D88;text-decoration:none;font-weight:600;font-family:Arial,Helvetica,sans-serif;">&rarr; View All Issues (PDF)</a></td>
      </tr></tbody></table>
    </td>
  </tr>
  <tr>
    <td style="padding:0 32px 24px 32px;">${cards}</td>
  </tr>`;
}

function renderFooter(pdfUrl, toolName) {
  return `
  <tr>
    <td style="padding:24px 32px 32px 32px;text-align:center;background:#F8FAFC;border-radius:0 0 12px 12px;">
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px auto;"><tbody><tr>
        <td style="background:#191D88;border-radius:8px;">
          <a href="${esc(pdfUrl)}" style="display:inline-block;padding:12px 28px;color:#fff;font-size:14px;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">
            Download Full Report (PDF) &rarr;
          </a>
        </td>
      </tr></tbody></table>
      <p style="margin:0 0 10px 0;font-size:12px;color:#94A3B8;line-height:1.5;font-family:Arial,Helvetica,sans-serif;">
        This report was automatically generated by ${esc(toolName)}.
      </p>
      <p style="margin:0;font-size:11px;color:#CBD5E1;font-family:Arial,Helvetica,sans-serif;">
        <a href="#" style="color:#CBD5E1;text-decoration:underline;font-family:Arial,Helvetica,sans-serif;">Unsubscribe</a>
        &nbsp;&middot;&nbsp;
        <a href="#" style="color:#CBD5E1;text-decoration:underline;font-family:Arial,Helvetica,sans-serif;">Manage preferences</a>
      </p>
    </td>
  </tr>`;
}

// ── Public builders ───────────────────────────────────────────────────────────

/**
 * Build email data from a single-page scan.
 */
export function buildScanEmailData({ scan, projectName, reportUrl, pdfUrl }) {
  const report  = scan.report  ?? {};
  const summary = report.summary ?? {};
  const issues  = report.issues  ?? [];
  const pageUrl = scan.request?.url ?? '';

  return {
    projectName,
    scanDate:    formatDate(),
    reportUrl,
    pdfUrl:      pdfUrl || reportUrl,
    toolName:    'DIGIT Accessibility Bot',
    score:       report.score ?? 0,
    totalIssues: summary.totalIssues ?? issues.length,
    severity: {
      severe: summary.critical ?? 0,
      high:   summary.serious  ?? 0,
      medium: summary.moderate ?? 0,
      low:    summary.minor    ?? 0,
    },
    scanMode:  'single',
    pages:     [],
    topIssues: mapIssues(issues, pageUrl),
  };
}

/**
 * Build email data from a site (multi-page) scan.
 */
export function buildSiteEmailData({ site, projectName, reportUrl, pdfUrl }) {
  const report  = site.report  ?? {};
  const summary = report.summary ?? {};
  const issues  = report.issues  ?? [];
  const pages   = report.pages   ?? [];

  const emailPages = [...pages]
    .sort((a, b) => (a.score ?? a.accessibilityScore ?? 0) - (b.score ?? b.accessibilityScore ?? 0))
    .slice(0, 5)
    .map((p) => ({
      name:       p.name ?? getPageName(p.url ?? p.pageUrl ?? ''),
      url:        p.url  ?? p.pageUrl ?? '',
      score:      Math.round(p.score ?? p.accessibilityScore ?? 0),
      issueCount: (p.issues ?? p.issuesList ?? []).length,
    }));

  return {
    projectName,
    scanDate:    formatDate(),
    reportUrl,
    pdfUrl:      pdfUrl || reportUrl,
    toolName:    'DIGIT Accessibility Bot',
    score:       report.overallScore ?? 0,
    totalIssues: summary.totalIssues ?? issues.length,
    severity: {
      severe: summary.critical ?? 0,
      high:   summary.serious  ?? 0,
      medium: summary.moderate ?? 0,
      low:    summary.minor    ?? 0,
    },
    scanMode:  'site',
    pages:     emailPages,
    topIssues: mapIssues(issues, ''),
  };
}

/**
 * Render email data to a complete HTML document string.
 * Matches the visual design of EmailTemplate.jsx.
 */
export function renderEmailHtml(data) {
  const showPages = data.scanMode === 'site' && data.pages.length > 0;
  const pdfUrl    = data.pdfUrl || data.reportUrl;

  const body = `
  <div style="background:#F1F5F9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <table cellpadding="0" cellspacing="0" border="0"
      style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
      <tbody>
        ${renderHeader(data.projectName, data.scanDate, pdfUrl)}
        ${renderDivider()}
        ${renderSnapshot(data.score, data.totalIssues)}
        ${renderDivider()}
        ${renderSeveritySnapshot(data.severity)}
        ${renderDivider()}
        ${showPages ? renderLowestPages(data.pages, pdfUrl) + renderDivider() : ''}
        ${data.topIssues.length ? renderTopIssues(data.topIssues, pdfUrl) + renderDivider() : ''}
        ${renderFooter(pdfUrl, data.toolName)}
      </tbody>
    </table>
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Accessibility Report — ${esc(data.projectName)}</title>
</head>
<body style="margin:0;padding:0;">${body}</body>
</html>`;
}
