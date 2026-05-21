ALTER TABLE `Message`
  ADD COLUMN `replyToId` VARCHAR(191) NULL,
  ADD COLUMN `reactions` JSON NULL,
  ADD COLUMN `pinned` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `revoked` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `forwardedFromId` VARCHAR(191) NULL;

CREATE INDEX `Message_replyToId_idx` ON `Message`(`replyToId`);
CREATE INDEX `Message_pinned_idx` ON `Message`(`pinned`);
