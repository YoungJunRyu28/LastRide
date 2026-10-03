import { createHash } from "node:crypto";
import type { Request } from "express";
import { constantTimeTextEqual } from "./enterpriseTokens";

export type EnterprisePrincipal = {
  authUserId: string;
  email: string | null;
};

export class EnterpriseAuthUnavailableError extends Error {
  constructor(message = "Organizer authentication service is unavailable") {
    super(message);
    this.name = "EnterpriseAuthUnavailableError";
  }
}

const tokenCache = new Map<
  string,
  { principal: EnterprisePrincipal; expiresAt: number }
>();
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 512;

function tokenCacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cachePrincipal(token: string, principal: EnterprisePrincipal): void {
  const now = Date.now();
  for (const [key, value] of tokenCache) {
    if (value.expiresAt <= now) tokenCache.delete(key);
  }
  while (tokenCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = tokenCache.keys().next().value as string | undefined;
    if (!oldest) break;
    tokenCache.delete(oldest);
  }
  tokenCache.set(tokenCacheKey(token), {
    principal,
    expiresAt: now + CACHE_MS,
  });
}

function bearerToken(req: Request): string | null {
  const value = req.header("authorization");
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

async function verifyWithSupabase(
  token: string,
): Promise<EnterprisePrincipal | null> {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !apiKey) {
    throw new EnterpriseAuthUnavailableError(
      "Organizer authentication is not configured",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: apiKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new EnterpriseAuthUnavailableError();
  }
  if (response.status === 429 || response.status >= 500) {
    throw new EnterpriseAuthUnavailableError();
  }
  if (!response.ok) return null;

  let user: { id?: unknown; email?: unknown };
  try {
    user = (await response.json()) as { id?: unknown; email?: unknown };
  } catch {
    throw new EnterpriseAuthUnavailableError(
      "Organizer authentication returned an invalid response",
    );
  }
  if (typeof user.id !== "string" || !user.id) return null;
  return {
    authUserId: user.id,
    email: typeof user.email === "string" ? user.email : null,
  };
}

export async function authenticateEnterpriseRequest(
  req: Request,
): Promise<EnterprisePrincipal | null> {
  const token = bearerToken(req);
  if (!token) return null;

  const devToken = process.env.ENTERPRISE_DEV_BEARER_TOKEN;
  if (
    process.env.NODE_ENV !== "production" &&
    devToken &&
    constantTimeTextEqual(token, devToken)
  ) {
    return {
      authUserId: process.env.ENTERPRISE_DEV_AUTH_USER_ID || "dev-organizer",
      email: process.env.ENTERPRISE_DEV_EMAIL || "dev@lastride.local",
    };
  }

  const cacheKey = tokenCacheKey(token);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.principal;
  if (cached) tokenCache.delete(cacheKey);

  const principal = await verifyWithSupabase(token);
  if (!principal) return null;
  cachePrincipal(token, principal);
  return principal;
}
