import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { hasValidImportSecret } from "@/lib/import/auth";
import { importTrackerRows } from "@/lib/import/tracker-import";

const RowSchema = z.object({
  siteName: z.string().trim().min(1),
  stepCode: z.string().trim().min(1),
  status: z.string().trim().optional(),
  assignee: z.string().trim().optional().nullable(),
  remark: z.string().trim().optional().nullable(),
});

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1),
  overwrite: z.boolean().optional().default(false),
});

/**
 * site-tracker-plan.md section 7, Phase 2 (milestone T6, optional): bulk
 * status push from the live sheet via Abhishek's Apps Script, same bearer-
 * secret mechanism as /api/import/boq/* (IMPORT_SECRET). No mode gate here
 * — unlike Site BOQ, the Tracker has no SHEET_LIVE/WEBSITE_LIVE concept; the
 * website is always the live editor, and this import only ever touches rows
 * nobody has edited on the website yet (or any row, if `overwrite: true`).
 */
export async function POST(request: NextRequest) {
  if (!hasValidImportSecret(request)) {
    return NextResponse.json({ error: "Invalid or missing bearer secret." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let input: z.infer<typeof BodySchema>;
  try {
    input = BodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid request body.", issues: err.issues }, { status: 400 });
    }
    throw err;
  }

  const result = await importTrackerRows(input.rows, input.overwrite);
  return NextResponse.json(result);
}
