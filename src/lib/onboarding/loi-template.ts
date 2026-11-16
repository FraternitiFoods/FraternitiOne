import "server-only";

import { db } from "@/lib/db";

const TULSI_LOI_TEMPLATE_NAME = "Tulsi Standard LOI";

const FRANCHISOR_CIN = "U56301HR2024PTC119387";

/**
 * The approved Tulsi Letter of Intent, transcribed verbatim from the
 * director-signed reference document (plan.md section 17 "LOI engine").
 * This is the real, production-releasable template — not a placeholder —
 * so it ships with isApproved=true/isPlaceholder=false below. Section
 * markers (§1, §2, ...) are consumed by loi-pdf.ts to lay each clause out
 * on the same pages/order as the reference PDF; they are stripped before
 * rendering.
 */
const TULSI_LOI_BODY = `§TITLE
Tulsi
Letter of Intent

§FIELDS
Date: {{issueDate}}
Name: {{name}}
Aadhaar: {{aadhaarMasked}}

§INTRO
Fraterniti Luxury Pvt Ltd a firm incorporated under the laws of India, holding CIN: ${FRANCHISOR_CIN} in India and {{name}} propose to record their interest in establishment of Tulsi Brand owned by the Franchisor for the territory within {{territory}}

§DEFS
LOI: LOI means this Letter of Intent executed between the Franchisee and the Franchisor.

GST: Goods and Services Tax applicable under laws of India.

This Letter of Intent (LOI) records the good faith understanding of the parties as on the date of its execution, Subject to successful approval of franchise and terms both parties will work towards and enter into definitive Franchise Agreement within 30(Thirty) days (the "LOI Term") from the signing date of this LOI which will consist of all final terms and conditions. The brief terms and conditions are as hereunder:

Term: 9(Nine) years from the date of execution of the Franchise Agreement and both party agrees to renew the term without any cost.

During the Reservation Period, the Franchisor shall not issue another territory reservation LOI or execute another franchise agreement with a third party for an equivalent Tulsi dine-in outlet within the Reserved Territory

§FEES
Territory Blocking Fees: INR {{feeAmount}} ({{feeInWords}}) plus GST only to be paid in Advance.
This amount will be adjusted against Project Cost.

§SERVICES
Services:

The setup process for the Franchise shall be as follows:

- The Franchisor shall assist the Franchisee in site development as well as providing complete vendor solutions for equipment required by the Franchisee with a detailed costing for the initial setup. The Franchisor shall also share a plan for optimum utilization and development of the site.
- The Franchiser shall assist for team hiring and selection at all levels and will assist franchisee with all levels hiring and interviews. However, franchise will be fully responsible for salaries and all monetary payments.
- The Franchisor shall train the team as per the Franchisor's internal policy, including carrying out onsite and offsite trainings for top management and kitchen staff. The Franchisee shall fully cooperate with all requirements of the Franchisor for such training.
- Franchisor will provide a complete support in operations and in respect of which the Franchisor shall provide an assistance in obtaining online listings with partners as well as providing existing benefits enjoyed by the Brand with online partners.
- The Franchisee shall be primarily responsible for all statutory, site and other compliances that may arise from time to time. The Franchisor shall share all required documents for site compliance, assist in application, receipt of requisite documents and shall provide support for company registration and all banking processes.
- The Franchisor shall share the road map for product/brand development by using the already successful model of product upliftment for existing franchisees.
- The Franchisor shall share a detailed process regarding complete general management, incorporating all trainings, products costings, control, daily and monthly reports and balance sheets.

§ROYALTY
- The Franchisee will work with standardized vendors suggested by the Franchisor. The Franchisor will ensure that the standardized vendors are aligned with the Franchisee and will offer benefits of rates and schemes offered by the Franchisor. Franchisee is allowed to use their own equivalent vendors at site.
- The Franchisor will ensure that through its vendor's, standard packed products are provided to the Franchisee for daily operations.
- The Franchisee will adhere to future road maps and developments provided by the Franchisor that are aligned to its growth.

Royalty will be applicable 6-10% as per agreed slabs on net sales

Operating expenses and Taxes: Franchisee will bear all operating expenses of the store including Rent, Salary, Municipal Taxes, Common Area Maintenance, Property Taxes, Marketing expenses, in relation to the Store. Brand will cover the digital marketing support with complete designing and placing online posts and reach.

§CONFIDENTIAL
Confidential - The Parties acknowledge that (1) the terms and existence of this letter of intent are confidential; and (2) during the course of negotiations for this letter of intent and for the detailed documentation referred to in this letter, information concerning the business of each of the parties will be disclosed to the other (together the "Confidential Information"). Each party agrees to keep the Confidential Information disclosed to it confidential, to use it only for the purposes of evaluating the detailed documentation and to disclose it only to those of its employees, representatives and advisors as will be necessary for the purpose of evaluating the documentation and then only on terms that it will be kept confidential. Information which is in the public domain other than by breach of confidential obligation will not be considered confidential Information for the purpose of this paragraph. Nothing in this paragraph will prevent disclosures as required by applicable law or competent regulatory authority.

§GOVERNING
Governing Law and Jurisdiction - This Letter, will be governed by and construed in accordance with the laws of India. In case of any dispute arising out between the parties pertaining to this Letter, the Parties will submit to the exclusive jurisdiction of the courts of Gurgaon, India. Please confirm the above by signing herein below.

Looking forward to a long and mutually beneficial relationship.

§BANK
Bank Details
Bank Name: HDFC Bank
A/c Name: Fraterniti Luxury Pvt Ltd
A/c Number: 50200094593530
IFSC Code: HDFC0009285
UPI: fraternitifoodspvtlt.63002677@hdfcbank`;

/**
 * plan.md section 17 "LOI engine": ships the approved Tulsi LOI template,
 * self-seeded on first use — same pattern as notify.ts's EmailTemplate
 * self-seeding. Prefers any Admin-approved template if one exists (a future
 * admin screen could supersede this one); falls back to self-seeding this
 * one otherwise. Admin template-version management is not built as its own
 * screen yet — flagged in the final report.
 */
export async function getActiveLoiTemplate() {
  const approved = await db.loiTemplate.findFirst({
    where: { isApproved: true },
    orderBy: { version: "desc" },
  });
  if (approved) return approved;

  const existing = await db.loiTemplate.findFirst({
    where: { name: TULSI_LOI_TEMPLATE_NAME },
    orderBy: { version: "desc" },
  });
  if (existing) return existing;

  return db.loiTemplate.create({
    data: {
      name: TULSI_LOI_TEMPLATE_NAME,
      version: 1,
      body: TULSI_LOI_BODY,
      requiredFields: ["name", "aadhaarMasked", "territory", "feeAmount", "feeInWords", "issueDate"],
      isApproved: true,
      isPlaceholder: false,
    },
  });
}

export function nextVersionNo(currentVersionNo: string | null): string {
  if (!currentVersionNo) return "1.0";
  const [major, minor] = currentVersionNo.split(".").map(Number);
  return `${major}.${(minor ?? 0) + 1}`;
}

export function amountToWords(rupees: number): string {
  // Minimal, good-enough-for-a-legal-doc formatter — not a full Indian
  // numbering-system word converter (lakh/crore).
  return `Rupees ${rupees.toLocaleString("en-IN")} only`;
}

/** P1-04 hard rule: never surface the full Aadhaar number, only the last 4 digits we store. */
export function maskAadhaar(aadhaarLast4: string | null): string {
  return aadhaarLast4 ? `XXXX XXXX ${aadhaarLast4}` : "________";
}
