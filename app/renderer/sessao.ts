// Controla o ciclo de uma sessão: pedido → aceite (ou senha) → conexão WebRTC → fim.
// Recebe as mensagens do servidor, decide o próximo estado e cria/fecha a
// conexão com o outro computador. Não mexe na interface nem no WebSocket
// diretamente: recebe funções para isso (o que permite testá-lo no Node).
//
// Acesso com senha (não supervisionado): o anfitrião com senha definida aceita
// sozinho, mas a sessão começa "travada" (sem tela e sem controle). O
// visualizador manda a senha pela conexão direta; só se ela conferir o
// anfitrião libera a tela e o controle. A senha nunca passa pelo servidor.
import type {
  EventoInput,
  IdCliente,
  MensagemDoCliente,
  MensagemDoServidor,
  MotivoEncerramento,
  MotivoFalha,
  MotivoRecusa,
  Papel,
} from '@acesso-remoto/shared';
import { ErroCaptura } from './captura';
import type { EstadoPar, OpcoesPar, Par } from './par';

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
    };

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
  /** Anfitrião: há senha de acesso não supervisionado definida? */
  senhaDefinida?: () => Promise<boolean>;
  /** Anfitrião: confere a senha recebida (com limite de tentativas). */
  tentarSenha?: (senha: string) => Promise<ResultadoTentativaSenha>;
  /** Anfitrião: tempo máximo para a senha chegar depois da sessão começar. */
  prazoSenhaMs?: number;
}

const PRAZO_SENHA_PADRAO_MS = 15_000;

const TEXTO_RECUSA: Record<MotivoRecusa, string> = {
  recusado: 'O outro computador recusou o acesso.',
  offline: 'Nenhum computador online com esse ID.',
  ocupado: 'O outro computador já está em uma sessão.',
  sem_resposta: 'O outro computador não respondeu a tempo.',
};

const TEXTO_ENCERRAMENTO: Record<MotivoEncerramento, string> = {
  encerrada_pelo_parceiro: 'A sessão foi encerrada pelo outro computador.',
  parceiro_desconectou: 'O outro computador se desconectou.',
  captura_indisponivel: 'O outro computador não conseguiu capturar a tela.',
  falha_conexao: 'Não foi possível estabelecer a conexão direta.',
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

export class ControladorSessao {
  private readonly opcoes: OpcoesControlador;
  private estadoAtual: EstadoSessao = { fase: 'livre' };
  private par: Par | null = null;
  /** Visualizador: senha a mandar quando a sessão por senha começar (só em memória). */
  private senhaParaEnviar: string | null = null;
  /** Anfitrião: prazo para a senha chegar; e se já há uma conferência em andamento. */
  private prazoSenha: ReturnType<typeof setTimeout> | undefined;
  private conferindoSenha = false;

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

  /** Visualizador: envia um evento de mouse/teclado ao anfitrião (só com a sessão liberada). */
  enviarInput(evento: EventoInput): void {
    const estado = this.estadoAtual;
    if (estado.fase === 'em_sessao' && estado.papel === 'visualizador' && estado.liberada) {
      this.par?.enviarInput(evento);
    }
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
    this.opcoes.enviar({ tipo: 'encerrar' });
    this.fecharPar();
    this.mudar({ fase: 'livre', aviso: estavaEmSessao ? 'Sessão encerrada.' : undefined });
  }

  /** A conexão com o servidor caiu: o servidor já desfez pedidos e sessões. */
  servidorPerdido(): void {
    if (this.estadoAtual.fase === 'livre') return;
    this.fecharPar();
    this.mudar({ fase: 'livre', aviso: 'A conexão com o servidor caiu; a sessão foi encerrada.' });
  }

  // -------------------------------------------------------------------------
  // Mensagens do servidor
  // -------------------------------------------------------------------------

  receber(mensagem: Exclude<MensagemDoServidor, { tipo: 'registrado' | 'desafio' }>): void {
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
          this.par.receberSinal(mensagem.sinal).catch((erro: unknown) => this.falhaNaConexao(erro));
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
    this.mudar({
      fase: 'em_sessao',
      parceiro,
      papel,
      conexao: 'conectando',
      latenciaMs: null,
      porSenha,
      liberada: !porSenha,
    });

    const par = this.opcoes.criarPar({
      papel,
      enviarSinal: (sinal) => this.opcoes.enviar({ tipo: 'sinal', sinal }),
      aoMudarEstado: (conexao) => {
        if (this.par !== par) return;
        if (conexao === 'falhou') {
          this.falhaNaConexao(new Error('ICE falhou'));
          return;
        }
        this.atualizarSessao({ conexao });
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
      aoReceberSenha: (senhaRecebida) => {
        if (this.par === par) void this.conferirSenha(par, senhaRecebida);
      },
      aoAutenticado: () => {
        const estado = this.estadoAtual;
        if (this.par === par && estado.fase === 'em_sessao' && estado.papel === 'visualizador' && estado.porSenha) {
          this.atualizarSessao({ liberada: true });
        }
      },
    });
    this.par = par;
    par.iniciar().catch((erro: unknown) => this.falhaNaConexao(erro));

    if (papel === 'anfitriao' && !porSenha) {
      // Aceite comum: a tela começa a ir já.
      par.liberarTela().catch((erro: unknown) => this.falhaNaConexao(erro));
    } else if (papel === 'anfitriao') {
      // Por senha: se ela não chegar a tempo, a sessão acaba.
      this.prazoSenha = setTimeout(
        () => this.encerrarPorFalha('senha_incorreta'),
        this.opcoes.prazoSenhaMs ?? PRAZO_SENHA_PADRAO_MS,
      );
    } else if (porSenha) {
      // Visualizador: manda a senha (o par espera o canal direto abrir).
      par.enviarSenha(senha ?? '');
    }
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
      par.liberarTela().catch((erro: unknown) => this.falhaNaConexao(erro));
    } else {
      this.encerrarPorFalha(resultado === 'bloqueada' ? 'senha_bloqueada' : 'senha_incorreta');
    }
  }

  private falhaNaConexao(erro: unknown): void {
    console.error('[sessao] falha na sessão:', erro);
    this.encerrarPorFalha(erro instanceof ErroCaptura ? 'captura_indisponivel' : 'falha_conexao');
  }

  /** Encerra a sessão por uma falha deste lado, avisando o outro do motivo. */
  private encerrarPorFalha(motivo: MotivoFalha): void {
    if (this.estadoAtual.fase !== 'em_sessao') return;
    this.opcoes.enviar({ tipo: 'encerrar', motivo });
    this.fecharPar();
    this.mudar({ fase: 'livre', aviso: TEXTO_FALHA_LOCAL[motivo] });
  }

  private atualizarSessao(mudancas: { conexao?: EstadoPar; latenciaMs?: number; liberada?: boolean }): void {
    if (this.estadoAtual.fase === 'em_sessao') this.mudar({ ...this.estadoAtual, ...mudancas });
  }

  private fecharPar(): void {
    clearTimeout(this.prazoSenha);
    this.conferindoSenha = false;
    const par = this.par;
    if (!par) return;
    this.par = null; // antes de fechar, para ignorar os eventos que o fechamento dispara
    par.fechar();
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
  }
}
