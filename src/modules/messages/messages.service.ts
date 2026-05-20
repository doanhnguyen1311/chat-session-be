import { prisma } from "../../config/prisma";

export type MessageAttachment = {
  url: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: "image" | "video" | "file";
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
    select: {
      id: true,
      sessionId: true,
      senderId: true,
      senderName: true,
      content: true,
      attachments: true,
      createdAt: true
    }
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
    select: {
      id: true,
      sessionId: true,
      senderId: true,
      senderName: true,
      content: true,
      attachments: true,
      createdAt: true
    }
  });
}
