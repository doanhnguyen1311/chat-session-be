CREATE TABLE IF NOT EXISTS `ChatAccount` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ChatAccount_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SessionUser`
  ADD COLUMN `accountId` VARCHAR(191) NULL;

CREATE INDEX `SessionUser_accountId_idx` ON `SessionUser`(`accountId`);

ALTER TABLE `SessionUser`
  ADD CONSTRAINT `SessionUser_accountId_fkey`
  FOREIGN KEY (`accountId`) REFERENCES `ChatAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
