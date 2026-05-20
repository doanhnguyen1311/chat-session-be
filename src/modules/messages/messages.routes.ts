import { Router } from "express";
import { authenticateToken } from "../auth/auth.service";
import { messageQuerySchema } from "./messages.schemas";
import { listMessages } from "./messages.service";

export const messagesRouter = Router();

messagesRouter.get("/messages", async (req, res, next) => {
  try {
    const query = messageQuerySchema.parse(req.query);
    const payload = await authenticateToken(query.token);
    const messages = await listMessages(payload.sessionId, query.limit, query.cursor);
    res.json({ messages: messages.reverse() });
  } catch (error) {
    next(error);
  }
});
