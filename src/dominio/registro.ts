/** Validación (RN1–RN5) y registro (HU-4) de un mensaje del buzón. */
import { ErrorNegocio, hoyIso, similitud, slugCliente } from "./comun"
import {
  adjuntoContrato,
  agregarHistorial,
  archivarDocumento,
  asegurarMaestro,
  escribirMaestro,
  leerAdjunto,
  leerComerciales,
  leerCorreo,
  leerMaestro,
  marcarProcesado,
  rutaAdjunto,
} from "./archivos"
import { extraerContrato } from "./extraccion"
import { CAMPOS, UMBRAL_CONFIANZA, type Campo, type Contrato, type ContratoPropuesto, type Fila } from "./tipos"

export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado"
export type Diferencia = { campo: string; antes: string | number | boolean | null; despues: string | number | boolean | null }

export type Validacion = {
  mensaje_id: string
  clasificacion: Clasificacion
  motivo?: string
  id_contrato_existente?: string
  requiere_revision: string[]
  diferencias?: Diferencia[]
  contrato: Contrato | null
  comercial: string | null
  advertencias: string[]
}

const COMPARABLES: Campo[] = ["cliente", "nit_cliente", "pais", "objeto", "valor", "moneda", "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza"]
const SIMILITUD_OBJETO = 0.9

/** Valor de un campo del contrato tal como se guarda en el CSV. */
function aCelda(valor: string | number | boolean | null): string {
  return valor === null ? "" : String(valor)
}

/** Valor tipado desde una celda del CSV, para comparar y reportar. */
function desdeCelda(campo: Campo, celda: string): string | number | boolean | null {
  if (celda === "") return campo === "tipo_poliza" ? "" : null
  if (campo === "valor") return Number(celda)
  if (campo === "requiere_poliza") return celda === "true"
  return celda
}

function iguales(campo: Campo, a: string | number | boolean | null, b: string | number | boolean | null): boolean {
  if (campo === "cliente" || campo === "objeto") return typeof a === "string" && typeof b === "string" && similitud(a, b) >= SIMILITUD_OBJETO
  return aCelda(a) === aCelda(b)
}

function buscarEnMaestro(maestro: Fila[], c: Contrato): Fila | undefined {
  const porId = c.id_contrato ? maestro.find((f) => f.id_contrato === c.id_contrato) : undefined
  if (porId) return porId
  if (!c.nit_cliente || !c.objeto) return undefined
  return maestro.find((f) => f.nit_cliente === c.nit_cliente && similitud(f.objeto, c.objeto ?? "") >= SIMILITUD_OBJETO)
}

async function resolverComercial(raiz: string, email: string): Promise<{ comercial: string; advertencia?: string }> {
  const encontrado = (await leerComerciales(raiz)).find((c) => c.email.toLowerCase() === email.toLowerCase())
  if (encontrado) return { comercial: encontrado.nombre }
  return { comercial: `${email} (no registrado)`, advertencia: `Remitente no registrado en comerciales.json: ${email}` }
}

/** Aplica sobre lo extraído los campos que propone el usuario o el agente; devuelve los que cambiaron. */
function aplicarPropuesta(c: Contrato, propuesta?: ContratoPropuesto): string[] {
  if (!propuesta) return []
  const corregidos: string[] = []
  for (const campo of CAMPOS) {
    const valor = propuesta[campo]
    if (valor === undefined || aCelda(valor) === aCelda(c[campo])) continue
    ;(c as Record<Campo, unknown>)[campo] = valor
    corregidos.push(campo)
  }
  return corregidos
}

/** HU-3: clasifica un mensaje sin escribir nada. */
export async function validarMensaje(raiz: string, mensajeId: string, propuesta?: ContratoPropuesto): Promise<Validacion> {
  const correo = await leerCorreo(raiz, mensajeId)
  const adjunto = adjuntoContrato(correo)
  const { comercial, advertencia } = await resolverComercial(raiz, correo.de)
  const advertencias = advertencia ? [advertencia] : []
  const base = { mensaje_id: mensajeId, requiere_revision: [], contrato: null, comercial, advertencias }
  if (!adjunto) {
    return { ...base, clasificacion: "rechazado", motivo: `El mensaje no trae contrato ni otrosí (adjuntos: ${correo.adjuntos.join(", ") || "ninguno"})` }
  }

  const contrato = extraerContrato(await leerAdjunto(raiz, mensajeId, adjunto), adjunto, correo.fecha)
  const corregidos = aplicarPropuesta(contrato, propuesta)
  if (!contrato.cliente || (!contrato.objeto && !contrato.es_otrosi)) {
    return { ...base, clasificacion: "rechazado", motivo: "El texto no contiene partes u objeto identificables", contrato }
  }
  if (contrato.poliza_condicional) advertencias.push("Póliza condicional (por orden de servicio): se registra como pendiente para seguimiento")

  const relevantes = CAMPOS.filter((c) => !contrato.es_otrosi || contrato[c] !== null)
  const baja = relevantes.filter((c) => contrato.confianza[c] < UMBRAL_CONFIANZA)
  const revision = [...new Set([...baja, ...corregidos])]
  const existente = buscarEnMaestro(await leerMaestro(raiz), contrato)

  if (contrato.es_otrosi) {
    if (!existente) {
      return { ...base, clasificacion: "rechazado", motivo: `Otrosí de un contrato que no está en el maestro (${contrato.contrato_referencia ?? "sin número"})`, contrato }
    }
    const diferencias = calcularDiferencias(existente, contrato)
    return { ...base, clasificacion: "actualizacion", id_contrato_existente: existente.id_contrato, requiere_revision: revision, diferencias, contrato }
  }

  if (!existente) return { ...base, clasificacion: "nuevo", requiere_revision: revision, contrato }

  const mismasCondiciones = (["valor", "fecha_inicio", "fecha_fin"] as Campo[]).every((c) => iguales(c, desdeCelda(c, existente[c]), contrato[c]))
  if (mismasCondiciones) {
    return { ...base, clasificacion: "duplicado", id_contrato_existente: existente.id_contrato, motivo: `Ya registrado como ${existente.id_contrato} con el mismo valor y fechas`, contrato }
  }
  const diferencias = calcularDiferencias(existente, contrato)
  const conflictos = diferencias.map((d) => `conflicto:${d.campo}`)
  return {
    ...base,
    clasificacion: "actualizacion",
    id_contrato_existente: existente.id_contrato,
    requiere_revision: [...new Set([...revision, ...conflictos])],
    diferencias,
    contrato,
  }
}

function calcularDiferencias(fila: Fila, c: Contrato): Diferencia[] {
  const difs: Diferencia[] = []
  for (const campo of COMPARABLES) {
    if (c[campo] === null) continue
    const antes = desdeCelda(campo, fila[campo])
    if (!iguales(campo, antes, c[campo])) difs.push({ campo, antes, despues: c[campo] })
  }
  if (c.es_otrosi && c.ampliar_garantias && fila.requiere_poliza === "true" && fila.estado_poliza !== "pendiente") {
    difs.push({ campo: "estado_poliza", antes: fila.estado_poliza, despues: "pendiente" })
  }
  return difs
}

export type ResultadoRegistro = {
  id_contrato: string | null
  accion: "insertado" | "actualizado" | "sin_cambios" | "rechazado"
  ruta_archivo: string | null
  motivo?: string
  diferencias?: Diferencia[]
}

/** Error que indica que hay campos por revisar; la herramienta lo traduce a una pregunta al usuario. */
export class ErrorRevision extends ErrorNegocio {
  constructor(readonly validacion: Validacion) {
    super(`requiere revisión: ${validacion.requiere_revision.join(", ")}`)
  }
}

function siguienteAuto(maestro: Fila[], anio: string): string {
  const usados = maestro.map((f) => new RegExp(`^AUTO-${anio}-(\\d+)$`).exec(f.id_contrato)?.[1]).filter(Boolean).map(Number)
  return `AUTO-${anio}-${String(Math.max(0, ...usados) + 1).padStart(3, "0")}`
}

/** HU-4: registra el mensaje si no requiere revisión o si el usuario confirmó. */
export async function registrarMensaje(
  raiz: string,
  mensajeId: string,
  opciones: { propuesta?: ContratoPropuesto; confirmado?: boolean; hoy?: string } = {},
): Promise<ResultadoRegistro> {
  const v = await validarMensaje(raiz, mensajeId, opciones.propuesta)
  const hoy = opciones.hoy ?? hoyIso()
  const ts = new Date().toISOString()
  await asegurarMaestro(raiz)

  if (v.clasificacion === "rechazado") {
    await marcarProcesado(raiz, mensajeId, { clasificacion: "rechazado", accion: "rechazado", id_contrato: null, motivo: v.motivo, ts })
    return { id_contrato: null, accion: "rechazado", ruta_archivo: null, motivo: v.motivo }
  }
  if (v.clasificacion === "duplicado") {
    await marcarProcesado(raiz, mensajeId, { clasificacion: "duplicado", accion: "sin_cambios", id_contrato: v.id_contrato_existente ?? null, motivo: v.motivo, ts })
    const fila = (await leerMaestro(raiz)).find((f) => f.id_contrato === v.id_contrato_existente)
    return { id_contrato: v.id_contrato_existente ?? null, accion: "sin_cambios", ruta_archivo: fila?.ruta_sharepoint ?? null, motivo: v.motivo }
  }
  if (v.requiere_revision.length > 0 && !opciones.confirmado) throw new ErrorRevision(v)

  const c = v.contrato
  if (!c) throw new ErrorNegocio("No hay datos de contrato para registrar")
  const maestro = await leerMaestro(raiz)
  const ext = c.documento.slice(c.documento.lastIndexOf("."))
  const origen = rutaAdjunto(raiz, mensajeId, c.documento)

  if (v.clasificacion === "nuevo") {
    const anio = (c.fecha_inicio ?? hoy).slice(0, 4)
    const id = c.id_contrato ?? siguienteAuto(maestro, anio)
    const ruta = `Contratos/${anio}/${slugCliente(c.cliente ?? "sin-cliente")}/${id}${ext}`
    const requiere = c.requiere_poliza === true
    const fila: Fila = {
      id_contrato: id,
      cliente: c.cliente ?? "",
      nit_cliente: c.nit_cliente ?? "",
      pais: c.pais ?? "",
      objeto: (c.objeto ?? "").slice(0, 200),
      valor: c.valor_indeterminado ? "0" : aCelda(c.valor),
      moneda: c.moneda ?? "",
      fecha_inicio: c.fecha_inicio ?? "",
      fecha_fin: c.fecha_fin ?? "",
      requiere_poliza: String(requiere),
      tipo_poliza: requiere ? (c.tipo_poliza ?? "") : "",
      estado_poliza: requiere ? "pendiente" : "no_aplica",
      comercial: v.comercial ?? "",
      ruta_sharepoint: ruta,
      fecha_registro: hoy,
      fuente: "buzon",
    }
    await archivarDocumento(raiz, origen, ruta)
    await escribirMaestro(raiz, [...maestro, fila])
    await agregarHistorial(raiz, { ts, id_contrato: id, accion: "alta", cambios: fila, mensaje_id: mensajeId, documento: ruta })
    await marcarProcesado(raiz, mensajeId, { clasificacion: "nuevo", accion: "insertado", id_contrato: id, ts })
    return { id_contrato: id, accion: "insertado", ruta_archivo: ruta }
  }

  // actualizacion
  const idx = maestro.findIndex((f) => f.id_contrato === v.id_contrato_existente)
  const fila = maestro[idx]
  if (!fila) throw new ErrorNegocio(`No se encontró ${v.id_contrato_existente} en el maestro`)
  const cambios: Record<string, { antes: unknown; despues: unknown }> = {}
  for (const d of v.diferencias ?? []) {
    ;(fila as Record<string, string>)[d.campo] = aCelda(d.despues)
    cambios[d.campo] = { antes: d.antes, despues: d.despues }
  }
  const carpeta = fila.ruta_sharepoint.includes("/") ? fila.ruta_sharepoint.slice(0, fila.ruta_sharepoint.lastIndexOf("/")) : `Contratos/${(fila.fecha_inicio || hoy).slice(0, 4)}/${slugCliente(fila.cliente)}`
  const sufijo = c.es_otrosi ? `otrosi-${c.numero_otrosi ?? 1}` : `reemision-${mensajeId}`
  const ruta = `${carpeta}/${fila.id_contrato}_${sufijo}${ext}`
  await archivarDocumento(raiz, origen, ruta)
  await escribirMaestro(raiz, maestro)
  await agregarHistorial(raiz, { ts, id_contrato: fila.id_contrato, accion: "actualizacion", cambios, mensaje_id: mensajeId, documento: ruta })
  await marcarProcesado(raiz, mensajeId, { clasificacion: "actualizacion", accion: "actualizado", id_contrato: fila.id_contrato, ts })
  return { id_contrato: fila.id_contrato, accion: "actualizado", ruta_archivo: ruta, diferencias: v.diferencias }
}
