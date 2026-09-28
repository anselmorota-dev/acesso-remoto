// Contrato do que o preload expõe ao renderer (window.api).
// Fica separado do preload para o renderer importar só o tipo,
// sem puxar os tipos do Electron e do Node para o lado do navegador.
import type { EventoInput, ProblemaSenha } from '@acesso-remoto/shared';

/** Canal IPC renderer → main: pede para trazer a janela para frente. */
export const CANAL_CHAMAR_ATENCAO = 'janela:chamar-atencao';
/** Canal IPC renderer → main: executa um evento de input vindo do visualizador. */
export const CANAL_EXECUTAR_INPUT = 'input:executar';
/** Canal IPC renderer → main: solta botões apertados (fim da sessão). */
export const CANAL_LIBERAR_INPUT = 'input:liberar';
/** Canal IPC renderer → main: mostra o indicador de sessão (ID do parceiro) ou o esconde (null). */
export const CANAL_INDICAR_SESSAO = 'sessao:indicar';
/** Canal IPC main → renderer: pedido para encerrar a sessão (veio do indicador). */
export const CANAL_PEDIDO_ENCERRAR = 'sessao:pedido-encerrar';
/** Canais IPC renderer ⇄ main (com resposta) da senha de acesso não supervisionado. */
export const CANAL_SENHA_ESTADO = 'senha:estado';
export const CANAL_SENHA_DEFINIR = 'senha:definir';
export const CANAL_SENHA_REMOVER = 'senha:remover';
/** Confere a senha de quem quer acessar este computador (com limite de tentativas). */
export const CANAL_SENHA_TENTAR = 'senha:tentar';

/** Canais IPC renderer ⇄ main (com resposta) da identidade da instalação (ID fixo). */
export const CANAL_IDENTIDADE_CHAVE = 'identidade:chave-publica';
export const CANAL_IDENTIDADE_ASSINAR = 'identidade:assinar';

export type ErroSenha =ProblemaSenha | 'senha_atual_incorreta' | 'sessao_ativa';
export type ResultadoSenha = { ok: true } | { ok: false; erro: ErroSenha };
/** Resultado de uma tentativa de acesso com senha. */
export type ResultadoTentativaSenha = 'ok' | 'incorreta' | 'bloqueada' | 'sem_senha';

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
  /** Anfitrião: indicador flutuante de sessão ativa. */
  readonly sessao: {
    /** Mostra o indicador com quem está controlando, ou o esconde (null). */
    indicar(parceiro: string | null): void;
    /** Registra quem trata o pedido de encerrar feito pelo indicador. */
    aoPedirEncerramento(tratar: () => void): void;
  };
  /**
   * Identidade da instalação (ID fixo): o registro no servidor usa a chave
   * pública e a assinatura de um desafio. A chave privada fica no main.
   */
  readonly identidade: {
    chavePublica(): Promise<string>;
    assinarDesafio(desafio: string): Promise<string>;
  };
  /**
   * Senha de acesso não supervisionado. O hash fica só no main: daqui só se
   * sabe se há senha definida e se a mudança deu certo.
   */
  readonly senha: {
    estado(): Promise<{ definida: boolean }>;
    /** Define ou troca a senha; para trocar, "atual" precisa conferir. */
    definir(nova: string, atual: string | null): Promise<ResultadoSenha>;
    remover(atual: string): Promise<ResultadoSenha>;
    /** Anfitrião: confere a senha recebida de quem quer acessar (acesso não supervisionado). */
    tentar(senha: string): Promise<ResultadoTentativaSenha>;
  };
}
