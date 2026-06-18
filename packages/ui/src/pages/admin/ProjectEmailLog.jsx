import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getProject } from '../../lib/adminStore.js';
import { getEmailLog } from '../../lib/api.js';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).replace(',', '');
}

function StatusBadge({ status }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Sent
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Skipped
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      Failed
    </span>
  );
}

function DownloadCta({ url }) {
  if (!url) {
    return <span className="text-xs text-slate-400 italic">Report unavailable</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline whitespace-nowrap"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
      </svg>
      Download Full Report
    </a>
  );
}

export function ProjectEmailLog() {
  const { projectId } = useParams();
  const navigate      = useNavigate();
  const project       = getProject(projectId);

  const [entries, setEntries] = useState(null);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!projectId) return;
    getEmailLog(projectId)
      .then((res) => setEntries(res.entries ?? []))
      .catch((err) => setError(err.message ?? 'Failed to load email log'));
  }, [projectId]);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate('/admin')}
          className="btn-secondary text-xs inline-flex items-center gap-1.5 shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Projects
        </button>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email Send Log</p>
          <h1 className="text-xl font-bold text-slate-900 leading-tight">
            {project?.name ?? 'Project'}
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        {error && (
          <div className="m-6 rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {!error && entries === null && (
          <div className="flex items-center justify-center h-48">
            <div className="flex items-center gap-2 text-slate-400">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                <circle cx="12" cy="12" r="10" opacity="0.25" />
                <path d="M22 12a10 10 0 01-10 10" strokeLinecap="round" />
              </svg>
              <span className="text-sm">Loading…</span>
            </div>
          </div>
        )}

        {!error && entries !== null && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-slate-400" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M2 7l10 7 10-7" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-700 mb-1">No emails sent yet</p>
            <p className="text-xs text-slate-400 max-w-sm">
              Emails will appear here after the first scheduled or manual send.
            </p>
          </div>
        )}

        {!error && entries !== null && entries.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <Th>Date &amp; Time</Th>
                <Th>Status</Th>
                <Th>Triggered By</Th>
                <Th>Recipients</Th>
                <Th>Report</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <LogRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function LogRow({ entry }) {
  return (
    <>
      <tr className="align-top">
        <td className="px-5 py-3 text-xs text-slate-600 whitespace-nowrap">{formatDateTime(entry.timestamp)}</td>
        <td className="px-5 py-3"><StatusBadge status={entry.status} /></td>
        <td className="px-5 py-3 text-xs text-slate-600 capitalize">{entry.triggeredBy ?? '—'}</td>
        <td className="px-5 py-3 text-xs text-slate-600 whitespace-nowrap">
          {entry.recipientCount != null
            ? `${entry.recipientCount} recipient${entry.recipientCount !== 1 ? 's' : ''}`
            : '—'}
        </td>
        <td className="px-5 py-3"><DownloadCta url={entry.fullReportUrl} /></td>
      </tr>
      {(entry.status === 'failed' || entry.status === 'skipped') && entry.error && (
        <tr>
          <td colSpan={5} className="px-5 pb-3 pt-0">
            <p className={`text-xs rounded px-3 py-1.5 border ${entry.status === 'skipped' ? 'text-amber-700 bg-amber-50 border-amber-100' : 'text-red-600 bg-red-50 border-red-100'}`}>
              <span className="font-semibold">Reason:</span> {entry.error}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function Th({ children }) {
  return (
    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );
}
