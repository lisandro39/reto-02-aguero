import {
  ErrorProveedor,
  type DefinicionHerramienta,
  type Mensaje,
  type OpcionesEnvio,
  type ProveedorLLM,
  type Respuesta,
  type ToolCall,
} from "./adapter"

type ParteGemini = {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}
type ContenidoGemini = { role: "user" | "model"; parts: ParteGemini[] }
type RespuestaGemini = {
  candidates?: { content?: { parts?: ParteGemini[] }; finishReason?: string }[]
  usageMetadata?: { totalTokenCount?: number }
  promptFeedback?: { blockReason?: string }
}

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
const CLAVES_PERMITIDAS = new Set([
  "type",
  "description",
  "enum",
  "properties",
  "required",
  "items",
  "nullable",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "anyOf",
])
const LIMITE_NUMERICO = 1e15

/** Convierte JSON Schema (zod) al subconjunto OpenAPI que acepta Gemini. La validación real la hace zod. */
export function limpiarEsquema(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(limpiarEsquema)
  if (!valor || typeof valor !== "object") return valor
  const entrada = valor as Record<string, unknown>
  if (Array.isArray(entrada.anyOf)) {
    const opciones = entrada.anyOf.filter((o) => !(o && typeof o === "object" && (o as { type?: unknown }).type === "null"))
    if (opciones.length === 1 && opciones.length < entrada.anyOf.length) {
      const base = limpiarEsquema(opciones[0]) as Record<string, unknown>
      return { ...base, nullable: true, ...(entrada.description ? { description: entrada.description } : {}) }
    }
  }
  const salida: Record<string, unknown> = {}
  if ("const" in entrada) salida.enum = [entrada.const]
  for (const [clave, v] of Object.entries(entrada)) {
    if (!CLAVES_PERMITIDAS.has(clave)) continue
    if ((clave === "minimum" || clave === "maximum") && typeof v === "number" && Math.abs(v) > LIMITE_NUMERICO) continue
    salida[clave] = clave === "properties" ? limpiarPropiedades(v) : limpiarEsquema(v)
  }
  return salida
}

function limpiarPropiedades(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object") return {}
  return Object.fromEntries(Object.entries(v).map(([k, s]) => [k, limpiarEsquema(s)]))
}

function aDeclaracion(h: DefinicionHerramienta): Record<string, unknown> {
  const props = h.parametros.properties
  const tieneProps = !!props && typeof props === "object" && Object.keys(props).length > 0
  return { name: h.nombre, description: h.descripcion, ...(tieneProps ? { parameters: limpiarEsquema(h.parametros) } : {}) }
}

function aObjeto(texto: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(texto)
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
    return { resultado: v }
  } catch {
    return { resultado: texto }
  }
}

function esPartes(v: unknown): v is ParteGemini[] {
  return Array.isArray(v)
}

/** Traduce el historial propio al formato de Gemini. */
export function aContenidos(mensajes: Mensaje[]): { system?: string; contents: ContenidoGemini[] } {
  const system: string[] = []
  const contents: ContenidoGemini[] = []
  for (const m of mensajes) {
    if (m.rol === "system") {
      system.push(m.contenido)
    } else if (m.rol === "user") {
      contents.push({ role: "user", parts: [{ text: m.contenido }] })
    } else if (m.rol === "assistant") {
      const parts: ParteGemini[] = esPartes(m.nativo)
        ? m.nativo
        : [
            ...(m.contenido ? [{ text: m.contenido }] : []),
            ...m.toolCalls.map((tc) => ({ functionCall: { name: tc.nombre, args: tc.args } })),
          ]
      contents.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] })
    } else {
      const parte: ParteGemini = { functionResponse: { name: m.nombre, response: aObjeto(m.contenido) } }
      const ultimo = contents.at(-1)
      if (ultimo && ultimo.role === "user" && ultimo.parts.every((p) => p.functionResponse)) ultimo.parts.push(parte)
      else contents.push({ role: "user", parts: [parte] })
    }
  }
  return { system: system.length ? system.join("\n\n") : undefined, contents }
}

/** Traduce la respuesta de Gemini al formato propio. */
export function deRespuesta(json: RespuestaGemini, generarId: () => string): Respuesta {
  const candidato = json.candidates?.[0]
  if (!candidato) {
    const motivo = json.promptFeedback?.blockReason
    throw new ErrorProveedor(motivo ? `El proveedor bloqueó la solicitud (${motivo})` : "El proveedor no devolvió respuesta")
  }
  const parts = candidato.content?.parts ?? []
  const texto = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim()
  const toolCalls: ToolCall[] = parts.flatMap((p) =>
    p.functionCall ? [{ id: generarId(), nombre: p.functionCall.name, args: p.functionCall.args ?? {} }] : [],
  )
  return { texto, toolCalls, tokens: json.usageMetadata?.totalTokenCount ?? 0, nativo: parts }
}

/** Traduce el nivel de razonamiento configurado al campo que espera Gemini. */
export function configuracionRazonamiento(nivel?: string): Record<string, unknown> | undefined {
  if (!nivel) return undefined
  return /^\d+$/.test(nivel) ? { thinkingBudget: Number(nivel) } : { thinkingLevel: nivel }
}

function mensajeEstado(estado: number): string {
  if (estado === 429) return "Se alcanzó el límite de uso del proveedor del modelo. Intenta de nuevo en un minuto"
  if (estado === 401 || estado === 403) return "El proveedor rechazó la credencial configurada en el servidor"
  if (estado === 400) return "El proveedor rechazó la solicitud (400)"
  if (estado === 404) return "El modelo configurado no está disponible para esta clave"
  if (estado >= 500) return "El proveedor del modelo está saturado o con problemas temporales; reintenta en un momento"
  return `El proveedor respondió con estado ${estado}`
}

const ESTADOS_REINTENTABLES = new Set([429, 500, 502, 503, 504])

export type OpcionesGemini = {
  apiKey: string
  modelo: string
  /** Modelos alternativos si el principal está saturado (503/429). */
  respaldo?: string[]
  razonamiento?: string
  /** Reintentos por modelo ante saturación, con espera creciente. */
  reintentos?: number
  esperaBaseMs?: number
  fetchFn?: typeof fetch
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    if (signal?.aborted) return rechazar(new ErrorProveedor("El modelo no respondió a tiempo (timeout)"))
    const t = setTimeout(resolver, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        rechazar(new ErrorProveedor("El modelo no respondió a tiempo (timeout)"))
      },
      { once: true },
    )
  })
}

export class ProveedorGemini implements ProveedorLLM {
  readonly proveedor = "gemini"
  readonly modelo: string
  private readonly fetchFn: typeof fetch

  constructor(private readonly o: OpcionesGemini) {
    this.modelo = o.modelo
    this.fetchFn = o.fetchFn ?? fetch
  }

  private async llamar(modelo: string, cuerpo: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    try {
      return await this.fetchFn(`${URL_BASE}/${encodeURIComponent(modelo)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.o.apiKey },
        body: JSON.stringify(cuerpo),
        signal,
      })
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new ErrorProveedor("El modelo no respondió a tiempo (timeout)")
      throw new ErrorProveedor("No se pudo contactar al proveedor del modelo")
    }
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opciones: OpcionesEnvio = {}): Promise<Respuesta> {
    const { system, contents } = aContenidos(mensajes)
    const pensamiento = configuracionRazonamiento(this.o.razonamiento)
    const base = {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(herramientas.length ? { tools: [{ functionDeclarations: herramientas.map(aDeclaracion) }] } : {}),
    }
    const modelos = [this.o.modelo, ...(this.o.respaldo ?? [])]
    const reintentos = this.o.reintentos ?? 2
    const esperaBase = this.o.esperaBaseMs ?? 1500
    let ultimoEstado = 0

    for (const modelo of modelos) {
      let usarPensamiento = !!pensamiento
      for (let intento = 0; intento <= reintentos; intento++) {
        const cuerpo = {
          ...base,
          generationConfig: { temperature: 0, ...(usarPensamiento ? { thinkingConfig: pensamiento } : {}) },
        }
        const res = await this.llamar(modelo, cuerpo, opciones.signal)
        if (res.ok) {
          if (modelo !== this.o.modelo) console.warn(`[gemini] respondió el modelo de respaldo ${modelo}`)
          return deRespuesta((await res.json()) as RespuestaGemini, () => crypto.randomUUID())
        }
        ultimoEstado = res.status
        const detalle = (await res.text().catch(() => "")).slice(0, 300)
        console.error(`[gemini] ${modelo} estado ${res.status} (intento ${intento + 1}): ${detalle.replace(/\s+/g, " ")}`)
        if (res.status === 400 && usarPensamiento) {
          usarPensamiento = false // el modelo no acepta ese nivel de razonamiento: reintenta sin él
          continue
        }
        if (res.status === 404) break // modelo no disponible: pasa al de respaldo
        if (!ESTADOS_REINTENTABLES.has(res.status)) throw new ErrorProveedor(mensajeEstado(res.status), res.status)
        if (intento < reintentos) await esperar(esperaBase * 2 ** intento, opciones.signal)
      }
    }
    throw new ErrorProveedor(mensajeEstado(ultimoEstado), ultimoEstado)
  }
}
