#!/bin/sh
# Copie la base distante (Supabase) dans la base locale `db`.
#
#   npm run docker:db:copy
#
# Côté distant : LECTURE SEULE (pg_dump). Côté local : le schéma `public` est
# entièrement remplacé. La copie transite par /tmp de ce conteneur éphémère
# (--rm) : aucun fichier de données ne reste sur le poste.
set -eu

LOCAL_URL="postgresql://flowmerce:flowmerce@db:5432/flowmerce"
DUMP=/tmp/remote.dump

if [ -z "${REMOTE_DATABASE_URL:-}" ]; then
  echo "REMOTE_DATABASE_URL manquant : renseignez-le dans .env.remote.local" >&2
  exit 1
fi

# Garde-fous : la source doit être distante, la cible doit être locale.
case "$REMOTE_DATABASE_URL" in
  *@db:*|*@localhost*|*@127.0.0.1*)
    echo "REMOTE_DATABASE_URL pointe vers une base locale — copie annulée." >&2
    exit 1 ;;
esac

echo "1/3 Lecture de la base distante (lecture seule)…"
pg_dump "$REMOTE_DATABASE_URL" \
  --schema=public --no-owner --no-privileges \
  --format=custom --file="$DUMP"

echo "2/3 Remise à zéro de la base locale…"
psql "$LOCAL_URL" -q -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA IF EXISTS public CASCADE;' \
  -c 'CREATE SCHEMA public;'

echo "3/3 Restauration dans la base locale…"
# Le schéma public vient d'être recréé : on écarte son entrée de la liste
# de restauration pour éviter « schema "public" already exists ».
pg_restore --list "$DUMP" | grep -v ' SCHEMA - public ' > /tmp/restore.list
pg_restore --dbname="$LOCAL_URL" --no-owner --no-privileges \
  --exit-on-error --use-list=/tmp/restore.list "$DUMP"

echo
echo "Copie terminée. Contenu de la base locale :"
psql "$LOCAL_URL" -q -c "
  SELECT 'Utilisateurs' AS table, count(*) FROM \"User\"
  UNION ALL SELECT 'Vendeurs',    count(*) FROM \"Vendor\"
  UNION ALL SELECT 'Réclamations', count(*) FROM \"Claim\";"
