/**
 * Entry point for running this Express app on AWS Lambda behind API Gateway,
 * instead of as a long-lived process listening on a port (see index.ts, used
 * for local dev and any non-Lambda host).
 *
 * `serverless-http` translates between API Gateway's event/response JSON
 * shape and the request/response objects Express expects, so `app` itself
 * — routes, middleware, everything in app.ts — is unchanged. Nothing in this
 * file is Lambda-specific business logic; it only exists because Lambda
 * invokes a handler function rather than accepting a socket connection.
 */
import serverlessHttp from "serverless-http";
import app from "./app";

export const handler = serverlessHttp(app);
