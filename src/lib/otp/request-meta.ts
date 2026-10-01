import "server-only";

import { headers } from "next/headers";

/** section 19 data model: OtpChallenge/LoiAcceptance both carry ip/userAgent. */
export async function getRequestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
  return { ip, userAgent: h.get("user-agent") };
}
