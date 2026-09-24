import { MLoginForm } from "./login-form";

export default function MLoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs space-y-6">
        <div className="text-center">
          <div className="text-xl font-bold tracking-tight">Fraterniti One</div>
          <p className="mt-1 text-sm text-muted-foreground">Site supervisor sign in</p>
        </div>
        <MLoginForm />
      </div>
    </div>
  );
}
