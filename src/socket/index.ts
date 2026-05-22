import type { Server } from "node:http";
import crypto from "node:crypto";
import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import { z } from "zod";
import { env, isAllowedOrigin } from "../config/env";
import { prisma } from "../config/prisma";
import { authenticateToken, joinChat, resumeChat, verifyAccountToken } from "../modules/auth/auth.service";
import { joinSchema } from "../modules/auth/auth.schemas";
import { messageSendSchema } from "../modules/messages/messages.schemas";
import { createMessage, getMessage, markMessagesRead, revokeMessage, setMessagePinned, setMessageReaction } from "../modules/messages/messages.service";
import { addOnlineUser, listOnlineUsers, removeOnlineUser, removeOnlineUserBySocket } from "../modules/sessions/online.service";
import { roomThemeSchema } from "../modules/room-theme/room-theme.schemas";
import { createThemeSystemMessage, updateRoomTheme } from "../modules/room-theme/room-theme.service";
import { redis } from "../config/redis";

const typingSchema = z.object({
  token: z.string().min(20),
  isTyping: z.boolean()
});

const readSchema = z.object({
  token: z.string().min(20),
  messageIds: z.array(z.string().min(1)).max(100)
});

const messageActionSchema = z.object({
  token: z.string().min(20),
  messageId: z.string().min(1)
});

const reactionSchema = messageActionSchema.extend({
  reaction: z.string().nullable()
});

const forwardSchema = z.object({
  token: z.string().min(20),
  targetToken: z.string().min(20),
  messageId: z.string().min(1)
});

const transferAdminSchema = z.object({
  token: z.string().min(20),
  targetUserId: z.string().min(1)
});

const kickSchema = z.object({
  token: z.string().min(20),
  targetUserId: z.string().min(1)
});

const leaveSchema = z.object({
  token: z.string().min(20).optional()
});

export function createSocketServer(httpServer: Server): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      credentials: true
    }
  });

  io.use((socket, next) => {
    try {
      const accountToken = socket.handshake.auth.accountToken;
      if (typeof accountToken === "string" && accountToken.length > 0) {
        verifyAccountToken(accountToken);
      }
      next();
    } catch {
      next(new Error("Invalid account token"));
    }
  });

  io.on("connection", (socket) => {
    const accountToken = socket.handshake.auth.accountToken;
    if (typeof accountToken === "string" && accountToken.length > 0) {
      try {
        const account = verifyAccountToken(accountToken);
        void socket.join(`account:${account.accountId}`);
      } catch {
        socket.disconnect(true);
        return;
      }
    }

    socket.on("auth:join", async (payload) => {
      try {
        const body = joinSchema.parse(payload);
        const accountId = body.accountToken ? verifyAccountToken(body.accountToken).accountId : undefined;
        const result = await joinChat(body.accessKey, body.displayName, accountId);
        await putSocketOnline(io, socket, result.token);
        socket.emit("auth:success", result);
      } catch (error) {
        socket.emit("auth:error", { message: error instanceof Error && error.message === "DIRECT_CHAT_FULL" ? "This direct chat already has 2 people." : "Access key is invalid." });
      }
    });

    socket.on("auth:resume", async (payload: { token?: string }) => {
      try {
        if (!payload.token) {
          throw new Error("Missing token");
        }

        const result = await resumeChat(payload.token);
        await putSocketOnline(io, socket, payload.token);
        socket.emit("auth:success", result);
      } catch {
        socket.emit("auth:error", { message: "Session expired. Please join again." });
      }
    });

    socket.on("message:send", async (payload) => {
      try {
        const body = messageSendSchema.parse(payload);
        const auth = await authenticateToken(body.token);
        const rateLimitKey = `rate:message:${auth.userId}`;
        const canSend = await redis.set(rateLimitKey, "1", "PX", env.MESSAGE_RATE_LIMIT_MS, "NX");

        if (!canSend) {
          socket.emit("message:error", { message: "You are sending messages too quickly." });
          return;
        }

        const realtimeMessage = {
          id: `tmp-${crypto.randomUUID()}`,
          sessionId: auth.sessionId,
          senderId: auth.userId,
          senderName: auth.displayName,
          content: body.content,
          attachments: body.attachments,
          replyToId: body.replyToId ?? null,
          reactions: null,
          pinned: false,
          revoked: false,
          forwardedFromId: body.forwardedFromId ?? null,
          createdAt: new Date()
        };

        io.to(auth.sessionId).emit("message:new", realtimeMessage);

        void createMessage({
          sessionId: auth.sessionId,
          senderId: auth.userId,
          senderName: auth.displayName,
          content: body.content,
          attachments: body.attachments,
          replyToId: body.replyToId,
          forwardedFromId: body.forwardedFromId
        })
          .then((message) => {
            io.to(auth.sessionId).emit("message:stored", { tempId: realtimeMessage.id, message });
          })
          .catch((error) => {
            console.error("Message persistence failed", error);
            socket.emit("message:error", { message: "Message was sent but could not be saved." });
          });
      } catch (error) {
        socket.emit("message:error", { message: "Message could not be sent." });
      }
    });

    socket.on("user:typing", async (payload) => {
      try {
        const body = typingSchema.parse(payload);
        const auth = await authenticateToken(body.token);
        socket.to(auth.sessionId).emit("user:typing", {
          sessionId: auth.sessionId,
          userId: auth.userId,
          displayName: auth.displayName,
          isTyping: body.isTyping
        });
      } catch {
        socket.emit("auth:error", { message: "Session expired. Please join again." });
      }
    });

    socket.on("user:leave", async (payload) => {
      try {
        const body = leaveSchema.parse(payload ?? {});
        if (!body.token) {
          await handleDisconnect(io, socket.id);
          return;
        }

        const auth = await authenticateToken(body.token);
        await socket.leave(auth.sessionId);
        const leftUser = await removeOnlineUser(auth.sessionId, auth.userId);
        if (leftUser) {
          await prisma.sessionUser.updateMany({
            where: { id: auth.userId },
            data: { socketId: null, lastSeenAt: new Date() }
          });
          socket.to(auth.sessionId).emit("user:left", { sessionId: auth.sessionId, user: leftUser });
          io.to(auth.sessionId).emit("user:online-list", { sessionId: auth.sessionId, users: await listOnlineUsers(auth.sessionId) });
        }
      } catch {
        socket.emit("auth:error", { message: "Session expired. Please join again." });
      }
    });

    socket.on("user:kick", async (payload) => {
      try {
        const body = kickSchema.parse(payload);
        const auth = await authenticateToken(body.token);
        const admin = await prisma.sessionUser.findUnique({ where: { id: auth.userId } });

        if (!admin?.isAdmin || admin.sessionId !== auth.sessionId || body.targetUserId === auth.userId) {
          socket.emit("admin:error", { message: "You cannot kick this user." });
          return;
        }

        const target = await prisma.sessionUser.findUnique({ where: { id: body.targetUserId } });
        if (!target || target.sessionId !== auth.sessionId) {
          socket.emit("admin:error", { message: "User is not in this room." });
          return;
        }

        await redis.del(`token:${target.tokenId}`);
        const online = await removeOnlineUser(auth.sessionId, target.id);
        if (online?.socketId) {
          io.to(online.socketId).emit("user:kicked", { sessionId: auth.sessionId, roomTitle: "Room" });
          const targetSocket = io.sockets.sockets.get(online.socketId);
          await targetSocket?.leave(auth.sessionId);
        }

        io.to(auth.sessionId).emit("user:left", { sessionId: auth.sessionId, user: { id: target.id, displayName: target.displayName } });
        io.to(auth.sessionId).emit("user:online-list", { sessionId: auth.sessionId, users: await listOnlineUsers(auth.sessionId) });
      } catch {
        socket.emit("admin:error", { message: "Kick failed." });
      }
    });

    socket.on("room-theme:update", async (payload) => {
      try {
        const body = roomThemeSchema.parse(payload);
        const auth = await authenticateToken(body.token);
        const theme = await updateRoomTheme({
          roomId: auth.sessionId,
          userId: auth.userId,
          themeType: body.themeType,
          wallpaperUrl: body.wallpaperUrl ?? null,
          blur: body.blur,
          opacity: body.opacity,
          brightness: body.brightness,
          saturation: body.saturation,
          overlay: body.overlay
        });
        const message = await createThemeSystemMessage({
          roomId: auth.sessionId,
          userId: auth.userId,
          senderName: auth.displayName,
          content: `${auth.displayName} updated the room appearance`
        });
        io.to(auth.sessionId).emit("room-theme:updated", { sessionId: auth.sessionId, theme, updatedBy: { id: auth.userId, displayName: auth.displayName } });
        io.to(auth.sessionId).emit("message:new", { ...message, replyToId: null, replyTo: null, reactions: { [auth.userId]: "system" }, pinned: false, revoked: false, forwardedFromId: null });
      } catch {
        socket.emit("room-theme:error", { message: "Room theme update failed." });
      }
    });

    socket.on("message:react", async (payload) => {
      try {
        const body = reactionSchema.parse(payload);
        const auth = await authenticateToken(body.token);
        const message = await setMessageReaction(auth.sessionId, body.messageId, auth.userId, body.reaction);
        if (message) io.to(auth.sessionId).emit("message:updated", { sessionId: auth.sessionId, message });
      } catch {
        socket.emit("message:error", { message: "Reaction failed." });
      }
    });

    socket.on("message:pin", async (payload) => {
      try {
        const body = messageActionSchema.extend({ pinned: z.boolean() }).parse(payload);
        const auth = await authenticateToken(body.token);
        const message = await setMessagePinned(auth.sessionId, body.messageId, body.pinned);
        if (message) io.to(auth.sessionId).emit("message:updated", { sessionId: auth.sessionId, message });
      } catch {
        socket.emit("message:error", { message: "Pin action failed." });
      }
    });

    socket.on("message:revoke", async (payload) => {
      try {
        const body = messageActionSchema.parse(payload);
        const auth = await authenticateToken(body.token);
        const message = await revokeMessage(auth.sessionId, auth.userId, body.messageId);
        if (message) io.to(auth.sessionId).emit("message:updated", { sessionId: auth.sessionId, message });
      } catch {
        socket.emit("message:error", { message: "Revoke failed." });
      }
    });

    socket.on("message:forward", async (payload) => {
      try {
        const body = forwardSchema.parse(payload);
        const auth = await authenticateToken(body.token);
        const targetAuth = await authenticateToken(body.targetToken);
        const original = await getMessage(auth.sessionId, body.messageId);
        if (!original || original.revoked) {
          socket.emit("message:error", { message: "Message cannot be forwarded." });
          return;
        }
        const message = await createMessage({
          sessionId: targetAuth.sessionId,
          senderId: targetAuth.userId,
          senderName: targetAuth.displayName,
          content: original.content,
          attachments: original.attachments,
          forwardedFromId: original.id
        });
        io.to(targetAuth.sessionId).emit("message:new", message);
      } catch {
        socket.emit("message:error", { message: "Forward failed." });
      }
    });

    socket.on("message:read", async (payload) => {
      try {
        const body = readSchema.parse(payload);
        const auth = await authenticateToken(body.token);
        const messages = await markMessagesRead(auth.sessionId, auth.userId, body.messageIds);
        if (messages.length > 0) {
          io.to(auth.sessionId).emit("message:read", {
            sessionId: auth.sessionId,
            userId: auth.userId,
            displayName: auth.displayName,
            messageIds: messages.map((message) => message.id),
            messages
          });
        }
      } catch {
        socket.emit("message:error", { message: "Could not mark messages as read." });
      }
    });

    socket.on("admin:transfer", async (payload) => {
      try {
        const body = transferAdminSchema.parse(payload);
        const auth = await authenticateToken(body.token);
        const admin = await prisma.sessionUser.findUnique({ where: { id: auth.userId } });

        if (!admin?.isAdmin || admin.sessionId !== auth.sessionId || body.targetUserId === auth.userId) {
          socket.emit("admin:error", { message: "You cannot transfer admin to this user." });
          return;
        }

        const target = await prisma.sessionUser.findUnique({ where: { id: body.targetUserId } });
        if (!target || target.sessionId !== auth.sessionId) {
          socket.emit("admin:error", { message: "User is not in this room." });
          return;
        }

        await prisma.$transaction([
          prisma.sessionUser.update({ where: { id: admin.id }, data: { isAdmin: false } }),
          prisma.sessionUser.update({ where: { id: target.id }, data: { isAdmin: true } })
        ]);

        io.to(auth.sessionId).emit("admin:transferred", {
          sessionId: auth.sessionId,
          previousAdminId: admin.id,
          newAdminId: target.id
        });
        io.to(auth.sessionId).emit("user:online-list", { sessionId: auth.sessionId, users: await listOnlineUsers(auth.sessionId) });
      } catch {
        socket.emit("admin:error", { message: "Admin transfer failed." });
      }
    });

    socket.on("disconnect", async () => {
      await handleDisconnect(io, socket.id);
    });
  });

  return io;
}

async function putSocketOnline(io: SocketServer, socket: Socket, token: string): Promise<void> {
  const auth = await authenticateToken(token);
  await socket.join(auth.sessionId);
  await prisma.sessionUser.update({
    where: { id: auth.userId },
    data: {
      socketId: socket.id,
      lastSeenAt: new Date()
    }
  });

  const existingOnlineUsers = await listOnlineUsers(auth.sessionId);
  const wasAlreadyOnline = existingOnlineUsers.some((onlineUser) => onlineUser.id === auth.userId);
  const dbUser = await prisma.sessionUser.findUnique({ where: { id: auth.userId }, include: { account: true } });
  const user = {
    id: auth.userId,
    displayName: auth.displayName,
    avatarUrl: dbUser?.account?.avatarUrl ?? null,
    socketId: socket.id,
    joinedAt: new Date().toISOString(),
    isAdmin: Boolean(dbUser?.isAdmin)
  };

  await addOnlineUser(auth.sessionId, user);
  if (!wasAlreadyOnline) {
    socket.to(auth.sessionId).emit("user:joined", { sessionId: auth.sessionId, user });
  }
  io.to(auth.sessionId).emit("user:online-list", { sessionId: auth.sessionId, users: await listOnlineUsers(auth.sessionId) });
}

async function handleDisconnect(io: SocketServer, socketId: string): Promise<void> {
  const leftRooms = await removeOnlineUserBySocket(socketId);

  if (leftRooms.length === 0) {
    return;
  }

  for (const left of leftRooms) {
    await prisma.sessionUser.updateMany({
      where: { id: left.user.id },
      data: {
        socketId: null,
        lastSeenAt: new Date()
      }
    });

    io.to(left.sessionId).emit("user:left", { sessionId: left.sessionId, user: left.user });
    io.to(left.sessionId).emit("user:online-list", { sessionId: left.sessionId, users: await listOnlineUsers(left.sessionId) });
  }
}
