import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    // Las fuentes usan importaciones con extensión `.js` (NodeNext) que en
    // realidad apuntan a archivos `.ts`. Permitir que Vite las resuelva.
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
    alias: [
      {
        // `wasp/server` es un enlace simbólico a la salida generada por Wasp,
        // ausente en pruebas. Redirigir a un stub con `HttpError`.
        find: /^wasp\/server$/,
        replacement: path.resolve(dirname, 'src/test/waspServerStub.ts'),
      },
      // Los módulos `wasp/client/*` y `wasp/entities` también los genera Wasp en
      // compilación y no existen en pruebas. Se redirigen a stubs (uno por
      // especificador, para que `vi.mock` de cada módulo no colisione) que
      // permiten a Vite resolver las importaciones de los componentes React.
      {
        find: /^wasp\/client\/operations$/,
        replacement: path.resolve(dirname, 'src/test/waspClientOperations.ts'),
      },
      {
        find: /^wasp\/client\/auth$/,
        replacement: path.resolve(dirname, 'src/test/waspClientAuth.ts'),
      },
      {
        find: /^wasp\/client\/api$/,
        replacement: path.resolve(dirname, 'src/test/waspClientApi.ts'),
      },
      {
        find: /^wasp\/entities$/,
        replacement: path.resolve(dirname, 'src/test/waspEntities.ts'),
      },
    ],
  },
  // Las fuentes y pruebas de la UI usan JSX. Transformarlo con el runtime
  // automático de React (`react/jsx-runtime`) evita tener que importar React
  // explícitamente en cada componente/prueba.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    // Incluir tanto pruebas `.ts` (lógica/servidor) como `.tsx` (componentes UI).
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Entorno por defecto `node` para las pruebas de servidor/lógica. Las
    // pruebas de componentes React (`.tsx`) se ejecutan en `jsdom` para disponer
    // del DOM, sin forzar ese entorno sobre las pruebas de servidor.
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    // Registra los matchers de `@testing-library/jest-dom` (p. ej. toBeInTheDocument).
    setupFiles: ['src/test/setupDom.ts'],
  },
})
