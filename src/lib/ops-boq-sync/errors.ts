/** Mirrors src/lib/dashboard-sync/errors.ts — a status-carrying error for ops-boq-sync route handlers. */
export class OpsBoqSyncError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "OpsBoqSyncError";
  }
}
