import { describe, expect, it } from "vitest";
import { dayTypeOf } from "../src/lib/transit/services";

describe("dayTypeOf", () => {
  it("runs the holiday timetable over the New Year (12/30–1/3)", () => {
    expect(dayTypeOf("2026-12-29")).toBe("weekday"); // Tuesday
    expect(dayTypeOf("2026-12-30")).toBe("holiday"); // Wednesday
    expect(dayTypeOf("2026-12-31")).toBe("holiday");
    expect(dayTypeOf("2027-01-01")).toBe("holiday");
    expect(dayTypeOf("2027-01-02")).toBe("holiday"); // Saturday, but 土休日 too
    expect(dayTypeOf("2027-01-04")).toBe("weekday"); // Monday
  });

  it("keeps weekdays, Saturdays, Sundays and national holidays", () => {
    expect(dayTypeOf("2026-11-04")).toBe("weekday");
    expect(dayTypeOf("2026-11-07")).toBe("saturday");
    expect(dayTypeOf("2026-11-08")).toBe("holiday");
    expect(dayTypeOf("2026-11-23")).toBe("holiday"); // 勤労感謝の日
  });
});
