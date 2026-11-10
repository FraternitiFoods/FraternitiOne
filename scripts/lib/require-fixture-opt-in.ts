import "dotenv/config";
import path from "node:path";

/**
 * Opt-in guard for scripts that push a FIXTURE through a full-snapshot sync/import
 * (BOQ import, Dashboard sync, Sheet sync). Import it for its side effect, right
 * after `import "dotenv/config"`:
 *
 *   import "./lib/require-fixture-opt-in";
 *
 * Why: those imports deactivate every item/site that is not in the payload. On
 * 2026-11-10 an e2e run did exactly that to the Neon *preview* branch (a copy of
 * real BOQ data), leaving Fixture Site A/B/C as the only visible sites (plan.md
 * Progress log, 2026-11-10 evening). The older `E2E_FORBIDDEN_DB_HOSTS` check is a
 * denylist nobody had configured, so it never fired. This is the opposite: refuse
 * unless the caller explicitly says the DATABASE_URL target is throwaway.
 *
 * Usage for one command (PowerShell):
 *   $env:E2E_ALLOW_FIXTURE_PUSH = "1"; npx tsx scripts/<name>.ts
 * Do NOT put it in .env: that defeats the guard.
 */

const script = path.basename(process.argv[1] ?? "this script");

let dbHost = "(DATABASE_URL not set)";
try {
  dbHost = new URL(process.env.DATABASE_URL ?? "").host;
} catch {
  // keep the placeholder; the allow check below still applies
}

const forbidden = (process.env.E2E_FORBIDDEN_DB_HOSTS ?? "").split(",").filter(Boolean);
if (forbidden.some((h) => dbHost.includes(h))) {
  console.error(`Refusing to run ${script}: DB host ${dbHost} is listed in E2E_FORBIDDEN_DB_HOSTS (this overrides the opt-in).`);
  process.exit(1);
}

if (process.env.E2E_ALLOW_FIXTURE_PUSH !== "1") {
  console.error(
    [
      `Refusing to run ${script}.`,
      `It pushes a fixture through a full-snapshot import that DEACTIVATES every real item/site/dashboard site`,
      `missing from the fixture, in the database at: ${dbHost}`,
      ``,
      `Only run it against a throwaway database (e.g. a dedicated Neon "test" branch or the CI Postgres).`,
      `If you are sure, opt in for this one command:`,
      `  PowerShell:  $env:E2E_ALLOW_FIXTURE_PUSH = "1"; npx tsx scripts/${script}`,
      `  bash:        E2E_ALLOW_FIXTURE_PUSH=1 npx tsx scripts/${script}`,
      `Do not put E2E_ALLOW_FIXTURE_PUSH in .env.`,
    ].join("\n")
  );
  process.exit(1);
}

console.log(`[fixture-guard] opt-in accepted for ${script} -> DB host ${dbHost}`);
