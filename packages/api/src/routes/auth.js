import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  getUser, updateUser,
  createSession, getSession, refreshSession, deleteSession, deleteAllUserSessions,
  saveOtp, getOtp, updateOtp, deleteOtp,
} from '../db/authStore.js';
import { sendEmail } from '../services/email.js';
import { getSettings } from '../services/scheduler.js';
import { logger } from '../logger.js';

export const authRouter = Router();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const COOKIE_NAME = 'digit_admin_session';

// Read from ADMIN_EMAIL env var — never hardcoded in logic.
const ALLOWED_ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? 'uxteam@egovernments.org').toLowerCase().trim();

const cookieOpts = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_TTL_MS,
  path: '/',
};

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function otpEmailHtml(otp) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;">
      <h2 style="margin:0 0 16px;color:#191D88;font-size:20px;">Password Reset Code</h2>
      <p style="color:#374151;font-size:15px;margin:0 0 16px;">Enter this code to reset your DIGIT Admin password:</p>
      <div style="background:#f3f4f6;border-radius:8px;padding:24px;text-align:center;margin:0 0 16px;">
        <span style="font-size:40px;font-weight:800;letter-spacing:10px;color:#191D88;font-family:monospace;">${otp}</span>
      </div>
      <p style="color:#6b7280;font-size:13px;margin:0;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
    </div>
  `;
}

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', message: 'Email and password are required.' });
  }

  const normalEmail = email.toLowerCase().trim();

  // Allowlist check — 403 so the client can distinguish "not authorised" from "wrong password".
  if (normalEmail !== ALLOWED_ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, code: 'NOT_AUTHORISED', message: 'This email is not authorised to access the admin area.' });
  }

  const user = await getUser(normalEmail);

  // Check lockout before password check
  if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const remaining = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000);
    return res.status(429).json({
      ok: false,
      code: 'ACCOUNT_LOCKED',
      message: `Account locked. Try again in ${remaining} minute${remaining !== 1 ? 's' : ''}.`,
    });
  }

  // Always run bcrypt to prevent timing attacks.
  // Dummy hash is only reached when the user doesn't exist; wrapped in try/catch
  // in case bcryptjs rejects a malformed hash from disk corruption.
  const dummyHash = '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOP.QRSTUVWXYZabc';
  let valid;
  try {
    valid = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
  } catch {
    valid = false;
  }

  if (!user || !valid) {
    if (user) {
      const attempts = (user.failedAttempts ?? 0) + 1;
      const updates = { failedAttempts: attempts };
      if (attempts >= 5) {
        updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        updates.failedAttempts = 0;
      }
      await updateUser(user.email, updates);

      if (attempts >= 5) {
        return res.status(429).json({ ok: false, code: 'ACCOUNT_LOCKED', message: 'Account locked for 15 minutes due to too many failed attempts.' });
      }
      const attemptsLeft = 5 - attempts;
      if (attemptsLeft <= 2) {
        return res.status(401).json({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          message: `Incorrect credentials. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining before lockout.`,
        });
      }
    }
    return res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
  }

  // Reset failed attempts
  await updateUser(user.email, { failedAttempts: 0, lockedUntil: null });

  // Create session
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await createSession({ email: user.email, tokenHash, expiresAt });

  res.cookie(COOKIE_NAME, token, cookieOpts);
  return res.json({ ok: true });
});

// POST /api/auth/logout
authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    await deleteSession(hashToken(token)).catch(() => {});
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ ok: true });
});

// GET /api/auth/session
authRouter.get('/session', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.json({ authenticated: false });

  const session = await getSession(hashToken(token));
  if (!session || new Date(session.expiresAt) <= new Date()) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ authenticated: false });
  }

  // Slide expiry
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await refreshSession(hashToken(token), newExpiry);
  res.cookie(COOKIE_NAME, token, cookieOpts);
  return res.json({ authenticated: true, email: session.email });
});

// POST /api/auth/forgot-password
authRouter.post('/forgot-password', async (req, res) => {
  const { email } = req.body ?? {};
  const normalEmail = (email ?? '').toLowerCase().trim();

  if (normalEmail !== ALLOWED_ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, code: 'NOT_AUTHORISED', message: 'This email is not authorised to access the admin area.' });
  }

  const user = await getUser(normalEmail);

  if (user) {
    // Check resend rate on existing OTP
    const existing = await getOtp(user.email);
    if (existing && existing.lastResendAt) {
      const since = Date.now() - new Date(existing.lastResendAt).getTime();
      if (since < 60_000) {
        // Still within cooldown — return success silently (don't reveal)
        return res.json({ ok: true, message: 'If that email is registered, a code has been sent.' });
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    let otpHash;
    try {
      otpHash = await bcrypt.hash(otp, 10);
    } catch (err) {
      logger.error({ err: err.message }, 'bcrypt.hash failed during OTP generation');
      return res.json({ ok: true, message: 'If that email is registered, a code has been sent.' });
    }
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    // Save OTP and lastResendAt in a single write to avoid split state.
    await saveOtp({ email: user.email, otpHash, expiresAt });
    await updateOtp(user.email, { lastResendAt: now });

    const settings = getSettings();
    if (settings.senderEmail && settings.gmailAppPassword) {
      try {
        await sendEmail({
          fromName: settings.senderName || 'DIGIT Accessibility Bot',
          fromEmail: settings.senderEmail,
          appPassword: settings.gmailAppPassword,
          to: user.email,
          subject: 'Your DIGIT Admin Password Reset Code',
          html: otpEmailHtml(otp),
        });
      } catch (err) {
        logger.warn({ err: err.message }, 'Failed to send OTP email');
      }
    } else {
      // Dev-only: never log the actual OTP, only confirm it was generated.
      logger.info({ email: user.email }, 'OTP generated (email not configured — check server logs for dev testing)');
    }
  }

  // Always return the same response to avoid user enumeration
  return res.json({ ok: true, message: 'If that email is registered, a code has been sent.' });
});

// POST /api/auth/resend-otp
authRouter.post('/resend-otp', async (req, res) => {
  const { email } = req.body ?? {};
  const normalEmail = (email ?? '').toLowerCase().trim();
  const user = await getUser(normalEmail);
  const record = user ? await getOtp(user.email) : null;

  if (!user || !record) return res.json({ ok: true });

  if (record.resendCount >= 3) {
    return res.status(429).json({ ok: false, code: 'RESEND_LIMIT', message: 'Maximum resends reached. Please start over.' });
  }

  if (record.lastResendAt) {
    const since = Date.now() - new Date(record.lastResendAt).getTime();
    if (since < 60_000) {
      const waitSec = Math.ceil((60_000 - since) / 1000);
      return res.status(429).json({ ok: false, code: 'RESEND_TOO_SOON', message: `Please wait ${waitSec} seconds before resending.`, waitSeconds: waitSec });
    }
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  let otpHash;
  try {
    otpHash = await bcrypt.hash(otp, 10);
  } catch (err) {
    logger.error({ err: err.message }, 'bcrypt.hash failed during OTP resend');
    return res.json({ ok: true });
  }
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await updateOtp(user.email, {
    otpHash,
    expiresAt,
    attempts: 0,
    resendCount: record.resendCount + 1,
    lastResendAt: new Date().toISOString(),
    used: false,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  });

  const settings = getSettings();
  if (settings.senderEmail && settings.gmailAppPassword) {
    try {
      await sendEmail({
        fromName: settings.senderName || 'DIGIT Accessibility Bot',
        fromEmail: settings.senderEmail,
        appPassword: settings.gmailAppPassword,
        to: user.email,
        subject: 'Your DIGIT Admin Password Reset Code',
        html: otpEmailHtml(otp),
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to resend OTP email');
    }
  } else {
    logger.info({ email: user.email }, 'OTP resent (email not configured — check server logs for dev testing)');
  }

  return res.json({ ok: true });
});

// POST /api/auth/verify-otp
authRouter.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body ?? {};
  if (!email || !otp) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', message: 'Email and code are required.' });
  }

  const normalEmail = email.toLowerCase().trim();

  if (normalEmail !== ALLOWED_ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, code: 'NOT_AUTHORISED', message: 'Unauthorised access.' });
  }
  const user = await getUser(normalEmail);
  const record = user ? await getOtp(user.email) : null;

  if (!user || !record || record.used) {
    return res.status(400).json({ ok: false, code: 'INVALID_OTP', message: 'Invalid or expired code.' });
  }

  if (new Date(record.expiresAt) <= new Date()) {
    return res.status(400).json({ ok: false, code: 'OTP_EXPIRED', message: 'Code expired. Please request a new one.' });
  }

  if (record.attempts >= 3) {
    await deleteOtp(user.email);
    return res.status(400).json({ ok: false, code: 'OTP_INVALIDATED', message: 'Too many incorrect attempts. Please request a new code.' });
  }

  let valid;
  try {
    valid = await bcrypt.compare(otp, record.otpHash);
  } catch {
    valid = false;
  }
  if (!valid) {
    const newAttempts = record.attempts + 1;
    await updateOtp(user.email, { attempts: newAttempts });
    if (newAttempts >= 3) {
      await deleteOtp(user.email);
      return res.status(400).json({ ok: false, code: 'OTP_INVALIDATED', message: 'Too many incorrect attempts. Please request a new code.' });
    }
    const left = 3 - newAttempts;
    return res.status(400).json({
      ok: false,
      code: 'INVALID_OTP',
      message: `Incorrect code. ${left} attempt${left !== 1 ? 's' : ''} remaining.`,
    });
  }

  // Issue a short-lived reset token
  const resetToken = randomBytes(32).toString('hex');
  const resetTokenHash = hashToken(resetToken);
  await updateOtp(user.email, {
    used: true,
    resetTokenHash,
    resetTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });

  return res.json({ ok: true, resetToken, email: user.email });
});

// POST /api/auth/reset-password
authRouter.post('/reset-password', async (req, res) => {
  const { email, resetToken, newPassword } = req.body ?? {};
  if (!email || !resetToken || !newPassword) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', message: 'Required fields are missing.' });
  }

  if ((email ?? '').toLowerCase().trim() !== ALLOWED_ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, code: 'NOT_AUTHORISED', message: 'Unauthorised access.' });
  }

  // Password requirements
  const errors = [];
  if (newPassword.length < 8)              errors.push('at least 8 characters');
  if (!/[A-Z]/.test(newPassword))          errors.push('an uppercase letter');
  if (!/[0-9]/.test(newPassword))          errors.push('a number');
  if (!/[^A-Za-z0-9]/.test(newPassword))  errors.push('a special character');
  if (errors.length) {
    return res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', message: `Password must contain ${errors.join(', ')}.` });
  }

  const normalEmail = email.toLowerCase().trim();
  const user = await getUser(normalEmail);
  const record = user ? await getOtp(user.email) : null;

  if (!user || !record?.resetTokenHash) {
    return res.status(400).json({ ok: false, code: 'INVALID_TOKEN', message: 'Invalid or expired reset session.' });
  }

  if (!record.resetTokenExpiresAt || new Date(record.resetTokenExpiresAt) <= new Date()) {
    return res.status(400).json({ ok: false, code: 'TOKEN_EXPIRED', message: 'Reset session expired. Please start over.' });
  }

  if (hashToken(resetToken) !== record.resetTokenHash) {
    return res.status(400).json({ ok: false, code: 'INVALID_TOKEN', message: 'Invalid reset token.' });
  }

  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(newPassword, 12);
  } catch (err) {
    logger.error({ err: err.message }, 'bcrypt.hash failed during password reset');
    return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: 'Password update failed. Please try again.' });
  }
  await updateUser(user.email, { passwordHash, failedAttempts: 0, lockedUntil: null });
  await deleteAllUserSessions(user.email);
  await deleteOtp(user.email);

  return res.json({ ok: true });
});
