-- Statuts de commande déclarés par chaque boutique (PUT /api/v1/order-statuses).
--
-- Additive : deux colonnes sur "OrderTrackingConfig". Une liste vide signifie
-- que la boutique n'a rien déclaré — le tableau de bord propose alors tous les
-- statuts standards, comme avant.

-- AlterTable
ALTER TABLE "OrderTrackingConfig" ADD COLUMN     "storeStatuses" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "storeStatusesDeclaredAt" TIMESTAMP(3);
