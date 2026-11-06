/** Acceso a fixtures y a out/ resolviendo siempre desde la raíz de trabajo (ctx.directory). */
import { appendFile, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { ErrorNegocio } from "./comun"
import { textoDePdf } from "./pdf"
import { COLUMNAS, type Fila } from "./tipos"

export const PATRON_MENSAJE = /^msg-\d{3}$/

export const rutas = (raiz: string) => ({
  buzon: join(raiz, "fixtures", "reto-02", "buzon"),
  maestroFixture: join(raiz, "fixtures", "reto-02", "maestro-contratos.csv"),
  comerciales: join(raiz, "fixtures", "reto-02", "comerciales.json"),
  sharepoint: join(raiz, "out", "sharepoint"),
  maestro: join(raiz, "out", "sharepoint", "maestro-contratos.csv"),
  historial: join(raiz, "out", "sharepoint", "historial.jsonl"),
  procesados: join(raiz, "out", "procesados.json"),
  alertas: join(raiz, "out", "alertas.md"),
})

export async function existe(ruta: string): Promise<boolean> {
  return stat(ruta)
    .then(() => true)
    .catch(() => false)
}

// ---------- Buzón ----------
export type Correo = { id: string; de: string; para: string; asunto: string; fecha: string; cuerpo: string; adjuntos: string[] }

export async function listarMensajes(raiz: string): Promise<string[]> {
  const entradas = await readdir(rutas(raiz).buzon, { withFileTypes: true }).catch(() => [])
  return entradas
    .filter((e) => e.isDirectory() && PATRON_MENSAJE.test(e.name))
    .map((e) => e.name)
    .sort()
}

export async function leerCorreo(raiz: string, id: string): Promise<Correo> {
  if (!PATRON_MENSAJE.test(id)) throw new ErrorNegocio(`Identificador de mensaje inválido: ${id}`)
  const ruta = join(rutas(raiz).buzon, id, "correo.json")
  if (!(await existe(ruta))) throw new ErrorNegocio(`El mensaje ${id} no existe en el buzón`)
  return JSON.parse(await readFile(ruta, "utf8")) as Correo
}

/** Adjunto que contiene el contrato u otrosí; null si el correo no trae uno. */
export function adjuntoContrato(correo: Correo): string | null {
  return correo.adjuntos.find((a) => /^(contrato|otrosi)[^/\\]*\.(txt|pdf)$/i.test(a)) ?? null
}

/** Texto del adjunto: .txt tal cual; .pdf con texto nativo vía unpdf. */
export async function leerAdjunto(raiz: string, id: string, adjunto: string): Promise<string> {
  const ruta = join(rutas(raiz).buzon, id, adjunto)
  if (/\.pdf$/i.test(adjunto)) return textoDePdf(new Uint8Array(await readFile(ruta)))
  return readFile(ruta, "utf8")
}

export function rutaAdjunto(raiz: string, id: string, adjunto: string): string {
  return join(rutas(raiz).buzon, id, adjunto)
}

export async function leerComerciales(raiz: string): Promise<{ email: string; nombre: string; region: string }[]> {
  return JSON.parse(await readFile(rutas(raiz).comerciales, "utf8")) as { email: string; nombre: string; region: string }[]
}

// ---------- Maestro (CSV) ----------
function parsearLineaCsv(linea: string): string[] {
  const campos: string[] = []
  let actual = ""
  let comillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (comillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"'
        i++
      } else if (c === '"') comillas = false
      else actual += c
    } else if (c === '"') comillas = true
    else if (c === ",") {
      campos.push(actual)
      actual = ""
    } else actual += c
  }
  campos.push(actual)
  return campos
}

function celdaCsv(valor: string): string {
  return /[",\n\r]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

export function parsearMaestro(csv: string): Fila[] {
  const lineas = csv.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "")
  return lineas.slice(1).map((l) => {
    const celdas = parsearLineaCsv(l)
    return Object.fromEntries(COLUMNAS.map((c, i) => [c, celdas[i] ?? ""])) as Fila
  })
}

export function serializarMaestro(filas: Fila[]): string {
  return `${[COLUMNAS.join(","), ...filas.map((f) => COLUMNAS.map((c) => celdaCsv(f[c])).join(","))].join("\n")}\n`
}

/** RN6: la primera escritura copia el fixture a out/sharepoint; el fixture nunca se modifica. */
export async function asegurarMaestro(raiz: string): Promise<void> {
  const r = rutas(raiz)
  if (await existe(r.maestro)) return
  await mkdir(r.sharepoint, { recursive: true })
  await copyFile(r.maestroFixture, r.maestro)
}

/** Lee el maestro vigente: la copia en out/ si existe; si no, el fixture. */
export async function leerMaestro(raiz: string): Promise<Fila[]> {
  const r = rutas(raiz)
  const ruta = (await existe(r.maestro)) ? r.maestro : r.maestroFixture
  return parsearMaestro(await readFile(ruta, "utf8"))
}

export async function escribirMaestro(raiz: string, filas: Fila[]): Promise<void> {
  await asegurarMaestro(raiz)
  await writeFile(rutas(raiz).maestro, serializarMaestro(filas), "utf8")
}

// ---------- Historial, procesados y archivo ----------
export type EntradaHistorial = { ts: string; id_contrato: string; accion: string; cambios: unknown; mensaje_id: string; documento?: string }

export async function agregarHistorial(raiz: string, entrada: EntradaHistorial): Promise<void> {
  await mkdir(rutas(raiz).sharepoint, { recursive: true })
  await appendFile(rutas(raiz).historial, `${JSON.stringify(entrada)}\n`, "utf8")
}

export type Procesado = { clasificacion: string; accion: string; id_contrato: string | null; motivo?: string; ts: string }

export async function leerProcesados(raiz: string): Promise<Record<string, Procesado>> {
  const ruta = rutas(raiz).procesados
  if (!(await existe(ruta))) return {}
  return JSON.parse(await readFile(ruta, "utf8")) as Record<string, Procesado>
}

export async function marcarProcesado(raiz: string, id: string, procesado: Procesado): Promise<void> {
  const actuales = await leerProcesados(raiz)
  actuales[id] = procesado
  await mkdir(dirname(rutas(raiz).procesados), { recursive: true })
  await writeFile(rutas(raiz).procesados, `${JSON.stringify(actuales, null, 2)}\n`, "utf8")
}

/** Copia el documento a out/sharepoint/<rutaRelativa>. */
export async function archivarDocumento(raiz: string, origen: string, rutaRelativa: string): Promise<void> {
  const destino = join(rutas(raiz).sharepoint, ...rutaRelativa.split("/"))
  await mkdir(dirname(destino), { recursive: true })
  await copyFile(origen, destino)
}
