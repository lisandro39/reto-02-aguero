/** Contrato propio con el proveedor de modelo. El ciclo del agente solo conoce esta interfaz. */

export type ToolCall = { id: string; nombre: string; args: Record<string, unknown> }

export type Mensaje =
  | { rol: "system"; contenido: string }
  | { rol: "user"; contenido: string }
  | { rol: "assistant"; contenido: string; toolCalls: ToolCall[]; nativo?: unknown }
  | { rol: "tool"; toolCallId: string; nombre: string; contenido: string }

export type DefinicionHerramienta = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown>
}

export type Respuesta = {
  texto: string
  toolCalls: ToolCall[]
  tokens: number
  /** Representación nativa del proveedor, para reenviarla tal cual en el historial. */
  nativo?: unknown
}

export type OpcionesEnvio = { signal?: AbortSignal }

export interface ProveedorLLM {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opciones?: OpcionesEnvio): Promise<Respuesta>
}

/** Error del proveedor con mensaje apto para mostrar al usuario. */
export class ErrorProveedor extends Error {
  constructor(
    mensaje: string,
    readonly estado?: number,
  ) {
    super(mensaje)
    this.name = "ErrorProveedor"
  }
}
