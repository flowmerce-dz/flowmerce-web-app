import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { DocsTabs } from "@/components/docs/DocsTabs";
import {
  Bell,
  Code2,
  FlaskConical,
  ListChecks,
  MessageSquareText,
  Plug,
  Power,
  RefreshCw,
  Route,
  ScrollText,
  Send,
  Webhook,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Suivi des commandes — documentation marchand | Flowmerce",
  description:
    "Prévenir vos clients à chaque étape de leur commande : activer le suivi, choisir entre webhook, polling et connecteur, régler les statuts et les messages.",
};

const STROKE = 1.75;

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

// Les trois modes d'intégration, dans les mots du marchand. La référence
// technique de chacun est dans la documentation développeur.
const MODES = [
  {
    icon: Webhook,
    title: "Webhook",
    tag: "Le plus rapide",
    body: "Votre boutique prévient Flowmerce à l’instant où une commande change de statut. Le client est informé dans la foulée.",
    need: "Un développeur, une seule fois, pour envoyer les changements depuis votre boutique.",
  },
  {
    icon: RefreshCw,
    title: "Polling",
    tag: "Si votre boutique a déjà une API",
    body: "Flowmerce vient lire lui-même les changements dans votre boutique, à intervalle régulier. Le client est informé au passage suivant.",
    need: "Une adresse de votre boutique qui liste les commandes modifiées, et son jeton d’accès.",
  },
  {
    icon: Plug,
    title: "Connecteur",
    tag: "Bientôt disponible",
    body: "Flowmerce lit les statuts chez un service que vous utilisez déjà : votre société de livraison ou votre plateforme e-commerce.",
    need: "Vos identifiants chez ce service. Aucun développement.",
  },
];

// Chaque étape correspond à un écran réel du tableau de bord.
const STEPS = [
  {
    icon: Power,
    title: "Activez le service",
    time: "un clic",
    body: "Le suivi des commandes s’active séparément des retours. Tant qu’il est désactivé, vous pouvez tout régler, mais aucun changement de statut n’est pris en compte.",
    link: { label: "Ouvrir les services", href: "/dashboard/services" },
  },
  {
    icon: Route,
    title: "Choisissez le mode d’intégration",
    time: "un seul actif à la fois",
    body: "Webhook, polling ou connecteur. Vous pouvez consulter et préparer chaque mode avant de l’utiliser ; changer de mode coupe la source précédente, pour qu’un même changement ne soit jamais annoncé deux fois.",
    link: { label: "Ouvrir le suivi des commandes", href: "/dashboard/order-tracking" },
  },
  {
    icon: Code2,
    title: "Donnez les accès à votre développeur",
    time: "à faire une fois",
    body: "En webhook : votre clé API et le secret de signature, affiché une seule fois à sa génération. En polling : c’est l’inverse, votre développeur vous donne l’adresse à interroger et son jeton, que vous collez dans le tableau de bord.",
    link: { label: "La page à lui transmettre", href: "/docs/developpeurs/suivi" },
  },
  {
    icon: ListChecks,
    title: "Vérifiez vos statuts",
    time: "automatique dans la plupart des cas",
    body: "Flowmerce reconnaît d’office les libellés courants : « Expédiée », « Livrée », « Annulée »… Un statut propre à votre boutique apparaît avec la mention « À associer » : indiquez à quel statut standard il correspond. Tant qu’il n’est pas associé, il ne déclenche aucun message.",
  },
  {
    icon: Bell,
    title: "Choisissez quand prévenir le client",
    time: "statut par statut",
    body: "Cochez les statuts qui méritent un message : par exemple l’expédition et la livraison, mais pas la préparation. Les messages partent par e-mail, en français ou en arabe selon la langue du client.",
  },
  {
    icon: MessageSquareText,
    title: "Personnalisez les messages",
    time: "facultatif",
    body: "Chaque statut a un message par défaut dans les deux langues. Vous pouvez réécrire l’objet et le texte, et y insérer le nom du client, le numéro de commande, le transporteur ou le lien de suivi.",
  },
  {
    icon: FlaskConical,
    title: "Testez avant d’ouvrir",
    time: "sans toucher à vos clients",
    body: "En webhook, le bouton de test envoie un événement fictif : aucune commande n’est créée et aucun client n’est prévenu. En polling, « Synchroniser maintenant » vérifie immédiatement que Flowmerce arrive à lire votre boutique.",
  },
];

const DAILY = [
  {
    icon: ScrollText,
    title: "Tout est tracé",
    body: "Le journal liste chaque changement reçu, accepté ou refusé, avec la raison. C’est le premier endroit où regarder si un client dit ne rien avoir reçu.",
  },
  {
    icon: Send,
    title: "Les envois sont relancés",
    body: "Un message qui n’a pas pu partir est réessayé automatiquement, jusqu’à cinq fois. Son état reste visible dans l’historique des notifications.",
  },
  {
    icon: ListChecks,
    title: "Un nouveau statut est signalé",
    body: "Si votre boutique envoie un statut que Flowmerce ne connaît pas, il est conservé et vous est présenté pour être associé. Rien n’est perdu.",
  },
];

const GUARANTEES = [
  "Un même changement de statut n’est jamais annoncé deux fois au client, même si votre boutique l’envoie plusieurs fois.",
  "Un changement arrivé en retard n’écrase pas un statut plus récent : une commande livrée ne redevient pas « expédiée ».",
  "Quand vous branchez le polling ou un connecteur, l’historique de votre boutique n’est pas renvoyé à vos clients : seuls les changements à venir sont annoncés.",
  "Le suivi et les retours sont indépendants : désactiver l’un ne change rien à l’autre.",
];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-line bg-surface p-5 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

export default function DocsMerchantTrackingPage() {
  return (
    <div className="min-h-dvh bg-page text-ink font-sans">
      <SiteHeader />

      <section className="px-4 sm:px-6 pt-28 pb-10 sm:pt-32">
        <div className="max-w-4xl mx-auto">
          <DocsTabs active="marchand" service="suivi" />
          <h1 className="mt-8 text-4xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05] text-ink">
            Prévenir vos clients,
            <br />
            <span className="text-brand-ink">à chaque étape de la commande.</span>
          </h1>
          <p className="mt-5 text-[15px] text-body leading-relaxed max-w-xl">
            Flowmerce suit le statut de vos commandes et envoie le message au client à
            votre place. Le service fonctionne seul : vous n’avez pas besoin d’utiliser
            les retours pour l’activer.
          </p>
        </div>
      </section>

      <main className="px-4 sm:px-6 pb-16 sm:pb-24">
        <div className="max-w-4xl mx-auto space-y-16">

          {/* Les trois modes */}
          <section>
            <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-ink mb-2">
              Trois façons de brancher votre boutique
            </h2>
            <p className="text-[15px] text-body leading-relaxed mb-6 max-w-2xl">
              La seule différence entre elles est la manière dont Flowmerce apprend
              qu’une commande a changé de statut. Tout le reste — vos statuts, vos
              messages, le journal — se règle de la même façon.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <Card key={m.title}>
                    <Icon size={18} strokeWidth={STROKE} className="text-brand-ink mb-3" aria-hidden />
                    <h3 className="text-sm font-bold text-ink">{m.title}</h3>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                      {m.tag}
                    </p>
                    <p className="mt-3 text-[13px] text-body leading-relaxed">{m.body}</p>
                    <p className="mt-3 text-[13px] text-body leading-relaxed">
                      <span className="font-semibold text-ink">Ce qu’il faut : </span>
                      {m.need}
                    </p>
                  </Card>
                );
              })}
            </div>

            <p className="mt-4 text-[13px] text-faint leading-relaxed max-w-2xl">
              Dans le doute, choisissez le webhook : c’est le mode où le client est
              prévenu le plus vite. Le polling convient quand votre boutique ne peut
              pas envoyer de requêtes elle-même.
            </p>
          </section>

          {/* Qui fait quoi */}
          <section>
            <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-ink mb-6">
              Qui fait quoi
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <h3 className="text-sm font-bold text-ink mb-3">Vous, depuis le tableau de bord</h3>
                <ul className="space-y-2 text-[13px] text-body list-none p-0">
                  {[
                    "Activer le suivi des commandes",
                    "Choisir le mode d’intégration",
                    "Associer les statuts de votre boutique",
                    "Choisir les statuts qui préviennent le client",
                    "Écrire vos messages",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <span aria-hidden className="text-brand-ink">•</span>
                      {t}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="bg-brand-soft border-brand/20">
                <h3 className="text-sm font-bold text-ink mb-3">
                  Votre développeur, une seule fois
                </h3>
                <ul className="space-y-2 text-[13px] text-body list-none p-0">
                  {[
                    "En webhook : envoyer chaque changement de statut à Flowmerce",
                    "En polling : exposer l’adresse que Flowmerce interroge",
                    "Déclarer la liste des statuts de votre boutique",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <span aria-hidden className="text-brand-ink">•</span>
                      {t}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/docs/developpeurs/suivi"
                  className={`mt-4 inline-flex items-center gap-2 text-[13px] font-semibold text-brand-ink hover:underline rounded-control ${FOCUS}`}
                >
                  <Code2 size={15} strokeWidth={STROKE} aria-hidden />
                  La page à lui transmettre
                </Link>
              </Card>
            </div>
          </section>

          {/* Les étapes */}
          <section>
            <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-ink mb-6">
              La mise en place, étape par étape
            </h2>

            <ol className="space-y-3 list-none p-0">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <li key={s.title}>
                    <Card>
                      <div className="flex gap-4">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand-ink">
                          <Icon size={18} strokeWidth={STROKE} aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <h3 className="text-[15px] font-bold text-ink">
                              <span className="text-faint tabular-nums">
                                {String(i + 1).padStart(2, "0")}
                              </span>{" "}
                              {s.title}
                            </h3>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                              {s.time}
                            </span>
                          </div>
                          <p className="mt-2 text-[14px] text-body leading-relaxed">{s.body}</p>
                          {s.link && (
                            <Link
                              href={s.link.href}
                              className={`mt-3 inline-flex text-[13px] font-semibold text-brand-ink hover:underline rounded-control ${FOCUS}`}
                            >
                              {s.link.label}
                            </Link>
                          )}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Au quotidien */}
          <section>
            <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-ink mb-2">
              Une fois en place
            </h2>
            <p className="text-[15px] text-body leading-relaxed mb-6 max-w-2xl">
              Vous n’avez plus rien à faire : les messages partent seuls. Le tableau de
              bord sert à vérifier.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              {DAILY.map((d) => {
                const Icon = d.icon;
                return (
                  <Card key={d.title}>
                    <Icon size={18} strokeWidth={STROKE} className="text-brand-ink mb-3" aria-hidden />
                    <h3 className="text-sm font-bold text-ink mb-2">{d.title}</h3>
                    <p className="text-[13px] text-body leading-relaxed">{d.body}</p>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* Garanties */}
          <section>
            <Card className="border-brand/30">
              <h2 className="text-[15px] font-bold text-ink mb-3">
                Ce que Flowmerce garantit, quel que soit le mode
              </h2>
              <ul className="space-y-2 text-[14px] text-body leading-relaxed list-none p-0 max-w-2xl">
                {GUARANTEES.map((g) => (
                  <li key={g} className="flex gap-2">
                    <span aria-hidden className="text-brand-ink">•</span>
                    {g}
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          {/* CTA */}
          <section className="rounded-block bg-deep px-6 py-12 text-center">
            <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-white mb-3">
              Prêt à brancher votre boutique ?
            </h2>
            <p className="text-[14px] text-white/70 leading-relaxed max-w-md mx-auto mb-7">
              Les statuts et les messages se règlent en quelques minutes, avant même
              d’avoir branché quoi que ce soit.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/dashboard/order-tracking"
                className={`inline-flex items-center justify-center rounded-control bg-white px-5 py-3 text-sm font-semibold text-deep transition-[background-color,transform] hover:bg-white/90 active:translate-y-px ${FOCUS}`}
              >
                Ouvrir le suivi des commandes
              </Link>
              <Link
                href="/docs/developpeurs/suivi"
                className={`inline-flex items-center justify-center rounded-control border border-white/30 px-5 py-3 text-sm font-semibold text-white transition-[background-color,transform] hover:bg-white/10 active:translate-y-px ${FOCUS}`}
              >
                Documentation technique
              </Link>
            </div>
          </section>

        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
