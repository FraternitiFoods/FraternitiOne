import { LoginForm } from "./login-form";

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const nextParam = searchParams.next;
  const next = typeof nextParam === "string" ? nextParam : undefined;

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-[#0b1220] px-12 py-12 text-white lg:flex">
        <div>
          <div className="text-2xl leading-tight font-bold tracking-tight">FRATERNITI</div>
          <div className="text-2xl leading-tight font-bold tracking-tight">ONE</div>
        </div>
        <div className="max-w-sm space-y-3">
          <p className="text-lg font-medium">One franchise. One journey. One source of truth.</p>
          <p className="text-sm text-slate-400">
            Franchise lifecycle management — replacing spreadsheets and WhatsApp updates with one
            shared project record from Letter of Intent to Grand Opening.
          </p>
        </div>
        <p className="text-xs text-slate-600">Franchise Lifecycle Management + Live Reporting System</p>
      </div>

      <div className="flex w-full flex-1 items-center justify-center bg-muted/30 px-4 lg:w-1/2">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <div className="text-xl font-bold tracking-tight">Fraterniti One</div>
          </div>
          <div>
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your franchise lifecycle workspace.
            </p>
          </div>
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
