import { createHash, timingSafeEqual } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { extname, join, relative, resolve, sep } from "node:path"
import { z } from "zod"
import { cargarConfig, type Config } from "./config"
import { ejecutarTurno, type OpcionesCiclo, type Sesion } from "./agent/ciclo"
import { cargarHerramientas, type Registro } from "./agent/herramientas"
import { registrarLog } from "./agent/log"
import { AlmacenSesiones, ErrorLimiteSesiones, PATRON_SESION } from "./agent/sesiones"
import { cargarSistema } from "./agent/sistema"
import type { ProveedorLLM } from "./llm/adapter"
import { ProveedorAnthropic } from "./llm/anthropic"
import { ProveedorGemini } from "./llm/gemini"
import { ProveedorMock } from "./llm/mock"

export type OpcionesApp = {
  config: Config
  raiz: string
  llm: ProveedorLLM
  registro: Registro
  sistema: string
  ciclo?: Pick<OpcionesCiclo, "requiereConfirmacion" | "argumentosConfirmacion">
}

const CuerpoChat = z.object({
  sessionId: z.string().regex(PATRON_SESION, "sessionId inválido"),
  message: z.string().trim().min(1, "mensaje vacío").max(4000, "mensaje demasiado largo"),
})

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
}
const ARCHIVOS_WEB = new Set(["index.html", "app.js", "styles.css", "favicon.svg"])
const MAX_RESULTADO = 4000

const CABECERAS_SEGURIDAD: Record<string, string> = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000",
  "cache-control": "no-store",
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", ...CABECERAS_SEGURIDAD },
  })
}

function error(estado: number, mensaje: string): Response {
  return json({ ok: false, error: mensaje }, estado)
}

function igualSeguro(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** Resuelve `relativa` dentro de `base`; null si intenta salir de ella. */
export function dentroDe(base: string, relativa: string): string | null {
  const destino = resolve(base, relativa)
  const raiz = resolve(base)
  return destino === raiz || destino.startsWith(raiz + sep) ? destino : null
}

async function listarArchivos(dir: string, base = dir): Promise<string[]> {
  const entradas = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const salida: string[] = []
  for (const e of entradas) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) salida.push(...(await listarArchivos(ruta, base)))
    else salida.push(relative(base, ruta).split(sep).join("/"))
  }
  return salida.sort()
}

class LimitadorTasa {
  private readonly ventanas = new Map<string, { inicio: number; n: number }>()
  constructor(private readonly porMinuto: number) {}
  permitir(clave: string, ahora = Date.now()): boolean {
    const v = this.ventanas.get(clave)
    if (!v || ahora - v.inicio >= 60_000) {
      this.ventanas.set(clave, { inicio: ahora, n: 1 })
      return true
    }
    v.n++
    return v.n <= this.porMinuto
  }
}

function vistaSesion(s: Sesion) {
  return {
    id: s.id,
    creada: s.creada,
    actualizada: s.actualizada,
    tokens: s.tokens,
    confirmacionPendiente: s.confirmacionPendiente,
    turnos: s.turnos,
  }
}

export function crearApp(o: OpcionesApp) {
  const sesiones = new AlmacenSesiones(o.raiz, join(o.raiz, ".sesiones"), o.config.MAX_SESIONES, o.config.SANDBOX_POR_SESION)
  const limitador = new LimitadorTasa(o.config.RATE_LIMIT_POR_MINUTO)
  const dirWeb = join(o.raiz, "web")

  const autorizado = (req: Request): boolean => {
    const codigo = o.config.ACCESS_CODE
    if (!codigo) return true
    return igualSeguro(req.headers.get("x-access-code") ?? "", codigo)
  }

  const chat = async (req: Request, ip: string): Promise<Response> => {
    if (!limitador.permitir(ip)) return error(429, "Demasiadas solicitudes; espera un minuto")
    let cuerpo: unknown
    try {
      cuerpo = await req.json()
    } catch {
      return error(400, "El cuerpo debe ser JSON")
    }
    const v = CuerpoChat.safeParse(cuerpo)
    if (!v.success) return error(400, v.error.issues.map((i) => i.message).join("; "))
    const { sessionId, message } = v.data
    try {
      return await sesiones.conBloqueo(sessionId, async () => {
        const sesion = await sesiones.obtener(sessionId, true)
        if (!sesion) return error(404, "Sesión no encontrada")
        const directory = await sesiones.directorioTrabajo(sessionId)
        const inicio = performance.now()
        const r = await ejecutarTurno(sesion, message, {
          llm: o.llm,
          registro: o.registro,
          sistema: o.sistema,
          ctx: { directory, sessionId },
          maxIteraciones: o.config.MAX_ITERACIONES,
          maxTokensSesion: o.config.MAX_TOKENS_SESION,
          timeoutMs: o.config.LLM_TIMEOUT_MS,
          registrarLog: (entrada) => registrarLog(directory, entrada),
          ...o.ciclo,
        })
        await sesiones.guardar(sesion)
        console.log(`[chat] ${sessionId.slice(0, 8)} · ${r.iteraciones} iteraciones · ${r.toolCalls.length} herramientas · ${Math.round(performance.now() - inicio)} ms${r.error ? ` · ${r.error}` : ""}`)
        return json({
          sessionId,
          reply: r.reply,
          needsConfirmation: r.needsConfirmation,
          toolCalls: r.toolCalls.map((t) => ({ ...t, resultado: t.resultado.slice(0, MAX_RESULTADO) })),
          iteraciones: r.iteraciones,
          tokensSesion: sesion.tokens,
          error: r.error ?? null,
        })
      })
    } catch (e) {
      if (e instanceof ErrorLimiteSesiones) return error(503, e.message)
      console.error("[chat] error interno", e instanceof Error ? e.message : "desconocido")
      return error(500, "Error interno del servidor")
    }
  }

  const rutaSesion = async (req: Request, partes: string[]): Promise<Response> => {
    const [id, accion, ...resto] = partes
    if (!id || !PATRON_SESION.test(id)) return error(400, "sessionId inválido")
    if (!accion && req.method === "GET") {
      const s = await sesiones.obtener(id, false)
      return s ? json(vistaSesion(s)) : error(404, "Sesión no encontrada")
    }
    if (accion === "reset" && req.method === "POST") {
      await sesiones.conBloqueo(id, () => sesiones.reiniciar(id))
      return json({ ok: true })
    }
    if (accion === "archivos" && req.method === "GET") {
      const out = join(await sesiones.directorioTrabajo(id), "out")
      if (resto.length === 0) return json({ archivos: await listarArchivos(out) })
      const ruta = dentroDe(out, decodeURIComponent(resto.join("/")))
      if (!ruta) return error(400, "Ruta inválida")
      const info = await stat(ruta).catch(() => null)
      if (!info?.isFile()) return error(404, "Archivo no encontrado")
      return new Response(await readFile(ruta), {
        headers: { "content-type": "text/plain; charset=utf-8", ...CABECERAS_SEGURIDAD },
      })
    }
    return error(404, "Ruta no encontrada")
  }

  const estatico = async (ruta: string): Promise<Response> => {
    const nombre = ruta === "/" ? "index.html" : ruta.slice(1)
    if (!ARCHIVOS_WEB.has(nombre)) return error(404, "No encontrado")
    const archivo = Bun.file(join(dirWeb, nombre))
    if (!(await archivo.exists())) return error(404, "No encontrado")
    return new Response(archivo, {
      headers: { "content-type": TIPOS[extname(nombre)] ?? "application/octet-stream", ...CABECERAS_SEGURIDAD },
    })
  }

  return {
    sesiones,
    async fetch(req: Request, ipSocket = "local"): Promise<Response> {
      const url = new URL(req.url)
      const ip = req.headers.get("x-real-ip") ?? ipSocket
      try {
        if (url.pathname === "/api/health" && req.method === "GET") {
          return json({ ok: true, provider: o.llm.proveedor, model: o.llm.modelo, herramientas: o.registro.nombres() })
        }
        if (url.pathname.startsWith("/api/")) {
          if (!autorizado(req)) return error(401, "Código de acceso inválido")
          if (url.pathname === "/api/chat" && req.method === "POST") return await chat(req, ip)
          if (url.pathname.startsWith("/api/sessions/")) {
            return await rutaSesion(req, url.pathname.slice("/api/sessions/".length).split("/").filter(Boolean))
          }
          return error(404, "Ruta no encontrada")
        }
        if (req.method === "GET") return await estatico(url.pathname)
        return error(405, "Método no permitido")
      } catch (e) {
        console.error("[http] error interno", e instanceof Error ? e.message : "desconocido")
        return error(500, "Error interno del servidor")
      }
    },
  }
}

export function crearProveedor(config: Config): ProveedorLLM {
  if (config.LLM_PROVIDER === "mock") return new ProveedorMock()
  if (config.LLM_PROVIDER === "anthropic") {
    return new ProveedorAnthropic({
      apiKey: config.ANTHROPIC_API_KEY ?? "",
      modelo: config.LLM_MODEL,
      respaldo: config.LLM_MODEL_RESPALDO,
    })
  }
  return new ProveedorGemini({
    apiKey: config.GEMINI_API_KEY ?? "",
    modelo: config.LLM_MODEL,
    respaldo: config.LLM_MODEL_RESPALDO,
    razonamiento: config.LLM_THINKING,
  })
}

/** Arranca el servidor HTTP con la configuración del entorno. */
export async function iniciar(): Promise<void> {
  const config = cargarConfig()
  const raiz = resolve(import.meta.dir, "..")
  const llm = crearProveedor(config)
  const registro = await cargarHerramientas(join(raiz, "src", "tools"))
  const sistema = await cargarSistema(raiz)
  const app = crearApp({ config, raiz, llm, registro, sistema })
  const servidor = Bun.serve({
    port: config.PORT,
    hostname: config.HOST,
    idleTimeout: 255,
    fetch: (req, srv) => app.fetch(req, srv.requestIP(req)?.address ?? "local"),
  })
  console.log(
    `Servidor en http://${config.HOST}:${servidor.port} · ${llm.proveedor}/${llm.modelo} · herramientas: ${registro.nombres().join(", ") || "ninguna"}`,
  )
}

if (import.meta.main) await iniciar()
