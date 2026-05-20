import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { ZodError } from "zod";
import { isAllowedOrigin } from "./config/env";
import { authRouter } from "./modules/auth/auth.routes";
import { messagesRouter } from "./modules/messages/messages.routes";
import { sessionsRouter } from "./modules/sessions/sessions.routes";
import { uploadsRouter } from "./modules/uploads/uploads.routes";

export function createApp() {
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: "32kb" }));
  app.use(morgan("dev"));
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.use(authRouter);
  app.use(messagesRouter);
  app.use(sessionsRouter);
  app.use(uploadsRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0]?.message;
      res.status(400).json({ message: firstIssue ?? "Invalid input.", issues: error.flatten() });
      return;
    }

    if (error instanceof Error && error.message === "TOKEN_EXPIRED") {
      res.status(401).json({ message: "Session expired." });
      return;
    }

    console.error(error);
    res.status(500).json({ message: "Internal server error." });
  });

  return app;
}
