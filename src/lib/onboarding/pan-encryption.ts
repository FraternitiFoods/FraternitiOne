import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * plan.md section 17: "PAN number is stored encrypted at app level
 * (AES-GCM, key in env)". PAN_ENCRYPTION_KEY is an arbitrary passphrase (not
 * required to be exactly 32 bytes) — scrypt derives a proper 256-bit key
 * from it, same reasoning as not asking operators to manage raw key bytes.
 */

function getKey(): Buffer {
  const secret = process.env.PAN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("PAN_ENCRYPTION_KEY is not set — see .env.example.");
  }
  // Fixed salt: this only needs to be a stable key derivation, not a
  // password hash — the secret itself is the real protection.
  return scryptSync(secret, "fraterniti-one-pan-encryption", 32);
}

const IV_LENGTH = 12; // AES-GCM standard nonce size

export function encryptPan(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((b) => b.toString("base64")).join(".");
}

export function decryptPan(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted PAN value.");
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
