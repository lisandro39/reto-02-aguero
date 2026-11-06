# Historias de usuario y criterios de aceptación

## HU-1 · Leer el buzón
- **HU1-CA1** Dado el buzón `fixtures/reto-02/buzon/`, cuando llamo `contratos_leer_buzon`, entonces recibo cada mensaje no presente en `out/procesados.json` con `{ id, de, asunto, fecha, adjuntos[], tiene_contrato }`, ordenados por id.
- **HU1-CA2** Dado un mensaje cuyo adjunto no es un contrato ni un otrosí (p. ej. cotización), entonces `tiene_contrato = false`, `clasificacion = "rechazado"` y un `motivo` legible.
- **HU1-CA3** Dado un mensaje ya marcado en `out/procesados.json`, entonces no aparece en la lista.

## HU-2 · Extraer los datos del contrato
- **HU2-CA1** `contratos_extraer({ mensaje_id })` devuelve el esquema del maestro (sec. 7.2) más `es_otrosi`, `contrato_referencia`, `plazo_meses`, `valor_indeterminado` y `confianza` por campo en `[0, 1]`.
- **HU2-CA2** La extracción es determinista (regex y heurísticas); dos llamadas devuelven lo mismo.
- **HU2-CA3** Un campo ausente en el texto es `null` con confianza `0`; nunca se inventa.
- **HU2-CA4** `nit_cliente` sin puntos ni dígito de verificación; `valor` sin separadores; fechas `YYYY-MM-DD`; `objeto` ≤ 200 caracteres.
- **HU2-CA5** `fecha_fin` puede derivarse de un plazo en meses; un valor derivado o inferido nunca tiene confianza ≥ 0.8.

## HU-3 · Validar y clasificar
- **HU3-CA1** `contratos_validar` clasifica en `nuevo`, `actualizacion`, `duplicado` o `rechazado` según RN1–RN4.
- **HU3-CA2** Devuelve `requiere_revision[]` con los campos de confianza < 0.8 y los conflictos con el maestro.
- **HU3-CA3** Para `actualizacion` devuelve `id_contrato_existente` y `diferencias` (`campo`, `antes`, `despues`).
- **HU3-CA4** El remitente se resuelve contra `comerciales.json`; uno desconocido genera una advertencia, no bloquea.
- **HU3-CA5** Si el usuario corrige un campo (difiere de lo extraído), ese campo pasa a `requiere_revision` hasta que confirme.

## HU-4 · Registrar y archivar
- **HU4-CA1** `contratos_registrar` solo escribe si `requiere_revision` está vacío o `confirmado = true`; si no, `{ ok: false, error: "requiere revisión: …" }` y no escribe nada.
- **HU4-CA2** Inserta o actualiza la fila en `out/sharepoint/maestro-contratos.csv`; el fixture nunca se modifica (RN6).
- **HU4-CA3** Copia el documento a `out/sharepoint/Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>` y guarda la ruta en la fila.
- **HU4-CA4** Agrega a `out/sharepoint/historial.jsonl` `{ ts, id_contrato, accion, cambios, mensaje_id }`.
- **HU4-CA5** Marca el mensaje en `out/procesados.json`.
- **HU4-CA6** Un duplicado no escribe en el maestro ni en el historial.
- **HU4-CA7** Nunca quedan dos filas con el mismo `id_contrato`.

## HU-5 · Alertar
- **HU5-CA1** `contratos_alertas({ hoy })` genera `out/alertas.md` con tres secciones: vencen en ≤ 60 días, pólizas con `requiere_poliza = true` y `estado_poliza ≠ vigente`, y registrados desde el 2026-05-30.
- **HU5-CA2** La fecha de referencia es el argumento `hoy`; mismo `hoy`, mismo reporte.
- **HU5-CA3** Un `hoy` inválido devuelve `{ ok: false, error }`.

## HU-6 · Manejo de errores
- **HU6-CA1** Texto vacío, fecha inválida o moneda desconocida devuelven `{ ok: false, error }` legible.
- **HU6-CA2** Ninguna herramienta lanza excepciones; un mensaje malo no impide procesar el siguiente.

## Procesamiento por lote (herramienta adicional `contratos_procesar_buzon`)
- **LOTE-CA1** Procesa en orden todos los mensajes pendientes (validar y registrar) y deja sin registrar los que requieren revisión, listados en `pendientes_confirmacion` con sus `campos_en_revision`.
- **LOTE-CA2** Usa `hoy` como fecha de registro, para que el reporte sea coherente con la fecha de referencia del usuario.
- **LOTE-CA3** Es idempotente: una segunda corrida no duplica nada.
- **CA3** Si hay pendientes (o una validación informa `requiere_revision`), el turno queda en espera de confirmación humana.

> Motivo: en la prueba con el modelo real, al orquestar 12 llamadas sueltas el agente omitió registrar un mensaje limpio y agregó una "revisión" que ninguna herramienta pidió (violaba CA2). El lote determinista deja al modelo solo la tarea de presentar y preguntar.

## P1 · PDF nativo (`contratos_leer_pdf`)
- **P1-CA1** `contratos_leer_pdf({ ruta })` devuelve el texto de un PDF del buzón respetando los saltos de línea.
- **P1-CA2** Un adjunto `contrato.pdf` se extrae, valida y archiva igual que uno `.txt`.
- **P1-CA3** Rechaza rutas fuera del buzón, archivos que no son PDF y PDF dañados con un error legible.
