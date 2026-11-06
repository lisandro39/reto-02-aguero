import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { alertas, extraer, leer_buzon, registrar, validar } from "../../src/tools/contratos"
import { agregarMensaje, correr, espacio, filas, leer, limpiar } from "./apoyo"

afterAll(limpiar)

const MAESTRO = ["out", "sharepoint", "maestro-contratos.csv"]

async function procesarTodo(ctx: Awaited<ReturnType<typeof espacio>>) {
  for (const id of ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005", "msg-006"]) {
    await correr(registrar, { mensaje_id: id, hoy: "2026-09-03" }, ctx)
  }
}

describe("HU-1 · Leer el buzón", () => {
  test("HU1-CA1 lista los 6 mensajes no procesados con sus metadatos", async () => {
    const ctx = await espacio()
    const r = await correr(leer_buzon, {}, ctx)
    expect(r.ok).toBe(true)
    const ids = r.data?.mensajes.map((m: { id: string }) => m.id)
    expect(ids).toEqual(["msg-001", "msg-002", "msg-003", "msg-004", "msg-005", "msg-006"])
    expect(r.data?.mensajes[0]).toMatchObject({ id: "msg-001", de: "lgomez@periferia-ficticia.com", adjuntos: ["contrato.txt"], tiene_contrato: true })
  })

  test("HU1-CA2 la cotización se marca sin contrato y rechazada con motivo", async () => {
    const r = await correr(leer_buzon, {}, await espacio())
    const m = r.data?.mensajes.find((x: { id: string }) => x.id === "msg-005")
    expect(m.tiene_contrato).toBe(false)
    expect(m.clasificacion).toBe("rechazado")
    expect(m.motivo).toContain("cotizacion.txt")
  })

  test("HU1-CA3 los mensajes procesados no vuelven a aparecer", async () => {
    const ctx = await espacio()
    await correr(registrar, { mensaje_id: "msg-001", hoy: "2026-09-03" }, ctx)
    const r = await correr(leer_buzon, {}, ctx)
    expect(r.data?.mensajes.map((m: { id: string }) => m.id)).not.toContain("msg-001")
  })
})

describe("HU-2 · Extraer", () => {
  test("HU2-CA1/CA4 msg-001: contrato colombiano con póliza, valores normalizados", async () => {
    const r = await correr(extraer, { mensaje_id: "msg-001" }, await espacio())
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({
      id_contrato: "CT-2026-015",
      cliente: "Industrias Delta S.A.S.",
      nit_cliente: "890900111",
      pais: "CO",
      valor: 265000000,
      moneda: "COP",
      fecha_inicio: "2026-08-01",
      fecha_fin: "2027-07-31",
      requiere_poliza: true,
      tipo_poliza: "cumplimiento",
      es_otrosi: false,
    })
    expect(r.data?.objeto.length).toBeLessThanOrEqual(200)
    for (const v of Object.values(r.data?.confianza as Record<string, number>)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  test("HU2-CA4 msg-002: RUC de Ecuador y formato 120,000.00 en USD", async () => {
    const r = await correr(extraer, { mensaje_id: "msg-002" }, await espacio())
    expect(r.data).toMatchObject({ id_contrato: "CT-2026-016", nit_cliente: "1790012345001", pais: "EC", valor: 120000, moneda: "USD", fecha_inicio: "2026-08-15", fecha_fin: "2027-08-14", requiere_poliza: false })
  })

  test("HU2-CA3 msg-003: otrosí identifica el contrato y deja en null lo que no menciona", async () => {
    const r = await correr(extraer, { mensaje_id: "msg-003" }, await espacio())
    expect(r.data).toMatchObject({ es_otrosi: true, id_contrato: "CT-2026-011", contrato_referencia: "CT-2026-011", valor: 520000, moneda: "PEN", fecha_fin: "2027-11-01", pais: "PE", nit_cliente: "20512345678" })
    expect(r.data?.objeto).toBeNull()
    expect(r.data?.confianza.objeto).toBe(0)
  })

  test("HU2-CA5 msg-006: valor por demanda y fecha fin derivada quedan bajo 0.8", async () => {
    const r = await correr(extraer, { mensaje_id: "msg-006" }, await espacio())
    expect(r.data).toMatchObject({ id_contrato: "CM-2026-03", valor: 0, valor_indeterminado: true, plazo_meses: 12, fecha_fin: "2027-08-31", moneda: "COP" })
    expect(r.data?.confianza.valor).toBeLessThan(0.8)
    expect(r.data?.confianza.fecha_fin).toBeLessThan(0.8)
  })

  test("HU2-CA2 la extracción es determinista", async () => {
    const ctx = await espacio()
    expect(await extraer.execute({ mensaje_id: "msg-001" }, ctx)).toBe(await extraer.execute({ mensaje_id: "msg-001" }, ctx))
  })

  test("HU6-CA1 mensaje sin contrato devuelve error legible", async () => {
    const r = await correr(extraer, { mensaje_id: "msg-005" }, await espacio())
    expect(r.ok).toBe(false)
    expect(r.error).toContain("no trae contrato")
  })

  test("HU6-CA1 texto vacío, fecha inválida y moneda desconocida", async () => {
    const ctx = await espacio()
    await agregarMensaje(ctx, "msg-901", "contrato.txt", "   ")
    await agregarMensaje(ctx, "msg-902", "contrato.txt", "CONTRATO No. CT-2026-901\nEntre ACME S.A.S., NIT 900.111.222-3, con domicilio en Bogotá...\nPRIMERA. OBJETO. Soporte.\nSEGUNDA. VALOR. COP $1.000.000.\nTERCERA. PLAZO. desde el treinta y dos (32) de febrero de 2026 hasta el uno (1) de marzo de 2027.")
    await agregarMensaje(ctx, "msg-903", "contrato.txt", "CONTRATO No. CT-2026-903\nEntre ACME S.A.S., NIT 900.111.222-3, con domicilio en Bogotá...\nPRIMERA. OBJETO. Soporte.\nSEGUNDA. VALOR. El valor es EUR 50,000.00.\nTERCERA. PLAZO. desde el uno (1) de marzo de 2026 hasta el uno (1) de marzo de 2027.")
    expect((await correr(extraer, { mensaje_id: "msg-901" }, ctx)).error).toContain("vacío")
    expect((await correr(extraer, { mensaje_id: "msg-902" }, ctx)).error).toContain("fecha inválida")
    expect((await correr(extraer, { mensaje_id: "msg-903" }, ctx)).error).toContain("moneda desconocida")
  })

  test("HU6-CA1 mensaje inexistente", async () => {
    const r = await correr(extraer, { mensaje_id: "msg-999" }, await espacio())
    expect(r.ok).toBe(false)
    expect(r.error).toContain("msg-999")
  })
})

describe("HU-3 · Validar y clasificar", () => {
  test("HU3-CA1 clasifica los 6 casos del buzón", async () => {
    const ctx = await espacio()
    const esperado: Record<string, string> = { "msg-001": "nuevo", "msg-002": "nuevo", "msg-003": "actualizacion", "msg-004": "duplicado", "msg-005": "rechazado", "msg-006": "nuevo" }
    for (const [id, clasificacion] of Object.entries(esperado)) {
      const r = await correr(validar, { mensaje_id: id }, ctx)
      expect(r.ok).toBe(true)
      expect(`${id}:${r.data?.clasificacion}`).toBe(`${id}:${clasificacion}`)
    }
  })

  test("HU3-CA2 msg-006 pide revisión de valor y fecha_fin", async () => {
    const r = await correr(validar, { mensaje_id: "msg-006" }, await espacio())
    expect(r.data?.requiere_revision).toEqual(["valor", "fecha_fin"])
  })

  test("HU3-CA2 los casos limpios no piden revisión", async () => {
    const ctx = await espacio()
    for (const id of ["msg-001", "msg-002", "msg-003"]) {
      expect((await correr(validar, { mensaje_id: id }, ctx)).data?.requiere_revision).toEqual([])
    }
  })

  test("HU3-CA3 el otrosí informa las diferencias con el maestro", async () => {
    const r = await correr(validar, { mensaje_id: "msg-003" }, await espacio())
    expect(r.data?.id_contrato_existente).toBe("CT-2026-011")
    expect(r.data?.diferencias).toEqual([
      { campo: "valor", antes: 350000, despues: 520000 },
      { campo: "fecha_fin", antes: "2027-05-01", despues: "2027-11-01" },
      { campo: "estado_poliza", antes: "vigente", despues: "pendiente" },
    ])
  })

  test("HU3-CA4 remitente desconocido genera advertencia, no bloquea", async () => {
    const r = await correr(validar, { mensaje_id: "msg-006" }, await espacio())
    expect(r.data?.advertencias.join(" ")).toContain("jperez@periferia-ficticia.com")
    expect(r.data?.clasificacion).toBe("nuevo")
  })

  test("HU3-CA5 un campo corregido por el usuario pasa a revisión", async () => {
    const r = await correr(validar, { mensaje_id: "msg-001", contrato: { valor: 999 } }, await espacio())
    expect(r.data?.requiere_revision).toContain("valor")
  })

  test("RN2 una reemisión con cambios del mismo contrato (sin otrosí) es actualización con conflicto", async () => {
    const ctx = await espacio()
    const original = await readFile(join(ctx.directory, "fixtures/reto-02/buzon/msg-004/contrato.txt"), "utf8")
    await agregarMensaje(ctx, "msg-904", "contrato.txt", original.replace("DOSCIENTOS DIEZ MILLONES DE PESOS M/CTE (COP $210.000.000)", "DOSCIENTOS VEINTE MILLONES DE PESOS M/CTE (COP $220.000.000)"))
    const r = await correr(validar, { mensaje_id: "msg-904" }, ctx)
    expect(r.data?.clasificacion).toBe("actualizacion")
    expect(r.data?.requiere_revision).toContain("conflicto:valor")
  })
})

describe("HU-4 · Registrar y archivar", () => {
  test("HU4-CA1 msg-006 no se registra sin confirmación y no escribe nada", async () => {
    const ctx = await espacio()
    const r = await correr(registrar, { mensaje_id: "msg-006", hoy: "2026-09-03" }, ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toStartWith("requiere revisión: valor, fecha_fin")
    expect(r.confirmacion).toBe(true)
    expect(await stat(join(ctx.directory, "out", "procesados.json")).catch(() => null)).toBeNull()
  })

  test("HU4-CA1 msg-006 con confirmado = true queda registrado", async () => {
    const ctx = await espacio()
    const r = await correr(registrar, { mensaje_id: "msg-006", confirmado: true, hoy: "2026-09-03" }, ctx)
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ id_contrato: "CM-2026-03", accion: "insertado" })
    const fila = filas(await leer(ctx, ...MAESTRO)).find((f) => f.startsWith("CM-2026-03"))
    expect(fila).toContain(",0,COP,2026-08-31,2027-08-31,true,cumplimiento,pendiente,")
    expect(fila).toContain("(no registrado)")
  })

  test("HU4-CA2/CA3/CA4/CA5 msg-001 inserta, archiva, deja historial y marca procesado", async () => {
    const ctx = await espacio()
    const r = await correr(registrar, { mensaje_id: "msg-001", hoy: "2026-09-03" }, ctx)
    expect(r.data).toEqual({ id_contrato: "CT-2026-015", accion: "insertado", ruta_archivo: "Contratos/2026/industrias-delta/CT-2026-015.txt" })
    expect(await leer(ctx, "out", "sharepoint", "Contratos", "2026", "industrias-delta", "CT-2026-015.txt")).toContain("CT-2026-015")
    const fila = filas(await leer(ctx, ...MAESTRO)).find((f) => f.startsWith("CT-2026-015"))
    expect(fila).toContain("Industrias Delta S.A.S.,890900111,CO,")
    expect(fila).toContain(",265000000,COP,2026-08-01,2027-07-31,true,cumplimiento,pendiente,Laura Gómez Restrepo,Contratos/2026/industrias-delta/CT-2026-015.txt,2026-09-03,buzon")
    const historial = (await leer(ctx, "out", "sharepoint", "historial.jsonl")).trim().split("\n").map((l) => JSON.parse(l))
    expect(historial[0]).toMatchObject({ id_contrato: "CT-2026-015", accion: "alta", mensaje_id: "msg-001" })
    expect(JSON.parse(await leer(ctx, "out", "procesados.json"))["msg-001"]).toMatchObject({ clasificacion: "nuevo", id_contrato: "CT-2026-015" })
  })

  test("HU4-CA2 msg-002 sin póliza queda no_aplica", async () => {
    const ctx = await espacio()
    await correr(registrar, { mensaje_id: "msg-002", hoy: "2026-09-03" }, ctx)
    const fila = filas(await leer(ctx, ...MAESTRO)).find((f) => f.startsWith("CT-2026-016"))
    expect(fila).toContain(",120000,USD,2026-08-15,2027-08-14,false,,no_aplica,Carlos Ruiz Medina,")
  })

  test("HU4-CA2 msg-003 actualiza la fila existente y conserva historial", async () => {
    const ctx = await espacio()
    const r = await correr(registrar, { mensaje_id: "msg-003", hoy: "2026-09-03" }, ctx)
    expect(r.data).toMatchObject({ id_contrato: "CT-2026-011", accion: "actualizado" })
    const lineas = filas(await leer(ctx, ...MAESTRO))
    expect(lineas).toHaveLength(8)
    const fila = lineas.find((f) => f.startsWith("CT-2026-011"))
    expect(fila).toContain(",520000,PEN,2026-05-02,2027-11-01,true,cumplimiento;responsabilidad_civil,pendiente,")
    expect(fila).toContain(",2026-05-05,buzon")
    const h = JSON.parse((await leer(ctx, "out", "sharepoint", "historial.jsonl")).trim())
    expect(h).toMatchObject({ id_contrato: "CT-2026-011", accion: "actualizacion", mensaje_id: "msg-003" })
    expect(h.cambios.valor).toEqual({ antes: 350000, despues: 520000 })
    expect(await leer(ctx, "out", "sharepoint", "Contratos", "2026", "minera-los-andes", "CT-2026-011_otrosi-1.txt")).toContain("OTROSÍ")
  })

  test("HU4-CA6 msg-004 duplicado no escribe maestro ni historial", async () => {
    const ctx = await espacio()
    const r = await correr(registrar, { mensaje_id: "msg-004", hoy: "2026-09-03" }, ctx)
    expect(r.data).toMatchObject({ id_contrato: "CT-2026-012", accion: "sin_cambios" })
    const fixture = await readFile(join(ctx.directory, "fixtures/reto-02/maestro-contratos.csv"), "utf8")
    expect(await leer(ctx, ...MAESTRO)).toBe(fixture)
    expect(await stat(join(ctx.directory, "out/sharepoint/historial.jsonl")).catch(() => null)).toBeNull()
  })

  test("RN4 msg-005 se rechaza con motivo y no toca el maestro", async () => {
    const ctx = await espacio()
    const r = await correr(registrar, { mensaje_id: "msg-005", hoy: "2026-09-03" }, ctx)
    expect(r.data).toMatchObject({ accion: "rechazado", id_contrato: null })
    expect(r.data?.motivo).toContain("cotizacion.txt")
  })

  test("RN6 + HU4-CA7 lote completo: fixture intacto y sin ids duplicados", async () => {
    const ctx = await espacio()
    const ruta = join(ctx.directory, "fixtures/reto-02/maestro-contratos.csv")
    const antes = createHash("sha256").update(await readFile(ruta)).digest("hex")
    await procesarTodo(ctx)
    await procesarTodo(ctx)
    await correr(registrar, { mensaje_id: "msg-006", confirmado: true, hoy: "2026-09-03" }, ctx)
    expect(createHash("sha256").update(await readFile(ruta)).digest("hex")).toBe(antes)
    const ids = filas(await leer(ctx, ...MAESTRO)).map((f) => f.split(",")[0])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(11)
  })

  test("HU6-CA2 un mensaje malo no impide procesar el siguiente", async () => {
    const ctx = await espacio()
    await agregarMensaje(ctx, "msg-000", "contrato.txt", "")
    const malo = await correr(registrar, { mensaje_id: "msg-000", hoy: "2026-09-03" }, ctx)
    const bueno = await correr(registrar, { mensaje_id: "msg-001", hoy: "2026-09-03" }, ctx)
    expect(malo.ok).toBe(false)
    expect(bueno.ok).toBe(true)
  })
})

describe("HU-5 · Alertas", () => {
  test("HU5-CA1 reporte con las tres secciones y los contratos esperados", async () => {
    const ctx = await espacio()
    await procesarTodo(ctx)
    await correr(registrar, { mensaje_id: "msg-006", confirmado: true, hoy: "2026-09-03" }, ctx)
    const r = await correr(alertas, { hoy: "2026-09-03" }, ctx)
    expect(r.ok).toBe(true)
    expect(r.data?.ruta).toBe("out/alertas.md")
    expect(r.data?.vencen.map((v: { id_contrato: string; dias_restantes: number }) => [v.id_contrato, v.dias_restantes])).toEqual([
      ["CT-2026-009", 27],
      ["CT-2026-004", 42],
    ])
    expect(r.data?.polizas_pendientes.map((p: { id_contrato: string }) => p.id_contrato)).toEqual(["CT-2026-004", "CT-2026-011", "CT-2026-015", "CM-2026-03"])
    expect(r.data?.registrados_desde_corte.map((p: { id_contrato: string }) => p.id_contrato)).toEqual(["CT-2026-015", "CT-2026-016", "CM-2026-03"])
    expect(r.data?.vencidos.map((p: { id_contrato: string }) => p.id_contrato)).toEqual(["CT-2025-018", "CT-2026-002"])
    const md = await leer(ctx, "out", "alertas.md")
    expect(md).toContain("## Vencen en 60 días o menos")
    expect(md).toContain("## Pólizas pendientes")
    expect(md).toContain("## Registrados desde el corte (2026-05-30)")
  })

  test("HU5-CA2 mismo hoy, mismo reporte", async () => {
    const ctx = await espacio()
    const a = await correr(alertas, { hoy: "2026-09-03" }, ctx)
    const b = await correr(alertas, { hoy: "2026-09-03" }, ctx)
    expect(a).toEqual(b)
  })

  test("HU5-CA3 hoy inválido devuelve error", async () => {
    const r = await correr(alertas, { hoy: "2026-02-30" }, await espacio())
    expect(r.ok).toBe(false)
  })
})
