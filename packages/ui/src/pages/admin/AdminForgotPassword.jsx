import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthShell } from './AdminLogin.jsx';
import { forgotPassword } from '../../lib/authApi.js';

const ALLOWED_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL ?? 'uxteam@egovernments.org').toLowerCase().trim();

export function AdminForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (email.toLowerCase().trim() !== ALLOWED_EMAIL) {
      setError('This email is not authorised to access the admin area.');
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleContinue() {
    navigate('/admin/verify-otp', { state: { email } });
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle={`We sent a 6-digit code to ${email}.`}>
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
            A reset code has been sent. It expires in 10 minutes.
          </div>
          <p className="text-sm text-slate-500">
            Didn't receive it? Check your spam folder or go back to try a different email.
          </p>
          <button
            onClick={handleContinue}
            className="w-full py-2.5 px-4 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
          >
            Enter the code
          </button>
          <div className="text-center">
            <Link to="/admin/forgot-password" onClick={() => setSent(false)} className="text-sm text-slate-500 hover:text-slate-700">
              ← Try a different email
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password" subtitle="Enter your admin email address to receive a reset code.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            placeholder="you@example.com"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !email}
          className="w-full py-2.5 px-4 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Sending…' : 'Send reset code'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <Link to="/admin/login" className="text-xs text-slate-400 hover:text-slate-600">
          ← Back to login
        </Link>
      </div>
    </AuthShell>
  );
}
