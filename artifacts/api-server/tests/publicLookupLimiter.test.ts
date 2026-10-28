import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  publicLookupFamily,
  publicLookupLimiters,
  publicLookupRateKey,
} from "../src/lib/publicLookupLimiter";

const address = "203.0.113.101";
function fakeRequest(path: string, ip = address): Request {
  return { path, ip } as Request;
}
function fakeResponse() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(value: number) { res.statusCode = value; return res; },
    json(value: unknown) { res.body = value; return res; },
    setHeader(name: string, value: string) { res.headers[name] = value; },
  };
  return res;
}
async function exercise(middlewares: ReturnType<typeof publicLookupLimiters>, path: string, ip = address) {
  const req = fakeRequest(path, ip);
  const res = fakeResponse();
  const done = vi.fn();
  const inner = vi.fn<NextFunction>();
  await middlewares[0](req, res as unknown as Response, inner);
  if (inner.mock.calls.length) {
    await middlewares[1](req, res as unknown as Response, done);
  }
  return { allowed: done.mock.calls.length > 0, response: res };
}

describe("anonymous public lookup fairness and abuse guard", () => {
  it("does not include query values or caller-controlled headers in keys", () => {
    expect(publicLookupFamily("/trains/last")).toBe("trains");
    expect(publicLookupFamily("/stations/search")).toBe("stations");
    expect(publicLookupFamily("/trainsx")).toBe("other");
    expect(publicLookupRateKey(fakeRequest("/trains/last?fromLat=35.7&toName=HOME")))
      .toBe("public-lookup:trains:" + address);
  });

  it("supports 50 visitors each making four train and four station queries on one shared IP", async () => {
    const guards = publicLookupLimiters({ perFamilyLimit: 240, totalIpLimit: 720 });
    for (let i = 0; i < 200; i++) {
      expect((await exercise(guards, "/trains/last")).allowed).toBe(true);
      expect((await exercise(guards, "/stations/nearby")).allowed).toBe(true);
    }
  });

  it("caps a hot family without preventing access to other families", async () => {
    const guards = publicLookupLimiters({ perFamilyLimit: 3, totalIpLimit: 20 });
    for (let i = 0; i < 3; i++) {
      expect((await exercise(guards, "/trains/last")).allowed).toBe(true);
    }
    const denied = await exercise(guards, "/trains/first");
    expect(denied.response.statusCode).toBe(429);
    expect(denied.response.headers["Retry-After"]).toBeTruthy();
    expect((await exercise(guards, "/stations/nearby")).allowed).toBe(true);
  });

  it("does not exhaust the shared-IP ceiling with requests a hot family already rejected", async () => {
    const guards = publicLookupLimiters({ perFamilyLimit: 2, totalIpLimit: 4 });
    expect((await exercise(guards, "/trains/last")).allowed).toBe(true);
    expect((await exercise(guards, "/trains/last")).allowed).toBe(true);
    for (let attempt = 0; attempt < 15; attempt++) {
      expect((await exercise(guards, "/trains/last")).response.statusCode).toBe(429);
    }
    expect((await exercise(guards, "/stations/nearby")).allowed).toBe(true);
    expect((await exercise(guards, "/stations/search")).allowed).toBe(true);
  });

  it("also caps aggregate traffic with endlessly changing categories", async () => {
    const guards = publicLookupLimiters({ perFamilyLimit: 10, totalIpLimit: 4 });
    for (const family of ["trains/first", "stations/search", "taxi", "places/nearby"]) {
      expect((await exercise(guards, "/" + family)).allowed).toBe(true);
    }
    expect((await exercise(guards, "/walk")).response.statusCode).toBe(429);
  });

  it("keeps separate users' budgets independent when their real trusted IP differs", async () => {
    const guards = publicLookupLimiters({ perFamilyLimit: 1, totalIpLimit: 2 });
    expect((await exercise(guards, "/trains/last")).allowed).toBe(true);
    expect((await exercise(guards, "/trains/last")).allowed).toBe(false);
    expect((await exercise(guards, "/trains/last", "198.51.100.3")).allowed).toBe(true);
  });
});
