import { useState, useEffect } from 'react';
import { getSettings, saveSettings, getProjects } from '../../lib/adminStore.js';
import { testEmailDelivery, syncSchedule, getStorageStats } from '../../lib/api.js';

export function AdminSettings() {
  const init = getSettings();

  const [senderName,       setSenderName]       = useState(init.senderName       ?? 'DIGIT Accessibility Bot');
  const [senderEmail,      setSenderEmail]      = useState(init.senderEmail      ?? '');
  const [gmailAppPassword, setGmailAppPassword] = useState(init.gmailAppPassword ?? '');

  const [slackWebhook,  setSlackWebhook]  = useState(init.slackWebhook  ?? '');
  const [slackAppToken, setSlackAppToken] = useState(init.slackAppToken ?? '');

  const [saved,         setSaved]         = useState(false);
  const [syncError,     setSyncError]     = useState(null);
  const [testRecipient, setTestRecipient] = useState('');
  const [testStatus,    setTestStatus]    = useState(null);
  const [storage,       setStorage]       = useState(null); // { count, totalBytes } | null

  useEffect(() => {
    getStorageStats().then((s) => setStorage(s)).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSyncError(null);
    saveSettings({ senderName, senderEmail, gmailAppPassword, slackWebhook, slackAppToken });
    try {
      await syncSchedule({
        projects:    getProjects(),
        settings:    getSettings(),
        frontendUrl: window.location.origin,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSyncError('Settings saved locally but failed to sync to the server — emails may not work until the server is reachable. ' + (err.message ?? ''));
    }
  };

  const handleTest = async () => {
    if (!testRecipient || !senderEmail || !gmailAppPassword) return;
    setTestStatus('sending');
    try {
      await testEmailDelivery({
        fromName:    senderName,
        fromEmail:   senderEmail,
        appPassword: gmailAppPassword,
        toEmail:     testRecipient,
      });
      setTestStatus('ok');
    } catch (err) {
      setTestStatus(err.message ?? 'Delivery failed.');
    }
  };

  const emailReady = Boolean(senderEmail && gmailAppPassword);

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Global configuration for report delivery</p>
      </div>

      <div className="space-y-6">

        {/* ── Email ─────────────────────────────────────────────── */}
        <div className="card space-y-5">
          <div>
            <SectionHeading>Email Delivery</SectionHeading>
            <p className="text-sm text-slate-500 mt-0.5">
              Reports are sent from this Gmail or Google Workspace account.
            </p>
          </div>

          <LabeledInput
            id="sender-name"
            label="Sender name"
            value={senderName}
            onChange={setSenderName}
            placeholder="DIGIT Accessibility Bot"
          />
          <LabeledInput
            id="sender-email"
            label="Sender email"
            type="email"
            value={senderEmail}
            onChange={setSenderEmail}
            placeholder="accessibility@digit.org"
          />
          <div>
            <LabeledInput
              id="gmail-pass"
              label="Email password"
              type="password"
              value={gmailAppPassword}
              onChange={setGmailAppPassword}
              placeholder="••••••••••••••••"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Use an App Password if 2-Step Verification is on —{' '}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-slate-600"
              >
                generate one here
              </a>.
            </p>
          </div>

          {/* Test delivery */}
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Test delivery</p>
            <div className="flex items-center gap-3">
              <input
                type="email"
                value={testRecipient}
                onChange={(e) => { setTestRecipient(e.target.value); setTestStatus(null); }}
                placeholder="Send test to…"
                className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                disabled={!testRecipient || !emailReady || testStatus === 'sending'}
                onClick={handleTest}
                className="btn-secondary text-sm px-4 py-2 disabled:opacity-50 whitespace-nowrap"
              >
                {testStatus === 'sending' ? 'Sending…' : 'Send Test'}
              </button>
            </div>
            {testStatus === 'ok' && (
              <p className="text-xs text-green-700 font-medium mt-2">✓ Test email sent — check your inbox.</p>
            )}
            {testStatus && testStatus !== 'ok' && testStatus !== 'sending' && (
              <p className="text-xs text-red-600 mt-2">{testStatus}</p>
            )}
            {!emailReady && (
              <p className="text-xs text-amber-700 mt-2">Enter sender email and password to enable delivery.</p>
            )}
          </div>
        </div>

        {/* ── Slack ─────────────────────────────────────────────── */}
        <div className="card">
          <SectionHeading>Slack Integration</SectionHeading>
          <p className="text-sm text-slate-500 mt-0.5 mb-4">
            Global Slack configuration. Per-project channels are set in each project.
          </p>
          <div className="space-y-4">
            <LabeledInput
              id="slack-token"
              label="Slack app token (optional)"
              value={slackAppToken}
              onChange={setSlackAppToken}
              placeholder="xoxb-…"
            />
            <LabeledInput
              id="slack-webhook"
              label="Default incoming webhook URL"
              type="url"
              value={slackWebhook}
              onChange={setSlackWebhook}
              placeholder="https://hooks.slack.com/services/…"
            />
            <p className="text-xs text-slate-500">
              Projects can override this with their own webhook URL in project settings.
            </p>
          </div>
        </div>

        {/* ── Storage ───────────────────────────────────────────── */}
        {storage != null && (
          <div className="card">
            <SectionHeading>PDF Storage</SectionHeading>
            <p className="text-sm text-slate-500 mt-0.5 mb-4">
              Locally-stored report PDFs (last 5 sends per project are kept).
            </p>
            <div className="flex items-center gap-8">
              <div>
                <p className="text-2xl font-bold text-slate-900">{storage.count}</p>
                <p className="text-xs text-slate-500 mt-0.5">PDF files</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{formatBytes(storage.totalBytes)}</p>
                <p className="text-xs text-slate-500 mt-0.5">estimated size</p>
              </div>
            </div>
            {storage.totalBytes > 200 * 1024 * 1024 && (
              <p className="text-xs text-amber-700 mt-3 font-medium">
                Storage is over 200 MB. Old project data may be accumulating.
              </p>
            )}
          </div>
        )}

        {/* ── Save ──────────────────────────────────────────────── */}
        {syncError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">{syncError}</p>
          </div>
        )}

        <div className="flex items-center gap-3 pb-8">
          <button onClick={handleSave} className="btn-primary px-6 py-2.5 inline-flex items-center gap-2">
            {saved ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </>
            ) : (
              'Save Settings'
            )}
          </button>
        </div>

      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function SectionHeading({ children }) {
  return <h2 className="text-sm font-semibold text-slate-900 mb-1">{children}</h2>;
}

function LabeledInput({ id, label, onChange, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
        {label}
      </label>
      <input
        id={id}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        {...props}
      />
    </div>
  );
}
