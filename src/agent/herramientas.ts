import { readdir } from "node:fs/promises"
import { basename, join } from "node:path"
import { pathToFileURL } from "node:url"
import { z, type ZodType } from "zod"
import type { DefinicionHerramienta } from "../llm/adapter"

/** Contexto que recibe cada herramienta. `directory` es la raíz de trabajo; las rutas se resuelven desde ahí. */
export type Contexto = { directory: string; sessionId: string }

export type ArgsHerramienta = Record<string, ZodType>

export type Herramienta = {
  description: string
  args: ArgsHerramienta
  execute: (args: never, ctx: Contexto) => Promise<string>
}

export type ResultadoEjecucion = { ok: boolean; salida: string }

type Registrada = { nombre: string; definicion: Herramienta; esquema: z.ZodObject<ArgsHerramienta> }

/** Ayuda de tipado opcional para escribir herramientas con args inferidos desde zod. */
export function herramienta<A extends ArgsHerramienta>(def: {
  description: string
  args: A
  execute: (args: z.infer<z.ZodObject<A>>, ctx: Contexto) => Promise<string>
}): Herramienta {
  return def as unknown as Herramienta
}

export function esHerramienta(v: unknown): v is Herramienta {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return typeof o.description === "string" && typeof o.execute === "function" && !!o.args && typeof o.args === "object"
}

export function ok(data: unknown): string {
  return JSON.stringify({ ok: true, data })
}

export function fallo(error: string): string {
  return JSON.stringify({ ok: false, error })
}

function leerOk(salida: string): boolean {
  try {
    const v: unknown = JSON.parse(salida)
    return !!v && typeof v === "object" && (v as { ok?: unknown }).ok === true
  } catch {
    return false
  }
}

/** Registro de herramientas: nombre `<archivo>_<export>`, validación zod previa y ejecución que nunca lanza. */
export class Registro {
  private readonly mapa = new Map<string, Registrada>()

  registrarModulo(archivo: string, modulo: Record<string, unknown>): void {
    for (const [exportado, valor] of Object.entries(modulo)) {
      if (!esHerramienta(valor)) continue
      const nombre = `${archivo}_${exportado}`
      if (this.mapa.has(nombre)) throw new Error(`Herramienta duplicada: ${nombre}`)
      this.mapa.set(nombre, { nombre, definicion: valor, esquema: z.object(valor.args) })
    }
  }

  nombres(): string[] {
    return [...this.mapa.keys()]
  }

  definiciones(): DefinicionHerramienta[] {
    return [...this.mapa.values()].map((h) => ({
      nombre: h.nombre,
      descripcion: h.definicion.description,
      parametros: z.toJSONSchema(h.esquema) as Record<string, unknown>,
    }))
  }

  async ejecutar(nombre: string, args: unknown, ctx: Contexto): Promise<ResultadoEjecucion> {
    const h = this.mapa.get(nombre)
    if (!h) return { ok: false, salida: fallo(`Herramienta desconocida: ${nombre}`) }
    const validacion = h.esquema.safeParse(args ?? {})
    if (!validacion.success) {
      const detalle = validacion.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
      return { ok: false, salida: fallo(`Argumentos inválidos para ${nombre}: ${detalle}`) }
    }
    try {
      const salida: unknown = await h.definicion.execute(validacion.data as never, ctx)
      if (typeof salida !== "string") return { ok: false, salida: fallo(`${nombre} no devolvió texto`) }
      return { ok: leerOk(salida), salida }
    } catch (e) {
      return { ok: false, salida: fallo(`Error interno en ${nombre}: ${e instanceof Error ? e.message : "desconocido"}`) }
    }
  }
}

/** Carga cada archivo de `dir` como módulo de herramientas. */
export async function cargarHerramientas(dir: string): Promise<Registro> {
  const registro = new Registro()
  const archivos = (await readdir(dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort()
  for (const archivo of archivos) {
    const modulo = (await import(pathToFileURL(join(dir, archivo)).href)) as Record<string, unknown>
    registro.registrarModulo(basename(archivo, ".ts"), modulo)
  }
  return registro
}
