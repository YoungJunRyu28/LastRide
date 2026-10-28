import { describe, expect, test } from "vitest";
import { ApiError, ResponseParseError } from "../../../lib/api-client-react/src/custom-fetch";

describe("API error objects do not disclose URL credentials or coordinates", () => {
  const url = "https://api.example/places?lat=35.66&invite=secret#details";
  const response = new Response("not json", {
    status: 502,
    statusText: "Bad Gateway",
    headers: { "content-type": "text/plain" },
  });
  test("parse exceptions never include a query in their message or url property", () => {
    const error = new ResponseParseError(response, "not json", new SyntaxError("bad"), { method: "GET", url });
    expect(error.message).not.toContain("secret");
    expect(error.message).not.toContain("35.66");
    expect(error.url).toBe("https://api.example/places");
  });
  test("API errors keep status but strip URL query from structured metadata", () => {
    const error = new ApiError(response, { error: "Gateway failure" }, { method: "GET", url });
    expect(error.status).toBe(502);
    expect(error.url).toBe("https://api.example/places");
  });
});
