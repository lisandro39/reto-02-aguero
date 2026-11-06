import { z } from "zod"

const esquema = z.object({
  PORT: z.coerce.number().int().positive().default(3020),
  HOST: z.string().min(1).default("127.0.0.1"),
  LLM_PROVIDER: z.enum(["anthropic", "gemini", "mock"]).default("anthropic"),
  /** Si se omite, se usa el modelo por defecto del proveedor. */
  LLM_MODEL: z.string().min(1).optional(),
  /** Modelos de respaldo separados por coma, usados si el principal está saturado. */
  LLM_MODEL_RESPALDO: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v.split(",").map((m) => m.trim()).filter(Boolean))),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  /** Razonamiento del modelo: minimal | low | medium | high (Gemini 3) o un número de tokens (Gemini 2.5; 0 = apagado). */
  LLM_THINKING: z.string().regex(/^(minimal|low|medium|high|\d+)$/, "usa minimal|low|medium|high o un número").optional(),
  ACCESS_CODE: z.string().optional(),
  MAX_ITERACIONES: z.coerce.number().int().min(1).max(50).default(25),
  MAX_TOKENS_SESION: z.coerce.number().int().min(1000).default(300000),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(90000),
  RATE_LIMIT_POR_MINUTO: z.coerce.number().int().min(1).default(20),
  MAX_SESIONES: z.coerce.number().int().min(1).default(200),
  SANDBOX_POR_SESION: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
})

const MODELO_POR_DEFECTO = { anthropic: "claude-haiku-5-5", gemini: "gemini-flash-latest", mock: "mock-1" } as const
const RESPALDO_POR_DEFECTO = { anthropic: [] as string[], gemini: ["gemini-flash-lite-latest"], mock: [] as string[] }

export type Config = Omit<z.infer<typeof esquema>, "LLM_MODEL" | "LLM_MODEL_RESPALDO"> & {
  LLM_MODEL: string
  LLM_MODEL_RESPALDO: string[]
}

/** Lee y valida la configuración. Los mensajes de error nunca incluyen valores. */
export function cargarConfig(env: Record<string, string | undefined> = process.env): Config {
  const limpio = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""))
  const r = esquema.safeParse(limpio)
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Configuración inválida: ${detalle}`)
  }
  const d = r.data
  if (d.LLM_PROVIDER === "gemini" && !d.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY (o usa LLM_PROVIDER=mock)")
  if (d.LLM_PROVIDER === "anthropic" && !d.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY (o usa LLM_PROVIDER=mock)")
  return {
    ...d,
    LLM_MODEL: d.LLM_MODEL ?? MODELO_POR_DEFECTO[d.LLM_PROVIDER],
    LLM_MODEL_RESPALDO: d.LLM_MODEL_RESPALDO ?? RESPALDO_POR_DEFECTO[d.LLM_PROVIDER],
  }
}
