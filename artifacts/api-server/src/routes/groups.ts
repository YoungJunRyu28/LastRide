import { Router, type IRouter, type Request, type Response } from "express";
import { isDatabaseConfigured } from "@workspace/db";
import { scheduleNextLeaveAlert } from "../lib/leaveAlertSchedule";
import {
  CreateGroupBody,
  CreateGroupHeader,
  CreateGroupResponse,
  GetGroupResponse,
  JoinGroupBody,
  JoinGroupResponse,
  JoinGroupTonightBody,
  RotateGroupInviteResponse,
  UpdateGroupBody,
  UpdateMyGroupMembershipBody,
} from "@workspace/api-zod";
import { rateLimitMiddleware, requestAddress } from "../lib/rateLimit";
import { hashCapability } from "../lib/enterpriseTokens";
import { checkPremiumEntitlement } from "../lib/revenueCat";
import { premiumDeviceProofRequired, verifiedPremiumDeviceIdentity } from "../lib/premiumDeviceIdentity";
import { notifyGroupUpdated, sendGroupPush } from "../lib/groupNotifications";
import {
  createGroupRecord,
  recoverCreatedGroupRecord,
  disbandGroupRecord,
  endGroupTonightRecord,
  getGroupDetailRecord,
  groupMemberIdForToken,
  joinGroupRecord,
  recoverJoinedGroupRecord,
  leaveGroupRecord,
  leaveGroupTonightRecord,
  removeGroupMemberRecord,
  renameGroupRecord,
  rotateGroupInviteRecord,
  setGroupTonightParticipationRecord,
  startGroupTonightRecord,
  updateGroupMembershipRecord,
  type GroupDetail,
} from "../lib/groupStore";

const router: IRouter = Router();

router.use("/groups", (_req, res, next) => {
  if (!isDatabaseConfigured()) {
    res.status(503).json({ error: "Groups backend is not configured" });
    return;
  }
  next();
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_TOKEN = 32;
const MAX_TOKEN = 256;

const createLimiter = rateLimitMiddleware({
  limit: 10,
  windowMs: 60_000,
  key: (req) => `groups-create:${requestAddress(req)}`,
});

const joinLimiter = rateLimitMiddleware({
  limit: 20,
  windowMs: 60_000,
  key: (req) => `groups-join:${requestAddress(req)}`,
});

const memberLimiter = rateLimitMiddleware({
  limit: 120,
  windowMs: 60_000,
  key: (req) => {
    const token = req.header("x-member-token");
    return token
      ? `groups-member:${hashCapability(token)}`
      : `groups-member-missing:${requestAddress(req)}`;
  },
});

/**
 * Validates the group id and member token. Responds and returns null when the
 * request cannot proceed. Ownership of the token is checked by the store.
 */
function memberRequest(
  req: Request,
  res: Response,
): { groupId: string; token: string } | null {
  const groupId = String(req.params.groupId ?? "");
  if (!UUID_RE.test(groupId)) {
    res.status(400).json({ error: "Invalid group id" });
    return null;
  }
  const token = req.header("x-member-token");
  if (!token || token.length < MIN_TOKEN || token.length > MAX_TOKEN) {
    res.status(401).json({ error: "Member token required" });
    return null;
  }
  return { groupId, token };
}

function notFound(res: Response) {
  // Covers unknown/disbanded groups, wrong tokens and removed members alike,
  // so a token cannot be used to probe which groups exist.
  res.status(404).json({ error: "Group not found" });
}

function forbidden(res: Response) {
  res.status(403).json({ error: "Only the host can do this" });
}

function sendDetail(res: Response, group: GroupDetail, status = 200) {
  res.status(status).json(GetGroupResponse.parse(group));
}

router.post("/groups", createLimiter, async (req, res) => {
  const header = CreateGroupHeader.safeParse({
    "X-RevenueCat-App-User-Id": req.header("x-revenuecat-app-user-id"),
    "X-Group-Create-Key": req.header("x-group-create-key") ?? undefined,
  });
  if (!header.success) {
    res.status(400).json({ error: "RevenueCat app user id required" });
    return;
  }
  const body = CreateGroupBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid group", issues: body.error.issues });
    return;
  }

  // A RevenueCat customer ID is NOT authentication. Anyone can copy an
  // anonymous App User ID and request its entitlement. A production creator
  // must prove possession of the 256-bit device capability from which its
  // RevenueCat ID was derived. Check before any create-key recovery too.
  if (premiumDeviceProofRequired()) {
    const deviceSecret = req.header("x-premium-device-secret");
    // Previously installed clients have no proof header. Never silently
    // accept their caller-supplied RevenueCat ID; explain the required app
    // update with an explicit, machine-readable status instead.
    if (!deviceSecret) {
      res.status(403).json({
        code: "PREMIUM_CLIENT_UPGRADE_REQUIRED",
        error: "Update LastRide to create paid groups",
      });
      return;
    }
    if (!verifiedPremiumDeviceIdentity(
      header.data["X-RevenueCat-App-User-Id"], deviceSecret,
    )) {
      res.status(401).json({
        code: "INVALID_PREMIUM_DEVICE_PROOF",
        error: "Verified premium device identity required",
      });
      return;
    }
  }

  const creationKey = req.header("x-group-create-key");
  if (creationKey !== undefined && !/^[a-f0-9]{64}$/i.test(creationKey)) {
    res.status(400).json({ error: "Invalid group creation key" });
    return;
  }
  if (creationKey) {
    const recovered = await recoverCreatedGroupRecord(creationKey);
    if (recovered) {
      res.status(200).json(CreateGroupResponse.parse({
        memberToken: recovered.memberToken, group: recovered.group,
      }));
      return;
    }
  }

  const entitlement = await checkPremiumEntitlement(
    header.data["X-RevenueCat-App-User-Id"],
  );
  if (entitlement === "unavailable") {
    res.status(503).json({ error: "Subscription check unavailable" });
    return;
  }
  if (entitlement === "inactive") {
    res.status(402).json({ error: "Premium is required to create a group" });
    return;
  }

  const result = await createGroupRecord(body.data, creationKey);
  if (result.kind === "invalid") {
    res.status(400).json({ error: "Group and display names cannot be blank" });
    return;
  }
  res.status(result.kind === "replayed" ? 200 : 201).json(
    CreateGroupResponse.parse({
      memberToken: result.memberToken,
      group: result.group,
    }),
  );
});

router.post("/groups/join", joinLimiter, async (req, res) => {
  const body = JoinGroupBody.safeParse(req.body);
  if (!body.success) {
    res
      .status(400)
      .json({ error: "Invalid join request", issues: body.error.issues });
    return;
  }
  if (!body.data.inviteToken && !body.data.joinCode) {
    res.status(400).json({ error: "An invite token or join code is required" });
    return;
  }
  const joinKey = req.header("x-group-join-key");
  if (joinKey !== undefined && !/^[a-f0-9]{64}$/i.test(joinKey)) {
    res.status(400).json({ error: "Invalid group join key" });
    return;
  }
  const result = await joinGroupRecord(body.data, joinKey);
  if (result.kind === "invalid") {
    res.status(400).json({ error: "Invite is invalid or has been replaced" });
    return;
  }
  if (result.kind === "full") {
    res.status(409).json({ error: "This group is full" });
    return;
  }
  if (result.kind === "already") {
    res.status(200).json(
      JoinGroupResponse.parse({ memberToken: result.memberToken, group: result.group, alreadyMember: true }),
    );
    return;
  }
  // Everyone else sees the new member straight away.
  await notifyGroupUpdated(result.group.id, result.group.me.memberId);
  res.status(201).json(
    JoinGroupResponse.parse({
      memberToken: result.memberToken,
      group: result.group,
    }),
  );
});

router.get("/groups/:groupId", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const group = await getGroupDetailRecord(auth.groupId, auth.token);
  if (!group) return notFound(res);
  sendDetail(res, group);
});

router.patch("/groups/:groupId", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const body = UpdateGroupBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid group name" });
    return;
  }
  const result = await renameGroupRecord(auth.groupId, auth.token, body.data.name);
  if (result.kind === "invalid") {
    res.status(400).json({ error: "Invalid group name" });
    return;
  }
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "forbidden") return forbidden(res);
  await notifyGroupUpdated(auth.groupId, result.group.me.memberId);
  sendDetail(res, result.group);
});

router.delete("/groups/:groupId", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const result = await disbandGroupRecord(auth.groupId, auth.token);
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "forbidden") return forbidden(res);
  res.status(204).end();
});

router.post("/groups/:groupId/invite", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const result = await rotateGroupInviteRecord(auth.groupId, auth.token);
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "forbidden") return forbidden(res);
  // Members share the invite too: refresh their copy, or they'd send a dead link.
  await notifyGroupUpdated(auth.groupId, null);
  res.status(201).json(RotateGroupInviteResponse.parse(result.invite));
});

router.delete(
  "/groups/:groupId/members/:memberId",
  memberLimiter,
  async (req, res) => {
    const auth = memberRequest(req, res);
    if (!auth) return;
    const memberId = String(req.params.memberId ?? "");
    if (!UUID_RE.test(memberId)) {
      res.status(400).json({ error: "Invalid member id" });
      return;
    }
    const result = await removeGroupMemberRecord(
      auth.groupId,
      auth.token,
      memberId,
    );
    if (result.kind === "not-found") return notFound(res);
    if (result.kind === "forbidden") return forbidden(res);
    if (result.kind === "self") {
      res
        .status(400)
        .json({ error: "Transfer the host role or disband the group instead" });
      return;
    }
    if (result.kind === "member-not-found") {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    await notifyGroupUpdated(auth.groupId, result.group.me.memberId);
    sendDetail(res, result.group);
  },
);

router.patch("/groups/:groupId/me", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const body = UpdateMyGroupMembershipBody.safeParse(req.body);
  if (!body.success) {
    res
      .status(400)
      .json({ error: "Invalid membership update", issues: body.error.issues });
    return;
  }
  const result = await updateGroupMembershipRecord(
    auth.groupId,
    auth.token,
    body.data,
  );
  if (result.kind === "invalid") {
    res.status(400).json({ error: "Display name cannot be blank" });
    return;
  }
  if (result.kind === "not-found") return notFound(res);
  // Only a new name shows to others (language and switches are private).
  if (body.data.displayName !== undefined) {
    await notifyGroupUpdated(auth.groupId, result.group.me.memberId);
  }
  sendDetail(res, result.group);
});

router.delete("/groups/:groupId/me", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const leaving = await groupMemberIdForToken(auth.groupId, auth.token);
  const result = await leaveGroupRecord(auth.groupId, auth.token);
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "host") {
    res.status(409).json({
      error: "The host must disband the group",
    });
    return;
  }
  await notifyGroupUpdated(auth.groupId, leaving);
  res.status(204).end();
});

// "Reset & start over": leave even as host (a host's group is disbanded).
router.post("/groups/:groupId/me/reset", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const leaving = await groupMemberIdForToken(auth.groupId, auth.token);
  const result = await leaveGroupRecord(auth.groupId, auth.token, { disbandIfHost: true });
  if (result.kind === "not-found") return notFound(res);
  // A host's reset disbands the group: there's no one left to tell.
  await notifyGroupUpdated(auth.groupId, leaving);
  res.status(204).end();
});

router.post("/groups/:groupId/tonight", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const result = await startGroupTonightRecord(auth.groupId, auth.token);
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "forbidden") return forbidden(res);
  if (result.started) {
    await sendGroupPush(
      auth.groupId,
      { kind: "tonight_started", groupName: result.groupName },
      result.recipients,
    );
    // Also members who switched the 今夜の開始 notification off.
    await notifyGroupUpdated(auth.groupId, result.group.me.memberId);
  }
  sendDetail(res, result.group, result.started ? 201 : 200);
});

router.delete("/groups/:groupId/tonight", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const result = await endGroupTonightRecord(auth.groupId, auth.token);
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "forbidden") return forbidden(res);
  await notifyGroupUpdated(auth.groupId, result.group.me.memberId);
  sendDetail(res, result.group);
});

router.put("/groups/:groupId/tonight/me", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const body = JoinGroupTonightBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Invalid leave-by time" });
    return;
  }
  const result = await setGroupTonightParticipationRecord(
    auth.groupId,
    auth.token,
    body.data.leaveBy,
  );
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "inactive") {
    res.status(409).json({ error: "The group is not active tonight" });
    return;
  }
  if (result.kind === "invalid-leave-by") {
    res.status(400).json({ error: "Leave-by time is outside tonight" });
    return;
  }
  // A new or earlier leave time may be the next alert due (never throws).
  if (body.data.leaveBy) await scheduleNextLeaveAlert({ onlyEarlier: true });
  // Others see the new time (or that this member is in tonight) at once.
  await notifyGroupUpdated(auth.groupId, result.group.me.memberId);
  sendDetail(res, result.group);
});

router.delete(
  "/groups/:groupId/tonight/me",
  memberLimiter,
  async (req, res) => {
    const auth = memberRequest(req, res);
    if (!auth) return;
    const result = await leaveGroupTonightRecord(auth.groupId, auth.token);
    if (result.kind === "not-found") return notFound(res);
    await notifyGroupUpdated(auth.groupId, result.group.me.memberId);
    sendDetail(res, result.group);
  },
);

export default router;
