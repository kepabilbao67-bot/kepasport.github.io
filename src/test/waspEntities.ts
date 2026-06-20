// Stub de `wasp/entities` para pruebas. Los componentes solo usan estos tipos
// en posición de tipo (`import type`), por lo que se borran en compilación.
export type Client = {
  id: number
  name: string
  email: string
  phone?: string | null
  company?: string | null
  status?: string | null
  notes?: string | null
}
export type Activity = {
  id: number
  content: string
  clientId: number
  createdAt: string | Date
}
export type Conversation = { id: number }
export type Message = { id: number }
