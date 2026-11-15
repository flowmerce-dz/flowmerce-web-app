import Link from "next/link";
import { Code2, PackageSearch, Store, Undo2 } from "lucide-react";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

type Audience = "marchand" | "developpeurs";
type Service = "retours" | "suivi";

// La documentation est rangée selon deux axes : le service (les deux sont
// indépendants, une boutique peut n'en utiliser qu'un) et le public. Chaque
// combinaison a sa page.
const PAGES: Record<Service, Record<Audience, string>> = {
  retours: { marchand: "/docs", developpeurs: "/docs/developpeurs" },
  suivi: { marchand: "/docs/suivi", developpeurs: "/docs/developpeurs/suivi" },
};

const SERVICES = [
  { key: "retours", label: "Retours", icon: Undo2 },
  { key: "suivi", label: "Suivi des commandes", icon: PackageSearch },
] as const;

const AUDIENCES = [
  { key: "marchand", label: "Marchand", icon: Store },
  { key: "developpeurs", label: "Développeur", icon: Code2 },
] as const;

function Switch<K extends string>({
  label,
  items,
  current,
  href,
  strong,
}: {
  label: string;
  items: readonly { key: K; label: string; icon: typeof Store }[];
  current: K;
  href: (key: K) => string;
  /** Sélection pleine (service) ou discrète (public). */
  strong: boolean;
}) {
  return (
    <nav
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-1 rounded-control border border-line bg-surface p-1"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.key === current;
        return (
          <Link
            key={item.key}
            href={href(item.key)}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-control px-3.5 py-2 text-[13px] font-semibold transition-colors ${FOCUS} ${
              active
                ? strong
                  ? "bg-brand text-on-brand"
                  : "bg-brand-soft text-brand-ink"
                : "text-body hover:text-ink"
            }`}
          >
            <Icon size={15} strokeWidth={1.75} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Navigation de la documentation : d'abord le service, puis le public. Le
 * marchand qui configure sa boutique n'a pas à traverser des exemples de code,
 * et le développeur n'a pas à relire le mode d'emploi du tableau de bord.
 */
export function DocsTabs({
  active,
  service = "retours",
}: {
  active: Audience;
  service?: Service;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Switch
        label="Service documenté"
        items={SERVICES}
        current={service}
        href={(key) => PAGES[key][active]}
        strong
      />
      <Switch
        label="Public de la documentation"
        items={AUDIENCES}
        current={active}
        href={(key) => PAGES[service][key]}
        strong={false}
      />
    </div>
  );
}
