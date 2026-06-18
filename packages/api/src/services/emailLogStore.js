import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

const LOG_FILE = path.resolve('./artifacts/email-log.json');

async function readAll() {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    logger.error({ file: LOG_FILE, err: err.message }, 'emailLogStore: failed to read or parse email log');
    return [];
  }
}

async function writeAll(entries) {
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function appendEmailLog({ projectId, timestamp, status, triggeredBy, recipientCount, fullReportUrl, error }) {
  const raw = await readAll();
  const entries = Array.isArray(raw) ? raw : [];
  entries.push({ id: makeId(), projectId, timestamp, status, triggeredBy, recipientCount, fullReportUrl: fullReportUrl ?? null, error: error ?? null });
  await writeAll(entries);
}

export async function getEmailLogForProject(projectId) {
  const raw = await readAll();
  const entries = Array.isArray(raw) ? raw : [];
  return entries
    .filter((e) => e.projectId === projectId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export async function deleteEmailLogForProject(projectId) {
  const raw = await readAll();
  const entries = Array.isArray(raw) ? raw : [];
  const filtered = entries.filter((e) => e.projectId !== projectId);
  if (filtered.length !== entries.length) await writeAll(filtered);
}
