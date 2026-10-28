import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { errorBody } from "./lib/errors";
import { onError, requestContext, securityHeaders } from "./middleware/common";
import { rateLimit } from "./middleware/rate-limit";
import { authRoutes } from "./routes/auth";
import { businessRoutes } from "./routes/business";
import { consoleRoutes } from "./routes/console";
import { demoRoutes } from "./routes/demo";
import { API_VERSION, publicRoutes } from "./routes/public";
import { victimRoutes } from "./routes/victim";
import type { AppEnv } from "./types";

const WORKERS_DEV_ORIGIN = /^https:\/\/blindaje-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/;
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin: string, env: Pick<Env, "ALLOWED_ORIGINS">): boolean {
  if (!origin) return false;
  const list = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(origin) || WORKERS_DEV_ORIGIN.test(origin) || LOCALHOST_ORIGIN.test(origin);
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", requestContext);
  app.use("*", securityHeaders);
  app.use(
    "*",
    cors({
      origin: (origin, c) => (isAllowedOrigin(origin, c.env as Env) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: [
        "authorization",
        "content-type",
        "x-evidence-type",
        "x-content-sha256",
        "x-captured-at",
        "x-source",
        "x-duration-ms",
      ],
      exposeHeaders: ["x-request-id", "retry-after", "x-blindaje-variant", "x-blindaje-marca", "x-blindaje-marca-motivo", "content-disposition"],
      maxAge: 600,
    }),
  );
  app.use("/v1/*", rateLimit("global"));

  app.get("/v1/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT, version: API_VERSION }));
  app.route("/v1/public", publicRoutes);
  app.route("/v1/auth", authRoutes);
  app.route("/v1/console", consoleRoutes);
  app.route("/v1/business", businessRoutes);
  app.route("/v1/demo", demoRoutes);
  app.route("/v1", victimRoutes);

  app.notFound((c) => c.json(errorBody("not_found", "Ruta no encontrada"), 404));
  app.onError(onError);
  return app;
}

export const app = createApp();
