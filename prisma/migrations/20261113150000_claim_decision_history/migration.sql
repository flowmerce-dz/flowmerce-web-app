-- Historique des décisions des réclamations, en ajout seul (audit RedStone RS-01).

-- CreateTable
CREATE TABLE "ClaimDecisionEvent" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "previousStatus" "ClaimStatus",
    "newStatus" "ClaimStatus" NOT NULL,
    "previousDecision" TEXT,
    "newDecision" TEXT,
    "actorType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimDecisionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimDecisionEvent_claimId_createdAt_idx" ON "ClaimDecisionEvent"("claimId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClaimDecisionEvent" ADD CONSTRAINT "ClaimDecisionEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ajout seul : une ligne d'historique n'est jamais réécrite, quel que soit le
-- client SQL. La suppression reste permise pour la cascade depuis "Claim".
CREATE FUNCTION "claim_decision_event_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ClaimDecisionEvent est en ajout seul : modification interdite';
END;
$$;

CREATE TRIGGER "claim_decision_event_no_update"
BEFORE UPDATE ON "ClaimDecisionEvent"
FOR EACH ROW EXECUTE FUNCTION "claim_decision_event_immutable"();
