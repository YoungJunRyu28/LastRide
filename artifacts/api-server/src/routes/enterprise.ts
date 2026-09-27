import { Router, type IRouter, type Request, type Response } from "express";
import { isDatabaseConfigured } from "@workspace/db";
import {
  CreateEnterpriseEventBody,
  CreateEnterpriseEventInviteParams,
  CreateEnterpriseEventInviteResponse,
  CreateEnterpriseEventResponse,
  GetEnterpriseEventParams,
  GetEnterpriseEventResponse,
  JoinEnterpriseEventBody,
  JoinEnterpriseEventResponse,
  RegisterEnterpriseHostDeviceBody,
  LeaveEnterpriseEventHeader,
  ListEnterpriseEventsResponse,
  UpdateEnterpriseEventBody,
  UpdateEnterpriseEventParams,
  UpdateEnterpriseEventResponse,
  UnregisterEnterpriseHostDeviceBody,
  UpdateEventParticipantBody,
  UpdateEventParticipantHeader,
  UpdateEventParticipantResponse,
} from "@workspace/api-zod";
import { authenticateEnterpriseRequest } from "../lib/enterpriseAuth";
import { rateLimitMiddleware, requestAddress } from "../lib/rateLimit";
import { hashCapability } from "../lib/enterpriseTokens";
import {
  createEnterpriseEventInviteRecord,
  createEnterpriseEventRecord,
  getEnterpriseEventRecord,
  getOrganizerContext,
  joinEnterpriseEventRecord,
  leaveEnterpriseEventRecord,
  listEnterpriseEventRecords,
  registerEnterpriseHostDeviceRecord,
  unregisterEnterpriseHostDeviceRecord,
  updateEnterpriseEventRecord,
  updateEventParticipantRecord,
} from "../lib/enterpriseStore";

const router: IRouter = Router();

router.use((_req, res, next) => {
  if (!isDatabaseConfigured()) {
    res.status(503).json({ error: "Enterprise backend is not configured" });
    return;
  }
  next();
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const joinLimiter = rateLimitMiddleware({
  limit: 20,
  windowMs: 60_000,
  key: (req) => `enterprise-join:${requestAddress(req)}`,
});

const participantLimiter = rateLimitMiddleware({
  limit: 120,
  windowMs: 60_000,
  key: (req) => {
    const token = req.header("x-participant-token");
    return token
      ? `enterprise-participant:${hashCapability(token)}`
      : `enterprise-participant-missing:${requestAddress(req)}`;
  },
});

async function organizerFor(req: Request, res: Response) {
  const principal = await authenticateEnterpriseRequest(req);
  if (!principal) {
    res.status(401).json({ error: "Organizer authentication required" });
    return null;
  }
  const organizer = await getOrganizerContext(principal);
  if (!organizer) {
    res
      .status(403)
      .json({ error: "This account has no enterprise organization" });
    return null;
  }
  return organizer;
}

function participantHeader(req: Request) {
  return { "X-Participant-Token": req.header("x-participant-token") };
}

router.post("/enterprise/events", async (req, res) => {
  const organizer = await organizerFor(req, res);
  if (!organizer) return;

  const parsed = CreateEnterpriseEventBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid event", issues: parsed.error.issues });
    return;
  }
  if (parsed.data.expiresAt <= parsed.data.startsAt) {
    res.status(400).json({ error: "Event expiry must be after its start" });
    return;
  }

  const created = await createEnterpriseEventRecord(organizer, parsed.data);
  res.status(201).json(CreateEnterpriseEventResponse.parse(created));
});

router.get("/enterprise/events", async (req, res) => {
  const organizer = await organizerFor(req, res);
  if (!organizer) return;
  const events = await listEnterpriseEventRecords(organizer.organizationId);
  res.json(ListEnterpriseEventsResponse.parse(events));
});

router.get("/enterprise/events/:eventId", async (req, res) => {
  const organizer = await organizerFor(req, res);
  if (!organizer) return;

  const parsed = GetEnterpriseEventParams.safeParse(req.params);
  if (!parsed.success || !UUID_RE.test(parsed.data.eventId)) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const event = await getEnterpriseEventRecord(
    organizer.organizationId,
    parsed.data.eventId,
  );
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(GetEnterpriseEventResponse.parse(event));
});

router.patch("/enterprise/events/:eventId", async (req, res) => {
  const organizer = await organizerFor(req, res);
  if (!organizer) return;

  const params = UpdateEnterpriseEventParams.safeParse(req.params);
  const body = UpdateEnterpriseEventBody.safeParse(req.body);
  if (!params.success || !UUID_RE.test(params.data.eventId) || !body.success) {
    res.status(400).json({ error: "Invalid event update" });
    return;
  }
  const event = await updateEnterpriseEventRecord(
    organizer.organizationId,
    params.data.eventId,
    body.data,
  );
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(UpdateEnterpriseEventResponse.parse(event));
});

router.post("/enterprise/events/:eventId/invite", async (req, res) => {
  const organizer = await organizerFor(req, res);
  if (!organizer) return;

  const params = CreateEnterpriseEventInviteParams.safeParse(req.params);
  if (!params.success || !UUID_RE.test(params.data.eventId)) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }

  const result = await createEnterpriseEventInviteRecord(
    organizer.organizationId,
    params.data.eventId,
  );
  if (result.kind === "not-found") {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (result.kind === "gone") {
    res.status(410).json({ error: "Event is closed or expired" });
    return;
  }
  res.status(201).json(
    CreateEnterpriseEventInviteResponse.parse({
      inviteToken: result.inviteToken,
      joinCode: result.joinCode,
      expiresAt: result.expiresAt,
    }),
  );
});

router.post("/enterprise/devices", async (req, res) => {
  const organizer = await organizerFor(req, res);
  if (!organizer) return;
  const parsed = RegisterEnterpriseHostDeviceBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid push device", issues: parsed.error.issues });
    return;
  }
  await registerEnterpriseHostDeviceRecord(
    organizer.memberId,
    parsed.data.expoPushToken,
    parsed.data.platform,
  );
  res.status(204).end();
});

router.delete("/enterprise/devices", async (req, res) => {
  const organizer = await organizerFor(req, res);
  if (!organizer) return;
  const parsed = UnregisterEnterpriseHostDeviceBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid push device", issues: parsed.error.issues });
    return;
  }
  await unregisterEnterpriseHostDeviceRecord(
    organizer.memberId,
    parsed.data.expoPushToken,
  );
  res.status(204).end();
});

router.post("/events/join", joinLimiter, async (req, res) => {
  const parsed = JoinEnterpriseEventBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid join request", issues: parsed.error.issues });
    return;
  }
  if (!parsed.data.inviteToken && !parsed.data.joinCode) {
    res.status(400).json({ error: "An invite token or join code is required" });
    return;
  }

  const result = await joinEnterpriseEventRecord(parsed.data);
  if (result.kind === "invalid") {
    res.status(400).json({ error: "Invite is invalid or expired" });
    return;
  }
  if (result.kind === "full") {
    res
      .status(409)
      .json({ error: "This event has reached its participant limit" });
    return;
  }
  res.status(201).json(
    JoinEnterpriseEventResponse.parse({
      participantToken: result.participantToken,
      participant: result.participant,
      event: result.event,
    }),
  );
});

router.patch("/events/participant", participantLimiter, async (req, res) => {
  const header = UpdateEventParticipantHeader.safeParse(participantHeader(req));
  const body = UpdateEventParticipantBody.safeParse(req.body);
  if (!header.success || !body.success) {
    res.status(400).json({ error: "Invalid participant update" });
    return;
  }

  const result = await updateEventParticipantRecord(
    header.data["X-Participant-Token"],
    body.data.leaveBy,
  );
  if (result.kind === "unauthorized") {
    res.status(401).json({ error: "Invalid participant token" });
    return;
  }
  if (result.kind === "gone") {
    res.status(410).json({ error: "Event is closed or expired" });
    return;
  }
  res.json(UpdateEventParticipantResponse.parse(result.participant));
});

router.delete("/events/participant", participantLimiter, async (req, res) => {
  const header = LeaveEnterpriseEventHeader.safeParse(participantHeader(req));
  if (!header.success) {
    res.status(401).json({ error: "Invalid participant token" });
    return;
  }
  const removed = await leaveEnterpriseEventRecord(
    header.data["X-Participant-Token"],
  );
  if (!removed) {
    res.status(401).json({ error: "Invalid participant token" });
    return;
  }
  res.status(204).end();
});

export default router;
