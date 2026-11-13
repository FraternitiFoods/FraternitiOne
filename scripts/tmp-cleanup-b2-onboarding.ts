import "dotenv/config";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

async function main() {
  const endpoint = process.env.B2_ENDPOINT!.startsWith("http") ? process.env.B2_ENDPOINT! : `https://${process.env.B2_ENDPOINT}`;
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: process.env.B2_KEY_ID!, secretAccessKey: process.env.B2_APPLICATION_KEY! },
  });
  const list = await client.send(new ListObjectsV2Command({ Bucket: process.env.B2_BUCKET_NAME!, Prefix: "onboarding/" }));
  for (const obj of list.Contents ?? []) {
    if (!obj.Key) continue;
    await client.send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET_NAME!, Key: obj.Key }));
    console.log("deleted", obj.Key);
  }
  console.log("done");
}

main().catch((e) => console.error(e));
