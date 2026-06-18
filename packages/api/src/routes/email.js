import { Router } from 'express';
import { z }      from 'zod';
import { sendTestEmail, sendEmail } from '../services/email.js';
import { logger }                   from '../logger.js';

export const emailRouter = Router();

const testSchema = z.object({
  fromName:    z.string().optional(),
  fromEmail:   z.string().email(),
  appPassword: z.string().min(1).optional(),
  toEmail:     z.string().email(),
});

const emailAddrOrArray = z.union([z.string().email(), z.array(z.string().email())]);

const sendReportSchema = z.object({
  fromName:    z.string().optional(),
  fromEmail:   z.string().email(),
  appPassword: z.string().optional(),
  to:          emailAddrOrArray,
  cc:          emailAddrOrArray.optional(),
  subject:     z.string().min(1),
  html:        z.string().min(1),
});

emailRouter.post('/send-report', async (req, res) => {
  const parsed = sendReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const { fromName, fromEmail, appPassword, to, cc, subject, html } = parsed.data;
  try {
    const result = await sendEmail({ fromName, fromEmail, appPassword, to, cc, subject, html });
    logger.info({ to, cc }, 'Report email sent');
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.warn({ err: err.message }, 'Report email failed');
    res.status(502).json({ ok: false, message: err.message });
  }
});

emailRouter.post('/test', async (req, res) => {
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }

  const { fromName, fromEmail, appPassword, toEmail } = parsed.data;
  try {
    const result = await sendTestEmail({ fromName, fromEmail, appPassword, toEmail });
    logger.info({ toEmail }, 'Test email sent');
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.warn({ err: err.message }, 'Test email failed');
    res.status(502).json({ ok: false, message: err.message });
  }
});
