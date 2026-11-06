// Herramientas mínimas usadas por los tests de la plataforma (no forman parte del agente).
import { z } from "zod"
import { fallo, ok, type Contexto } from "../../src/agent/herramientas"

export const eco = {
  description: "Devuelve el mismo texto recibido; sirve para verificar el ciclo del agente.",
  args: { texto: z.string().min(1).describe("Texto a devolver") },
  async execute(args: { texto: string }, _ctx: Contexto): Promise<string> {
    return ok({ texto: args.texto })
  },
}

export const accion_sensible = {
  description: "Simula una acción que exige confirmación humana antes de ejecutarse.",
  args: { confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente en su último mensaje") },
  async execute(args: { confirmado?: boolean }, _ctx: Contexto): Promise<string> {
    if (!args.confirmado) return JSON.stringify({ ok: false, error: "requiere confirmación del usuario", confirmacion: true })
    return ok({ ejecutado: true })
  },
}

export const falla = {
  description: "Siempre falla de forma controlada; sirve para probar el manejo de errores.",
  args: {},
  async execute(_args: Record<string, never>, _ctx: Contexto): Promise<string> {
    return fallo("falla controlada de ejemplo")
  },
}
