import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";
import { env } from "../../config/env";
import { normalizeDisplayName } from "../../utils/sanitize";
import { createToken, verifyToken } from "../../utils/tokens";

export type JoinResult = {
  token: string;
  user: {
    id: string;
    displayName: string;
    sessionId: string;
    isAdmin: boolean;
    role: "ADMIN" | "MEMBER";
  };
  session: {
    id: string;
    name: string;
    kind: string;
  };
};

export type AccountAuthResult = {
  accountToken: string;
  account: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  rooms: JoinResult[];
};

export type AccountSearchResult = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

async function getSessionKind(sessionId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ kind: string }>>`SELECT kind FROM ChatSession WHERE id = ${sessionId} LIMIT 1`;
  return rows[0]?.kind ?? "GROUP";
}

async function getDirectDisplayName(sessionId: string, currentUserId: string, fallback: string): Promise<string> {
  const other = await prisma.sessionUser.findFirst({
    where: { sessionId, id: { not: currentUserId } },
    select: { displayName: true }
  });
  return other?.displayName ?? fallback;
}

async function findMatchingAccessKey(rawAccessKey: string) {
  const session = await prisma.chatSession.findUnique({
    where: { id: rawAccessKey },
    include: { accessKey: true }
  });

  if (session?.accessKey.active) {
    return { ...session.accessKey, sessions: [session] };
  }

  const keys = await prisma.accessKey.findMany({
    where: { active: true },
    include: { sessions: { orderBy: { createdAt: "asc" }, take: 1 } }
  });

  for (const key of keys) {
    if (await bcrypt.compare(rawAccessKey, key.keyHash)) {
      return key;
    }
  }

  if (env.ACCESS_KEY && rawAccessKey === env.ACCESS_KEY) {
    const keyHash = await bcrypt.hash(rawAccessKey, 12);
    return prisma.accessKey.create({
      data: {
        label: env.DEFAULT_SESSION_NAME,
        keyHash,
        sessions: {
          create: { name: env.DEFAULT_SESSION_NAME }
        }
      },
      include: { sessions: true }
    });
  }

  return null;
}

export async function joinChat(accessKey: string, displayNameInput: string, accountId?: string): Promise<JoinResult> {
  const account = accountId ? await prisma.account.findUnique({ where: { id: accountId } }) : null;
  const displayName = normalizeDisplayName(account?.displayName ?? displayNameInput);
  const key = await findMatchingAccessKey(accessKey);

  if (!key) {
    throw new Error("ACCESS_KEY_INVALID");
  }

  const session =
    key.sessions[0] ??
    (await prisma.chatSession.create({
      data: {
        name: key.label,
        accessKeyId: key.id
      }
    }));

  const sessionKind = await getSessionKind(session.id);
  const existingUsers = await prisma.sessionUser.count({
    where: { sessionId: session.id }
  });
  const existingAccountUser = accountId
    ? await prisma.sessionUser.findFirst({
        where: { sessionId: session.id, accountId }
      })
    : null;

  if (sessionKind === "DIRECT" && existingUsers >= 2 && !existingAccountUser) {
    throw new Error("DIRECT_CHAT_FULL");
  }

  const user =
    (existingAccountUser
      ? await prisma.sessionUser.update({
          where: { id: existingAccountUser.id },
          data: { displayName }
        })
      : null) ??
    (await prisma.sessionUser.create({
      data: {
        sessionId: session.id,
        accountId,
        displayName,
        tokenId: `pending-${crypto.randomUUID()}`,
        isAdmin: sessionKind === "GROUP" && existingUsers === 0
      }
    }));

  const { token, jti } = createToken({
    userId: user.id,
    sessionId: session.id,
    displayName
  });

  await prisma.sessionUser.update({
    where: { id: user.id },
    data: { tokenId: jti }
  });

  await redis.set(
    `token:${jti}`,
    JSON.stringify({ userId: user.id, sessionId: session.id, displayName }),
    "EX",
    env.SESSION_TTL_SECONDS
  );

  const sessionName = sessionKind === "DIRECT" ? await getDirectDisplayName(session.id, user.id, session.name) : session.name;

  return {
    token,
    user: {
      id: user.id,
      displayName,
      sessionId: session.id,
      isAdmin: sessionKind === "GROUP" && user.isAdmin,
      role: sessionKind === "GROUP" && user.isAdmin ? "ADMIN" : "MEMBER"
    },
    session: {
      id: session.id,
      name: sessionName,
      kind: sessionKind
    }
  };
}

function createAccountToken(account: { id: string; username: string; displayName: string }): string {
  return jwt.sign(
    {
      type: "account",
      accountId: account.id,
      username: account.username,
      displayName: account.displayName
    },
    env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

export function verifyAccountToken(token: string): { accountId: string; username: string; displayName: string } {
  const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  if (decoded.type !== "account" || !decoded.accountId || !decoded.username || !decoded.displayName) {
    throw new Error("ACCOUNT_TOKEN_INVALID");
  }
  return {
    accountId: String(decoded.accountId),
    username: String(decoded.username),
    displayName: String(decoded.displayName)
  };
}

export async function registerAccount(usernameInput: string, password: string, displayNameInput?: string): Promise<AccountAuthResult> {
  const username = usernameInput.trim().toLowerCase();
  const displayName = normalizeDisplayName(displayNameInput ?? username);
  const passwordHash = await bcrypt.hash(password, 12);

  const account = await prisma.account.create({
    data: { username, passwordHash, displayName }
  });

  return {
    accountToken: createAccountToken(account),
    account: { id: account.id, username: account.username, displayName: account.displayName, avatarUrl: account.avatarUrl },
    rooms: []
  };
}

export async function loginAccount(usernameInput: string, password: string): Promise<AccountAuthResult> {
  const username = usernameInput.trim().toLowerCase();
  const account = await prisma.account.findUnique({ where: { username } });

  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    throw new Error("ACCOUNT_INVALID");
  }

  return {
    accountToken: createAccountToken(account),
    account: { id: account.id, username: account.username, displayName: account.displayName, avatarUrl: account.avatarUrl },
    rooms: await listAccountRooms(account.id)
  };
}

export async function getAccountMe(accountToken: string): Promise<AccountAuthResult> {
  const payload = verifyAccountToken(accountToken);
  const account = await prisma.account.findUnique({ where: { id: payload.accountId } });

  if (!account) {
    throw new Error("ACCOUNT_TOKEN_INVALID");
  }

  return {
    accountToken,
    account: { id: account.id, username: account.username, displayName: account.displayName, avatarUrl: account.avatarUrl },
    rooms: await listAccountRooms(account.id)
  };
}

export async function searchAccounts(accountToken: string, queryInput: string): Promise<AccountSearchResult[]> {
  const payload = verifyAccountToken(accountToken);
  const query = queryInput.trim();
  if (query.length < 2) return [];

  return prisma.account.findMany({
    where: {
      id: { not: payload.accountId },
      OR: [
        { username: { contains: query } },
        { displayName: { contains: query } }
      ]
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true
    },
    orderBy: [{ displayName: "asc" }, { username: "asc" }],
    take: 10
  });
}

export async function updateAccountProfile(
  accountToken: string,
  params: { displayName?: string; avatarUrl?: string }
): Promise<AccountAuthResult> {
  const payload = verifyAccountToken(accountToken);
  const displayName = params.displayName ? normalizeDisplayName(params.displayName) : undefined;

  const account = await prisma.account.update({
    where: { id: payload.accountId },
    data: {
      ...(displayName ? { displayName } : {}),
      ...(params.avatarUrl !== undefined ? { avatarUrl: params.avatarUrl || null } : {})
    }
  });

  if (displayName) {
    await prisma.sessionUser.updateMany({
      where: { accountId: account.id },
      data: { displayName }
    });
  }

  return {
    accountToken: createAccountToken(account),
    account: { id: account.id, username: account.username, displayName: account.displayName, avatarUrl: account.avatarUrl },
    rooms: await listAccountRooms(account.id)
  };
}

export async function startDirectChat(accountToken: string, targetAccountId: string): Promise<{ initiatorRoom: JoinResult; targetRoom: JoinResult; targetAccountId: string }> {
  const payload = verifyAccountToken(accountToken);
  if (payload.accountId === targetAccountId) {
    throw new Error("DIRECT_SELF");
  }

  const [currentAccount, targetAccount] = await Promise.all([
    prisma.account.findUnique({ where: { id: payload.accountId } }),
    prisma.account.findUnique({ where: { id: targetAccountId } })
  ]);

  if (!currentAccount || !targetAccount) {
    throw new Error("ACCOUNT_NOT_FOUND");
  }

  const existingSessions = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT s.id
    FROM ChatSession s
    INNER JOIN SessionUser currentUser ON currentUser.sessionId = s.id AND currentUser.accountId = ${currentAccount.id}
    INNER JOIN SessionUser targetUser ON targetUser.sessionId = s.id AND targetUser.accountId = ${targetAccount.id}
    WHERE s.kind = 'DIRECT'
    LIMIT 1
  `;

  const sessionId = existingSessions[0]?.id ?? await createDirectSession(currentAccount, targetAccount);
  const [initiatorRoom, targetRoom] = await Promise.all([
    joinChat(sessionId, currentAccount.displayName, currentAccount.id),
    joinChat(sessionId, targetAccount.displayName, targetAccount.id)
  ]);

  return { initiatorRoom, targetRoom, targetAccountId: targetAccount.id };
}

async function createDirectSession(
  currentAccount: { id: string; displayName: string },
  targetAccount: { id: string; displayName: string }
): Promise<string> {
  const accessKey = await prisma.accessKey.create({
    data: {
      label: `${currentAccount.displayName} & ${targetAccount.displayName}`,
      keyHash: await bcrypt.hash(generateAccessKey(), 12)
    }
  });

  const session = await prisma.chatSession.create({
    data: {
      name: `${currentAccount.displayName} & ${targetAccount.displayName}`,
      accessKeyId: accessKey.id,
      users: {
        create: {
          accountId: targetAccount.id,
          displayName: normalizeDisplayName(targetAccount.displayName),
          tokenId: `pending-${crypto.randomUUID()}`,
          isAdmin: false
        }
      }
    }
  });

  await prisma.$executeRaw`UPDATE ChatSession SET kind = 'DIRECT' WHERE id = ${session.id}`;
  return session.id;
}

async function listAccountRooms(accountId: string): Promise<JoinResult[]> {
  const users = await prisma.sessionUser.findMany({
    where: { accountId },
    include: { session: true },
    orderBy: { updatedAt: "desc" }
  });

  const rooms: JoinResult[] = [];
  for (const user of users) {
    const { token, jti } = createToken({
      userId: user.id,
      sessionId: user.sessionId,
      displayName: user.displayName
    });

    await prisma.sessionUser.update({ where: { id: user.id }, data: { tokenId: jti } });
    await redis.set(
      `token:${jti}`,
      JSON.stringify({ userId: user.id, sessionId: user.sessionId, displayName: user.displayName }),
      "EX",
      env.SESSION_TTL_SECONDS
    );

    const sessionKind = await getSessionKind(user.sessionId);
    const sessionName = sessionKind === "DIRECT" ? await getDirectDisplayName(user.sessionId, user.id, user.session.name) : user.session.name;

    rooms.push({
      token,
      user: {
        id: user.id,
        displayName: user.displayName,
        sessionId: user.sessionId,
        isAdmin: sessionKind === "GROUP" && user.isAdmin,
        role: sessionKind === "GROUP" && user.isAdmin ? "ADMIN" : "MEMBER"
      },
      session: {
        id: user.session.id,
        name: sessionName,
        kind: sessionKind
      }
    });
  }

  return rooms;
}

export async function authenticateToken(token: string) {
  const payload = verifyToken(token);
  const cached = await redis.get(`token:${payload.jti}`);

  if (!cached) {
    throw new Error("TOKEN_EXPIRED");
  }

  return payload;
}

export async function resumeChat(token: string): Promise<JoinResult> {
  const payload = await authenticateToken(token);
  const user = await prisma.sessionUser.findUnique({
    where: { id: payload.userId },
    include: { session: true }
  });

  if (!user) {
    throw new Error("TOKEN_EXPIRED");
  }

  const sessionKind = await getSessionKind(user.sessionId);
  const sessionName = sessionKind === "DIRECT" ? await getDirectDisplayName(user.sessionId, user.id, user.session.name) : user.session.name;

  return {
    token,
    user: {
      id: user.id,
      displayName: user.displayName,
      sessionId: user.sessionId,
      isAdmin: sessionKind === "GROUP" && user.isAdmin,
      role: sessionKind === "GROUP" && user.isAdmin ? "ADMIN" : "MEMBER"
    },
    session: {
      id: user.session.id,
      name: sessionName,
      kind: sessionKind
    }
  };
}

export async function createAccessKey(label: string, rawAccessKey: string | undefined, sessionName?: string, kind = "GROUP") {
  const accessKey = rawAccessKey ?? generateAccessKey();
  const keyHash = await bcrypt.hash(accessKey, 12);

  const created = await prisma.accessKey.create({
    data: {
      label,
      keyHash,
      sessions: {
        create: {
          name: sessionName ?? label
        }
      }
    },
    select: {
      id: true,
      label: true,
      active: true,
      createdAt: true,
      sessions: {
        select: {
          id: true
        },
        take: 1
      }
    }
  });

  const sessionId = created.sessions[0]?.id;
  if (sessionId) {
    await prisma.$executeRaw`UPDATE ChatSession SET kind = ${kind} WHERE id = ${sessionId}`;
  }

  return {
    id: created.id,
    label: created.label,
    active: created.active,
    createdAt: created.createdAt,
    accessKey
  };
}

function generateAccessKey(): string {
  return `chat-${crypto.randomBytes(4).toString("hex")}-${crypto.randomBytes(4).toString("hex")}`;
}
