import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthConfigPanel }   from '../../components/AuthConfigPanel.jsx';
import { DigitPresetButton } from '../../components/DigitPresetButton.jsx';
import { syncSchedule, resetEmailState } from '../../lib/api.js';
import { getProject, getProjects, saveProject, newProjectId, getSettings } from '../../lib/adminStore.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isLikelyUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try { const u = new URL(value.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

function parseUrls(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s ?? '').trim());
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function to12h(time24) {
  const [hStr = '09', mStr = '00'] = (time24 ?? '09:00').split(':');
  const h24  = parseInt(hStr, 10);
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12  = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return { h: h12, m: mStr, ampm };
}

function to24h(h12, m, ampm) {
  let h24 = parseInt(String(h12), 10);
  if (ampm === 'PM' && h24 !== 12) h24 += 12;
  if (ampm === 'AM' && h24 === 12) h24  = 0;
  return `${String(h24).padStart(2, '0')}:${m}`;
}

const NTH_LABELS = { first: 'first', second: 'second', third: 'third', fourth: 'fourth', last: 'last' };
const DAY_LABELS  = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

const DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const TIMEZONES = [
  { value: 'Asia/Kolkata',       label: 'IST — Asia/Kolkata (UTC+5:30)' },
  { value: 'UTC',                label: 'UTC' },
  { value: 'America/New_York',   label: 'ET — America/New_York' },
  { value: 'America/Chicago',    label: 'CT — America/Chicago' },
  { value: 'America/Los_Angeles',label: 'PT — America/Los_Angeles' },
  { value: 'Europe/London',      label: 'GMT/BST — Europe/London' },
  { value: 'Europe/Berlin',      label: 'CET — Europe/Berlin' },
  { value: 'Asia/Singapore',     label: 'SGT — Asia/Singapore (UTC+8)' },
  { value: 'Asia/Tokyo',         label: 'JST — Asia/Tokyo (UTC+9)' },
  { value: 'Australia/Sydney',   label: 'AEST — Australia/Sydney' },
];

// ─── Schedule-aware time helpers ─────────────────────────────────────────────

function getNowInTz(timezone) {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hour12: false,
      weekday: 'short',
    }).formatToParts(now);
    const get = (t) => (parts.find(({ type }) => type === t) ?? {}).value ?? '0';
    const h = parseInt(get('hour'), 10);
    return {
      hour:    h === 24 ? 0 : h,
      minute:  parseInt(get('minute'), 10),
      day:     parseInt(get('day'), 10),
      weekday: get('weekday').slice(0, 3).toLowerCase(),
    };
  } catch {
    return {
      hour:    now.getHours(),
      minute:  now.getMinutes(),
      day:     now.getDate(),
      weekday: ['sun','mon','tue','wed','thu','fri','sat'][now.getDay()],
    };
  }
}

const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function computeScheduleWarnings({ frequency, time, timezone, daysOfWeek, monthlyType, monthlyDay }) {
  const w = {};
  try {
    const now = getNowInTz(timezone);
    const [hStr = '9', mStr = '0'] = (time ?? '09:00').split(':');
    const schedMins = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
    const nowMins   = now.hour * 60 + now.minute;

    if (frequency === 'today') {
      if (nowMins >= schedMins) {
        w.time = 'This time has already passed today. Please select a future time or switch to Daily.';
        w.todayBlocking = true;
      }
    }

    if (frequency === 'daily') {
      const diff = schedMins - nowMins;
      if (diff >= 0 && diff <= 5) {
        w.time = "This time is very soon. The first scan will run at this time tomorrow if today's window has passed.";
      }
    }

    if (frequency === 'weekly' && daysOfWeek.length > 0) {
      const todayIdx = DAY_ORDER.indexOf(now.weekday);
      if (todayIdx >= 0) {
        const hasFuture = daysOfWeek.some((day) => {
          const idx = DAY_ORDER.indexOf(day);
          return idx > todayIdx || (idx === todayIdx && schedMins > nowMins);
        });
        if (!hasFuture) {
          const nextDay = [...daysOfWeek].sort((a, b) => {
            const ai = (DAY_ORDER.indexOf(a) - todayIdx + 7) % 7 || 7;
            const bi = (DAY_ORDER.indexOf(b) - todayIdx + 7) % 7 || 7;
            return ai - bi;
          })[0];
          w.daysOfWeek = `This week's occurrence has passed. First scan will run next ${DAY_LABELS[nextDay] ?? nextDay}.`;
        }
      }
    }

    if (frequency === 'monthly' && monthlyType === 'day') {
      if (monthlyDay < now.day || (monthlyDay === now.day && schedMins <= nowMins)) {
        w.monthlyDay = `This month's date has passed. First scan will run on day ${monthlyDay} next month.`;
      }
      if (monthlyDay >= 29) {
        w.monthlyDayShort = "Some months don't have this date — scans will be skipped in shorter months.";
      }
    }
  } catch { /* ignore invalid timezone or parse errors */ }
  return w;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminProjectForm() {
  const navigate     = useNavigate();
  const { projectId } = useParams();
  const isEdit       = Boolean(projectId);

  // ── Metadata
  const [projectName, setProjectName] = useState('');

  // ── Scan configuration
  const [scanMode,     setScanMode]     = useState('single');
  const [url,          setUrl]          = useState('');
  const [urlsText,     setUrlsText]     = useState('');
  const [waitSelector, setWaitSelector] = useState('');
  const [timeoutSec,   setTimeoutSec]   = useState('');
  const [authState,    setAuthState]    = useState({ type: 'none', config: null, hasErrors: false });
  const [authPreset,   setAuthPreset]   = useState(null);
  const [urlTouched,   setUrlTouched]   = useState(false);

  // ── People & recipients
  const [productOwner, setProductOwner] = useState({ name: '', email: '' });
  const [members,      setMembers]      = useState([]);
  const [ccList,       setCcList]       = useState([]);

  // ── Schedule
  const [frequency,      setFrequency]      = useState('weekly');
  const [time,           setTime]           = useState('09:00');
  const [timezone,       setTimezone]       = useState('Asia/Kolkata');
  const [daysOfWeek,     setDaysOfWeek]     = useState(['mon']);
  const [monthlyType,    setMonthlyType]    = useState('day');
  const [monthlyDay,     setMonthlyDay]     = useState(15);
  const [monthlyNth,     setMonthlyNth]     = useState('first');
  const [monthlyWeekday, setMonthlyWeekday] = useState('mon');
  const [endRepeat,      setEndRepeat]      = useState('never');
  const [endRepeatDate,  setEndRepeatDate]  = useState('');
  const [endRepeatAfter, setEndRepeatAfter] = useState(10);

  // ── Notifications
  const [emailEnabled,  setEmailEnabled]  = useState(true);
  const [slackEnabled,  setSlackEnabled]  = useState(false);
  const [slackChannel,  setSlackChannel]  = useState('');
  const [slackWebhook,  setSlackWebhook]  = useState('');
  const [slackTestStatus, setSlackTestStatus] = useState(null);

  // ── Form state
  const [errors,      setErrors]      = useState({});
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── URL/scanMode change tracking — reset email state when these change
  const [origScan, setOrigScan] = useState(null); // { url, urlsText, scanMode }
  const urlChanged = isEdit && origScan != null && (
    url !== origScan.url || urlsText !== origScan.urlsText || scanMode !== origScan.scanMode
  );

  // Load existing project when editing
  useEffect(() => {
    if (!projectId) return;
    const p = getProject(projectId);
    if (!p) return;
    setProjectName(p.name ?? '');
    setScanMode(p.scanMode ?? 'single');
    setUrl(p.url ?? '');
    setUrlsText(p.urlsText ?? '');
    setWaitSelector(p.waitSelector ?? '');
    setTimeoutSec(p.timeoutSec ?? '');
    setProductOwner(p.productOwner ?? { name: '', email: '' });
    setMembers(p.members ?? []);
    setCcList(p.ccList ?? []);
    setFrequency(p.frequency ?? 'weekly');
    setTime(p.time ?? '09:00');
    setTimezone(p.timezone ?? 'Asia/Kolkata');
    setDaysOfWeek(p.daysOfWeek ?? (p.dayOfWeek ? [p.dayOfWeek] : ['mon']));
    setMonthlyType(p.monthlyType ?? 'day');
    setMonthlyDay(p.monthlyDay ?? p.dayOfMonth ?? 15);
    setMonthlyNth(p.monthlyNth ?? 'first');
    setMonthlyWeekday(p.monthlyWeekday ?? 'mon');
    setEndRepeat(p.endRepeat ?? 'never');
    setEndRepeatDate(p.endRepeatDate ?? '');
    setEndRepeatAfter(p.endRepeatAfter ?? 10);
    setEmailEnabled(p.emailEnabled ?? true);
    setSlackEnabled(p.slackEnabled ?? false);
    setSlackChannel(p.slackChannel ?? '');
    setSlackWebhook(p.slackWebhook ?? '');
    if (p.auth) setAuthPreset(p.auth);
    setOrigScan({ url: p.url ?? '', urlsText: p.urlsText ?? '', scanMode: p.scanMode ?? 'single' });
  }, [projectId]);

  // ── Helpers
  const handlePresetApplied = (preset) => {
    if (preset.url)             setUrl(preset.url);
    if (preset.waitForSelector) setWaitSelector(preset.waitForSelector);
    if (preset.timeoutSec)      setTimeoutSec(String(preset.timeoutSec));
    if (preset.auth)            setAuthPreset(preset.auth);
  };

  const scheduleWarnings = computeScheduleWarnings({ frequency, time, timezone, daysOfWeek, monthlyType, monthlyDay });

  const validate = () => {
    const errs = {};
    if (!projectName.trim()) errs.name = 'Project name is required.';
    if (scanMode === 'single') {
      if (!isLikelyUrl(url)) errs.url = 'Please enter a valid URL (https://…).';
    } else {
      const urls = parseUrls(urlsText);
      if (urls.length === 0) errs.urlsText = 'Add at least one URL (one per line).';
      const bad = urls.filter((u) => !isLikelyUrl(u));
      if (bad.length > 0) errs.urlsText = `${bad.length} line${bad.length === 1 ? '' : 's'} not a valid URL.`;
    }
    if (frequency === 'weekly' && daysOfWeek.length === 0) errs.daysOfWeek = 'Select at least one day for weekly scans.';
    if (!productOwner.email.trim()) errs.ownerEmail = 'Product owner email is required.';
    else if (!isEmail(productOwner.email)) errs.ownerEmail = 'Invalid email address.';
    if (emailEnabled) {
      const validOwner  = productOwner.email.trim() && isEmail(productOwner.email);
      const validMember = members.some((m) => m.email && isEmail(m.email));
      const validCc     = ccList.some((c) => c.email && isEmail(c.email));
      if (!validOwner && !validMember && !validCc) {
        errs.recipients = 'Add at least one valid email recipient before enabling email delivery.';
      }
    }
    if (scheduleWarnings.todayBlocking) errs.scheduleTime = true;
    return errs;
  };

  const handleSave = () => {
    setUrlTouched(true);
    setErrors({});
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    const project = {
      id: projectId ?? newProjectId(),
      name: projectName.trim(),
      scanMode,
      url: url.trim(),
      urlsText: urlsText.trim(),
      waitSelector: waitSelector.trim(),
      timeoutSec,
      auth: authState.config ?? authPreset ?? null,
      productOwner,
      members,
      ccList,
      frequency,
      time,
      timezone,
      daysOfWeek,
      monthlyType,
      monthlyDay,
      monthlyNth,
      monthlyWeekday,
      endRepeat,
      endRepeatDate,
      endRepeatAfter,
      emailEnabled,
      slackEnabled,
      slackChannel,
      slackWebhook,
      status: 'active',
    };
    saveProject(project);
    // Push updated schedule to backend (fire-and-forget — don't block navigation)
    syncSchedule({
      projects:    getProjects(),
      settings:    getSettings(),
      frontendUrl: window.location.origin,
    }).catch(() => {});
    // If URL or scanMode changed, reset email state so next dispatch is Type 1
    if (isEdit && urlChanged && project.id) {
      resetEmailState(project.id).catch(() => {});
    }
    setSaveSuccess(true);
    setTimeout(() => navigate('/admin'), 1500);
  };


  // Compute recipients preview (for notifications section)
  const allRecipients = [
    productOwner.email ? `${productOwner.name || 'Product Owner'} <${productOwner.email}>` : null,
    ...members.filter((m) => m.email).map((m) => `${m.name || 'Member'} <${m.email}>`),
    ...ccList.filter((c) => c.email).map((c) => `${c.name || 'Recipient'} <${c.email}>`),
  ].filter(Boolean);

  const urlError = urlTouched
    ? (!isLikelyUrl(url) ? (errors.url ?? 'Please enter a valid URL (https://…).') : null)
    : null;

  const urlsError = urlTouched && scanMode === 'site'
    ? errors.urlsText ?? null
    : null;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate('/admin')}
          className="btn-secondary text-sm inline-flex items-center gap-1.5"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Projects
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{isEdit ? 'Edit Project' : 'Add Project'}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isEdit ? 'Update the project configuration' : 'Configure a new automated scan and report delivery'}
          </p>
        </div>
      </div>

      {urlChanged && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <svg className="mt-0.5 shrink-0 text-amber-600" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="9" x2="12" y2="13" strokeLinecap="round" />
            <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" />
          </svg>
          <p className="text-sm text-amber-800">
            Changing the URL or scan mode will reset the report to an <strong>Initial Report</strong> on the next send. All previous scan history for this project will be cleared.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* Project name */}
        <div className="card">
          <div>
            <label htmlFor="project-name" className="block text-sm font-semibold text-slate-900 mb-1.5">
              Project name <span className="text-red-500">*</span>
            </label>
            <input
              id="project-name"
              type="text"
              value={projectName}
              onChange={(e) => { setProjectName(e.target.value); setErrors((e2) => ({ ...e2, name: undefined })); }}
              placeholder="e.g. DIGIT HCM Portal"
              className={`w-full px-4 py-3 text-base border-2 rounded-lg transition-colors ${
                errors.name
                  ? 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                  : 'border-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500'
              }`}
            />
            {errors.name && <p className="text-xs text-red-600 mt-1.5">{errors.name}</p>}
          </div>
        </div>

        {/* ─── Section 1: Scan Configuration ─── */}
        <SectionCard number="1" title="Scan Configuration">
          {/* Mode toggle — pixel-identical to Home.jsx ModeTabs */}
          <div className="mb-5">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="Scan mode">
              {[{ key: 'single', label: 'Single page' }, { key: 'site', label: 'Whole site' }].map((t) => {
                const active = scanMode === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setScanMode(t.key)}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {scanMode === 'single'
                ? 'Scan a single URL.'
                : 'Scan a list of pages in one run — one combined report with a per-page breakdown.'}
            </p>
          </div>

          {/* Single page: URL input — pixel-identical to ScanForm.jsx */}
          {scanMode === 'single' && (
            <div className="space-y-5">
              <div>
                <label htmlFor="admin-scan-url" className="block text-sm font-semibold text-slate-900 mb-1.5">
                  URL to scan
                </label>
                <input
                  id="admin-scan-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => setUrlTouched(true)}
                  placeholder="https://example.gov.in/dashboard"
                  autoComplete="off"
                  className={`w-full px-4 py-3 text-base border-2 rounded-lg transition-colors ${
                    urlError
                      ? 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                      : 'border-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500'
                  }`}
                />
                {urlError ? (
                  <p className="text-xs text-red-600 mt-1.5">{urlError}</p>
                ) : (
                  <div className="flex items-center justify-between gap-3 mt-1.5">
                    <p className="text-xs text-slate-500">
                      The page to scan. For protected pages, configure authentication below.
                    </p>
                    <DigitPresetButton onApply={handlePresetApplied} />
                  </div>
                )}
              </div>
              <AuthConfigPanel onChange={setAuthState} preset={authPreset} />
              <ScanAdvancedOptions
                waitSelector={waitSelector}
                onWaitSelectorChange={setWaitSelector}
                timeoutSec={timeoutSec}
                onTimeoutChange={setTimeoutSec}
              />
            </div>
          )}

          {/* Whole site: URLs textarea — pixel-identical to SiteForm.jsx */}
          {scanMode === 'site' && (
            <div className="space-y-5">
              <div>
                <label htmlFor="admin-site-urls" className="block text-sm font-semibold text-slate-900 mb-1.5">
                  Pages to scan <span className="font-normal text-slate-400">(one URL per line)</span>
                </label>
                <textarea
                  id="admin-site-urls"
                  value={urlsText}
                  onChange={(e) => setUrlsText(e.target.value)}
                  onBlur={() => setUrlTouched(true)}
                  rows={6}
                  placeholder={'https://example.gov.in/dashboard\nhttps://example.gov.in/reports\nhttps://example.gov.in/settings'}
                  spellCheck={false}
                  className={`w-full px-4 py-3 text-sm font-mono border-2 rounded-lg transition-colors resize-y ${
                    urlsError
                      ? 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                      : 'border-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500'
                  }`}
                />
                {urlsError ? (
                  <p className="text-xs text-red-600 mt-1.5">{urlsError}</p>
                ) : (
                  <p className="text-xs text-slate-500 mt-1.5">
                    {parseUrls(urlsText).length > 0
                      ? `${parseUrls(urlsText).length} page${parseUrls(urlsText).length === 1 ? '' : 's'} queued.`
                      : 'List the pages to audit. For protected pages, configure login below.'}
                  </p>
                )}
              </div>
              <AuthConfigPanel onChange={setAuthState} preset={authPreset} />
            </div>
          )}
        </SectionCard>

        {/* ─── Section 2: People & Recipients ─── */}
        <SectionCard number="2" title="People & Recipients">
          <div className="space-y-6">
            {/* Product owner */}
            <Subsection title="Product Owner">
              <div className="grid grid-cols-2 gap-4">
                <LabeledInput label="Name" value={productOwner.name} placeholder="Full name"
                  onChange={(v) => setProductOwner((o) => ({ ...o, name: v }))} />
                <LabeledInput label="Email" type="email" value={productOwner.email} placeholder="name@org.in"
                  onChange={(v) => setProductOwner((o) => ({ ...o, email: v }))}
                  error={errors.ownerEmail} />
              </div>
            </Subsection>

            {/* Engineering team */}
            <Subsection title="Engineering Team">
              <div className="space-y-2">
                {members.map((m) => (
                  <RepeatingRow key={m.id}
                    nameVal={m.name} emailVal={m.email}
                    namePlaceholder="Member name" emailPlaceholder="member@org.in"
                    onNameChange={(v) => setMembers((list) => list.map((x) => x.id === m.id ? { ...x, name: v } : x))}
                    onEmailChange={(v) => setMembers((list) => list.map((x) => x.id === m.id ? { ...x, email: v } : x))}
                    onRemove={() => setMembers((list) => list.filter((x) => x.id !== m.id))}
                  />
                ))}
              </div>
              <button type="button" onClick={() => setMembers((l) => [...l, { id: uid(), name: '', email: '' }])}
                className="mt-2 text-xs font-medium text-brand-500 hover:text-brand-600 inline-flex items-center gap-1">
                <PlusIcon size={12} /> Add Member
              </button>
            </Subsection>

            {/* CC recipients */}
            <Subsection title="Additional Recipients (CC)">
              <div className="space-y-2">
                {ccList.map((c) => (
                  <RepeatingRow key={c.id}
                    nameVal={c.name} emailVal={c.email}
                    namePlaceholder="Name" emailPlaceholder="email@example.com"
                    onNameChange={(v) => setCcList((list) => list.map((x) => x.id === c.id ? { ...x, name: v } : x))}
                    onEmailChange={(v) => setCcList((list) => list.map((x) => x.id === c.id ? { ...x, email: v } : x))}
                    onRemove={() => setCcList((list) => list.filter((x) => x.id !== c.id))}
                  />
                ))}
              </div>
              <button type="button" onClick={() => setCcList((l) => [...l, { id: uid(), name: '', email: '' }])}
                className="mt-2 text-xs font-medium text-brand-500 hover:text-brand-600 inline-flex items-center gap-1">
                <PlusIcon size={12} /> Add CC Recipient
              </button>
            </Subsection>
          </div>
        </SectionCard>

        {/* ─── Section 3: Scan Schedule ─── */}
        <SectionCard number="3" title="Scan Schedule">
          <div className="space-y-5">

            {/* Frequency dropdown — Google Calendar style */}
            <div>
              <label htmlFor="sched-freq" className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                Repeat
              </label>
              <select
                id="sched-freq"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
              >
                <option value="today">Today</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {/* Today: non-editable date chip */}
            {frequency === 'today' && (
              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">Date</label>
                <div className="inline-flex items-center px-3 py-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg select-none">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
              </div>
            )}

            {/* Weekly: multi-select day-of-week circles */}
            {frequency === 'weekly' && (
              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-500 mb-2">Repeat on</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => {
                    const selected = daysOfWeek.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => setDaysOfWeek((prev) =>
                          prev.includes(d.key)
                            ? prev.filter((x) => x !== d.key)
                            : [...prev, d.key]
                        )}
                        aria-pressed={selected}
                        className={`w-10 h-10 text-xs font-semibold rounded-full border-2 transition-colors ${
                          selected
                            ? 'bg-brand-500 text-white border-brand-500'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400 hover:text-brand-600'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                {errors.daysOfWeek && (
                  <p className="text-xs text-red-600 mt-2">{errors.daysOfWeek}</p>
                )}
                {!errors.daysOfWeek && scheduleWarnings.daysOfWeek && (
                  <p className="text-xs text-amber-700 mt-2">{scheduleWarnings.daysOfWeek}</p>
                )}
              </div>
            )}

            {/* Monthly: "monthly on" selector */}
            {frequency === 'monthly' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="monthly-on" className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                    Monthly on
                  </label>
                  <select
                    id="monthly-on"
                    value={monthlyType}
                    onChange={(e) => setMonthlyType(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
                  >
                    <option value="day">Monthly on day {monthlyDay}</option>
                    <option value="nth-weekday">Monthly on the {NTH_LABELS[monthlyNth]} {DAY_LABELS[monthlyWeekday]}</option>
                  </select>
                </div>

                {monthlyType === 'day' && (
                  <div className="space-y-2 pl-1">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500 w-6">Day</label>
                      <select
                        value={monthlyDay}
                        onChange={(e) => setMonthlyDay(Number(e.target.value))}
                        className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                    {scheduleWarnings.monthlyDay && (
                      <p className="text-xs text-amber-700">{scheduleWarnings.monthlyDay}</p>
                    )}
                    {scheduleWarnings.monthlyDayShort && (
                      <p className="text-xs text-amber-700">{scheduleWarnings.monthlyDayShort}</p>
                    )}
                  </div>
                )}

                {monthlyType === 'nth-weekday' && (
                  <div className="flex items-center gap-2 pl-1">
                    <select
                      value={monthlyNth}
                      onChange={(e) => setMonthlyNth(e.target.value)}
                      className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
                    >
                      {['first', 'second', 'third', 'fourth', 'last'].map((n) => (
                        <option key={n} value={n}>{n.charAt(0).toUpperCase() + n.slice(1)}</option>
                      ))}
                    </select>
                    <select
                      value={monthlyWeekday}
                      onChange={(e) => setMonthlyWeekday(e.target.value)}
                      className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
                    >
                      {DAYS.map((d) => (
                        <option key={d.key} value={d.key}>{DAY_LABELS[d.key]}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Time — always shown */}
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">Time</label>
              <TimePicker value={time} onChange={setTime} />
              {scheduleWarnings.time && (
                <p className={`text-xs mt-1.5 ${scheduleWarnings.todayBlocking ? 'text-red-600' : 'text-amber-700'}`}>
                  {scheduleWarnings.time}
                </p>
              )}
            </div>

            {/* Timezone — always shown */}
            <div>
              <label htmlFor="sched-tz" className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                Timezone
              </label>
              <select
                id="sched-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>

            {/* Ends — only for repeating frequencies */}
            {frequency !== 'today' && (
              <ScheduleEnds
                endRepeat={endRepeat}
                onEndRepeatChange={setEndRepeat}
                endRepeatDate={endRepeatDate}
                onEndRepeatDateChange={setEndRepeatDate}
                endRepeatAfter={endRepeatAfter}
                onEndRepeatAfterChange={setEndRepeatAfter}
              />
            )}

          </div>
        </SectionCard>

        {/* ─── Section 4: Notifications ─── */}
        <SectionCard number="4" title="Notifications">
          <div className="space-y-5">
            {/* Email */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Email delivery</p>
                <p className="text-xs text-slate-500 mt-0.5">Send the report to all recipients after each scan</p>
              </div>
              <Toggle checked={emailEnabled} onChange={setEmailEnabled} id="email-toggle" />
            </div>

            {emailEnabled && allRecipients.length > 0 && (
              <div className="bg-slate-50 rounded-lg border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Will be sent to</p>
                <ul className="space-y-1">
                  {allRecipients.map((r, i) => (
                    <li key={i} className="text-xs text-slate-700 font-mono">{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {emailEnabled && allRecipients.length === 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No recipients configured yet — add people in Section 2.
              </p>
            )}

            {errors.recipients && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {errors.recipients}
              </p>
            )}

            <div className="border-t border-slate-200 pt-5" />

            {/* Slack */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Slack notification</p>
                <p className="text-xs text-slate-500 mt-0.5">Post a summary to a Slack channel after each scan</p>
              </div>
              <Toggle checked={slackEnabled} onChange={setSlackEnabled} id="slack-toggle" />
            </div>

            {slackEnabled && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="slack-channel" className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                    Slack channel name
                  </label>
                  <input id="slack-channel" type="text" value={slackChannel}
                    onChange={(e) => setSlackChannel(e.target.value)}
                    placeholder="#accessibility-reports"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                </div>
                <div>
                  <label htmlFor="slack-webhook" className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
                    Incoming webhook URL
                  </label>
                  <input id="slack-webhook" type="url" value={slackWebhook}
                    onChange={(e) => { setSlackWebhook(e.target.value); setSlackTestStatus(null); }}
                    placeholder="https://hooks.slack.com/services/…"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-mono text-xs" />
                </div>
                <div className="flex items-center gap-3">
                  <button type="button"
                    disabled={!slackWebhook || slackTestStatus === 'testing'}
                    onClick={async () => {
                      setSlackTestStatus('testing');
                      await new Promise((r) => setTimeout(r, 1200));
                      setSlackTestStatus('ok');
                    }}
                    className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50">
                    {slackTestStatus === 'testing' ? 'Sending…' : 'Test Connection'}
                  </button>
                  {slackTestStatus === 'ok' && (
                    <span className="text-xs text-green-700 font-medium">✓ Test message sent</span>
                  )}
                  {slackTestStatus === 'fail' && (
                    <span className="text-xs text-red-600 font-medium">Connection failed — check the webhook URL</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ─── Section 5: Nudges (placeholder) ─── */}
        <SectionCard number="5" title="Nudges">
          <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-500 uppercase tracking-wide mb-3">
              Coming Soon
            </span>
            <p className="text-sm font-medium text-slate-400">Automated nudges and reminders</p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
              Proactive alerts when scores drop below a threshold, or when critical issues aren't resolved.
            </p>
          </div>
        </SectionCard>

        {/* ─── Save success banner ─── */}
        {saveSuccess && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600 flex-shrink-0" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-sm font-medium text-green-800">Project saved. Redirecting to projects…</p>
          </div>
        )}

        {/* ─── Form actions ─── */}

        <div className="flex items-center justify-between gap-3 pt-2 pb-8">
          <button type="button" onClick={() => navigate('/admin')} className="btn-secondary">
            Cancel
          </button>
          <div className="flex items-center gap-3">

            <button type="button" onClick={handleSave} disabled={saveSuccess} className="btn-primary px-6 disabled:opacity-60">
              {saveSuccess ? 'Saved!' : 'Save Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function SectionCard({ number, title, children }) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-5">
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-xs font-bold">
          {number}
        </span>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ─── Advanced options (pixel-identical to ScanForm.jsx AdvancedOptions) ───────

function ScanAdvancedOptions({ waitSelector, onWaitSelectorChange, timeoutSec, onTimeoutChange }) {
  const [expanded, setExpanded] = useState(Boolean(waitSelector || timeoutSec));

  if (!expanded) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-sm text-brand-500 hover:text-brand-600 font-medium inline-flex items-center gap-1.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Advanced options (wait for element, scan timeout)
        </button>
        <p className="text-xs text-slate-500 mt-1">
          Recommended for authenticated DIGIT pages — set both for the most reliable scan.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Advanced options</h4>
          <p className="text-xs text-slate-500 mt-0.5">Useful for slow or protected pages.</p>
        </div>
        <button
          type="button"
          onClick={() => { setExpanded(false); onWaitSelectorChange(''); onTimeoutChange(''); }}
          className="text-slate-400 hover:text-slate-700 text-xs flex-shrink-0"
        >
          Remove
        </button>
      </div>

      <div>
        <label htmlFor="adv-wait-selector" className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
          Wait for element on target page
        </label>
        <input
          id="adv-wait-selector"
          type="text"
          value={waitSelector}
          onChange={(e) => onWaitSelectorChange(e.target.value)}
          placeholder='e.g. text=My Campaigns  or  .inventory_list  or  #dashboard-header'
          className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <p className="text-xs text-slate-500 mt-1.5">
          A CSS or Playwright selector that must be visible before the scan runs.
        </p>
      </div>

      <div>
        <label htmlFor="adv-timeout" className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
          Scan timeout <span className="text-slate-400 normal-case">(seconds)</span>
        </label>
        <input
          id="adv-timeout"
          type="number"
          min="10" max="600" step="10"
          value={timeoutSec}
          onChange={(e) => onTimeoutChange(e.target.value)}
          placeholder="e.g. 120 (default: server-configured, usually 60-120)"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>
    </div>
  );
}

// ─── Schedule sub-components ─────────────────────────────────────────────────

function TimePicker({ value, onChange }) {
  const { h, m, ampm } = to12h(value);
  const setH    = (newH)    => onChange(to24h(newH, m,    ampm));
  const setM    = (newM)    => onChange(to24h(h,    newM, ampm));
  const setAmPm = (period)  => onChange(to24h(h,    m,    period));

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={h}
        onChange={(e) => setH(parseInt(e.target.value, 10))}
        aria-label="Hour"
        className="px-2 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
      >
        {[1,2,3,4,5,6,7,8,9,10,11,12].map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <span className="text-slate-400 font-bold text-sm select-none">:</span>
      <select
        value={m}
        onChange={(e) => setM(e.target.value)}
        aria-label="Minute"
        className="px-2 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
      >
        {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map((min) => (
          <option key={min} value={min}>{min}</option>
        ))}
      </select>
      <div className="flex rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="AM or PM">
        {['AM','PM'].map((period) => (
          <button
            key={period}
            type="button"
            onClick={() => setAmPm(period)}
            aria-pressed={ampm === period}
            className={`px-3 py-2 text-xs font-semibold transition-colors ${
              ampm === period
                ? 'bg-brand-500 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {period}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScheduleEnds({ endRepeat, onEndRepeatChange, endRepeatDate, onEndRepeatDateChange, endRepeatAfter, onEndRepeatAfterChange }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-500 mb-2">Ends</label>
      <div className="space-y-2.5">
        {[
          { value: 'never', label: 'Never' },
          { value: 'on',    label: 'On' },
          { value: 'after', label: 'After' },
        ].map(({ value, label }) => (
          <label key={value} className="flex items-center gap-3 cursor-pointer min-h-[32px]">
            <input
              type="radio"
              name="sched-ends"
              value={value}
              checked={endRepeat === value}
              onChange={() => onEndRepeatChange(value)}
              className="accent-brand-500 flex-shrink-0 w-4 h-4"
            />
            <span className="text-sm text-slate-700 w-10 flex-shrink-0">{label}</span>
            {endRepeat === 'on' && value === 'on' && (
              <input
                type="date"
                value={endRepeatDate}
                onChange={(e) => onEndRepeatDateChange(e.target.value)}
                className="px-3 py-1 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            )}
            {endRepeat === 'after' && value === 'after' && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={endRepeatAfter}
                  onChange={(e) => onEndRepeatAfterChange(parseInt(e.target.value, 10) || 1)}
                  className="w-16 px-2 py-1 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-center"
                />
                <span className="text-sm text-slate-500">occurrences</span>
              </div>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Small shared sub-components ─────────────────────────────────────────────

function Subsection({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-900 uppercase tracking-wide mb-3 pb-2 border-b border-slate-100">
        {title}
      </p>
      {children}
    </div>
  );
}

function LabeledInput({ label, onChange, error, ...props }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">{label}</label>
      <input
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 text-sm border rounded-lg transition-colors ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500'
            : 'border-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500'
        }`}
        {...props}
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function RepeatingRow({ nameVal, emailVal, namePlaceholder, emailPlaceholder, onNameChange, onEmailChange, onRemove }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={nameVal}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={namePlaceholder}
        className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
      <input
        type="email"
        value={emailVal}
        onChange={(e) => onEmailChange(e.target.value)}
        placeholder={emailPlaceholder}
        className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
      <button type="button" onClick={onRemove}
        className="flex-shrink-0 text-slate-400 hover:text-red-500 transition-colors p-1 rounded"
        aria-label="Remove row"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" />
          <path d="M9 6V4h6v2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function Toggle({ checked, onChange, id }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      id={id}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        checked ? 'bg-brand-500' : 'bg-slate-200'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function PlusIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

