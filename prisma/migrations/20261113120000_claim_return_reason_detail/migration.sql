-- Sous-raisons des motifs de retour + identification produit pour les analyses.
--
-- Uniquement des ajouts de colonnes nullables : aucune donnée existante n'est
-- modifiée ni supprimée.

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "fraudAdjustment" JSONB,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "productKey" TEXT,
ADD COLUMN     "returnReason" TEXT,
ADD COLUMN     "returnReasonComment" TEXT,
ADD COLUMN     "returnReasonDetail" TEXT;

-- CreateIndex
CREATE INDEX "Claim_vendorId_productKey_idx" ON "Claim"("vendorId", "productKey");

-- ── Reprise de l'historique ─────────────────────────────────────────────────
-- Motif principal des réclamations existantes : la valeur RÉELLE déjà connue,
-- celle envoyée au ML (`mlInput.Return_Reason`), ou à défaut celle inscrite
-- dans la description (« … — Motif : X — Détails : … »). Retenue seulement si
-- elle fait partie des 10 motifs de RETURN_REASONS (lib/constants.ts).
-- `returnReasonDetail` reste NULL : aucune sous-raison n'est inventée.
UPDATE "Claim" AS c
SET "returnReason" = src.reason
FROM (
  SELECT id,
         btrim(COALESCE(
           NULLIF(btrim("mlInput"->>'Return_Reason'), ''),
           substring(description FROM 'Motif : (.*?)(?: — Détails : |$)')
         )) AS reason
  FROM "Claim"
) AS src
WHERE c.id = src.id
  AND c."returnReason" IS NULL
  AND src.reason IN (
    'Produit défectueux',
    'Produit contrefait',
    'Produit endommagé livraison',
    'Changement d''avis',
    'Panne après utilisation',
    'Mauvaise taille',
    'Allergie/Réaction',
    'Ne correspond pas',
    'Erreur de commande vendeur',
    'Pièces manquantes'
  );

-- Clé de regroupement produit : aucun productId n'était conservé jusqu'ici,
-- on retombe donc sur le nom normalisé — même règle que productKey() dans
-- lib/services/product-issues.ts (espaces réduits, minuscules).
UPDATE "Claim"
SET "productKey" = 'name:' || lower(regexp_replace(btrim("productName"), '\s+', ' ', 'g'))
WHERE "productKey" IS NULL
  AND "productName" IS NOT NULL
  AND btrim("productName") <> '';
