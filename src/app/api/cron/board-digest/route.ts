import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBoardSummary } from "@/lib/board-summary";
import { generateBoardDigestPdf } from "@/lib/board-digest-pdf";
import { sendOnboardingEmail } from "@/lib/onboarding/notify";
import { toIstDateKey } from "@/lib/task-timing";
import { dateKeyToDate } from "@/lib/sales/parse-csv";

/**
 * Weekly founder/board digest — triggered by Vercel Cron (see vercel.json),
 * Monday 09:30 IST. Same safety shape plan.md section 24 S4 laid out for its
 * own (still-unbuilt, daily, per-person) task-reminder cron: bearer-secret
 * auth, off unless explicitly enabled, idempotent per period, failed sends
 * logged rather than thrown (P1-14 via notify.ts).
 */

function currentIstWeekMondayKey(now: Date): string {
  const todayKey = toIstDateKey(now);
  const d = new Date(`${todayKey}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun ... 6=Sat
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Off by default outside production (and until explicitly turned on in
  // production too) — a dev/staging database must never email real people.
  if (process.env.BOARD_DIGEST_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  const weekStartKey = currentIstWeekMondayKey(new Date());
  const weekStart = dateKeyToDate(weekStartKey);

  try {
    await db.boardDigestRun.create({ data: { weekStart } });
  } catch {
    // Unique constraint on weekStart — this week's digest already went out
    // (double cron trigger, redeploy, manual re-run). Safe no-op.
    return NextResponse.json({ ok: true, skipped: "already-sent-this-week" });
  }

  const recipients = (process.env.FOUNDER_DIGEST_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no-recipients-configured" });
  }

  const summary = await getBoardSummary();
  const pdf = await generateBoardDigestPdf(summary);
  const appUrl = process.env.APP_URL || "http://localhost:3000";

  for (const to of recipients) {
    // Each send is independently logged/never-throws (notify.ts, P1-14) — one
    // bad address in the list can't block the rest.
    await sendOnboardingEmail({
      key: "board_digest",
      to,
      vars: { weekLabel: weekStartKey, link: `${appUrl}/board` },
      attachments: [{ filename: `board-summary-${weekStartKey}.pdf`, content: pdf }],
    });
  }

  return NextResponse.json({ ok: true, weekStart: weekStartKey, recipients: recipients.length });
}
