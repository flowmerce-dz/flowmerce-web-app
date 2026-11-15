'use client'

// Pièces communes aux pages de documentation développeur : bloc de code
// copiable, lignes de tableau (champs, erreurs), titre de section ancré.

import { useState } from 'react'

// ── Icons ─────────────────────────────────────────────────────────────────────

export function IconKey() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  )
}

function IconCopy() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function IconCode() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

export function IconLink() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

// ── Code block ────────────────────────────────────────────────────────────────

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="relative group rounded-card overflow-hidden border border-line bg-[#0f1729]">
      {lang && (
        <div className="flex items-center justify-between px-4 py-2 bg-[#16203a] border-b border-white/10">
          <span className="text-xs font-mono text-faint">{lang}</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-faint hover:text-white transition-colors"
          >
            {copied ? <IconCheck /> : <IconCopy />}
            {copied ? 'Copié !' : 'Copier'}
          </button>
        </div>
      )}
      {!lang && (
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 flex items-center gap-1.5 text-xs text-faint hover:text-white transition-colors z-10 opacity-0 group-hover:opacity-100"
        >
          {copied ? <IconCheck /> : <IconCopy />}
          {copied ? 'Copié !' : 'Copier'}
        </button>
      )}
      <pre className="p-4 text-sm text-slate-200 overflow-x-auto leading-relaxed font-mono whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}

// ── Field row ─────────────────────────────────────────────────────────────────

export function FieldRow({
  name, type, required, desc,
}: {
  name: string
  type: string
  required?: boolean
  desc: string
}) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-3 pr-4 align-top w-48">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono text-brand-ink bg-brand-soft px-1.5 py-0.5 rounded">
            {name}
          </code>
          {required && (
            <span className="text-xs font-semibold text-red-500">requis</span>
          )}
        </div>
      </td>
      <td className="py-3 pr-4 align-top w-24">
        <span className="text-xs text-faint font-mono">{type}</span>
      </td>
      <td className="py-3 align-top text-sm text-body">{desc}</td>
    </tr>
  )
}

// ── Error row ─────────────────────────────────────────────────────────────────

export function ErrorRow({ code, status, when, action }: { code: string; status: number; when: string; action: string }) {
  const statusColor =
    status === 400 ? 'bg-orange-100 text-orange-700' :
    status === 401 || status === 403 ? 'bg-red-100 text-red-700' :
    status === 409 ? 'bg-purple-100 text-purple-700' :
    status === 422 ? 'bg-amber-100 text-amber-700' :
    status === 429 ? 'bg-pink-100 text-pink-700' :
    'bg-page text-ink'

  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-3 pr-4 align-top">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${statusColor}`}>{status}</span>
      </td>
      <td className="py-3 pr-4 align-top w-48">
        <code className="text-xs font-mono text-ink">{code}</code>
      </td>
      <td className="py-3 pr-4 align-top text-sm text-body max-w-xs">{when}</td>
      <td className="py-3 align-top text-sm text-body">{action}</td>
    </tr>
  )
}

// ── Section heading with anchor ───────────────────────────────────────────────

export function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-24 text-base font-bold text-ink mb-3 flex items-center gap-2 group">
      {children}
      <a href={`#${id}`} className="opacity-0 group-hover:opacity-100 text-brand-ink transition-opacity">
        <IconLink />
      </a>
    </h3>
  )
}
