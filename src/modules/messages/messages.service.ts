import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
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

type StoredMessage = {
  id: string;
  sessionId: string;
  senderId: string;
  senderName: string;
  content: string;
  attachments?: MessageAttachment[];
  createdAt: Date;
  reads?: unknown[];
};

type ReplyMessageMeta = {
  id: string;
  senderName: string;
  content: string;
  attachments: MessageAttachment[] | null;
  revoked: boolean;
};

type MessageMeta = {
  id: string;
  replyToId: string | null;
  reactions: unknown;
  pinned: boolean;
  revoked: boolean;
  forwardedFromId: string | null;
};

async function enrichMessages<T extends { id: string }>(messages: T[]): Promise<Array<T & Omit<MessageMeta, "id"> & { replyTo: ReplyMessageMeta | null }>> {
  if (messages.length === 0) return [];
  const metas = await prisma.$queryRaw<MessageMeta[]>`
    SELECT id, replyToId, reactions, pinned, revoked, forwardedFromId
    FROM Message
    WHERE id IN (${Prisma.join(messages.map((message) => message.id))})
  `;
  const metaById = new Map(metas.map((meta) => [meta.id, meta]));
  const replyToIds = metas.map((meta) => meta.replyToId).filter((id): id is string => Boolean(id));
  const replies = replyToIds.length
    ? await prisma.$queryRaw<ReplyMessageMeta[]>`
        SELECT id, senderName, content, attachments, revoked
        FROM Message
        WHERE id IN (${Prisma.join(replyToIds)})
      `
    : [];
  const replyById = new Map(replies.map((reply) => [reply.id, reply]));
  return messages.map((message) => {
    const meta = metaById.get(message.id);
    return {
      ...message,
      replyToId: meta?.replyToId ?? null,
      replyTo: meta?.replyToId ? replyById.get(meta.replyToId) ?? null : null,
      reactions: meta?.reactions ?? null,
      pinned: Boolean(meta?.pinned),
      revoked: Boolean(meta?.revoked),
      forwardedFromId: meta?.forwardedFromId ?? null
    };
  });
}

export async function createMessage(params: {
  sessionId: string;
  senderId: string;
  senderName: string;
  content: string;
  attachments?: MessageAttachment[];
  replyToId?: string;
  forwardedFromId?: string;
}) {
  const message = (await prisma.message.create({
    data: {
      sessionId: params.sessionId,
      senderId: params.senderId,
      senderName: params.senderName,
      content: params.content.trim(),
      attachments: params.attachments ?? []
    },
    select: messageSelect as any
  })) as unknown as StoredMessage;

  if (params.replyToId || params.forwardedFromId) {
    await prisma.$executeRaw`
      UPDATE Message
      SET replyToId = ${params.replyToId ?? null}, forwardedFromId = ${params.forwardedFromId ?? null}
      WHERE id = ${message.id}
    `;
  }

  const enriched = await enrichMessages([message]);
  return enriched[0];
}

export async function listMessages(sessionId: string, limit: number, cursor?: string) {
  const messages = (await prisma.message.findMany({
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
  })) as unknown as StoredMessage[];

  return enrichMessages(messages);
}

export async function getMessage(sessionId: string, messageId: string) {
  const message = (await prisma.message.findFirst({
    where: { id: messageId, sessionId },
    select: messageSelect as any
  })) as StoredMessage | null;
  if (!message) return null;
  const enriched = await enrichMessages([message]);
  return enriched[0];
}

export async function setMessagePinned(sessionId: string, messageId: string, pinned: boolean) {
  await prisma.$executeRaw`UPDATE Message SET pinned = ${pinned} WHERE id = ${messageId} AND sessionId = ${sessionId}`;
  return getMessage(sessionId, messageId);
}

export async function revokeMessage(sessionId: string, userId: string, messageId: string) {
  await prisma.$executeRaw`UPDATE Message SET revoked = true, content = '', attachments = JSON_ARRAY() WHERE id = ${messageId} AND sessionId = ${sessionId} AND senderId = ${userId}`;
  return getMessage(sessionId, messageId);
}

export async function setMessageReaction(sessionId: string, messageId: string, userId: string, reaction: string | null) {
  const current = await getMessage(sessionId, messageId);
  if (!current) return null;
  const reactions = { ...((current.reactions as Record<string, string> | null) ?? {}) };
  if (reaction) reactions[userId] = reaction;
  else delete reactions[userId];
  await prisma.$executeRaw`UPDATE Message SET reactions = ${JSON.stringify(reactions)} WHERE id = ${messageId} AND sessionId = ${sessionId}`;
  return getMessage(sessionId, messageId);
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

  const updated = (await prisma.message.findMany({
    where: { id: { in: messages.map((message) => message.id) } },
    select: messageSelect as any
  })) as unknown as StoredMessage[];

  return enrichMessages(updated);
}
