import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const wasmMimePlugin = () => ({
  name: 'wasm-mime-type',
  configureServer(server: { middlewares: { use: (fn: any) => void } }) {
    server.middlewares.use((req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
      const path = req.url?.split('?')[0] ?? '';
      if (path.endsWith('.wasm')) {
        const originalSetHeader = res.setHeader.bind(res);
        res.setHeader = (key: string, value: string) => {
          if (key.toLowerCase() === 'content-type') {
            return originalSetHeader('Content-Type', 'application/wasm');
          }
          return originalSetHeader(key, value);
        };
      }
      next();
    });
  },
  configurePreviewServer(server: { middlewares: { use: (fn: any) => void } }) {
    server.middlewares.use((req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
      const path = req.url?.split('?')[0] ?? '';
      if (path.endsWith('.wasm')) {
        const originalSetHeader = res.setHeader.bind(res);
        res.setHeader = (key: string, value: string) => {
          if (key.toLowerCase() === 'content-type') {
            return originalSetHeader('Content-Type', 'application/wasm');
          }
          return originalSetHeader(key, value);
        };
      }
      next();
    });
  }
});

export default defineConfig({
  plugins: [react(), wasmMimePlugin()],
  // Load .env files from the parent directory (repo root)
  envDir: '..',
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: path.resolve(__dirname, './node_modules/buffer/')
    },
    dedupe: ['@stellar/stellar-sdk']
  },
  optimizeDeps: {
    include: [
      '@stellar/stellar-sdk',
      '@stellar/stellar-sdk/contract',
      '@stellar/stellar-sdk/rpc',
      'buffer'
    ],
    exclude: [
      '@aztec/bb.js',
      '@noir-lang/noir_js',
      '@noir-lang/acvm_js',
      '@noir-lang/noirc_abi'
    ],
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    }
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  server: {
    port: 3000,
    open: true
  }
})
