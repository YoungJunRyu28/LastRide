import { describe, expect, it } from "vitest";
import { toRecoveryTransitRoute } from "../src/lib/ekispert";

describe("recovery transit normalization", () => {
  it("preserves train and bus legs with the total fare", () => {
    const route = toRecoveryTransitRoute({
      Price: [
        { kind: "FareSummary", Oneway: "630" },
        { kind: "ChargeSummary", Oneway: "0" },
      ],
      Route: {
        transferCount: "1",
        timeWalk: "6",
        timeTotal: "44",
        Point: [
          { Station: { Name: "渋谷", Yomi: "しぶや" } },
          { Station: { Name: "目黒", Yomi: "めぐろ" } },
          { Station: { Name: "清水", Yomi: "しみず" } },
        ],
        Line: [
          {
            Name: "ＪＲ山手線",
            Type: { text: "train" },
            DepartureState: {
              Datetime: { text: "2026-10-08T00:10:00+09:00" },
            },
            ArrivalState: {
              Datetime: { text: "2026-10-08T00:18:00+09:00" },
            },
          },
          {
            Name: "東急バス",
            Type: { text: "bus", detail: "localBus" },
            DepartureState: {
              Datetime: { text: "2026-10-08T00:24:00+09:00" },
            },
            ArrivalState: {
              Datetime: { text: "2026-10-08T00:54:00+09:00" },
            },
          },
        ],
      },
    });

    expect(route).not.toBeNull();
    expect(route?.fareYen).toBe(630);
    expect(route?.walkingMinutes).toBe(6);
    expect(route?.durationMinutes).toBe(44);
    expect(route?.modes).toEqual(["train", "bus"]);
    expect(route?.legs[0]).toMatchObject({
      mode: "train",
      from: "渋谷",
      to: "目黒",
    });
    expect(route?.legs[1]).toMatchObject({
      mode: "bus",
      modeDetail: "localBus",
      from: "目黒",
      to: "清水",
    });
  });

  it("rejects malformed results without a usable timed leg", () => {
    expect(
      toRecoveryTransitRoute({
        Route: {
          Point: [{ Name: "A" }, { Name: "B" }],
          Line: [{ Name: "walk", Type: { text: "walk" } }],
        },
      }),
    ).toBeNull();
  });
});
