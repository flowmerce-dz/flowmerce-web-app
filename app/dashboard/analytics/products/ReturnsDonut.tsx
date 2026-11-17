'use client'

// app/dashboard/analytics/products/ReturnsDonut.tsx — Flowmerce
//
// Part de chaque produit dans les retours : les produits les plus retournés,
// puis « Autres produits ».
//
// Couleurs : le tableau de bord n'a qu'un accent (l'indigo de marque, cf.
// components/dashboard/ui.tsx). Les parts sont donc des nuances d'indigo, du
// plus foncé (le plus retourné) au plus clair, validées comme rampe ordinale
// (luminosité monotone, écarts visibles, extrémité claire ≥ 2:1 sur le blanc).
// « Autres » est un gris neutre. Une nuance seule ne suffit pas à identifier
// une part : la légende écrit le nom, le nombre et le pourcentage de chacune.

import { useState } from 'react'

export const RANK_COLORS = ['#312e81', '#4f46e5', '#818cf8', '#9fa8fa'] as const
export const OTHER_COLOR = '#c3c9d8'

export function segmentColor(rank: number | null): string {
  return rank !== null && rank <= RANK_COLORS.length ? RANK_COLORS[rank - 1] : OTHER_COLOR
}

export interface DonutSegment {
  key:   string
  label: string
  count: number
  share: number
  rank:  number | null
}

const SIZE      = 200
const CENTER    = SIZE / 2
const OUTER     = 96
const THICKNESS = 26
const INNER     = OUTER - THICKNESS

const pct = (share: number) => `${Math.round(share * 100)} %`

// Arrondi au centième : Math.cos/sin peuvent différer au dernier chiffre entre
// Node (rendu serveur) et le navigateur, ce qui casse l'hydratation.
const round = (n: number) => Math.round(n * 100) / 100

function point(radius: number, angle: number): string {
  return `${round(CENTER + radius * Math.cos(angle))} ${round(CENTER + radius * Math.sin(angle))}`
}

/** Secteur d'anneau entre deux angles (radians, 0 = 3 h, sens horaire). */
function arcPath(start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0
  return [
    `M ${point(OUTER, start)}`,
    `A ${OUTER} ${OUTER} 0 ${large} 1 ${point(OUTER, end)}`,
    `L ${point(INNER, end)}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${point(INNER, start)}`,
    'Z',
  ].join(' ')
}

export function ReturnsDonut({
  segments,
  total,
}: {
  segments: DonutSegment[]
  /** Retours représentés par le cercle (produit identifié). */
  total:    number
}) {
  const [active, setActive] = useState<string | null>(null)
  const hovered = segments.find(s => s.key === active) ?? null

  // Angles cumulés, en partant de midi.
  let cursor = -Math.PI / 2
  const arcs = segments.map(s => {
    const start = cursor
    cursor += s.share * 2 * Math.PI
    return { ...s, start, end: cursor }
  })

  return (
    <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`Répartition des retours par produit : ${segments
            .map(s => `${s.label} ${pct(s.share)}`)
            .join(', ')}`}
          onMouseLeave={() => setActive(null)}
        >
          {arcs.length === 1 ? (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={OUTER - THICKNESS / 2}
              fill="none"
              stroke={segmentColor(arcs[0].rank)}
              strokeWidth={THICKNESS}
              onMouseEnter={() => setActive(arcs[0].key)}
            />
          ) : (
            arcs.map(a => (
              <path
                key={a.key}
                d={arcPath(a.start, a.end)}
                fill={segmentColor(a.rank)}
                // Liseré de la couleur du fond : sépare deux parts voisines.
                stroke="#ffffff"
                strokeWidth={2}
                strokeLinejoin="round"
                opacity={active && active !== a.key ? 0.35 : 1}
                className="cursor-default transition-opacity"
                onMouseEnter={() => setActive(a.key)}
              />
            ))
          )}
        </svg>

        {/* Centre : total, ou la part survolée. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
          {hovered ? (
            <>
              <span className="text-[22px] font-bold leading-none tabular-nums text-ink">{pct(hovered.share)}</span>
              <span className="mt-1.5 line-clamp-2 text-[11px] leading-tight text-body">{hovered.label}</span>
              <span className="mt-0.5 text-[11px] tabular-nums text-faint">
                {hovered.count} retour{hovered.count > 1 ? 's' : ''}
              </span>
            </>
          ) : (
            <>
              <span className="text-[26px] font-bold leading-none tabular-nums text-ink">{total}</span>
              <span className="mt-1.5 text-[11px] text-body">retour{total > 1 ? 's' : ''}</span>
            </>
          )}
        </div>
      </div>

      <ul className="m-0 w-full min-w-0 list-none space-y-1 p-0">
        {segments.map(s => (
          <li
            key={s.key}
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
            className={`flex items-center gap-3 rounded-control px-2 py-1.5 transition-colors ${
              active === s.key ? 'bg-page' : ''
            }`}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: segmentColor(s.rank) }}
            />
            <span className={`min-w-0 flex-1 truncate text-[13px] ${s.rank === null ? 'text-body' : 'font-medium text-ink'}`}>
              {s.label}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-faint">
              {s.count}
            </span>
            <span className="w-11 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink">
              {pct(s.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
