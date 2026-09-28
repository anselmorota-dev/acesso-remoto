// Cliente do servidor de sinalização: mantém a conexão WebSocket aberta,
// obtém o ID fixo deste computador e reconecta sozinho quando a conexão cai.
// Não mexe na interface: só informa mudanças de estado por callback.
//
// Registro (ID fixo): manda a chave pública da instalação, recebe um desafio,
// devolve a assinatura (feita pelo main, que guarda a chave privada) e só
// então recebe o ID.
//
// Conexão viva: se a rede cai "em silêncio" (Wi-Fi trocado, roteador
// reiniciado), o navegador pode levar muitos minutos para perceber. Por isso,
// online, o app manda um "ping" a cada poucos segundos; se o servidor ficar
// calado por tempo demais, a conexão é dada como morta e o app reconecta.
// O ping também conta como uso para o Render (o plano gratuito "dorme" sem
// mensagens chegando).
import {
  PROTOCOL_VERSION,
  decodificarMensagem,
  esquemaMensagemDoServidor,
  type IdCliente,
  type MensagemDoCliente,
  type MensagemDoServidor,
} from '@acesso-remoto/shared';

export type EstadoSinalizacao =
  | { fase: 'conectando' }
  | { fase: 'online'; id: IdCliente }
  | { fase: 'offline'; proximaTentativaMs: number }
  /** O servidor usa outro protocolo; não adianta reconectar até atualizar o app. */
  | { fase: 'incompativel'; mensagem: string }
  /**
   * Esta instalação conectou de novo em outro lugar (ex.: a pasta de dados foi
   * copiada para outro computador). Não reconecta, para não ficarem se derrubando.
   */
  | { fase: 'substituida' };

/** Mensagens do servidor que interessam a quem usa o cliente (o resto é tratado aqui). */
export type MensagemRecebida = Exclude<MensagemDoServidor, { tipo: 'registrado' | 'desafio' | 'pong' }>;

/** Identidade da instalação; no app, quem assina é o main (window.api.identidade). */
export interface IdentidadeCliente {
  chavePublica(): Promise<string>;
  assinarDesafio(desafio: string): Promise<string>;
}

export interface OpcoesSinalizacao {
  url: string;
  identidade: IdentidadeCliente;
  aoMudarEstado: (estado: EstadoSinalizacao) => void;
  /** Mensagens do servidor além do registro (pedidos, sessão, sinais, erros). */
  aoMensagem?: (mensagem: MensagemRecebida) => void;
  /**
   * Esperas entre tentativas de reconexão; a última se repete.
   * Crescem aos poucos para não sobrecarregar um servidor que está voltando.
   */
  esperasReconexaoMs?: readonly number[];
  /** De quanto em quanto tempo mandar o ping (online). */
  intervaloPingMs?: number;
  /** Servidor calado por mais que isso: a conexão é dada como morta. */
  prazoSilencioMs?: number;
  /** Prazo da resposta numa verificação pedida (verificarConexao). */
  prazoVerificacaoMs?: number;
  /** Versão anunciada ao servidor. Só muda nos testes. */
  versaoProtocolo?: number;
}

const ESPERAS_PADRAO = [1_000, 2_000, 5_000, 10_000];
const INTERVALO_PING_PADRAO_MS = 10_000;
const PRAZO_SILENCIO_PADRAO_MS = 25_000;
const PRAZO_VERIFICACAO_PADRAO_MS = 5_000;

export class ClienteSinalizacao {
  private readonly opcoes: OpcoesSinalizacao;
  private socket: WebSocket | null = null;
  private timerReconexao: ReturnType<typeof setTimeout> | undefined;
  private timerPing: ReturnType<typeof setInterval> | undefined;
  /** Quando chegou a última mensagem do servidor (qualquer uma): sinal de vida. */
  private ultimaMensagemEm = 0;
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
    clearInterval(this.timerPing);
    this.socket?.close();
    this.socket = null;
  }

  /** Envia ao servidor; devolve false se a conexão não estiver aberta. */
  enviar(mensagem: MensagemDoCliente): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(mensagem));
    return true;
  }

  /**
   * Confere agora se o servidor ainda responde (ex.: a conexão direta com o
   * parceiro caiu, sinal de que a rede mudou). Sem resposta no prazo curto,
   * reconecta já, sem esperar o ping periódico perceber.
   */
  verificarConexao(): void {
    const socket = this.socket;
    if (!socket || this.estadoAtual.fase !== 'online') return;
    const enviadoEm = Date.now();
    this.enviar({ tipo: 'ping' });
    setTimeout(() => {
      if (this.socket === socket && this.ultimaMensagemEm < enviadoEm) {
        this.derrubar(socket, 'o servidor não respondeu à verificação');
      }
    }, this.opcoes.prazoVerificacaoMs ?? PRAZO_VERIFICACAO_PADRAO_MS);
  }

  private mudarEstado(estado: EstadoSinalizacao): void {
    this.estadoAtual = estado;
    this.opcoes.aoMudarEstado(estado);
  }

  private conectar(): void {
    this.mudarEstado({ fase: 'conectando' });
    const socket = new WebSocket(this.opcoes.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.opcoes.identidade
        .chavePublica()
        .then((chavePublica) => {
          if (this.socket !== socket) return;
          this.enviar({ tipo: 'registrar', versao: this.opcoes.versaoProtocolo ?? PROTOCOL_VERSION, chavePublica });
        })
        .catch((erro: unknown) => this.falhaNaIdentidade(socket, erro));
    });

    socket.addEventListener('message', (evento) => {
      if (this.socket !== socket) return; // conexão antiga, já substituída
      this.ultimaMensagemEm = Date.now();
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
        case 'desafio':
          this.opcoes.identidade
            .assinarDesafio(mensagem.desafio)
            .then((assinatura) => {
              if (this.socket === socket) this.enviar({ tipo: 'provar', assinatura });
            })
            .catch((erro: unknown) => this.falhaNaIdentidade(socket, erro));
          break;
        case 'registrado':
          this.tentativasSeguidas = 0;
          this.iniciarPing(socket);
          this.mudarEstado({ fase: 'online', id: mensagem.id });
          break;
        case 'pong':
          break; // só serve de sinal de vida (já anotado acima)
        case 'erro':
          if (mensagem.codigo === 'versao_incompativel') {
            this.mudarEstado({ fase: 'incompativel', mensagem: mensagem.mensagem });
          } else if (mensagem.codigo === 'substituida') {
            this.mudarEstado({ fase: 'substituida' });
          } else {
            console.warn(`[sinalizacao] erro do servidor: ${mensagem.codigo} — ${mensagem.mensagem}`);
            this.opcoes.aoMensagem?.(mensagem);
          }
          break;
        default:
          this.opcoes.aoMensagem?.(mensagem);
      }
    });

    // Falhas de conexão também disparam "close", então a reconexão fica só aqui
    // (e em derrubar, para a conexão que morreu sem fechar).
    socket.addEventListener('close', () => this.aoPerderConexao(socket));
  }

  /** Online: ping periódico, e reconexão se o servidor ficar calado demais. */
  private iniciarPing(socket: WebSocket): void {
    clearInterval(this.timerPing);
    this.ultimaMensagemEm = Date.now();
    const prazoSilencio = this.opcoes.prazoSilencioMs ?? PRAZO_SILENCIO_PADRAO_MS;
    this.timerPing = setInterval(() => {
      if (this.socket !== socket) return;
      if (Date.now() - this.ultimaMensagemEm > prazoSilencio) {
        this.derrubar(socket, 'o servidor ficou sem responder');
        return;
      }
      this.enviar({ tipo: 'ping' });
    }, this.opcoes.intervaloPingMs ?? INTERVALO_PING_PADRAO_MS);
  }

  /**
   * Dá a conexão como morta e reconecta já. Não espera o "close": numa rede
   * que caiu em silêncio, o navegador pode demorar muito para dispará-lo.
   */
  private derrubar(socket: WebSocket, motivo: string): void {
    console.warn(`[sinalizacao] conexão dada como morta: ${motivo}`);
    this.aoPerderConexao(socket);
    socket.close();
  }

  private aoPerderConexao(socket: WebSocket): void {
    if (this.socket !== socket) return; // conexão antiga, já substituída
    this.socket = null;
    clearInterval(this.timerPing);
    if (this.parado || this.estadoAtual.fase === 'incompativel' || this.estadoAtual.fase === 'substituida') return;

    const esperas = this.opcoes.esperasReconexaoMs ?? ESPERAS_PADRAO;
    const espera = esperas[Math.min(this.tentativasSeguidas, esperas.length - 1)] ?? 10_000;
    this.tentativasSeguidas++;
    this.mudarEstado({ fase: 'offline', proximaTentativaMs: espera });
    this.timerReconexao = setTimeout(() => this.conectar(), espera);
  }

  /** Sem identidade não há registro: fecha e deixa a reconexão tentar de novo. */
  private falhaNaIdentidade(socket: WebSocket, erro: unknown): void {
    console.error('[sinalizacao] falha na identidade da instalação:', erro);
    if (this.socket === socket) socket.close();
  }
}
