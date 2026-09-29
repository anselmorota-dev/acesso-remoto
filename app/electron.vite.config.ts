// Configuração do electron-vite: um build para cada processo do Electron.
// As pastas seguem a estrutura do projeto (main/, preload/, renderer/)
// em vez do padrão src/ do electron-vite, por isso as entradas são explícitas.
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// Dependências do package.json normalmente ficam de fora do bundle (são
// carregadas de node_modules em tempo de execução). O pacote shared é
// TypeScript puro, então precisa ser incluído no bundle (por isso ele é
// devDependency: o instalador não o leva em node_modules; a exclusão abaixo
// garante o bundle mesmo se ele voltar a "dependencies").
const externalizeDeps = { exclude: ['@acesso-remoto/shared'] };

/**
 * Preloads rodam em sandbox e não conseguem dar require() em outros arquivos
 * do app. Se os dois preloads (janela principal e indicador) importarem o
 * mesmo módulo, o Rollup o separa num arquivo compartilhado e o preload
 * quebra só na hora de rodar. Este plugin faz o build falhar antes disso.
 * (O isolatedEntries do electron-vite 5 resolveria, mas é experimental e
 * falha quando a saída do build não é um terminal.)
 */
function preloadsSemChunks(): Plugin {
  return {
    name: 'acesso-remoto:preloads-sem-chunks',
    generateBundle(_opcoes, bundle) {
      const compartilhados = Object.values(bundle)
        .filter((saida) => saida.type === 'chunk' && !saida.isEntry)
        .map((saida) => saida.fileName);
      if (compartilhados.length > 0) {
        this.error(
          `preload com arquivo compartilhado (${compartilhados.join(', ')}): os preloads não podem ` +
            'importar o mesmo módulo em tempo de execução (só "import type").',
        );
      }
    },
  };
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps,
      rollupOptions: { input: { index: resolve(__dirname, 'main/index.ts') } },
    },
  },
  preload: {
    plugins: [preloadsSemChunks()],
    build: {
      externalizeDeps,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'preload/index.ts'),
          indicador: resolve(__dirname, 'preload/indicador.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'renderer/index.html'),
          indicador: resolve(__dirname, 'renderer/indicador.html'),
        },
      },
    },
  },
});
