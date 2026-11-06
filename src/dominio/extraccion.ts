/**
 * Extracción determinista de un contrato u otrosí desde su texto.
 * Cada campo lleva una confianza en [0, 1] según cómo se obtuvo (ver specs/02-reglas.md).
 * El modelo de lenguaje no interviene aquí.
 */
import { ErrorNegocio, fechaDesdeTexto, fechaIso, normalizar, numeroDesdeTexto, sumarMeses, MESES } from "./comun"
import { CAMPOS, MONEDAS, type Campo, type Contrato, type Moneda, type Pais } from "./tipos"

const ORDINALES = "primera|segunda|tercera|cuarta|quinta|sexta|septima|octava|novena|decima"
const RE_FECHA = /\((\d{1,2})\)\s+de\s+([a-z]+)\s+de\s+(\d{4})/g
const MONEDA_POR_PALABRA: [RegExp, Moneda][] = [
  [/\bpesos\b/, "COP"],
  [/\bdolares\b/, "USD"],
  [/\bsoles\b/, "PEN"],
  [/\bbalboas\b/, "PAB"],
  [/\blempiras\b/, "HNL"],
]
const CIUDADES: [RegExp, Pais][] = [
  [/bogota|medellin|barranquilla|cali|cartagena|bucaramanga|colombia/, "CO"],
  [/quito|guayaquil|cuenca|ecuador/, "EC"],
  [/lima|arequipa|peru/, "PE"],
  [/panama/, "PA"],
  [/tegucigalpa|san pedro sula|honduras/, "HN"],
]
const TIPOS_POLIZA: [RegExp, string][] = [
  [/cumplimiento/, "cumplimiento"],
  [/calidad/, "calidad"],
  [/salarios|prestaciones/, "salarios_prestaciones"],
  [/responsabilidad civil/, "responsabilidad_civil"],
]

type Parrafo = { original: string; norm: string }

function parrafos(texto: string): Parrafo[] {
  return texto
    .replace(/\r/g, "")
    .split(new RegExp(`\\n\\s*\\n|\\n(?=\\s*(?:(?:${ORDINALES})\\.|entre\\s))`, "i"))
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ original: p, norm: normalizar(p) }))
}

/** Párrafo de una cláusula ("SEGUNDA. VALOR." o, en un otrosí, "… cláusula SEGUNDA (VALOR) …"). */
function clausula(ps: Parrafo[], nombre: string): Parrafo | null {
  const encabezado = new RegExp(`^(${ORDINALES})\\.\\s*${nombre}\\b`)
  return ps.find((p) => encabezado.test(p.norm)) ?? ps.find((p) => p.norm.includes(`(${nombre})`)) ?? null
}

function escaparRegex(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tituloSimple(t: string): string {
  return t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, s: string, l: string) => s + l.toUpperCase())
}

function fechasEn(norm: string): { iso: string; indice: number }[] {
  return [...norm.matchAll(RE_FECHA)].map((m) => ({ iso: fechaDesdeTexto(Number(m[1]), m[2] ?? "", Number(m[3])), indice: m.index ?? 0 }))
}

function vacio(documento: string): Contrato {
  return {
    id_contrato: null,
    cliente: null,
    nit_cliente: null,
    pais: null,
    objeto: null,
    valor: null,
    valor_indeterminado: false,
    moneda: null,
    fecha_inicio: null,
    fecha_fin: null,
    plazo_meses: null,
    requiere_poliza: null,
    tipo_poliza: null,
    poliza_condicional: false,
    es_otrosi: false,
    numero_otrosi: null,
    contrato_referencia: null,
    ampliar_garantias: false,
    documento,
    confianza: Object.fromEntries(CAMPOS.map((c) => [c, 0])) as Record<Campo, number>,
  }
}

function extraerEncabezado(c: Contrato, ps: Parrafo[]): void {
  const primero = ps[0]
  if (!primero) return
  c.es_otrosi = primero.norm.startsWith("otrosi")
  const ids = [...primero.original.matchAll(/\b([A-Z]{2,3}-\d{4}-\d{2,})\b/g)].map((m) => m[1] ?? "")
  const id = c.es_otrosi ? ids.at(-1) : ids[0]
  if (id) {
    c.id_contrato = id
    c.confianza.id_contrato = 0.98
  }
  if (c.es_otrosi) {
    c.contrato_referencia = id ?? null
    const n = /otrosi\s+no\.?\s*(\d+)/.exec(primero.norm)
    c.numero_otrosi = n ? Number(n[1]) : null
  }
}

function extraerPartes(c: Contrato, texto: string, ps: Parrafo[]): void {
  const partes = ps.find((p) => p.norm.startsWith("entre"))
  if (!partes) return
  const m = /Entre\s+(?:los suscritos,\s+)?(.+?),\s+(?:identificad[ao]\s+con\s+)?(NIT|RUC|RTN)\s+([\d.\-]+\d)/i.exec(partes.original)
  if (!m) return
  const nombre = (m[1] ?? "").trim()
  const firma = [...texto.matchAll(new RegExp(escaparRegex(nombre), "gi"))].map((x) => x[0]).find((x) => x !== x.toUpperCase())
  c.cliente = firma ?? tituloSimple(nombre)
  c.confianza.cliente = firma ? 0.95 : 0.85

  const tipo = (m[2] ?? "").toUpperCase()
  const bruto = m[3] ?? ""
  const digitos = bruto.replace(/\D/g, "")
  let pais: Pais | null = null
  if (tipo === "NIT") {
    c.nit_cliente = bruto.replace(/\./g, "").replace(/-\d$/, "")
    pais = "CO"
  } else if (tipo === "RTN") {
    c.nit_cliente = digitos
    pais = "HN"
  } else {
    c.nit_cliente = bruto.includes("-") ? bruto.replace(/-/g, "") : digitos
    pais = bruto.includes("-") ? "PA" : digitos.length === 13 ? "EC" : digitos.length === 11 ? "PE" : null
  }
  c.confianza.nit_cliente = c.nit_cliente ? 0.95 : 0

  const domicilio = /domicilio en ([^,]+(?:,\s*[^,]+)?)/.exec(partes.norm.slice(0, partes.norm.indexOf("periferia") > 0 ? partes.norm.indexOf("periferia") : undefined))
  const porCiudad = domicilio ? (CIUDADES.find(([re]) => re.test(domicilio[1] ?? ""))?.[1] ?? null) : null
  c.pais = pais ?? porCiudad
  c.confianza.pais = !c.pais ? 0 : pais && porCiudad ? (pais === porCiudad ? 0.95 : 0.5) : 0.9
}

function extraerObjeto(c: Contrato, ps: Parrafo[]): void {
  const p = clausula(ps, "objeto")
  if (!p || c.es_otrosi) return
  let texto = p.original.replace(/^\s*\S+\.\s*OBJETO\.\s*/i, "").replace(/^EL CONTRATISTA\s+(se obliga a\s+)?/i, "").trim()
  texto = texto.replace(/\.$/, "")
  if (texto.length > 200) texto = texto.slice(0, 200).replace(/\s+\S*$/, "")
  c.objeto = texto.charAt(0).toUpperCase() + texto.slice(1)
  c.confianza.objeto = 0.9
}

function extraerValor(c: Contrato, ps: Parrafo[], textoNorm: string): void {
  const p = clausula(ps, "valor")
  if (!p) return
  if (/no tiene un valor determinado|valor indeterminado|por demanda|segun (la |las )?(respectiva )?orden/.test(p.norm)) {
    c.valor = 0
    c.valor_indeterminado = true
    c.confianza.valor = 0.6
  }
  const m = /\b([A-Z]{3})\s*\$?\s*(\d[\d.,]*\d)/.exec(p.original)
  if (m && !c.valor_indeterminado) {
    const codigo = m[1] ?? ""
    if (!(MONEDAS as readonly string[]).includes(codigo)) throw new ErrorNegocio(`moneda desconocida en el documento: ${codigo}`)
    const valor = numeroDesdeTexto(m[2] ?? "")
    if (valor === null) throw new ErrorNegocio(`valor ilegible en el documento: ${m[2]}`)
    c.valor = valor
    c.moneda = codigo as Moneda
    c.confianza.valor = 0.95
    c.confianza.moneda = 0.95
    return
  }
  const porPalabra = MONEDA_POR_PALABRA.find(([re]) => re.test(p.norm))?.[1]
  const enDocumento = /\b(COP|USD|PEN|PAB|HNL)\b/i.exec(textoNorm.toUpperCase())?.[1] as Moneda | undefined
  if (porPalabra) {
    c.moneda = porPalabra
    c.confianza.moneda = 0.9
  } else if (enDocumento) {
    c.moneda = enDocumento
    c.confianza.moneda = 0.85
  }
}

function fechaFirma(ps: Parrafo[], fechaCorreo: string): { iso: string; confianza: number } | null {
  const p = [...ps].reverse().find((x) => /se firma|para constancia/.test(x.norm))
  if (!p) return null
  const completa = /\((\d{1,2})\)\s+dias del mes de ([a-z]+)\s+de\s+(\d{4})/.exec(p.norm)
  if (completa) return { iso: fechaDesdeTexto(Number(completa[1]), completa[2] ?? "", Number(completa[3])), confianza: 0.9 }
  const soloMes = /en el mes de ([a-z]+) de (\d{4})/.exec(p.norm)
  if (!soloMes) return null
  const mes = MESES[soloMes[1] ?? ""]
  const anio = Number(soloMes[2])
  if (!mes) return null
  const correo = fechaCorreo.slice(0, 10)
  if (correo.startsWith(fechaIso(anio, mes, 1).slice(0, 7))) return { iso: correo, confianza: 0.8 }
  return { iso: fechaIso(anio, mes, 1), confianza: 0.5 }
}

function extraerPlazo(c: Contrato, ps: Parrafo[], fechaCorreo: string): void {
  const p = clausula(ps, "plazo")
  if (!p) return
  const fechas = fechasEn(p.norm)
  const meses = /\((\d{1,3})\)\s+meses/.exec(p.norm)
  c.plazo_meses = meses ? Number(meses[1]) : null
  const desde = p.norm.indexOf("desde")
  const hasta = p.norm.indexOf("hasta")
  const inicio = fechas.find((f) => desde >= 0 && f.indice > desde && (hasta < 0 || f.indice < hasta))
  const fin = fechas.find((f) => hasta >= 0 && f.indice > hasta)
  if (inicio) {
    c.fecha_inicio = inicio.iso
    c.confianza.fecha_inicio = 0.95
  }
  if (fin) {
    c.fecha_fin = fin.iso
    c.confianza.fecha_fin = 0.95
  }
  if (!c.fecha_inicio && !c.es_otrosi && /firma/.test(p.norm)) {
    const firma = fechaFirma(ps, fechaCorreo)
    if (firma) {
      c.fecha_inicio = firma.iso
      c.confianza.fecha_inicio = firma.confianza
    }
  }
  if (!c.fecha_fin && c.fecha_inicio && c.plazo_meses) {
    c.fecha_fin = sumarMeses(c.fecha_inicio, c.plazo_meses)
    c.confianza.fecha_fin = 0.6
  }
}

function extraerPoliza(c: Contrato, ps: Parrafo[], textoNorm: string): void {
  const garantias = clausula(ps, "garantias") ?? ps.find((p) => /poliza|garantias/.test(p.norm)) ?? null
  if (!garantias) {
    c.requiere_poliza = false
    c.tipo_poliza = ""
    c.confianza.requiere_poliza = 0.9
    c.confianza.tipo_poliza = 0.9
    return
  }
  c.requiere_poliza = true
  c.tipo_poliza = TIPOS_POLIZA.filter(([re]) => re.test(garantias.norm))
    .map(([, t]) => t)
    .join(";")
  c.poliza_condicional = /para cada orden|cuyo valor supere|en caso de que/.test(garantias.norm)
  c.ampliar_garantias = c.es_otrosi && /ampliar/.test(textoNorm)
  const confianza = c.poliza_condicional ? 0.8 : 0.95
  c.confianza.requiere_poliza = confianza
  c.confianza.tipo_poliza = c.tipo_poliza ? confianza : 0.5
}

/** Extrae el contrato desde el texto. Lanza ErrorNegocio ante texto vacío, fecha inválida o moneda desconocida. */
export function extraerContrato(texto: string, documento: string, fechaCorreo: string): Contrato {
  if (!texto.trim()) throw new ErrorNegocio("el texto del contrato está vacío")
  const c = vacio(documento)
  const ps = parrafos(texto)
  const textoNorm = normalizar(texto)
  extraerEncabezado(c, ps)
  extraerPartes(c, texto, ps)
  extraerObjeto(c, ps)
  extraerValor(c, ps, textoNorm)
  extraerPlazo(c, ps, fechaCorreo)
  extraerPoliza(c, ps, textoNorm)
  return c
}
