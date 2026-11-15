import { getSessionServer } from "@/lib/getSession";
/**
 * vendorGuard.ts
 *
 * Appeler cette fonction en haut de chaque sous-page dashboard (Server Component).
 * Si le compte vendeur est bloqué (PENDING, DOCUMENTS_REQUESTED, ou SUSPENDU),
 * l'utilisateur est redirigé vers /dashboard qui affiche le banner d'erreur.
 *
 * `service` : la page appartient à un service (Retours-ML ou suivi des
 * commandes). Si la boutique ne l'a pas activé, l'utilisateur est renvoyé vers
 * /dashboard/services, où il peut l'activer. Sans cette option, seul le statut
 * du compte est contrôlé — comportement inchangé.
 */


import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { isServiceEnabled, type ServiceKey } from "@/lib/services/vendor-services";

export async function checkVendorAccess({ service }: { service?: ServiceKey } = {}) {
  const session = await getSessionServer();
  if (!session) redirect("/auth/login");

  const user = session.user;

  const vendor = await prisma.vendor.findUnique({
    where: { userId: user.id },
    select: {
      status: true,
      rejectionReason: true,
      returnsMLEnabled: true,
      orderTrackingEnabled: true,
    },
  });

  // ADMIN sans Vendor → redirection vers /dashboard (qui gère l'affichage)
  if (!vendor && user?.role === "ADMIN") redirect("/dashboard");

  // VENDOR sans profil → créer son profil
  if (!vendor) redirect("/auth/register");

  // Un service désactivé l'est pour tout le monde, administrateur compris :
  // c'est un réglage de la boutique, pas un statut de compte.
  const serviceDisabled = service !== undefined && !isServiceEnabled(vendor, service);

  // ADMIN avec Vendor : accès complet quel que soit le statut
  if (user?.role === "ADMIN") {
    if (serviceDisabled) redirect("/dashboard/services");
    return;
  }

  const isSuspended =
    vendor.status === "REJECTED" &&
    (vendor.rejectionReason?.startsWith("[SUSPENDU]") ?? false);

  const isBlocked =
    isSuspended ||
    vendor.status === "PENDING" ||
    vendor.status === "DOCUMENTS_REQUESTED";

  if (isBlocked) {
    redirect("/dashboard");
  }

  if (serviceDisabled) redirect("/dashboard/services");
}
