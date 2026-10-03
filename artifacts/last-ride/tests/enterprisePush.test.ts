import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
const api = vi.hoisted(() => ({
  registerEnterpriseHostDevice: vi.fn(),
  unregisterEnterpriseHostDevice: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  enterpriseRequestOptions: vi.fn(async () => ({
    headers: { Authorization: "Bearer test" },
  })),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => storage.delete(key)),
  },
}));
vi.mock("expo-constants", () => ({
  default: { easConfig: { projectId: "project-id" }, expoConfig: {} },
}));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[test]" })),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@workspace/api-client-react", () => api);
vi.mock("@/lib/enterpriseHostAuth", () => auth);

import { unregisterEnterprisePushDevice } from "@/lib/enterprisePush";

const PUSH_KEY = "lastride-enterprise-host-push-token";

describe("enterprise push unregister", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    storage.set(PUSH_KEY, "ExponentPushToken[test]");
  });

  it("retains the token when backend unregister fails", async () => {
    api.unregisterEnterpriseHostDevice.mockRejectedValueOnce(
      new Error("network down"),
    );

    await expect(unregisterEnterprisePushDevice()).rejects.toThrow(
      "network down",
    );
    expect(storage.get(PUSH_KEY)).toBe("ExponentPushToken[test]");
  });

  it("forgets the token only after backend unregister succeeds", async () => {
    api.unregisterEnterpriseHostDevice.mockResolvedValueOnce(undefined);

    await unregisterEnterprisePushDevice();

    expect(storage.has(PUSH_KEY)).toBe(false);
  });
});
