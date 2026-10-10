/**
 * Recoverable group invites.
 *
 * Joining looks invites up by SHA-256 hash only (see groupsTable). In
 * addition, the current invite token + join code are kept encrypted with
 * AES-256-GCM so whoever is host — including a new host after a transfer, or
 * the same host after reinstalling — can re-share the *same* link that is
 * already pinned in a chat, instead of being forced to rotate it.
 *
 * A database dump alone does not reveal invites: decryption needs
 * GROUP_INVITE_ENCRYPTION_KEY (32 bytes, base64 or hex) from the runtime
 * secret. Without a key in production nothing is stored and the host simply
 * rotates to get a fresh invite. Outside production a fixed development key
 * is used so local setups work without configuration.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";

function encryptionKey(): Buffer | null {
  const raw = process.env.GROUP_INVITE_ENCRYPTION_KEY?.trim();
  if (raw) {
    const decoded = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    if (decoded.length !== 32) {
      throw new Error("GROUP_INVITE_ENCRYPTION_KEY must decode to 32 bytes");
    }
    return decoded;
  }
  if (process.env.NODE_ENV === "production") return null;
  return createHash("sha256").update("lastride-dev-group-invites").digest();
}

export type GroupInviteSecret = { inviteToken: string; joinCode: string };

export function sealGroupInvite(
  groupId: string,
  invite: GroupInviteSecret,
): string | null {
  const key = encryptionKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // Bind the ciphertext to its group so rows cannot be swapped.
  cipher.setAAD(Buffer.from(groupId, "utf8"));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(invite), "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

export function openGroupInvite(
  groupId: string,
  sealed: string | null,
): GroupInviteSecret | null {
  if (!sealed) return null;
  let key: Buffer | null;
  try {
    key = encryptionKey();
  } catch {
    return null;
  }
  if (!key) return null;
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(groupId, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plain) as Partial<GroupInviteSecret>;
    if (
      typeof parsed.inviteToken !== "string" ||
      typeof parsed.joinCode !== "string"
    ) {
      return null;
    }
    return { inviteToken: parsed.inviteToken, joinCode: parsed.joinCode };
  } catch {
    // Wrong/rotated key or tampered row: the host can rotate for a new invite.
    return null;
  }
}
