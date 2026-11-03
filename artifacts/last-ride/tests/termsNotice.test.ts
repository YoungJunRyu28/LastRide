import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) },
}));

import { pendingNotice, TERMS_NOTICES, type TermsNotice } from "@/lib/termsNotice";

const notice = (version: number, effectiveFrom: string): TermsNotice => ({
  version,
  effectiveFrom,
  page: "terms",
  ja: { title: `改定${version}`, body: "" },
  en: { title: `Change ${version}`, body: "" },
});
const at = (date: string) => Date.parse(`${date}T12:00:00+09:00`);

describe("pendingNotice", () => {
  it("shows the newest notice not yet seen, before and for a month after it takes effect", () => {
    TERMS_NOTICES.splice(0, TERMS_NOTICES.length, notice(1, "2026-12-01"), notice(2, "2027-01-15"));
    expect(pendingNotice(0, at("2026-11-20"))?.version).toBe(2);
    expect(pendingNotice(1, at("2026-11-20"))?.version).toBe(2);
    expect(pendingNotice(2, at("2026-11-20"))).toBeNull();
    // Long past (over 30 days after it took effect): not shown any more.
    expect(pendingNotice(0, at("2027-03-01"))).toBeNull();
    TERMS_NOTICES.splice(0, TERMS_NOTICES.length);
  });

  it("shows nothing when there are no notices", () => {
    expect(pendingNotice(0, at("2026-11-20"))).toBeNull();
  });
});
