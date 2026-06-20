/**
 * Ayudante compartido de pruebas: un contexto de Wasp simulado con entidades
 * Prisma en memoria.
 *
 * Motivación
 * ----------
 * Las operaciones del backend (`server/clients/*`, `server/chat/*`) reciben un
 * `context` de Wasp con `context.user` y `context.entities.<Entidad>` (el
 * cliente Prisma). En el entorno de pruebas no hay base de datos ni cadena de
 * herramientas de Prisma, por lo que aquí se emula `findMany`, `findUnique`,
 * `create`, `update`, `delete` y `deleteMany` sobre arreglos en memoria.
 *
 * Fidelidad
 * ---------
 * El emulador interpreta la cláusula `where` de Prisma de forma GENÉRICA, sin
 * conocer la propiedad concreta bajo prueba: soporta igualdad escalar, los
 * conectores lógicos `OR`/`AND`/`NOT` y los filtros de cadena `contains`,
 * `equals`, `startsWith`, `endsWith` con `mode: 'insensitive'`. De este modo,
 * si una operación construyera mal su `where` (por ejemplo, omitiendo un campo
 * o usando una comparación sensible a mayúsculas), el resultado emulado
 * divergiría del conjunto esperado calculado de forma independiente y la
 * prueba fallaría.
 *
 * Reutilizable por las tareas 4.4 (CRUD) y 4.5 (búsqueda).
 */

export type AnyRecord = Record<string, any>

/** Determina si un valor de cadena satisface un filtro de cadena de Prisma. */
function matchesStringFilter(value: unknown, filter: AnyRecord): boolean {
  const insensitive = filter.mode === 'insensitive'
  const norm = (s: unknown) =>
    insensitive ? String(s).toLowerCase() : String(s)

  if ('contains' in filter) {
    if (value == null) return false
    return norm(value).includes(norm(filter.contains))
  }
  if ('equals' in filter) {
    if (value == null) return filter.equals == null
    return norm(value) === norm(filter.equals)
  }
  if ('startsWith' in filter) {
    if (value == null) return false
    return norm(value).startsWith(norm(filter.startsWith))
  }
  if ('endsWith' in filter) {
    if (value == null) return false
    return norm(value).endsWith(norm(filter.endsWith))
  }
  return false
}

/** Evalúa una cláusula `where` de Prisma contra un único registro. */
export function matchesWhere(record: AnyRecord, where?: AnyRecord): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return (condition as AnyRecord[]).some((c) => matchesWhere(record, c))
    }
    if (key === 'AND') {
      return (condition as AnyRecord[]).every((c) => matchesWhere(record, c))
    }
    if (key === 'NOT') {
      return !matchesWhere(record, condition as AnyRecord)
    }

    const value = record[key]
    // Filtro de cadena u objeto de condición.
    if (condition !== null && typeof condition === 'object') {
      return matchesStringFilter(value, condition as AnyRecord)
    }
    // Igualdad escalar directa.
    return value === condition
  })
}

/** Aplica `orderBy` (un objeto o un arreglo de objetos) a una lista. */
export function applyOrderBy<T extends AnyRecord>(
  rows: T[],
  orderBy?: AnyRecord | AnyRecord[]
): T[] {
  if (!orderBy) return rows
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy]
  const sorted = [...rows]
  sorted.sort((a, b) => {
    for (const spec of specs) {
      for (const [field, dir] of Object.entries(spec)) {
        const av = a[field]
        const bv = b[field]
        if (av < bv) return dir === 'desc' ? 1 : -1
        if (av > bv) return dir === 'desc' ? -1 : 1
      }
    }
    return 0
  })
  return sorted
}

/** Cliente Prisma en memoria para una entidad. */
export function makeEntity<T extends AnyRecord>(seed: T[] = []) {
  let rows: T[] = seed.map((r) => ({ ...r }))
  let nextId =
    rows.reduce((max, r) => Math.max(max, Number(r.id ?? 0)), 0) + 1

  return {
    /** Acceso directo a las filas (para aserciones en pruebas). */
    _rows: () => rows,

    findMany: async ({
      where,
      orderBy,
    }: { where?: AnyRecord; orderBy?: AnyRecord | AnyRecord[] } = {}) => {
      const matched = rows.filter((r) => matchesWhere(r, where))
      return applyOrderBy(matched, orderBy).map((r) => ({ ...r }))
    },

    findUnique: async ({ where }: { where: AnyRecord }) => {
      const found = rows.find((r) => matchesWhere(r, where))
      return found ? { ...found } : null
    },

    create: async ({ data }: { data: AnyRecord }) => {
      const row = { id: nextId++, ...data } as T
      rows.push(row)
      return { ...row }
    },

    update: async ({ where, data }: { where: AnyRecord; data: AnyRecord }) => {
      const idx = rows.findIndex((r) => matchesWhere(r, where))
      if (idx === -1) throw new Error('Registro no encontrado para actualizar')
      rows[idx] = { ...rows[idx], ...data }
      return { ...rows[idx] }
    },

    delete: async ({ where }: { where: AnyRecord }) => {
      const idx = rows.findIndex((r) => matchesWhere(r, where))
      if (idx === -1) throw new Error('Registro no encontrado para eliminar')
      const [removed] = rows.splice(idx, 1)
      return { ...removed }
    },

    deleteMany: async ({ where }: { where?: AnyRecord } = {}) => {
      const before = rows.length
      rows = rows.filter((r) => !matchesWhere(r, where))
      return { count: before - rows.length }
    },
  }
}

export type MockEntities = Record<string, ReturnType<typeof makeEntity>>

/**
 * Construye un `context` de Wasp simulado.
 *
 * @param entities Mapa de nombre de entidad a su cliente Prisma en memoria.
 * @param userId   Identificador del Agente autenticado, o `undefined` para
 *                 simular una solicitud no autenticada.
 */
export function makeContext(
  entities: MockEntities,
  userId?: number
): { user?: { id: number }; entities: MockEntities } {
  return {
    user: userId === undefined ? undefined : { id: userId },
    entities,
  }
}
