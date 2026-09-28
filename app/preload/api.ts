// Contrato do que o preload expõe ao renderer (window.api).
// Fica separado do preload para o renderer importar só o tipo,
// sem puxar os tipos do Electron e do Node para o lado do navegador.
import type { EventoInput } from '@acesso-remoto/shared';

/** Canal IPC renderer → main: pede para trazer a janela para frente. */
export const CANAL_CHAMAR_ATENCAO = 'janela:chamar-atencao';
/** Canal IPC renderer → main: executa um evento de input vindo do visualizador. */
export const CANAL_EXECUTAR_INPUT = 'input:executar';
/** Canal IPC renderer → main: solta botões apertados (fim da sessão). */
export const CANAL_LIBERAR_INPUT = 'input:liberar';

export interface ApiDoPreload {
  /** Versões dos componentes, exibidas na tela para conferência. */
  readonly versoes: {
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };
  /** Traz a janela para frente (ou pisca na barra de tarefas), ex.: pedido de acesso. */
  chamarAtencao(): void;
  /** Anfitrião: controle do mouse/teclado deste computador pelo visualizador. */
  readonly input: {
    /** Executa um evento (o main valida de novo antes). */
    executar(evento: EventoInput): void;
    /** Solta tudo que estiver apertado; chamar ao fim da sessão. */
    liberar(): void;
  };
}
