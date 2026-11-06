// Genera modulo/agent.md y modulo/skill/registro-contratos/SKILL.md desde las mismas fuentes que usa la app.
//   bun run modulo
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const raiz = join(import.meta.dir, "..")

export async function contenidoModulo(): Promise<{ agente: string; skill: string }> {
  const prompt = (await readFile(join(raiz, "agent", "prompt.md"), "utf8")).trim()
  const conocimiento = (await readFile(join(raiz, "src", "knowledge", "registro-contratos.md"), "utf8")).trim()
  const agente = `---
description: Registra contratos vigentes desde el buzón único, pide confirmación humana para campos dudosos y genera alertas de vencimiento y pólizas.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}
`
  const skill = `---
name: registro-contratos
description: Proceso de registro de contratos vigentes de Periferia (clasificación, confianza, revisión humana, alertas y archivo). Úsalo al procesar el buzón de contratos.
---

${conocimiento}
`
  return { agente, skill }
}

if (import.meta.main) {
  const { agente, skill } = await contenidoModulo()
  await writeFile(join(raiz, "modulo", "agent.md"), agente, "utf8")
  await writeFile(join(raiz, "modulo", "skill", "registro-contratos", "SKILL.md"), skill, "utf8")
  console.log("modulo/ actualizado")
}
