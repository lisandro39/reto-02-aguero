# Conocimiento del proceso: registro de contratos vigentes

## Contexto
- El maestro de contratos estaba congelado desde el **2026-05-30**; lo alimentaba una persona que ya no está.
- Hasta ahora solo llegaban a administración los contratos con póliza. El buzón único recibe **todos** los contratos, con o sin póliza.
- No hay área legal interna: el agente no revisa cláusulas, solo registra y alerta.

## Clasificación de un mensaje
| Clasificación | Cuándo | Qué se hace |
|---|---|---|
| `nuevo` | El contrato no está en el maestro (ni por número ni por NIT + objeto similar). | Se inserta; si exige póliza queda `estado_poliza = pendiente`. |
| `actualizacion` | Es un otrosí, o el mismo contrato llega con cambios. | Se actualiza la fila y se guarda el antes/después en el historial. Un otrosí que amplía plazo exige ampliar las pólizas: quedan `pendiente`. |
| `duplicado` | Mismo número, valor y fechas que una fila existente. | No se escribe nada; se informa. |
| `rechazado` | El correo no trae contrato (p. ej. una cotización) o el texto no tiene partes u objeto. | Se informa el motivo. |

## Confianza y revisión humana
- Cada campo extraído trae una confianza entre 0 y 1. **Bajo 0.8 se pide confirmación** antes de registrar.
- Siempre van a revisión: valor por demanda (se registra 0), fecha de fin calculada desde un plazo en meses, y cualquier valor que el usuario haya corregido.
- Un remitente que no está en la lista de comerciales se informa, pero no bloquea.

## Alertas
- Contratos que vencen en 60 días o menos desde la fecha de referencia.
- Pólizas exigidas que no están vigentes (pendientes o vencidas).
- Contratos registrados desde el corte (2026-05-30): muestra cuánto del vacío se ha cubierto.
- Contratos ya vencidos: candidatos a renovación o acta de terminación.

## Archivo
- Documento: `Contratos/<año de inicio>/<cliente>/<número>.<ext>`. Los otrosíes van junto al contrato como `<número>_otrosi-<n>`.
