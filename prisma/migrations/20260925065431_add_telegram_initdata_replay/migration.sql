-- CreateTable
CREATE TABLE "TelegramInitDataReplay" (
    "hash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramInitDataReplay_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "TelegramInitDataReplay_expiresAt_idx" ON "TelegramInitDataReplay"("expiresAt");
