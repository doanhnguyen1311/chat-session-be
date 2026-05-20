import { z } from "zod";

export const attachmentSchema = z.object({
  url: z.string().min(1).max(1000),
  name: z.string().min(1).max(300),
  originalName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().min(0).max(50 * 1024 * 1024),
  type: z.enum(["image", "video", "file"])
});

export const messageSendSchema = z
  .object({
    token: z.string().min(20),
    content: z.string().trim().max(1000).default(""),
    attachments: z.array(attachmentSchema).max(10).default([])
  })
  .refine((value) => value.content.length > 0 || value.attachments.length > 0, {
    message: "Message cannot be empty."
  });

export const messageQuerySchema = z.object({
  token: z.string().min(20),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional()
});
