/**
 * Crash and error reporting via Sentry. Off unless the build sets
 * EXPO_PUBLIC_SENTRY_DSN, and never on in development builds.
 *
 * Reports carry the error, stack trace, app version and device/OS model only.
 * Everything that could reveal where someone is or is going is stripped before
 * it leaves the phone: query strings (coordinates, station and address
 * searches, join tokens) are removed from request and navigation URLs, and
 * console output is not collected at all.
 */
import * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";
import { isDevelopment } from "@/lib/api";
import { scrubBreadcrumb, scrubEventBreadcrumbs, stripQuery } from "@/lib/crashScrub";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();

export const crashReportingEnabled =
  Boolean(dsn) && !isDevelopment && Platform.OS !== "web";

export function initCrashReporting(): void {
  if (!crashReportingEnabled) return;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    // Errors only: no performance tracing, profiling or session replay.
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend(event) {
      if (event.request?.url) {
        event.request = { url: stripQuery(event.request.url) };
      }
      delete event.user;
      return scrubEventBreadcrumbs(event);
    },
    // The iOS SDK's own network breadcrumbs keep each request's query string
    // (coordinates, searches) and its native crash reports skip beforeSend: don't
    // record them at all. Passed through to sentry-cocoa's options.
    ...({ enableNetworkBreadcrumbs: false } as object),
  });
}

/** Report an error caught by a boundary or handler without crashing. */
export function reportError(error: unknown): void {
  if (crashReportingEnabled) Sentry.captureException(error);
}
