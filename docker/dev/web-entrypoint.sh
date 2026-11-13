#!/bin/sh
# Démarrage du conteneur `web` (développement local).
#   1. installe les dépendances si package-lock.json a changé ;
#   2. applique les migrations Prisma sur la base LOCALE (service `db`) ;
#   3. lance `next dev`, joignable depuis le poste sur http://localhost:3000.
set -eu

cd /app

# Garde-fou : ce conteneur ne doit jamais parler à une base distante.
case "${DATABASE_URL:-}" in
  *@db:5432/*) ;;
  *) echo "[web] DATABASE_URL ne pointe pas vers la base locale (db:5432) — arrêt." >&2; exit 1 ;;
esac

LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ ! -f node_modules/.lock-hash ] || [ "$(cat node_modules/.lock-hash)" != "$LOCK_HASH" ]; then
  echo "[web] package-lock.json a changé : installation des dépendances…"
  # node_modules est un volume Docker : on vide son contenu sans supprimer
  # le point de montage lui-même.
  find node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
  npm ci --no-audit --no-fund
  echo "$LOCK_HASH" > node_modules/.lock-hash
else
  # Le schéma Prisma a pu changer sans que les dépendances changent.
  npx prisma generate >/dev/null
fi

echo "[web] Migrations Prisma sur la base locale…"
npx prisma migrate deploy

echo "[web] Démarrage de Next.js → http://localhost:3000"
# --webpack : sur un code monté depuis Windows, Turbopack ne voit pas les
# modifications de fichiers existants (même en scrutation), et sert l'ancienne
# version. Webpack + WATCHPACK_POLLING (docker-compose.dev.yml) les voit.
exec npm run dev -- --webpack --hostname 0.0.0.0 --port 3000
