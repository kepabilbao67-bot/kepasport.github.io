// Semilla de base de datos — datos iniciales del CRM
//
// Inserta el primer Cliente del Agente, "Kepa Bilbao", para que la aplicación
// disponga de datos de arranque al ejecutarse. La semilla es idempotente: si
// el Cliente ya existe (identificado por su correo electrónico) no se vuelve a
// crear, por lo que puede ejecutarse varias veces sin duplicar registros.
//
// Firma de semilla de Wasp 0.13: `(prismaClient) => Promise<void>`.
// Se cablea en `main.wasp` bajo `app.db.seeds`.

import type { PrismaClient } from '@prisma/client'

// Correo electrónico de marcador que identifica de forma única al Cliente
// sembrado y garantiza la idempotencia de la semilla.
const KEPA_EMAIL = 'kepa.bilbao@example.com'

/**
 * Siembra el Cliente inicial "Kepa Bilbao".
 *
 * Pasos:
 *   1. Garantiza que exista al menos un Usuario (Agente) propietario. Wasp
 *      gestiona las identidades de autenticación (usuario/contraseña) en sus
 *      propias entidades Auth/AuthIdentity, por lo que aquí solo se crea una
 *      fila mínima de `User` que sirva de propietario del Cliente.
 *   2. Crea el Cliente "Kepa Bilbao" asociado a ese Usuario, solo si todavía
 *      no existe un Cliente con el mismo correo electrónico (idempotente).
 *   3. Registra en español la acción realizada.
 */
export const seedKepaBilbao = async (prisma: PrismaClient): Promise<void> => {
  // 1. Asegura un Usuario propietario: reutiliza el primero si existe,
  //    o crea una fila mínima de demostración en caso contrario.
  let owner = await prisma.user.findFirst()
  if (!owner) {
    owner = await prisma.user.create({ data: {} })
    console.log(
      `[seed] Usuario propietario de demostración creado (id=${owner.id}).`
    )
  } else {
    console.log(
      `[seed] Reutilizando Usuario existente como propietario (id=${owner.id}).`
    )
  }

  // 2. Idempotencia: no duplicar el Cliente si ya fue sembrado.
  const existente = await prisma.client.findFirst({
    where: { email: KEPA_EMAIL },
  })
  if (existente) {
    console.log(
      `[seed] El Cliente "Kepa Bilbao" ya existe (id=${existente.id}); no se realizan cambios.`
    )
    return
  }

  // 3. Crea el Cliente inicial con valores por defecto sensatos en español.
  const cliente = await prisma.client.create({
    data: {
      name: 'Kepa Bilbao',
      email: KEPA_EMAIL,
      phone: '+34 600 000 000',
      company: 'Bilbao Consulting',
      status: 'activo',
      notes: 'Cliente inicial creado por la semilla de la base de datos.',
      ownerId: owner.id,
      lastActivityAt: new Date(),
    },
  })

  console.log(
    `[seed] Cliente "Kepa Bilbao" creado correctamente (id=${cliente.id}), propietario id=${owner.id}.`
  )
}
