/**
 * Public (no auth) route for serving generated email PDFs.
 * GET /api/email-pdfs/:filename
 *
 * Files are saved to ./artifacts/emails/ by pdfStorage.getEmailPdfUrl().
 * Only allows safe filenames (alphanumeric + hyphens, .pdf extension).
 */

import { Router } from 'express';
import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';

export const emailPdfsRouter = Router();

const EMAILS_DIR = path.resolve('./artifacts/emails');

emailPdfsRouter.get('/:filename', async (req, res) => {
  const { filename } = req.params;

  if (!/^[a-z0-9][a-z0-9-]*\.pdf$/i.test(filename)) {
    return res.status(400).send('Invalid filename');
  }

  const filePath = path.join(EMAILS_DIR, filename);

  // Defense-in-depth: verify resolved path stays within EMAILS_DIR even though
  // the regex already prevents path separators.
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(EMAILS_DIR + path.sep) && resolved !== EMAILS_DIR) {
    return res.status(400).send('Invalid filename');
  }

  try {
    await fs.access(filePath);
  } catch {
    return res.status(404).send('PDF not found');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  createReadStream(filePath)
    .on('error', (_err) => { if (!res.headersSent) res.status(500).send('Stream error'); })
    .pipe(res);
});
