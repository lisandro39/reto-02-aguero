import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

export type EntradaLog = {
  ts: string
  herramienta: string
  mensaje_id: string | null
  ok: boolean
  resumen: string
}

/** Agrega una línea a `<directory>/out/log.jsonl`. */
export async function registrarLog(directory: string, entrada: EntradaLog): Promise<void> {
  const dir = join(directory, "out")
  await mkdir(dir, { recursive: true })
  await appendFile(join(dir, "log.jsonl"), `${JSON.stringify(entrada)}\n`, "utf8")
}
