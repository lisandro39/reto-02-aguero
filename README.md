# Reto 02 · Agente "Registro de Contratos Vigentes"

Agente conversacional que lee el buzón de contratos, extrae los datos, detecta duplicados y otrosíes, archiva en una estructura tipo SharePoint, alimenta el maestro y genera alertas de vencimiento y pólizas. Pide confirmación humana para todo campo dudoso.

- **Link de prueba:** https://reto2.72.60.136.76.sslip.io
- **Código de acceso:** `Periferia-2026`
- **Planteamiento de la solución:** [SOLUCION.md](SOLUCION.md) · **Specs (SDD):** [specs/](specs/)

## Levantar en local (un comando)

Requiere [Bun](https://bun.sh) 1.2 o superior.

```bash
bun install
cp .env.example .env      # completa ANTHROPIC_API_KEY, o usa LLM_PROVIDER=mock para correr sin clave
bun run dev               # front y backend en http://127.0.0.1:3020
```

## Variables de entorno

| Variable | Uso |
|---|---|
| `LLM_PROVIDER` | `anthropic` (por defecto), `gemini` o `mock` |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | Clave del proveedor. Solo en el `.env` del servidor |
| `LLM_MODEL` / `LLM_MODEL_RESPALDO` | Modelo principal y de respaldo (vacío = por defecto) |
| `ACCESS_CODE` | Código para usar el link público |
| `MAX_ITERACIONES`, `MAX_TOKENS_SESION`, `LLM_TIMEOUT_MS`, `RATE_LIMIT_POR_MINUTO` | Topes de costo y robustez |
| `SANDBOX_POR_SESION` | Cada sesión trabaja con su propia copia de los datos |

## Verificación

```bash
bun run demo.ts           # procesa los 6 mensajes sin modelo
bun test                  # tests de plataforma y de negocio (positivos, negativos y excepciones)
bun run typecheck
bun run smoke -- https://reto2.72.60.136.76.sslip.io Periferia-2026
```

## Prompt de ejemplo

```
Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que
esté limpio, muéstrame lo que requiere revisión campo por campo y termina
con el reporte de alertas. No registres nada dudoso sin preguntarme.
```

Luego: `confirmo el valor 0 y la fecha fin 2027-08-31`. Los archivos generados se ven con el botón **Archivos** del chat.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, tokensSesion }` |
| `GET` | `/api/sessions/:id` | Historial visible de la sesión |
| `POST` | `/api/sessions/:id/reset` | Reinicia los datos de la sesión |
| `GET` | `/api/sessions/:id/archivos[/ruta]` | Lista o lee archivos de `out/` de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model }` sin claves |

Las rutas `/api/*`, salvo health, requieren la cabecera `x-access-code`.

## Despliegue (VPS)

nginx (TLS con Let's Encrypt) → `127.0.0.1:3020` → pm2 (`reto2`). Para actualizar: `./deploy.sh`, que hace pull, install, test, reinicio y health check.

## Estructura

```
agent/prompt.md                     comportamiento (system prompt)
src/knowledge/                      conocimiento del proceso
src/tools/contratos.ts              herramientas contratos_* (zod)
src/dominio/                        extracción, reglas y alertas (puro, testeable)
src/agent/                          ciclo del agente, registro de herramientas, sesiones
src/llm/                            adaptador propio: anthropic, gemini, mock
src/server.ts                       API HTTP y front estático
web/                                chat
modulo/                             agente empaquetado (bonus)
specs/                              especificaciones y criterios de aceptación
tests/                              plataforma/ y contratos/
demo.ts                             verificación sin modelo
```
