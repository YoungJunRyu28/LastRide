import { describe, expect, it } from "vitest";
import {
  disruptionMatchesLine,
  normalizeRailLineName,
} from "../src/lib/ekispert";

describe("rail disruption line matching", () => {
  it("ignores route direction suffixes", () => {
    expect(normalizeRailLineName("ＪＲ山手線外回り・新宿・池袋方面")).toBe(
      "ｊｒ山手線",
    );
  });

  it("matches a provider base line to a routed directional line", () => {
    expect(
      disruptionMatchesLine("ＪＲ山手線", "ＪＲ山手線外回り・新宿・池袋方面"),
    ).toBe(true);
  });

  it("does not match unrelated lines", () => {
    expect(disruptionMatchesLine("ＪＲ中央線快速", "ＪＲ山手線")).toBe(false);
  });
});
