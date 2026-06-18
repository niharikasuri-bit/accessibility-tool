import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { AuthShell } from './AdminLogin.jsx';
import { verifyOtp, resendOtp } from '../../lib/authApi.js';

const ALLOWED_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL ?? 'uxteam@egovernments.org').toLowerCase().trim();

export function AdminVerifyOtp() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email ?? '';

  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef([]);
  const cooldownRef = useRef(null);

  useEffect(() => {
    if (!email) { navigate('/admin/forgot-password', { replace: true }); return; }
    if (email.toLowerCase().trim() !== ALLOWED_EMAIL) {
      navigate('/admin/login', { replace: true, state: { error: 'Unauthorised access.' } });
      return;
    }
    inputRefs.current[0]?.focus();
  }, [email, navigate]);

  useEffect(() => {
    return () => clearInterval(cooldownRef.current);
  }, []);

  function startCooldown(secs) {
    setResendCooldown(secs);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function handleDigitChange(index, value) {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError('');

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index, e) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = [...digits];
    for (let i = 0; i < 6; i++) next[i] = pasted[i] ?? '';
    setDigits(next);
    const lastFilled = Math.min(pasted.length, 5);
    inputRefs.current[lastFilled]?.focus();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const otp = digits.join('');
    if (otp.length < 6) {
      setError('Enter all 6 digits.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await verifyOtp(email, otp);
      if (res.ok) {
        navigate('/admin/reset-password', { state: { email, resetToken: res.resetToken }, replace: true });
      } else {
        setError(res.message || 'Invalid code.');
        if (res.code === 'OTP_INVALIDATED') {
          setDigits(['', '', '', '', '', '']);
          inputRefs.current[0]?.focus();
        }
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setResendMsg('');
    setError('');
    try {
      const res = await resendOtp(email);
      if (res.ok) {
        setResendMsg('A new code has been sent.');
        startCooldown(60);
        setDigits(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      } else if (res.code === 'RESEND_TOO_SOON') {
        const secs = typeof res.waitSeconds === 'number' && res.waitSeconds > 0 ? res.waitSeconds : 60;
        startCooldown(secs);
        setResendMsg(`Please wait ${secs}s before resending.`);
      } else {
        setResendMsg(res.message || 'Could not resend.');
      }
    } catch {
      setResendMsg('Could not reach the server.');
    }
  }

  const otp = digits.join('');

  return (
    <AuthShell title="Enter the code" subtitle={`We sent a 6-digit code to ${email || 'your email'}.`}>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}
        {resendMsg && !error && (
          <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            {resendMsg}
          </div>
        )}

        {/* 6-digit input boxes */}
        <div>
          <p className="text-sm font-medium text-slate-700 mb-3">Verification code</p>
          <div className="flex gap-2.5 justify-center" onPaste={handlePaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => (inputRefs.current[i] = el)}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                aria-label={`Digit ${i + 1}`}
                className="w-11 h-13 text-center text-xl font-bold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-slate-900 caret-brand-600 transition-colors"
                style={{ height: '52px' }}
              />
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || otp.length < 6}
          className="w-full py-2.5 px-4 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Verifying…' : 'Verify code'}
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0}
            className="text-sm text-brand-600 hover:text-brand-700 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
          </button>
        </div>
      </form>

      <div className="mt-6 text-center">
        <Link to="/admin/forgot-password" className="text-xs text-slate-400 hover:text-slate-600">
          ← Try a different email
        </Link>
      </div>
    </AuthShell>
  );
}
