/**
 * PDF hosting for email CTAs.
 *
 * Strategy (first that works wins):
 *   1. Supabase Storage — permanent public URLs, works regardless of API uptime.
 *      Requires SUPABASE_URL + SUPABASE_ANON_KEY env vars and a public bucket
 *      named "accessibility-pdfs".
 *   2. Local disk + API serve route — saves to ./artifacts/emails/ and returns
 *      a URL like https://your-api.com/api/email-pdfs/filename.pdf.
 *      Works whenever the API server is reachable.
 *
 * For the local-serve fallback the caller supplies the API's own base URL
 * (e.g. "http://localhost:3000" or the deployed origin).
 */

import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const BUCKET      = 'accessibility-pdfs';
const EMAILS_DIR  = path.resolve('./artifacts/emails');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function uploadToSupabase(buffer, filename) {
  const sb = getSupabaseClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.storage.from(BUCKET).upload(filename, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (error) throw error;
    const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(data.path ?? filename);
    return publicUrl ?? null;
  } catch (err) {
    console.error('[pdfStorage] Supabase upload failed:', err.message);
    return null;
  }
}

async function saveToDisk(buffer, filename) {
  await fs.mkdir(EMAILS_DIR, { recursive: true });
  await fs.writeFile(path.join(EMAILS_DIR, filename), buffer);
}

/**
 * Get a publicly accessible URL for a generated PDF.
 * Tries Supabase first, then falls back to saving on disk and returning an
 * API-served URL.
 *
 * @param {Buffer} buffer   PDF content
 * @param {string} filename e.g. "project-pagewise-2026-06-16.pdf"
 * @param {string} apiBase  The API server's own origin, e.g. "http://localhost:3000"
 * @returns {Promise<string>}
 */
export async function getEmailPdfUrl(buffer, filename, apiBase) {
  const supabaseUrl = await uploadToSupabase(buffer, filename);
  if (supabaseUrl) return supabaseUrl;

  try { await saveToDisk(buffer, filename); } catch {}
  if (!apiBase) return null;
  return `${apiBase}/api/email-pdfs/${encodeURIComponent(filename)}`;
}

/**
 * Delete all PDFs associated with a project (by safe name prefix).
 * Cleans both local disk and Supabase storage.
 *
 * @param {string} safeName  e.g. "digit-hcm-portal" (project name lowercased, non-alnum → hyphens)
 */
export async function deleteProjectPdfs(safeName) {
  await Promise.all([
    deleteDiskPdfs(safeName),
    deleteSupabasePdfs(safeName),
  ]);
}

async function deleteDiskPdfs(safeName) {
  try {
    const files = await fs.readdir(EMAILS_DIR);
    const prefix = safeName + '-';
    const toDelete = files.filter((f) => f.startsWith(prefix) && f.endsWith('.pdf'));
    await Promise.all(toDelete.map((f) => fs.unlink(path.join(EMAILS_DIR, f)).catch(() => {})));
  } catch {
    // Directory may not exist yet — nothing to delete
  }
}

async function deleteSupabasePdfs(safeName) {
  const sb = getSupabaseClient();
  if (!sb) return;
  try {
    const { data, error } = await sb.storage.from(BUCKET).list('');
    if (error || !data?.length) return;
    const prefix = safeName + '-';
    const toDelete = data
      .filter((f) => f.name.startsWith(prefix) && f.name.endsWith('.pdf'))
      .map((f) => f.name);
    if (toDelete.length) {
      await sb.storage.from(BUCKET).remove(toDelete);
    }
  } catch (err) {
    console.error('[pdfStorage] Supabase delete failed:', err.message);
  }
}

const MAX_SEND_SETS = 5;

/**
 * Remove disk PDFs for a project beyond the most recent MAX_SEND_SETS send-date groups.
 * Never deletes a file whose name appears in any of the provided referencedUrls.
 *
 * @param {string}  safeName       Project name lowercased+slugified (used as filename prefix)
 * @param {Set<string>} referencedUrls  Set of fullReportUrl strings from the project's email log
 */
export async function cleanupOldSendPdfs(safeName, referencedUrls = new Set()) {
  try {
    const files = await fs.readdir(EMAILS_DIR);
    const prefix = safeName + '-';
    const projectFiles = files.filter((f) => f.startsWith(prefix) && f.endsWith('.pdf'));

    // Extract unique YYYY-MM-DD send-dates from filenames
    const dateSet = new Set();
    for (const f of projectFiles) {
      const m = f.match(/-(\d{4}-\d{2}-\d{2})\.pdf$/);
      if (m) dateSet.add(m[1]);
    }

    if (dateSet.size <= MAX_SEND_SETS) return;

    // Keep the most recent MAX_SEND_SETS dates — delete the rest
    const sorted     = [...dateSet].sort().reverse();
    const toRemove   = sorted.slice(MAX_SEND_SETS);

    for (const date of toRemove) {
      const candidates = projectFiles.filter((f) => f.endsWith(`-${date}.pdf`));
      for (const filename of candidates) {
        const referenced = [...referencedUrls].some((u) => u.includes(filename));
        if (referenced) {
          console.info(`[pdfStorage] Retention: skipping ${filename} — still referenced in email log`);
          continue;
        }
        await fs.unlink(path.join(EMAILS_DIR, filename)).catch(() => {});
        console.info(`[pdfStorage] Retention: deleted ${filename} (beyond ${MAX_SEND_SETS}-send limit)`);
      }
    }
  } catch {
    // Directory may not exist yet — nothing to clean
  }
}

/**
 * Return approximate storage usage for locally-stored email PDFs.
 * @returns {Promise<{ count: number, totalBytes: number }>}
 */
export async function getStorageStats() {
  try {
    const files = await fs.readdir(EMAILS_DIR);
    const pdfs = files.filter((f) => f.endsWith('.pdf'));
    let totalBytes = 0;
    await Promise.all(pdfs.map(async (f) => {
      try {
        const stat = await fs.stat(path.join(EMAILS_DIR, f));
        totalBytes += stat.size;
      } catch {}
    }));
    return { count: pdfs.length, totalBytes };
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}
