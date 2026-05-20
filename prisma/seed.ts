import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rawKey = process.env.ACCESS_KEY ?? "internal-demo-key";
  const label = process.env.DEFAULT_SESSION_NAME ?? "Internal Chat";
  const activeKeys = await prisma.accessKey.findMany({
    where: { active: true },
    include: { sessions: true }
  });

  for (const activeKey of activeKeys) {
    if (await bcrypt.compare(rawKey, activeKey.keyHash)) {
      if (activeKey.sessions.length === 0) {
        await prisma.chatSession.create({
          data: {
            name: label,
            accessKeyId: activeKey.id
          }
        });
      }

      console.log(`Access key "${activeKey.label}" already exists. Seed skipped.`);
      return;
    }
  }

  const keyHash = await bcrypt.hash(rawKey, 12);
  const accessKey = await prisma.accessKey.create({
    data: {
      label,
      keyHash,
      sessions: {
        create: {
          name: label
        }
      }
    },
    include: {
      sessions: true
    }
  });

  console.log(`Created access key "${accessKey.label}" with session "${accessKey.sessions[0]?.name}".`);
  console.log("Use ACCESS_KEY from .env to join. The raw key is not stored in MySQL.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
