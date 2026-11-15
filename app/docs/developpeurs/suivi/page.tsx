import type { Metadata } from 'next'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { TrackingDeveloperDocs } from '@/components/docs/TrackingDeveloperDocs'

export const metadata: Metadata = {
  title: 'Suivi des commandes — documentation développeur | Flowmerce',
  description:
    "Référence technique du suivi des commandes Flowmerce : webhook signé, polling, connecteurs, format d'un événement, statuts et codes d'erreur.",
}

// Coquille serveur, comme la documentation des retours : le contenu est un
// Client Component (choix du mode, sélecteur de langage), l'en-tête a besoin
// de `auth()` côté serveur.
export default function DocsDeveloperTrackingPage() {
  return (
    <div className="min-h-dvh bg-page text-ink font-sans">
      <SiteHeader />
      <TrackingDeveloperDocs />
      <SiteFooter />
    </div>
  )
}
