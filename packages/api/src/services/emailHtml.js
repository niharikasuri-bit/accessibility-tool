/**
 * Server-side HTML email generator.
 * Ported from packages/ui/src/lib/emailHtml.js — pure JS, no browser deps.
 */

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
  'Needs Immediate Fix': 0, 'Important': 1, 'Can Improve': 2, 'Minor': 3,
};

function scoreColor(s) {
  if (s >= 90) return { bg: '#e8f5e9', text: '#2e7d32', bar: '#2e7d32', label: 'Excellent' };
  if (s >= 70) return { bg: '#fff3e0', text: '#f57c00', bar: '#f57c00', label: 'Moderate' };
  return { bg: '#ffebee', text: '#c62828', bar: '#c62828', label: 'Poor' };
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function issueCompliance(standards) {
  if (!standards) return 'Internal';
  const parts = [];
  if (standards.wcag?.length)   parts.push(`WCAG 2.1 ${standards.wcag.join(', ')}`);
  if (standards.gigw?.length)   parts.push(`GIGW ${standards.gigw.join(', ')}`);
  if (standards.sesmag?.length) parts.push(`SesMag ${standards.sesmag.join(', ')}`);
  if (standards.ada?.length)    parts.push(`ADA Title III ${standards.ada.join(', ')}`);
  return parts.length ? parts.join(' · ') : 'Internal';
}

function mapIssues(issues, defaultPageUrl) {
  return [...issues]
    .sort((a, b) => (ISSUE_RANK[a.severity] ?? 4) - (ISSUE_RANK[b.severity] ?? 4))
    .slice(0, 5)
    .map((iss) => ({
      sevKey:       ISSUE_SEV_MAP[iss.severity] ?? 'low',
      title:        iss.title ?? iss.ruleId ?? 'Accessibility issue',
      affectedPage: iss.pageUrl ?? iss.url ?? defaultPageUrl ?? '',
      compliance:   issueCompliance(iss.standards),
      fix:          iss.whatYouCanDo ?? iss.fix ?? iss.description ?? iss.help ?? iss.title ?? `Remediate "${iss.ruleId}".`,
    }));
}

function renderDivider() {
  return `<tr><td style="height:1px;background:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>`;
}

function renderType1Header(data) {
  return `
  <tr><td style="background:#191D88;padding:32px 32px 28px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 18px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.55);font-family:Arial,Helvetica,sans-serif;">DIGIT &nbsp;&middot;&nbsp; Accessibility</p>
    <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:#fff;line-height:1.2;font-family:Arial,Helvetica,sans-serif;">${esc(data.projectName)}</h1>
    <p style="margin:0;font-size:13px;color:rgba(255,255,255,.65);line-height:1.5;font-family:Arial,Helvetica,sans-serif;">Scanned on ${esc(data.scanDate)}</p>
  </td></tr>`;
}

function renderSnapshot(score, totalIssues) {
  const sc = scoreColor(score);
  return `
  <tr><td style="padding:24px 32px 20px;">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Accessibility Snapshot</p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tbody><tr>
      <td width="292" valign="top" style="padding:16px;background:#fff;border-left:4px solid ${sc.bar};border-top:1px solid #e8e8e8;border-right:1px solid #e8e8e8;border-bottom:1px solid #e8e8e8;border-radius:6px;">
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody>
          <tr><td style="padding-bottom:8px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${sc.text};font-family:Arial,Helvetica,sans-serif;">Accessibility Score</td></tr>
          <tr><td style="padding-bottom:8px;font-size:40px;font-weight:800;color:${sc.text};line-height:1;font-family:Arial,Helvetica,sans-serif;">${score}</td></tr>
          <tr><td><span style="display:inline-block;padding:3px 10px;background:${sc.bg};color:${sc.text};font-size:11px;font-weight:700;border-radius:99px;font-family:Arial,Helvetica,sans-serif;">${sc.label}</span></td></tr>
        </tbody></table>
      </td>
      <td width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>
      <td width="292" valign="top" style="padding:16px;background:#fff;border:1px solid #e8e8e8;border-radius:6px;">
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody>
          <tr><td style="padding-bottom:8px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748B;font-family:Arial,Helvetica,sans-serif;">Total Issues</td></tr>
          <tr><td style="padding-bottom:8px;font-size:40px;font-weight:800;color:#0F172A;line-height:1;font-family:Arial,Helvetica,sans-serif;">${totalIssues}</td></tr>
          <tr><td style="font-size:11px;font-weight:600;color:#64748B;font-family:Arial,Helvetica,sans-serif;">Found this scan</td></tr>
        </tbody></table>
      </td>
    </tr></tbody></table>
  </td></tr>`;
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
    const c = SEV_CONFIG[key];
    const barW = count > 0 ? Math.max(6, Math.round((count / maxSev) * 200)) : 8;
    return `
    <tr>
      <td style="width:90px;padding-right:12px;vertical-align:middle;">
        <span style="display:inline-block;padding:3px 10px;background:${c.bg};color:${c.text};font-size:11px;font-weight:700;border-radius:99px;border:1px solid ${c.border};font-family:Arial,Helvetica,sans-serif;">${c.label}</span>
      </td>
      <td style="width:28px;text-align:right;padding-right:14px;font-size:14px;font-weight:800;color:#0F172A;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;">${count}</td>
      <td style="vertical-align:middle;">
        <table cellpadding="0" cellspacing="0" border="0"><tbody><tr>
          <td style="width:${barW}px;height:8px;background:${count > 0 ? c.bar : '#E5E7EB'};border-radius:4px;"></td>
        </tr></tbody></table>
      </td>
    </tr>`;
  }).join('');
  return `
  <tr><td style="padding:20px 32px 24px;">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Severity Snapshot</p>
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0 6px;"><tbody>${rowsHtml}</tbody></table>
  </td></tr>`;
}

function renderLowestPages(pages, pagesUrl, totalPages, hideInlineCta = false) {
  const sorted = [...pages].sort((a, b) => a.score - b.score);
  const cards = sorted.map((page, idx) => {
    const sc = scoreColor(page.score);
    return `
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:8px;"><tbody><tr><td style="padding:12px 16px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
        <td style="vertical-align:middle;">
          <table cellpadding="0" cellspacing="0" border="0"><tbody><tr>
            <td style="width:30px;height:30px;background:${sc.bar};border-radius:15px;text-align:center;vertical-align:middle;color:#fff;font-weight:700;font-size:12px;font-family:Arial,Helvetica,sans-serif;">${idx + 1}</td>
            <td style="width:12px;"></td>
            <td>
              <p style="margin:0;font-size:14px;font-weight:700;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">${esc(page.name)}</p>
              <p style="margin:2px 0 0;font-size:11px;color:#94A3B8;font-family:'Courier New',monospace;">${esc(page.url)}&nbsp;&nbsp;&middot;&nbsp;&nbsp;${page.issueCount} issue${page.issueCount !== 1 ? 's' : ''}</p>
            </td>
          </tr></tbody></table>
        </td>
        <td style="text-align:right;vertical-align:middle;white-space:nowrap;">
          <span style="display:inline-block;width:40px;height:40px;background:${sc.bg};border-radius:20px;text-align:center;line-height:40px;border:2px solid ${sc.bar};font-size:13px;font-weight:800;color:${sc.text};font-family:Arial,Helvetica,sans-serif;">${page.score}</span>
        </td>
      </tr></tbody></table>
    </td></tr></tbody></table>`;
  }).join('');

  const ctaCell = (!hideInlineCta && pagesUrl)
    ? `<td style="text-align:right;"><a href="${esc(pagesUrl)}" style="color:#1a1a9e;text-decoration:none;font-size:13px;font-family:Arial,Helvetica,sans-serif;">&#8594; View All Pages Report</a></td>`
    : '<td></td>';

  return `
  <tr><td style="padding:20px 32px 12px;">
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
      <td><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Lowest Scoring Pages</span></td>
      ${ctaCell}
    </tr></tbody></table>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">${cards}</td></tr>`;
}

function renderTopIssues(issues, issuesUrl, totalIssueCount, hideInlineCta = false) {
  const cards = issues.map((issue) => {
    const c = SEV_CONFIG[issue.sevKey] ?? SEV_CONFIG.low;
    return `
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:12px;overflow:hidden;"><tbody>
      <tr><td style="padding:14px 16px 12px;">
        <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;"><tbody><tr>
          <td style="padding:3px 10px;background:${c.bg};color:${c.text};font-size:11px;font-weight:700;border-radius:99px;border:1px solid ${c.border};font-family:Arial,Helvetica,sans-serif;">${c.label}</td>
        </tr></tbody></table>
        <p style="margin:0 0 5px;font-size:14px;font-weight:700;color:#0F172A;line-height:1.4;font-family:Arial,Helvetica,sans-serif;">${esc(issue.title)}</p>
        <p style="margin:0;font-size:11px;color:#94A3B8;line-height:1.5;font-family:Arial,Helvetica,sans-serif;">
          ${esc(issue.affectedPage || 'Unknown Page')}
        </p>
      </td></tr>
      <tr><td style="height:1px;background:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:12px 16px;background:#F0FDF4;">
        <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#15803D;font-family:Arial,Helvetica,sans-serif;">Recommended Fix</p>
        <p style="margin:0;font-size:13px;color:#15803D;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${esc(issue.fix)}</p>
      </td></tr>
    </tbody></table>`;
  }).join('');

  const ctaCell = (!hideInlineCta && issuesUrl)
    ? `<td style="text-align:right;"><a href="${esc(issuesUrl)}" style="color:#1a1a9e;text-decoration:none;font-size:13px;font-family:Arial,Helvetica,sans-serif;">&#8594; All Issues to Fix</a></td>`
    : '<td></td>';

  return `
  <tr><td style="padding:20px 32px 12px;">
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
      <td><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Top Issues to Fix</span></td>
      ${ctaCell}
    </tr></tbody></table>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">${cards}</td></tr>`;
}

function renderType1Footer(data) {
  const fullReportUrl = data.fullReportUrl ?? null;

  const btnHtml = fullReportUrl ? `
  <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px auto;"><tbody><tr>
    <td style="background:#191D88;border-radius:8px;">
      <a href="${esc(fullReportUrl)}" style="display:inline-block;padding:12px 28px;color:#fff;font-size:14px;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">View Full Report &#8594;</a>
    </td>
  </tr></tbody></table>` : '';

  return `
  <tr><td style="padding:24px 32px 32px;text-align:center;background:#F8FAFC;border-radius:0 0 12px 12px;">
    ${btnHtml}
    <p style="margin:0;font-size:12px;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">This report was automatically generated by DIGIT Accessibility Bot.</p>
  </td></tr>`;
}

function renderFooter(fullReportUrl) {
  const btnHtml = fullReportUrl ? `
  <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px auto;"><tbody><tr>
    <td style="background:#191D88;border-radius:8px;">
      <a href="${esc(fullReportUrl)}" style="display:inline-block;padding:12px 28px;color:#fff;font-size:14px;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">View Full Report &#8594;</a>
    </td>
  </tr></tbody></table>` : '';

  return `
  <tr><td style="padding:24px 32px 32px;text-align:center;background:#F8FAFC;border-radius:0 0 12px 12px;">
    ${btnHtml}
    <p style="margin:0;font-size:12px;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">This report was automatically generated by DIGIT Accessibility Bot.</p>
  </td></tr>`;
}

// ─── Type 2 header (with top-right CTA links) ────────────────────────────────

function renderType2Header(data) {
  return `
  <tr><td style="background:#191D88;padding:32px 32px 28px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 18px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.55);font-family:Arial,Helvetica,sans-serif;">DIGIT &nbsp;&middot;&nbsp; Accessibility</p>
    <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:#fff;line-height:1.2;font-family:Arial,Helvetica,sans-serif;">${esc(data.projectName)}</h1>
    <p style="margin:0;font-size:13px;color:rgba(255,255,255,.65);line-height:1.5;font-family:Arial,Helvetica,sans-serif;">Scanned on ${esc(data.scanDate)}</p>
  </td></tr>`;
}

function renderType2Footer(data) {
  const comparisonUrl     = data.fullReportUrl     ?? null;
  const viewFullReportUrl = data.viewFullReportUrl ?? null;

  const comparisonBtn = comparisonUrl ? `
    <td>
      <table cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td style="background:#191D88;border-radius:8px;">
          <a href="${esc(comparisonUrl)}" style="display:inline-block;padding:12px 24px;color:#fff;font-size:13px;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">View Full Comparison &#8594;</a>
        </td>
      </tr></tbody></table>
    </td>` : '';

  const viewFullBtn = viewFullReportUrl ? `
    <td>
      <table cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td style="background:transparent;border:2px solid #191D88;border-radius:8px;">
          <a href="${esc(viewFullReportUrl)}" style="display:inline-block;padding:10px 24px;color:#191D88;font-size:13px;font-weight:700;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">View Full Report &#8594;</a>
        </td>
      </tr></tbody></table>
    </td>` : '';

  const spacer = (viewFullBtn && comparisonBtn) ? `<td width="16" style="width:16px;"></td>` : '';
  const btnsHtml = (viewFullBtn || comparisonBtn) ? `
  <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px auto;"><tbody><tr>
    ${viewFullBtn}${spacer}${comparisonBtn}
  </tr></tbody></table>` : '';

  return `
  <tr><td style="padding:24px 32px 32px;text-align:center;background:#F8FAFC;border-radius:0 0 12px 12px;">
    ${btnsHtml}
    <p style="margin:0;font-size:12px;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">This report was automatically generated by DIGIT Accessibility Bot.</p>
  </td></tr>`;
}

// ─── Type 2 helpers ───────────────────────────────────────────────────────────

const GREY_PILL = 'display:inline-block;padding:3px 10px;background:#f5f5f5;color:#616161;font-size:11px;font-weight:700;border-radius:99px;font-family:Arial,Helvetica,sans-serif;';

/**
 * Coloured delta pill — green=improved, red=regressed, grey=no change/baseline.
 * @param {number|null} delta     current − previous, or null when no previous exists
 * @param {string}      unit      e.g. 'points' | 'issues' | ''
 * @param {boolean}     lowerIsBetter true for issue counts, false for scores
 */
function deltaPill(delta, unit, lowerIsBetter, upLabel, downLabel) {
  if (delta == null) return `<span style="${GREY_PILL}">First scan baseline</span>`;
  if (delta === 0)   return `<span style="${GREY_PILL}">Same as last scan</span>`;
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const bg    = improved ? '#e8f5e9' : '#ffebee';
  const color = improved ? '#2e7d32' : '#c62828';
  const arrow = delta > 0 ? '&#8593;' : '&#8595;';
  const sign  = delta > 0 ? '+' : '-';
  const absD  = Math.abs(delta);
  const label = delta > 0 ? upLabel : downLabel;
  const unitStr = unit ?? '';
  return `<span style="display:inline-block;padding:3px 10px;background:${bg};color:${color};font-size:11px;font-weight:700;border-radius:99px;font-family:Arial,Helvetica,sans-serif;">${arrow} ${sign}${absD}${unitStr} (${label})</span>`;
}

function renderComparisonSnapshot(current, previous) {
  const scoreDelta  = previous != null ? current.score       - previous.score       : null;
  const issuesDelta = previous != null ? current.totalIssues - previous.totalIssues : null;
  const sc = scoreColor(current.score);

  const prevScore  = previous != null ? `<span style="color:#94A3B8;font-size:22px;font-weight:600;font-family:Arial,Helvetica,sans-serif;">${previous.score} &#8594; </span>` : '';
  const prevIssues = previous != null ? `<span style="color:#94A3B8;font-size:22px;font-weight:600;font-family:Arial,Helvetica,sans-serif;">${previous.totalIssues} &#8594; </span>` : '';

  return `
  <tr><td style="padding:24px 32px 0;">
    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Accessibility Snapshot</p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tbody>
      <tr><td colspan="3" style="height:16px;line-height:16px;font-size:1px;">&nbsp;</td></tr>
      <tr>
        <td style="width:292px;vertical-align:top;">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
            <td style="padding:16px;background:#fff;border:1px solid #e8e8e8;border-left:4px solid ${sc.bar};border-radius:6px;">
              <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${sc.text};font-family:Arial,Helvetica,sans-serif;">Accessibility Score</p>
              <p style="margin:0 0 6px;line-height:1;">${prevScore}<span style="font-size:40px;font-weight:800;color:${sc.text};font-family:Arial,Helvetica,sans-serif;">${current.score}</span></p>
              <p style="margin:0 0 8px;"><span style="display:inline-block;padding:3px 10px;background:${sc.bg};color:${sc.text};font-size:11px;font-weight:700;border-radius:99px;font-family:Arial,Helvetica,sans-serif;">${sc.label}</span></p>
              ${deltaPill(scoreDelta, ' Points', false, 'Improved', 'Regressed')}
            </td>
          </tr></tbody></table>
        </td>
        <td style="width:16px;"></td>
        <td style="width:292px;vertical-align:top;">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
            <td style="padding:16px;background:#fff;border-radius:6px;border:1px solid #e8e8e8;">
              <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748B;font-family:Arial,Helvetica,sans-serif;">Total Issues</p>
              <p style="margin:0 0 8px;line-height:1;">${prevIssues}<span style="font-size:40px;font-weight:800;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">${current.totalIssues}</span></p>
              <p style="margin:0 0 8px;line-height:17px;font-size:11px;">&nbsp;</p>
              ${deltaPill(issuesDelta, ' Issues', true, 'Increased', 'Decreased')}
            </td>
          </tr></tbody></table>
        </td>
      </tr>
      <tr><td colspan="3" style="height:16px;line-height:16px;font-size:1px;">&nbsp;</td></tr>
    </tbody></table>
  </td></tr>`;
}

function renderComparisonSeverity(current, previous) {
  const SEV_BORDER = { severe: '#DC2626', high: '#EA580C', medium: '#D97706', low: '#94A3B8' };
  const ALL = [
    { key: 'severe', label: 'Severe' },
    { key: 'high',   label: 'High'   },
    { key: 'medium', label: 'Medium' },
    { key: 'low',    label: 'Low'    },
  ];

  function buildCard({ key, label }) {
    const c        = SEV_CONFIG[key];
    const cur      = current.severity[key]  ?? 0;
    const prev     = previous?.severity[key] ?? null;
    const delta    = prev != null ? cur - prev : null;
    const prevHtml = prev != null
      ? `<span style="color:#94A3B8;font-size:18px;font-weight:600;font-family:Arial,Helvetica,sans-serif;">${prev} &#8594; </span>`
      : '';
    return `
      <td style="width:50%;vertical-align:top;">
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
          <td style="padding:14px 12px;background:#fff;border:1px solid #E5E7EB;border-top:3px solid ${SEV_BORDER[key]};border-radius:8px;">
            <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:${c.text};font-family:Arial,Helvetica,sans-serif;">${label}</p>
            <p style="margin:0 0 6px;line-height:1;">${prevHtml}<span style="font-size:26px;font-weight:800;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">${cur}</span></p>
            ${deltaPill(delta, '', true, 'Increased', 'Decreased')}
          </td>
        </tr></tbody></table>
      </td>`;
  }

  const SEP = '<td width="16" style="width:16px;min-width:16px;font-size:0;line-height:0;">&nbsp;</td>';
  const row1 = ALL.slice(0, 2).map(buildCard).join(SEP);
  const row2 = ALL.slice(2, 4).map(buildCard).join(SEP);

  return `
  <tr><td style="padding:20px 32px 0;">
    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Severity Breakdown</p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tbody>
      <tr><td colspan="3" height="16" style="font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>
      <tr>${row1}</tr>
      <tr><td colspan="3" height="16" style="font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>
      <tr>${row2}</tr>
      <tr><td colspan="3" height="16" style="font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>
    </tbody></table>
  </td></tr>`;
}

function renderScoreTrend(chartPoints, currentSeverity) {
  if (!chartPoints || chartPoints.length < 2) return '';

  const MAX_H = 72; // px, max bar height
  const bars  = chartPoints.map((pt) => {
    const sc     = scoreColor(pt.score);
    const barH   = Math.max(4, Math.round((pt.score / 100) * MAX_H));
    const spacerH = MAX_H - barH;
    const rawDate = pt.date ? new Date(pt.date) : null;
    const dateLabel = rawDate && !isNaN(rawDate)
      ? rawDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : '—';
    return `
    <td style="text-align:center;vertical-align:bottom;padding:0 4px;">
      <p style="margin:0 0 3px;font-size:11px;font-weight:700;color:${sc.text};font-family:Arial,Helvetica,sans-serif;">${pt.score}</p>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 auto;"><tbody>
        <tr><td style="height:${spacerH}px;line-height:${spacerH}px;font-size:1px;">&nbsp;</td></tr>
        <tr><td style="height:${barH}px;background:${sc.bar};border-radius:3px 3px 0 0;">&nbsp;</td></tr>
      </tbody></table>
      <p style="margin:4px 0 0;font-size:10px;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">${esc(dateLabel)}</p>
    </td>`;
  }).join('');

  // Static breakdown for the most recent scan shown below the chart
  const sev = currentSeverity ?? {};
  const sevCols = [
    { key: 'severe', label: 'Severe', count: sev.severe ?? 0, color: '#B91C1C', bg: '#FEE2E2' },
    { key: 'high',   label: 'High',   count: sev.high   ?? 0, color: '#C2410C', bg: '#FFF7ED' },
    { key: 'medium', label: 'Medium', count: sev.medium ?? 0, color: '#B45309', bg: '#FFFBEB' },
    { key: 'low',    label: 'Low',    count: sev.low    ?? 0, color: '#475569', bg: '#F8FAFC' },
  ].map(({ label, count, color, bg }) => `
    <td style="width:25%;text-align:center;padding:10px 4px;background:${bg};border-radius:6px;">
      <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:${color};font-family:Arial,Helvetica,sans-serif;">${label}</p>
      <p style="margin:0;font-size:20px;font-weight:800;color:${color};font-family:Arial,Helvetica,sans-serif;">${count}</p>
    </td>`).join('<td style="width:2%;"></td>');

  return `
  <tr><td style="padding:20px 32px 0;">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Score Trend</p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tbody><tr>
      ${bars}
    </tr></tbody></table>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #E5E7EB;margin-top:2px;"><tbody><tr><td style="height:1px;background:#E5E7EB;"></td></tr></tbody></table>
  </td></tr>
  <tr><td style="padding:12px 32px 24px;">
    <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">Current Scan Severity</p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tbody><tr>
      ${sevCols}
    </tr></tbody></table>
  </td></tr>`;
}

function renderUnresolvedIssues(unresolvedIssues, unresolvedPdfUrl, totalUnresolved) {
  if (!unresolvedIssues || unresolvedIssues.length === 0) return '';

  const cards = unresolvedIssues.map((issue) => {
    const c = SEV_CONFIG[issue.sevKey] ?? SEV_CONFIG.low;
    const rawPage = issue.affectedPage ?? '';
    const pageTrunc = rawPage.length > 60 ? rawPage.slice(0, 57) + '…' : rawPage;
    const pageDisplay = pageTrunc || 'Unknown Page';
    return `
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:8px;"><tbody><tr>
      <td style="padding:16px;">
        <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;"><tbody><tr>
          <td style="padding:3px 10px;background:${c.bg};color:${c.text};font-size:11px;font-weight:700;border-radius:99px;border:1px solid ${c.border};font-family:Arial,Helvetica,sans-serif;">${c.label}</td>
        </tr></tbody></table>
        <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0F172A;font-family:Arial,Helvetica,sans-serif;">${esc(issue.title)}</p>
        <p style="margin:0;font-size:11px;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">${esc(pageDisplay)}</p>
      </td>
    </tr></tbody></table>`;
  }).join('');

  const ctaCell = (unresolvedPdfUrl && totalUnresolved > 3)
    ? `<td style="text-align:right;"><a href="${esc(unresolvedPdfUrl)}" style="color:#1a1a9e;text-decoration:none;font-size:13px;font-family:Arial,Helvetica,sans-serif;">&#8594; Unresolved Issues</a></td>`
    : '<td></td>';

  return `
  <tr><td style="padding:20px 32px 12px;">
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
      <td><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Unresolved Issues</span></td>
      ${ctaCell}
    </tr></tbody></table>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">${cards}</td></tr>`;
}

// ─── Type 2 data builders ─────────────────────────────────────────────────────

/**
 * Build a lightweight snapshot from a scan report for storage in scan-history.json.
 * @param {{ report: object, scanDate?: string }} opts
 * @returns {{ date, score, totalIssues, severity, issues }}
 */
export function buildScanSnapshot({ report, scanDate }) {
  const summary = report.summary ?? {};
  const issues  = report.issues  ?? [];
  const bd      = report.standardsBreakdown ?? {};
  const complianceKeys = ['wcag', 'gigw', 'sesmag', 'ada'];
  const compliance = {};
  for (const k of complianceKeys) {
    if (bd[k]) compliance[k] = {
      percentage: Math.round(bd[k].compliancePercent ?? 0),
      passed:     bd[k].rulesPassed  ?? 0,
      failed:     bd[k].rulesFailed  ?? 0,
    };
  }
  return {
    date:        scanDate || new Date().toISOString(),
    score:       report.score ?? report.overallScore ?? 0,
    totalIssues: summary.totalIssues ?? issues.length,
    severity: {
      severe: summary.critical ?? 0,
      high:   summary.serious  ?? 0,
      medium: summary.moderate ?? 0,
      low:    summary.minor    ?? 0,
    },
    compliance:  Object.keys(compliance).length > 0 ? compliance : undefined,
    issues: issues.map((iss) => ({
      ruleId:   iss.ruleId,
      title:    iss.title ?? iss.ruleId,
      severity: iss.severity,
    })),
  };
}

function buildSubsequentExtras(currentReport, currentUrl, history) {
  const issues      = currentReport.issues ?? [];
  const previous    = history.length > 0 ? history[0] : null;
  // Chart: up to 4 previous snapshots + current, displayed oldest→newest
  const histForChart = history.slice(0, 4).reverse();
  const summary      = currentReport.summary ?? {};
  const currentSnap  = {
    date:        new Date().toISOString(),
    score:       currentReport.score ?? currentReport.overallScore ?? 0,
    totalIssues: summary.totalIssues ?? issues.length,
    severity: { severe: summary.critical ?? 0, high: summary.serious ?? 0, medium: summary.moderate ?? 0, low: summary.minor ?? 0 },
  };
  const chartPoints  = [...histForChart, currentSnap];

  // Unresolved: same ruleId present in both current and previous scan
  const prevRuleIds      = new Set(previous?.issues?.map((i) => i.ruleId) ?? []);
  const unresolvedAll    = issues.filter((iss) => prevRuleIds.has(iss.ruleId));
  const unresolvedIssues = unresolvedAll.slice(0, 3).map((iss) => ({
    sevKey:       ISSUE_SEV_MAP[iss.severity] ?? 'low',
    title:        iss.title ?? iss.ruleId,
    affectedPage: iss.pageUrl ?? iss.url ?? currentUrl ?? '',
    compliance:   issueCompliance(iss.standards),
  }));

  return { previous, chartPoints, unresolvedIssues, totalUnresolved: unresolvedAll.length };
}

export function buildScanEmailDataSubsequent({ scan, projectName, scanId, frontendUrl, history }) {
  const base   = buildScanEmailData({ scan, projectName, scanId, frontendUrl });
  const report = scan.report ?? {};
  const extras = buildSubsequentExtras(report, scan.request?.url ?? '', history ?? []);
  return { ...base, ...extras };
}

export function buildSiteEmailDataSubsequent({ site, projectName, siteId, frontendUrl, history }) {
  const base   = buildSiteEmailData({ site, projectName, siteId, frontendUrl });
  const report = site.report ?? {};
  const extras = buildSubsequentExtras(report, '', history ?? []);
  return { ...base, ...extras };
}

function renderComplianceComparison(standardsBreakdown, previousCompliance) {
  if (!standardsBreakdown) return '';
  const standards = [
    { key: 'wcag',   badge: 'W3C',   name: 'WCAG 2.1'     },
    { key: 'gigw',   badge: 'IN',    name: 'GIGW'          },
    { key: 'sesmag', badge: 'EU/US', name: 'SesMag'        },
    { key: 'ada',    badge: 'US',    name: 'ADA Title III' },
  ];

  function buildCard({ key, badge, name }) {
    const d = standardsBreakdown[key];
    if (!d) return `<td style="width:50%;"></td>`;
    const pct     = Math.round(d.compliancePercent ?? 0);
    const col     = pct >= 90 ? '#2e7d32' : pct >= 70 ? '#f57c00' : '#c62828';
    const prev    = previousCompliance?.[key];
    const prevPct = prev?.percentage ?? null;
    const prevHtml = prevPct != null
      ? `<span style="font-size:13px;font-weight:600;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">${prevPct}% &#8594; </span>`
      : '';
    return `
    <td style="width:50%;vertical-align:top;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tbody><tr>
        <td style="padding:12px 14px;background:#fff;border:1px solid #E5E7EB;border-top:3px solid ${col};border-radius:8px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">${esc(badge)} &nbsp;${esc(name)}</p>
          <p style="margin:0;line-height:1.2;">${prevHtml}<span style="font-size:22px;font-weight:800;color:${col};font-family:Arial,Helvetica,sans-serif;">${pct}%</span></p>
        </td>
      </tr></tbody></table>
    </td>`;
  }

  const row1 = standards.slice(0, 2).map(buildCard).join('<td style="width:8px;"></td>');
  const row2 = standards.slice(2, 4).map(buildCard).join('<td style="width:8px;"></td>');

  return `
  <tr><td style="padding:20px 32px 24px;">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Compliance Detail</p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tbody>
      <tr>${row1}</tr>
      <tr><td colspan="3" style="height:8px;"></td></tr>
      <tr>${row2}</tr>
    </tbody></table>
  </td></tr>`;
}

// ─── Type 2 renderer ─────────────────────────────────────────────────────────

export function renderEmailHtmlSubsequent(data) {
  const showPages = data.scanMode === 'site' && (data.pages?.length ?? 0) > 0;
  const pagesUrl  = data.pagesUrl  ?? null;
  const issuesUrl = data.issuesUrl ?? null;

  const body = `
  <div style="background:#F1F5F9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
      <tbody>
        ${renderType2Header(data)}
        ${renderDivider()}
        ${renderComparisonSnapshot(data, data.previous)}
        ${renderDivider()}
        ${renderComparisonSeverity(data, data.previous)}
        ${data.unresolvedIssues?.length ? renderDivider() + renderUnresolvedIssues(data.unresolvedIssues, data.unresolvedPdfUrl ?? null, data.totalUnresolved) : ''}
        ${showPages ? renderDivider() + renderLowestPages(data.pages, pagesUrl, data.totalPages ?? 0) : ''}
        ${data.topIssues?.length ? renderDivider() + renderTopIssues(data.topIssues, issuesUrl, data.totalIssues) : ''}
        ${renderDivider()}
        ${renderType2Footer(data)}
      </tbody>
    </table>
  </div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accessibility Report — ${esc(data.projectName)}</title></head><body style="margin:0;padding:0;">${body}</body></html>`;
}

export function renderFailureEmailHtml({ projectName, url, failureReason, scheduledAt }) {
  const body = `
  <div style="background:#F1F5F9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
      <tbody>
        <tr><td style="background:#191D88;padding:32px 32px 28px;border-radius:12px 12px 0 0;">
          <p style="margin:0 0 18px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.55);font-family:Arial,Helvetica,sans-serif;">DIGIT &nbsp;&middot;&nbsp; Accessibility</p>
          <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:#fff;line-height:1.3;font-family:Arial,Helvetica,sans-serif;">We were unable to complete the accessibility scan for ${esc(projectName)}</h1>
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,.65);line-height:1.5;font-family:Arial,Helvetica,sans-serif;">${esc(scheduledAt)}</p>
        </td></tr>
        <tr><td style="height:1px;background:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>
        <tr><td style="padding:24px 32px 20px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;font-family:Arial,Helvetica,sans-serif;">Scan Target</p>
          <p style="margin:0;font-size:13px;color:#374151;word-break:break-all;font-family:'Courier New',monospace;">${esc(url ?? '—')}</p>
        </td></tr>
        <tr><td style="height:1px;background:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>
        <tr><td style="padding:20px 32px 24px;">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;border-left:4px solid #DC2626;"><tbody><tr><td style="padding:20px 22px;">
            <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#B91C1C;font-family:Arial,Helvetica,sans-serif;">Failure Reason</p>
            <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${esc(failureReason)}</p>
          </td></tr></tbody></table>
        </td></tr>
        <tr><td style="height:1px;background:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">Please try running the accessibility scan manually using the on-the-spot scan tool. If the issue persists, check that the project URL is accessible and that authentication credentials are still valid.</p>
        </td></tr>
        <tr><td style="height:1px;background:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>
        <tr><td style="padding:24px 32px 32px;text-align:center;background:#F8FAFC;border-radius:0 0 12px 12px;">
          <p style="margin:0;font-size:12px;color:#94A3B8;font-family:Arial,Helvetica,sans-serif;">This report was automatically generated by DIGIT Accessibility Bot.</p>
        </td></tr>
      </tbody>
    </table>
  </div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Scan Failed &mdash; ${esc(projectName)}</title></head><body style="margin:0;padding:0;">${body}</body></html>`;
}

export function buildScanEmailData({ scan, projectName, scanId, frontendUrl }) {
  const report  = scan.report  ?? {};
  const summary = report.summary ?? {};
  const issues  = report.issues  ?? [];
  return {
    projectName, scanDate: formatDate(),
    score:       report.score ?? 0,
    totalIssues: summary.totalIssues ?? issues.length,
    severity: { severe: summary.critical ?? 0, high: summary.serious ?? 0, medium: summary.moderate ?? 0, low: summary.minor ?? 0 },
    scanMode:  'single', pages: [], totalPages: 0,
    topIssues: mapIssues(issues, scan.request?.url ?? ''),
    scanId:    scanId ?? scan.id ?? null,
    frontendUrl: frontendUrl ?? null,
    standardsBreakdown: report.standardsBreakdown ?? null,
  };
}

export function buildSiteEmailData({ site, projectName, siteId, frontendUrl }) {
  const report  = site.report  ?? {};
  const summary = report.summary ?? {};
  const issues  = report.issues  ?? [];
  const pages   = report.pages   ?? [];
  const emailPages = [...pages]
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 3)
    .map((p) => ({
      name:       p.name ?? getPageName(p.url ?? ''),
      url:        p.url  ?? '',
      score:      p.score ?? 0,
      issueCount: p.summary?.totalIssues ?? (p.issues ?? []).length,
    }));
  return {
    projectName, scanDate: formatDate(),
    score:       report.overallScore ?? 0,
    totalIssues: summary.totalIssues ?? issues.length,
    severity: { severe: summary.critical ?? 0, high: summary.serious ?? 0, medium: summary.moderate ?? 0, low: summary.minor ?? 0 },
    scanMode: 'site', pages: emailPages, totalPages: pages.length,
    topIssues: mapIssues(issues, ''),
    siteId:     siteId ?? site.siteId ?? null,
    frontendUrl: frontendUrl ?? null,
    standardsBreakdown: report.standardsBreakdown ?? null,
  };
}

export function renderEmailHtml(data) {
  const showPages = data.scanMode === 'site' && data.pages.length > 0;
  const pagesUrl      = data.pagesUrl      ?? null;
  const issuesUrl     = data.issuesUrl     ?? null;
  const fullReportUrl = data.fullReportUrl ?? null;
  const body = `
  <div style="background:#F1F5F9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
      <tbody>
        ${renderType1Header(data)}
        ${renderDivider()}
        ${renderSnapshot(data.score, data.totalIssues)}
        ${renderDivider()}
        ${renderSeveritySnapshot(data.severity)}
        ${showPages ? renderDivider() + renderLowestPages(data.pages, pagesUrl, data.totalPages ?? 0) : ''}
        ${data.topIssues?.length ? renderDivider() + renderTopIssues(data.topIssues, issuesUrl, data.totalIssues) : ''}
        ${renderDivider()}
        ${renderType1Footer(data)}
      </tbody>
    </table>
  </div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accessibility Report — ${esc(data.projectName)}</title></head><body style="margin:0;padding:0;">${body}</body></html>`;
}
