# Especificaciones (Spec-Driven Development)

Fuente: `docs/PRD.md` (Reto 02 v2.0). Cada criterio tiene un ID; cada test lo cita en su nombre
(`HU4-CA2 …`), así la trazabilidad spec → test → código se ve en `bun test`.

| Spec | Contenido |
|---|---|
| [01-historias.md](01-historias.md) | HU-1 a HU-6 con criterios de aceptación (Dado / Cuando / Entonces) |
| [02-reglas.md](02-reglas.md) | Reglas RN1–RN7, extracción y confianza, interpretaciones del PRD |
| [03-casos.md](03-casos.md) | Resultado esperado de los 6 mensajes del buzón y del reporte de alertas |
| [04-agente.md](04-agente.md) | Reglas del ciclo CA1–CA5, API y requisitos no funcionales |

Flujo de trabajo: spec → test en rojo → implementación → test en verde → commit.
