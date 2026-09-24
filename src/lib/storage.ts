import "server-only";

import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Backblaze B2 (S3-compatible API) — switched from the originally planned
// Cloudflare R2 (plan.md section 5) because R2 requires a credit card on
// file to activate even for free-tier usage; B2's free tier does not.
// Swapping providers only touches this file plus env var names, since both
// are S3-compatible — no other code depends on the provider.
function requireB2Config() {
  const endpoint = process.env.B2_ENDPOINT;
  const keyId = process.env.B2_KEY_ID;
  const applicationKey = process.env.B2_APPLICATION_KEY;
  const bucketName = process.env.B2_BUCKET_NAME;

  if (!endpoint || !keyId || !applicationKey || !bucketName) {
    throw new Error(
      "B2 storage is not configured — set B2_ENDPOINT, B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME in .env."
    );
  }
  // The B2 console's displayed endpoint omits the protocol (e.g.
  // "s3.us-east-005.backblazeb2.com"), but the S3 SDK requires a full URL.
  const normalizedEndpoint = endpoint.startsWith("http") ? endpoint : `https://${endpoint}`;
  return { endpoint: normalizedEndpoint, keyId, applicationKey, bucketName };
}

let client: S3Client | undefined;

function getClient(endpoint: string, keyId: string, applicationKey: string): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: keyId, secretAccessKey: applicationKey },
  });
  return client;
}

/**
 * Uploads a file to the B2 bucket. Called from server actions with a Buffer
 * read from FormData — Phase 1 documents (agreements, drawings, photos)
 * comfortably fit a server action's body, so this skips the extra complexity
 * of a browser-side presigned-upload flow.
 */
export async function uploadDocument(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  const { endpoint, keyId, applicationKey, bucketName } = requireB2Config();
  await getClient(endpoint, keyId, applicationKey).send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );
}

/**
 * Presigned PUT URL for a browser to upload straight to B2 (plan.md
 * section 16: "phone -> B2 directly through a presigned upload URL", never
 * proxied through a Next.js route — Vercel request bodies are capped around
 * 4.5MB, which a phone video would exceed). Short expiry (5 minutes, same as
 * the download URL below) since the client is expected to start the upload
 * immediately after requesting this.
 */
export async function getSupervisorUploadUrl(params: {
  key: string;
  contentType: string;
}): Promise<string> {
  const { endpoint, keyId, applicationKey, bucketName } = requireB2Config();
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: params.key,
    ContentType: params.contentType,
  });
  return getSignedUrl(getClient(endpoint, keyId, applicationKey), command, {
    expiresIn: 60 * 5,
  });
}

/**
 * Builds a `Content-Disposition` value that can't be broken out of by a
 * malicious original filename (e.g. one containing `"` or control
 * characters): the quoted `filename` fallback is stripped to safe ASCII, and
 * the RFC 5987 `filename*` form carries the real (possibly non-ASCII) name
 * for clients that support it.
 *
 * B2's own `b2-content-disposition` validator is stricter than RFC 6266 — it
 * rejects punctuation like `(` `)` `,` even inside the quoted `filename`
 * param instead of treating quoted-string as opaque. So the ASCII fallback
 * is restricted to a conservative token-safe charset, not just "printable
 * ASCII minus quote/backslash".
 *
 * The `filename*` (RFC 5987) part needs its own escaping on top of
 * `encodeURIComponent`: JS's `encodeURIComponent` follows the old RFC 2396
 * unreserved set and leaves `! * ' ( )` un-escaped, so a literal `(` from
 * the original filename survives into the header value and trips the same
 * B2 validator even there.
 */
function buildContentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^a-zA-Z0-9 ._-]/g, "_");
  const rfc5987Encoded = encodeURIComponent(fileName).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${rfc5987Encoded}`;
}

/**
 * Generates a time-limited signed download URL (NFR-05: "No public bucket
 * URLs for restricted documents"). Never persist this URL — the schema
 * comment on Document.fileKey is explicit that it's generated fresh on
 * every download so access stays controlled.
 */
export async function getDocumentDownloadUrl(key: string, fileName: string): Promise<string> {
  const { endpoint, keyId, applicationKey, bucketName } = requireB2Config();
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ResponseContentDisposition: buildContentDisposition(fileName),
  });
  return getSignedUrl(getClient(endpoint, keyId, applicationKey), command, {
    expiresIn: 60 * 5,
  });
}

/**
 * Builds the B2 object key for a new upload — scoped by project and category
 * so the bucket stays organized (mirrors the Document Vault folder taxonomy,
 * SRD section 5) and a project's files are trivially identifiable together.
 * The random UUID (not a timestamp) guarantees the key can't collide with an
 * existing object and silently overwrite it, even under concurrent uploads.
 */
export function buildDocumentKey(params: {
  projectId: string;
  category: string;
  fileName: string;
}): string {
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${params.projectId}/${params.category}/${randomUUID()}-${safeName}`;
}
