import { ErrorProveedor, type Mensaje, type ProveedorLLM, type ToolCall } from "../llm/adapter"
import type { Contexto, Registro } from "./herramientas"
import type { EntradaLog } from "./log"

export type LlamadaRegistrada = {
  id: string
  nombre: string
  args: Record<string, unknown>
  ok: boolean
  resumen: string
  resultado: string
  ms: number
}

export type Turno = {
  ts: string
  usuario: string
  respuesta: string
  toolCalls: LlamadaRegistrada[]
  needsConfirmation: boolean
  error?: string
}

export type Sesion = {
  id: string
  creada: string
  actualizada: string
  tokens: number
  confirmacionPendiente: boolean
  mensajes: Mensaje[]
  turnos: Turno[]
}

export type OpcionesCiclo = {
  llm: ProveedorLLM
  registro: Registro
  sistema: string
  ctx: Contexto
  maxIteraciones: number
  maxTokensSesion: number
  timeoutMs: number
  registrarLog?: (entrada: EntradaLog) => Promise<void>
  /** Decide si el resultado de una herramienta obliga a pedir confirmación humana. */
  requiereConfirmacion?: (nombre: string, salida: string) => boolean
  /** Argumentos que solo pueden ser `true` si el turno anterior pidió confirmación. */
  argumentosConfirmacion?: string[]
}

export type ResultadoTurno = {
  reply: string
  toolCalls: LlamadaRegistrada[]
  needsConfirmation: boolean
  iteraciones: number
  tokens: number
  error?: string
}

const ARGS_CONFIRMACION = ["confirmado"]

export function nuevaSesion(id: string): Sesion {
  const ahora = new Date().toISOString()
  return { id, creada: ahora, actualizada: ahora, tokens: 0, confirmacionPendiente: false, mensajes: [], turnos: [] }
}

function parsear(salida: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(salida)
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Por defecto: se pide confirmación si la herramienta devuelve `confirmacion: true` (en la raíz o en `data`)
 * o informa campos en `requiere_revision`.
 */
export function confirmacionPorDefecto(_nombre: string, salida: string): boolean {
  const v = parsear(salida)
  if (!v) return false
  const data = v.data && typeof v.data === "object" ? (v.data as Record<string, unknown>) : null
  const revision = Array.isArray(data?.requiere_revision) && data.requiere_revision.length > 0
  return v.confirmacion === true || data?.confirmacion === true || revision
}

export function resumir(salida: string, max = 160): string {
  const v = parsear(salida)
  const texto = !v
    ? salida
    : v.ok === false
      ? `error: ${String(v.error ?? "desconocido")}`
      : `ok: ${JSON.stringify(v.data ?? {})}`
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto
}

async function conTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const control = new AbortController()
  let temporizador: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      control.abort()
      rechazar(new ErrorProveedor("El modelo no respondió a tiempo (timeout)"))
    }, ms)
  })
  try {
    return await Promise.race([fn(control.signal), limite])
  } finally {
    clearTimeout(temporizador)
  }
}

/**
 * Un turno: mensaje del usuario → modelo → herramientas → modelo … hasta una respuesta sin herramientas
 * o el tope de iteraciones. Nunca lanza: los errores se devuelven como texto claro y la sesión sigue viva.
 */
export async function ejecutarTurno(sesion: Sesion, mensajeUsuario: string, op: OpcionesCiclo): Promise<ResultadoTurno> {
  const confirmacionHabilitada = sesion.confirmacionPendiente
  sesion.confirmacionPendiente = false
  sesion.mensajes.push({ rol: "user", contenido: mensajeUsuario })

  const llamadas: LlamadaRegistrada[] = []
  const requiere = op.requiereConfirmacion ?? confirmacionPorDefecto
  const protegidos = op.argumentosConfirmacion ?? ARGS_CONFIRMACION
  const definiciones = op.registro.definiciones()
  let needsConfirmation = false
  let tokensTurno = 0
  let iteraciones = 0

  const cerrar = (reply: string, error?: string): ResultadoTurno => {
    sesion.confirmacionPendiente = needsConfirmation
    sesion.actualizada = new Date().toISOString()
    sesion.turnos.push({ ts: sesion.actualizada, usuario: mensajeUsuario, respuesta: reply, toolCalls: llamadas, needsConfirmation, error })
    return { reply, toolCalls: llamadas, needsConfirmation, iteraciones, tokens: tokensTurno, error }
  }

  const ejecutarLlamada = async (tc: ToolCall): Promise<void> => {
    const inicio = performance.now()
    const bloqueado = protegidos.find((k) => tc.args[k] === true) && !confirmacionHabilitada
    const { ok, salida } = bloqueado
      ? {
          ok: false,
          salida: JSON.stringify({
            ok: false,
            error: "Confirmación humana requerida: termina el turno preguntando al usuario y espera su respuesta antes de confirmar.",
          }),
        }
      : await op.registro.ejecutar(tc.nombre, tc.args, op.ctx)
    if (requiere(tc.nombre, salida)) needsConfirmation = true
    const resumen = resumir(salida)
    llamadas.push({ id: tc.id, nombre: tc.nombre, args: tc.args, ok, resumen, resultado: salida, ms: Math.round(performance.now() - inicio) })
    sesion.mensajes.push({ rol: "tool", toolCallId: tc.id, nombre: tc.nombre, contenido: salida })
    const mensajeId = typeof tc.args.mensaje_id === "string" ? tc.args.mensaje_id : null
    await op.registrarLog?.({ ts: new Date().toISOString(), herramienta: tc.nombre, mensaje_id: mensajeId, ok, resumen }).catch(() => undefined)
  }

  if (sesion.tokens >= op.maxTokensSesion) {
    return cerrar("Se alcanzó el tope de tokens de esta sesión. Abre una sesión nueva para continuar.", "tope_tokens")
  }

  while (iteraciones < op.maxIteraciones) {
    iteraciones++
    let respuesta
    const inicioLlm = performance.now()
    try {
      respuesta = await conTimeout(
        (signal) => op.llm.enviar([{ rol: "system", contenido: op.sistema }, ...sesion.mensajes], definiciones, { signal }),
        op.timeoutMs,
      )
    } catch (e) {
      const motivo = e instanceof ErrorProveedor ? e.message : "Error inesperado al llamar al modelo"
      return cerrar(`No pude completar la respuesta: ${motivo}. La sesión sigue activa; puedes reintentar.`, "proveedor")
    }
    if (process.env.LOG_LLM === "true") console.log(`[llm] iteración ${iteraciones} · ${Math.round(performance.now() - inicioLlm)} ms · ${respuesta.tokens} tokens`)
    tokensTurno += respuesta.tokens
    sesion.tokens += respuesta.tokens
    sesion.mensajes.push({ rol: "assistant", contenido: respuesta.texto, toolCalls: respuesta.toolCalls, nativo: respuesta.nativo })

    if (respuesta.toolCalls.length === 0) return cerrar(respuesta.texto || "(el modelo no devolvió texto)")

    for (const tc of respuesta.toolCalls) await ejecutarLlamada(tc)

    if (sesion.tokens >= op.maxTokensSesion) {
      return cerrar("Se alcanzó el tope de tokens de esta sesión. Revisa las herramientas ejecutadas arriba.", "tope_tokens")
    }
  }

  const hechas = llamadas.map((l) => `${l.nombre} (${l.ok ? "ok" : "error"})`).join(", ")
  return cerrar(
    `Alcancé el tope de ${op.maxIteraciones} iteraciones en este turno. Ejecuté: ${hechas || "nada"}. Escribe "continúa" para seguir con lo pendiente.`,
    "tope_iteraciones",
  )
}
