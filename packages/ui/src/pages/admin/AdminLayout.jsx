import { useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { AdminProjects }    from './AdminProjects.jsx';
import { AdminProjectForm } from './AdminProjectForm.jsx';
import { AdminSettings }    from './AdminSettings.jsx';
import { EmailPreview }     from './EmailPreview.jsx';
import { ProjectEmailLog }  from './ProjectEmailLog.jsx';
import { getProjects, getSettings } from '../../lib/adminStore.js';
import { syncSchedule, getStorageStats } from '../../lib/api.js';
import { getSession, logout } from '../../lib/authApi.js';

export function AdminLayout() {
  const navigate = useNavigate();
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'authenticated' | 'unauthenticated'
  const [storageWarn, setStorageWarn] = useState(false);

  // Check session on mount and redirect if not authenticated
  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((res) => {
        if (cancelled) return;
        if (res.authenticated) {
          setAuthState('authenticated');
        } else {
          setAuthState('unauthenticated');
        }
      })
      .catch(() => { if (!cancelled) setAuthState('unauthenticated'); });
    return () => { cancelled = true; };
  }, []);

  // Storage warning check on auth
  useEffect(() => {
    if (authState !== 'authenticated') return;
    getStorageStats()
      .then((s) => { if (s.totalBytes > 200 * 1024 * 1024) setStorageWarn(true); })
      .catch(() => {});
  }, [authState]);

  // Periodic schedule sync every 5 minutes
  useEffect(() => {
    if (authState !== 'authenticated') return;
    const doSync = () =>
      syncSchedule({
        projects:    getProjects(),
        settings:    getSettings(),
        frontendUrl: window.location.origin,
      }).catch((err) => console.warn('[AdminLayout] Schedule sync failed:', err.message));
    doSync();
    const interval = setInterval(doSync, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [authState]);

  if (authState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <span className="text-sm text-slate-400">Loading…</span>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return <Navigate to="/admin/login" replace />;
  }

  async function handleLogout() {
    await logout().catch(() => {});
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <AdminSidebar onLogout={handleLogout} />
      <div className="flex-1 min-w-0 overflow-y-auto">
        {storageWarn && (
          <div className="flex items-start gap-3 bg-amber-50 border-b border-amber-200 px-6 py-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-sm text-amber-800">
              <strong>Storage is filling up.</strong> PDF storage is over 200 MB. Go to{' '}
              <a href="/admin/settings" className="underline font-medium">Settings</a>{' '}
              to review usage, or consider archiving old project data.
            </p>
          </div>
        )}
        <Routes>
          <Route index                           element={<AdminProjects />}    />
          <Route path="projects/new"              element={<AdminProjectForm />} />
          <Route path="projects/:projectId/edit" element={<AdminProjectForm />} />
          <Route path="projects/:projectId/log"  element={<ProjectEmailLog />}  />
          <Route path="settings"                 element={<AdminSettings />}    />
          <Route path="email-preview"            element={<EmailPreview />}     />
          <Route path="*"                        element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function AdminSidebar({ onLogout }) {
  const link = ({ isActive }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? 'bg-brand-50 text-brand-600'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <aside className="w-56 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col sticky top-0 h-screen overflow-y-auto">
      {/* Brand */}
      <div className="px-4 py-5 border-b border-slate-200">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-500 mb-0.5">DIGIT</p>
        <p className="text-sm font-bold text-slate-900 leading-tight">Accessibility Admin</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5" aria-label="Admin navigation">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Manage</p>
        <NavLink to="/admin" end className={link}>
          <GridIcon /> Projects
        </NavLink>
        <NavLink to="/admin/settings" className={link}>
          <GearIcon /> Settings
        </NavLink>
        <NavLink to="/admin/email-preview" className={link}>
          <EnvelopeIcon /> Email Preview
        </NavLink>
      </nav>

      {/* Footer actions */}
      <div className="px-3 py-4 border-t border-slate-200 space-y-1">
        <Link
          to="/"
          className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-slate-700 rounded-md hover:bg-slate-50 transition-colors"
        >
          <ArrowLeftIcon />
          Back to scanner
        </Link>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
        >
          <LogoutIcon />
          Sign out
        </button>
      </div>
    </aside>
  );
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function EnvelopeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 7l10 7 10-7" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
