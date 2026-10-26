import { isIP } from "node:net";

/** Prevent untrusted X-Forwarded-For spoofing of shared rate-limit keys. */
export function trustedProxySettings(env: NodeJS.ProcessEnv): string[] | number {
  const raw = env.TRUST_PROXY_CIDRS?.trim();
  if (raw) {
    const ranges = raw.split(",").map((entry) => entry.trim());
    if (ranges.length > 32) throw new Error("Too many TRUST_PROXY_CIDRS entries");
    for (const entry of ranges) {
      const parts = entry.split("/");
      if (parts.length > 2) throw new Error("Invalid TRUST_PROXY_CIDRS entry");
      const family = isIP(parts[0]);
      const width = family === 4 ? 32 : family === 6 ? 128 : 0;
      const prefix = parts[1] === undefined ? width : Number(parts[1]);
      if (!width || !Number.isInteger(prefix) || prefix < 1 || prefix > width ||
          (parts[1] !== undefined && !/^\d{1,3}$/.test(parts[1]))) {
        throw new Error("Invalid TRUST_PROXY_CIDRS entry");
      }
      if ((family === 4 && prefix < 8) || (family === 6 && prefix < 32)) {
        throw new Error("TRUST_PROXY_CIDRS is too broad");
      }
    }
    return ranges;
  }
  const rawHops = env.TRUST_PROXY_HOPS ?? "0";
  const hops = Number(rawHops);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 8)
    throw new Error("Invalid TRUST_PROXY_HOPS");
  if (hops > 0 && env.NODE_ENV === "production") {
    throw new Error("Production TRUST_PROXY_HOPS is unsafe: set explicit TRUST_PROXY_CIDRS instead");
  }
  return hops;
}
