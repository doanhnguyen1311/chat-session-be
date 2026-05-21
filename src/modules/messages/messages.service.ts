import crypto from "node:crypto";
import { prisma } from "../../config/prisma";

export type MessageAttachment = {
  url: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: "image" | "video" | "file";
};

const messageSelect = {
  id: true,
  sessionId: true,
  senderId: true,
  senderName: true,
  content: true,
  attachments: true,
  createdAt: true,
  reads: {
    select: {
      userId: true,
      readAt: true,
      user: {
        select: {
          displayName: true
        }
      }
    }
  }
};

export async function createMessage(params: {
  sessionId: string;
  senderId: string;
  senderName: string;
  content: string;
  attachments?: MessageAttachment[];
}) {
  return prisma.message.create({
    data: {
      sessionId: params.sessionId,
      senderId: params.senderId,
      senderName: params.senderName,
      content: params.content.trim(),
      attachments: params.attachments ?? []
    },
    select: messageSelect as any
  });
}

export async function listMessages(sessionId: string, limit: number, cursor?: string) {
  return prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1
        }
      : {}),
    select: messageSelect as any
  });
}

export async function markMessagesRead(sessionId: string, userId: string, messageIds: string[]) {
  const messages = await prisma.message.findMany({
    where: {
      id: { in: messageIds },
      sessionId,
      senderId: { not: userId }
    },
    select: { id: true }
  });

  if (messages.length === 0) {
    return [];
  }

  await prisma.$transaction(
    messages.map((message) =>
      prisma.$executeRaw`
        INSERT IGNORE INTO MessageRead (id, messageId, userId, readAt)
        VALUES (${crypto.randomUUID()}, ${message.id}, ${userId}, NOW(3))
      `
    )
  );

  return prisma.message.findMany({
    where: { id: { in: messages.map((message) => message.id) } },
    select: messageSelect as any
  });
}
