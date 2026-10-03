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

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") return null;
  const data = breadcrumb.data ? { ...breadcrumb.data } : undefined;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = stripQuery(data[key]);
    }
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
