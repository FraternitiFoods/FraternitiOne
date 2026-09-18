import Link from "next/link";
import { validatePasswordResetToken } from "@/lib/password-reset-tokens";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage(props: PageProps<"/reset-password/[token]">) {
  const { token } = await props.params;
  const validated = await validatePasswordResetToken(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm space-y-6">
        {validated ? (
          <>
            <div>
              <h1 className="text-xl font-semibold">
                {validated.purpose === "INVITE" ? "Set your password" : "Reset your password"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {validated.userEmail}
              </p>
            </div>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-semibold">Link invalid or expired</h1>
              <p className="text-sm text-muted-foreground">
                This link has already been used or is no longer valid. Request a new one.
              </p>
            </div>
            <Link
              href="/forgot-password"
              className="block text-center text-sm text-primary hover:underline"
            >
              Request a new link
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
