// Prueba de aceptación E2E contra el agente desplegado, con el modelo real (sección 11 del PRD).
//   bun run e2e -- https://reto2.72.60.136.76.sslip.io Periferia-2026
// Usa una sesión nueva y aislada, y la reinicia al terminar. Costo aproximado: menos de USD 0,01.
export {}

const [base, codigo = ""] = process.argv.slice(2)
if (!base) {
  console.error("Uso: bun run e2e -- <url> [codigo_acceso]")
  process.exit(1)
}

type ToolCall = { nombre: string; ok: boolean; resultado: string }
type Respuesta = { reply: string; toolCalls: ToolCall[]; needsConfirmation: boolean; tokensSesion: number; error: string | null }

const sesion = `e2e-${Date.now()}`
const cabeceras = { "content-type": "application/json", "x-access-code": codigo }
let fallos = 0

function verificar(nombre: string, condicion: boolean, detalle = ""): void {
  console.log(`${condicion ? "✓" : "✗"} ${nombre}${!condicion && detalle ? ` — ${detalle}` : ""}`)
  if (!condicion) fallos++
}

async function chat(message: string): Promise<Respuesta> {
  const inicio = Date.now()
  const r = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: cabeceras,
    body: JSON.stringify({ sessionId: sesion, message }),
    signal: AbortSignal.timeout(180_000),
  })
  const d = (await r.json()) as Respuesta
  console.log(`  · ${r.status} en ${((Date.now() - inicio) / 1000).toFixed(1)} s · herramientas: ${d.toolCalls?.map((t) => t.nombre).join(", ") || "ninguna"}`)
  return d
}

console.log(`E2E contra ${base} (sesión ${sesion})\n`)
console.log("Turno 1: prompt de la sección 11 del PRD")
const t1 = await chat(
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.",
)
const nombres1 = t1.toolCalls.map((t) => t.nombre)
verificar("procesa el buzón con herramientas (no inventa)", nombres1.includes("contratos_procesar_buzon") || nombres1.includes("contratos_registrar"))
verificar("genera el reporte de alertas", nombres1.includes("contratos_alertas"))
verificar("todas las herramientas responden ok", t1.toolCalls.every((t) => t.ok), t1.toolCalls.filter((t) => !t.ok).map((t) => t.nombre).join(", "))
verificar("termina pidiendo confirmación (CA3)", t1.needsConfirmation === true)
verificar("menciona msg-006 / CM-2026-03 en la respuesta", /msg-006|CM-2026-03/.test(t1.reply))

console.log("\nTurno 2: el usuario confirma")
const t2 = await chat("Confirmo el valor 0 y la fecha fin 2027-08-31.")
const registro = t2.toolCalls.find((t) => t.nombre === "contratos_registrar")
verificar("llama a contratos_registrar con confirmación", !!registro)
verificar("CM-2026-03 queda insertado", !!registro?.ok && registro.resultado.includes("CM-2026-03") && registro.resultado.includes("insertado"), registro?.resultado.slice(0, 160))

console.log("\nEstado final del maestro de la sesión")
const maestro = await (await fetch(`${base}/api/sessions/${sesion}/archivos/sharepoint/maestro-contratos.csv`, { headers: cabeceras })).text()
const ids = maestro.trim().split("\n").slice(1).map((l) => l.split(",")[0])
verificar("11 contratos y sin duplicados", ids.length === 11 && new Set(ids).size === 11, `ids: ${ids.join(" ")}`)
for (const id of ["CT-2026-015", "CT-2026-016", "CM-2026-03"]) verificar(`${id} registrado`, ids.includes(id))
verificar("CT-2026-011 actualizado por el otrosí", /CT-2026-011,.*,520000,PEN,2026-05-02,2027-11-01,/.test(maestro))
console.log(`\nTokens usados en la sesión: ${t2.tokensSesion}`)

await fetch(`${base}/api/sessions/${sesion}/reset`, { method: "POST", headers: cabeceras }).catch(() => undefined)
console.log(fallos === 0 ? "\nE2E OK" : `\n${fallos} verificación(es) fallaron`)
process.exit(fallos === 0 ? 0 : 1)
