/** Utilidades puras del dominio: texto, fechas y números. Sin E/S. */

/** Error de negocio con mensaje apto para el usuario (la herramienta lo devuelve como `{ ok: false, error }`). */
export class ErrorNegocio extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = "ErrorNegocio"
  }
}

export function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

export function normalizar(texto: string): string {
  return sinTildes(texto).toLowerCase().replace(/\s+/g, " ").trim()
}

export function slug(texto: string): string {
  return sinTildes(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Nombre de carpeta del cliente: sin la sociedad (S.A.S., S.A., S.A.C., S. de R.L., Ltda.). */
export function slugCliente(cliente: string): string {
  const sinSociedad = cliente.replace(/[\s,]+(S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?\s?C\.?|S\.?\s?A\.?|S\.\s?de\s?R\.?\s?L\.?|Ltda\.?|S\.?R\.?L\.?)\s*$/i, "")
  return slug(sinSociedad)
}

/** Similitud de Dice sobre bigramas de texto normalizado (0 a 1). */
export function similitud(a: string, b: string): number {
  const bigramas = (t: string): string[] => {
    const s = normalizar(t).replace(/[^a-z0-9 ]/g, "")
    const salida: string[] = []
    for (let i = 0; i < s.length - 1; i++) salida.push(s.slice(i, i + 2))
    return salida
  }
  const x = bigramas(a)
  const y = bigramas(b)
  if (!x.length || !y.length) return 0
  const conteo = new Map<string, number>()
  for (const g of x) conteo.set(g, (conteo.get(g) ?? 0) + 1)
  let comunes = 0
  for (const g of y) {
    const n = conteo.get(g) ?? 0
    if (n > 0) {
      comunes++
      conteo.set(g, n - 1)
    }
  }
  return (2 * comunes) / (x.length + y.length)
}

export const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

export function fechaIso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
}

export function esFechaValida(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasDelMes(anio, mes)
}

/** Construye una fecha desde día, nombre de mes y año; lanza ErrorNegocio si no existe en el calendario. */
export function fechaDesdeTexto(dia: number, mes: string, anio: number): string {
  const numeroMes = MESES[normalizar(mes)]
  const iso = numeroMes ? fechaIso(anio, numeroMes, dia) : ""
  if (!numeroMes || !esFechaValida(iso)) throw new ErrorNegocio(`fecha inválida en el documento: ${dia} de ${mes} de ${anio}`)
  return iso
}

/** Suma meses a una fecha ISO; si el día no existe en el mes destino, usa el último día. */
export function sumarMeses(iso: string, meses: number): string {
  const [anio, mes, dia] = iso.split("-").map(Number) as [number, number, number]
  const total = anio * 12 + (mes - 1) + meses
  const nuevoAnio = Math.floor(total / 12)
  const nuevoMes = (total % 12) + 1
  return fechaIso(nuevoAnio, nuevoMes, Math.min(dia, diasDelMes(nuevoAnio, nuevoMes)))
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

export function hoyIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Convierte "265.000.000", "120,000.00" o "1500000" a número. */
export function numeroDesdeTexto(texto: string): number | null {
  const s = texto.trim().replace(/[.,]$/, "")
  let limpio: string
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) limpio = s.replace(/\./g, "").replace(",", ".")
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) limpio = s.replace(/,/g, "")
  else if (/^\d+([.,]\d+)?$/.test(s)) limpio = s.replace(",", ".")
  else return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}
