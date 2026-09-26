import "server-only";

import { db } from "@/lib/db";

const PLACEHOLDER_TEMPLATE_NAME = "Default Placeholder LOI";

const PLACEHOLDER_BODY = `This Letter of Intent ("LOI") records the intent of {{applicantLegalName}} ({{entityType}}{{companyName}}) to enter into a franchise arrangement with Fraterniti for the brand {{brand}} at the proposed location: {{storeLocation}}.

Fee amount: {{feeAmount}} ({{feeInWords}}).
Territory: {{territory}}.
Commercial terms: {{commercialTerms}}.

This document is a working placeholder pending final legal review — it is not the approved LOI text and must not be treated as a binding agreement until replaced with the approved template (plan.md section 17, "NOT DECIDED YET" #2).

Issue date: {{issueDate}}. Version: {{versionNo}}.`;

/**
 * plan.md section 17 "LOI engine": ships one placeholder template
 * (isApproved=false, isPlaceholder=true), self-seeded on first use — same
 * pattern as notify.ts's EmailTemplate self-seeding. Prefers any
 * Admin-approved template if one exists; falls back to the placeholder
 * otherwise. Admin manages template versions (not built as its own screen
 * yet — flagged in the final report).
 */
export async function getActiveLoiTemplate() {
  const approved = await db.loiTemplate.findFirst({
    where: { isApproved: true },
    orderBy: { version: "desc" },
  });
  if (approved) return approved;

  const existingPlaceholder = await db.loiTemplate.findFirst({
    where: { name: PLACEHOLDER_TEMPLATE_NAME },
    orderBy: { version: "desc" },
  });
  if (existingPlaceholder) return existingPlaceholder;

  return db.loiTemplate.create({
    data: {
      name: PLACEHOLDER_TEMPLATE_NAME,
      version: 1,
      body: PLACEHOLDER_BODY,
      requiredFields: [
        "brand",
        "storeLocation",
        "applicantLegalName",
        "entityType",
        "feeAmount",
        "territory",
        "commercialTerms",
        "issueDate",
        "versionNo",
      ],
      isApproved: false,
      isPlaceholder: true,
    },
  });
}

export function nextVersionNo(currentVersionNo: string | null): string {
  if (!currentVersionNo) return "1.0";
  const [major, minor] = currentVersionNo.split(".").map(Number);
  return `${major}.${(minor ?? 0) + 1}`;
}

export function amountToWords(rupees: number): string {
  // Minimal, good-enough-for-a-legal-doc-placeholder formatter — not a full
  // Indian numbering-system word converter (lakh/crore), which is out of
  // scope for a placeholder template that gets replaced anyway.
  return `Rupees ${rupees.toLocaleString("en-IN")} only`;
}
