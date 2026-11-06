# Casos del buzón (resultado esperado)

| Mensaje | Clasificación | requiere_revision | Acción esperada |
|---|---|---|---|
| msg-001 | `nuevo` (mismo NIT que CT-2025-018, pero objeto distinto) | — | Inserta CT-2026-015, COP 265000000, 2026-08-01 → 2027-07-31, póliza `cumplimiento`, `estado_poliza = pendiente`, comercial Laura Gómez Restrepo |
| msg-002 | `nuevo` | — | Inserta CT-2026-016, USD 120000, EC, 2026-08-15 → 2027-08-14, `requiere_poliza = false`, `no_aplica` |
| msg-003 | `actualizacion` (otrosí de CT-2026-011) | — | `valor` 350000 → 520000 y `fecha_fin` 2027-05-01 → 2027-11-01; `estado_poliza` → `pendiente`; línea en historial |
| msg-004 | `duplicado` de CT-2026-012 | — | Sin escritura en maestro ni historial |
| msg-005 | `rechazado` (cotización, sin contrato) | — | Solo se reporta con motivo |
| msg-006 | `nuevo` CM-2026-03 | `valor`, `fecha_fin` | No se registra en la primera pasada. Tras confirmar (valor 0, fecha fin 2027-08-31) se inserta con `valor_indeterminado`, póliza condicional `pendiente` y comercial no registrado |

## Alertas con `hoy = 2026-09-03` (tras procesar y confirmar msg-006)
- **Vencen en ≤ 60 días:** CT-2026-009 (2026-09-30, 27 días) y CT-2026-004 (2026-10-15, 42 días).
- **Pólizas pendientes:** CT-2026-004, CT-2026-011, CT-2026-015 y CM-2026-03.
- **Registrados desde el corte (2026-05-30):** CT-2026-015, CT-2026-016 y CM-2026-03.
- **Ya vencidos (extra):** CT-2025-018 (2026-06-30) y CT-2026-002 (2026-07-09).
