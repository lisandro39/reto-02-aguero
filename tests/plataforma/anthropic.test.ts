import { describe, expect, test } from "bun:test"
import { aMensajes, deRespuestaAnthropic, esquemaEntrada, ProveedorAnthropic } from "../../src/llm/anthropic"
import { ErrorProveedor, type Mensaje } from "../../src/llm/adapter"
import { cargarConfig } from "../../src/config"
import { crearProveedor } from "../../src/server"

const okRespuesta = (texto: string) =>
  new Response(JSON.stringify({ content: [{ type: "text", text: texto }], usage: { input_tokens: 10, output_tokens: 2 } }))

describe("Adaptador Anthropic", () => {
  test("traduce historial: system aparte, tool_use y tool_result agrupados, errores marcados", () => {
    const mensajes: Mensaje[] = [
      { rol: "system", contenido: "S" },
      { rol: "user", contenido: "hola" },
      { rol: "assistant", contenido: "voy", toolCalls: [{ id: "tu_1", nombre: "a", args: { x: 1 } }, { id: "tu_2", nombre: "b", args: {} }] },
      { rol: "tool", toolCallId: "tu_1", nombre: "a", contenido: '{"ok":true,"data":{}}' },
      { rol: "tool", toolCallId: "tu_2", nombre: "b", contenido: '{"ok":false,"error":"x"}' },
    ]
    const { system, messages } = aMensajes(mensajes)
    expect(system).toBe("S")
    expect(messages).toHaveLength(3)
    expect(messages[1]?.content).toEqual([
      { type: "text", text: "voy" },
      { type: "tool_use", id: "tu_1", name: "a", input: { x: 1 } },
      { type: "tool_use", id: "tu_2", name: "b", input: {} },
    ])
    expect(messages[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "tu_1", content: '{"ok":true,"data":{}}' },
      { type: "tool_result", tool_use_id: "tu_2", content: '{"ok":false,"error":"x"}', is_error: true },
    ])
  })

  test("interpreta texto, tool_use (con su id) y tokens", () => {
    const r = deRespuestaAnthropic({
      content: [
        { type: "text", text: "Llamo" },
        { type: "tool_use", id: "toolu_9", name: "t", input: { a: 1 } },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    })
    expect(r.texto).toBe("Llamo")
    expect(r.toolCalls).toEqual([{ id: "toolu_9", nombre: "t", args: { a: 1 } }])
    expect(r.tokens).toBe(120)
  })

  test("esquema de entrada sin $schema y siempre de tipo object", () => {
    expect(esquemaEntrada({ $schema: "x", type: "object", properties: { a: { type: "string" } } })).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
    })
    expect(esquemaEntrada({})).toEqual({ type: "object", properties: {} })
  })

  test("la clave va en cabecera x-api-key, nunca en URL ni en el error", async () => {
    let url = ""
    let clave = ""
    const fetchFalso = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u)
      clave = new Headers(init?.headers).get("x-api-key") ?? ""
      return new Response("{}", { status: 401 })
    }) as typeof fetch
    const e = await new ProveedorAnthropic({ apiKey: "SK-SECRETA", modelo: "m", fetchFn: fetchFalso })
      .enviar([{ rol: "user", contenido: "x" }], [])
      .catch((x: unknown) => x)
    expect(url).not.toContain("SK-SECRETA")
    expect(clave).toBe("SK-SECRETA")
    expect(e).toBeInstanceOf(ErrorProveedor)
    expect((e as Error).message).not.toContain("SK-SECRETA")
  })

  test("envía herramientas con input_schema y sin temperature (no soportado)", async () => {
    let cuerpo: Record<string, unknown> = {}
    const fetchFalso = (async (_u: string | URL | Request, init?: RequestInit) => {
      cuerpo = JSON.parse(String(init?.body)) as Record<string, unknown>
      return okRespuesta("ok")
    }) as typeof fetch
    await new ProveedorAnthropic({ apiKey: "k", modelo: "claude-x", fetchFn: fetchFalso }).enviar(
      [{ rol: "system", contenido: "S" }, { rol: "user", contenido: "hola" }],
      [{ nombre: "t_eco", descripcion: "eco", parametros: { type: "object", properties: { texto: { type: "string" } } } }],
    )
    expect(cuerpo.model).toBe("claude-x")
    expect(cuerpo.system).toBe("S")
    expect(cuerpo.temperature).toBeUndefined()
    expect(cuerpo.tools).toEqual([{ name: "t_eco", description: "eco", input_schema: { type: "object", properties: { texto: { type: "string" } } } }])
  })

  test("ante saturación (529) reintenta y luego usa el respaldo", async () => {
    const modelos: string[] = []
    const fetchFalso = (async (_u: string | URL | Request, init?: RequestInit) => {
      const m = String((JSON.parse(String(init?.body)) as { model: string }).model)
      modelos.push(m)
      return m === "principal" ? new Response("{}", { status: 529 }) : okRespuesta("respaldo ok")
    }) as typeof fetch
    const r = await new ProveedorAnthropic({ apiKey: "k", modelo: "principal", respaldo: ["respaldo"], reintentos: 1, esperaBaseMs: 1, fetchFn: fetchFalso })
      .enviar([{ rol: "user", contenido: "x" }], [])
    expect(r.texto).toBe("respaldo ok")
    expect(modelos).toEqual(["principal", "principal", "respaldo"])
  })
})

describe("Selección de proveedor (cambiar de proveedor no toca el ciclo)", () => {
  test("anthropic es el proveedor por defecto con claude-haiku-5-5", () => {
    const c = cargarConfig({ ANTHROPIC_API_KEY: "k" })
    expect(c.LLM_MODEL).toBe("claude-haiku-5-5")
    expect(crearProveedor(c).proveedor).toBe("anthropic")
  })
  test("gemini y mock se eligen por variable de entorno", () => {
    expect(crearProveedor(cargarConfig({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" })).modelo).toBe("gemini-flash-latest")
    expect(crearProveedor(cargarConfig({ LLM_PROVIDER: "mock" })).proveedor).toBe("mock")
  })
  test("exige la clave del proveedor elegido", () => {
    expect(() => cargarConfig({ LLM_PROVIDER: "anthropic" })).toThrow("ANTHROPIC_API_KEY")
  })
})
