-- Suivi des commandes : trois modes d'intégration (webhook, polling, connecteur).
-- Ajouts uniquement. Les boutiques existantes restent en mode WEBHOOK.

-- CreateEnum
CREATE TYPE "TrackingIntegrationMode" AS ENUM ('WEBHOOK', 'POLLING', 'CONNECTOR');

-- AlterTable
ALTER TABLE "OrderTrackingConfig" ADD COLUMN     "connectorCredentialsEnc" TEXT,
ADD COLUMN     "connectorId" TEXT,
ADD COLUMN     "integrationMode" "TrackingIntegrationMode" NOT NULL DEFAULT 'WEBHOOK',
ADD COLUMN     "pollingTokenEnc" TEXT,
ADD COLUMN     "pollingUrl" TEXT,
ADD COLUMN     "pullCursor" TEXT,
ADD COLUMN     "pullLastError" TEXT,
ADD COLUMN     "pullLastEvents" INTEGER,
ADD COLUMN     "pullLastOk" BOOLEAN,
ADD COLUMN     "pullLastRunAt" TIMESTAMP(3),
ADD COLUMN     "pullLockedAt" TIMESTAMP(3),
ADD COLUMN     "pullStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WebhookLog" ADD COLUMN     "source" "TrackingIntegrationMode" NOT NULL DEFAULT 'WEBHOOK';
