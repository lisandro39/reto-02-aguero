import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

/** System prompt = agent/prompt.md (comportamiento) + src/knowledge/*.md (conocimiento del proceso). */
export async function cargarSistema(raiz: string): Promise<string> {
  const prompt = await readFile(join(raiz, "agent", "prompt.md"), "utf8")
  const dirConocimiento = join(raiz, "src", "knowledge")
  const archivos = (await readdir(dirConocimiento).catch(() => [] as string[])).filter((f) => f.endsWith(".md")).sort()
  const conocimiento = await Promise.all(archivos.map((f) => readFile(join(dirConocimiento, f), "utf8")))
  return [prompt.trim(), ...conocimiento.map((c) => `---\n\n${c.trim()}`)].join("\n\n")
}
