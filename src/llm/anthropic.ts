import {
  ErrorProveedor,
  type DefinicionHerramienta,
  type Mensaje,
  type OpcionesEnvio,
  type ProveedorLLM,
  type Respuesta,
  type ToolCall,
} from "./adapter"

type BloqueTexto = { type: "text"; text: string }
type BloqueToolUse = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
type BloqueToolResult = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
type Bloque = BloqueTexto | BloqueToolUse | BloqueToolResult | { type: string; [k: string]: unknown }
type MensajeAnthropic = { role: "user" | "assistant"; content: Bloque[] }
type RespuestaAnthropic = {
  content?: Bloque[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

const URL_API = "https://api.anthropic.com/v1/messages"
const VERSION_API = "2023-06-01"
const ESTADOS_REINTENTABLES = new Set([429, 500, 502, 503, 504, 529])

export type OpcionesAnthropic = {
  apiKey: string
  modelo: string
  /** Modelos alternativos si el principal está saturado (529/429/5xx). */
  respaldo?: string[]
  maxTokens?: number
  reintentos?: number
  esperaBaseMs?: number
  fetchFn?: typeof fetch
}

function esBloques(v: unknown): v is Bloque[] {
  return Array.isArray(v)
}

function esError(contenido: string): boolean {
  try {
    const v: unknown = JSON.parse(contenido)
    return !!v && typeof v === "object" && (v as { ok?: unknown }).ok === false
  } catch {
    return false
  }
}

/** JSON Schema de zod sin metadatos que la API no necesita. */
export function esquemaEntrada(parametros: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _omitido, ...resto } = parametros
  return { type: "object", properties: {}, ...resto }
}

/** Traduce el historial propio al formato de la Messages API. */
export function aMensajes(mensajes: Mensaje[]): { system?: string; messages: MensajeAnthropic[] } {
  const system: string[] = []
  const messages: MensajeAnthropic[] = []
  for (const m of mensajes) {
    if (m.rol === "system") {
      system.push(m.contenido)
    } else if (m.rol === "user") {
      messages.push({ role: "user", content: [{ type: "text", text: m.contenido }] })
    } else if (m.rol === "assistant") {
      const content: Bloque[] = esBloques(m.nativo)
        ? m.nativo
        : [
            ...(m.contenido ? [{ type: "text", text: m.contenido } as BloqueTexto] : []),
            ...m.toolCalls.map((tc): BloqueToolUse => ({ type: "tool_use", id: tc.id, name: tc.nombre, input: tc.args })),
          ]
      messages.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "(sin texto)" }] })
    } else {
      const bloque: BloqueToolResult = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.contenido,
        ...(esError(m.contenido) ? { is_error: true } : {}),
      }
      const ultimo = messages.at(-1)
      if (ultimo && ultimo.role === "user" && ultimo.content.every((b) => b.type === "tool_result")) ultimo.content.push(bloque)
      else messages.push({ role: "user", content: [bloque] })
    }
  }
  return { system: system.length ? system.join("\n\n") : undefined, messages }
}

/** Traduce la respuesta de la API al formato propio. */
export function deRespuestaAnthropic(json: RespuestaAnthropic): Respuesta {
  const content = json.content ?? []
  const texto = content
    .filter((b): b is BloqueTexto => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
  const toolCalls: ToolCall[] = content
    .filter((b): b is BloqueToolUse => b.type === "tool_use")
    .map((b) => ({ id: b.id, nombre: b.name, args: b.input ?? {} }))
  const tokens = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0)
  return { texto, toolCalls, tokens, nativo: content }
}

function mensajeEstado(estado: number): string {
  if (estado === 429) return "Se alcanzó el límite de uso del proveedor del modelo. Intenta de nuevo en un minuto"
  if (estado === 401 || estado === 403) return "El proveedor rechazó la credencial configurada en el servidor"
  if (estado === 400) return "El proveedor rechazó la solicitud (400)"
  if (estado === 404) return "El modelo configurado no está disponible para esta clave"
  if (estado === 529 || estado >= 500) return "El proveedor del modelo está saturado o con problemas temporales; reintenta en un momento"
  return `El proveedor respondió con estado ${estado}`
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

export class ProveedorAnthropic implements ProveedorLLM {
  readonly proveedor = "anthropic"
  readonly modelo: string
  private readonly fetchFn: typeof fetch

  constructor(private readonly o: OpcionesAnthropic) {
    this.modelo = o.modelo
    this.fetchFn = o.fetchFn ?? fetch
  }

  private async llamar(cuerpo: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    try {
      return await this.fetchFn(URL_API, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.o.apiKey, "anthropic-version": VERSION_API },
        body: JSON.stringify(cuerpo),
        signal,
      })
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new ErrorProveedor("El modelo no respondió a tiempo (timeout)")
      throw new ErrorProveedor("No se pudo contactar al proveedor del modelo")
    }
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opciones: OpcionesEnvio = {}): Promise<Respuesta> {
    const { system, messages } = aMensajes(mensajes)
    const base = {
      max_tokens: this.o.maxTokens ?? 4096,
      messages,
      ...(system ? { system } : {}),
      ...(herramientas.length
        ? { tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: esquemaEntrada(h.parametros) })) }
        : {}),
    }
    const modelos = [this.o.modelo, ...(this.o.respaldo ?? [])]
    const reintentos = this.o.reintentos ?? 2
    const esperaBase = this.o.esperaBaseMs ?? 1500
    let ultimoEstado = 0

    for (const modelo of modelos) {
      for (let intento = 0; intento <= reintentos; intento++) {
        const res = await this.llamar({ ...base, model: modelo }, opciones.signal)
        if (res.ok) {
          if (modelo !== this.o.modelo) console.warn(`[anthropic] respondió el modelo de respaldo ${modelo}`)
          return deRespuestaAnthropic((await res.json()) as RespuestaAnthropic)
        }
        ultimoEstado = res.status
        const detalle = (await res.text().catch(() => "")).slice(0, 300)
        console.error(`[anthropic] ${modelo} estado ${res.status} (intento ${intento + 1}): ${detalle.replace(/\s+/g, " ")}`)
        if (res.status === 404) break
        if (!ESTADOS_REINTENTABLES.has(res.status)) throw new ErrorProveedor(mensajeEstado(res.status), res.status)
        if (intento < reintentos) await esperar(esperaBase * 2 ** intento, opciones.signal)
      }
    }
    throw new ErrorProveedor(mensajeEstado(ultimoEstado), ultimoEstado)
  }
}
