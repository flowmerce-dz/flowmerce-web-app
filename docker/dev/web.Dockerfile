# ═══════════════════════════════════════════════════════════════
#  Flowmerce — image de DÉVELOPPEMENT (docker-compose.dev.yml)
#
#  Ne contient pas le code : il est monté depuis le poste, ce qui donne le
#  rechargement à chaud. Les dépendances sont installées au démarrage par
#  web-entrypoint.sh dans un volume dédié. Pour l'image de production,
#  voir le Dockerfile à la racine.
# ═══════════════════════════════════════════════════════════════
FROM node:24-bookworm-slim

# openssl : requis par les binaires Prisma (migrate, generate).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["sh", "/app/docker/dev/web-entrypoint.sh"]
