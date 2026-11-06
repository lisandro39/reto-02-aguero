import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Contexto } from "../../src/agent/herramientas"

const raiz = join(import.meta.dir, "..", "..")
const temporales: string[] = []

/** Espacio de trabajo aislado por test: copia de fixtures y out/ vacío. */
export async function espacio(): Promise<Contexto> {
  const dir = await mkdtemp(join(tmpdir(), "contratos-"))
  temporales.push(dir)
  await cp(join(raiz, "fixtures"), join(dir, "fixtures"), { recursive: true })
  return { directory: dir, sessionId: "test" }
}

export async function limpiar(): Promise<void> {
  await Promise.all(temporales.splice(0).map((d) => rm(d, { recursive: true, force: true })))
}

/** Crea un mensaje adicional en el buzón del espacio de trabajo. */
export async function agregarMensaje(ctx: Contexto, id: string, adjunto: string, texto: string, de = "lgomez@periferia-ficticia.com") {
  const dir = join(ctx.directory, "fixtures", "reto-02", "buzon", id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "correo.json"), JSON.stringify({ id, de, para: "contratos@periferia-ficticia.com", asunto: `Prueba ${id}`, fecha: "2026-08-30T10:00:00-05:00", cuerpo: "prueba", adjuntos: [adjunto] }))
  await writeFile(join(dir, adjunto), texto)
}

type Herramienta = { execute: (args: never, ctx: Contexto) => Promise<string> }
export type Salida = { ok: boolean; data?: Record<string, any>; error?: string; confirmacion?: boolean }

export async function correr(h: Herramienta, args: Record<string, unknown>, ctx: Contexto): Promise<Salida> {
  return JSON.parse(await h.execute(args as never, ctx)) as Salida
}

export async function leer(ctx: Contexto, ...ruta: string[]): Promise<string> {
  return readFile(join(ctx.directory, ...ruta), "utf8")
}

export function filas(csv: string): string[] {
  return csv.trim().split("\n").slice(1)
}
