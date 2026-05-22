import { z } from "zod";

export const roomThemeSchema = z.object({
  token: z.string().min(20),
  themeType: z.string().min(1).max(80),
  wallpaperUrl: z.string().max(4000).nullable().optional(),
  blur: z.number().int().min(0).max(24),
  opacity: z.number().min(0.2).max(0.9),
  brightness: z.number().min(0.4).max(1.4),
  saturation: z.number().min(0.4).max(1.8),
  overlay: z.string().min(1).max(120)
});

export const roomThemeQuerySchema = z.object({
  token: z.string().min(20)
});
