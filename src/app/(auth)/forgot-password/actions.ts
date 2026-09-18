"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { createPasswordResetToken } from "@/lib/password-reset-tokens";
import { sendPasswordSetupEmail } from "@/lib/email";

const ForgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: "Enter a valid email." }),
});

export type ForgotPasswordState = { error?: string; success?: boolean } | undefined;

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const parsed = ForgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { email } = parsed.data;

  // Always report success regardless of whether the account exists — same
  // "don't leak which case it was" discipline as login() (lib/session
  // comment / login actions.ts). Only send an email for a real, active
  // account. A user who never followed their invite link (no password set
  // yet) gets a fresh INVITE email instead of a RESET one — same outcome
  // (a working setup link), correct copy either way.
  const user = await db.user.findUnique({ where: { email } });
  if (user && user.isActive) {
    const purpose = user.passwordHash ? "RESET" : "INVITE";
    const token = await createPasswordResetToken(user.id, purpose);
    try {
      await sendPasswordSetupEmail({ to: user.email, name: user.name, token, purpose });
    } catch (err) {
      // Swallowed deliberately: surfacing a different result here (vs. the
      // generic success message below) would let an attacker tell "account
      // exists but email failed" apart from "no such account" — the same
      // enumeration risk this generic message exists to prevent. Server-side
      // logging is enough for us to notice a misconfigured/down email
      // provider; the user just sees the same "check your inbox" message.
      console.error("Failed to send password reset email:", err);
    }
  }

  return { success: true };
}
