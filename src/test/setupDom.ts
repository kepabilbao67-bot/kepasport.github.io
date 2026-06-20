// Configuración común para las pruebas de componentes React.
//
// Registra los matchers de `@testing-library/jest-dom` (p. ej.
// `toBeInTheDocument`, `toHaveTextContent`) sobre `expect` de Vitest y limpia
// el DOM tras cada prueba para evitar fugas de estado entre casos.
//
// Este archivo se ejecuta en todos los entornos configurados en Vitest, pero
// solo tiene efecto real en las pruebas de UI (`.tsx`, entorno `jsdom`). En el
// entorno `node` los imports son inocuos.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
