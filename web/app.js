"use strict"

const $ = (id) => document.getElementById(id)
const chat = $("chat")
const formulario = $("formulario")
const campo = $("mensaje")
const btnEnviar = $("btn-enviar")
const banner = $("banner-confirmacion")

function leer(almacen, clave) {
  try { return almacen.getItem(clave) } catch { return null }
}
function escribir(almacen, clave, valor) {
  try { almacen.setItem(clave, valor) } catch { /* sin almacenamiento disponible */ }
}

const estado = {
  sessionId: leer(localStorage, "sessionId") || nuevoId(),
  codigo: leer(sessionStorage, "codigo") || "",
  ocupado: false,
}
escribir(localStorage, "sessionId", estado.sessionId)

function nuevoId() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9-]/g, "")
}

// ---------- Markdown mínimo y seguro (escapa todo antes de dar formato) ----------
function escapar(t) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
function enLinea(t) {
  return escapar(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
}
function esFilaTabla(l) { return /^\s*\|.*\|\s*$/.test(l) }
function esSeparador(l) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) }
function celdas(l) { return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()) }

function markdown(texto) {
  const lineas = texto.replace(/\r/g, "").split("\n")
  const html = []
  let i = 0
  while (i < lineas.length) {
    const l = lineas[i]
    if (l.startsWith("```")) {
      const bloque = []
      i++
      while (i < lineas.length && !lineas[i].startsWith("```")) bloque.push(lineas[i++])
      i++
      html.push(`<pre><code>${escapar(bloque.join("\n"))}</code></pre>`)
      continue
    }
    if (esFilaTabla(l) && i + 1 < lineas.length && esSeparador(lineas[i + 1])) {
      const cab = celdas(l)
      i += 2
      const filas = []
      while (i < lineas.length && esFilaTabla(lineas[i])) filas.push(celdas(lineas[i++]))
      html.push(
        `<table><thead><tr>${cab.map((c) => `<th>${enLinea(c)}</th>`).join("")}</tr></thead><tbody>` +
          filas.map((f) => `<tr>${f.map((c) => `<td>${enLinea(c)}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      )
      continue
    }
    const titulo = /^(#{1,3})\s+(.*)$/.exec(l)
    if (titulo) { html.push(`<h${titulo[1].length}>${enLinea(titulo[2])}</h${titulo[1].length}>`); i++; continue }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordenada = /^\s*\d+\./.test(l)
      const items = []
      while (i < lineas.length && /^\s*([-*]|\d+\.)\s+/.test(lineas[i])) items.push(lineas[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""))
      const tag = ordenada ? "ol" : "ul"
      html.push(`<${tag}>${items.map((it) => `<li>${enLinea(it)}</li>`).join("")}</${tag}>`)
      continue
    }
    if (l.trim() === "") { i++; continue }
    const parrafo = []
    while (i < lineas.length && lineas[i].trim() !== "" && !lineas[i].startsWith("```") && !esFilaTabla(lineas[i]) && !/^#{1,3}\s/.test(lineas[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lineas[i])) parrafo.push(lineas[i++])
    html.push(`<p>${parrafo.map(enLinea).join("<br>")}</p>`)
  }
  return html.join("")
}

// ---------- Render ----------
function abajo() { chat.scrollTop = chat.scrollHeight }

function burbuja(clase, contenido, comoHtml) {
  const div = document.createElement("div")
  div.className = `burbuja ${clase}`
  if (comoHtml) div.innerHTML = contenido
  else div.textContent = contenido
  chat.appendChild(div)
  abajo()
  return div
}

function bonito(texto) {
  try { return JSON.stringify(JSON.parse(texto), null, 2) } catch { return texto }
}

function herramientas(lista) {
  if (!lista || !lista.length) return
  const cont = document.createElement("div")
  cont.className = "herramientas"
  for (const t of lista) {
    const det = document.createElement("details")
    det.className = "tool"
    const sum = document.createElement("summary")
    const marca = document.createElement("span")
    marca.className = t.ok ? "marca-ok" : "marca-error"
    marca.textContent = t.ok ? "✓" : "✗"
    const nombre = document.createElement("span")
    nombre.className = "nombre"
    nombre.textContent = t.nombre
    const resumen = document.createElement("span")
    resumen.className = "resumen"
    resumen.textContent = `${t.resumen} · ${t.ms} ms`
    sum.append(marca, nombre, resumen)
    const args = document.createElement("pre")
    args.textContent = `argumentos:\n${JSON.stringify(t.args, null, 2)}`
    const res = document.createElement("pre")
    res.textContent = `resultado:\n${bonito(t.resultado)}`
    det.append(sum, args, res)
    cont.appendChild(det)
  }
  chat.appendChild(cont)
  abajo()
}

function turno(t) {
  burbuja("usuario", t.usuario)
  herramientas(t.toolCalls)
  burbuja(`agente${t.needsConfirmation ? " confirmacion" : ""}${t.error ? " error" : ""}`, markdown(t.respuesta), true)
}

function mostrarConfirmacion(activa) {
  banner.classList.toggle("oculto", !activa)
  campo.placeholder = activa ? "Confirma o corrige los datos pendientes…" : "Escribe un mensaje… (Enter envía, Shift+Enter nueva línea)"
}

// ---------- API ----------
async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    ...opciones,
    headers: { "content-type": "application/json", "x-access-code": estado.codigo, ...(opciones.headers || {}) },
  })
  if (res.status === 401) {
    pedirCodigo()
    throw new Error("Código de acceso requerido")
  }
  return res
}

function pedirCodigo() {
  const dlg = $("dlg-codigo")
  if (!dlg.open) dlg.showModal()
}

$("form-codigo").addEventListener("submit", () => {
  estado.codigo = $("input-codigo").value.trim()
  escribir(sessionStorage, "codigo", estado.codigo)
  cargarHistorial()
})

async function salud() {
  try {
    const r = await fetch("/api/health")
    const d = await r.json()
    $("estado").textContent = `${d.provider} · ${d.model}`
  } catch {
    $("estado").textContent = "sin conexión con el servidor"
  }
}

async function cargarHistorial() {
  chat.innerHTML = ""
  mostrarConfirmacion(false)
  try {
    const r = await api(`/api/sessions/${estado.sessionId}`)
    if (r.status === 404) return
    const s = await r.json()
    for (const t of s.turnos || []) turno(t)
    mostrarConfirmacion(!!s.confirmacionPendiente)
  } catch { /* sin historial */ }
}

async function enviar(texto) {
  if (estado.ocupado || !texto.trim()) return
  estado.ocupado = true
  btnEnviar.disabled = true
  mostrarConfirmacion(false)
  burbuja("usuario", texto)
  const pensando = document.createElement("div")
  pensando.className = "pensando"
  pensando.textContent = "pensando…"
  chat.appendChild(pensando)
  abajo()
  try {
    const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ sessionId: estado.sessionId, message: texto }) })
    const d = await r.json()
    pensando.remove()
    if (!r.ok) {
      burbuja("agente error", d.error || `Error ${r.status}`)
      return
    }
    herramientas(d.toolCalls)
    burbuja(`agente${d.needsConfirmation ? " confirmacion" : ""}${d.error ? " error" : ""}`, markdown(d.reply), true)
    mostrarConfirmacion(d.needsConfirmation)
  } catch (e) {
    pensando.remove()
    burbuja("agente error", e instanceof Error ? e.message : "Error de red")
  } finally {
    estado.ocupado = false
    btnEnviar.disabled = false
    campo.focus()
  }
}

formulario.addEventListener("submit", (e) => {
  e.preventDefault()
  const texto = campo.value
  campo.value = ""
  enviar(texto)
})
campo.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    formulario.requestSubmit()
  }
})
$("btn-confirmar").addEventListener("click", () => enviar("Confirmo."))
$("btn-rechazar").addEventListener("click", () => enviar("No confirmo. No registres lo pendiente."))
$("btn-nueva").addEventListener("click", () => {
  estado.sessionId = nuevoId()
  escribir(localStorage, "sessionId", estado.sessionId)
  chat.innerHTML = ""
  mostrarConfirmacion(false)
})
$("btn-reiniciar").addEventListener("click", async () => {
  try {
    await api(`/api/sessions/${estado.sessionId}/reset`, { method: "POST" })
    chat.innerHTML = ""
    mostrarConfirmacion(false)
    burbuja("agente", "Datos de la sesión reiniciados.")
  } catch (e) {
    burbuja("agente error", e instanceof Error ? e.message : "No se pudo reiniciar")
  }
})

// ---------- Archivos generados ----------
$("btn-archivos").addEventListener("click", async () => {
  const lista = $("lista-archivos")
  const contenido = $("contenido-archivo")
  lista.innerHTML = ""
  contenido.textContent = ""
  $("dlg-archivos").showModal()
  try {
    const r = await api(`/api/sessions/${estado.sessionId}/archivos`)
    const d = await r.json()
    if (!d.archivos || !d.archivos.length) {
      lista.innerHTML = "<li>Aún no hay archivos.</li>"
      return
    }
    for (const ruta of d.archivos) {
      const li = document.createElement("li")
      const a = document.createElement("a")
      a.textContent = ruta
      a.addEventListener("click", async () => {
        const rr = await api(`/api/sessions/${estado.sessionId}/archivos/${ruta.split("/").map(encodeURIComponent).join("/")}`)
        contenido.textContent = await rr.text()
      })
      li.appendChild(a)
      lista.appendChild(li)
    }
  } catch (e) {
    lista.innerHTML = `<li>${escapar(e instanceof Error ? e.message : "Error")}</li>`
  }
})
$("btn-cerrar-archivos").addEventListener("click", () => $("dlg-archivos").close())

salud()
cargarHistorial()
