/**
 * Lightweight per-project scan-history store.
 *
 * Persisted at ./artifacts/scan-history.json as:
 *   { "proj_abc": [ snapshotOldest, ..., snapshotNewest ] }
 *
 * Max MAX_HISTORY entries per project (oldest evicted).  Snapshots carry just
 * enough data for Type 2 comparison emails: score, severity counts, and the
 * rule-id list needed for unresolved-issue detection.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

const HISTORY_FILE = path.resolve('./artifacts/scan-history.json');
const MAX_HISTORY  = 5;

async function readAll() {
  try {
    return JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8'));
  } catch { return {}; }
}

async function writeAll(data) {
  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Append a snapshot after a successful email send.
 * Stored oldest→newest; excess entries are dropped from the front.
 *
 * @param {string} projectId
 * @param {{ date:string, score:number, totalIssues:number,
 *           severity:{severe,high,medium,low},
 *           issues:Array<{ruleId,title,severity}> }} snapshot
 */
export async function appendScanSnapshot(projectId, snapshot) {
  try {
    const all  = await readAll();
    const list = all[projectId] ?? [];
    list.push(snapshot);
    all[projectId] = list.slice(-MAX_HISTORY);
    await writeAll(all);
  } catch (err) {
    logger.warn({ err: err.message, projectId }, 'Failed to persist scan snapshot');
  }
}

/**
 * Returns the project's snapshot history, newest first.
 * @param {string} projectId
 * @returns {Promise<Array>}
 */
export async function getProjectHistory(projectId) {
  const all = await readAll();
  return (all[projectId] ?? []).slice().reverse();
}

/**
 * Remove all history for a deleted project.
 * @param {string} projectId
 */
export async function clearProjectHistory(projectId) {
  try {
    const all = await readAll();
    if (!(projectId in all)) return;
    delete all[projectId];
    await writeAll(all);
  } catch (err) {
    logger.warn({ err: err.message, projectId }, 'Failed to clear scan history');
  }
}
