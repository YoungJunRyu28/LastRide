import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function hashCapability(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createCapabilityToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createJoinCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += JOIN_ALPHABET[randomInt(0, JOIN_ALPHABET.length)];
  }
  return code;
}

export function normalizeJoinCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
