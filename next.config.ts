import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Build Docker uniquement : produit .next/standalone (serveur Node autonome).
  // Les builds Vercel et Capacitor conservent le comportement par défaut.
  output: process.env.DOCKER_BUILD === "true" ? "standalone" : undefined,

  // Réservé au build Capacitor, qui sert des fichiers depuis le système de
  // fichiers de l'appareil et a besoin des slashs finaux.
  //
  // Il était actif partout, y compris sur le web : `POST /api/v1/returns`
  // répondait alors un 308 vers `/api/v1/returns/`. Les clients HTTP qui
  // suivent les redirections s'en accommodaient, mais pas `curl` sans `-L` —
  // c'est-à-dire l'exemple d'intégration de notre propre documentation, qui ne
  // soumettait donc rien du tout.
  trailingSlash: process.env.MOBILE_BUILD === "true",
  images: {
    unoptimized: process.env.MOBILE_BUILD === "true", 
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
  },
  // RS-05 — ne pas annoncer le framework (`X-Powered-By: Next.js`).
  poweredByHeader: false,

  // En-têtes de sécurité (CSP, cache des API, HSTS…) : lib/security-headers.ts.
  async headers() {
    return securityHeaders({
      dev:     process.env.NODE_ENV !== "production",
      preview: process.env.VERCEL_ENV === "preview",
    });
  },
};

export default nextConfig;