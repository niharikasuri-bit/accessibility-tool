import { createHash } from 'node:crypto';
import { getSession, refreshSession } from '../db/authStore.js';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = 'digit_admin_session';

const cookieOpts = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_TTL_MS,
  path: '/',
};

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: 'Authentication required.' });
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = await getSession(tokenHash);

  if (!session || new Date(session.expiresAt) <= new Date()) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.status(401).json({ ok: false, code: 'SESSION_EXPIRED', message: 'Session expired. Please log in again.' });
  }

  // Slide the expiry window
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await refreshSession(tokenHash, newExpiry);
  res.cookie(COOKIE_NAME, token, cookieOpts);

  req.adminEmail = session.email;
  next();
}
