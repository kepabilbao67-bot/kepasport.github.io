// Stub de `wasp/client/operations` para pruebas.
//
// Wasp genera este módulo en tiempo de compilación; no existe durante las
// pruebas. Este stub permite que Vite resuelva las importaciones de los
// componentes. Las pruebas suelen sustituir estos símbolos mediante
// `vi.mock('wasp/client/operations', ...)` para controlar su comportamiento.

export const getClients = 'getClients'
export const searchClients = 'searchClients'
export const getClient = 'getClient'
export const addActivity = (..._args: unknown[]) => Promise.resolve(undefined)
export const createClient = (..._args: unknown[]) => Promise.resolve(undefined)
export const updateClient = (..._args: unknown[]) => Promise.resolve(undefined)
export const getConversations = 'getConversations'
export const getMessages = 'getMessages'
export const useQuery = (..._args: unknown[]) => ({
  data: undefined,
  isLoading: false,
  error: undefined,
  refetch: () => {},
})
