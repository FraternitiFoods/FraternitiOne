import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { landingPathForRole } from "@/lib/role-access";

/**
 * Role-aware landing (plan.md section 12): roles that can't see Site BOQ
 * would 403 there, so they land on the Dashboard instead. proxy.ts sends
 * already-signed-in visitors of /login here because it can't know the role.
 */
export default async function RootPage() {
  const user = await requireUser();
  redirect(landingPathForRole(user.role, user.onboardingStatus));
}
