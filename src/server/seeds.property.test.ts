// Pruebas basadas en propiedades para la idempotencia de la semilla (Tarea 14.2).
//
// Feature: claude-chatbot-assistant
//
// Cubre la propiedad de diseño 32 con fast-check (mínimo 100 iteraciones).
// La prueba ejercita la lógica REAL de `seedKepaBilbao` (en `seeds.ts`) contra
// un cliente Prisma en memoria que reproduce el subconjunto de la API de Prisma
// utilizado por la semilla (`user.findFirst`, `user.create`, `client.findFirst`
// con `where`, y `client.create` con id autoincremental). No se mockea la
// lógica de negocio de la semilla.
//
// Validates: Requirements 13.1, 13.2

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

import { seedKepaBilbao } from './seeds.js'

const NUM_RUNS = 100
const KEPA_EMAIL = 'kepa.bilbao@example.com'

// --- Cliente Prisma mínimo en memoria ---------------------------------------
//
// Reproduce sólo la superficie usada por `seedKepaBilbao`:
//   - prisma.user.findFirst()            → primer usuario o null
//   - prisma.user.create({ data })       → crea usuario con id autoincremental
//   - prisma.client.findFirst({ where }) → primer cliente que cumpla `where`
//   - prisma.client.create({ data })     → crea cliente con id autoincremental

type Row = Record<string, any>

interface ModelStore {
  rows: Row[]
  findFirst: (args?: { where?: Row }) => Promise<Row | null>
  create: (args: { data: Row }) => Promise<Row>
}

function createModel(): ModelStore {
  const rows: Row[] = []
  let nextId = 1

  const matches = (row: Row, where?: Row): boolean => {
    if (!where) return true
    return Object.keys(where).every((key) => row[key] === where[key])
  }

  return {
    rows,
    findFirst: async (args) => rows.find((r) => matches(r, args?.where)) ?? null,
    create: async ({ data }) => {
      const row = { id: nextId++, ...data }
      rows.push(row)
      return row
    },
  }
}

function createMockPrisma() {
  const user = createModel()
  const client = createModel()
  return { user, client } as any
}

// ---------------------------------------------------------------------------

describe('Feature: claude-chatbot-assistant — Semilla de la base de datos (propiedades)', () => {
  // Property 32: Idempotencia de la semilla de la base de datos
  // Validates: Requirements 13.1, 13.2
  it('Property 32: Idempotencia de la semilla de la base de datos — cualquier número de ejecuciones (>= 1) produce exactamente un Cliente "Kepa Bilbao" asociado a un propietario, sin duplicados', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        async (executions) => {
          const prisma = createMockPrisma()

          for (let i = 0; i < executions; i++) {
            await seedKepaBilbao(prisma)
          }

          // Exactamente un Cliente con el correo de Kepa Bilbao, sin duplicados.
          const kepas = prisma.client.rows.filter(
            (c: Row) => c.email === KEPA_EMAIL
          )
          expect(kepas).toHaveLength(1)

          // No se crean clientes adicionales más allá del de la semilla.
          expect(prisma.client.rows).toHaveLength(1)

          const kepa = kepas[0]
          expect(kepa.name).toBe('Kepa Bilbao')

          // El Cliente tiene un ownerId válido que apunta a un Usuario existente.
          expect(kepa.ownerId).toBeDefined()
          const owner = prisma.user.rows.find((u: Row) => u.id === kepa.ownerId)
          expect(owner).toBeDefined()

          // La semilla reutiliza un único Usuario propietario (no lo duplica).
          expect(prisma.user.rows).toHaveLength(1)
        }
      ),
      { numRuns: NUM_RUNS }
    )
  })

  // Refuerzo: ejecutar una vez vs. muchas veces produce el mismo recuento.
  // Validates: Requirements 13.1, 13.2
  it('Property 32 (refuerzo): ejecutar la semilla una vez y N veces produce el mismo recuento de clientes y usuarios', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 8 }), async (n) => {
        const once = createMockPrisma()
        await seedKepaBilbao(once)

        const many = createMockPrisma()
        for (let i = 0; i < n; i++) {
          await seedKepaBilbao(many)
        }

        expect(many.client.rows).toHaveLength(once.client.rows.length)
        expect(many.user.rows).toHaveLength(once.user.rows.length)
        expect(many.client.rows).toHaveLength(1)
        expect(many.user.rows).toHaveLength(1)
      }),
      { numRuns: NUM_RUNS }
    )
  })
})
