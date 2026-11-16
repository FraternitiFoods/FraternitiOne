/**
 * What the franchisee assistant knows about the onboarding process. This is the
 * ONLY source of general facts the bot may state, so its accuracy is exactly the
 * accuracy of this file. Every line below was taken from how the portal actually
 * works today (steps, statuses, required documents come from
 * src/lib/onboarding/*). Anything the product does not define yet (fee
 * breakdown, timelines, refunds, store formats, legal terms) is deliberately
 * NOT written here: the prompt tells the bot to send those questions to the
 * franchisee's Sales contact instead of guessing.
 *
 * To teach the bot more, add facts here (one short line each) and keep them in
 * sync with the portal. No secrets, no per-franchisee data: that is added per
 * request by chat-prompt.ts.
 */
export const CHAT_KNOWLEDGE = `
ABOUT THE PORTAL
- This is the Fraterniti One franchisee portal. After you log in you can use four pages from the left menu: Welcome (intro videos, next steps, this assistant), Progress (your current status and latest emails), KYC & Documents (upload your documents and payment receipt), and LOI & E-Sign (review and sign your Letter of Intent).
- Your account is created by your Sales contact. If you cannot log in or something about your account looks wrong, ask your Sales contact.

THE ONBOARDING STEPS, IN ORDER
1. Submit your KYC documents and payment receipt (KYC & Documents page).
2. The team reviews your submission. You get an email when a decision is made. Status shows as "Under Review".
3. If something needs fixing, the status becomes "Corrections Requested". The reason is shown on the KYC & Documents page. Re-upload what was asked for.
4. When everything is accepted, your Letter of Intent (LOI) is prepared. Status "Ready for Signature". You review it on the LOI & E-Sign page and sign it with Aadhaar e-sign.
5. After you sign, the company signatory countersigns. Status "Franchisee Signed" means you are waiting for the company.
6. When the company has signed, the LOI is complete ("LOI Complete") and your project is created. After that you use the Dashboard instead of this onboarding portal.

STATUS MEANINGS
- Awaiting KYC & Payment: you still need to submit documents and the payment receipt.
- Under Review: the team is checking your documents and payment. Nothing is needed from you.
- Corrections Requested: something must be re-uploaded. See the reason on the KYC & Documents page.
- Ready for Signature: your LOI is ready for you to review and e-sign.
- Franchisee Signed: you have signed; waiting for the company to countersign.
- LOI Complete: everything is signed and your project has been created.

DOCUMENTS
- If you are applying as an Individual, the required documents are: PAN card and Aadhaar card.
- If you are applying as a Company, the required documents are: PAN card, Aadhaar card, Certificate of incorporation, and a Board resolution / authorisation letter.
- You also upload a payment receipt for the LOI fee.
- Optional extra documents you may upload: address proof, photograph, bank statement, cancelled cheque, GST certificate, partnership deed / LLP agreement, other supporting document.
- Besides the files, the KYC form asks for details such as the PAN number and name. Individuals also give the Aadhaar holder name and last 4 digits; companies give the company name, company PAN and authorised signatory name.
- Documents and personal details are entered ONLY on the KYC & Documents page, never in this chat.

MONEY
- The LOI fee that applies to you is shown in the "Your details" section you are given below, and on your Progress page. Only quote that amount. Do not explain what it covers, or discuss refunds, taxes or any other amount, because that is not in this knowledge: refer the franchisee to their Sales contact.

NOT COVERED HERE (always refer to the Sales contact)
- How long each step takes, fee breakdown, refunds, legal terms of the LOI, store formats or locations, training, supply, anything about the business beyond the steps above.
`.trim();
