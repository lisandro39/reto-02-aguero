import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { nuevaSesion, type Sesion } from "./ciclo"

export const PATRON_SESION = /^[A-Za-z0-9-]{8,64}$/

export class ErrorLimiteSesiones extends Error {}

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta)
    return true
  } catch {
    return false
  }
}

/** Sesiones en memoria con respaldo en archivo; cada sesión tiene su carpeta y, opcionalmente, su copia de datos. */
export class AlmacenSesiones {
  private readonly mapa = new Map<string, Sesion>()
  private readonly colas = new Map<string, Promise<unknown>>()

  constructor(
    private readonly raiz: string,
    private readonly dirSesiones: string,
    private readonly max: number,
    private readonly sandbox: boolean,
  ) {}

  carpeta(id: string): string {
    return join(this.dirSesiones, id)
  }

  /** Raíz de trabajo de las herramientas para esta sesión. */
  async directorioTrabajo(id: string): Promise<string> {
    if (!this.sandbox) return this.raiz
    const destino = this.carpeta(id)
    const fixtures = join(this.raiz, "fixtures")
    if ((await existe(fixtures)) && !(await existe(join(destino, "fixtures")))) {
      await mkdir(destino, { recursive: true })
      await cp(fixtures, join(destino, "fixtures"), { recursive: true })
    }
    await mkdir(destino, { recursive: true })
    return destino
  }

  async obtener(id: string, crear: boolean): Promise<Sesion | null> {
    const enMemoria = this.mapa.get(id)
    if (enMemoria) return enMemoria
    const archivo = join(this.carpeta(id), "sesion.json")
    if (await existe(archivo)) {
      const sesion = JSON.parse(await readFile(archivo, "utf8")) as Sesion
      this.mapa.set(id, sesion)
      return sesion
    }
    if (!crear) return null
    if (this.mapa.size >= this.max) throw new ErrorLimiteSesiones("Se alcanzó el máximo de sesiones activas")
    const sesion = nuevaSesion(id)
    this.mapa.set(id, sesion)
    return sesion
  }

  async guardar(sesion: Sesion): Promise<void> {
    await mkdir(this.carpeta(sesion.id), { recursive: true })
    await writeFile(join(this.carpeta(sesion.id), "sesion.json"), JSON.stringify(sesion), "utf8")
  }

  async reiniciar(id: string): Promise<void> {
    this.mapa.delete(id)
    await rm(this.carpeta(id), { recursive: true, force: true })
  }

  /** Serializa operaciones de una misma sesión (evita turnos simultáneos). */
  async conBloqueo<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previo = this.colas.get(id) ?? Promise.resolve()
    const actual = previo.then(fn, fn)
    this.colas.set(
      id,
      actual.catch(() => undefined),
    )
    return actual
  }
}
