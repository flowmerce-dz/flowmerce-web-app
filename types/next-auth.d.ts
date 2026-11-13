import "next-auth";
import "next-auth/jwt";

// Le statut du vendeur (PENDING, APPROVED…) n'est volontairement PAS dans la
// session : figé dans le jeton à la connexion, il devenait faux dès que l'admin
// approuvait ou suspendait le compte (audit RedStone RS-06). Il se lit en base,
// au moment où il sert (lib/vendorGuard.ts, /api/vendors/me).

declare module "next-auth" {
  interface User {
    role: string;
    vendorId: string | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      vendorId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: string;
    vendorId: string | null;
  }
}