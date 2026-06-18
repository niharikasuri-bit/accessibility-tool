/**
 * SiteReport page (/site/:siteId/report) — restructured to match ScanReport layout.
 *
 * Views: 'dashboard' | 'heatmap'
 * Heatmap receives the selected page index; screenshot URL is per-page.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePollingSite } from '../lib/usePollingSite.js';
import { getSiteExportUrl, getSitePdfUrl, getSiteScreenshotUrl } from '../lib/api.js';
import { StandardsBreakdown } from '../components/StandardsBreakdown.jsx';

// ─── Severity helpers (mirrors ScanReport) ────────────────────────────────────

const SEV_MAP = {
  'Needs Immediate Fix': { display: 'Severe', key: 'critical', order: 0 },
  'Important':           { display: 'High',   key: 'serious',  order: 1 },
  'Can Improve':         { display: 'Medium', key: 'moderate', order: 2 },
  'Minor':               { display: 'Low',    key: 'minor',    order: 3 },
};

const SEV_PILL = {
  'Needs Immediate Fix': 'pill-critical',
  'Important':           'pill-serious',
  'Can Improve':         'pill-moderate',
  'Minor':               'pill-minor',
};

const SEV_KPI = {
  critical: { bg: 'bg-critical-bg',  border: 'border-critical-border',  text: 'text-critical-text'  },
  serious:  { bg: 'bg-serious-bg',   border: 'border-serious-border',   text: 'text-serious-text'   },
  moderate: { bg: 'bg-moderate-bg',  border: 'border-moderate-border',  text: 'text-moderate-text'  },
  minor:    { bg: 'bg-minor-bg',     border: 'border-minor-border',     text: 'text-minor-text'     },
};

const HEATMAP_COLORS = {
  'Needs Immediate Fix': { stroke: '#991b1b', fill: 'rgba(220,38,38,0.22)'  },
  'Important':           { stroke: '#9a3412', fill: 'rgba(234,88,12,0.22)'  },
  'Can Improve':         { stroke: '#92400e', fill: 'rgba(202,138,4,0.22)'  },
  'Minor':               { stroke: '#1e40af', fill: 'rgba(37,99,235,0.15)'  },
};

function sevDisplay(sev)   { return SEV_MAP[sev]?.display ?? sev; }
function sevPill(sev)      { return SEV_PILL[sev] ?? 'pill-minor'; }
function sevOrder(sev)     { return SEV_MAP[sev]?.order ?? 99; }

function issueComplianceRules(issue) {
  if (!issue.standards) return 'Internal';
  const parts = [];
  if (issue.standards.wcag?.length)   parts.push(`WCAG 2.1 ${issue.standards.wcag.join(', ')}`);
  if (issue.standards.gigw?.length)   parts.push(`GIGW ${issue.standards.gigw.join(', ')}`);
  if (issue.standards.sesmag?.length) parts.push(`SesMag ${issue.standards.sesmag.join(', ')}`);
  if (issue.standards.ada?.length)    parts.push(`ADA Title III ${issue.standards.ada.join(', ')}`);
  return parts.length ? parts.join(' · ') : 'Internal';
}

function issueComponent(issue) {
  const sel = issue.targets?.[0]?.selector ?? '';
  if (!sel) return '—';
  return sel.length > 42 ? sel.slice(0, 39) + '…' : sel;
}

function scoreColor(score) {
  if (score >= 90) return 'text-statusOk';
  if (score >= 70) return 'text-statusWarn';
  return 'text-statusBad';
}

const SCORE_LEGEND = [
  { label: 'Excellent', range: '90–100', bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  { label: 'Moderate',  range: '70–89',  bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  { label: 'Poor',      range: '0–69',   bg: 'bg-red-100',   text: 'text-red-700',   dot: 'bg-red-500'   },
];

function scoreBadge(score) {
  if (score >= 90) return SCORE_LEGEND[0];
  if (score >= 70) return SCORE_LEGEND[1];
  return SCORE_LEGEND[2];
}

function pageLabel(url) {
  if (!url) return '—';
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '');
    return path || u.hostname;
  } catch {
    return String(url).split('/').pop() || url;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function SiteReport() {
  const { siteId } = useParams();
  const { site, error } = usePollingSite(siteId);
  const [view, setView]                     = useState('dashboard');
  const [heatmapPageIndex, setHeatmapPageIndex] = useState(0);
  if (error)  return <NotFoundCard siteId={siteId} />;
  if (!site)  return <LoadingCard label="Loading report…" />;
  if (site.status === 'queued' || site.status === 'running')
    return <StillRunningCard siteId={siteId} status={site.status} />;
  if (site.status === 'failed')
    return <FailedCard siteId={siteId} error={site.error} />;

  const report = site.report;
  if (!report) return <LoadingCard label="Report not ready yet…" />;

  const pages   = report.pages   ?? [];
  const issues  = report.issues  ?? [];
  const summary = report.summary ?? {};

  const openHeatmap = (pageIndex) => { setHeatmapPageIndex(pageIndex); setView('heatmap'); };

  if (view === 'heatmap') {
    const page = pages[heatmapPageIndex];
    return (
      <HeatmapView
        screenshotUrl={getSiteScreenshotUrl(siteId, heatmapPageIndex)}
        nativeWidth={page?.screenshot?.width}
        nativeHeight={page?.screenshot?.height}
        issues={page?.issues ?? []}
        pageName={page?.url ?? ''}
        onBack={() => setView('dashboard')}
      />
    );
  }

  return (
    <DashboardView
      site={site}
      report={report}
      pages={pages}
      issues={issues}
      summary={summary}
      siteId={siteId}
      onViewScreenshot={openHeatmap}
    />
  );
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

function DashboardView({ site, report, pages, issues, summary, siteId, onViewScreenshot }) {
  const sevKpis = [
    { label: 'Severe', key: 'critical', count: summary.critical ?? 0 },
    { label: 'High',   key: 'serious',  count: summary.serious  ?? 0 },
    { label: 'Medium', key: 'moderate', count: summary.moderate ?? 0 },
    { label: 'Low',    key: 'minor',    count: summary.minor    ?? 0 },
  ];

  const m = report.meta ?? {};

  return (
    <div className="space-y-8">
      <ReportHeader site={site} siteId={siteId} />

      <HowToReadBox />

      <Divider />

      {/* 1. Key Insight Summary */}
      <section aria-label="Key insight">
        <p className="text-slate-700 leading-relaxed text-base max-w-3xl">
          {report.summaryText || report.keySummary}
        </p>
      </section>

      <Divider />

      {/* 2. Accessibility Snapshot */}
      <section aria-labelledby="snapshot-heading">
        <SectionLabel id="snapshot-heading">Accessibility Snapshot</SectionLabel>
        <div className="grid grid-cols-2 gap-4">
          <KpiCard
            label="Overall Score"
            value={`${report.overallScore ?? 0} / 100`}
            valueClass={scoreColor(report.overallScore ?? 0)}
          >
            <ScoreLegend score={report.overallScore ?? 0} />
          </KpiCard>
          <KpiCard
            label="Total Issues"
            value={summary.totalIssues ?? issues.length}
          />
        </div>
      </section>

      <Divider />

      {/* 3. Compliance Detail */}
      <section aria-labelledby="compliance-heading">
        <SectionLabel id="compliance-heading">Compliance Detail</SectionLabel>
        <StandardsBreakdown breakdown={report.standardsBreakdown} />
      </section>

      <Divider />

      {/* 4. Severity Snapshot */}
      <section aria-labelledby="severity-heading">
        <SectionLabel id="severity-heading">Severity Snapshot</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {sevKpis.map((s) => {
            const cls = SEV_KPI[s.key];
            return (
              <div key={s.key} className={`rounded-xl border p-5 ${cls.bg} ${cls.border}`}>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${cls.text}`}>{s.label}</p>
                <p className={`text-4xl font-bold tabular-nums ${cls.text}`}>{s.count}</p>
              </div>
            );
          })}
        </div>
      </section>

      <Divider />

      {/* 5. Page-wise Detail */}
      <section aria-labelledby="pagewise-heading">
        <SectionLabel id="pagewise-heading">Page-wise Detail</SectionLabel>
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <table className="w-full text-sm [&_th:not(:last-child)]:border-r [&_td:not(:last-child)]:border-r [&_th]:border-slate-200 [&_td]:border-slate-200">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <Th>Page URL</Th>
                <Th>Score</Th>
                <Th>Issue Count</Th>
                <Th>Issue Screenshot</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pages.map((page, i) => (
                <PageRow
                  key={`${page.url}-${i}`}
                  page={page}
                  index={i}
                  onViewScreenshot={onViewScreenshot}
                />
              ))}
              {pages.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                    No pages scanned.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Divider />

      {/* 6. Issue List */}
      <IssueTable issues={issues} />
    </div>
  );
}

function PageRow({ page, index, onViewScreenshot }) {
  const hasData = Boolean(page.summary);

  if (!hasData) {
    return (
      <tr className="bg-slate-50/60">
        <td className="px-4 py-3">
          <code className="text-xs font-mono text-slate-500 break-all">{page.url}</code>
          {page.landed && page.landed !== page.url && (
            <p className="text-[11px] text-slate-400 mt-0.5 font-mono">→ {page.landed}</p>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-amber-600 font-medium">Couldn't load</td>
        <td className="px-4 py-3 text-slate-400">—</td>
        <td className="px-4 py-3 text-slate-400">—</td>
      </tr>
    );
  }

  const hasScreenshot = Boolean(page.screenshot?.width && page.screenshot?.height);

  return (
    <tr
      className={`transition-colors ${hasScreenshot ? 'hover:bg-brand-50 cursor-pointer' : ''}`}
      onClick={hasScreenshot ? () => onViewScreenshot(index) : undefined}
      title={hasScreenshot ? 'Click to view issue screenshot' : undefined}
    >
      <td className="px-4 py-3">
        <code className="text-xs font-mono text-slate-700 break-all">{page.url}</code>
      </td>
      <td className="px-4 py-3">
        <span className={`text-sm font-bold tabular-nums ${scoreColor(page.score ?? 0)}`}>
          {page.score ?? '—'} / 100
        </span>
      </td>
      <td className="px-4 py-3 font-semibold text-slate-900">
        {page.summary?.totalIssues ?? (page.issues?.length ?? 0)}
      </td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        {hasScreenshot ? (
          <button
            onClick={() => onViewScreenshot(index)}
            className="text-xs font-medium text-brand-500 hover:text-brand-600 border border-brand-500 hover:border-brand-600 px-2.5 py-1 rounded-md transition-colors whitespace-nowrap"
          >
            View Screenshot
          </button>
        ) : (
          <span className="text-xs text-slate-400">No screenshot</span>
        )}
      </td>
    </tr>
  );
}

// ─── Heatmap View (same 70/30 pattern as ScanReport) ─────────────────────────

function HeatmapView({ screenshotUrl, nativeWidth, nativeHeight, issues, pageName, onBack }) {
  const containerRef  = useRef(null);
  const issueRefs     = useRef({});
  const [renderedWidth, setRenderedWidth] = useState(0);
  const [imgLoaded, setImgLoaded]         = useState(false);
  const [imgError, setImgError]           = useState(false);
  const [activeIssueId, setActiveIssueId] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const measure = () => setRenderedWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allBoxes = useMemo(() =>
    issues.flatMap((iss, i) =>
      (iss.targets ?? [])
        .filter((t) => t.boundingBox)
        .map((t, j) => ({
          id:       `${iss.ruleId}-${i}-${j}`,
          ruleId:   iss.ruleId,
          issue:    iss,
          bbox:     t.boundingBox,
          selector: t.selector,
        }))
    // Minor renders first (behind); Severe renders last (on top, receives clicks)
    ).sort((a, b) => sevOrder(b.issue.severity) - sevOrder(a.issue.severity)),
    [issues]
  );

  const sortedIssues = useMemo(() =>
    [...issues].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity)),
    [issues]
  );

  const handleBoxClick = (box) => {
    const id = box.ruleId;
    setActiveIssueId((cur) => (cur === id ? null : id));
    setTimeout(() => {
      issueRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  };

  const noScreenshot = !nativeWidth || !nativeHeight || imgError;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button onClick={onBack} className="btn-secondary text-sm inline-flex items-center gap-1.5">
          ← Back to Report
        </button>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {Object.entries(HEATMAP_COLORS).map(([sev, col]) => (
            <span key={sev} className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="inline-block h-3 w-4 rounded-sm border" style={{ background: col.fill, borderColor: col.stroke }} />
              {sevDisplay(sev)}
            </span>
          ))}
        </div>
      </div>

      {noScreenshot ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-4xl mb-3" aria-hidden="true">📷</p>
          <p className="text-sm font-semibold text-slate-900">Screenshot not available</p>
          <p className="text-xs text-slate-500 mt-1">The screenshot was not captured for this page.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden flex" style={{ height: '82vh' }}>
          {/* 70% screenshot */}
          <div ref={containerRef} className="bg-slate-100 overflow-auto" style={{ flex: '0 0 70%', width: '70%' }}>
            <div className="relative">
              <img
                src={screenshotUrl}
                alt={`Screenshot of ${pageName}`}
                className="block w-full h-auto"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
              />
              {imgLoaded && renderedWidth > 0 && allBoxes.length > 0 && (
                <svg
                  viewBox={`0 0 ${nativeWidth} ${nativeHeight}`}
                  preserveAspectRatio="xMinYMin meet"
                  className="absolute inset-0 w-full h-full"
                  aria-hidden="true"
                >
                  {allBoxes.map((box) => {
                    const col      = HEATMAP_COLORS[box.issue.severity] ?? HEATMAP_COLORS['Minor'];
                    const isActive = activeIssueId === box.ruleId;
                    if (activeIssueId !== null && !isActive) return null;
                    return (
                      <rect
                        key={box.id}
                        x={box.bbox.x}
                        y={box.bbox.y}
                        width={box.bbox.width}
                        height={box.bbox.height}
                        stroke={col.stroke}
                        strokeWidth={isActive ? 8 : 3}
                        strokeOpacity={isActive ? 1 : 0.65}
                        fill={isActive ? col.fill.replace('0.22', '0.45').replace('0.15', '0.35') : col.fill}
                        style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                        onClick={() => handleBoxClick(box)}
                      />
                    );
                  })}
                </svg>
              )}
              {!imgLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-100" style={{ minHeight: 200 }}>
                  <p className="text-sm text-slate-500 animate-pulse">Loading screenshot…</p>
                </div>
              )}
            </div>
          </div>

          {/* 30% issue list */}
          <aside className="border-l border-slate-200 bg-white overflow-y-auto flex flex-col" style={{ flex: '0 0 30%', width: '30%' }}>
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 sticky top-0 z-10">
              <p className="text-sm font-semibold text-slate-900">Issue Details</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {issues.length} issues — click a region to highlight
              </p>
            </div>
            <div className="divide-y divide-slate-100 flex-1">
              {sortedIssues.map((iss) => {
                const isActive = activeIssueId === iss.ruleId;
                return (
                  <div
                    key={iss.ruleId}
                    ref={(el) => { issueRefs.current[iss.ruleId] = el; }}
                    onClick={() => setActiveIssueId((cur) => (cur === iss.ruleId ? null : iss.ruleId))}
                    className={`px-4 py-3 cursor-pointer transition-colors ${isActive ? 'bg-brand-50 border-l-2 border-brand-500' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={sevPill(iss.severity)}>{sevDisplay(iss.severity)}</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-900 leading-snug mb-1.5">{iss.title}</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">{iss.whyItMatters}</p>
                    {isActive && (
                      <div className="mt-2 pt-2 border-t border-slate-200 space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">Compliance</p>
                        <p className="text-[11px] text-slate-600">{issueComplianceRules(iss)}</p>
                        <div className="bg-green-50 border-l-2 border-green-400 rounded-r px-2 py-1.5 mt-1">
                          <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-0.5">Fix</p>
                          <p className="text-[11px] text-green-900 leading-relaxed">{iss.whatYouCanDo}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {sortedIssues.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-400">No issues found for this page.</div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ─── Issue Table ──────────────────────────────────────────────────────────────

function IssueTable({ issues }) {
  const [search,     setSearch]     = useState('');
  const [filterSev,  setFilterSev]  = useState('All');
  const [filterRule, setFilterRule] = useState('All');

  const sorted = useMemo(() =>
    [...issues].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity)),
    [issues]
  );

  const ruleOptions = useMemo(() => {
    const cats = new Set();
    sorted.forEach((iss) => {
      if (iss.standards?.wcag?.length)   cats.add('WCAG 2.1');
      if (iss.standards?.gigw?.length)   cats.add('GIGW');
      if (iss.standards?.sesmag?.length) cats.add('SesMag');
      if (iss.standards?.ada?.length)    cats.add('ADA Title III');
    });
    return ['All', ...Array.from(cats)];
  }, [sorted]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sorted.filter((iss) => {
      if (filterSev !== 'All' && sevDisplay(iss.severity) !== filterSev) return false;
      if (filterRule !== 'All') {
        const ruleKey = { 'WCAG 2.1': 'wcag', 'GIGW': 'gigw', 'SesMag': 'sesmag', 'ADA Title III': 'ada' }[filterRule];
        if (!iss.standards?.[ruleKey]?.length) return false;
      }
      if (q && !iss.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sorted, filterSev, filterRule, search]);

  return (
    <section aria-labelledby="issues-heading">
      <SectionLabel id="issues-heading">Issue List</SectionLabel>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="search"
          placeholder="Search issue titles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-44 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="Search issues"
        />
        <select
          value={filterSev}
          onChange={(e) => setFilterSev(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="Filter by severity"
        >
          {['All', 'Severe', 'High', 'Medium', 'Low'].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select
          value={filterRule}
          onChange={(e) => setFilterRule(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="Filter by compliance rule"
        >
          {ruleOptions.map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-3xl mb-2" aria-hidden="true">✨</p>
          <p className="text-sm font-medium text-slate-900">No issues match your filters</p>
          <p className="text-xs text-slate-500 mt-1">Try adjusting the search or filter selections.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px] [&_th:not(:last-child)]:border-r [&_td:not(:last-child)]:border-r [&_th]:border-slate-200 [&_td]:border-slate-200">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <Th>Issue Title</Th>
                <Th>Severity</Th>
                <Th>Affected Component</Th>
                <Th>Compliance Rule</Th>
                <Th>Impact</Th>
                <Th>Recommended Fix</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((iss, i) => (
                <tr key={`${iss.ruleId}-${i}`} className="transition-colors align-top bg-white hover:bg-slate-50">
                  <td className="px-4 py-3 max-w-[220px]">
                    <div className="flex items-start gap-2">
                      <span className="text-base leading-none mt-0.5 flex-shrink-0" aria-hidden="true">{iss.icon}</span>
                      <span className="font-medium text-slate-900 leading-snug">{iss.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={sevPill(iss.severity)}>{sevDisplay(iss.severity)}</span>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-600 max-w-[160px]">
                    <span title={iss.targets?.[0]?.selector ?? ''}>{issueComponent(iss)}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-[150px] leading-relaxed">
                    {issueComplianceRules(iss)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-[220px] leading-relaxed">
                    {iss.whyItMatters}
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <div className="bg-green-50 border-l-2 border-green-400 rounded-r-md px-3 py-2">
                      <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-1">Fix</p>
                      <p className="text-xs text-green-900 leading-relaxed">{iss.whatYouCanDo}</p>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
            <p className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-700">{filtered.length}</span> of{' '}
              <span className="font-semibold text-slate-700">{issues.length}</span> issues · sorted by severity
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Report Header ────────────────────────────────────────────────────────────

function ReportHeader({ site, siteId }) {
  const m = site.report?.meta ?? {};
  return (
    <header className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-brand-500 font-semibold mb-1">
            Whole-site Accessibility Report
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            {m.scannedPageCount ?? 0} of {m.urlCount ?? 0} pages scanned
          </h1>
        </div>
        <DownloadMenu siteId={siteId} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>Scan <code className="font-mono text-slate-700">{site.siteId}</code></span>
        {site.finishedAt && <span>· Completed {new Date(site.finishedAt).toLocaleString()}</span>}
        {m.statesScanned != null && <span>· {m.statesScanned} states audited</span>}
        {site.report?.summary?.totalIssues != null && (
          <span>· {site.report.summary.totalIssues} distinct issue types</span>
        )}
        {m.failedPageCount > 0 && (
          <span className="text-amber-700">
            · {m.failedPageCount} page{m.failedPageCount === 1 ? '' : 's'} couldn't load
          </span>
        )}
        <Link to="/" className="ml-auto text-brand-500 hover:text-brand-600 font-medium">New scan →</Link>
      </div>
    </header>
  );
}

// ─── Download Menu ────────────────────────────────────────────────────────────

function DownloadMenu({ siteId }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn-secondary text-sm inline-flex items-center gap-1.5"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <DownloadIcon /> Download ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden min-w-[170px]">
            <a
              href={getSiteExportUrl(siteId)}
              download
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <DownloadIcon /> Download JSON
            </a>
            <a
              href={getSitePdfUrl(siteId)}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100"
            >
              <DownloadIcon /> Download PDF
            </a>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Shared small components ──────────────────────────────────────────────────

function SectionLabel({ id, children }) {
  return (
    <h2 id={id} className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
      {children}
    </h2>
  );
}

function Divider() {
  return <hr className="border-t border-slate-200" />;
}

function HowToReadBox() {
  const [visible, setVisible] = useState(() => localStorage.getItem('howToReadDismissed') !== '1');
  if (!visible) return null;
  const dismiss = () => { localStorage.setItem('howToReadDismissed', '1'); setVisible(false); };
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-start gap-4" role="note">
      <svg className="flex-shrink-0 mt-0.5 text-blue-500" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-blue-900 mb-1">How to read this report</p>
        <p className="text-sm text-blue-800 leading-relaxed">
          This report summarises the accessibility audit findings for your website. The <strong>Accessibility Score</strong> reflects overall compliance health. <strong>Compliance Detail</strong> shows how well your site meets each standard. The <strong>Severity Snapshot</strong> breaks down issues by urgency. Use the <strong>Page-wise</strong> table to drill into individual pages, and the <strong>Issue List</strong> to explore, filter, and prioritise fixes.
        </p>
        <div className="mt-3 pt-3 border-t border-blue-200 flex items-center gap-6">
          {SCORE_LEGEND.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <span className={`text-xs font-semibold ${s.text}`}>{s.label}</span>
              <span className="text-xs text-blue-600">{s.range}</span>
            </div>
          ))}
        </div>
      </div>
      <button
        onClick={dismiss}
        className="flex-shrink-0 text-blue-400 hover:text-blue-700 transition-colors p-0.5 rounded"
        aria-label="Dismiss"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

function ScoreLegend({ score }) {
  const badge = scoreBadge(score);
  return (
    <div className="mt-3">
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    </div>
  );
}

function KpiCard({ label, value, valueClass = 'text-slate-900', children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-4xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {children}
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Loading / Error states ───────────────────────────────────────────────────

function LoadingCard({ label }) {
  return (
    <div className="card animate-pulse text-center py-12">
      <div className="h-3 bg-slate-200 rounded w-48 mx-auto mb-2" />
      <p className="text-sm text-slate-500 mt-3">{label}</p>
    </div>
  );
}

function StillRunningCard({ siteId, status }) {
  return (
    <div className="card text-center py-10">
      <p className="text-3xl mb-3" aria-hidden="true">⏳</p>
      <h2 className="text-lg font-semibold text-slate-900">Scan still {status}</h2>
      <p className="text-sm text-slate-600 mt-1 mb-4">The report is not ready yet.</p>
      <Link to={`/site/${siteId}`} className="btn-secondary inline-flex">View progress</Link>
    </div>
  );
}

function FailedCard({ siteId, error }) {
  return (
    <div className="card text-center py-10">
      <p className="text-3xl mb-3" aria-hidden="true">⚠️</p>
      <h2 className="text-lg font-semibold text-slate-900">No report — scan failed</h2>
      <p className="text-sm text-slate-600 mt-1 mb-4 max-w-md mx-auto">
        {error?.message ?? 'The scan did not complete. Start a new scan and try again.'}
      </p>
      <div className="flex items-center justify-center gap-2">
        <Link to={`/site/${siteId}`} className="btn-secondary">View progress</Link>
        <Link to="/" className="btn-primary">Start a new scan</Link>
      </div>
    </div>
  );
}

function NotFoundCard({ siteId }) {
  return (
    <div className="card text-center py-12">
      <p className="text-3xl mb-3" aria-hidden="true">🔍</p>
      <h2 className="text-lg font-semibold text-slate-900">Site scan not found</h2>
      <p className="text-sm text-slate-600 mt-1 mb-4">
        No site scan with id <code className="font-mono">{siteId}</code> exists.
      </p>
      <Link to="/" className="btn-primary inline-flex">Start a new scan</Link>
    </div>
  );
}
