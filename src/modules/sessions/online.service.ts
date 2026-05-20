import { redis } from "../../config/redis";
import { env } from "../../config/env";

export type OnlineUser = {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  socketId: string;
  joinedAt: string;
  isAdmin?: boolean;
};

const onlineKey = (sessionId: string) => `session:${sessionId}:online`;
const socketKey = (socketId: string) => `socket:${socketId}`;

export async function addOnlineUser(sessionId: string, user: OnlineUser): Promise<void> {
  const existing = await redis.get(socketKey(user.socketId));
  const socketRooms = existing ? (JSON.parse(existing) as Array<{ sessionId: string; userId: string }>) : [];
  const nextRooms = socketRooms.filter((room) => room.sessionId !== sessionId);
  nextRooms.push({ sessionId, userId: user.id });

  await redis
    .multi()
    .hset(onlineKey(sessionId), user.id, JSON.stringify(user))
    .expire(onlineKey(sessionId), env.SESSION_TTL_SECONDS)
    .set(socketKey(user.socketId), JSON.stringify(nextRooms), "EX", env.SESSION_TTL_SECONDS)
    .exec();
}

export async function removeOnlineUserBySocket(socketId: string): Promise<Array<{ sessionId: string; user: OnlineUser }>> {
  const socketData = await redis.get(socketKey(socketId));
  if (!socketData) {
    return [];
  }

  const rooms = JSON.parse(socketData) as Array<{ sessionId: string; userId: string }>;
  const removed: Array<{ sessionId: string; user: OnlineUser }> = [];
  const tx = redis.multi().del(socketKey(socketId));

  for (const room of rooms) {
    const userData = await redis.hget(onlineKey(room.sessionId), room.userId);
    tx.hdel(onlineKey(room.sessionId), room.userId);
    if (userData) {
      removed.push({ sessionId: room.sessionId, user: JSON.parse(userData) as OnlineUser });
    }
  }

  await tx.exec();
  return removed;
}

export async function listOnlineUsers(sessionId: string): Promise<OnlineUser[]> {
  const values = await redis.hvals(onlineKey(sessionId));
  return values.map((value) => JSON.parse(value) as OnlineUser).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function removeOnlineUser(sessionId: string, userId: string): Promise<OnlineUser | null> {
  const userData = await redis.hget(onlineKey(sessionId), userId);
  const user = userData ? (JSON.parse(userData) as OnlineUser) : null;

  const tx = redis.multi().hdel(onlineKey(sessionId), userId);
  if (user?.socketId) {
    const socketData = await redis.get(socketKey(user.socketId));
    if (socketData) {
      const rooms = JSON.parse(socketData) as Array<{ sessionId: string; userId: string }>;
      const remainingRooms = rooms.filter((room) => !(room.sessionId === sessionId && room.userId === userId));
      if (remainingRooms.length > 0) {
        tx.set(socketKey(user.socketId), JSON.stringify(remainingRooms), "EX", env.SESSION_TTL_SECONDS);
      } else {
        tx.del(socketKey(user.socketId));
      }
    }
  }

  await tx.exec();
  return user;
}
