import "server-only";

import { Resend } from "resend";

function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set — see .env.example.");
  }
  return new Resend(apiKey);
}

function getFrom(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not set — see .env.example.");
  }
  return from;
}

function getAppUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

/**
 * One email covers both cases (plan.md build log, 2026-09-18): an admin
 * creating a new user (`purpose: "INVITE"`) or an existing user asking for
 * "Forgot password" (`purpose: "RESET"`) — same link shape, different copy.
 */
export async function sendPasswordSetupEmail(params: {
  to: string;
  name: string;
  token: string;
  purpose: "INVITE" | "RESET";
}): Promise<void> {
  const url = `${getAppUrl()}/reset-password/${params.token}`;
  const isInvite = params.purpose === "INVITE";

  const subject = isInvite
    ? "You've been added to Fraterniti One — set your password"
    : "Reset your Fraterniti One password";

  const intro = isInvite
    ? `An admin created a Fraterniti One account for you (${params.to}). Set a password to get started:`
    : "We received a request to reset your Fraterniti One password. Click below to choose a new one:";

  const expiryNote = isInvite
    ? "This link expires in 7 days."
    : "This link expires in 1 hour. If you didn't request this, you can ignore this email.";

  await getClient().emails.send({
    from: getFrom(),
    to: params.to,
    subject,
    text: `Hi ${params.name},\n\n${intro}\n\n${url}\n\n${expiryNote}`,
    html: `
      <p>Hi ${params.name},</p>
      <p>${intro}</p>
      <p><a href="${url}">${url}</a></p>
      <p style="color:#666;font-size:13px;">${expiryNote}</p>
    `,
  });
}
