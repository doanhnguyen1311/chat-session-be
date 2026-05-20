import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type SessionTokenPayload = {
  jti: string;
  userId: string;
  sessionId: string;
  displayName: string;
};

export function createToken(payload: Omit<SessionTokenPayload, "jti">): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      userId: payload.userId,
      sessionId: payload.sessionId,
      displayName: payload.displayName
    },
    env.JWT_SECRET,
    {
      jwtid: jti,
      expiresIn: env.SESSION_TTL_SECONDS
    }
  );

  return { token, jti };
}

export function verifyToken(token: string): SessionTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;

  if (!decoded.jti || !decoded.userId || !decoded.sessionId || !decoded.displayName) {
    throw new Error("Invalid token payload");
  }

  return {
    jti: decoded.jti,
    userId: String(decoded.userId),
    sessionId: String(decoded.sessionId),
    displayName: String(decoded.displayName)
  };
}
