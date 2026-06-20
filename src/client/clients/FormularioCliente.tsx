import { useState, type FormEvent } from 'react'
import { createClient, updateClient } from 'wasp/client/operations'
import type { Client } from 'wasp/entities'

import { es } from '../i18n/es'

/**
 * Formulario de creación y edición de Cliente (Tarea 14.3).
 *
 * Cubre los campos del Cliente (nombre, correo, teléfono, empresa, estado y
 * notas) y permite tanto crear un Cliente nuevo como editar uno existente:
 *
 *   - Modo creación: no se pasa la prop `cliente`; al enviar se invoca la
 *     acción `createClient` (Requisito 2.1).
 *   - Modo edición: se pasa un `cliente` existente; el formulario se
 *     precompleta con sus datos y al enviar se invoca `updateClient` con su
 *     identificador (Requisito 2.4).
 *
 * La validación de nombre y correo se realiza en el cliente y muestra mensajes
 * en español tomados del catálogo central `es.errors` (Requisito 12.2),
 * reflejando las mismas reglas que la validación del servidor
 * (`nameRequired`, `emailRequired`, `emailInvalid`). El botón de envío se
 * deshabilita mientras la operación está en curso.
 *
 * Tras una operación exitosa se invoca el callback opcional `onSaved` con el
 * Cliente persistido, de modo que el contenedor pueda refrescar el listado o
 * cerrar el formulario.
 */

/** Expresión regular de formato de correo (idéntica a la del servidor). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface FormularioClienteProps {
  /** Cliente existente a editar. Si se omite, el formulario crea uno nuevo. */
  cliente?: Client
  /** Se invoca con el Cliente persistido tras un guardado exitoso. */
  onSaved?: (client: Client) => void
  /** Se invoca cuando el usuario cancela la edición/creación. */
  onCancel?: () => void
}

/** Estado interno de los campos editables del formulario. */
interface CamposFormulario {
  name: string
  email: string
  phone: string
  company: string
  status: string
  notes: string
}

/** Errores de validación por campo (en español). */
type ErroresCampo = Partial<Record<'name' | 'email', string>>

/** Construye el estado inicial a partir de un Cliente existente (o vacío). */
function estadoInicial(cliente?: Client): CamposFormulario {
  return {
    name: cliente?.name ?? '',
    email: cliente?.email ?? '',
    phone: cliente?.phone ?? '',
    company: cliente?.company ?? '',
    status: cliente?.status ?? '',
    notes: cliente?.notes ?? '',
  }
}

export function FormularioCliente({ cliente, onSaved, onCancel }: FormularioClienteProps) {
  const esEdicion = cliente != null

  const [campos, setCampos] = useState<CamposFormulario>(() => estadoInicial(cliente))
  const [errores, setErrores] = useState<ErroresCampo>({})
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  /** Actualiza un campo concreto del formulario. */
  function actualizar<K extends keyof CamposFormulario>(campo: K, valor: string) {
    setCampos((prev) => ({ ...prev, [campo]: valor }))
  }

  /**
   * Valida nombre y correo en el cliente, devolviendo los mensajes en español.
   * Replica las reglas del servidor (Requisitos 2.2, 2.3).
   */
  function validar(valores: CamposFormulario): ErroresCampo {
    const resultado: ErroresCampo = {}
    if (!valores.name.trim()) {
      resultado.name = es.errors.nameRequired
    }
    if (!valores.email.trim()) {
      resultado.email = es.errors.emailRequired
    } else if (!EMAIL_RE.test(valores.email.trim())) {
      resultado.email = es.errors.emailInvalid
    }
    return resultado
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErrorEnvio(null)

    const erroresValidacion = validar(campos)
    setErrores(erroresValidacion)
    if (Object.keys(erroresValidacion).length > 0) {
      return
    }

    // Normaliza los campos opcionales: cadena vacía -> undefined.
    const opcional = (valor: string) => {
      const limpio = valor.trim()
      return limpio.length > 0 ? limpio : undefined
    }
    const payload = {
      name: campos.name.trim(),
      email: campos.email.trim(),
      phone: opcional(campos.phone),
      company: opcional(campos.company),
      status: opcional(campos.status),
      notes: opcional(campos.notes),
    }

    setEnviando(true)
    try {
      const guardado = esEdicion
        ? await updateClient({ id: cliente!.id, ...payload })
        : await createClient(payload)
      onSaved?.(guardado)
    } catch (err) {
      // Muestra el mensaje del servidor (en español) o un error genérico.
      const mensaje =
        err instanceof Error && err.message ? err.message : es.errors.generic
      setErrorEnvio(mensaje)
    } finally {
      setEnviando(false)
    }
  }

  const etiquetaCampos = es.clients.fields

  return (
    <form onSubmit={manejarEnvio} noValidate style={{ display: 'grid', gap: '0.75rem', maxWidth: '480px' }}>
      <h2>{esEdicion ? es.clients.actions.edit : es.clients.newClient}</h2>

      {errorEnvio && (
        <p role="alert" style={{ color: '#b00020', margin: 0 }}>
          {errorEnvio}
        </p>
      )}

      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span>{etiquetaCampos.name}</span>
        <input
          type="text"
          value={campos.name}
          onChange={(e) => actualizar('name', e.target.value)}
          aria-invalid={errores.name != null}
        />
        {errores.name && (
          <span role="alert" style={{ color: '#b00020', fontSize: '0.85rem' }}>
            {errores.name}
          </span>
        )}
      </label>

      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span>{etiquetaCampos.email}</span>
        <input
          type="email"
          value={campos.email}
          onChange={(e) => actualizar('email', e.target.value)}
          aria-invalid={errores.email != null}
        />
        {errores.email && (
          <span role="alert" style={{ color: '#b00020', fontSize: '0.85rem' }}>
            {errores.email}
          </span>
        )}
      </label>

      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span>{etiquetaCampos.phone}</span>
        <input
          type="tel"
          value={campos.phone}
          onChange={(e) => actualizar('phone', e.target.value)}
        />
      </label>

      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span>{etiquetaCampos.company}</span>
        <input
          type="text"
          value={campos.company}
          onChange={(e) => actualizar('company', e.target.value)}
        />
      </label>

      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span>{etiquetaCampos.status}</span>
        <input
          type="text"
          value={campos.status}
          onChange={(e) => actualizar('status', e.target.value)}
        />
      </label>

      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span>{etiquetaCampos.notes}</span>
        <textarea
          rows={3}
          value={campos.notes}
          onChange={(e) => actualizar('notes', e.target.value)}
        />
      </label>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={enviando}>
          {es.clients.actions.save}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={enviando}>
            {es.clients.actions.cancel}
          </button>
        )}
      </div>
    </form>
  )
}

export default FormularioCliente
