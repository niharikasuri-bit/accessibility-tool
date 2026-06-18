// When the API is hosted on a different domain, set VITE_API_BASE_URL so
// requests reach the right server. In local dev, leave it unset.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function authRequest(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    // 'include' is required for cross-origin cookie auth (separate API domain).
    // 'same-origin' is correct for local dev where Vite proxies /api/*.
    credentials: API_BASE ? 'include' : 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...opts.headers,
    },
  });
  let json;
  try {
    json = await res.json();
  } catch {
    // Response body is not JSON — usually means the API server is not running
    // and the Vite dev proxy returned its own HTML error page instead.
    json = {
      ok: false,
      code: 'SERVER_UNAVAILABLE',
      message: 'Could not reach the API server. Make sure the API is running (pnpm dev).',
    };
  }
  return { httpStatus: res.status, ...json };
}

export const login = (email, password) =>
  authRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const logout = () =>
  authRequest('/api/auth/logout', { method: 'POST' });

export const getSession = () =>
  authRequest('/api/auth/session');

export const forgotPassword = (email) =>
  authRequest('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

export const resendOtp = (email) =>
  authRequest('/api/auth/resend-otp', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

export const verifyOtp = (email, otp) =>
  authRequest('/api/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });

export const resetPassword = (email, resetToken, newPassword) =>
  authRequest('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, resetToken, newPassword }),
  });
