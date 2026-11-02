/**
 * Interactive, idempotent Admin user creation — the one supported way to
 * create the first production Admin account (there's no seeded admin/
 * password in prisma/seed-prod.ts, by design: that script never creates
 * users). Prompts for name, email and password in the terminal; the password
 * is masked while typing and is never accepted as a CLI argument or printed/
 * logged, so it can't end up in shell history or CI logs.
 *
 * Hashing mirrors src/lib/auth.ts's hashPassword exactly (bcrypt, 12 salt
 * rounds) rather than importing it: every file under src/lib that the app's
 * own auth code lives in starts with `import "server-only"`, which throws
 * unconditionally outside Next's own bundler — so it can't be imported from
 * a plain tsx script (this is also why prisma/seed.ts reimplements it).
 *
 * Idempotent by email: an existing account is left alone unless you
 * explicitly confirm a password reset for it; its role is only changed to
 * ADMIN if you confirm that too.
 *
 * Run with: npm run create-admin
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import readline from "node:readline";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

const db = new PrismaClient();

// One shared interface for the whole script — readline's `question()` is
// meant to be called repeatedly on the same instance. Creating a fresh
// Interface per prompt (the first version of this script did) silently
// drops any input that arrived in the same stdin chunk as an earlier
// answer, which hangs the very next prompt whenever stdin is piped rather
// than typed live.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * Masks input as it's typed by putting stdin into raw mode. Falls back to
 * the plain `ask` when stdin isn't a real TTY (e.g. input piped from a
 * file) — raw mode has nothing to mask in that case anyway.
 *
 * Pauses (and later resumes) the shared `rl` interface around the raw-mode
 * read so the two input-handling modes never both listen to stdin at once.
 */
function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return ask(question);
  }

  return new Promise((resolve) => {
    process.stdout.write(question);
    let input = "";
    const stdin = process.stdin;
    rl.pause();
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeListener("data", onData);
      rl.resume();
    };

    const onData = (char: string) => {
      switch (char) {
        case "\n":
        case "\r":
        case "": // Ctrl+D
          cleanup();
          process.stdout.write("\n");
          resolve(input);
          break;
        case "": // Ctrl+C
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
          break;
        case "": // backspace (DEL)
        case "\b":
          input = input.slice(0, -1);
          break;
        default:
          input += char;
          break;
      }
    };
    stdin.on("data", onData);
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  console.log("Create (or reset) a production Admin account.\n");

  let name = "";
  while (!name) {
    name = await ask("Name: ");
    if (!name) console.log("Name is required.");
  }

  let email = "";
  while (!email) {
    const raw = await ask("Email: ");
    const candidate = raw.trim().toLowerCase();
    if (!isValidEmail(candidate)) {
      console.log("Enter a valid email address.");
      continue;
    }
    email = candidate;
  }

  let password = "";
  while (!password) {
    const candidate = await askHidden("Password (min 8 characters): ");
    if (candidate.length < MIN_PASSWORD_LENGTH) {
      console.log(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      continue;
    }
    const confirm = await askHidden("Confirm password: ");
    if (candidate !== confirm) {
      console.log("Passwords don't match — try again.\n");
      continue;
    }
    password = candidate;
  }

  const existing = await db.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`\nA user with email "${email}" already exists (role: ${existing.role}, active: ${existing.isActive}).`);
    const confirmReset = await ask("Reset this user's password and set role to ADMIN? [y/N]: ");
    if (confirmReset.toLowerCase() !== "y") {
      console.log("Aborted — no changes made.");
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const updated = await db.user.update({
      where: { email },
      data: {
        passwordHash,
        role: "ADMIN",
        isActive: true,
        name,
        loginFailedAttempts: 0,
        loginLockedUntil: null,
      },
    });
    console.log(`\nUpdated existing user as Admin: ${updated.email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const created = await db.user.create({
    data: { name, email, role: "ADMIN", passwordHash },
  });
  console.log(`\nCreated Admin: ${created.email}`);
}

main()
  .catch((err) => {
    console.error("\ncreate-admin failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await db.$disconnect();
  });
