"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  FileText,
  Inbox,
  Key,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SITE_LINKS } from "@/components/layout/siteLinks";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

// La navigation suit les services activés par la boutique. Les liens marqués
// `service: "returnsML"` n'apparaissent que si Retours-ML est activé. Ceux du
// suivi restent toujours visibles : sa page sert aussi à l'activer.
type NavService = "returnsML";

const NAV_LINKS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Tableau de bord",
    sublabel: "Vue d’ensemble",
    Icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/dashboard/return-policy",
    label: "Politique de retour",
    sublabel: "Vos règles",
    Icon: FileText,
    exact: false,
    service: "returnsML",
  },
  {
    href: "/dashboard/claims",
    label: "Réclamations",
    sublabel: "Demandes clients",
    Icon: Inbox,
    exact: false,
    service: "returnsML",
  },
];

const INTEGRATION_LINKS: NavItem[] = [
  {
    href: "/dashboard/api-keys",
    label: "Clés API",
    sublabel: "Intégration et accès",
    Icon: Key,
    exact: false,
  },
  {
    href: "/dashboard/order-tracking",
    label: "Suivi des commandes",
    sublabel: "Statuts et notifications",
    Icon: Truck,
    exact: false,
  },
  {
    href: "/dashboard/services",
    label: "Services",
    sublabel: "Activer ou désactiver",
    Icon: SlidersHorizontal,
    exact: false,
  },
];

const ANALYTICS_LINKS: NavItem[] = [
  {
    href: "/dashboard/analytics/products",
    label: "Retours produits",
    sublabel: "Motifs et problèmes récurrents",
    Icon: BarChart3,
    exact: false,
    service: "returnsML",
  },
  {
    href: "/dashboard/analytics/returns",
    label: "Détail des retours",
    sublabel: "Par produit, motif ou client",
    Icon: Table2,
    exact: false,
    service: "returnsML",
  },
];

type NavItem = {
  href: string;
  label: string;
  sublabel: string;
  Icon: LucideIcon;
  exact: boolean;
  service?: NavService;
};

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { href, label, sublabel, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2.5 rounded-control px-3 py-2 transition-colors ${FOCUS} ${
        active ? "bg-brand-soft text-brand-ink" : "text-body hover:bg-page hover:text-ink"
      }`}
    >
      <span
        aria-hidden
        className={`flex size-6 shrink-0 items-center justify-center rounded-control transition-colors ${
          active ? "bg-brand text-on-brand" : "bg-page text-body group-hover:bg-line"
        }`}
      >
        <Icon size={13} strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span
          className={`block text-[13px] leading-none ${active ? "font-semibold" : "font-medium"}`}
        >
          {label}
        </span>
        <span className="mt-1 block text-[10.5px] leading-none text-faint">{sublabel}</span>
      </span>
    </Link>
  );
}

export function DashboardNav({
  isAdmin,
  services = { returnsML: true },
}: {
  isAdmin: boolean;
  /** Services activés par la boutique. Défaut : la navigation d'origine. */
  services?: Record<NavService, boolean>;
}) {
  const pathname = usePathname();

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  const visible = (items: NavItem[]) =>
    items.filter((item) => !item.service || services[item.service]);

  const analyticsLinks = visible(ANALYTICS_LINKS);

  return (
    <nav aria-label="Navigation principale" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
        Menu
      </p>

      {visible(NAV_LINKS).map((item) => (
        <NavLink key={item.href} item={item} active={isActive(item.href, item.exact)} />
      ))}

      <p className="mb-2 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
        Intégration
      </p>

      {INTEGRATION_LINKS.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(item.href, item.exact)} />
      ))}

      {analyticsLinks.length > 0 && (
        <>
          <p className="mb-2 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
            Analyses et statistiques
          </p>

          {analyticsLinks.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href, item.exact)} />
          ))}
        </>
      )}

      {isAdmin && (
        <>
          <div className="my-2 border-t border-line" />
          <Link
            href="/admin/vendors"
            className={`group flex items-center gap-2.5 rounded-control px-3 py-2 text-body transition-colors hover:bg-amber-50 hover:text-amber-800 ${FOCUS}`}
          >
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-control bg-page text-body transition-colors group-hover:bg-amber-100 group-hover:text-amber-700"
            >
              <ShieldCheck size={13} strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-none">Panel admin</span>
              <span className="mt-1 block text-[10.5px] leading-none text-faint">
                Gestion des vendeurs
              </span>
            </span>
          </Link>
        </>
      )}

      {/* `mt-auto` colle la section au bas de la nav quand le menu est plus court
          que la colonne ; la marge s'annule d'elle-même dès que ça déborde, donc
          les liens restent atteignables au défilement. Pas d'état actif : ces
          pages ne rendent pas le sidebar, et `href="/"` matcherait tout. */}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">
        <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
          Site
        </p>

        {SITE_LINKS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`group flex items-center gap-2.5 rounded-control px-3 py-2 text-body transition-colors hover:bg-page hover:text-ink ${FOCUS}`}
          >
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-control bg-page text-body transition-colors group-hover:bg-line"
            >
              <Icon size={13} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 truncate text-[13px] font-medium leading-none">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
