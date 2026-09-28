// Controla o ciclo de uma sessão: pedido → aceite → conexão WebRTC → fim.
// Recebe as mensagens do servidor, decide o próximo estado e cria/fecha a
// conexão com o outro computador. Não mexe na interface nem no WebSocket
// diretamente: recebe funções para isso (o que permite testá-lo no Node).
import type {
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
  /** Visualizador aguardando o anfitrião aceitar. */
  | { fase: 'pedindo'; destino: IdCliente }
  /** Anfitrião precisa decidir se aceita. */
  | { fase: 'pedido_recebido'; origem: IdCliente; respondendo: boolean }
  | {
      fase: 'em_sessao';
      parceiro: IdCliente;
      papel: Papel;
      conexao: EstadoPar;
      latenciaMs: number | null;
    };

export interface OpcoesControlador {
  /** Envia ao servidor; false se a conexão com ele não estiver aberta. */
  enviar: (mensagem: MensagemDoCliente) => boolean;
  aoMudarEstado: (estado: EstadoSessao) => void;
  criarPar: (opcoes: OpcoesPar) => Par;
  /** Visualizador: vídeo da tela remota chegou (ou null quando a sessão acaba). */
  aoMudarVideo?: (video: MediaStream | null) => void;
}

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
};

/** Texto mostrado no lado onde a falha aconteceu. */
const TEXTO_FALHA_LOCAL: Record<MotivoFalha, string> = {
  captura_indisponivel: 'Não foi possível capturar a tela deste computador.',
  falha_conexao: 'Não foi possível estabelecer a conexão direta.',
};

export class ControladorSessao {
  private readonly opcoes: OpcoesControlador;
  private estadoAtual: EstadoSessao = { fase: 'livre' };
  private par: Par | null = null;

  constructor(opcoes: OpcoesControlador) {
    this.opcoes = opcoes;
  }

  get estado(): EstadoSessao {
    return this.estadoAtual;
  }

  // -------------------------------------------------------------------------
  // Ações do usuário
  // -------------------------------------------------------------------------

  /** Visualizador pede acesso a outro computador. */
  conectar(destino: IdCliente): void {
    if (this.estadoAtual.fase !== 'livre') return;
    if (!this.opcoes.enviar({ tipo: 'conectar', destino })) {
      this.mudar({ fase: 'livre', aviso: 'Sem conexão com o servidor.' });
      return;
    }
    this.mudar({ fase: 'pedindo', destino });
  }

  /** Anfitrião aceita ou recusa o pedido pendente. */
  responderPedido(aceito: boolean): void {
    const estado = this.estadoAtual;
    if (estado.fase !== 'pedido_recebido' || estado.respondendo) return;
    this.opcoes.enviar({ tipo: 'responder_pedido', origem: estado.origem, aceito });
    // Se aceitou, espera o servidor confirmar com "sessao_iniciada".
    this.mudar(aceito ? { ...estado, respondendo: true } : { fase: 'livre' });
  }

  /** Cancela o pedido ou encerra a sessão (qualquer um dos lados). */
  encerrar(): void {
    if (this.estadoAtual.fase === 'livre') return;
    if (this.estadoAtual.fase === 'pedido_recebido') {
      this.responderPedido(false);
      return;
    }
    const estavaEmSessao = this.estadoAtual.fase === 'em_sessao';
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

  receber(mensagem: Exclude<MensagemDoServidor, { tipo: 'registrado' }>): void {
    const estado = this.estadoAtual;

    switch (mensagem.tipo) {
      case 'pedido_conexao':
        if (estado.fase === 'livre') {
          this.mudar({ fase: 'pedido_recebido', origem: mensagem.origem, respondendo: false });
        }
        return;

      case 'pedido_cancelado':
        if (estado.fase === 'pedido_recebido' && estado.origem === mensagem.origem) {
          this.mudar({ fase: 'livre', aviso: 'O pedido de acesso foi cancelado.' });
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
        if (esperado) this.iniciarSessao(mensagem.parceiro, mensagem.papel);
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

  private iniciarSessao(parceiro: IdCliente, papel: Papel): void {
    this.mudar({ fase: 'em_sessao', parceiro, papel, conexao: 'conectando', latenciaMs: null });

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
    });
    this.par = par;
    par.iniciar().catch((erro: unknown) => this.falhaNaConexao(erro));
  }

  private falhaNaConexao(erro: unknown): void {
    console.error('[sessao] falha na sessão:', erro);
    if (this.estadoAtual.fase !== 'em_sessao') return;
    const motivo: MotivoFalha = erro instanceof ErroCaptura ? 'captura_indisponivel' : 'falha_conexao';
    this.opcoes.enviar({ tipo: 'encerrar', motivo });
    this.fecharPar();
    this.mudar({ fase: 'livre', aviso: TEXTO_FALHA_LOCAL[motivo] });
  }

  private atualizarSessao(mudancas: { conexao?: EstadoPar; latenciaMs?: number }): void {
    if (this.estadoAtual.fase === 'em_sessao') this.mudar({ ...this.estadoAtual, ...mudancas });
  }

  private fecharPar(): void {
    const par = this.par;
    if (!par) return;
    this.par = null; // antes de fechar, para ignorar os eventos que o fechamento dispara
    par.fechar();
    this.opcoes.aoMudarVideo?.(null);
  }

  private mudar(estado: EstadoSessao): void {
    this.estadoAtual = estado;
    this.opcoes.aoMudarEstado(estado);
  }
}
