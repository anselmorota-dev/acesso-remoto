// Contrato do que o preload expõe ao renderer (window.api).
// Fica separado do preload para o renderer importar só o tipo,
// sem puxar os tipos do Electron e do Node para o lado do navegador.
import type { EventoInput, IdMonitor, Monitor, ProblemaSenha } from '@acesso-remoto/shared';

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
/** Canal IPC renderer → main: em sessão, não deixar o computador suspender (true/false). */
export const CANAL_MANTER_ACORDADO = 'sessao:manter-acordado';
/** Área de transferência compartilhada: liga/desliga o monitor (renderer → main). */
export const CANAL_AREA_MONITORAR = 'area:monitorar';
/** main → renderer: texto novo copiado neste computador (null: grande demais). */
export const CANAL_AREA_COPIADO = 'area:copiado';
/** renderer → main: escreve o texto que veio do outro computador. */
export const CANAL_AREA_ESCREVER = 'area:escrever';
/** Arquivos recebidos (gravados pelo main em Downloads\Acesso Remoto). */
export const CANAL_ARQUIVOS_INICIAR = 'arquivos:iniciar';
export const CANAL_ARQUIVOS_PEDACO = 'arquivos:pedaco';
export const CANAL_ARQUIVOS_CONCLUIR = 'arquivos:concluir';
export const CANAL_ARQUIVOS_DESCARTAR = 'arquivos:descartar';
export const CANAL_ARQUIVOS_MOSTRAR = 'arquivos:mostrar';
/** main → renderer: a gravação de um arquivo falhou (ex.: disco cheio). */
export const CANAL_ARQUIVOS_FALHOU = 'arquivos:falhou';
/** renderer → main: chegou mensagem no chat (avisa se a janela não estiver em foco). */
export const CANAL_CHAT_NOTIFICAR = 'chat:notificar';
/** main → renderer: clicaram na notificação; abrir o chat. */
export const CANAL_CHAT_ABRIR = 'chat:abrir';

/** Monitores deste computador (anfitrião): lista, escolha para a próxima captura e aviso de mudança. */
export const CANAL_MONITORES_LISTAR = 'monitores:listar';
export const CANAL_MONITORES_PREPARAR = 'monitores:preparar';
export const CANAL_MONITORES_MUDOU = 'monitores:mudou';

/** Resultado de terminar de receber um arquivo. */
export type ConclusaoArquivo = { ok: true; nome: string } | { ok: false; erro: 'tamanho' | 'disco' };
/** Canais IPC renderer ⇄ main (com resposta) da senha de acesso não supervisionado. */
export const CANAL_SENHA_ESTADO = 'senha:estado';
export const CANAL_SENHA_DEFINIR = 'senha:definir';
export const CANAL_SENHA_REMOVER = 'senha:remover';
/** Confere a senha de quem quer acessar este computador (com limite de tentativas). */
export const CANAL_SENHA_TENTAR = 'senha:tentar';

/** Canal IPC renderer → main: estado que o ícone da bandeja mostra (ID, quem controla). */
export const CANAL_BANDEJA_ESTADO = 'bandeja:estado';
/** Canais IPC do "iniciar junto com o computador". */
export const CANAL_INICIO_AUTOMATICO_LER = 'sistema:inicio-automatico';
export const CANAL_INICIO_AUTOMATICO_DEFINIR = 'sistema:definir-inicio-automatico';
/** main → renderer: a opção mudou (ex.: pelo menu da bandeja). */
export const CANAL_INICIO_AUTOMATICO_MUDOU = 'sistema:inicio-automatico-mudou';

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
    /** Em sessão (qualquer papel): mantém a tela acesa e o sistema sem suspender. */
    manterAcordado(ligar: boolean): void;
  };
  /** Anfitrião: monitores deste computador (o visualizador escolhe qual ver). */
  readonly monitores: {
    /** Da esquerda para a direita. */
    listar(): Promise<Monitor[]>;
    /**
     * Qual monitor a próxima captura (getDisplayMedia) deve entregar (null:
     * o principal). Devolve o que será entregue: o pedido, ou o principal se
     * ele não existir mais.
     */
    preparar(id: IdMonitor | null): Promise<IdMonitor | null>;
    /** Registra quem trata a mudança dos monitores (entrou, saiu, mudou de resolução). */
    aoMudar(tratar: () => void): void;
  };
  /** Área de transferência compartilhada (texto), só durante a sessão liberada. */
  readonly areaTransferencia: {
    /** Liga/desliga; "enviarAtual": o que já está copiado conta como novo. */
    monitorar(ligar: boolean, enviarAtual: boolean): void;
    /** Registra quem recebe cada texto copiado neste computador (null: grande demais). */
    aoCopiar(tratar: (texto: string | null) => void): void;
    /** Escreve o texto que veio do outro computador. */
    escrever(texto: string): void;
  };
  /**
   * Arquivos recebidos do outro computador: o main grava em
   * Downloads\Acesso Remoto (nome e pasta decididos lá; nada é aberto sozinho).
   */
  readonly arquivos: {
    /** Começa a gravar; devolve um token (ou null se não deu para criar o arquivo). */
    iniciar(nome: string, tamanho: number): Promise<string | null>;
    gravar(token: string, pedaco: Uint8Array): void;
    concluir(token: string): Promise<ConclusaoArquivo>;
    /** Abandona (cancelado, sessão encerrada): apaga o parcial. */
    descartar(token: string): void;
    /** Abre a pasta com o arquivo recebido selecionado. */
    mostrar(token: string): void;
    /** Registra quem trata uma falha de gravação (disco cheio...). */
    aoFalhar(tratar: (token: string) => void): void;
  };
  /** Chat: aviso de mensagem nova quando a janela não está em foco. */
  readonly chat: {
    /** Chegou mensagem de "de" (o main decide se avisa: só sem foco, e sem exagero). */
    notificar(de: string, texto: string): void;
    /** Registra quem abre o chat quando o usuário clica na notificação. */
    aoAbrir(tratar: () => void): void;
  };
  /** Ícone da bandeja: a janela principal informa o ID e quem está controlando. */
  readonly bandeja: {
    atualizar(estado: { id: string | null; parceiro: string | null }): void;
  };
  /** "Iniciar junto com o computador" (abre escondido, só na bandeja). */
  readonly inicioAutomatico: {
    ligado(): Promise<boolean>;
    definir(ligar: boolean): Promise<boolean>;
    /** Avisa quando a opção muda por outro caminho (menu da bandeja). */
    aoMudar(tratar: (ligado: boolean) => void): void;
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
