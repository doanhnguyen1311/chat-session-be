import { Router } from "express";
import { createAccessKey, getAccountMe, joinChat, loginAccount, registerAccount, updateAccountProfile, verifyAccountToken } from "./auth.service";
import { accountAuthSchema, createAccessKeySchema, joinSchema, updateAccountSchema } from "./auth.schemas";

export const authRouter = Router();

authRouter.post("/auth/join", async (req, res, next) => {
  try {
    const body = joinSchema.parse(req.body);
    const accountId = body.accountToken ? verifyAccountToken(body.accountToken).accountId : undefined;
    const result = await joinChat(body.accessKey, body.displayName, accountId);
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "ACCESS_KEY_INVALID") {
      res.status(401).json({ message: "Access key is invalid." });
      return;
    }

    next(error);
  }
});

authRouter.post("/account/register", async (req, res, next) => {
  try {
    const body = accountAuthSchema.parse(req.body);
    const result = await registerAccount(body.username, body.password, body.displayName);
    res.status(201).json(result);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      res.status(409).json({ message: "Username already exists." });
      return;
    }
    next(error);
  }
});

authRouter.post("/account/login", async (req, res, next) => {
  try {
    const body = accountAuthSchema.omit({ displayName: true }).parse(req.body);
    const result = await loginAccount(body.username, body.password);
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_INVALID") {
      res.status(401).json({ message: "Invalid username or password." });
      return;
    }
    next(error);
  }
});

authRouter.get("/account/me", async (req, res, next) => {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const result = await getAccountMe(token);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: "Account session expired." });
  }
});

authRouter.patch("/account/me", async (req, res) => {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const body = updateAccountSchema.parse(req.body);
    const result = await updateAccountProfile(token, body);
    res.json(result);
  } catch {
    res.status(401).json({ message: "Account profile could not be updated." });
  }
});

authRouter.post("/access-keys", async (req, res, next) => {
  try {
    const body = createAccessKeySchema.parse(req.body);
    const accessKey = await createAccessKey(body.label, body.accessKey, body.sessionName);
    res.status(201).json({ accessKey });
  } catch (error) {
    next(error);
  }
});
