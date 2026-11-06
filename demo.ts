/**
 * Verificación sin modelo: procesa los 6 mensajes del buzón llamando directo a las herramientas.
 *   bun install && bun run demo.ts
 * Determinista: limpia out/ al inicio y usa hoy = 2026-09-03.
 */
import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { Contexto } from "./src/agent/herramientas"
import { registrarLog } from "./src/agent/log"
import { resumir } from "./src/agent/ciclo"
import * as contratos from "./src/tools/contratos"

const HOY = "2026-09-03"
const ctx: Contexto = { directory: import.meta.dir, sessionId: "demo" }

type Salida = { ok: boolean; data?: Record<string, unknown>; error?: string }

async function llamar(nombre: keyof typeof contratos, args: Record<string, unknown>): Promise<Salida> {
  const herramienta = contratos[nombre] as { execute: (a: never, c: Contexto) => Promise<string> }
  const salida = await herramienta.execute(args as never, ctx)
  const r = JSON.parse(salida) as Salida
  await registrarLog(ctx.directory, {
    ts: new Date().toISOString(),
    herramienta: `contratos_${nombre}`,
    mensaje_id: typeof args.mensaje_id === "string" ? args.mensaje_id : null,
    ok: r.ok,
    resumen: resumir(salida),
  })
  return r
}

await rm(join(ctx.directory, "out"), { recursive: true, force: true })

console.log(`\nDemo Reto 02 · registro de contratos · hoy = ${HOY}\n`)
const buzon = await llamar("leer_buzon", {})
const mensajes = (buzon.data?.mensajes ?? []) as { id: string; asunto: string }[]
console.log(`Buzón: ${mensajes.length} mensajes pendientes\n`)

const filas: string[][] = []
for (const m of mensajes) {
  const v = await llamar("validar", { mensaje_id: m.id })
  const clasificacion = v.ok ? String(v.data?.clasificacion) : "error"
  const revision = v.ok ? ((v.data?.requiere_revision as string[]) ?? []) : []
  const r = await llamar("registrar", { mensaje_id: m.id, hoy: HOY })
  const accion = r.ok ? `${r.data?.accion}${r.data?.id_contrato ? ` ${r.data.id_contrato}` : ""}` : `no registrado: ${r.error}`
  filas.push([m.id, clasificacion, revision.join(", ") || "—", accion])
}

const anchos = [8, 14, 18, 60]
const linea = (f: string[]) => f.map((c, i) => c.padEnd(anchos[i] ?? 10)).join(" │ ")
console.log(linea(["Mensaje", "Clasificación", "En revisión", "Acción"]))
console.log("─".repeat(110))
for (const f of filas) console.log(linea(f))

console.log("\nSegunda pasada: el usuario confirma msg-006 (valor 0 y fecha fin 2027-08-31)")
const confirmado = await llamar("registrar", { mensaje_id: "msg-006", confirmado: true, hoy: HOY })
console.log(confirmado.ok ? `  → ${confirmado.data?.accion} ${confirmado.data?.id_contrato} en ${confirmado.data?.ruta_archivo}` : `  → error: ${confirmado.error}`)

const a = await llamar("alertas", { hoy: HOY })
const ids = (k: string) => ((a.data?.[k] as { id_contrato: string }[]) ?? []).map((x) => x.id_contrato).join(", ") || "—"
console.log(`\nAlertas (${a.data?.ruta}):`)
console.log(`  Vencen en ≤ 60 días:       ${ids("vencen")}`)
console.log(`  Pólizas pendientes:        ${ids("polizas_pendientes")}`)
console.log(`  Registrados desde el corte: ${ids("registrados_desde_corte")}`)
console.log(`  Ya vencidos:               ${ids("vencidos")}`)
console.log("\nArchivos: out/sharepoint/maestro-contratos.csv · out/sharepoint/historial.jsonl · out/procesados.json · out/log.jsonl\n")
