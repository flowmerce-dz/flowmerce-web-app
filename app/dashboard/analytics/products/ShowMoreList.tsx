'use client'

// app/dashboard/analytics/products/ShowMoreList.tsx — Flowmerce
//
// Affiche les éléments par tranches : `step` au départ, puis `step` de plus à
// chaque clic. Les éléments sont rendus côté serveur et passés en enfants ; ce
// composant ne fait que choisir combien en montrer.

import { Children, useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { BTN_GHOST } from '@/components/dashboard/ui'

export function ShowMoreList({
  children,
  step,
  noun,
}: {
  children: React.ReactNode
  step:     number
  /** Nom des éléments au singulier et au pluriel (« produit », « produits »). */
  noun:     { one: string; other: string }
}) {
  const items = Children.toArray(children)
  const [shown, setShown] = useState(step)
  // Après un clic, le focus passe au premier élément révélé : sans cela, il
  // resterait sur le bouton, désormais loin sous le contenu ajouté.
  const firstRevealed = useRef<HTMLDivElement>(null)
  const [revealedFrom, setRevealedFrom] = useState<number | null>(null)

  useEffect(() => {
    if (revealedFrom !== null) firstRevealed.current?.focus()
  }, [revealedFrom])

  const remaining = items.length - shown
  const next      = Math.min(step, remaining)

  return (
    <>
      {items.slice(0, shown).map((item, i) => (
        <div
          key={i}
          ref={i === revealedFrom ? firstRevealed : undefined}
          tabIndex={i === revealedFrom ? -1 : undefined}
          className="outline-none"
        >
          {item}
        </div>
      ))}

      {remaining > 0 && (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => {
              setRevealedFrom(shown)
              setShown(shown + step)
            }}
          >
            <ChevronDown size={15} aria-hidden />
            Afficher {next} {next > 1 ? noun.other : noun.one} de plus
          </button>
          <p className="text-[12px] tabular-nums text-faint">
            {shown} sur {items.length} {noun.other} affichés
          </p>
        </div>
      )}
    </>
  )
}
