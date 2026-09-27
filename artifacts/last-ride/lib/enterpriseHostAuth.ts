import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "lastride-enterprise-host-session";

type HostSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  email: string | null;
};

type SupabaseSessionResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  expires_at?: unknown;
  user?: { email?: unknown } | null;
};

function authConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !apiKey) {
    throw new Error("Enterprise sign-in is not configured.");
  }
  return { url, apiKey };
}

async function authFetch(path: string, init: RequestInit): Promise<Response> {
  const { url, apiKey } = authConfig();
  return fetch(`${url}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function parseSession(payload: SupabaseSessionResponse): HostSession | null {
  if (typeof payload.access_token !== "string") return null;
  const expiresAt =
    typeof payload.expires_at === "number"
      ? payload.expires_at * 1000
      : Date.now() +
        (typeof payload.expires_in === "number" ? payload.expires_in : 3600) *
          1000;
  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresAt,
    email:
      payload.user && typeof payload.user.email === "string"
        ? payload.user.email
        : null,
  };
}

async function readSession(): Promise<HostSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<HostSession>;
    if (
      typeof value.accessToken !== "string" ||
      typeof value.expiresAt !== "number"
    ) {
      return null;
    }
    return {
      accessToken: value.accessToken,
      refreshToken:
        typeof value.refreshToken === "string" ? value.refreshToken : null,
      expiresAt: value.expiresAt,
      email: typeof value.email === "string" ? value.email : null,
    };
  } catch {
    return null;
  }
}

async function saveSession(session: HostSession): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function enterpriseOtpConfigured(): boolean {
  return Boolean(
    process.env.EXPO_PUBLIC_SUPABASE_URL &&
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function enterpriseDevAuthAvailable(): boolean {
  return Boolean(
    __DEV__ && process.env.EXPO_PUBLIC_ENTERPRISE_DEV_BEARER_TOKEN,
  );
}

export async function requestEnterpriseOtp(email: string): Promise<void> {
  const response = await authFetch("/otp", {
    method: "POST",
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      create_user: false,
    }),
  });
  if (!response.ok) {
    throw new Error("Could not send organizer sign-in code.");
  }
}

export async function verifyEnterpriseOtp(
  email: string,
  token: string,
): Promise<void> {
  const response = await authFetch("/verify", {
    method: "POST",
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: "email",
    }),
  });
  if (!response.ok) throw new Error("Invalid or expired sign-in code.");
  const session = parseSession(
    (await response.json()) as SupabaseSessionResponse,
  );
  if (!session) throw new Error("Authentication response was incomplete.");
  await saveSession(session);
}

let refreshInFlight: Promise<HostSession | null> | null = null;

async function refreshSession(
  current: HostSession,
): Promise<HostSession | null> {
  if (!current.refreshToken) return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await authFetch("/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      });
      if (!response.ok) return null;
      const refreshed = parseSession(
        (await response.json()) as SupabaseSessionResponse,
      );
      if (!refreshed) return null;
      await saveSession({
        ...refreshed,
        email: refreshed.email ?? current.email,
      });
      return refreshed;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function getEnterpriseAccessToken(): Promise<string | null> {
  const session = await readSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session.accessToken;

  const refreshed = await refreshSession(session);
  if (!refreshed) {
    await AsyncStorage.removeItem(SESSION_KEY);
    return null;
  }
  return refreshed.accessToken;
}

export async function getEnterpriseHostEmail(): Promise<string | null> {
  return (await readSession())?.email ?? null;
}

export async function enterpriseRequestOptions(): Promise<RequestInit> {
  const token = await getEnterpriseAccessToken();
  if (!token) throw new Error("Organizer sign-in required.");
  return { headers: { Authorization: `Bearer ${token}` } };
}

export async function signInEnterpriseDev(): Promise<void> {
  const token = process.env.EXPO_PUBLIC_ENTERPRISE_DEV_BEARER_TOKEN;
  if (!__DEV__ || !token)
    throw new Error("Development organizer is not configured.");
  await saveSession({
    accessToken: token,
    refreshToken: null,
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    email: process.env.EXPO_PUBLIC_ENTERPRISE_DEV_EMAIL || "dev@lastride.local",
  });
}

export async function signOutEnterpriseHost(): Promise<void> {
  const session = await readSession();
  if (session && enterpriseOtpConfigured()) {
    await authFetch("/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    }).catch(() => undefined);
  }
  await AsyncStorage.removeItem(SESSION_KEY);
}
