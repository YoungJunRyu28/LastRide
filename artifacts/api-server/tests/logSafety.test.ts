import { describe, expect, it } from "vitest";
import { safeErr } from "../src/lib/logSafety";

describe("safeErr", () => {
  it("drops bound values from a failed query (names, push tokens) and keeps the type", () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "members_token"'), {
      code: "23505",
      detail: "Key (group_id, expo_push_token)=(g1, ExponentPushToken[abc]) already exists.",
    });
    const error = Object.assign(
      new Error('Failed query: insert into "group_members" ("display_name", "expo_push_token") values ($1, $2)\nparams: たろう,ExponentPushToken[abc]'),
      { query: 'insert into "group_members" …', params: ["たろう", "ExponentPushToken[abc]"], cause },
    );
    error.name = "DrizzleQueryError";
    const out = JSON.stringify(safeErr(error));
    expect(out).not.toContain("たろう");
    expect(out).not.toContain("ExponentPushToken");
    expect(out).toContain("DrizzleQueryError");
    expect(out).toContain("23505");
  });

  it("leaves plain values alone", () => {
    expect(safeErr("x")).toBe("x");
  });
});
