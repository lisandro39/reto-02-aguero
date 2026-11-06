# Reglas de negocio e interpretación del PRD

## Clasificación
| ID | Regla | Implementación |
|---|---|---|
| RN1 | Duplicado: mismo `id_contrato` y mismos `valor`, `fecha_inicio`, `fecha_fin`. | No escribe en maestro ni historial; se reporta. |
| RN2 | Actualización: mismo `id_contrato` (o mismo `nit_cliente` + `objeto` con similitud ≥ 0.9) y algún campo distinto, o documento identificado como otrosí. | Actualiza la fila y registra antes/después en `historial.jsonl`. |
| RN3 | Nuevo: sin coincidencia. | Inserta. |
| RN4 | Rechazado: sin adjunto de contrato, o texto sin partes ni objeto identificables. | Se reporta con motivo y se marca procesado. |
| RN5 | Confianza < 0.8 → `requiere_revision`; registrar sin `confirmado = true` lo rechaza. | Además, el servidor bloquea `confirmado: true` si el turno anterior no preguntó al usuario. |
| RN6 | El fixture del maestro es de solo lectura; la primera ejecución lo copia a `out/sharepoint/`. | |
| RN7 | `out/log.jsonl` con `{ ts, herramienta, mensaje_id, ok, resumen }`. | |

Similitud de `objeto`: coeficiente de Dice sobre bigramas de texto normalizado (sin tildes, minúsculas).
El cruce por `nit_cliente` + `objeto` evita falsos duplicados por variaciones del nombre (riesgo del PRD §10).

## Extracción y confianza
| Campo | Cómo se obtiene | Confianza |
|---|---|---|
| `id_contrato` | `No. CT-…` / `CM-…` del encabezado; en un otrosí, el contrato que modifica | 0.98 |
| `cliente` | Primera parte (EL CONTRATANTE); se usa la grafía del bloque de firmas | 0.95 con firma, 0.85 sin ella |
| `nit_cliente` / `pais` | NIT → CO; RUC 13 dígitos → EC; RUC 11 dígitos → PE; RUC con guiones → PA; RTN 14 dígitos → HN; se contrasta con la ciudad | 0.95 / 0.95 si coinciden |
| `objeto` | Cláusula OBJETO, máx. 200 caracteres | 0.9 |
| `valor` / `moneda` | Cláusula VALOR: código o palabra de moneda + número (formatos `265.000.000` y `120,000.00`) | 0.95 |
| valor por demanda | "no tiene un valor determinado", "por demanda", "según órdenes" → `valor = 0`, `valor_indeterminado = true` | 0.6 (siempre a revisión) |
| moneda sin valor | Primera moneda que aparece en el documento | 0.85 |
| fechas explícitas | "desde el … (N) de mes de AAAA hasta el …" | 0.95 |
| `fecha_inicio` por firma | Fecha de firma completa | 0.9 |
| firma solo con mes | Se usa la fecha del correo si cae en ese mes | 0.8 |
| `fecha_fin` derivada | `fecha_inicio` + N meses | 0.6 (siempre a revisión) |
| `requiere_poliza` / `tipo_poliza` | Cláusula de garantías / mención de póliza; sin mención → `false` | 0.95; 0.8 si la póliza es condicional; 0.9 si no hay mención |

## Interpretaciones tomadas
1. **Otrosí**: los campos que no menciona significan "sin cambio", no "baja confianza"; no entran a revisión y conservan el valor del maestro.
2. **Otrosí y pólizas**: si el otrosí exige ampliar garantías, `estado_poliza` pasa a `pendiente`.
3. **Póliza condicional** (msg-006: "por cada orden > COP 100M"): `requiere_poliza = true` con `estado_poliza = pendiente`; preferimos alertar de más que dejar un riesgo sin seguimiento.
4. **Remitente no registrado**: se registra el correo con la marca `(no registrado)` en `comercial` y se informa como advertencia.
5. **Duplicados y rechazados** se marcan en `procesados.json` para que no reaparezcan en el buzón (no se escribe el maestro).
6. **`fecha_registro`**: fecha del sistema; `contratos_registrar` acepta `hoy` opcional para pruebas deterministas.
7. **Archivo de otrosí**: se archiva como `<id_contrato>_otrosi-<n>.<ext>` junto al contrato, sin sobrescribir el original.
8. **Alertas**: además de las tres secciones pedidas, se listan los contratos ya vencidos (hallazgo para gerencia).
