import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { ejecutarTurno, nuevaSesion, type OpcionesCiclo } from "../../src/agent/ciclo"
import { Registro } from "../../src/agent/herramientas"
import type { EntradaLog } from "../../src/agent/log"
import { ErrorProveedor, type Respuesta } from "../../src/llm/adapter"
import { ProveedorMock, type Guion } from "../../src/llm/mock"

function registro(): Registro {
  const r = new Registro()
  r.registrarModulo("t", {
    eco: {
      description: "eco",
      args: { texto: z.string() },
      async execute(a: { texto: string }) {
        return JSON.stringify({ ok: true, data: { texto: a.texto } })
      },
    },
    sensible: {
      description: "requiere confirmación",
      args: { confirmado: z.boolean().optional(), mensaje_id: z.string().optional() },
      async execute(a: { confirmado?: boolean }) {
        return a.confirmado
          ? JSON.stringify({ ok: true, data: { hecho: true } })
          : JSON.stringify({ ok: false, error: "requiere confirmación", confirmacion: true })
      },
    },
  })
  return r
}

function opciones(guion: Guion, extra: Partial<OpcionesCiclo> = {}): OpcionesCiclo & { log: EntradaLog[] } {
  const log: EntradaLog[] = []
  return {
    llm: new ProveedorMock(guion),
    registro: registro(),
    sistema: "sistema de prueba",
    ctx: { directory: ".", sessionId: "s-123456" },
    maxIteraciones: 5,
    maxTokensSesion: 10_000,
    timeoutMs: 1000,
    registrarLog: async (e) => {
      log.push(e)
    },
    log,
    ...extra,
  }
}

const texto = (t: string): Respuesta => ({ texto: t, toolCalls: [], tokens: 1 })
const llamada = (nombre: string, args: Record<string, unknown>): Respuesta => ({
  texto: "",
  toolCalls: [{ id: crypto.randomUUID(), nombre, args }],
  tokens: 1,
})

describe("Ciclo del agente", () => {
  test("responde sin herramientas en una iteración", async () => {
    const s = nuevaSesion("s-123456")
    const r = await ejecutarTurno(s, "hola", opciones(() => texto("hola!")))
    expect(r.reply).toBe("hola!")
    expect(r.iteraciones).toBe(1)
    expect(s.turnos).toHaveLength(1)
  })

  test("envía el system prompt como primer mensaje", async () => {
    const op = opciones(() => texto("ok"))
    await ejecutarTurno(nuevaSesion("s-123456"), "hola", op)
    const mock = op.llm as ProveedorMock
    expect(mock.llamadas[0]?.[0]).toEqual({ rol: "system", contenido: "sistema de prueba" })
  })

  test("ejecuta herramientas, devuelve el resultado al modelo y registra log (CA4)", async () => {
    const op = opciones((m) => (m.at(-1)?.rol === "tool" ? texto("listo") : llamada("t_eco", { texto: "x" })))
    const r = await ejecutarTurno(nuevaSesion("s-123456"), "usa eco", op)
    expect(r.reply).toBe("listo")
    expect(r.toolCalls).toHaveLength(1)
    expect(r.toolCalls[0]?.ok).toBe(true)
    expect(op.log).toHaveLength(1)
    expect(op.log[0]?.herramienta).toBe("t_eco")
  })

  test("CA1: respeta el tope de iteraciones y explica lo pendiente", async () => {
    const r = await ejecutarTurno(nuevaSesion("s-123456"), "loop", opciones(() => llamada("t_eco", { texto: "x" })))
    expect(r.iteraciones).toBe(5)
    expect(r.error).toBe("tope_iteraciones")
    expect(r.reply).toContain("tope de 5 iteraciones")
  })

  test("CA5: un error del proveedor se informa en claro y la sesión sigue", async () => {
    const s = nuevaSesion("s-123456")
    const r = await ejecutarTurno(s, "hola", opciones(() => {
      throw new ErrorProveedor("cuota agotada")
    }))
    expect(r.error).toBe("proveedor")
    expect(r.reply).toContain("cuota agotada")
    const r2 = await ejecutarTurno(s, "de nuevo", opciones(() => texto("ahora sí")))
    expect(r2.reply).toBe("ahora sí")
  })

  test("CA5: timeout del proveedor", async () => {
    const lento: Guion = () => new Promise((res) => setTimeout(() => res(texto("tarde")), 200))
    const r = await ejecutarTurno(nuevaSesion("s-123456"), "hola", opciones(lento, { timeoutMs: 50 }))
    expect(r.reply).toContain("timeout")
  })

  test("CA5: un error de herramienta no corta el turno", async () => {
    const op = opciones((m) => (m.at(-1)?.rol === "tool" ? texto("seguí") : llamada("t_inexistente", {})))
    const r = await ejecutarTurno(nuevaSesion("s-123456"), "x", op)
    expect(r.toolCalls[0]?.ok).toBe(false)
    expect(r.reply).toBe("seguí")
  })

  test("tope de tokens por sesión", async () => {
    const s = nuevaSesion("s-123456")
    s.tokens = 10_000
    const r = await ejecutarTurno(s, "hola", opciones(() => texto("no debería")))
    expect(r.error).toBe("tope_tokens")
  })

  test("CA3: marca needsConfirmation cuando una herramienta lo pide", async () => {
    const s = nuevaSesion("s-123456")
    const r = await ejecutarTurno(s, "haz", opciones((m) => (m.at(-1)?.rol === "tool" ? texto("¿Confirmas?") : llamada("t_sensible", {}))))
    expect(r.needsConfirmation).toBe(true)
    expect(s.confirmacionPendiente).toBe(true)
  })

  test("CA3: el modelo no puede auto-confirmar sin una pregunta previa al usuario", async () => {
    const s = nuevaSesion("s-123456")
    const op = opciones((m) => (m.at(-1)?.rol === "tool" ? texto("fin") : llamada("t_sensible", { confirmado: true })))
    const r = await ejecutarTurno(s, "hazlo directo", op)
    expect(r.toolCalls[0]?.ok).toBe(false)
    expect(r.toolCalls[0]?.resumen).toContain("Confirmación humana requerida")
  })

  test("CA3: tras pedir confirmación, el siguiente turno sí puede confirmar", async () => {
    const s = nuevaSesion("s-123456")
    await ejecutarTurno(s, "haz", opciones((m) => (m.at(-1)?.rol === "tool" ? texto("¿Confirmas?") : llamada("t_sensible", {}))))
    const r = await ejecutarTurno(
      s,
      "confirmo",
      opciones((m) => (m.at(-1)?.rol === "tool" ? texto("hecho") : llamada("t_sensible", { confirmado: true }))),
    )
    expect(r.toolCalls[0]?.ok).toBe(true)
    expect(r.needsConfirmation).toBe(false)
  })
})
