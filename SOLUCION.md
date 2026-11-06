# SOLUCIÓN — Reto 02 · Agente "Registro de Contratos Vigentes"

**Link de prueba:** https://reto2.72.60.136.76.sslip.io · **Código de acceso:** `Periferia-2026`
**Repositorio:** https://github.com/lisandro39/reto-02-aguero

---

## 1. Problema en una frase

El maestro de contratos está congelado desde el 2026-05-30 porque dependía de una persona y de que los comerciales enviaran solo los contratos con póliza. **La dirección no sabe qué contratos están vigentes, cuáles vencen ni qué pólizas están en riesgo.** Le duele a la analista administrativa (dueña del maestro), a gerencia (visibilidad y riesgo) y a la empresa (pólizas contractuales sin constituir).

## 2. Arquitectura

```
┌──────────────────────┐  HTTPS   ┌──────── nginx (TLS, VPS) ────────┐
│ Front (web/)         │ ───────▶ │  proxy → 127.0.0.1:3020          │
│ chat · tool calls    │ ◀─────── └──────────────┬───────────────────┘
│ confirmación resaltada│                         ▼
└──────────────────────┘   ┌──────────────── Backend (Bun, src/server.ts) ───────────────┐
                           │ API /api/chat · /api/sessions/:id · /api/health              │
                           │ código de acceso · rate limit · sesiones aisladas            │
                           │                                                              │
                           │ Ciclo del agente (src/agent/ciclo.ts)                        │
                           │   prompt → modelo → herramientas → modelo … (tope 25)        │
                           │   guardia de confirmación humana · log de cada tool call     │
                           │        │                         │                           │
                           │        ▼                         ▼                           │
                           │ Adaptador LLM (src/llm/)   Herramientas (src/tools/)         │
                           │ enviar(mensajes, tools)    contratos_* tipadas con zod       │
                           │ anthropic · gemini · mock        │                           │
                           └────────────────────────────────── ┼ ──────────────────────────┘
                                                               ▼
                                   Dominio (src/dominio/): extracción, reglas RN1–RN6, alertas
                                        │ lee                              │ escribe
                                        ▼                                  ▼
                              fixtures/ (solo lectura)      out/ (por sesión): sharepoint/maestro-contratos.csv,
                                                            Contratos/…, historial.jsonl, procesados.json,
                                                            alertas.md, log.jsonl
```

| Capa | Dónde vive | Cambia cuando… |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | cambia cómo conversa o reporta el agente |
| **Conocimiento** | `src/knowledge/registro-contratos.md` | cambia el proceso de negocio |
| **Ejecución** | `src/tools/contratos.ts` → `src/dominio/` | cambian reglas de extracción o clasificación |
| **Plataforma** | `src/server.ts`, `src/agent/`, `src/llm/` | no cambia por reglas de negocio |

## 3. Ciclo del agente

- **Bucle propio** (`ejecutarTurno`): envía el historial al modelo; si responde con llamadas a herramientas, las valida con zod, las ejecuta, agrega los resultados y vuelve a llamar al modelo. Termina cuando el modelo responde sin herramientas.
- **Topes:** 25 iteraciones por turno (CA1: al alcanzarlo informa qué hizo y qué falta), tope de tokens por sesión, timeout de 90 s al proveedor, rate limit por IP.
- **Confirmación humana (CA3) en dos capas:**
  1. `contratos_registrar` rechaza con `requiere revisión: …` si hay campos bajo 0.8 y no viene `confirmado: true`.
  2. El servidor **bloquea `confirmado: true` si el turno anterior no terminó pidiendo confirmación**. El modelo no puede auto-confirmar aunque lo intente: no depende de que obedezca el prompt.
- **Lote determinista:** `contratos_procesar_buzon({ hoy })` ejecuta validar → registrar para cada mensaje pendiente en orden y devuelve el resultado por mensaje. El modelo solo presenta y pregunta. Lo agregamos tras probar con el modelo real: orquestando 12 llamadas sueltas, Haiku omitió registrar un mensaje limpio e inventó una revisión que ninguna herramienta pidió. Las herramientas del contrato mínimo siguen disponibles para consultas puntuales y para confirmar.
- El turno que pide confirmación se marca `needsConfirmation` y el front lo resalta con un banner y botones Confirmo / No confirmo.
- **CA4:** cada llamada queda visible en el chat (nombre, argumentos, resultado) y en `out/log.jsonl`. **CA5:** errores del proveedor o de herramientas se muestran en lenguaje claro y la sesión sigue.

## 4. Elección del modelo y costo

- **Proveedor:** Anthropic, modelo **`claude-haiku-5-5`**. Es rápido (1–3 s por llamada) y bueno usando herramientas. El trabajo pesado (extraer, validar, registrar) es determinista, así que el modelo solo orquesta y redacta; no hace falta un modelo grande.
- **Alternativa probada y descartada como principal:** Gemini Flash en capa gratuita. Respondió con saturación (503) y latencias de 15–60 s. Queda disponible cambiando `LLM_PROVIDER=gemini`, **sin tocar el ciclo**, con reintentos y modelo de respaldo.
- **Costo estimado** (Haiku 5.5: USD 0,10 por millón de tokens de entrada y USD 0,50 por millón de salida, con prompts de menos de 100K tokens): un lote de 6 mensajes usa unas 15 llamadas con unos 12K tokens de entrada promedio y unos 6K de salida en total, **del orden de USD 0,02 por lote, menos de USD 0,005 por caso.** El consumo real por sesión se ve en `tokensSesion` de la API.
- **Control de gasto:** tope de tokens por sesión, de iteraciones por turno, rate limit, código de acceso y clave prepagada sin recarga automática.

## 5. Estrategia de extracción

Toda la extracción es **determinista** (`src/dominio/extraccion.ts`). El modelo **no** extrae ni corrige valores.

| Campo | Cómo | Confianza |
|---|---|---|
| Número | `No. CT-…` / `CM-…` del encabezado; en otrosí, el contrato que modifica | 0.98 |
| Cliente | Primera parte (EL CONTRATANTE); grafía tomada del bloque de firmas | 0.95 (0.85 sin firma) |
| NIT / país | Tipo de identificador (NIT → CO, RUC 13 dígitos → EC, RUC 11 → PE, RTN → HN) contrastado con la ciudad de domicilio | 0.95 si coinciden, 0.5 si se contradicen |
| Objeto | Cláusula OBJETO, recortado a 200 caracteres | 0.9 |
| Valor / moneda | Cláusula VALOR: código + número, soporta `265.000.000` y `120,000.00`; moneda desconocida → error | 0.95 |
| Valor por demanda | "no tiene un valor determinado" → `0` + `valor_indeterminado` | **0.6 (revisión)** |
| Plazo | "desde … hasta …" con fechas en palabras y número entre paréntesis; fecha inexistente → error | 0.95 |
| Plazo en meses | `fecha_fin = fecha_inicio + N meses`; inicio = firma (si solo hay mes, el día del correo dentro de ese mes) | **fin 0.6 (revisión)**; inicio 0.8 |
| Póliza | Cláusula de garantías; tipos cumplimiento, calidad, salarios y prestaciones, responsabilidad civil; póliza condicional | 0.95 / 0.8 |

**Dónde entra el modelo:** decide el orden de las herramientas, explica resultados, arma la tabla y la pregunta de confirmación, y traduce correcciones del usuario a `contrato: { campo: valor }`. **Dónde no:** ningún valor registrado sale del modelo. `registrar` vuelve a extraer y validar desde el documento, y todo campo que el usuario o el modelo cambie respecto de lo extraído pasa a revisión.

## 6. Regla de gobierno (propuesta de una página)

**Objetivo:** que todo contrato firmado exista en el maestro en menos de 3 días hábiles, con o sin póliza, sin depender de una persona.

1. **Canal único.** Buzón `contratos@periferia.com`, atendido por el agente. **Dueña del proceso:** Jefatura Administrativa; **operadora:** analista administrativa (con respaldo nombrado para vacaciones o rotación). La dueña del maestro responde por su calidad; no existe área legal, así que el agente no revisa cláusulas.
2. **Obligación del comercial.** Enviar **todo** contrato firmado (no solo los que tienen póliza), **otrosíes** y **actas de terminación o liquidación**, en PDF firmado, **dentro de 3 días hábiles desde la firma**. Asunto: `[CONTRATO|OTROSI|TERMINACION] <Cliente> - <N.º contrato>`. Sin contrato registrado no se emite la primera factura (control en facturación).
3. **Acuse automático.** En menos de 1 hora hábil el agente responde al comercial: registrado (número y ruta), duplicado, rechazado (motivo) o **en revisión** (campos dudosos y plazo de resolución de 2 días hábiles).
4. **Excepciones y escalamiento.** Sin firma, sin valor o sin plazo: queda en revisión y se pide el documento corregido al comercial. Si no responde en 2 días hábiles, se escala a su jefatura comercial; a los 5 días, a la Gerencia. Remitentes no registrados se aceptan, pero se informa al comercial responsable de la cuenta.
5. **Cierre del gap (junio–agosto 2026).** Una campaña de 2 semanas: (a) facturación extrae la lista de clientes facturados desde el 2026-05-30; (b) se cruza contra el maestro; (c) cada comercial recibe su lista de faltantes y los reenvía al buzón con el asunto estándar; (d) el agente los registra con `fuente = migracion`; (e) cierre con un reporte de cobertura a Gerencia.
6. **Indicador mensual.** **% de contratos facturados en el mes que existen en el maestro** (meta ≥ 98 %). Secundarios: días promedio entre firma y registro (meta ≤ 3), y % de pólizas exigidas en estado vigente.

## 7. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Extracción determinista con confianza por regla | Extracción con el LLM | Reproducible, auditable y gratis. El PRD pide que el valor registrado no salga del modelo; un LLM puede "redondear" fechas o montos. Costo: más reglas para formatos nuevos. |
| Guardia de confirmación en el servidor además del prompt | Confiar solo en el prompt | Un prompt se puede ignorar; la guardia hace imposible registrar algo dudoso sin una pregunta previa al usuario. |
| Sesiones aisladas (cada sesión con su copia de datos) | Un solo `out/` compartido | Con un link público, dos evaluadores se pisarían: el segundo vería el buzón vacío y msg-001 como duplicado. Costo: un poco de disco por sesión. |
| Adaptador propio sobre `fetch` | Vercel AI SDK / SDK del proveedor | El PRD exige una interfaz propia `enviar(mensajes, herramientas)`; sin SDK el ciclo es explícito y cambiar de proveedor es una variable de entorno. |
| Bun.serve sin framework HTTP | Hono / Express | Cinco rutas no justifican una dependencia; menos superficie de ataque. Dependencias de producción: `zod` (validación) y `unpdf` (texto de PDF nativo, sin binarios del sistema). |
| VPS propio + nginx + pm2 | Render / Vercel gratis | No se duerme en la defensa, HTTPS con Let's Encrypt, el puerto de la app no queda expuesto (escucha en 127.0.0.1). |
| Herramienta de lote `procesar_buzon` además del contrato mínimo | Que el modelo orqueste validar/registrar mensaje a mensaje | Menos llamadas (más barato y rápido) y sin margen para omitir o inventar pasos; detectado en prueba real. Costo: el modelo tiene menos libertad, que aquí no se necesita. |
| Duplicados y rechazados se marcan como procesados | No marcarlos | Si no, reaparecen en cada lectura del buzón. No se escribe el maestro. |

## 8. Supuestos

1. En un **otrosí**, los campos que no menciona no cambian (no son "baja confianza") y se conserva el valor del maestro.
2. Un otrosí que exige **ampliar garantías** deja `estado_poliza = pendiente` hasta que se constituya la nueva póliza.
3. **Póliza condicional** (msg-006: solo para órdenes > COP 100M) se registra `requiere_poliza = true`, `pendiente`: es preferible alertar de más.
4. Firma "en el mes de agosto de 2026" sin día: se usa la fecha del correo (2026-08-31, mismo mes) como inicio con confianza 0.8. El fin se deriva (+12 meses = 2027-08-31) y va a revisión porque además hay prórroga automática.
5. Remitente no registrado: `comercial = "<correo> (no registrado)"` y advertencia.
6. `fecha_registro` es la fecha del sistema; `registrar` acepta `hoy` para pruebas deterministas.
7. Similitud de objeto ≥ 0.9 con coeficiente de Dice sobre bigramas normalizados.
8. Además de las tres secciones pedidas, el reporte lista **contratos ya vencidos** (CT-2025-018 y CT-2026-002 vencieron sin renovación registrada).

## 9. Cobertura

| Historia | Estado | Evidencia | Falta para producción |
|---|---|---|---|
| HU-1 Leer buzón | Hecho | `tests/contratos` HU1-CA1..3 | Conexión real a Exchange / Graph API |
| HU-2 Extraer | Hecho | HU2-CA1..5 | OCR para escaneados |
| P1 `contratos_leer_pdf` | Hecho | P1-CA1..3: PDF nativo con texto; los adjuntos `.pdf` se extraen igual que `.txt` | OCR para escaneados |
| HU-3 Validar | Hecho | HU3-CA1..5, RN2 | Catálogo de clientes con NIT validado |
| HU-4 Registrar y archivar | Hecho | HU4-CA1..7, RN4, RN6 | SharePoint real (Graph API) y bloqueo concurrente del Excel |
| HU-5 Alertas | Hecho | HU5-CA1..3 | Envío programado semanal a gerencia |
| HU-6 Errores | Hecho | HU6-CA1..2 | Cola de reintentos y alertas operativas |
| Ciclo CA1–CA5 | Hecho | `tests/plataforma/ciclo.test.ts` | Streaming de respuestas |
| Bonus módulo reutilizable | Hecho | `modulo/` + test de sincronía | — |

**Prueba E2E con el modelo real:** `bun run e2e -- <url> <código>` ejecuta el prompt de la sección 11 contra el despliegue. Verifica que use herramientas y pida confirmación, confirma y comprueba que el maestro queda con 11 contratos, sin duplicados y con el otrosí aplicado.

**Pruebas automatizadas:** `bun test` corre tests de plataforma (ciclo, adaptadores, API y seguridad) y de negocio (los 6 casos más escenarios negativos y de excepción). Cada test cita su criterio (`HU4-CA1 …`). `demo.ts` verifica el flujo completo sin modelo. GitHub Actions corre typecheck y tests en cada push, y `bun run smoke -- <url> <código>` valida el despliegue.

## 10. Uso de IA

- **Claude (Anthropic)** como asistente de desarrollo para: proponer la estructura, redactar código TypeScript y tests a partir de las specs, revisar casos borde de los fixtures y redactar esta documentación. Yo definí las specs y los criterios de aceptación, revisé cada archivo y validé el resultado con tests y con la demo.
- **Lo que descarté de lo propuesto:**
  - Usar el LLM para extraer campos: no es determinista ni auditable.
  - Usar Vercel AI SDK: oculta el ciclo que el PRD pide implementar.
  - Gemini gratis como proveedor principal: saturación 503 y latencias altas en pruebas reales.
  - Docker en el VPS: podía afectar otros servicios del servidor; se aisló con pm2, un puerto propio y un sitio nginx dedicado.
- **En tiempo de ejecución** el agente usa Claude Haiku 5.5 solo para orquestar herramientas y redactar.

## 11. Riesgos de producción y mitigación

| Riesgo | Mitigación |
|---|---|
| Contratos escaneados o con formatos nuevos | OCR (Azure Document Intelligence o Textract) antes de la extracción; los campos no reconocidos quedan en `null` con confianza 0 y van a revisión. Monitorear el % de campos en revisión. |
| Falsos duplicados por variaciones del nombre | Dedupe por NIT + objeto antes que por nombre (implementado); catálogo de clientes. |
| El modelo inventa o redondea | Los valores salen solo de herramientas; registrar recalcula todo desde el documento; la guardia de confirmación está en el servidor. |
| Comerciales no cumplen la regla | Control en facturación (sin contrato no hay primera factura) e indicador mensual de cobertura. |
| Concurrencia sobre el maestro | En producción, maestro en SharePoint List o base de datos con bloqueo optimista; hoy hay serialización por sesión. |
| Prompt injection desde el texto de un contrato o correo | El prompt trata el contenido como dato; los valores salen de herramientas deterministas, y registrar algo dudoso exige una confirmación que el servidor valida (el modelo no puede auto-confirmar). |
| Exposición de datos de contratos | Autenticación corporativa (Entra ID) en lugar de código de acceso, cifrado en reposo y retención según política. |
| Costo o caída del proveedor | Topes por sesión, reintentos con respaldo y adaptador intercambiable (Anthropic, Gemini o modelo local). |
