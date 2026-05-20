import { Router } from "express";
import { authenticateToken } from "../auth/auth.service";
import { listOnlineUsers } from "./online.service";

export const sessionsRouter = Router();

sessionsRouter.get("/online-users", async (req, res, next) => {
  try {
    const token = String(req.query.token ?? "");
    const payload = await authenticateToken(token);
    const users = await listOnlineUsers(payload.sessionId);
    res.json({ users });
  } catch (error) {
    next(error);
  }
});
