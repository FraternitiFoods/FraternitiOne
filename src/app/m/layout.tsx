/**
 * Shared shell for every /m route (plan.md section 16) — a phone-width
 * column, not the desktop sidebar layout under (app). Deliberately has no
 * auth check of its own: /m/login must render inside this same shell while
 * staying public, so each authenticated page under /m calls requireUser()
 * (and checks the SITE_SUPERVISOR role) itself, the same way (auth) group
 * pages don't share a layout-level check either.
 */
export default function MLayout({ children }: LayoutProps<"/m">) {
  return <div className="mx-auto min-h-screen max-w-md bg-background">{children}</div>;
}
