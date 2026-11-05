/** Mirrors src/lib/sheet-sync/errors.ts — a status-carrying error for dashboard-sync route handlers. */
export class DashboardSyncError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "DashboardSyncError";
  }
}
