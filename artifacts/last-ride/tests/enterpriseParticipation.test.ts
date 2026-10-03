import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
const api = vi.hoisted(() => ({
  joinEnterpriseEvent: vi.fn(),
  leaveEnterpriseEvent: vi.fn(),
  updateEventParticipant: vi.fn(),
}));

vi.mock("@/lib/api", () => ({}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => storage.delete(key)),
  },
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "after-first-unlock",
  isAvailableAsync: vi.fn(async () => false),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("@workspace/api-client-react", () => api);

import {
  joinEnterpriseParticipation,
  leaveCurrentEnterpriseEvent,
  readEnterpriseParticipation,
} from "@/lib/enterpriseParticipation";

async function seedParticipation() {
  api.joinEnterpriseEvent.mockResolvedValueOnce({
    participantToken: "participant-secret-token",
    participant: {
      id: "participant-id",
      displayName: "Daniel",
      leaveBy: null,
      status: "active",
    },
    event: {
      id: "event-id",
      title: "Friday drinks",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  await joinEnterpriseParticipation({
    displayName: "Daniel",
    inviteToken: "invite-token",
  });
}

describe("enterprise participant deletion", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  it("retains the capability after a transient leave failure so deletion can retry", async () => {
    await seedParticipation();
    api.leaveEnterpriseEvent.mockRejectedValueOnce(new Error("network down"));

    await expect(leaveCurrentEnterpriseEvent()).rejects.toThrow("network down");

    const participation = await readEnterpriseParticipation();
    expect(participation?.participantToken).toBe("participant-secret-token");
  });

  it("forgets the capability after a successful server deletion", async () => {
    await seedParticipation();
    api.leaveEnterpriseEvent.mockResolvedValueOnce(undefined);

    await leaveCurrentEnterpriseEvent();

    expect(await readEnterpriseParticipation()).toBeNull();
  });

  it("forgets a terminal capability after the server says it is gone", async () => {
    await seedParticipation();
    api.leaveEnterpriseEvent.mockRejectedValueOnce(
      Object.assign(new Error("gone"), { status: 410 }),
    );

    await leaveCurrentEnterpriseEvent();

    expect(await readEnterpriseParticipation()).toBeNull();
  });
});
