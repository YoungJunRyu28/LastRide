export function positiveIntegerEnv(
  name: string,
  fallback: number,
  bounds: { min?: number; max?: number } = {},
): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : NaN;
  const value = Number.isInteger(parsed) ? parsed : fallback;
  return Math.min(
    bounds.max ?? Number.MAX_SAFE_INTEGER,
    Math.max(bounds.min ?? 1, value),
  );
}

export function providerTimeoutMs(): number {
  return positiveIntegerEnv("PROVIDER_TIMEOUT_MS", 5_000, {
    min: 1_000,
    max: 12_000,
  });
}
