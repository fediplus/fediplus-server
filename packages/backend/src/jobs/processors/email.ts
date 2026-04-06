import type { Job } from "bullmq";
import nodemailer from "nodemailer";
import { config } from "../../config.js";

export type EmailJobData =
  | { type: "verification"; to: string; token: string }
  | { type: "passwordReset"; to: string; token: string };

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    if (!config.smtp.host) {
      throw new Error("SMTP is not configured — set SMTP_HOST in .env");
    }
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
    });
  }
  return transporter;
}

async function _sendVerificationEmail(to: string, token: string) {
  const link = `${config.publicUrl}/verify-email?token=${token}`;

  await getTransporter().sendMail({
    from: config.smtp.from,
    to,
    subject: "Verify your Fedi+ account",
    text: `Welcome to Fedi+!\n\nPlease verify your email by visiting:\n${link}\n\nThis link expires in 24 hours.\n\nIf you did not create an account, you can ignore this email.`,
    html: `
      <h2>Welcome to Fedi+!</h2>
      <p>Please verify your email by clicking the link below:</p>
      <p><a href="${link}">Verify my email</a></p>
      <p>This link expires in 24 hours.</p>
      <p>If you did not create an account, you can ignore this email.</p>
    `,
  });
}

async function _sendPasswordResetEmail(to: string, token: string) {
  const link = `${config.publicUrl}/reset-password?token=${token}`;

  await getTransporter().sendMail({
    from: config.smtp.from,
    to,
    subject: "Reset your Fedi+ password",
    text: `You requested a password reset for your Fedi+ account.\n\nReset your password by visiting:\n${link}\n\nThis link expires in 1 hour.\n\nIf you did not request this, you can ignore this email.`,
    html: `
      <h2>Password Reset</h2>
      <p>You requested a password reset for your Fedi+ account.</p>
      <p><a href="${link}">Reset my password</a></p>
      <p>This link expires in 1 hour.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}

export async function processEmailJob(
  job: Job<EmailJobData>
): Promise<void> {
  const data = job.data;

  switch (data.type) {
    case "verification":
      return _sendVerificationEmail(data.to, data.token);
    case "passwordReset":
      return _sendPasswordResetEmail(data.to, data.token);
    default:
      console.warn(`[email-worker] Unknown job type: ${(data as { type: string }).type}`);
  }
}
