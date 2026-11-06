# Módulo reutilizable

Agente empaquetado para otras plataformas de agentes, sin depender del servidor:

| Pieza | Fuente única |
|---|---|
| `agent.md` | `agent/prompt.md` (generado con `bun run modulo`) |
| `tools/contratos.ts` | re-exporta `src/tools/contratos.ts` |
| `skill/registro-contratos/SKILL.md` | `src/knowledge/registro-contratos.md` (generado) |

`tests/contratos/modulo.test.ts` falla si alguna pieza diverge de la aplicación.
