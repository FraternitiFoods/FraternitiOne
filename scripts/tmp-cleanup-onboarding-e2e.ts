/**
 * Removes anything scripts/tmp-e2e-onboarding.ts left behind after a crash
 * (users `tmp-e2e-*@example.com`, their onboardings, LOI/e-sign/payment/file
 * rows, the auto-created "Tulsi - E2E Test City*" Dashboard site + Site, audit
 * and notification rows, B2 objects) and prints counts as proof.
 * Run: `npx tsx scripts/tmp-cleanup-onboarding-e2e.ts` (add `--count` to only count).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

const db = new PrismaClient();
const countOnly = process.argv.includes("--count");

async function deleteB2Prefix(prefix: string) {
  const endpoint = process.env.B2_ENDPOINT!.startsWith("http") ? process.env.B2_ENDPOINT! : `https://${process.env.B2_ENDPOINT}`;
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: process.env.B2_KEY_ID!, secretAccessKey: process.env.B2_APPLICATION_KEY! },
  });
  let n = 0;
  const list = await client.send(new ListObjectsV2Command({ Bucket: process.env.B2_BUCKET_NAME!, Prefix: prefix }));
  for (const obj of list.Contents ?? []) {
    if (!obj.Key) continue;
    if (!countOnly) await client.send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET_NAME!, Key: obj.Key }));
    n++;
  }
  return n;
}

async function counts() {
  const userWhere = { email: { startsWith: "tmp-e2e-" } };
  return {
    users: await db.user.count({ where: userWhere }),
    onboardings: await db.storeOnboarding.count({ where: { workspaceEmail: { startsWith: "tmp-e2e-" } } }),
    dashboardSites: await db.dashboardSite.count({ where: { name: { startsWith: "Tulsi - E2E" } } }),
    sites: await db.site.count({ where: { name: { startsWith: "Tulsi - E2E" } } }),
    sessionsOfTmpUsers: await db.session.count({ where: { user: userWhere } }),
  };
}

async function main() {
  console.log("before:", await counts());
  if (countOnly) return;

  const users = await db.user.findMany({ where: { email: { startsWith: "tmp-e2e-" } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const onboardings = await db.storeOnboarding.findMany({
    where: { OR: [{ workspaceEmail: { startsWith: "tmp-e2e-" } }, { franchiseeUserId: { in: userIds } }, { salesOwnerId: { in: userIds } }] },
    select: { id: true, dashboardSiteId: true },
  });

  for (const o of onboardings) {
    await db.esignEvent.deleteMany({ where: { attempt: { loiVersion: { onboardingId: o.id } } } });
    await db.esignAttempt.deleteMany({ where: { loiVersion: { onboardingId: o.id } } });
    await db.storeOnboarding.update({ where: { id: o.id }, data: { currentLoiVersionId: null } });
    await db.loiVersion.deleteMany({ where: { onboardingId: o.id } });
    await db.paymentSubmission.deleteMany({ where: { onboardingId: o.id } });
    await db.onboardingFile.deleteMany({ where: { onboardingId: o.id } });
    await db.kycSubmission.deleteMany({ where: { onboardingId: o.id } });
    await db.notificationLog.deleteMany({ where: { onboardingId: o.id } });
    await db.auditEvent.deleteMany({ where: { onboardingId: o.id } });
    await db.storeOnboarding.delete({ where: { id: o.id } });
    const b2 = await deleteB2Prefix(`onboarding/${o.id}/`);
    console.log(`onboarding ${o.id}: deleted, B2 objects removed: ${b2}`);
  }

  const sites = await db.dashboardSite.findMany({ where: { name: { startsWith: "Tulsi - E2E" } }, select: { id: true, name: true } });
  for (const s of sites) {
    await db.dashboardSite.delete({ where: { id: s.id } }); // cascades steps + assignments
    await db.auditEvent.deleteMany({ where: { entityType: "DashboardSite", entityId: s.id } });
  }
  await db.site.deleteMany({ where: { name: { startsWith: "Tulsi - E2E" } } }); // cascades Ops BOQ rows

  await db.auditEvent.deleteMany({ where: { OR: [{ entityId: { in: userIds } }, { actorId: { in: userIds } }] } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });

  console.log("after:", await counts());
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
