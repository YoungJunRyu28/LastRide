import { describe, expect, test } from "vitest";
import { GroupRefreshGuard } from "@/lib/groupRefreshGuard";

describe("group detail fetch ordering", () => {
  test("a stale GET cannot overwrite a successful host mutation", () => {
    const guard = new GroupRefreshGuard();
    const inFlight = guard.begin("group1");
    guard.changed("group1");
    expect(guard.isCurrent(inFlight)).toBe(false);
    expect(guard.isCurrent(guard.begin("group1"))).toBe(true);
  });
  test("older concurrent GET replies cannot overwrite the newer GET", () => {
    const guard = new GroupRefreshGuard();
    const first = guard.begin("group1");
    const next = guard.begin("group1");
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(next)).toBe(true);
  });
  test("a group is isolated from mutations to another group", () => {
    const guard = new GroupRefreshGuard();
    const first = guard.begin("one");
    const second = guard.begin("two");
    guard.changed("one");
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });
  test("reset/removal invalidates in-flight failures before they can forget data", () => {
    const guard = new GroupRefreshGuard();
    const obsolete404 = guard.begin("group");
    guard.changed("group");
    expect(guard.isCurrent(obsolete404)).toBe(false);
  });
});
