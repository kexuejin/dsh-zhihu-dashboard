/**
 * Browser client bundle for dsh-zhihu-dashboard, mirroring the DeepSeek
 * Harness client preset for an external package: a closure-factory artifact
 * calling window.__ModuleLoader__.load({ id, factory }) with externals
 * resolved through the injected require (loader module table).
 */
import { defineConfig } from 'tsdown'

const id = 'dsh-zhihu-dashboard'

/** Externals resolved from the loader module table at runtime (react entries only). */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime']

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  noExternal: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
