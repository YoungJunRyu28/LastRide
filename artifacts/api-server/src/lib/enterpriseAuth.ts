import type { Request } from "express";
import { constantTimeTextEqual } from "./enterpriseTokens";

export type EnterprisePrincipal = {
  authUserId: string;
  email: string | null;
};

const tokenCache = new Map<
  string,
  { principal: EnterprisePrincipal; expiresAt: number }
>();
const CACHE_MS = 60_000;

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
  if (!url || !apiKey) return null;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: apiKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;

  const user = (await response.json()) as { id?: unknown; email?: unknown };
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

  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.principal;

  try {
    const principal = await verifyWithSupabase(token);
    if (!principal) return null;
    tokenCache.set(token, { principal, expiresAt: Date.now() + CACHE_MS });
    return principal;
  } catch {
    return null;
  }
}
