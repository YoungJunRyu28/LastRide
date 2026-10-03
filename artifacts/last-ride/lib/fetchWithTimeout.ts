/**
 * `fetch` that gives up after `timeoutMs`.
 *
 * React Native's AbortSignal (polyfilled from `abort-controller`) has no static
 * `AbortSignal.timeout()`, so calling it throws before the request is made.
 * This uses a plain AbortController and a timer instead, and clears the timer
 * once the response headers arrive.
 */
export async function fetchWithTimeout(
  input: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
