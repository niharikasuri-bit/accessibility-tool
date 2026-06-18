import nodemailer from 'nodemailer';
import { config } from '../config.js';

/**
 * Send an email via Gmail SMTP.
 * @param {{ fromName: string, fromEmail: string, appPassword: string, to: string|string[], subject: string, html: string }} opts
 */
export async function sendEmail({ fromName, fromEmail, appPassword, to, cc, subject, html, attachments }) {
  const pass = appPassword || config.gmailAppPassword;
  if (!pass)      throw new Error('Email password is required.');
  if (!fromEmail) throw new Error('Sender email address is required.');

  const transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false,
    auth:   { user: fromEmail, pass },
  });

  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const mail = { from, to, subject, html };
  if (cc && (Array.isArray(cc) ? cc.length > 0 : cc)) mail.cc = cc;
  if (attachments && attachments.length > 0) mail.attachments = attachments;
  const info = await transporter.sendMail(mail);
  return { messageId: info.messageId };
}

export async function sendTestEmail({ fromName, fromEmail, appPassword, toEmail }) {
  return sendEmail({
    fromName, fromEmail, appPassword,
    to:      toEmail,
    subject: 'DIGIT Accessibility — email delivery test',
    html:    `<p style="font-family:Arial,sans-serif;font-size:14px;color:#0F172A;">
                Test message from <strong>${fromName || 'DIGIT Accessibility Bot'}</strong>.<br>
                Email delivery is working correctly.
              </p>`,
  });
}
