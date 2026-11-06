// Punto de entrada del proceso (local, pm2 y CI). Arranca siempre, sin depender de import.meta.main.
import { iniciar } from "./server"

await iniciar().catch((e: unknown) => {
  console.error(`No se pudo iniciar: ${e instanceof Error ? e.message : "error desconocido"}`)
  process.exit(1)
})
