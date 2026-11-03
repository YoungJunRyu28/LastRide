/**
 * Strips anything location-revealing from crash-report breadcrumbs before
 * they leave the phone. Kept free of React Native imports so it is testable.
 */
import type { Breadcrumb } from "@sentry/react-native";

/** "https://host/path?lat=35.6&lon=139.7" → "https://host/path". */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Keys the native SDK puts the query string and fragment under (sentry-cocoa network breadcrumbs). */
const QUERY_KEYS = ["http.query", "http.fragment", "query", "fragment"];

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") return null;
  const data = breadcrumb.data ? { ...breadcrumb.data } : undefined;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = stripQuery(data[key]);
    }
    for (const key of QUERY_KEYS) delete data[key];
  }
  return {
    ...breadcrumb,
    data,
    message:
      breadcrumb.message && /https?:\/\/|[?&]\w+=/.test(breadcrumb.message)
        ? stripQuery(breadcrumb.message)
        : breadcrumb.message,
  };
}

/**
 * The same for the breadcrumbs carried inside an event: native breadcrumbs (the
 * iOS SDK records network requests with their query strings) join JS events
 * without passing through beforeBreadcrumb.
 */
export function scrubEventBreadcrumbs<T extends { breadcrumbs?: Breadcrumb[] }>(event: T): T {
  if (!event.breadcrumbs) return event;
  return {
    ...event,
    breadcrumbs: event.breadcrumbs
      .map((breadcrumb) => scrubBreadcrumb(breadcrumb))
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null),
  };
}
