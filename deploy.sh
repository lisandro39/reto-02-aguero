#!/usr/bin/env bash
# Despliegue en el VPS: actualiza código, instala, prueba y reinicia el proceso aislado "reto2".
set -euo pipefail
cd "$(dirname "$0")"
BUN="$HOME/.bun/bin/bun"

git pull --ff-only
"$BUN" install --frozen-lockfile
"$BUN" test

if pm2 describe reto2 > /dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

PUERTO="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${PUERTO:-3020}/api/health"; then echo; exit 0; fi
  sleep 1
done
echo "El servicio no respondió; revisa: pm2 logs reto2 --lines 50 --nostream"
exit 1
