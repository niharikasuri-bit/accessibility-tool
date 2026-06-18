import { promises as fs } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const DATA_DIR    = path.resolve('./artifacts/auth');
const USERS_FILE  = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const OTPS_FILE   = path.join(DATA_DIR, 'otps.json');

// ─── File I/O ─────────────────────────────────────────────────────────────────

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return []; // file doesn't exist yet — expected on first run
    // Parse error or permission error: log and return [] rather than silently losing data
    // on the next write. Operators should investigate these.
    const { logger } = await import('../logger.js');
    logger.error({ file, err: err.message }, 'authStore: failed to read or parse JSON file');
    return [];
  }
}

async function writeJson(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Atomic write: write to a temp file then rename so a crash mid-write can't
  // leave a partially-written (corrupted) file.
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUser(email) {
  const users = await readJson(USERS_FILE);
  return users.find(u => u.email === email) ?? null;
}

export async function updateUser(email, updates) {
  const users = await readJson(USERS_FILE);
  const idx = users.findIndex(u => u.email === email);
  if (idx === -1) return;
  users[idx] = { ...users[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeJson(USERS_FILE, users);
}

export async function upsertUser(email, data) {
  const users = await readJson(USERS_FILE);
  const idx = users.findIndex(u => u.email === email);
  const now = new Date().toISOString();
  if (idx === -1) {
    users.push({ email, ...data, createdAt: now, updatedAt: now });
  } else {
    users[idx] = { ...users[idx], ...data, updatedAt: now };
  }
  await writeJson(USERS_FILE, users);
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

export async function seedAdminUser() {
  const existing = await getUser('uxteam@egovernments.org');
  if (existing) return;
  const passwordHash = await bcrypt.hash('uxteam@eGov', 12);
  await upsertUser('uxteam@egovernments.org', {
    passwordHash,
    failedAttempts: 0,
    lockedUntil: null,
  });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession({ email, tokenHash, expiresAt }) {
  const sessions = await readJson(SESSIONS_FILE);
  const now = Date.now();
  const active = sessions.filter(s => new Date(s.expiresAt).getTime() > now);
  active.push({ email, tokenHash, expiresAt, createdAt: new Date().toISOString() });
  await writeJson(SESSIONS_FILE, active);
}

export async function getSession(tokenHash) {
  const sessions = await readJson(SESSIONS_FILE);
  return sessions.find(s => s.tokenHash === tokenHash) ?? null;
}

export async function refreshSession(tokenHash, newExpiresAt) {
  const sessions = await readJson(SESSIONS_FILE);
  const idx = sessions.findIndex(s => s.tokenHash === tokenHash);
  if (idx === -1) return;
  sessions[idx] = { ...sessions[idx], expiresAt: newExpiresAt };
  await writeJson(SESSIONS_FILE, sessions);
}

export async function deleteSession(tokenHash) {
  const sessions = await readJson(SESSIONS_FILE);
  await writeJson(SESSIONS_FILE, sessions.filter(s => s.tokenHash !== tokenHash));
}

export async function deleteAllUserSessions(email) {
  const sessions = await readJson(SESSIONS_FILE);
  await writeJson(SESSIONS_FILE, sessions.filter(s => s.email !== email));
}

// ─── OTPs ─────────────────────────────────────────────────────────────────────

export async function saveOtp({ email, otpHash, expiresAt }) {
  const otps = await readJson(OTPS_FILE);
  const filtered = otps.filter(o => o.email !== email);
  filtered.push({
    email,
    otpHash,
    expiresAt,
    attempts: 0,
    resendCount: 0,
    lastResendAt: null,
    used: false,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    createdAt: new Date().toISOString(),
  });
  await writeJson(OTPS_FILE, filtered);
}

export async function getOtp(email) {
  const otps = await readJson(OTPS_FILE);
  return otps.find(o => o.email === email) ?? null;
}

export async function updateOtp(email, updates) {
  const otps = await readJson(OTPS_FILE);
  const idx = otps.findIndex(o => o.email === email);
  if (idx === -1) return;
  otps[idx] = { ...otps[idx], ...updates };
  await writeJson(OTPS_FILE, otps);
}

export async function deleteOtp(email) {
  const otps = await readJson(OTPS_FILE);
  await writeJson(OTPS_FILE, otps.filter(o => o.email !== email));
}
