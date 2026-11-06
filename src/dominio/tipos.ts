export const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const
export const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const
export const ESTADOS_POLIZA = ["vigente", "pendiente", "vencida", "no_aplica"] as const

export type Pais = (typeof PAISES)[number]
export type Moneda = (typeof MONEDAS)[number]
export type EstadoPoliza = (typeof ESTADOS_POLIZA)[number]

/** Campos del maestro que se extraen del documento y llevan confianza. */
export const CAMPOS = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
] as const
export type Campo = (typeof CAMPOS)[number]

export type Contrato = {
  id_contrato: string | null
  cliente: string | null
  nit_cliente: string | null
  pais: Pais | null
  objeto: string | null
  valor: number | null
  valor_indeterminado: boolean
  moneda: Moneda | null
  fecha_inicio: string | null
  fecha_fin: string | null
  plazo_meses: number | null
  requiere_poliza: boolean | null
  tipo_poliza: string | null
  poliza_condicional: boolean
  es_otrosi: boolean
  numero_otrosi: number | null
  contrato_referencia: string | null
  ampliar_garantias: boolean
  documento: string
  confianza: Record<Campo, number>
}

export type ContratoPropuesto = Partial<Pick<Contrato, Campo>>

/** Una fila del maestro (sección 7.2 del PRD), en el orden de columnas del CSV. */
export const COLUMNAS = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
  "comercial",
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
] as const
export type Columna = (typeof COLUMNAS)[number]
export type Fila = Record<Columna, string>

export const UMBRAL_CONFIANZA = 0.8
export const FECHA_CORTE = "2026-05-30"
export const DIAS_ALERTA = 60
