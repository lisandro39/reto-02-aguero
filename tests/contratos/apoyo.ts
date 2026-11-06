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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo en tests, para leer el JSON de salida sin repetir tipos
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

/** PDF mínimo válido (una página, Helvetica) con una línea de texto por elemento. Solo ASCII. */
export function pdfMinimo(lineas: string[]): Uint8Array {
  const contenido = ["BT", "/F1 9 Tf", "12 TL", "40 800 Td", ...lineas.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`), "ET"].join("\n")
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objetos.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(pdf)
}
