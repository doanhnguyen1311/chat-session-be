import { Router } from "express";
import { authenticateToken } from "../auth/auth.service";
import { prisma } from "../../config/prisma";
import { listOnlineUsers } from "./online.service";

export const sessionsRouter = Router();

sessionsRouter.get("/online-users", async (req, res, next) => {
  try {
    const token = String(req.query.token ?? "");
    const payload = await authenticateToken(token);
    const [onlineUsers, members] = await Promise.all([
      listOnlineUsers(payload.sessionId),
      prisma.sessionUser.findMany({
        where: { sessionId: payload.sessionId },
        include: { account: true },
        orderBy: [{ isAdmin: "desc" }, { displayName: "asc" }]
      })
    ]);
    const onlineById = new Map(onlineUsers.map((user) => [user.id, user]));
    const users = members.map((member) => {
      const online = onlineById.get(member.id);
      return {
        id: member.id,
        displayName: member.displayName,
        avatarUrl: member.account?.avatarUrl ?? null,
        socketId: online?.socketId ?? member.socketId,
        joinedAt: online?.joinedAt,
        isAdmin: member.isAdmin,
        isOnline: Boolean(online),
        lastSeenAt: member.lastSeenAt.toISOString()
      };
    });
    res.json({ users });
  } catch (error) {
    next(error);
  }
});
