import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Not part of the versioned API (no zod schema, not in openapi.yaml) — just a
// friendlier answer than Express's default 404 for anyone hitting the bare
// domain directly, e.g. checking the deployment is alive.
app.get("/", (_req, res) => {
  res.json({ name: "LastRide API", status: "ok", healthCheck: "/api/healthz" });
});

app.use("/api", router);

export default app;
