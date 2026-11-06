/** Lectura de PDF nativo con texto (P1). Los PDF escaneados requieren OCR (fuera de alcance). */
import { getDocumentProxy } from "unpdf"
import { ErrorNegocio } from "./comun"

/** Devuelve el texto del PDF respetando los saltos de línea del documento. */
export async function textoDePdf(bytes: Uint8Array): Promise<string> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    doc = await getDocumentProxy(bytes)
  } catch {
    throw new ErrorNegocio("No se pudo leer el PDF (archivo dañado o protegido)")
  }
  const paginas: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const contenido = await (await doc.getPage(n)).getTextContent()
    const lineas: string[] = []
    let linea = ""
    for (const item of contenido.items) {
      if (!("str" in item)) continue
      linea += item.str
      if (item.hasEOL) {
        lineas.push(linea)
        linea = ""
      }
    }
    if (linea) lineas.push(linea)
    paginas.push(lineas.join("\n"))
  }
  const texto = paginas.join("\n\n")
  if (!texto.trim()) throw new ErrorNegocio("El PDF no tiene texto extraíble (posible escaneo: requiere OCR)")
  return texto
}
