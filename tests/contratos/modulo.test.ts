import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { contenidoModulo } from "../../scripts/empaquetar-modulo"
import * as app from "../../src/tools/contratos"
import * as modulo from "../../modulo/tools/contratos"

const raiz = join(import.meta.dir, "..", "..")

describe("Bonus · módulo reutilizable", () => {
  test("agent.md y SKILL.md están sincronizados con prompt y conocimiento de la app", async () => {
    const { agente, skill } = await contenidoModulo()
    expect(await readFile(join(raiz, "modulo", "agent.md"), "utf8")).toBe(agente)
    expect(await readFile(join(raiz, "modulo", "skill", "registro-contratos", "SKILL.md"), "utf8")).toBe(skill)
  })

  test("las herramientas del módulo son las mismas de la app", () => {
    expect(modulo.registrar).toBe(app.registrar)
    expect(modulo.extraer).toBe(app.extraer)
    expect(Object.keys(modulo).sort()).toEqual(["alertas", "extraer", "leer_buzon", "procesar_buzon", "registrar", "validar"])
  })
})
