// Contrato do que o preload expõe ao renderer (window.api).
// Fica separado do preload para o renderer importar só o tipo,
// sem puxar os tipos do Electron e do Node para o lado do navegador.

/** Canal IPC renderer → main: pede para trazer a janela para frente. */
export const CANAL_CHAMAR_ATENCAO = 'janela:chamar-atencao';

export interface ApiDoPreload {
  /** Versões dos componentes, exibidas na tela para conferência. */
  readonly versoes: {
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };
  /** Traz a janela para frente (ou pisca na barra de tarefas), ex.: pedido de acesso. */
  chamarAtencao(): void;
}
