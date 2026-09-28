// Cliente do servidor de sinalização: mantém a conexão WebSocket aberta,
// obtém o ID deste computador e reconecta sozinho quando a conexão cai.
// Não mexe na interface: só informa mudanças de estado por callback.
import {
  PROTOCOL_VERSION,
  decodificarMensagem,
  esquemaMensagemDoServidor,
  type IdCliente,
  type MensagemDoCliente,
} from '@acesso-remoto/shared';

export type EstadoSinalizacao =
  | { fase: 'conectando' }
  | { fase: 'online'; id: IdCliente }
  | { fase: 'offline'; proximaTentativaMs: number }
  /** O servidor usa outro protocolo; não adianta reconectar até atualizar o app. */
  | { fase: 'incompativel'; mensagem: string };

export interface OpcoesSinalizacao {
  url: string;
  aoMudarEstado: (estado: EstadoSinalizacao) => void;
  /**
   * Esperas entre tentativas de reconexão; a última se repete.
   * Crescem aos poucos para não sobrecarregar um servidor que está voltando.
   */
  esperasReconexaoMs?: readonly number[];
  /** Versão anunciada ao servidor. Só muda nos testes. */
  versaoProtocolo?: number;
}

const ESPERAS_PADRAO = [1_000, 2_000, 5_000, 10_000];

export class ClienteSinalizacao {
  private readonly opcoes: OpcoesSinalizacao;
  private socket: WebSocket | null = null;
  private timerReconexao: ReturnType<typeof setTimeout> | undefined;
  private tentativasSeguidas = 0;
  private parado = true;
  private estadoAtual: EstadoSinalizacao = { fase: 'conectando' };

  constructor(opcoes: OpcoesSinalizacao) {
    this.opcoes = opcoes;
  }

  get estado(): EstadoSinalizacao {
    return this.estadoAtual;
  }

  iniciar(): void {
    if (!this.parado) return;
    this.parado = false;
    this.conectar();
  }

  /** Fecha a conexão e cancela reconexões pendentes. */
  parar(): void {
    this.parado = true;
    clearTimeout(this.timerReconexao);
    this.socket?.close();
    this.socket = null;
  }

  private mudarEstado(estado: EstadoSinalizacao): void {
    this.estadoAtual = estado;
    this.opcoes.aoMudarEstado(estado);
  }

  private enviar(mensagem: MensagemDoCliente): void {
    this.socket?.send(JSON.stringify(mensagem));
  }

  private conectar(): void {
    this.mudarEstado({ fase: 'conectando' });
    const socket = new WebSocket(this.opcoes.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.enviar({ tipo: 'registrar', versao: this.opcoes.versaoProtocolo ?? PROTOCOL_VERSION });
    });

    socket.addEventListener('message', (evento) => {
      // Tudo que vem da rede é validado antes de ser usado.
      const mensagem =
        typeof evento.data === 'string'
          ? decodificarMensagem(esquemaMensagemDoServidor, evento.data)
          : null;
      if (!mensagem) {
        console.warn('[sinalizacao] mensagem inválida do servidor, ignorada');
        return;
      }

      switch (mensagem.tipo) {
        case 'registrado':
          this.tentativasSeguidas = 0;
          this.mudarEstado({ fase: 'online', id: mensagem.id });
          break;
        case 'erro':
          if (mensagem.codigo === 'versao_incompativel') {
            this.mudarEstado({ fase: 'incompativel', mensagem: mensagem.mensagem });
          } else {
            console.warn(`[sinalizacao] erro do servidor: ${mensagem.codigo} — ${mensagem.mensagem}`);
          }
          break;
      }
    });

    // Falhas de conexão também disparam "close", então a reconexão fica só aqui.
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return; // conexão antiga, já substituída
      this.socket = null;
      if (this.parado || this.estadoAtual.fase === 'incompativel') return;

      const esperas = this.opcoes.esperasReconexaoMs ?? ESPERAS_PADRAO;
      const espera = esperas[Math.min(this.tentativasSeguidas, esperas.length - 1)] ?? 10_000;
      this.tentativasSeguidas++;
      this.mudarEstado({ fase: 'offline', proximaTentativaMs: espera });
      this.timerReconexao = setTimeout(() => this.conectar(), espera);
    });
  }
}
