// Prueba de humo contra un despliegue: bun run smoke -- https://url [codigo]
const [base, codigo = ""] = process.argv.slice(2)
if (!base) {
  console.error("Uso: bun run smoke -- <url> [codigo_acceso]")
  process.exit(1)
}

let fallos = 0
async function verificar(nombre: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    const ok = await fn()
    console.log(`${ok ? "✓" : "✗"} ${nombre}`)
    if (!ok) fallos++
  } catch (e) {
    console.log(`✗ ${nombre}: ${e instanceof Error ? e.message : "error"}`)
    fallos++
  }
}

const sesion = `smoke-${Date.now()}`
const cabeceras = { "content-type": "application/json", "x-access-code": codigo }

await verificar("health responde ok", async () => {
  const d = (await (await fetch(`${base}/api/health`)).json()) as { ok?: boolean }
  return d.ok === true
})
await verificar("front disponible", async () => (await fetch(base)).status === 200)
await verificar("sin código responde 401 (si hay código configurado)", async () => {
  if (!codigo) return true
  const r = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  return r.status === 401
})
await verificar("chat responde", async () => {
  const r = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: cabeceras,
    body: JSON.stringify({ sessionId: sesion, message: "Responde solo: ok" }),
  })
  const d = (await r.json()) as { reply?: string }
  return r.status === 200 && typeof d.reply === "string" && d.reply.length > 0
})
await fetch(`${base}/api/sessions/${sesion}/reset`, { method: "POST", headers: cabeceras }).catch(() => undefined)

console.log(fallos === 0 ? "\nSmoke OK" : `\n${fallos} verificación(es) fallaron`)
process.exit(fallos === 0 ? 0 : 1)

export {}
