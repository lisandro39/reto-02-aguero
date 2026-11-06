import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { z } from "zod"
import { cargarHerramientas, Registro } from "../../src/agent/herramientas"

const ctx = { directory: ".", sessionId: "test-sesion" }

function registroDePrueba(): Registro {
  const r = new Registro()
  r.registrarModulo("demo", {
    suma: {
      description: "Suma dos números",
      args: { a: z.number().describe("a"), b: z.number().describe("b") },
      async execute(args: { a: number; b: number }) {
        return JSON.stringify({ ok: true, data: { total: args.a + args.b } })
      },
    },
    explota: {
      description: "Lanza una excepción",
      args: {},
      async execute() {
        throw new Error("boom")
      },
    },
    noEsHerramienta: 42,
  })
  return r
}

describe("Registro de herramientas", () => {
  test("nombra cada herramienta como <archivo>_<export> e ignora exports que no son herramientas", () => {
    expect(registroDePrueba().nombres()).toEqual(["demo_suma", "demo_explota"])
  })

  test("expone definiciones con JSON Schema para el modelo", () => {
    const def = registroDePrueba().definiciones().find((d) => d.nombre === "demo_suma")
    expect(def?.descripcion).toBe("Suma dos números")
    expect(def?.parametros.type).toBe("object")
    expect(Object.keys(def?.parametros.properties as object)).toEqual(["a", "b"])
  })

  test("ejecuta con argumentos válidos", async () => {
    const r = await registroDePrueba().ejecutar("demo_suma", { a: 2, b: 3 }, ctx)
    expect(r.ok).toBe(true)
    expect(JSON.parse(r.salida).data.total).toBe(5)
  })

  test("rechaza argumentos inválidos sin ejecutar y devuelve error legible", async () => {
    const r = await registroDePrueba().ejecutar("demo_suma", { a: "dos" }, ctx)
    expect(r.ok).toBe(false)
    expect(JSON.parse(r.salida).error).toContain("Argumentos inválidos")
  })

  test("nunca lanza: una excepción se convierte en { ok: false }", async () => {
    const r = await registroDePrueba().ejecutar("demo_explota", {}, ctx)
    expect(r.ok).toBe(false)
    expect(JSON.parse(r.salida).error).toContain("boom")
  })

  test("herramienta desconocida devuelve error", async () => {
    const r = await registroDePrueba().ejecutar("demo_no_existe", {}, ctx)
    expect(JSON.parse(r.salida)).toEqual({ ok: false, error: "Herramienta desconocida: demo_no_existe" })
  })

  test("detecta nombres duplicados", () => {
    const r = registroDePrueba()
    expect(() => r.registrarModulo("demo", { suma: { description: "x", args: {}, execute: async () => "" } })).toThrow()
  })

  test("carga herramientas desde una carpeta", async () => {
    const r = await cargarHerramientas(join(import.meta.dir, "..", "apoyo"))
    expect(r.nombres().length).toBeGreaterThan(0)
  })
})
