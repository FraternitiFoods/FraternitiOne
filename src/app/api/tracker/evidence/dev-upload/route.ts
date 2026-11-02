import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { canEditSiteTracker } from "@/lib/permissions";
import { isUsingLocalDevFallback, writeLocalDevFile } from "@/lib/tracker-storage";
import { MAX_VIDEO_BYTES } from "@/lib/tracker-evidence-rules";

/**
 * Dev-only fallback target for presigned uploads when B2 credentials are
 * blank (site-tracker-plan.md section 5). Mirrors the shape of a presigned
 * B2 PUT (client does `fetch(uploadUrl, { method: "PUT", body: file })`)
 * but writes straight to `.local-uploads/` on this machine. Not reachable
 * when B2 is configured or in production — see isUsingLocalDevFallback.
 */
export async function PUT(request: NextRequest) {
  if (!isUsingLocalDevFallback()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const user = await requireUser();
  if (!canEditSiteTracker(user)) {
    return NextResponse.json({ error: "You don't have permission to edit Site Tracker." }, { status: 403 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 });
  }

  const arrayBuffer = await request.arrayBuffer();
  if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "File is empty or too large." }, { status: 400 });
  }

  try {
    await writeLocalDevFile(key, Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("Dev evidence upload error:", err);
    return NextResponse.json({ error: "Could not store the file." }, { status: 400 });
  }

  return new NextResponse(null, { status: 200 });
}
