// Controla o ciclo de uma sessão: pedido → aceite (ou senha) → conexão WebRTC → fim.
// Recebe as mensagens do servidor, decide o próximo estado e cria/fecha a
// conexão com o outro computador. Não mexe na interface nem no WebSocket
// diretamente: recebe funções para isso (o que permite testá-lo no Node).
//
// Acesso com senha (não supervisionado): o anfitrião com senha definida aceita
// sozinho, mas a sessão começa "travada" (sem tela e sem controle). O
// visualizador manda a senha pela conexão direta; só se ela conferir o
// anfitrião libera a tela e o controle. A senha nunca passa pelo servidor.
//
// Sessões longas (sem limite de tempo): depois de conectados, vídeo e
// comandos vão direto entre os dois computadores, então:
//   - se o servidor cai ou reinicia, a sessão continua; ao voltar, o app
//     declara a sessão ("retomar") e o servidor religa os dois;
//   - se a conexão direta cai (ex.: um lado trocou de rede), o anfitrião
//     renegocia os caminhos (ICE restart) pelo servidor; se ela não voltar
//     no prazo (5 min), a sessão acaba;
//   - o fim da sessão também vai pela conexão direta (funciona sem servidor).
import type {
  EventoInput,
  IdCliente,
  IdMonitor,
  MensagemDoCliente,
  ModoQualidade,
  Monitor,
  MotivoEncerramento,
  MotivoFalha,
  MotivoFimPeloCanal,
  MotivoRecusa,
  Papel,
} from '@acesso-remoto/shared';
import type { CanalArquivos } from './arquivos';
import { ErroCaptura } from './captura';
import type { EstadoPar, OpcoesPar, Par } from './par';
import { ControleQualidade, type EstadoQualidade } from './qualidade';
import type { MensagemRecebida } from './sinalizacao';

export type EstadoSessao =
  /** "aviso" explica por que a última tentativa/sessão terminou, se for o caso. */
  | { fase: 'livre'; aviso?: string }
  /** Visualizador aguardando o anfitrião aceitar (ou conferir a senha). */
  | { fase: 'pedindo'; destino: IdCliente; comSenha: boolean }
  /**
   * Anfitrião precisa decidir se aceita. "expiraEm" (ms, relógio local) é
   * quando o servidor vai cancelar o pedido; serve só para a contagem na tela.
   * "verificandoSenha": pedido com senha sendo tratado sozinho (sem caixa de aceite).
   */
  | {
      fase: 'pedido_recebido';
      origem: IdCliente;
      expiraEm: number;
      respondendo: boolean;
      comSenha: boolean;
      verificandoSenha: boolean;
    }
  | {
      fase: 'em_sessao';
      parceiro: IdCliente;
      papel: Papel;
      conexao: EstadoPar;
      latenciaMs: number | null;
      /** Aceita por senha (e não por alguém clicando em Aceitar). */
      porSenha: boolean;
      /** Tela e controle liberados: logo no aceite, ou depois de a senha conferir. */
      liberada: boolean;
      /**
       * A conexão direta caiu e está sendo refeita: instante (ms, relógio
       * local) em que a sessão acaba se ela não voltar. null = conexão normal.
       */
      reconectandoAte: number | null;
      /**
       * Monitores do anfitrião e qual está sendo mostrado (null até a imagem
       * começar). O visualizador recebe pelo canal; o anfitrião guarda o que enviou.
       */
      monitores: MonitoresSessao | null;
      /** Qualidade do vídeo (modo, perfil em uso e, no visualizador, o que chega); null antes de a sessão liberar. */
      qualidade: EstadoQualidade | null;
    };

export interface MonitoresSessao {
  lista: Monitor[];
  atual: IdMonitor;
}

/** Quem está vendo e controlando este computador (anfitrião em sessão liberada), ou null. */
export function parceiroControlando(estado: EstadoSessao): IdCliente | null {
  return estado.fase === 'em_sessao' && estado.papel === 'anfitriao' && estado.liberada ? estado.parceiro : null;
}

/** Há um pedido esperando alguém clicar em Aceitar/Recusar? (O pedido com senha não mostra caixa.) */
export function caixaDeAceiteAberta(estado: EstadoSessao): boolean {
  return estado.fase === 'pedido_recebido' && !estado.verificandoSenha;
}

/** Resultado da conferência da senha no anfitrião (quem confere é o main). */
export type ResultadoTentativaSenha = 'ok' | 'incorreta' | 'bloqueada' | 'sem_senha';

export interface OpcoesControlador {
  /** Envia ao servidor; false se a conexão com ele não estiver aberta. */
  enviar: (mensagem: MensagemDoCliente) => boolean;
  aoMudarEstado: (estado: EstadoSessao) => void;
  criarPar: (opcoes: OpcoesPar) => Par;
  /** Visualizador: vídeo da tela remota chegou (ou null quando a sessão acaba). */
  aoMudarVideo?: (video: MediaStream | null) => void;
  /** Anfitrião: evento de mouse/teclado vindo do visualizador, a executar. */
  aoReceberInput?: (evento: EventoInput) => void;
  /** Anfitrião: a sessão acabou; soltar botões/teclas que ficaram apertados. */
  aoLiberarInput?: () => void;
  /** O outro computador copiou um texto: escrever na área de transferência daqui. */
  aoReceberAreaTransferencia?: (texto: string) => void;
  /**
   * Canal de arquivos da sessão, só com ela liberada (aceite ou senha
   * conferida); null quando não há (sem sessão, ainda travada ou encerrada).
   */
  aoMudarCanalArquivos?: (canal: CanalArquivos | null) => void;
  /** Mensagem do canal de arquivos (só da conexão atual e com a sessão liberada). */
  aoMensagemArquivos?: (dados: string | ArrayBuffer) => void;
  /** Mensagem do chat vinda do outro computador (só com a sessão liberada). */
  aoReceberChat?: (texto: string) => void;
  /** Anfitrião: os monitores deste computador, da esquerda para a direita. */
  listarMonitores?: () => Promise<Monitor[]>;
  /** Anfitrião: há senha de acesso não supervisionado definida? */
  senhaDefinida?: () => Promise<boolean>;
  /** Anfitrião: confere a senha recebida (com limite de tentativas). */
  tentarSenha?: (senha: string) => Promise<ResultadoTentativaSenha>;
  /**
   * A conexão direta caiu: conferir se a do servidor também (a rede pode ter
   * mudado), para reconectar logo e poder refazer a conexão direta.
   */
  verificarServidor?: () => void;
  /** Anfitrião: tempo máximo para a senha chegar depois da sessão começar. */
  prazoSenhaMs?: number;
  /** Tempo que a sessão espera a conexão direta voltar antes de acabar. */
  prazoReconexaoMs?: number;
  /** Anfitrião: de quanto em quanto tempo tenta refazer a conexão direta (ICE restart). */
  intervaloReinicioIceMs?: number;
  /** Canal direto fechado sem aviso: espera um pouco pelo motivo (vindo do servidor). */
  esperaCanalPerdidoMs?: number;
  /** De quanto em quanto tempo a qualidade do vídeo é medida (padrão 1 s). */
  intervaloQualidadeMs?: number;
}

const PRAZO_SENHA_PADRAO_MS = 15_000;
/** Escolha do usuário (etapa 4.1): 5 minutos tentando reconectar. */
const PRAZO_RECONEXAO_PADRAO_MS = 5 * 60_000;
const INTERVALO_REINICIO_ICE_PADRAO_MS = 10_000;
const ESPERA_CANAL_PERDIDO_PADRAO_MS = 2_000;

const TEXTO_RECUSA: Record<MotivoRecusa, string> = {
  recusado: 'O outro computador recusou o acesso.',
  offline: 'Nenhum computador online com esse ID.',
  ocupado: 'O outro computador já está em uma sessão.',
  sem_resposta: 'O outro computador não respondeu a tempo.',
  bloqueado: 'Acesso com senha a este computador pausado por excesso de senhas erradas. Tente mais tarde (ou peça o aceite, sem senha).',
};

const TEXTO_ENCERRAMENTO: Record<MotivoEncerramento, string> = {
  encerrada_pelo_parceiro: 'A sessão foi encerrada pelo outro computador.',
  parceiro_desconectou: 'O outro computador se desconectou.',
  captura_indisponivel: 'O outro computador não conseguiu capturar a tela.',
  falha_conexao: 'A conexão direta com o outro computador falhou.',
  senha_incorreta: 'Senha incorreta.',
  senha_bloqueada: 'Muitas tentativas com senha errada. Tente de novo mais tarde.',
};

/** Texto mostrado no lado onde a falha aconteceu. */
const TEXTO_FALHA_LOCAL: Record<MotivoFalha, string> = {
  captura_indisponivel: 'Não foi possível capturar a tela deste computador.',
  falha_conexao: 'Não foi possível estabelecer a conexão direta.',
  senha_incorreta: 'Uma tentativa de acesso com senha errada foi recusada.',
  senha_bloqueada: 'Tentativa de acesso com senha recusada: muitas senhas erradas seguidas.',
};

/** A conexão direta caiu no meio da sessão e não voltou no prazo. */
const TEXTO_RECONEXAO_ESGOTADA = 'A conexão direta caiu e não voltou a tempo; a sessão foi encerrada.';

/** O aviso de senha recusada só vai pelo servidor (que conta os erros); os outros vão também pelo canal. */
function avisoPeloCanal(motivo: MotivoFalha): { motivo: MotivoFimPeloCanal } | undefined {
  return motivo === 'senha_incorreta' || motivo === 'senha_bloqueada' ? undefined : { motivo };
}

export class ControladorSessao {
  private readonly opcoes: OpcoesControlador;
  private estadoAtual: EstadoSessao = { fase: 'livre' };
  private par: Par | null = null;
  /** Visualizador: senha a mandar quando a sessão por senha começar (só em memória). */
  private senhaParaEnviar: string | null = null;
  /** Anfitrião: prazo para a senha chegar; e se já há uma conferência em andamento. */
  private prazoSenha: ReturnType<typeof setTimeout> | undefined;
  private conferindoSenha = false;
  /** A conexão direta já chegou a funcionar nesta sessão (a partir daí, quedas são recuperáveis). */
  private jaConectou = false;
  /** O servidor liga esta sessão aos dois lados (e repassa sinais entre eles). */
  private ligadoNoServidor = false;
  /** Conexão direta caída: quando desistir, e (anfitrião) as tentativas de refazê-la. */
  private timerDesistir: ReturnType<typeof setTimeout> | undefined;
  private timerReinicioIce: ReturnType<typeof setInterval> | undefined;
  private timerCanalPerdido: ReturnType<typeof setTimeout> | undefined;
  /** Canal de arquivos do par atual (aberto), e o que foi entregue por último a quem usa. */
  private canalArquivos: CanalArquivos | null = null;
  private canalArquivosEntregue: CanalArquivos | null = null;
  /** Anfitrião: monitor sendo capturado (null antes de a imagem começar). */
  private monitorMostrado: IdMonitor | null = null;
  /** Anfitrião: numera os anúncios de monitores; um anúncio atrasado não vale. */
  private anuncioMonitores = 0;
  /** Qualidade do vídeo da sessão liberada (nos dois papéis). */
  private qualidade: ControleQualidade | null = null;

  constructor(opcoes: OpcoesControlador) {
    this.opcoes = opcoes;
  }

  get estado(): EstadoSessao {
    return this.estadoAtual;
  }

  // -------------------------------------------------------------------------
  // Ações do usuário
  // -------------------------------------------------------------------------

  /** Visualizador pede acesso a outro computador (com senha: sem precisar de aceite). */
  conectar(destino: IdCliente, senha?: string): void {
    if (this.estadoAtual.fase !== 'livre') return;
    const comSenha = Boolean(senha);
    if (!this.opcoes.enviar({ tipo: 'conectar', destino, comSenha })) {
      this.mudar({ fase: 'livre', aviso: 'Sem conexão com o servidor.' });
      return;
    }
    this.mudar({ fase: 'pedindo', destino, comSenha });
    this.senhaParaEnviar = senha || null; // depois do mudar: "livre" apaga a senha guardada
  }

  /** Anfitrião aceita ou recusa o pedido pendente (clicando na caixa). */
  responderPedido(aceito: boolean): void {
    const estado = this.estadoAtual;
    if (estado.fase !== 'pedido_recebido' || estado.respondendo || estado.verificandoSenha) return;
    this.opcoes.enviar({ tipo: 'responder_pedido', origem: estado.origem, aceito, porSenha: false });
    // Se aceitou, espera o servidor confirmar com "sessao_iniciada".
    this.mudar(aceito ? { ...estado, respondendo: true } : { fase: 'livre' });
  }

  /**
   * Visualizador: envia um evento de mouse/teclado ao anfitrião (só com a
   * sessão liberada). Com a conexão direta caída, descarta: senão o que foi
   * digitado às cegas ficaria na fila e seria executado de uma vez na volta.
   */
  enviarInput(evento: EventoInput): void {
    const estado = this.estadoAtual;
    if (estado.fase === 'em_sessao' && estado.papel === 'visualizador' && estado.liberada && estado.reconectandoAte === null) {
      this.par?.enviarInput(evento);
    }
  }

  /**
   * Texto copiado neste computador: vai para o outro (qualquer papel), só com
   * a sessão liberada. Com a conexão direta caída, fica na fila da conexão e
   * chega quando ela voltar (só o conteúdo, não executa nada lá).
   */
  enviarAreaTransferencia(texto: string): 'enviado' | 'grande_demais' | 'ignorado' {
    const estado = this.estadoAtual;
    if (estado.fase !== 'em_sessao' || !estado.liberada || !this.par) return 'ignorado';
    return this.par.enviarAreaTransferencia(texto) ? 'enviado' : 'grande_demais';
  }

  /** Mensagem do chat para o outro computador (só com a sessão liberada). false: não foi. */
  enviarChat(texto: string): boolean {
    const estado = this.estadoAtual;
    if (estado.fase !== 'em_sessao' || !estado.liberada || !this.par) return false;
    return this.par.enviarChat(texto);
  }

  /** Visualizador: pede para ver outro monitor do anfitrião (um dos que ele informou). */
  escolherMonitor(id: IdMonitor): void {
    const estado = this.estadoAtual;
    if (estado.fase !== 'em_sessao' || estado.papel !== 'visualizador' || !estado.liberada) return;
    if (!estado.monitores || estado.monitores.atual === id) return;
    if (!estado.monitores.lista.some((m) => m.id === id)) return;
    this.par?.escolherMonitor(id);
  }

  /** Visualizador: escolhe o modo de qualidade (o anfitrião aplica e confirma). */
  escolherQualidade(modo: ModoQualidade): void {
    const estado = this.estadoAtual;
    if (estado.fase !== 'em_sessao' || estado.papel !== 'visualizador' || !estado.liberada) return;
    this.qualidade?.escolher(modo);
  }

  /**
   * Anfitrião: os monitores deste computador mudaram (entrou, saiu, mudou de
   * resolução). Se o mostrado saiu, volta ao principal; e avisa o visualizador.
   */
  monitoresMudaram(): void {
    const par = this.par;
    if (!par || this.monitorMostrado === null || !this.anfitriaoLiberado()) return;
    void this.anunciarMonitores(par, true);
  }

  /** Cancela o pedido ou encerra a sessão (qualquer um dos lados). */
  encerrar(): void {
    const estado = this.estadoAtual;
    if (estado.fase === 'livre') return;
    if (estado.fase === 'pedido_recebido') {
      if (estado.verificandoSenha) {
        this.opcoes.enviar({ tipo: 'responder_pedido', origem: estado.origem, aceito: false, porSenha: false });
        this.mudar({ fase: 'livre' });
      } else {
        this.responderPedido(false);
      }
      return;
    }
    const estavaEmSessao = estado.fase === 'em_sessao';
    // Pelo servidor e pela conexão direta: o outro lado fica sabendo mesmo
    // que um dos dois caminhos esteja fora do ar.
    this.opcoes.enviar({ tipo: 'encerrar' });
    this.fecharPar({});
    this.mudar({ fase: 'livre', aviso: estavaEmSessao ? 'Sessão encerrada.' : undefined });
  }

  // -------------------------------------------------------------------------
  // Conexão com o servidor
  // -------------------------------------------------------------------------

  /**
   * A conexão com o servidor caiu: o servidor desfez os pedidos. Uma sessão
   * cuja conexão direta já funciona continua (e é retomada ao voltar).
   */
  servidorPerdido(): void {
    const estado = this.estadoAtual;
    if (estado.fase === 'livre') return;
    this.ligadoNoServidor = false;
    if (estado.fase === 'em_sessao' && this.jaConectou) return;
    // Pedido, ou sessão ainda negociando (os sinais passam pelo servidor): acaba.
    this.fecharPar();
    this.mudar({ fase: 'livre', aviso: 'A conexão com o servidor caiu; a sessão foi encerrada.' });
  }

  /** De volta ao servidor (registrado de novo): declara a sessão que continua. */
  servidorVoltou(): void {
    const estado = this.estadoAtual;
    if (estado.fase !== 'em_sessao' || this.ligadoNoServidor) return;
    this.opcoes.enviar({ tipo: 'retomar', parceiro: estado.parceiro, papel: estado.papel, porSenha: estado.porSenha });
  }

  // -------------------------------------------------------------------------
  // Mensagens do servidor
  // -------------------------------------------------------------------------

  receber(mensagem: MensagemRecebida): void {
    const estado = this.estadoAtual;

    switch (mensagem.tipo) {
      case 'pedido_conexao':
        if (estado.fase === 'livre') {
          this.mudar({
            fase: 'pedido_recebido',
            origem: mensagem.origem,
            expiraEm: Date.now() + mensagem.prazoMs,
            respondendo: false,
            comSenha: mensagem.comSenha,
            verificandoSenha: mensagem.comSenha,
          });
          if (mensagem.comSenha) void this.decidirPedidoComSenha(mensagem.origem);
        }
        return;

      case 'pedido_cancelado':
        if (estado.fase === 'pedido_recebido' && estado.origem === mensagem.origem) {
          // Pedido com senha que ninguém viu não precisa de aviso.
          this.mudar({ fase: 'livre', aviso: estado.verificandoSenha ? undefined : 'O pedido de acesso foi cancelado.' });
        }
        return;

      case 'pedido_recusado':
        if (estado.fase === 'pedindo' && estado.destino === mensagem.destino) {
          this.mudar({ fase: 'livre', aviso: TEXTO_RECUSA[mensagem.motivo] });
        }
        return;

      case 'sessao_iniciada': {
        // Só vale se confirmar exatamente o pedido que este lado fez/aceitou.
        const esperado =
          (estado.fase === 'pedindo' && mensagem.papel === 'visualizador' && estado.destino === mensagem.parceiro) ||
          (estado.fase === 'pedido_recebido' && mensagem.papel === 'anfitriao' && estado.origem === mensagem.parceiro);
        if (esperado) this.iniciarSessao(mensagem.parceiro, mensagem.papel, mensagem.porSenha);
        return;
      }

      case 'sinal':
        if (estado.fase === 'em_sessao' && this.par) {
          this.par.receberSinal(mensagem.sinal).catch((erro: unknown) => {
            // Na negociação inicial, um erro impede a conexão. Depois dela
            // (renegociação para reconectar), a próxima tentativa resolve.
            if (this.jaConectou) console.warn('[sessao] sinal da renegociação falhou:', erro);
            else this.falhaNaConexao(erro);
          });
        }
        return;

      case 'parceiro_ausente':
        // O parceiro caiu do servidor; a sessão continua pela conexão direta.
        if (estado.fase === 'em_sessao' && estado.parceiro === mensagem.parceiro) this.ligadoNoServidor = false;
        return;

      case 'sessao_retomada':
        if (estado.fase === 'em_sessao' && estado.parceiro === mensagem.parceiro) {
          this.ligadoNoServidor = true;
          // Se a conexão direta caiu enquanto não havia servidor, dá para refazê-la agora.
          this.tentarReiniciarIce();
        }
        return;

      case 'sessao_encerrada':
        if (estado.fase === 'em_sessao') {
          this.fecharPar();
          this.mudar({ fase: 'livre', aviso: TEXTO_ENCERRAMENTO[mensagem.motivo] });
        }
        return;

      case 'erro':
        // Ex.: pediu para o próprio ID. Volta ao início explicando o motivo.
        if (estado.fase === 'pedindo') this.mudar({ fase: 'livre', aviso: mensagem.mensagem });
        return;
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Pedido com senha: se este computador tem senha definida, aceita sozinho
   * (a senha é conferida depois, pela conexão direta). Se não tem, o pedido
   * vira um pedido comum, com a caixa de aceite.
   */
  private async decidirPedidoComSenha(origem: IdCliente): Promise<void> {
    let definida = false;
    try {
      definida = (await this.opcoes.senhaDefinida?.()) ?? false;
    } catch (erro) {
      console.error('[sessao] não foi possível ver se há senha definida:', erro);
    }
    const estado = this.estadoAtual;
    // O pedido pode ter sido cancelado enquanto esperávamos.
    if (estado.fase !== 'pedido_recebido' || estado.origem !== origem || !estado.verificandoSenha) return;
    if (definida) {
      this.opcoes.enviar({ tipo: 'responder_pedido', origem, aceito: true, porSenha: true });
      this.mudar({ ...estado, respondendo: true });
    } else {
      this.mudar({ ...estado, verificandoSenha: false });
    }
  }

  private iniciarSessao(parceiro: IdCliente, papel: Papel, porSenha: boolean): void {
    const senha = this.senhaParaEnviar;
    this.senhaParaEnviar = null;
    this.jaConectou = false;
    this.ligadoNoServidor = true;
    this.mudar({
      fase: 'em_sessao',
      parceiro,
      papel,
      conexao: 'conectando',
      latenciaMs: null,
      porSenha,
      liberada: !porSenha,
      reconectandoAte: null,
      monitores: null,
      qualidade: null,
    });

    const par = this.opcoes.criarPar({
      papel,
      enviarSinal: (sinal) => this.opcoes.enviar({ tipo: 'sinal', sinal }),
      aoMudarEstado: (conexao) => {
        if (this.par === par) this.aoMudarConexaoDireta(conexao);
      },
      aoMedirLatencia: (latenciaMs) => {
        if (this.par === par) this.atualizarSessao({ latenciaMs });
      },
      aoReceberVideo: (video) => {
        if (this.par === par) this.opcoes.aoMudarVideo?.(video);
      },
      // Só quem mostra a tela aceita ser controlado, só pela conexão atual
      // e só com a sessão liberada (na sessão por senha, depois da senha).
      aoReceberInput: (evento) => {
        const estado = this.estadoAtual;
        if (this.par === par && papel === 'anfitriao' && estado.fase === 'em_sessao' && estado.liberada) {
          this.opcoes.aoReceberInput?.(evento);
        }
      },
      // Área de transferência: só da conexão atual e com a sessão liberada
      // (na sessão por senha, nada entra antes de a senha conferir).
      aoReceberAreaTransferencia: (texto) => {
        const estado = this.estadoAtual;
        if (this.par === par && estado.fase === 'em_sessao' && estado.liberada) {
          this.opcoes.aoReceberAreaTransferencia?.(texto);
        }
      },
      // Chat: só da conexão atual e com a sessão liberada (na sessão por
      // senha, nada antes de a senha conferir).
      aoReceberChat: (texto) => {
        const estado = this.estadoAtual;
        if (this.par === par && estado.fase === 'em_sessao' && estado.liberada) this.opcoes.aoReceberChat?.(texto);
      },
      // Monitores: só da conexão atual e com a sessão liberada.
      aoReceberMonitores: (lista, atual) => {
        const estado = this.estadoAtual;
        if (this.par === par && estado.fase === 'em_sessao' && estado.papel === 'visualizador' && estado.liberada) {
          this.atualizarSessao({ monitores: { lista, atual } });
        }
      },
      aoEscolherMonitor: (id) => {
        if (this.par === par) void this.trocarMonitor(par, id);
      },
      // Qualidade: só da conexão atual e com a sessão liberada (quem mede e aplica é o ControleQualidade).
      aoPedirQualidade: (modo) => {
        if (this.par === par && this.anfitriaoLiberado()) this.qualidade?.pedirModo(modo);
      },
      aoReceberEstadoQualidade: (modo, efetivo) => {
        const estado = this.estadoAtual;
        if (this.par === par && estado.fase === 'em_sessao' && estado.papel === 'visualizador' && estado.liberada) {
          this.qualidade?.receberEstado(modo, efetivo);
        }
      },
      aoMudarCanalArquivos: (canal) => {
        if (this.par !== par) return;
        this.canalArquivos = canal;
        this.entregarCanalArquivos();
      },
      aoMensagemArquivos: (dados) => {
        const estado = this.estadoAtual;
        if (this.par === par && estado.fase === 'em_sessao' && estado.liberada) {
          this.opcoes.aoMensagemArquivos?.(dados);
        }
      },
      aoReceberSenha: (senhaRecebida) => {
        if (this.par === par) void this.conferirSenha(par, senhaRecebida);
      },
      aoAutenticado: () => {
        const estado = this.estadoAtual;
        if (this.par === par && estado.fase === 'em_sessao' && estado.papel === 'visualizador' && estado.porSenha) {
          this.atualizarSessao({ liberada: true });
          this.iniciarQualidade(par, 'visualizador');
        }
      },
      aoEncerrarPeloParceiro: (motivo) => {
        if (this.par !== par || this.estadoAtual.fase !== 'em_sessao') return;
        // Avisa o servidor também: se o outro lado estava fora dele, o servidor
        // ainda guarda esta sessão esperando a retomada.
        this.opcoes.enviar({ tipo: 'encerrar' });
        this.fecharPar();
        this.mudar({ fase: 'livre', aviso: TEXTO_ENCERRAMENTO[motivo ?? 'encerrada_pelo_parceiro'] });
      },
      aoPerderCanal: () => {
        if (this.par !== par) return;
        // O outro lado fechou a conexão sem aviso pelo canal (ex.: senha
        // recusada, cujo aviso só vem pelo servidor): espera um pouco pelo
        // motivo; se não vier, encerra por falha.
        clearTimeout(this.timerCanalPerdido);
        this.timerCanalPerdido = setTimeout(
          () => {
            if (this.par === par) this.encerrarPorFalha('falha_conexao');
          },
          this.opcoes.esperaCanalPerdidoMs ?? ESPERA_CANAL_PERDIDO_PADRAO_MS,
        );
      },
    });
    this.par = par;
    par.iniciar().catch((erro: unknown) => this.falhaNaConexao(erro));

    if (papel === 'anfitriao' && !porSenha) {
      // Aceite comum: a tela começa a ir já.
      this.liberarTela(par);
    } else if (papel === 'anfitriao') {
      // Por senha: se ela não chegar a tempo, a sessão acaba.
      this.prazoSenha = setTimeout(
        () => this.encerrarPorFalha('senha_incorreta'),
        this.opcoes.prazoSenhaMs ?? PRAZO_SENHA_PADRAO_MS,
      );
    } else if (porSenha) {
      // Visualizador: manda a senha (o par espera o canal direto abrir).
      par.enviarSenha(senha ?? '');
    } else {
      // Visualizador, aceite comum: já liberada.
      this.iniciarQualidade(par, 'visualizador');
    }
  }

  /**
   * Começa a cuidar da qualidade do vídeo (sessão liberada; no anfitrião,
   * depois de a tela começar a ir).
   */
  private iniciarQualidade(par: Par, papel: Papel): void {
    if (this.par !== par || this.qualidade) return;
    const controle: ControleQualidade = new ControleQualidade({
      papel,
      par,
      intervaloMs: this.opcoes.intervaloQualidadeMs,
      aoMudar: (qualidade) => {
        if (this.qualidade === controle) this.atualizarSessao({ qualidade });
      },
    });
    this.qualidade = controle;
    this.atualizarSessao({ qualidade: controle.estado });
    controle.iniciar();
  }

  /** Mudança no estado da conexão direta (a do par atual). */
  private aoMudarConexaoDireta(conexao: EstadoPar): void {
    if (conexao === 'conectado') {
      this.jaConectou = true;
      this.pararReconexao();
      this.atualizarSessao({ conexao, reconectandoAte: null });
      return;
    }
    if (conexao === 'fechado') {
      this.atualizarSessao({ conexao });
      return;
    }
    // "conectando" (a rede oscilou) ou "falhou".
    if (!this.jaConectou) {
      // Ainda na primeira conexão: falhar aqui é não conseguir conectar.
      if (conexao === 'falhou') this.falhaNaConexao(new Error('ICE falhou'));
      else this.atualizarSessao({ conexao });
      return;
    }
    this.conexaoDiretaCaiu(conexao === 'falhou');
  }

  /**
   * A conexão direta caiu depois de ter funcionado: começa a contar o prazo
   * e (anfitrião) tenta refazê-la de tempos em tempos. Oscilações curtas
   * voltam sozinhas; "falhou" pede uma tentativa na hora.
   */
  private conexaoDiretaCaiu(falhou: boolean): void {
    const estado = this.estadoAtual;
    if (estado.fase !== 'em_sessao') return;
    if (!this.timerDesistir) {
      const prazo = this.opcoes.prazoReconexaoMs ?? PRAZO_RECONEXAO_PADRAO_MS;
      this.timerDesistir = setTimeout(() => this.desistirDeReconectar(), prazo);
      this.atualizarSessao({ conexao: 'conectando', reconectandoAte: Date.now() + prazo });
      // A rede pode ter mudado: a conexão com o servidor talvez também tenha morrido.
      this.opcoes.verificarServidor?.();
      if (estado.papel === 'anfitriao') {
        // O "soltar" de um botão ou tecla pode se perder na queda: solta tudo já.
        this.opcoes.aoLiberarInput?.();
        this.timerReinicioIce = setInterval(
          () => this.tentarReiniciarIce(),
          this.opcoes.intervaloReinicioIceMs ?? INTERVALO_REINICIO_ICE_PADRAO_MS,
        );
      }
    }
    if (falhou) this.tentarReiniciarIce();
  }

  /** Anfitrião: refaz a conexão direta, se ela está caída e o servidor liga os dois. */
  private tentarReiniciarIce(): void {
    const estado = this.estadoAtual;
    if (estado.fase !== 'em_sessao' || estado.papel !== 'anfitriao') return;
    if (!this.par || !this.timerDesistir || !this.ligadoNoServidor) return;
    this.par.reiniciarIce().catch((erro: unknown) => console.warn('[sessao] falha ao refazer a conexão direta:', erro));
  }

  private desistirDeReconectar(): void {
    if (this.estadoAtual.fase !== 'em_sessao') return;
    this.opcoes.enviar({ tipo: 'encerrar', motivo: 'falha_conexao' });
    this.fecharPar({ motivo: 'falha_conexao' });
    this.mudar({ fase: 'livre', aviso: TEXTO_RECONEXAO_ESGOTADA });
  }

  private pararReconexao(): void {
    clearTimeout(this.timerDesistir);
    clearInterval(this.timerReinicioIce);
    this.timerDesistir = undefined;
    this.timerReinicioIce = undefined;
  }

  /** Anfitrião: confere a senha recebida; libera tudo ou encerra a sessão. */
  private async conferirSenha(par: Par, senha: string): Promise<void> {
    const estado = this.estadoAtual;
    // Uma tentativa por sessão: nada de ficar testando senhas na mesma conexão.
    if (estado.fase !== 'em_sessao' || estado.papel !== 'anfitriao' || estado.liberada || this.conferindoSenha) return;
    this.conferindoSenha = true;

    let resultado: ResultadoTentativaSenha;
    try {
      resultado = (await this.opcoes.tentarSenha?.(senha)) ?? 'sem_senha';
    } catch (erro) {
      console.error('[sessao] falha ao conferir a senha:', erro);
      resultado = 'incorreta';
    }
    if (this.par !== par) return; // a sessão acabou enquanto conferíamos

    if (resultado === 'ok') {
      clearTimeout(this.prazoSenha);
      this.atualizarSessao({ liberada: true });
      par.confirmarAutenticacao();
      this.liberarTela(par);
    } else {
      this.encerrarPorFalha(resultado === 'bloqueada' ? 'senha_bloqueada' : 'senha_incorreta');
    }
  }

  private anfitriaoLiberado(): boolean {
    const estado = this.estadoAtual;
    return estado.fase === 'em_sessao' && estado.papel === 'anfitriao' && estado.liberada;
  }

  /**
   * Anfitrião: começa a enviar a tela (monitor principal), passa a cuidar da
   * qualidade e conta ao visualizador quais monitores há.
   */
  private liberarTela(par: Par): void {
    par.liberarTela().then(
      (monitor) => {
        if (this.par !== par) return;
        this.iniciarQualidade(par, 'anfitriao');
        if (monitor === null) return;
        this.monitorMostrado = monitor;
        void this.anunciarMonitores(par, false);
      },
      (erro: unknown) => {
        if (this.par === par) this.falhaNaConexao(erro);
      },
    );
  }

  /**
   * Anfitrião: passa a mostrar outro monitor (id null: o principal). Pelo
   * visualizador, só um dos monitores anunciados. Se a captura falhar, o
   * monitor anterior continua (a sessão não cai por isso).
   */
  private async trocarMonitor(par: Par, id: IdMonitor | null): Promise<void> {
    const estado = this.estadoAtual;
    if (estado.fase !== 'em_sessao' || !this.anfitriaoLiberado() || this.monitorMostrado === null) return;
    if (id !== null && !estado.monitores?.lista.some((m) => m.id === id)) return;
    if (id === this.monitorMostrado) return;
    try {
      const monitor = await par.trocarMonitor(id);
      if (this.par !== par) return;
      if (monitor !== null) this.monitorMostrado = monitor;
    } catch (erro) {
      console.warn('[sessao] não foi possível trocar de monitor:', erro);
      if (this.par !== par) return;
    }
    // Mesmo se falhou: o visualizador fica sabendo qual continua à vista.
    await this.anunciarMonitores(par, false);
  }

  /**
   * Anfitrião: envia ao visualizador a lista de monitores e qual está à vista.
   * "conferirMostrado": se o monitor mostrado não existe mais, volta ao principal.
   */
  private async anunciarMonitores(par: Par, conferirMostrado: boolean): Promise<void> {
    const numero = ++this.anuncioMonitores;
    let lista: Monitor[];
    try {
      lista = (await this.opcoes.listarMonitores?.()) ?? [];
    } catch (erro) {
      console.warn('[sessao] não foi possível listar os monitores:', erro);
      return;
    }
    // Outro anúncio começou depois deste (ou a sessão acabou): este não vale mais.
    if (this.par !== par || numero !== this.anuncioMonitores || !this.anfitriaoLiberado()) return;
    const atual = this.monitorMostrado;
    if (atual === null) return;
    if (!lista.some((m) => m.id === atual)) {
      // O monitor mostrado foi desconectado: volta ao principal (e anuncia depois).
      if (conferirMostrado) void this.trocarMonitor(par, null);
      return;
    }
    this.atualizarSessao({ monitores: { lista, atual } });
    par.enviarMonitores(lista, atual);
  }

  private falhaNaConexao(erro: unknown): void {
    console.error('[sessao] falha na sessão:', erro);
    this.encerrarPorFalha(erro instanceof ErroCaptura ? 'captura_indisponivel' : 'falha_conexao');
  }

  /** Encerra a sessão por uma falha deste lado, avisando o outro do motivo. */
  private encerrarPorFalha(motivo: MotivoFalha): void {
    if (this.estadoAtual.fase !== 'em_sessao') return;
    this.opcoes.enviar({ tipo: 'encerrar', motivo });
    this.fecharPar(avisoPeloCanal(motivo));
    this.mudar({ fase: 'livre', aviso: TEXTO_FALHA_LOCAL[motivo] });
  }

  private atualizarSessao(mudancas: {
    conexao?: EstadoPar;
    latenciaMs?: number;
    liberada?: boolean;
    reconectandoAte?: number | null;
    monitores?: MonitoresSessao;
    qualidade?: EstadoQualidade;
  }): void {
    if (this.estadoAtual.fase === 'em_sessao') this.mudar({ ...this.estadoAtual, ...mudancas });
  }

  /** Fecha a conexão direta (com "aviso", manda antes o fim pelo canal). */
  private fecharPar(aviso?: { motivo?: MotivoFimPeloCanal }): void {
    clearTimeout(this.prazoSenha);
    clearTimeout(this.timerCanalPerdido);
    this.pararReconexao();
    this.conferindoSenha = false;
    this.jaConectou = false;
    this.monitorMostrado = null;
    this.qualidade?.parar();
    this.qualidade = null;
    this.ligadoNoServidor = false;
    this.canalArquivos = null;
    const par = this.par;
    if (!par) return;
    this.par = null; // antes de fechar, para ignorar os eventos que o fechamento dispara
    par.fechar(aviso);
    this.opcoes.aoMudarVideo?.(null);
    if (this.estadoAtual.fase === 'em_sessao' && this.estadoAtual.papel === 'anfitriao') {
      this.opcoes.aoLiberarInput?.();
    }
  }

  private mudar(estado: EstadoSessao): void {
    // A senha do visualizador só vive enquanto o pedido está em andamento.
    if (estado.fase === 'livre') this.senhaParaEnviar = null;
    this.estadoAtual = estado;
    this.opcoes.aoMudarEstado(estado);
    this.entregarCanalArquivos(); // a liberação (ou o fim) da sessão muda quem pode usar o canal
  }

  /** Entrega o canal de arquivos só com a sessão liberada (e avisa quando deixa de valer). */
  private entregarCanalArquivos(): void {
    const estado = this.estadoAtual;
    const canal = estado.fase === 'em_sessao' && estado.liberada ? this.canalArquivos : null;
    if (canal === this.canalArquivosEntregue) return;
    this.canalArquivosEntregue = canal;
    this.opcoes.aoMudarCanalArquivos?.(canal);
  }
}
