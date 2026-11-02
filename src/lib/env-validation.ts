/**
 * Boot-time production safety gate, run once from instrumentation.ts's
 * `register()` (Next's documented one-time server-startup hook). Fails fast
 * and loudly if a secret this app depends on is missing or still a known
 * dev/placeholder value, rather than letting the app boot and fail
 * confusingly later (or, worse, run "successfully" with a guessable
 * default).
 *
 * SESSION_SECRET isn't currently read anywhere else in src/ — sessions are
 * DB-backed opaque random tokens (src/lib/session.ts), not signed/JWT, so
 * there's no cryptographic operation that consumes it today. It's validated
 * here anyway because .env.example/CI already treat it as a required
 * production secret (reserved for whatever next needs server-side signing,
 * e.g. CSRF tokens) — this at least guarantees it's actually set to a real
 * value before that day comes, instead of discovering it's still the
 * placeholder once something starts relying on it.
 */

const DEV_PLACEHOLDER_VALUES = new Set([
  "replace-with-a-generated-32-byte-secret",
  "replace-with-a-local-dev-password",
  "ci-only-session-secret-0000000000000000",
  "ci-only-import-secret-0000000000000000",
]);

const MIN_SECRET_LENGTH = 20;

function requireProductionSecret(name: string): void {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} is not set. Refusing to start in production without it — see .env.production.example.`
    );
  }
  if (DEV_PLACEHOLDER_VALUES.has(value)) {
    throw new Error(`${name} is still set to a known dev/placeholder value. Generate a real secret for production.`);
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} is too short to be a real secret (expected at least ${MIN_SECRET_LENGTH} characters).`);
  }
}

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;

  requireProductionSecret("SESSION_SECRET");
  requireProductionSecret("IMPORT_SECRET");
}
