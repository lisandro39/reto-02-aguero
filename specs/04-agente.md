# Agente, API y requisitos no funcionales

| ID | Regla | Dónde se verifica |
|---|---|---|
| CA1 | Tope de iteraciones por turno (25); al alcanzarlo responde con lo hecho y lo pendiente. | `tests/plataforma/ciclo.test.ts` |
| CA2 | El modelo no afirma valores que no salgan de una herramienta. | `agent/prompt.md`; registrar recalcula todo desde el documento |
| CA3 | Confirmación humana: el turno termina con una pregunta; `confirmado: true` solo se acepta si el turno anterior la pidió. | `ciclo.test.ts`, `servidor.test.ts` |
| CA4 | Cada llamada a herramienta queda en el chat y en `out/log.jsonl`. | `ciclo.test.ts` |
| CA5 | Errores del proveedor o de herramientas se muestran en claro; la sesión sigue. | `ciclo.test.ts` |

## API
`POST /api/chat`, `GET /api/sessions/:id`, `GET /api/health`, `POST /api/sessions/:id/reset`, `GET /api/sessions/:id/archivos[/ruta]`.

## No funcionales
- Clave del modelo solo en variable de entorno del servidor; nunca en repo, front, logs ni respuestas.
- Código de acceso para el link público; rate limit por IP; topes de iteraciones y tokens por sesión.
- Cada sesión del chat trabaja sobre su propia copia de fixtures y `out/` (no se cruzan datos entre evaluadores).
- Las herramientas no ejecutan comandos de shell y no aceptan rutas fuera del buzón.
- `demo.ts` corre sin clave y es determinista (limpia `out/` al inicio).
