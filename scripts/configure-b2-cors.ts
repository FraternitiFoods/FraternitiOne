/**
 * One-off (idempotent) setup: configures the B2 bucket's CORS rules so a
 * supervisor's phone can PUT a file straight to B2 via a presigned URL
 * (plan.md section 16 — "bucket CORS needed", flagged in the plan itself).
 * Safe to re-run; it replaces the bucket's CORS rule set with exactly this.
 *
 * Run with: npx tsx scripts/configure-b2-cors.ts [--apply]
 * Without --apply, only prints the bucket's current CORS rules.
 */
// Unlike the other scripts/*.ts (which go through PrismaClient, and
// @prisma/client auto-loads .env internally), this one talks to B2 directly
// via the AWS SDK, so .env needs loading explicitly here.
import "dotenv/config";
import {
  S3Client,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";

const endpointRaw = process.env.B2_ENDPOINT;
const keyId = process.env.B2_KEY_ID;
const applicationKey = process.env.B2_APPLICATION_KEY;
const bucketName = process.env.B2_BUCKET_NAME;
const appUrl = process.env.APP_URL || "http://localhost:3000";

if (!endpointRaw || !keyId || !applicationKey || !bucketName) {
  throw new Error("B2 env vars missing — see .env.example.");
}
const endpoint = endpointRaw.startsWith("http") ? endpointRaw : `https://${endpointRaw}`;

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId: keyId, secretAccessKey: applicationKey },
});

async function main() {
  try {
    const existing = await client.send(new GetBucketCorsCommand({ Bucket: bucketName! }));
    console.log("Current CORS rules:", JSON.stringify(existing.CORSRules, null, 2));
  } catch (err) {
    console.log("No existing CORS config (or error reading it):", (err as Error).message);
  }

  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("\nRun with --apply to set the CORS rules needed for /m uploads.");
    return;
  }

  // AllowedOrigins deliberately includes both localhost (dev) and the real
  // app URL from .env — B2 needs an explicit origin list, no wildcard-with-
  // credentials equivalent concern here since presigned URLs carry their own
  // auth in the query string, not cookies.
  const origins = Array.from(new Set([appUrl, "http://localhost:3000"]));

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucketName!,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ["PUT", "GET"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );
  console.log("CORS rules applied for origins:", origins);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
