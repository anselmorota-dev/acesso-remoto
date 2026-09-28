// Contrato do preload do indicador de sessão (window.indicador).
// Fica separado de api.ts de propósito: os dois preloads não podem importar
// o mesmo módulo, senão o build gera um arquivo compartilhado que um preload
// em sandbox não consegue carregar (ver electron.vite.config.ts).

/** Canal IPC indicador → main: o usuário clicou em Encerrar no indicador. */
export const CANAL_ENCERRAR_PELO_INDICADOR = 'indicador:encerrar';

/** O que o preload do indicador expõe à página dele: só encerrar. */
export interface ApiIndicador {
  encerrar(): void;
}
