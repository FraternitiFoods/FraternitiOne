/** Thrown by boq-import.ts for expected, user-facing failures (bad runId, unknown category, …). */
export class ImportError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ImportError";
    this.status = status;
  }
}
