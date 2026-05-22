import { Router } from "express";
import { authenticateToken } from "../auth/auth.service";
import { roomThemeQuerySchema, roomThemeSchema } from "./room-theme.schemas";
import { getRoomTheme, updateRoomTheme } from "./room-theme.service";

export const roomThemeRouter = Router();

roomThemeRouter.get("/room-theme", async (req, res, next) => {
  try {
    const query = roomThemeQuerySchema.parse(req.query);
    const auth = await authenticateToken(query.token);
    const theme = await getRoomTheme(auth.sessionId);
    res.json({ theme });
  } catch (error) {
    next(error);
  }
});

roomThemeRouter.put("/room-theme", async (req, res, next) => {
  try {
    const body = roomThemeSchema.parse(req.body);
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
    res.json({ theme });
  } catch (error) {
    next(error);
  }
});
