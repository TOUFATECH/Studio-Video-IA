#!/usr/bin/env bash
# Teste les migrations et la sécurité de la base sur un PostgreSQL local jetable (imitation minimale de Supabase).
# Usage : bash supabase/tests/lancer.sh   (nécessite PostgreSQL 15+ : initdb, pg_ctl, psql dans le PATH ou PG_BIN)
set -euo pipefail

ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | tail -1)")}"
TMP="$(mktemp -d)"
PORT="${PORT:-54329}"
# Masque les NOTICE de PostgreSQL (« … does not exist, skipping ») : seuls les avertissements et erreurs restent.
export PGOPTIONS="-c client_min_messages=warning"

# Arrête le serveur et efface le dossier temporaire, même en cas d'échec.
nettoyer() { "$PG_BIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap nettoyer EXIT

"$PG_BIN/initdb" -D "$TMP/data" -U postgres >/dev/null 2>&1
"$PG_BIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -p $PORT -c listen_addresses=" -l "$TMP/log" start >/dev/null
sleep 2
PSQL=(psql -q -h "$TMP" -p "$PORT" -U postgres)
"${PSQL[@]}" -c "create database essai" >/dev/null

echo "== Migrations (deux fois, pour vérifier qu'elles se rejouent sans erreur)"
"${PSQL[@]}" -d essai -v ON_ERROR_STOP=1 -f "$ICI/00_imitation_supabase.sql" >/dev/null 2>&1
for passe in 1 2; do
  for f in "$RACINE"/supabase/migrations/*.sql; do
    "${PSQL[@]}" -d essai -v ON_ERROR_STOP=1 -f "$f" >/dev/null
  done
  echo "   passe $passe : OK"
done

echo "== Sécurité (les lignes « ERROR » attendues sont des refus voulus)"
"${PSQL[@]}" -d essai -f "$ICI/securite.sql" 2>&1 | grep -v '^\s*$'
