import { prisma } from "../../config/prisma";

export type RoomThemePayload = {
  roomId: string;
  themeType: string;
  wallpaperUrl: string | null;
  blur: number;
  opacity: number;
  brightness: number;
  saturation: number;
  overlay: string;
  updatedBy: string | null;
  updatedAt: Date;
};

export const defaultRoomTheme = {
  themeType: "glass-neo",
  wallpaperUrl: null,
  blur: 10,
  opacity: 0.6,
  brightness: 0.88,
  saturation: 1.12,
  overlay: "rgba(3, 7, 18, 0.42)"
};

function normalizeTheme(theme: RoomThemePayload): RoomThemePayload {
  return {
    roomId: theme.roomId,
    themeType: theme.themeType,
    wallpaperUrl: theme.wallpaperUrl,
    blur: theme.blur,
    opacity: theme.opacity,
    brightness: theme.brightness,
    saturation: theme.saturation,
    overlay: theme.overlay,
    updatedBy: theme.updatedBy,
    updatedAt: theme.updatedAt
  };
}

export async function getRoomTheme(roomId: string): Promise<RoomThemePayload> {
  const rows = await prisma.$queryRaw<RoomThemePayload[]>`
    SELECT roomId, themeType, wallpaperUrl, blur, opacity, brightness, saturation, overlay, updatedBy, updatedAt
    FROM RoomTheme
    WHERE roomId = ${roomId}
    LIMIT 1
  `;
  const theme = rows[0];
  if (theme) return normalizeTheme(theme);
  return {
    roomId,
    ...defaultRoomTheme,
    updatedBy: null,
    updatedAt: new Date()
  };
}

export async function updateRoomTheme(params: {
  roomId: string;
  userId: string;
  themeType: string;
  wallpaperUrl?: string | null;
  blur: number;
  opacity: number;
  brightness: number;
  saturation: number;
  overlay: string;
}): Promise<RoomThemePayload> {
  await prisma.$executeRaw`
    INSERT INTO RoomTheme (roomId, themeType, wallpaperUrl, blur, opacity, brightness, saturation, overlay, updatedBy, updatedAt, createdAt)
    VALUES (${params.roomId}, ${params.themeType}, ${params.wallpaperUrl ?? null}, ${params.blur}, ${params.opacity}, ${params.brightness}, ${params.saturation}, ${params.overlay}, ${params.userId}, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE
      themeType = VALUES(themeType),
      wallpaperUrl = VALUES(wallpaperUrl),
      blur = VALUES(blur),
      opacity = VALUES(opacity),
      brightness = VALUES(brightness),
      saturation = VALUES(saturation),
      overlay = VALUES(overlay),
      updatedBy = VALUES(updatedBy),
      updatedAt = NOW(3)
  `;

  return getRoomTheme(params.roomId);
}

export async function createThemeSystemMessage(params: { roomId: string; userId: string; senderName: string; content: string }) {
  const message = await prisma.message.create({
    data: {
      sessionId: params.roomId,
      senderId: params.userId,
      senderName: "System",
      content: params.content,
      attachments: []
    },
    select: {
      id: true,
      sessionId: true,
      senderId: true,
      senderName: true,
      content: true,
      attachments: true,
      createdAt: true,
      reads: true
    }
  });

  await prisma.$executeRaw`UPDATE Message SET reactions = ${JSON.stringify({ [params.userId]: "system" })} WHERE id = ${message.id}`;
  return message;
}
