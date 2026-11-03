/** Mirrors src/lib/import/errors.ts — a status-carrying error for sheet-sync route handlers. */
export class SyncError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SyncError";
  }
}
