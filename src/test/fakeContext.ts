// Contexto Wasp falso (in-memory) para pruebas del backend de Cliente.
//
// El código del servidor opera contra `context.entities.Client` y
// `context.entities.Activity`, que en producción son delegados de Prisma. Fuera
// de un proyecto Wasp compilado no hay base de datos ni cliente de Prisma, por
// lo que estas pruebas usan una implementación en memoria que reproduce el
// subconjunto de la API de Prisma que las acciones y consultas realmente
// utilizan: `create`, `update`, `delete`, `deleteMany`, `findUnique` y
// `findMany` (con `where` por `ownerId`/`clientId`, `OR`/`contains` y
// `orderBy`).
//
// Esto permite ejercitar de forma determinista la lógica real (asociación de
// propietario, validación, orden del listado y eliminación en cascada) sin
// mocks de la lógica de negocio bajo prueba.

type AnyRecord = Record<string, any>

function clone<T>(value: T): T {
  return value === null || value === undefined
    ? value
    : (JSON.parse(JSON.stringify(value, dateReplacer), dateReviver) as T)
}

// Conserva los objetos Date a través del clon estructural basado en JSON.
function dateReplacer(_key: string, value: any) {
  return value instanceof Date ? { __date__: value.toISOString() } : value
}
function dateReviver(_key: string, value: any) {
  if (value && typeof value === 'object' && typeof value.__date__ === 'string') {
    return new Date(value.__date__)
  }
  return value
}

function matchesContains(field: unknown, contains: string, insensitive: boolean): boolean {
  if (typeof field !== 'string') return false
  if (insensitive) return field.toLowerCase().includes(contains.toLowerCase())
  return field.includes(contains)
}

function matchesWhere(record: AnyRecord, where: AnyRecord | undefined): boolean {
  if (!where) return true
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      const clauses = condition as AnyRecord[]
      const anyMatch = clauses.some((clause) => matchesWhere(record, clause))
      if (!anyMatch) return false
      continue
    }
    if (
      condition &&
      typeof condition === 'object' &&
      'contains' in condition
    ) {
      const insensitive = (condition as AnyRecord).mode === 'insensitive'
      if (!matchesContains(record[key], (condition as AnyRecord).contains, insensitive)) {
        return false
      }
      continue
    }
    // Igualdad simple (p. ej. ownerId, clientId).
    if (record[key] !== condition) return false
  }
  return true
}

function applyOrderBy(records: AnyRecord[], orderBy: AnyRecord | undefined): AnyRecord[] {
  if (!orderBy) return records
  const [[field, dir]] = Object.entries(orderBy)
  const factor = dir === 'desc' ? -1 : 1
  return [...records].sort((a, b) => {
    const av = a[field]
    const bv = b[field]
    const an = av instanceof Date ? av.getTime() : av
    const bn = bv instanceof Date ? bv.getTime() : bv
    if (an < bn) return -1 * factor
    if (an > bn) return 1 * factor
    return 0
  })
}

function createEntity(store: AnyRecord[], seq: { value: number }) {
  return {
    create: async ({ data }: { data: AnyRecord }) => {
      const record = { id: seq.value++, ...clone(data) }
      store.push(record)
      return clone(record)
    },
    update: async ({ where, data }: { where: { id: number }; data: AnyRecord }) => {
      const record = store.find((r) => r.id === where.id)
      if (!record) throw new Error(`Registro ${where.id} no encontrado`)
      Object.assign(record, clone(data))
      return clone(record)
    },
    delete: async ({ where }: { where: { id: number } }) => {
      const index = store.findIndex((r) => r.id === where.id)
      if (index === -1) throw new Error(`Registro ${where.id} no encontrado`)
      const [removed] = store.splice(index, 1)
      return clone(removed)
    },
    deleteMany: async ({ where }: { where?: AnyRecord } = {}) => {
      let count = 0
      for (let i = store.length - 1; i >= 0; i--) {
        if (matchesWhere(store[i], where)) {
          store.splice(i, 1)
          count++
        }
      }
      return { count }
    },
    findUnique: async ({ where }: { where: { id: number } }) => {
      const record = store.find((r) => r.id === where.id)
      return record ? clone(record) : null
    },
    findMany: async ({ where, orderBy }: { where?: AnyRecord; orderBy?: AnyRecord } = {}) => {
      const filtered = store.filter((r) => matchesWhere(r, where))
      return applyOrderBy(filtered, orderBy).map((r) => clone(r))
    },
  }
}

export type FakeDb = {
  clients: AnyRecord[]
  activities: AnyRecord[]
}

export type FakeContext = {
  user?: { id: number }
  entities: {
    Client: ReturnType<typeof createEntity>
    Activity: ReturnType<typeof createEntity>
  }
}

/**
 * Crea un contexto falso con almacenamiento en memoria.
 *
 * @param user Agente autenticado (omitir para simular ausencia de sesión).
 * @returns El `context` para pasar a acciones/consultas y el `db` subyacente
 *          para realizar aserciones directas sobre el estado persistido.
 */
export function createFakeContext(user?: { id: number }): {
  context: FakeContext
  db: FakeDb
} {
  const clients: AnyRecord[] = []
  const activities: AnyRecord[] = []
  const clientSeq = { value: 1 }
  const activitySeq = { value: 1 }

  const context: FakeContext = {
    user,
    entities: {
      Client: createEntity(clients, clientSeq),
      Activity: createEntity(activities, activitySeq),
    },
  }

  return { context, db: { clients, activities } }
}
