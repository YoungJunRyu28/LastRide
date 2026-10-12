import { Router, type IRouter, type Request, type Response } from "express";
import { isDatabaseConfigured } from "@workspace/db";
import {
  CreateGroupBody,
  CreateGroupHeader,
  CreateGroupResponse,
  GetGroupResponse,
  JoinGroupBody,
  JoinGroupResponse,
  JoinGroupTonightBody,
  RotateGroupInviteResponse,
  TransferGroupHostBody,
  UpdateGroupBody,
  UpdateMyGroupMembershipBody,
} from "@workspace/api-zod";
import { rateLimitMiddleware, requestAddress } from "../lib/rateLimit";
import { hashCapability } from "../lib/enterpriseTokens";
import { checkPremiumEntitlement } from "../lib/revenueCat";
import { sendGroupPush } from "../lib/groupNotifications";
import {
  createGroupRecord,
  disbandGroupRecord,
  endGroupTonightRecord,
  getGroupDetailRecord,
  joinGroupRecord,
  leaveGroupRecord,
  leaveGroupTonightRecord,
  removeGroupMemberRecord,
  renameGroupRecord,
  reportGroupTonightMissedRecord,
  rotateGroupInviteRecord,
  setGroupTonightParticipationRecord,
  startGroupTonightRecord,
  transferGroupHostRecord,
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

  const result = await createGroupRecord(body.data);
  if (result.kind === "invalid") {
    res.status(400).json({ error: "Group and display names cannot be blank" });
    return;
  }
  res.status(201).json(
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
  const result = await joinGroupRecord(body.data);
  if (result.kind === "invalid") {
    res.status(400).json({ error: "Invite is invalid or has been replaced" });
    return;
  }
  if (result.kind === "full") {
    res.status(409).json({ error: "This group is full" });
    return;
  }
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
  res.status(201).json(RotateGroupInviteResponse.parse(result.invite));
});

router.post("/groups/:groupId/transfer", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const body = TransferGroupHostBody.safeParse(req.body);
  if (!body.success || !UUID_RE.test(body.data.memberId)) {
    res.status(400).json({ error: "Invalid member id" });
    return;
  }
  const result = await transferGroupHostRecord(
    auth.groupId,
    auth.token,
    body.data.memberId,
  );
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "forbidden") return forbidden(res);
  if (result.kind === "invalid-target") {
    res
      .status(400)
      .json({ error: "The new host must be another member of this group" });
    return;
  }
  sendDetail(res, result.group);
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
  sendDetail(res, result.group);
});

router.delete("/groups/:groupId/me", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const result = await leaveGroupRecord(auth.groupId, auth.token);
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "host") {
    res.status(409).json({
      error: "The host must transfer the host role or disband the group",
    });
    return;
  }
  res.status(204).end();
});

// "Reset & start over": leave even as host (the role passes to the
// longest-standing member; a group left empty is deleted).
router.post("/groups/:groupId/me/reset", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const result = await leaveGroupRecord(auth.groupId, auth.token, { handover: true });
  if (result.kind === "not-found") return notFound(res);
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
  }
  sendDetail(res, result.group, result.started ? 201 : 200);
});

router.delete("/groups/:groupId/tonight", memberLimiter, async (req, res) => {
  const auth = memberRequest(req, res);
  if (!auth) return;
  const result = await endGroupTonightRecord(auth.groupId, auth.token);
  if (result.kind === "not-found") return notFound(res);
  if (result.kind === "forbidden") return forbidden(res);
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
    sendDetail(res, result.group);
  },
);

router.post(
  "/groups/:groupId/tonight/missed",
  memberLimiter,
  async (req, res) => {
    const auth = memberRequest(req, res);
    if (!auth) return;
    const result = await reportGroupTonightMissedRecord(
      auth.groupId,
      auth.token,
    );
    if (result.kind === "not-found") return notFound(res);
    if (result.kind === "inactive") {
      res.status(409).json({ error: "The group is not active tonight" });
      return;
    }
    if (result.kind === "not-participant") {
      res.status(409).json({ error: "Join tonight first" });
      return;
    }
    await sendGroupPush(
      auth.groupId,
      {
        kind: "missed",
        groupName: result.groupName,
        displayName: result.displayName,
      },
      result.recipients,
    );
    sendDetail(res, result.group);
  },
);

export default router;
