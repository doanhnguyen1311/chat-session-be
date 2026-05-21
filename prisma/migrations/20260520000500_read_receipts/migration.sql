CREATE TABLE `MessageRead` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MessageRead_messageId_userId_key`(`messageId`, `userId`),
    INDEX `MessageRead_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MessageRead`
  ADD CONSTRAINT `MessageRead_messageId_fkey`
  FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MessageRead`
  ADD CONSTRAINT `MessageRead_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `SessionUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
