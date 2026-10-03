/**
 * Crash reports must never say where someone is or where they are going.
 * Request URLs carry coordinates and searches in their query strings, and
 * navigation URLs can carry Business join tokens.
 */
import { describe, expect, test } from "vitest";
import { scrubBreadcrumb, stripQuery } from "@/lib/crashScrub";

describe("stripQuery", () => {
  test("drops the query string and fragment", () => {
    expect(
      stripQuery("https://api.example/api/stations?lat=35.65&lon=139.70"),
    ).toBe("https://api.example/api/stations");
    expect(stripQuery("/join?token=secret#x")).toBe("/join");
    expect(stripQuery("/ride#top")).toBe("/ride");
  });

  test("leaves URLs without a query alone", () => {
    expect(stripQuery("https://api.example/api/healthz")).toBe(
      "https://api.example/api/healthz",
    );
  });
});

describe("scrubBreadcrumb", () => {
  test("drops console breadcrumbs entirely", () => {
    expect(
      scrubBreadcrumb({ category: "console", message: "at 35.65,139.70" }),
    ).toBeNull();
  });

  test("strips coordinates from request breadcrumbs", () => {
    const scrubbed = scrubBreadcrumb({
      category: "fetch",
      data: {
        url: "https://api.example/api/walk?fromLat=35.6&fromLon=139.7",
        status_code: 200,
      },
    });
    expect(scrubbed?.data).toEqual({
      url: "https://api.example/api/walk",
      status_code: 200,
    });
  });

  test("strips join tokens from navigation breadcrumbs", () => {
    const scrubbed = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/settings", to: "/join?token=abc123" },
    });
    expect(scrubbed?.data).toEqual({ from: "/settings", to: "/join" });
  });

  test("strips a URL in the message", () => {
    expect(
      scrubBreadcrumb({
        message: "GET https://api.example/api/places?lat=1&lon=2",
      })?.message,
    ).toBe("GET https://api.example/api/places");
  });

  test("keeps ordinary messages", () => {
    expect(scrubBreadcrumb({ message: "Tracking started" })?.message).toBe(
      "Tracking started",
    );
  });
});
