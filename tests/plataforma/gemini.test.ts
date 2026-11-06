import { describe, expect, test } from "bun:test"
import { aContenidos, configuracionRazonamiento, deRespuesta, limpiarEsquema, ProveedorGemini } from "../../src/llm/gemini"
import { ErrorProveedor, type Mensaje } from "../../src/llm/adapter"

describe("Adaptador Gemini", () => {
  test("traduce system, user, assistant con tool call y resultados agrupados", () => {
    const mensajes: Mensaje[] = [
      { rol: "system", contenido: "S" },
      { rol: "user", contenido: "hola" },
      { rol: "assistant", contenido: "", toolCalls: [{ id: "1", nombre: "a", args: { x: 1 } }, { id: "2", nombre: "b", args: {} }] },
      { rol: "tool", toolCallId: "1", nombre: "a", contenido: '{"ok":true}' },
      { rol: "tool", toolCallId: "2", nombre: "b", contenido: "texto plano" },
    ]
    const { system, contents } = aContenidos(mensajes)
    expect(system).toBe("S")
    expect(contents).toHaveLength(3)
    expect(contents[1]?.role).toBe("model")
    expect(contents[2]?.parts).toHaveLength(2)
    expect(contents[2]?.parts[1]?.functionResponse?.response).toEqual({ resultado: "texto plano" })
  })

  test("reenvía las partes nativas (thoughtSignature) tal cual", () => {
    const nativo = [{ functionCall: { name: "a", args: {} }, thoughtSignature: "sig" }]
    const { contents } = aContenidos([{ rol: "assistant", contenido: "", toolCalls: [], nativo }])
    expect(contents[0]?.parts).toEqual(nativo)
  })

  test("interpreta texto, tool calls y tokens; ignora pensamientos", () => {
    let n = 0
    const r = deRespuesta(
      {
        candidates: [{ content: { parts: [{ text: "piensa", thought: true }, { text: "Hola" }, { functionCall: { name: "t", args: { a: 1 } } }] } }],
        usageMetadata: { totalTokenCount: 42 },
      },
      () => `id-${++n}`,
    )
    expect(r.texto).toBe("Hola")
    expect(r.toolCalls).toEqual([{ id: "id-1", nombre: "t", args: { a: 1 } }])
    expect(r.tokens).toBe(42)
  })

  test("sin candidatos lanza ErrorProveedor", () => {
    expect(() => deRespuesta({ promptFeedback: { blockReason: "SAFETY" } }, () => "x")).toThrow(ErrorProveedor)
  })

  test("limpia el esquema a lo que acepta Gemini", () => {
    const limpio = limpiarEsquema({
      $schema: "x",
      type: "object",
      additionalProperties: false,
      properties: {
        a: { type: "string", pattern: "^x$", description: "d" },
        b: { anyOf: [{ type: "number" }, { type: "null" }] },
        c: { type: "integer", minimum: -9007199254740991, maximum: 10 },
      },
      required: ["a"],
    })
    expect(limpio).toEqual({
      type: "object",
      properties: { a: { type: "string", description: "d" }, b: { type: "number", nullable: true }, c: { type: "integer", maximum: 10 } },
      required: ["a"],
    })
  })

  test("nunca expone la clave: va en cabecera, no en la URL; errores sin detalle sensible", async () => {
    let urlUsada = ""
    let cabecera = ""
    const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
      urlUsada = String(url)
      cabecera = new Headers(init?.headers).get("x-goog-api-key") ?? ""
      return new Response("{}", { status: 401 })
    }) as typeof fetch
    const p = new ProveedorGemini({ apiKey: "CLAVE-SECRETA", modelo: "gemini-x", fetchFn: fetchFalso, respaldo: [] })
    const e = await p.enviar([{ rol: "user", contenido: "hola" }], []).catch((x: unknown) => x)
    expect(urlUsada).not.toContain("CLAVE-SECRETA")
    expect(cabecera).toBe("CLAVE-SECRETA")
    expect(e).toBeInstanceOf(ErrorProveedor)
    expect((e as Error).message).not.toContain("CLAVE-SECRETA")
  })

  test("traduce el nivel de razonamiento al campo correcto", () => {
    expect(configuracionRazonamiento(undefined)).toBeUndefined()
    expect(configuracionRazonamiento("low")).toEqual({ thinkingLevel: "low" })
    expect(configuracionRazonamiento("0")).toEqual({ thinkingBudget: 0 })
  })

  test("envía thinkingConfig cuando está configurado", async () => {
    let cuerpo: Record<string, unknown> = {}
    const fetchFalso = (async (_url: string | URL | Request, init?: RequestInit) => {
      cuerpo = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }))
    }) as typeof fetch
    await new ProveedorGemini({ apiKey: "k", modelo: "m", fetchFn: fetchFalso, razonamiento: "low" }).enviar([{ rol: "user", contenido: "hola" }], [])
    expect(cuerpo.generationConfig).toEqual({ temperature: 0, thinkingConfig: { thinkingLevel: "low" } })
  })

  test("ante saturación (503) reintenta y luego usa el modelo de respaldo", async () => {
    const llamadas: string[] = []
    const fetchFalso = (async (url: string | URL | Request) => {
      const u = String(url)
      llamadas.push(u.includes("respaldo") ? "respaldo" : "principal")
      if (!u.includes("respaldo")) return new Response("{}", { status: 503 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "desde respaldo" }] } }] }))
    }) as typeof fetch
    const p = new ProveedorGemini({ apiKey: "k", modelo: "principal", respaldo: ["respaldo"], reintentos: 1, esperaBaseMs: 1, fetchFn: fetchFalso })
    const r = await p.enviar([{ rol: "user", contenido: "hola" }], [])
    expect(r.texto).toBe("desde respaldo")
    expect(llamadas).toEqual(["principal", "principal", "respaldo"])
  })

  test("si el modelo rechaza el nivel de razonamiento (400) reintenta sin él", async () => {
    const cuerpos: Record<string, unknown>[] = []
    const fetchFalso = (async (_url: string | URL | Request, init?: RequestInit) => {
      const c = JSON.parse(String(init?.body)) as Record<string, unknown>
      cuerpos.push(c)
      const conPensamiento = JSON.stringify(c).includes("thinkingConfig")
      return conPensamiento
        ? new Response("{}", { status: 400 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }))
    }) as typeof fetch
    const r = await new ProveedorGemini({ apiKey: "k", modelo: "m", razonamiento: "low", fetchFn: fetchFalso }).enviar([{ rol: "user", contenido: "x" }], [])
    expect(r.texto).toBe("ok")
    expect(cuerpos).toHaveLength(2)
  })

  test("error no reintentable (401) falla de inmediato", async () => {
    let n = 0
    const fetchFalso = (async (_url: string | URL | Request) => {
      n++
      return new Response("{}", { status: 401 })
    }) as typeof fetch
    const e = await new ProveedorGemini({ apiKey: "k", modelo: "m", respaldo: ["r"], fetchFn: fetchFalso }).enviar([{ rol: "user", contenido: "x" }], []).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErrorProveedor)
    expect(n).toBe(1)
  })
})
