// Email-safe report template.
// Rules enforced: inline CSS only, table-based layout, no flexbox/grid, max 600px.

// ─── Color helpers ────────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 90) return { bg: '#e8f5e9', text: '#2e7d32', bar: '#2e7d32', label: 'Excellent' };
  if (score >= 70) return { bg: '#fff3e0', text: '#f57c00', bar: '#f57c00', label: 'Moderate' };
  return { bg: '#ffebee', text: '#c62828', bar: '#c62828', label: 'Poor' };
}

const SEV = {
  severe: { bg: '#FEE2E2', text: '#B91C1C', border: '#FECACA', bar: '#DC2626', label: 'Severe' },
  high:   { bg: '#FFF7ED', text: '#C2410C', border: '#FED7AA', bar: '#EA580C', label: 'High'   },
  medium: { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A', bar: '#D97706', label: 'Medium' },
  low:    { bg: '#F8FAFC', text: '#475569', border: '#E2E8F0', bar: '#94A3B8', label: 'Low'    },
};

const SEV_ORDER = { severe: 0, high: 1, medium: 2, low: 3 };

// ─── Primitives ───────────────────────────────────────────────────────────────

function Divider() {
  return (
    <tr data-pdf="divider">
      <td style={{ height: 1, backgroundColor: '#E5E7EB', lineHeight: '1px', fontSize: '1px' }}>
        &nbsp;
      </td>
    </tr>
  );
}

function SectionLabel({ children }) {
  return (
    <p style={{ margin: '0 0 14px 0', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B7280', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {children}
    </p>
  );
}

function CtaButton({ href, onClick, children, dark }) {
  const handleClick = onClick ? (e) => { e.preventDefault(); onClick(); } : undefined;
  return (
    <table cellPadding={0} cellSpacing={0} border={0}>
      <tbody>
        <tr>
          <td style={{ backgroundColor: dark ? '#191D88' : '#FFFFFF', borderRadius: '8px' }}>
            <a
              href={onClick ? '#' : href}
              onClick={handleClick}
              style={{ display: 'inline-block', padding: '10px 22px', color: dark ? '#FFFFFF' : '#191D88', fontSize: '13px', fontWeight: 700, textDecoration: 'none', fontFamily: 'Arial, Helvetica, sans-serif' }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function EmailHeader({ projectName, scanDate }) {
  return (
    <tr data-pdf="header">
      <td style={{ backgroundColor: '#191D88', padding: '32px 32px 28px 32px', borderRadius: '12px 12px 0 0' }}>
        <p style={{ margin: '0 0 18px 0', fontSize: '11px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', fontFamily: 'Arial, Helvetica, sans-serif' }}>
          DIGIT &nbsp;·&nbsp; Accessibility
        </p>
        <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: 800, color: '#FFFFFF', lineHeight: '1.2', fontFamily: 'Arial, Helvetica, sans-serif' }}>
          {projectName}
        </h1>
        <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.65)', lineHeight: '1.5', fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Scanned on {scanDate}
        </p>
      </td>
    </tr>
  );
}

// ─── Section 1: Accessibility Snapshot ───────────────────────────────────────

function AccessibilitySnapshot({ score, totalIssues }) {
  const sc = scoreColor(score);
  return (
    <tr data-pdf="snapshot">
      <td style={{ padding: '24px 32px 20px 32px' }}>
        <SectionLabel>Accessibility Snapshot</SectionLabel>
        <table cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td
                width={292}
                valign="top"
                style={{ padding: '16px', backgroundColor: '#fff', borderLeft: `4px solid ${sc.bar}`, borderTop: '1px solid #e8e8e8', borderRight: '1px solid #e8e8e8', borderBottom: '1px solid #e8e8e8', borderRadius: '6px' }}
              >
                <table cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%' }}>
                  <tbody>
                    <tr><td style={{ paddingBottom: '8px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: sc.text, fontFamily: 'Arial, Helvetica, sans-serif' }}>Accessibility Score</td></tr>
                    <tr><td style={{ paddingBottom: '8px', fontSize: '40px', fontWeight: 800, color: sc.text, lineHeight: '1', fontFamily: 'Arial, Helvetica, sans-serif' }}>{score}</td></tr>
                    <tr><td><span style={{ display: 'inline-block', padding: '3px 10px', background: sc.bg, color: sc.text, fontSize: '11px', fontWeight: 700, borderRadius: '99px', fontFamily: 'Arial, Helvetica, sans-serif' }}>{sc.label}</span></td></tr>
                  </tbody>
                </table>
              </td>

              <td width={16} style={{ width: '16px', fontSize: '0', lineHeight: '0' }}>&nbsp;</td>

              <td
                width={292}
                valign="top"
                style={{ padding: '16px', backgroundColor: '#fff', border: '1px solid #e8e8e8', borderRadius: '6px' }}
              >
                <table cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%' }}>
                  <tbody>
                    <tr><td style={{ paddingBottom: '8px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#64748B', fontFamily: 'Arial, Helvetica, sans-serif' }}>Total Issues</td></tr>
                    <tr><td style={{ paddingBottom: '8px', fontSize: '40px', fontWeight: 800, color: '#0F172A', lineHeight: '1', fontFamily: 'Arial, Helvetica, sans-serif' }}>{totalIssues}</td></tr>
                    <tr><td style={{ fontSize: '11px', fontWeight: 600, color: '#64748B', fontFamily: 'Arial, Helvetica, sans-serif' }}>Found this scan</td></tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}

// ─── Section 2: Severity Snapshot ────────────────────────────────────────────

function SeveritySnapshot({ severity, maxSev }) {
  const rows = [
    { key: 'severe', count: severity.severe },
    { key: 'high',   count: severity.high   },
    { key: 'medium', count: severity.medium },
    { key: 'low',    count: severity.low    },
  ];

  return (
    <tr data-pdf="severity">
      <td style={{ padding: '20px 32px 24px 32px' }}>
        <SectionLabel>Severity Snapshot</SectionLabel>
        <table cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px' }}>
          <tbody>
            {rows.map(({ key, count }) => {
              const c   = SEV[key];
              const barW = count > 0 ? Math.max(6, Math.round((count / maxSev) * 200)) : 0;
              return (
                <tr key={key}>
                  {/* Severity pill */}
                  <td style={{ width: '90px', paddingRight: '12px', verticalAlign: 'middle' }}>
                    <span style={{ display: 'inline-block', padding: '3px 10px', backgroundColor: c.bg, color: c.text, fontSize: '11px', fontWeight: 700, borderRadius: '99px', border: `1px solid ${c.border}`, fontFamily: 'Arial, Helvetica, sans-serif' }}>
                      {c.label}
                    </span>
                  </td>
                  {/* Count */}
                  <td style={{ width: '28px', textAlign: 'right', paddingRight: '14px', fontSize: '14px', fontWeight: 800, color: '#0F172A', verticalAlign: 'middle', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                    {count}
                  </td>
                  {/* Bar */}
                  <td style={{ verticalAlign: 'middle' }}>
                    <table cellPadding={0} cellSpacing={0} border={0}>
                      <tbody>
                        <tr>
                          {barW > 0 && (
                            <td style={{ width: `${barW}px`, height: '8px', backgroundColor: c.bar, borderRadius: '4px' }} />
                          )}
                          {barW === 0 && (
                            <td style={{ width: '8px', height: '8px', backgroundColor: '#E5E7EB', borderRadius: '4px' }} />
                          )}
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

// ─── Section 3: Lowest Scoring Pages ─────────────────────────────────────────

function LowestScoringPages({ pages, onDownload }) {
  const sorted = [...pages].sort((a, b) => a.score - b.score).slice(0, 5);

  return (
    <>
      {/* Section heading row */}
      <tr data-pdf="pages-head">
        <td style={{ padding: '20px 32px 12px 32px' }}>
          <table cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td>
                  <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B7280', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                    Lowest Scoring Pages
                  </span>
                </td>
                {onDownload && (
                  <td style={{ textAlign: 'right' }}>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); onDownload(); }}
                      style={{ fontSize: '12px', color: '#191D88', textDecoration: 'none', fontWeight: 600, fontFamily: 'Arial, Helvetica, sans-serif' }}
                    >
                      &rarr; View All Pages Report
                    </a>
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </td>
      </tr>

      {/* Page cards */}
      <tr data-pdf="pages-body">
        <td style={{ padding: '0 32px 24px 32px' }}>
          {sorted.map((page, idx) => {
            const sc = scoreColor(page.score);
            return (
              <table key={idx} cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%', backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '10px', marginBottom: '8px' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '12px 16px' }}>
                      <table cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%' }}>
                        <tbody>
                          <tr>
                            {/* Rank circle + name + meta */}
                            <td style={{ verticalAlign: 'middle' }}>
                              <table cellPadding={0} cellSpacing={0} border={0}>
                                <tbody>
                                  <tr>
                                    <td style={{ width: '30px', height: '30px', backgroundColor: sc.bar, borderRadius: '15px', textAlign: 'center', verticalAlign: 'middle', color: '#FFFFFF', fontWeight: 700, fontSize: '12px', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                                      {idx + 1}
                                    </td>
                                    <td style={{ width: '12px' }} />
                                    <td>
                                      <p style={{ margin: '0', fontSize: '14px', fontWeight: 700, color: '#0F172A', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                                        {page.name}
                                      </p>
                                      <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#94A3B8', fontFamily: 'Courier New, monospace' }}>
                                        {page.url}&nbsp;&nbsp;&middot;&nbsp;&nbsp;{page.issueCount} issue{page.issueCount !== 1 ? 's' : ''}
                                      </p>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </td>

                            {/* Score circle + chevron */}
                            <td style={{ textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                              <table cellPadding={0} cellSpacing={0} border={0} style={{ display: 'inline-table', marginLeft: 'auto' }}>
                                <tbody>
                                  <tr>
                                    <td style={{ width: '40px', height: '40px', backgroundColor: sc.bg, borderRadius: '20px', textAlign: 'center', verticalAlign: 'middle', border: `2px solid ${sc.bar}` }}>
                                      <span style={{ fontSize: '13px', fontWeight: 800, color: sc.text, fontFamily: 'Arial, Helvetica, sans-serif' }}>
                                        {page.score}
                                      </span>
                                    </td>
                                    <td style={{ width: '10px' }} />
                                    <td style={{ fontSize: '16px', color: '#CBD5E1', verticalAlign: 'middle', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                                      &rarr;
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>
            );
          })}
        </td>
      </tr>
    </>
  );
}

// ─── Section 4: Top Issues to Fix ────────────────────────────────────────────

function TopIssues({ issues, onDownload }) {
  const sorted = [...issues]
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4))
    .slice(0, 5);

  return (
    <>
      {/* Section heading row */}
      <tr data-pdf="issues-head">
        <td style={{ padding: '20px 32px 12px 32px' }}>
          <table cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td>
                  <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B7280', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                    Top Issues to Fix
                  </span>
                </td>
                {onDownload && (
                  <td style={{ textAlign: 'right' }}>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); onDownload(); }}
                      style={{ fontSize: '12px', color: '#191D88', textDecoration: 'none', fontWeight: 600, fontFamily: 'Arial, Helvetica, sans-serif' }}
                    >
                      &rarr; All Issues to Fix
                    </a>
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </td>
      </tr>

      {/* Issue cards */}
      <tr data-pdf="issues-body">
        <td style={{ padding: '0 32px 24px 32px' }}>
          {sorted.map((issue, idx) => {
            const c = SEV[issue.severity] ?? SEV.low;
            return (
              <table key={idx} cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%', backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '10px', marginBottom: '12px', overflow: 'hidden' }}>
                <tbody>
                  {/* Issue header */}
                  <tr>
                    <td style={{ padding: '14px 16px 12px 16px' }}>
                      {/* Severity badge */}
                      <table cellPadding={0} cellSpacing={0} border={0} style={{ marginBottom: '8px' }}>
                        <tbody>
                          <tr>
                            <td style={{ padding: '3px 10px', backgroundColor: c.bg, color: c.text, fontSize: '11px', fontWeight: 700, borderRadius: '99px', border: `1px solid ${c.border}`, fontFamily: 'Arial, Helvetica, sans-serif' }}>
                              {c.label}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      {/* Title */}
                      <p style={{ margin: '0 0 5px 0', fontSize: '14px', fontWeight: 700, color: '#0F172A', lineHeight: '1.4', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                        {issue.title}
                      </p>
                      {/* Meta */}
                      <p style={{ margin: 0, fontSize: '11px', color: '#94A3B8', lineHeight: '1.5', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                        {issue.affectedPage ? <>{issue.affectedPage}&nbsp;&middot;&nbsp;</> : null}
                        <span style={{ fontFamily: 'Courier New, monospace' }}>{issue.component}</span>
                        &nbsp;&middot;&nbsp;
                        {issue.compliance ?? issue.wcagRule}
                      </p>
                    </td>
                  </tr>

                  {/* Inner divider */}
                  <tr>
                    <td style={{ height: '1px', backgroundColor: '#E5E7EB', lineHeight: '1px', fontSize: '1px' }}>
                      &nbsp;
                    </td>
                  </tr>

                  {/* Recommended fix */}
                  <tr>
                    <td style={{ padding: '12px 16px', backgroundColor: '#F0FDF4' }}>
                      <p style={{ margin: '0 0 4px 0', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#15803D', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                        Recommended Fix
                      </p>
                      <p style={{ margin: 0, fontSize: '13px', color: '#15803D', lineHeight: '1.6', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                        {issue.whatYouCanDo ?? issue.fix}
                      </p>
                    </td>
                  </tr>
                </tbody>
              </table>
            );
          })}
        </td>
      </tr>
    </>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function EmailFooter({ reportUrl, toolName, onDownloadFull }) {
  const handleClick = onDownloadFull ? (e) => { e.preventDefault(); onDownloadFull(); } : undefined;
  return (
    <tr data-pdf="footer">
      <td style={{ padding: '24px 32px 32px 32px', textAlign: 'center', backgroundColor: '#F8FAFC', borderRadius: '0 0 12px 12px' }}>
        {/* CTA */}
        <table cellPadding={0} cellSpacing={0} border={0} style={{ margin: '0 auto 20px auto' }}>
          <tbody>
            <tr>
              <td style={{ backgroundColor: '#191D88', borderRadius: '8px' }}>
                <a
                  href={onDownloadFull ? '#' : reportUrl}
                  onClick={handleClick}
                  style={{ display: 'inline-block', padding: '12px 28px', color: '#FFFFFF', fontSize: '14px', fontWeight: 700, textDecoration: 'none', fontFamily: 'Arial, Helvetica, sans-serif' }}
                >
                  View Full Report &rarr;
                </a>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Auto-generated note */}
        <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#94A3B8', lineHeight: '1.5', fontFamily: 'Arial, Helvetica, sans-serif' }}>
          This report was automatically generated by {toolName}.
        </p>

        {/* Unsubscribe */}
        <p style={{ margin: 0, fontSize: '11px', color: '#CBD5E1', fontFamily: 'Arial, Helvetica, sans-serif' }}>
          <a href="#" style={{ color: '#CBD5E1', textDecoration: 'underline', fontFamily: 'Arial, Helvetica, sans-serif' }}>Unsubscribe</a>
          &nbsp;&middot;&nbsp;
          <a href="#" style={{ color: '#CBD5E1', textDecoration: 'underline', fontFamily: 'Arial, Helvetica, sans-serif' }}>Manage preferences</a>
        </p>
      </td>
    </tr>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {{ data: {
 *   projectName: string,
 *   scanDate: string,
 *   reportUrl: string,
 *   toolName: string,
 *   accessibilityScore: number,
 *   totalIssues: number,
 *   severity: { severe: number, high: number, medium: number, low: number },
 *   scanMode: 'single' | 'site',
 *   pages?: Array<{ name: string, url: string, score: number, issueCount: number }>,
 *   topIssues: Array<{ severity: string, title: string, affectedPage: string, component: string, wcagRule: string, fix: string }>
 * }, onDownloadPagewise?: () => void, onDownloadIssues?: () => void, onDownloadFull?: () => void }} props
 */
export function EmailTemplate({ data, onDownloadPagewise, onDownloadIssues, onDownloadFull }) {
  const maxSev   = Math.max(data.severity.severe, data.severity.high, data.severity.medium, data.severity.low, 1);
  const showPages = data.scanMode === 'site' && Array.isArray(data.pages) && data.pages.length > 0;

  return (
    <div id="email-template-bg" style={{ backgroundColor: '#F1F5F9', padding: '32px 16px', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <table
        id="email-full-template"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{ maxWidth: '600px', width: '100%', margin: '0 auto', backgroundColor: '#FFFFFF', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
      >
        <tbody>
          <EmailHeader projectName={data.projectName} scanDate={data.scanDate} />

          <Divider />
          <AccessibilitySnapshot score={data.accessibilityScore} totalIssues={data.totalIssues} />

          <Divider />
          <SeveritySnapshot severity={data.severity} maxSev={maxSev} />

          <Divider />
          {showPages && (
            <>
              <LowestScoringPages pages={data.pages} onDownload={onDownloadPagewise} />
              <Divider />
            </>
          )}

          <TopIssues issues={data.topIssues} onDownload={onDownloadIssues} />

          <Divider />
          <EmailFooter reportUrl={data.reportUrl} toolName={data.toolName} onDownloadFull={onDownloadFull} />
        </tbody>
      </table>
    </div>
  );
}
