import "server-only";

import { db } from "@/lib/db";

/** The latest notification-log rows for one onboarding — what the franchisee portal's "Latest emails sent" card renders. */
export async function getRecentEmails(onboardingId: string, take = 5) {
  return db.notificationLog.findMany({
    where: { onboardingId },
    orderBy: { sentAt: "desc" },
    take,
  });
}
