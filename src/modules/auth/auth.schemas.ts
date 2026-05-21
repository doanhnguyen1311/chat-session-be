import { z } from "zod";

export const joinSchema = z.object({
  accessKey: z.string().min(3).max(200),
  displayName: z.string().min(2).max(40),
  accountToken: z.string().min(20).optional()
});

export const createAccessKeySchema = z.object({
  label: z.string().min(2).max(80),
  accessKey: z.string().min(8).max(200).optional(),
  sessionName: z.string().min(2).max(80).optional(),
  kind: z.enum(["GROUP", "DIRECT"]).default("GROUP")
});

export const accountAuthSchema = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters.").max(80),
  password: z.string().min(4, "Password must be at least 4 characters.").max(100),
  displayName: z.string().trim().min(2).max(40).optional()
});

export const updateAccountSchema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),
  avatarUrl: z.string().trim().max(1000).optional()
});
