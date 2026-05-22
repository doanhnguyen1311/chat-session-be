import http from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { createSocketServer } from "./socket";

async function bootstrap(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);
  app.set("io", io);

  server.listen(env.PORT, () => {
    console.log(`Backend listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
