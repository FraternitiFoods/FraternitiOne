import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Forgot password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
