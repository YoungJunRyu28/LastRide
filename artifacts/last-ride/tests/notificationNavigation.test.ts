import { describe, expect, test } from "vitest";
import { shouldDeferNotificationNavigation as defer } from "@/lib/notificationNavigation";

describe("notification deep-link routing", () => {
  test("group alerts open on group-only devices with no home station", () => {
    for (const pathname of ["/", "/home-station", "/groups", "/settings"]) {
      expect(defer({ target: "/groups", pathname, hasHomeStation: false, businessEnabled: false })).toBe(false);
    }
  });
  test("personal commute reminders still wait for setup", () => {
    expect(defer({ target: "/ride", pathname: "/groups", hasHomeStation: false, businessEnabled: true })).toBe(true);
    expect(defer({ target: "/ride", pathname: "/", hasHomeStation: true, businessEnabled: true })).toBe(true);
    expect(defer({ target: "/ride", pathname: "/settings", hasHomeStation: true, businessEnabled: true })).toBe(false);
  });
  test("business alerts only open when that feature is enabled", () => {
    expect(defer({ target: "/business-event", pathname: "/", hasHomeStation: false, businessEnabled: true })).toBe(false);
    expect(defer({ target: "/business-event", pathname: "/", hasHomeStation: false, businessEnabled: false })).toBe(true);
  });
});
