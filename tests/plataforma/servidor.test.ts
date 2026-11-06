import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, cp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cargarConfig } from "../../src/config"
import { cargarHerramientas } from "../../src/agent/herramientas"
import { crearApp, dentroDe } from "../../src/server"
import { ProveedorMock } from "../../src/llm/mock"

const raizProyecto = join(import.meta.dir, "..", "..")
const temporales: string[] = []

async function app(env: Record<string, string> = {}) {
  const raiz = await mkdtemp(join(tmpdir(), "agente-"))
  temporales.push(raiz)
  await cp(join(raizProyecto, "web"), join(raiz, "web"), { recursive: true })
  await mkdir(join(raiz, "fixtures"), { recursive: true })
  await writeFile(join(raiz, "fixtures", "dato.txt"), "original")
  const config = cargarConfig({ LLM_PROVIDER: "mock", ACCESS_CODE: "clave-demo", RATE_LIMIT_POR_MINUTO: "100", ...env })
  const registro = await cargarHerramientas(join(raizProyecto, "tests", "apoyo"))
  return crearApp({ config, raiz, llm: new ProveedorMock(), registro, sistema: "s" })
}

const SID = "sesion-prueba-1"
const pedir = (ruta: string, init: RequestInit & { codigo?: string } = {}) =>
  new Request(`http://localhost${ruta}`, {
    ...init,
    headers: { "content-type": "application/json", "x-access-code": init.codigo ?? "clave-demo", ...(init.headers ?? {}) },
  })
const chat = (message: string, sessionId = SID, codigo?: string) =>
  pedir("/api/chat", { method: "POST", body: JSON.stringify({ sessionId, message }), codigo })

afterAll(async () => {
  await Promise.all(temporales.map((d) => rm(d, { recursive: true, force: true })))
})

describe("API HTTP", () => {
  test("health responde proveedor y modelo sin exponer claves", async () => {
    const a = await app({ GEMINI_API_KEY: "NO-DEBE-SALIR" })
    const r = await a.fetch(new Request("http://localhost/api/health"))
    const texto = await r.text()
    expect(r.status).toBe(200)
    expect(JSON.parse(texto)).toMatchObject({ ok: true, provider: "mock", model: "mock-1" })
    expect(texto).not.toContain("NO-DEBE-SALIR")
  })

  test("sin código de acceso correcto responde 401", async () => {
    const a = await app()
    expect((await a.fetch(chat("hola", SID, "incorrecto"))).status).toBe(401)
  })

  test("chat responde reply, toolCalls y needsConfirmation", async () => {
    const a = await app()
    const r = await a.fetch(chat('/tool herramientas-prueba_eco {"texto":"hola"}'))
    const d = await r.json()
    expect(r.status).toBe(200)
    expect(d.toolCalls[0].nombre).toBe("herramientas-prueba_eco")
    expect(d.needsConfirmation).toBe(false)
  })

  test("marca needsConfirmation cuando una herramienta lo pide", async () => {
    const a = await app()
    const d = await (await a.fetch(chat("/tool herramientas-prueba_accion_sensible {}"))).json()
    expect(d.needsConfirmation).toBe(true)
    const s = await (await a.fetch(pedir(`/api/sessions/${SID}`))).json()
    expect(s.confirmacionPendiente).toBe(true)
  })

  test("historial de sesión disponible por GET", async () => {
    const a = await app()
    await a.fetch(chat("hola"))
    const s = await (await a.fetch(pedir(`/api/sessions/${SID}`))).json()
    expect(s.turnos).toHaveLength(1)
    expect(s.mensajes).toBeUndefined()
  })

  test("valida el cuerpo: mensaje vacío y sessionId con ruta", async () => {
    const a = await app()
    expect((await a.fetch(chat(""))).status).toBe(400)
    expect((await a.fetch(chat("hola", "../../etc"))).status).toBe(400)
    expect((await a.fetch(pedir("/api/chat", { method: "POST", body: "no-json" }))).status).toBe(400)
  })

  test("aísla los datos por sesión (sandbox)", async () => {
    const a = await app()
    await a.fetch(chat('/tool herramientas-prueba_eco {"texto":"a"}', "sesion-a-111"))
    await a.fetch(chat('/tool herramientas-prueba_eco {"texto":"b"}', "sesion-b-222"))
    const la = await (await a.fetch(pedir("/api/sessions/sesion-a-111/archivos"))).json()
    expect(la.archivos).toEqual(["log.jsonl"])
    const log = await (await a.fetch(pedir("/api/sessions/sesion-a-111/archivos/log.jsonl"))).text()
    expect(log.trim().split("\n")).toHaveLength(1)
  })

  test("bloquea path traversal al leer archivos", async () => {
    const a = await app()
    await a.fetch(chat("hola"))
    const r = await a.fetch(pedir(`/api/sessions/${SID}/archivos/..%2F..%2Fsesion.json`))
    expect(r.status).toBe(400)
    expect(dentroDe("/base/out", "../x")).toBeNull()
    expect(dentroDe("/base/out", "a/b.md")).not.toBeNull()
  })

  test("reset borra los datos de la sesión", async () => {
    const a = await app()
    await a.fetch(chat("hola"))
    await a.fetch(pedir(`/api/sessions/${SID}/reset`, { method: "POST" }))
    expect((await a.fetch(pedir(`/api/sessions/${SID}`))).status).toBe(404)
  })

  test("rate limit por IP", async () => {
    const a = await app({ RATE_LIMIT_POR_MINUTO: "2" })
    const req = () => a.fetch(chat("hola"), "1.2.3.4")
    expect((await req()).status).toBe(200)
    expect((await req()).status).toBe(200)
    expect((await req()).status).toBe(429)
  })

  test("sirve el front con cabeceras de seguridad y no expone otros archivos", async () => {
    const a = await app()
    const r = await a.fetch(new Request("http://localhost/"))
    expect(r.status).toBe(200)
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'")
    expect((await a.fetch(new Request("http://localhost/.env"))).status).toBe(404)
  })
})

describe("Configuración", () => {
  test("exige clave cuando el proveedor es gemini", () => {
    expect(() => cargarConfig({ LLM_PROVIDER: "gemini" })).toThrow("GEMINI_API_KEY")
  })
  test("el error de configuración no incluye valores", () => {
    try {
      cargarConfig({ LLM_PROVIDER: "otro", GEMINI_API_KEY: "SECRETO" })
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRETO")
    }
  })
})
