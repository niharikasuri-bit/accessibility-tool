import { useState } from 'react';
import { useNavigate, useLocation, Link, Navigate } from 'react-router-dom';
import { AuthShell } from './AdminLogin.jsx';
import { resetPassword } from '../../lib/authApi.js';

const ALLOWED_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL ?? 'uxteam@egovernments.org').toLowerCase().trim();

function passwordStrength(pw) {
  if (!pw) return { level: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8)              score++;
  if (/[A-Z]/.test(pw))           score++;
  if (/[0-9]/.test(pw))           score++;
  if (/[^A-Za-z0-9]/.test(pw))    score++;

  if (score <= 1) return { level: 1, label: 'Weak',   color: '#ef4444' };
  if (score === 2) return { level: 2, label: 'Fair',   color: '#f59e0b' };
  if (score === 3) return { level: 3, label: 'Good',   color: '#3b82f6' };
  return             { level: 4, label: 'Strong', color: '#22c55e' };
}

const REQUIREMENTS = [
  { test: (pw) => pw.length >= 8,            label: 'At least 8 characters' },
  { test: (pw) => /[A-Z]/.test(pw),          label: 'One uppercase letter'  },
  { test: (pw) => /[0-9]/.test(pw),          label: 'One number'            },
  { test: (pw) => /[^A-Za-z0-9]/.test(pw),   label: 'One special character' },
];

export function AdminResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { email, resetToken } = location.state ?? {};

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (email && email.toLowerCase().trim() !== ALLOWED_EMAIL) {
    return <Navigate to="/admin/login" replace state={{ error: 'Unauthorised access.' }} />;
  }

  if (!email || !resetToken) {
    return (
      <AuthShell title="Session expired" subtitle="Your reset session is invalid.">
        <div className="space-y-4 text-center">
          <p className="text-sm text-slate-500">Please start the password reset process again.</p>
          <Link
            to="/admin/forgot-password"
            className="inline-block py-2.5 px-6 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors"
          >
            Start over
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated" subtitle="Your admin password has been changed.">
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
            Password updated successfully. All active sessions have been signed out.
          </div>
          <Link
            to="/admin/login"
            className="block w-full text-center py-2.5 px-4 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
          >
            Sign in with new password
          </Link>
        </div>
      </AuthShell>
    );
  }

  const strength = passwordStrength(newPassword);
  const allReqsMet = REQUIREMENTS.every((r) => r.test(newPassword));
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit = allReqsMet && passwordsMatch && confirmPassword.length > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      const res = await resetPassword(email, resetToken, newPassword);
      if (res.ok) {
        setDone(true);
      } else {
        setError(res.message || 'Password reset failed.');
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Set new password" subtitle="Choose a strong password for your admin account.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-slate-700 mb-1.5">
            New password
          </label>
          <div className="relative">
            <input
              id="new-password"
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label={showNew ? 'Hide password' : 'Show password'}
            >
              {showNew ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          {/* Strength bar */}
          {newPassword && (
            <div className="mt-2">
              <div className="flex gap-1 mb-1">
                {[1, 2, 3, 4].map((bar) => (
                  <div
                    key={bar}
                    className="h-1 flex-1 rounded-full transition-colors"
                    style={{ backgroundColor: bar <= strength.level ? strength.color : '#e2e8f0' }}
                  />
                ))}
              </div>
              <p className="text-xs font-medium" style={{ color: strength.color }}>{strength.label}</p>
            </div>
          )}

          {/* Requirements list */}
          {newPassword && (
            <ul className="mt-2 space-y-1">
              {REQUIREMENTS.map((req) => {
                const met = req.test(newPassword);
                return (
                  <li key={req.label} className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600' : 'text-slate-400'}`}>
                    <span aria-hidden="true">{met ? '✓' : '○'}</span>
                    {req.label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 mb-1.5">
            Confirm password
          </label>
          <div className="relative">
            <input
              id="confirm-password"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full px-3 py-2.5 pr-10 border rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent ${
                confirmPassword && !passwordsMatch ? 'border-red-300' : 'border-slate-300'
              }`}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
            >
              {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          {confirmPassword && !passwordsMatch && (
            <p className="mt-1 text-xs text-red-500">Passwords do not match.</p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="w-full py-2.5 px-4 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
