/**
 * Herramientas del agente de contratos. Cada export se expone al modelo como `contratos_<export>`.
 * Son la única fuente de valores que el agente puede afirmar; nunca lanzan: devuelven { ok, data } o { ok: false, error }.
 */
import { z } from "zod"
import { fallo, ok, type Contexto } from "../agent/herramientas"
import { generarAlertas } from "../dominio/alertas"
import { adjuntoContrato, leerAdjunto, leerCorreo, leerProcesados, listarMensajes, PATRON_MENSAJE } from "../dominio/archivos"
import { ErrorNegocio, esFechaValida } from "../dominio/comun"
import { extraerContrato } from "../dominio/extraccion"
import { ErrorRevision, registrarMensaje, validarMensaje } from "../dominio/registro"
import { MONEDAS, PAISES, type ContratoPropuesto } from "../dominio/tipos"

const mensajeId = z.string().regex(PATRON_MENSAJE, "formato esperado: msg-NNN").describe("Identificador del mensaje del buzón, p. ej. msg-001")
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "formato esperado: YYYY-MM-DD")
  .refine(esFechaValida, "fecha inexistente en el calendario")

const contratoPropuesto = z
  .object({
    id_contrato: z.string().nullable().describe("Número del contrato"),
    cliente: z.string().nullable().describe("Razón social de la contraparte"),
    nit_cliente: z.string().nullable().describe("Identificador tributario sin dígito de verificación ni puntos"),
    pais: z.enum(PAISES).nullable().describe("País de la contraparte"),
    objeto: z.string().max(200).nullable().describe("Objeto del contrato (máx. 200 caracteres)"),
    valor: z.number().nonnegative().nullable().describe("Valor sin separadores; 0 si es por demanda"),
    moneda: z.enum(MONEDAS).nullable().describe("Moneda del valor"),
    fecha_inicio: fecha.nullable().describe("Fecha de inicio YYYY-MM-DD"),
    fecha_fin: fecha.nullable().describe("Fecha de fin YYYY-MM-DD"),
    requiere_poliza: z.boolean().nullable().describe("Si el contrato exige póliza"),
    tipo_poliza: z.string().nullable().describe("Tipos de póliza separados por ;"),
  })
  .partial()
  .describe("Solo los campos que el usuario corrigió o confirmó; lo demás se toma del documento")

async function seguro(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ErrorNegocio) return fallo(e.message)
    return fallo(`Error inesperado: ${e instanceof Error ? e.message : "desconocido"}`)
  }
}

function sinDocumento<T extends { documento?: string }>(c: T): Omit<T, "documento"> {
  const { documento: _omitido, ...resto } = c
  return resto
}

export const leer_buzon = {
  description: "Lista los mensajes pendientes del buzón de contratos con remitente, asunto, adjuntos y si traen contrato.",
  args: {},
  async execute(_args: Record<string, never>, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      const procesados = await leerProcesados(ctx.directory)
      const ids = (await listarMensajes(ctx.directory)).filter((id) => !procesados[id])
      const mensajes = await Promise.all(
        ids.map(async (id) => {
          const correo = await leerCorreo(ctx.directory, id)
          const adjunto = adjuntoContrato(correo)
          const base = { id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha, adjuntos: correo.adjuntos, tiene_contrato: adjunto !== null }
          return adjunto
            ? { ...base, clasificacion: "por_validar" }
            : { ...base, clasificacion: "rechazado", motivo: `No trae contrato ni otrosí (adjuntos: ${correo.adjuntos.join(", ") || "ninguno"})` }
        }),
      )
      return ok({ mensajes, procesados: Object.keys(procesados).length })
    })
  },
}

export const extraer = {
  description: "Extrae de forma determinista los datos del contrato u otrosí adjunto a un mensaje, con confianza por campo.",
  args: { mensaje_id: mensajeId },
  async execute(args: { mensaje_id: string }, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      const correo = await leerCorreo(ctx.directory, args.mensaje_id)
      const adjunto = adjuntoContrato(correo)
      if (!adjunto) throw new ErrorNegocio(`El mensaje ${args.mensaje_id} no trae contrato (adjuntos: ${correo.adjuntos.join(", ") || "ninguno"})`)
      const contrato = extraerContrato(await leerAdjunto(ctx.directory, args.mensaje_id, adjunto), adjunto, correo.fecha)
      return ok(sinDocumento(contrato))
    })
  },
}

export const validar = {
  description: "Clasifica un mensaje como nuevo, actualizacion, duplicado o rechazado y lista los campos que requieren revisión humana.",
  args: { mensaje_id: mensajeId, contrato: contratoPropuesto.optional() },
  async execute(args: { mensaje_id: string; contrato?: ContratoPropuesto }, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      if (!PATRON_MENSAJE.test(args.mensaje_id)) throw new ErrorNegocio(`Identificador de mensaje inválido: ${args.mensaje_id}`)
      const v = await validarMensaje(ctx.directory, args.mensaje_id, args.contrato)
      return ok({ ...v, contrato: v.contrato ? sinDocumento(v.contrato) : null })
    })
  },
}

export const registrar = {
  description: "Registra o actualiza el contrato en el maestro y lo archiva; si hay campos en revisión exige confirmado=true tras preguntar al usuario.",
  args: {
    mensaje_id: mensajeId,
    contrato: contratoPropuesto.optional(),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente los campos en revisión en su último mensaje"),
    hoy: fecha.optional().describe("Fecha de registro YYYY-MM-DD (opcional; por defecto la fecha del sistema)"),
  },
  async execute(args: { mensaje_id: string; contrato?: ContratoPropuesto; confirmado?: boolean; hoy?: string }, ctx: Contexto): Promise<string> {
    try {
      const r = await registrarMensaje(ctx.directory, args.mensaje_id, { propuesta: args.contrato, confirmado: args.confirmado, hoy: args.hoy })
      return ok(r)
    } catch (e) {
      if (e instanceof ErrorRevision) {
        const campos = camposEnRevision(e)
        return JSON.stringify({ ok: false, error: e.message, confirmacion: true, data: { mensaje_id: args.mensaje_id, clasificacion: e.validacion.clasificacion, campos, advertencias: e.validacion.advertencias } })
      }
      if (e instanceof ErrorNegocio) return fallo(e.message)
      return fallo(`Error inesperado: ${e instanceof Error ? e.message : "desconocido"}`)
    }
  },
}

function camposEnRevision(e: ErrorRevision) {
  const c = e.validacion.contrato
  return e.validacion.requiere_revision.map((campo) => {
    const nombre = campo.replace(/^conflicto:/, "") as keyof NonNullable<typeof c>
    return { campo, valor_propuesto: c ? (c[nombre] ?? null) : null, confianza: c && nombre in c.confianza ? c.confianza[nombre as keyof typeof c.confianza] : null }
  })
}

export const procesar_buzon = {
  description: "Procesa en orden todos los mensajes pendientes (validar y registrar cada uno); deja sin registrar los que requieren revisión y devuelve el resultado por mensaje.",
  args: { hoy: fecha.describe("Fecha de referencia YYYY-MM-DD indicada por el usuario; se usa como fecha de registro") },
  async execute(args: { hoy: string }, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      if (!esFechaValida(args.hoy)) throw new ErrorNegocio(`Fecha de referencia inválida: ${args.hoy} (formato YYYY-MM-DD)`)
      const procesados = await leerProcesados(ctx.directory)
      const ids = (await listarMensajes(ctx.directory)).filter((id) => !procesados[id])
      const resultados = []
      for (const id of ids) {
        const correo = await leerCorreo(ctx.directory, id).catch(() => null)
        const base = { mensaje_id: id, asunto: correo?.asunto ?? "", de: correo?.de ?? "" }
        try {
          const v = await validarMensaje(ctx.directory, id)
          const r = await registrarMensaje(ctx.directory, id, { hoy: args.hoy })
          resultados.push({ ...base, clasificacion: v.clasificacion, estado: "procesado", ...r, advertencias: v.advertencias })
        } catch (e) {
          if (e instanceof ErrorRevision) {
            resultados.push({
              ...base,
              clasificacion: e.validacion.clasificacion,
              estado: "requiere_confirmacion",
              id_contrato: e.validacion.contrato?.id_contrato ?? null,
              campos_en_revision: camposEnRevision(e),
              advertencias: e.validacion.advertencias,
            })
          } else {
            resultados.push({ ...base, clasificacion: "error", estado: "error", error: e instanceof Error ? e.message : "error desconocido" })
          }
        }
      }
      const pendientes = resultados.filter((r) => r.estado === "requiere_confirmacion").map((r) => r.mensaje_id)
      return ok({ hoy: args.hoy, total: resultados.length, resultados, pendientes_confirmacion: pendientes, confirmacion: pendientes.length > 0 })
    })
  },
}

export const alertas = {
  description: "Genera out/alertas.md con contratos que vencen en 60 días o menos, pólizas pendientes y registrados desde el corte del 2026-05-30.",
  args: { hoy: fecha.describe("Fecha de referencia YYYY-MM-DD") },
  async execute(args: { hoy: string }, ctx: Contexto): Promise<string> {
    return seguro(async () => {
      if (!esFechaValida(args.hoy)) throw new ErrorNegocio(`Fecha de referencia inválida: ${args.hoy} (formato YYYY-MM-DD)`)
      return ok(await generarAlertas(ctx.directory, args.hoy))
    })
  },
}
