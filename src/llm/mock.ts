import type { DefinicionHerramienta, Mensaje, ProveedorLLM, Respuesta } from "./adapter"

export type Guion = (mensajes: Mensaje[], herramientas: DefinicionHerramienta[]) => Respuesta | Promise<Respuesta>

const PATRON_TOOL = /^\/tool\s+(\S+)\s*(\{.*\})?\s*$/s

/**
 * Guion por defecto: "/tool <nombre> {json}" llama esa herramienta;
 * tras resultados de herramientas responde con un resumen; si no, hace eco.
 */
export const guionPorDefecto: Guion = (mensajes) => {
  const ultimo = mensajes.at(-1)
  if (ultimo?.rol === "tool") {
    const resultados = mensajes.slice(mensajes.findLastIndex((m) => m.rol !== "tool") + 1)
    const texto = resultados.map((r) => (r.rol === "tool" ? `- ${r.nombre}: ${r.contenido.slice(0, 200)}` : "")).join("\n")
    const pide = resultados.some((r) => r.rol === "tool" && r.contenido.includes('"confirmacion":true'))
    return { texto: `Resultados:\n${texto}${pide ? "\n\n¿Confirmas que continúe?" : ""}`, toolCalls: [], tokens: 10 }
  }
  const contenido = ultimo?.rol === "user" ? ultimo.contenido : ""
  const m = PATRON_TOOL.exec(contenido)
  if (m && m[1]) {
    let args: Record<string, unknown> = {}
    try {
      const v: unknown = JSON.parse(m[2] ?? "{}")
      if (v && typeof v === "object" && !Array.isArray(v)) args = v as Record<string, unknown>
    } catch {
      return { texto: "JSON de argumentos inválido", toolCalls: [], tokens: 5 }
    }
    return { texto: "", toolCalls: [{ id: crypto.randomUUID(), nombre: m[1], args }], tokens: 5 }
  }
  return { texto: `mock: ${contenido}`, toolCalls: [], tokens: 5 }
}

/** Proveedor determinista para pruebas y para operar sin clave. */
export class ProveedorMock implements ProveedorLLM {
  readonly proveedor = "mock"
  readonly modelo = "mock-1"
  readonly llamadas: Mensaje[][] = []

  constructor(private readonly guion: Guion = guionPorDefecto) {}

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<Respuesta> {
    this.llamadas.push(structuredClone(mensajes))
    return this.guion(mensajes, herramientas)
  }
}
