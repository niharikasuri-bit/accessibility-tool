import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmailTemplate } from './EmailTemplate.jsx';

const MOCK = {
  projectName:        'DIGIT HCM Portal',
  scanDate:           'Monday, June 16, 2026 at 9:00 AM IST',
  reportUrl:          'http://localhost:5173/site/mock-site-id/report',
  toolName:           'DIGIT Accessibility Scanner',
  accessibilityScore: 74,
  totalIssues:        23,
  severity:           { severe: 3, high: 8, medium: 9, low: 3 },
  scanMode:           'site',
  pages: [
    { name: 'Dashboard',     url: '/dashboard',      score: 52, issueCount: 8 },
    { name: 'Reports List',  url: '/reports',         score: 67, issueCount: 6 },
    { name: 'User Settings', url: '/settings/user',   score: 71, issueCount: 5 },
    { name: 'Complaints',    url: '/complaints',      score: 78, issueCount: 4 },
  ],
  topIssues: [
    {
      severity:     'severe',
      title:        'Images missing alternative text',
      affectedPage: '/dashboard',
      component:    'img.hero-banner',
      compliance:   'WCAG 2.1 1.1.1 · GIGW 3.2',
      impact:       'Screen reader users receive no information about image content, making key visuals completely inaccessible.',
      whatYouCanDo: 'Add a descriptive alt attribute to all informational images. Decorative images should use alt="".',
    },
    {
      severity:     'severe',
      title:        'Interactive elements not keyboard accessible',
      affectedPage: '/reports',
      component:    'div[role=button]',
      compliance:   'WCAG 2.1 2.1.1 · ADA Title III',
      impact:       'Keyboard-only users and switch-access users cannot activate these controls at all.',
      whatYouCanDo: 'Replace div elements used as buttons with native <button> elements, or add tabindex="0" and keydown event handlers.',
    },
    {
      severity:     'high',
      title:        'Insufficient color contrast on text',
      affectedPage: '/settings/user',
      component:    '.muted-label',
      compliance:   'WCAG 2.1 1.4.3',
      impact:       'Low-vision users and those in bright environments will struggle to read this text.',
      whatYouCanDo: 'Increase contrast ratio to at least 4.5:1 for normal text. Use a contrast checker to validate all foreground / background combinations.',
    },
    {
      severity:     'high',
      title:        'Form inputs missing associated labels',
      affectedPage: '/complaints',
      component:    'input[type=text]',
      compliance:   'WCAG 2.1 1.3.1 · GIGW 4.1',
      impact:       'Screen reader users cannot determine the purpose of these fields when navigating by form elements.',
      whatYouCanDo: 'Associate each input with a label element using the for/id attribute pair, or use aria-label / aria-labelledby.',
    },
    {
      severity:     'medium',
      title:        'Page missing main landmark region',
      affectedPage: '/dashboard',
      component:    'body',
      compliance:   'WCAG 2.1 1.3.6',
      impact:       'Screen reader users cannot skip repetitive navigation to jump directly to page content.',
      whatYouCanDo: 'Wrap the primary page content in a <main> element to help screen reader users navigate efficiently.',
    },
  ],
};

// ─── PDF generation ───────────────────────────────────────────────────────────
//
// Hides all data-pdf sections, shows only the requested ones, captures with
// html2canvas, then assembles into jsPDF. The finally block always restores
// the DOM so the preview is never left in a broken state.

async function generateEmailPdf(visibleSections, filename) {
  const bg    = document.getElementById('email-template-bg');
  const table = document.getElementById('email-full-template');
  if (!bg || !table) throw new Error('Email template not found in DOM — is the preview loaded?');

  const allRows   = table.querySelectorAll('[data-pdf]');
  const savedDisplays = new Map();

  // Hide every section row (header, footer, dividers, content sections)
  allRows.forEach((el) => {
    savedDisplays.set(el, el.style.display);
    el.style.display = 'none';
  });

  // Reveal only the requested sections
  for (const section of visibleSections) {
    const el = table.querySelector(`[data-pdf="${section}"]`);
    if (el) el.style.display = '';
  }

  try {
    const html2canvas = (await import('html2canvas')).default;
    const jsPDF       = (await import('jspdf')).jsPDF;

    const canvas  = await html2canvas(bg, {
      scale:           2,
      useCORS:         true,
      logging:         false,
      backgroundColor: '#F1F5F9',
    });

    const imgData  = canvas.toDataURL('image/png');
    const pdfW     = 210; // A4 width mm
    const pdfH     = (canvas.height / canvas.width) * pdfW;

    const pdf = new jsPDF({ unit: 'mm', format: [pdfW, Math.max(pdfH, 10)], orientation: 'portrait' });
    pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
    pdf.save(filename);
  } finally {
    // Always restore — even if html2canvas or jsPDF throws
    allRows.forEach((el) => {
      el.style.display = savedDisplays.get(el) ?? '';
    });
  }
}

// ─── Page component ───────────────────────────────────────────────────────────

export function EmailPreview() {
  const navigate = useNavigate();
  const [pdf, setPdf] = useState({ loading: false, error: null });
  const [previewType, setPreviewType] = useState('type1');
  const [type2Html, setType2Html]     = useState('');
  const [type2Loading, setType2Loading] = useState(false);
  const [type2Error, setType2Error]   = useState(null);

  const today    = new Date().toISOString().slice(0, 10);
  const safeName = MOCK.projectName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

  useEffect(() => {
    if (previewType !== 'type2') return;
    if (type2Html) return;
    setType2Loading(true);
    setType2Error(null);
    fetch('/api/schedule/email-preview?type=2')
      .then((r) => {
        if (!r.ok) throw new Error(`Server error (${r.status})`);
        return r.text();
      })
      .then((html) => { setType2Html(html); setType2Loading(false); })
      .catch((err) => { setType2Error(err?.message ?? 'Failed to load preview.'); setType2Loading(false); });
  }, [previewType, type2Html]);

  const makeHandler = (sections, filename) => async () => {
    if (pdf.loading) return;
    setPdf({ loading: true, error: null });
    try {
      await generateEmailPdf(sections, filename);
      setPdf({ loading: false, error: null });
    } catch (err) {
      console.error('[EmailPreview] PDF generation failed:', err);
      setPdf({ loading: false, error: err?.message ?? 'PDF generation failed.' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Preview toolbar */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/admin')}
              className="btn-secondary text-xs inline-flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email Preview</p>
              <p className="text-sm font-semibold text-slate-900 leading-tight">Report Delivery Template</p>
            </div>
          </div>

          {/* Type 1 / Type 2 toggle */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Report type">
              {[
                { key: 'type1', label: 'Initial Report' },
                { key: 'type2', label: 'Follow-up Report' },
              ].map((t) => {
                const active = previewType === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setPreviewType(t.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-slate-400 hidden sm:block">Mock data</span>
          </div>
        </div>
      </div>

      {/* Status banners — only shown when relevant */}
      {pdf.loading && (
        <div className="bg-blue-50 border-b border-blue-200 px-6 py-2.5 text-sm text-blue-700">
          Generating PDF&hellip; please wait.
        </div>
      )}
      {pdf.error && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 text-sm text-red-700 flex items-center justify-between">
          <span>PDF generation failed: {pdf.error}</span>
          <button
            onClick={() => setPdf({ loading: false, error: null })}
            className="ml-4 text-red-500 hover:text-red-700 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Type 1 — React component preview */}
      {previewType === 'type1' && (
        <div className="py-8">
          <EmailTemplate
            data={MOCK}
            onDownloadPagewise={makeHandler(
              ['pages-head', 'pages-body'],
              `${safeName}-pagewise-${today}.pdf`,
            )}
            onDownloadIssues={makeHandler(
              ['issues-head', 'issues-body'],
              `${safeName}-issues-${today}.pdf`,
            )}
            onDownloadFull={makeHandler(
              ['snapshot', 'severity', 'pages-head', 'pages-body', 'issues-head', 'issues-body'],
              `${safeName}-full-report-${today}.pdf`,
            )}
          />
        </div>
      )}

      {/* Type 2 — server-rendered iframe */}
      {previewType === 'type2' && (
        <div className="py-8 flex flex-col items-center">
          {type2Loading && (
            <p className="text-sm text-slate-500 mt-12">Loading follow-up report preview&hellip;</p>
          )}
          {type2Error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mt-12 max-w-md text-center">
              Failed to load preview: {type2Error}
            </div>
          )}
          {!type2Loading && !type2Error && type2Html && (
            <iframe
              title="Follow-up Report Email Preview"
              srcDoc={type2Html}
              className="w-full max-w-2xl rounded-xl shadow-lg border border-slate-200 bg-white"
              style={{ minHeight: '900px', height: 'auto' }}
              onLoad={(e) => {
                try {
                  const doc = e.target.contentDocument;
                  if (doc) e.target.style.height = doc.documentElement.scrollHeight + 'px';
                } catch {}
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
