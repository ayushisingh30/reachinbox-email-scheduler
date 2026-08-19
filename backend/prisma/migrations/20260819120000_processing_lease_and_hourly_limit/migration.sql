-- Persist the rate limit and an explicit processing lease for restart recovery.
ALTER TABLE `EmailJob`
    ADD COLUMN `hourlyLimit` INTEGER NULL,
    ADD COLUMN `processingStartedAt` DATETIME NULL;
