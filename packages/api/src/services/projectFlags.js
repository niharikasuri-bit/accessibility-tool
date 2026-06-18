/**
 * Per-project persistent flags.
 *
 * Stored at ./artifacts/project-flags.json as a flat object keyed by projectId:
 *   { "proj_abc123": { firstEmailSent: true }, ... }
 *
 * Reads always go to disk so the flag is correct after an API restart — even
 * before the admin panel has had a chance to re-sync the project list.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

const FLAGS_FILE = path.resolve('./artifacts/project-flags.json');

async function readAll() {
  try {
    const raw = await fs.readFile(FLAGS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeAll(flags) {
  await fs.mkdir(path.dirname(FLAGS_FILE), { recursive: true });
  await fs.writeFile(FLAGS_FILE, JSON.stringify(flags, null, 2), 'utf8');
}

/**
 * Returns the stored flags for a project, defaulting missing fields to false.
 * @param {string} projectId
 * @returns {Promise<{ firstEmailSent: boolean }>}
 */
export async function getProjectFlags(projectId) {
  const all = await readAll();
  return { firstEmailSent: false, ...(all[projectId] ?? {}) };
}

/**
 * Persist firstEmailSent: true for a project.
 * Called only after a successful send — never on failure so the next attempt
 * still routes to Type 1.  Idempotent.
 * @param {string} projectId
 */
export async function setFirstEmailSent(projectId) {
  try {
    const all = await readAll();
    all[projectId] = { ...(all[projectId] ?? {}), firstEmailSent: true };
    await writeAll(all);
  } catch (err) {
    logger.warn({ err: err.message, projectId }, 'Failed to persist firstEmailSent flag');
  }
}

/**
 * Reset firstEmailSent to false — used when a project's URL or scanMode changes,
 * so the next dispatch routes back to Type 1.
 * @param {string} projectId
 */
export async function clearFirstEmailSent(projectId) {
  try {
    const all = await readAll();
    if (all[projectId]) {
      all[projectId] = { ...all[projectId], firstEmailSent: false };
      await writeAll(all);
    }
  } catch (err) {
    logger.warn({ err: err.message, projectId }, 'Failed to reset firstEmailSent flag');
  }
}

/**
 * Remove all flags for a project.  Called when a project is deleted so that a
 * project recreated with the same id starts fresh.
 * @param {string} projectId
 */
export async function clearProjectFlags(projectId) {
  try {
    const all = await readAll();
    if (!(projectId in all)) return;
    delete all[projectId];
    await writeAll(all);
  } catch (err) {
    logger.warn({ err: err.message, projectId }, 'Failed to clear project flags');
  }
}
