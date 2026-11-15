-- Service de suivi des commandes (Order Tracking) et activation des services.
--
-- Migration purement additive : deux colonnes sur "Vendor" et six nouvelles
-- tables. Aucune table de Retours-ML n'est modifiée.
--
-- "returnsMLEnabled" vaut TRUE par défaut : les boutiques existantes gardent
-- exactement le comportement qu'elles avaient avant l'introduction des
-- services. "orderTrackingEnabled" vaut FALSE : le suivi s'active
-- explicitement, boutique par boutique.

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_DELIVERY', 'RETURNED', 'CANCELLED', 'UNMAPPED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "orderTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnsMLEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "OrderTrackingConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "webhookSecretEnc" TEXT,
    "webhookSecretPrefix" TEXT,
    "webhookSecretCreatedAt" TIMESTAMP(3),
    "notifyStatuses" "OrderStatus"[] DEFAULT ARRAY[]::"OrderStatus"[],
    "notificationChannel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "defaultLanguage" TEXT NOT NULL DEFAULT 'fr',
    "messageTemplates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTrackingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'UNMAPPED',
    "rawStatus" TEXT NOT NULL,
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerLanguage" TEXT,
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "trackingUrl" TEXT,
    "items" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreStatusMapping" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "externalStatus" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreStatusMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationJobStatus" NOT NULL DEFAULT 'PENDING',
    "orderStatus" "OrderStatus" NOT NULL,
    "recipient" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "eventId" TEXT,
    "externalOrderId" TEXT,
    "rawStatus" TEXT,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "error" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderTrackingConfig_vendorId_key" ON "OrderTrackingConfig"("vendorId");

-- CreateIndex
CREATE INDEX "Order_vendorId_status_idx" ON "Order"("vendorId", "status");

-- CreateIndex
CREATE INDEX "Order_vendorId_updatedAt_idx" ON "Order"("vendorId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Order_vendorId_externalId_key" ON "Order"("vendorId", "externalId");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_orderId_occurredAt_idx" ON "OrderStatusEvent"("orderId", "occurredAt");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_vendorId_status_idx" ON "OrderStatusEvent"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderStatusEvent_vendorId_eventId_key" ON "OrderStatusEvent"("vendorId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreStatusMapping_vendorId_normalizedKey_key" ON "StoreStatusMapping"("vendorId", "normalizedKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationJob_eventId_key" ON "NotificationJob"("eventId");

-- CreateIndex
CREATE INDEX "NotificationJob_status_nextAttemptAt_idx" ON "NotificationJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationJob_vendorId_createdAt_idx" ON "NotificationJob"("vendorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WebhookLog_vendorId_receivedAt_idx" ON "WebhookLog"("vendorId", "receivedAt" DESC);

-- AddForeignKey
ALTER TABLE "OrderTrackingConfig" ADD CONSTRAINT "OrderTrackingConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreStatusMapping" ADD CONSTRAINT "StoreStatusMapping_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OrderStatusEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
