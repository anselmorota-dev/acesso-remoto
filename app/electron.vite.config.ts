// Configuração do electron-vite: um build para cada processo do Electron.
// As pastas seguem a estrutura do projeto (main/, preload/, renderer/)
// em vez do padrão src/ do electron-vite, por isso as entradas são explícitas.
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// Dependências do package.json normalmente ficam de fora do bundle (são
// carregadas de node_modules em tempo de execução). O pacote shared é
// TypeScript puro, então precisa ser incluído no bundle.
const externalizeDeps = { exclude: ['@acesso-remoto/shared'] };

export default defineConfig({
  main: {
    build: {
      externalizeDeps,
      rollupOptions: { input: { index: resolve(__dirname, 'main/index.ts') } },
    },
  },
  preload: {
    build: {
      externalizeDeps,
      rollupOptions: { input: { index: resolve(__dirname, 'preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'renderer/index.html') } },
    },
  },
});
