/** HU-5: reporte de riesgos sobre el maestro vigente. */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { diasEntre } from "./comun"
import { leerMaestro, rutas } from "./archivos"
import { DIAS_ALERTA, FECHA_CORTE, type Fila } from "./tipos"

export type Alertas = {
  ruta: string
  hoy: string
  vencen: { id_contrato: string; cliente: string; fecha_fin: string; dias_restantes: number; comercial: string }[]
  polizas_pendientes: { id_contrato: string; cliente: string; tipo_poliza: string; estado_poliza: string; comercial: string }[]
  registrados_desde_corte: { id_contrato: string; cliente: string; fecha_registro: string; comercial: string }[]
  vencidos: { id_contrato: string; cliente: string; fecha_fin: string; dias_vencido: number }[]
}

function tabla(encabezados: string[], filas: string[][]): string {
  if (!filas.length) return "_Sin elementos._\n"
  const esc = (t: string) => t.replace(/\|/g, "\\|")
  return [`| ${encabezados.join(" | ")} |`, `|${encabezados.map(() => "---").join("|")}|`, ...filas.map((f) => `| ${f.map(esc).join(" | ")} |`)].join("\n") + "\n"
}

export function calcularAlertas(maestro: Fila[], hoy: string): Omit<Alertas, "ruta"> {
  const conFin = maestro.filter((f) => f.fecha_fin)
  const vencen = conFin
    .map((f) => ({ f, dias: diasEntre(hoy, f.fecha_fin) }))
    .filter((x) => x.dias >= 0 && x.dias <= DIAS_ALERTA)
    .sort((a, b) => a.dias - b.dias)
    .map(({ f, dias }) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_fin: f.fecha_fin, dias_restantes: dias, comercial: f.comercial }))
  const vencidos = conFin
    .map((f) => ({ f, dias: diasEntre(f.fecha_fin, hoy) }))
    .filter((x) => x.dias > 0)
    .sort((a, b) => b.dias - a.dias)
    .map(({ f, dias }) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_fin: f.fecha_fin, dias_vencido: dias }))
  const polizas_pendientes = maestro
    .filter((f) => f.requiere_poliza === "true" && f.estado_poliza !== "vigente")
    .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, tipo_poliza: f.tipo_poliza, estado_poliza: f.estado_poliza, comercial: f.comercial }))
  const registrados_desde_corte = maestro
    .filter((f) => f.fecha_registro >= FECHA_CORTE)
    .map((f) => ({ id_contrato: f.id_contrato, cliente: f.cliente, fecha_registro: f.fecha_registro, comercial: f.comercial }))
  return { hoy, vencen, polizas_pendientes, registrados_desde_corte, vencidos }
}

export function alertasMarkdown(a: Omit<Alertas, "ruta">): string {
  return [
    `# Alertas de contratos — ${a.hoy}`,
    "",
    `## Vencen en ${DIAS_ALERTA} días o menos`,
    tabla(["Contrato", "Cliente", "Fecha fin", "Días", "Comercial"], a.vencen.map((v) => [v.id_contrato, v.cliente, v.fecha_fin, String(v.dias_restantes), v.comercial])),
    "## Pólizas pendientes",
    tabla(["Contrato", "Cliente", "Tipo de póliza", "Estado", "Comercial"], a.polizas_pendientes.map((p) => [p.id_contrato, p.cliente, p.tipo_poliza, p.estado_poliza, p.comercial])),
    `## Registrados desde el corte (${FECHA_CORTE})`,
    tabla(["Contrato", "Cliente", "Fecha registro", "Comercial"], a.registrados_desde_corte.map((r) => [r.id_contrato, r.cliente, r.fecha_registro, r.comercial])),
    "## Ya vencidos (revisar renovación o acta de terminación)",
    tabla(["Contrato", "Cliente", "Fecha fin", "Días vencido"], a.vencidos.map((v) => [v.id_contrato, v.cliente, v.fecha_fin, String(v.dias_vencido)])),
  ].join("\n")
}

export async function generarAlertas(raiz: string, hoy: string): Promise<Alertas> {
  const datos = calcularAlertas(await leerMaestro(raiz), hoy)
  const destino = rutas(raiz).alertas
  await mkdir(dirname(destino), { recursive: true })
  await writeFile(destino, alertasMarkdown(datos), "utf8")
  return { ruta: "out/alertas.md", ...datos }
}
