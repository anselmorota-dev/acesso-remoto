// Conexão WebRTC direta com o outro computador.
//
// Negociação (os sinais passam pelo servidor):
//   1. o anfitrião cria a oferta (SDP: o que ele quer enviar/receber) e envia;
//   2. o visualizador responde com a resposta (SDP);
//   3. os dois vão descobrindo caminhos de rede (candidatos ICE) e enviando
//      um ao outro assim que surgem ("trickle ICE");
//   4. o navegador testa os caminhos e escolhe um: a conexão fica "connected".
// Depois disso os dados vão direto de um computador ao outro.
//
// O anfitrião captura a tela e adiciona a trilha de vídeo antes de criar a
// oferta, então o vídeo já entra na primeira negociação.
//
// Sessões longas: se a rede de um dos lados muda, a conexão direta cai; o
// anfitrião então renegocia os caminhos de rede (ICE restart: nova oferta
// pelo servidor) sem desfazer a sessão, o canal nem a criptografia.
import {
  PEDACO_ARQUIVO,
  TAMANHO_MAXIMO_CONTROLE_ARQUIVOS,
  TAMANHO_MAXIMO_MENSAGEM_CANAL,
  decodificarMensagem,
  esquemaMensagemCanal,
  type EventoInput,
  type MensagemCanal,
  type MotivoFimPeloCanal,
  type Papel,
  type Sinal,
} from '@acesso-remoto/shared';
import { serializarAreaTransferencia } from './area-transferencia';
import type { CanalArquivos } from './arquivos';
import { capturarTela } from './captura';

export type EstadoPar = 'conectando' | 'conectado' | 'falhou' | 'fechado';

export interface OpcoesPar {
  papel: Papel;
  enviarSinal: (sinal: Sinal) => void;
  aoMudarEstado: (estado: EstadoPar) => void;
  /** Tempo de ida e volta medido pelo DataChannel. */
  aoMedirLatencia?: (ms: number) => void;
  /** Visualizador: chegou o vídeo da tela do anfitrião. */
  aoReceberVideo?: (video: MediaStream) => void;
  /** Anfitrião: chegou um evento de mouse/teclado do visualizador (já validado). */
  aoReceberInput?: (evento: EventoInput) => void;
  /** Anfitrião (sessão por senha): o visualizador mandou a senha pelo canal direto. */
  aoReceberSenha?: (senha: string) => void;
  /** Visualizador (sessão por senha): o anfitrião confirmou a senha. */
  aoAutenticado?: () => void;
  /** O outro lado avisou pelo canal que a sessão acabou (com o motivo, se foi falha). */
  aoEncerrarPeloParceiro?: (motivo: MotivoFimPeloCanal | undefined) => void;
  /** O canal fechou sem aviso (o outro lado fechou a conexão ou ela se perdeu de vez). */
  aoPerderCanal?: () => void;
  /** O outro lado copiou um texto (área de transferência compartilhada; já validado). */
  aoReceberAreaTransferencia?: (texto: string) => void;
  /** O canal de arquivos abriu (pronto para enviar e receber) ou fechou (null). */
  aoMudarCanalArquivos?: (canal: CanalArquivos | null) => void;
  /** Mensagem do canal de arquivos (tamanho já limitado; o conteúdo é validado por quem trata). */
  aoMensagemArquivos?: (dados: string | ArrayBuffer) => void;
}

/** O que o controlador de sessão precisa de uma conexão (permite trocar por um falso nos testes). */
export interface Par {
  iniciar(): Promise<void>;
  receberSinal(sinal: Sinal): Promise<void>;
  /** Anfitrião: começa a enviar a tela (logo no aceite, ou depois da senha). */
  liberarTela(): Promise<void>;
  /** Visualizador: envia um evento de input pelo DataChannel. */
  enviarInput(evento: EventoInput): void;
  /** Visualizador: envia a senha (sessão por senha). */
  enviarSenha(senha: string): void;
  /** Anfitrião: avisa que a senha conferiu. */
  confirmarAutenticacao(): void;
  /** Anfitrião: renegocia os caminhos de rede depois de a conexão direta cair. */
  reiniciarIce(): Promise<void>;
  /**
   * Envia o texto copiado neste computador. false: grande demais para uma
   * mensagem. Com o canal ainda fechado, guarda o último e envia ao abrir.
   */
  enviarAreaTransferencia(texto: string): boolean;
  /**
   * Fecha a conexão. Com "aviso", antes manda pelo canal que a sessão acabou
   * (o outro lado fica sabendo mesmo com o servidor fora do ar).
   */
  fechar(aviso?: { motivo?: MotivoFimPeloCanal }): void;
}

/** Tempo máximo esperando o aviso de fim sair pelo canal antes de fechar a conexão. */
const ESPERA_AVISO_FIM_MS = 1000;

// STUN: cada lado pergunta a um servidor público "qual é meu endereço visto
// de fora?" e envia esse endereço como candidato ICE. Isso permite a conexão
// direta entre redes diferentes quando os roteadores deixam (a maioria das
// redes domésticas). Dois provedores, um de reserva do outro. Redes que
// bloqueiam conexão direta (ex.: corporativas) vão precisar de TURN (etapa 5.3).
// O STUN só vê o endereço; vídeo e comandos nunca passam por ele.
const CONFIGURACAO: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
};

const INTERVALO_PING_MS = 2000;

export class ConexaoPar implements Par {
  private readonly opcoes: OpcoesPar;
  private readonly pc: RTCPeerConnection;
  private canal: RTCDataChannel | null = null;
  /** Canal só dos arquivos: um arquivo grande nunca atrasa mouse e teclado. */
  private canalArquivos: RTCDataChannel | null = null;
  private timerPing: ReturnType<typeof setInterval> | undefined;
  /** Candidatos que chegaram antes da descrição remota; aplicados depois. */
  private candidatosPendentes: RTCIceCandidateInit[] = [];
  private estado: EstadoPar = 'conectando';
  /** Anfitrião: a captura da tela, que precisa ser parada ao encerrar. */
  private telaLocal: MediaStream | null = null;
  /** Anfitrião: por onde o vídeo sai (a imagem entra em liberarTela). */
  private enviadorVideo: RTCRtpSender | null = null;
  /** Visualizador: senha esperando o canal abrir (acesso com senha). */
  private senhaPendente: string | null = null;
  /** Texto copiado esperando o canal abrir (só o último importa). */
  private areaPendente: string | null = null;

  constructor(opcoes: OpcoesPar) {
    this.opcoes = opcoes;
    this.pc = new RTCPeerConnection(CONFIGURACAO);

    this.pc.addEventListener('icecandidate', (evento) => {
      const c = evento.candidate;
      if (c) {
        opcoes.enviarSinal({
          tipo: 'ice',
          candidato: {
            candidate: c.candidate,
            sdpMid: c.sdpMid,
            sdpMLineIndex: c.sdpMLineIndex,
            usernameFragment: c.usernameFragment,
          },
        });
      }
    });

    this.pc.addEventListener('connectionstatechange', () => {
      switch (this.pc.connectionState) {
        case 'connected':
          this.mudarEstado('conectado');
          break;
        case 'failed':
          this.mudarEstado('falhou');
          break;
        case 'closed':
          this.mudarEstado('fechado');
          break;
        // "disconnected" costuma ser passageiro (a rede oscilou): volta a "conectando".
        default:
          this.mudarEstado('conectando');
      }
    });

    // Quem cria a oferta cria os canais; o outro lado os recebe prontos.
    if (opcoes.papel === 'anfitriao') {
      this.prepararCanal(this.pc.createDataChannel('controle'));
      this.prepararCanalArquivos(this.pc.createDataChannel('arquivos'));
    } else {
      this.pc.addEventListener('datachannel', (evento) => {
        // Só os canais que o app conhece; qualquer outro é fechado.
        if (evento.channel.label === 'controle' && !this.canal) this.prepararCanal(evento.channel);
        else if (evento.channel.label === 'arquivos' && !this.canalArquivos) this.prepararCanalArquivos(evento.channel);
        else evento.channel.close();
      });
      this.pc.addEventListener('track', (evento) => {
        opcoes.aoReceberVideo?.(evento.streams[0] ?? new MediaStream([evento.track]));
      });
    }
  }

  /**
   * O anfitrião começa a negociação; o visualizador só espera a oferta.
   * O vídeo entra na oferta "reservado" (transceptor sem imagem): a captura
   * só começa em liberarTela(), que no acesso com senha espera a senha conferir.
   */
  async iniciar(): Promise<void> {
    if (this.opcoes.papel !== 'anfitriao') return;
    this.enviadorVideo = this.pc.addTransceiver('video', { direction: 'sendonly' }).sender;
    await this.pc.setLocalDescription(await this.pc.createOffer());
    this.enviarDescricaoLocal();
  }

  /** Anfitrião: captura a tela e passa a enviá-la (sem renegociar a conexão). */
  async liberarTela(): Promise<void> {
    if (this.opcoes.papel !== 'anfitriao' || this.telaLocal) return;
    const tela = await capturarTela();
    // A sessão pode ter sido encerrada enquanto esperávamos a captura:
    // nesse caso a captura é parada na hora, nunca fica ativa à toa.
    if (this.estado === 'fechado' || !this.enviadorVideo) {
      pararCaptura(tela);
      return;
    }
    this.telaLocal = tela;
    await this.enviadorVideo.replaceTrack(tela.getVideoTracks()[0] ?? null);
  }

  /** Visualizador: manda a senha pelo canal direto (espera o canal abrir, se preciso). */
  enviarSenha(senha: string): void {
    if (this.canal?.readyState === 'open') this.enviarNoCanal({ tipo: 'senha', senha });
    else this.senhaPendente = senha;
  }

  /** Anfitrião: avisa o visualizador que a senha conferiu. */
  confirmarAutenticacao(): void {
    this.enviarNoCanal({ tipo: 'autenticado' });
  }

  /**
   * Anfitrião: nova oferta com credenciais ICE novas, para os dois lados
   * procurarem caminhos de rede outra vez (ex.: um deles trocou de Wi-Fi).
   * A conexão continua a mesma: canal, vídeo e criptografia não mudam.
   */
  async reiniciarIce(): Promise<void> {
    if (this.opcoes.papel !== 'anfitriao' || this.estado === 'fechado') return;
    // Uma renegociação por vez: se a anterior ainda espera resposta, aguarda.
    if (this.pc.signalingState !== 'stable') return;
    await this.pc.setLocalDescription(await this.pc.createOffer({ iceRestart: true }));
    this.enviarDescricaoLocal();
  }

  async receberSinal(sinal: Sinal): Promise<void> {
    if (this.estado === 'fechado') return;
    switch (sinal.tipo) {
      case 'oferta':
        if (this.opcoes.papel !== 'visualizador') return; // só o visualizador aceita ofertas
        await this.pc.setRemoteDescription({ type: 'offer', sdp: sinal.sdp });
        await this.aplicarCandidatosPendentes();
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.enviarDescricaoLocal();
        break;
      case 'resposta':
        if (this.opcoes.papel !== 'anfitriao') return;
        // Resposta atrasada (de uma oferta que já foi respondida) não vale mais.
        if (this.pc.signalingState !== 'have-local-offer') return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: sinal.sdp });
        await this.aplicarCandidatosPendentes();
        break;
      case 'ice':
        // Um candidato só pode ser aplicado depois da descrição remota.
        if (this.pc.remoteDescription) await this.aplicarCandidato(sinal.candidato);
        else this.candidatosPendentes.push(sinal.candidato);
        break;
    }
  }

  enviarInput(evento: EventoInput): void {
    this.enviarNoCanal(evento);
  }

  enviarAreaTransferencia(texto: string): boolean {
    // O limite de fato é o menor entre o nosso e o que a conexão negociou.
    const negociado = this.pc.sctp?.maxMessageSize || Infinity;
    const mensagem = serializarAreaTransferencia(texto, Math.min(TAMANHO_MAXIMO_MENSAGEM_CANAL, negociado));
    if (!mensagem) return false;
    if (this.canal?.readyState === 'open') this.canal.send(mensagem);
    else this.areaPendente = mensagem;
    return true;
  }

  fechar(aviso?: { motivo?: MotivoFimPeloCanal }): void {
    if (this.estado === 'fechado') return;
    clearInterval(this.timerPing);
    // Parar as trilhas é o que desliga a captura da tela de fato (na hora,
    // mesmo que a conexão ainda espere o aviso de fim sair).
    if (this.telaLocal) pararCaptura(this.telaLocal);
    this.telaLocal = null;
    this.mudarEstado('fechado');

    const canal = this.canal;
    if (aviso && canal?.readyState === 'open') {
      canal.send(JSON.stringify({ tipo: 'encerrar', motivo: aviso.motivo } satisfies MensagemCanal));
      // Fechar a conexão agora descartaria o aviso ainda na fila: espera ele sair.
      const limite = Date.now() + ESPERA_AVISO_FIM_MS;
      const fecharQuandoSair = () => {
        if (canal.bufferedAmount > 0 && Date.now() < limite) setTimeout(fecharQuandoSair, 20);
        else setTimeout(() => this.fecharConexao(), 250); // folga para a entrega pela rede
      };
      fecharQuandoSair();
    } else {
      this.fecharConexao();
    }
  }

  private fecharConexao(): void {
    this.canal?.close();
    this.canalArquivos?.close();
    this.pc.close();
  }

  private prepararCanalArquivos(canal: RTCDataChannel): void {
    this.canalArquivos = canal;
    canal.binaryType = 'arraybuffer'; // pedaços chegam como ArrayBuffer (não Blob)
    // Uma espera por vez: quem espera de novo (com o mesmo limite) reaproveita
    // a pendente, sem acumular ouvintes no canal.
    let espera: { limite: number; promessa: Promise<void> } | null = null;
    const adaptador: CanalArquivos = {
      enviar: (dados) => {
        if (canal.readyState !== 'open') return;
        if (typeof dados === 'string') canal.send(dados);
        else canal.send(dados);
      },
      fila: () => canal.bufferedAmount,
      esperarFila: (limite) => {
        if (canal.bufferedAmount <= limite || canal.readyState !== 'open') return Promise.resolve();
        if (espera?.limite === limite) return espera.promessa;
        canal.bufferedAmountLowThreshold = limite;
        const promessa = new Promise<void>((resolve) => {
          const pronto = () => {
            canal.removeEventListener('bufferedamountlow', pronto);
            canal.removeEventListener('close', pronto);
            if (espera?.promessa === promessa) espera = null;
            resolve();
          };
          canal.addEventListener('bufferedamountlow', pronto);
          canal.addEventListener('close', pronto);
        });
        espera = { limite, promessa };
        return promessa;
      },
    };
    canal.addEventListener('open', () => {
      if (this.estado !== 'fechado') this.opcoes.aoMudarCanalArquivos?.(adaptador);
    });
    canal.addEventListener('close', () => this.opcoes.aoMudarCanalArquivos?.(null));
    canal.addEventListener('message', (evento) => {
      if (this.estado === 'fechado') return;
      const dados: unknown = evento.data;
      // Regra de segurança: tamanho limitado antes de qualquer coisa (o
      // conteúdo é validado pelo gerenciador de arquivos).
      if (typeof dados === 'string' && dados.length <= TAMANHO_MAXIMO_CONTROLE_ARQUIVOS) {
        this.opcoes.aoMensagemArquivos?.(dados);
      } else if (dados instanceof ArrayBuffer && dados.byteLength <= PEDACO_ARQUIVO) {
        this.opcoes.aoMensagemArquivos?.(dados);
      } else {
        console.warn('[par] mensagem inválida no canal de arquivos, ignorada');
      }
    });
  }

  private mudarEstado(estado: EstadoPar): void {
    if (estado === this.estado || this.estado === 'fechado') return;
    this.estado = estado;
    this.opcoes.aoMudarEstado(estado);
  }

  private enviarDescricaoLocal(): void {
    const descricao = this.pc.localDescription;
    if (!descricao) return;
    const tipo = descricao.type === 'offer' ? 'oferta' : 'resposta';
    this.opcoes.enviarSinal({ tipo, sdp: descricao.sdp });
  }

  private async aplicarCandidatosPendentes(): Promise<void> {
    for (const candidato of this.candidatosPendentes.splice(0)) {
      await this.aplicarCandidato(candidato);
    }
  }

  /**
   * Um candidato ruim não derruba a sessão: depois de um ICE restart, podem
   * chegar atrasados candidatos da rodada anterior, que não valem mais.
   */
  private async aplicarCandidato(candidato: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidato);
    } catch (erro) {
      console.warn('[par] candidato ICE ignorado:', erro);
    }
  }

  private prepararCanal(canal: RTCDataChannel): void {
    this.canal = canal;
    canal.addEventListener('open', () => {
      // Os dois lados medem a latência com um ping periódico.
      const pingar = () => this.enviarNoCanal({ tipo: 'ping', t: performance.now() });
      pingar();
      this.timerPing = setInterval(pingar, INTERVALO_PING_MS);
      // Senha que o visualizador pediu para enviar antes de o canal abrir.
      if (this.senhaPendente !== null) {
        this.enviarNoCanal({ tipo: 'senha', senha: this.senhaPendente });
        this.senhaPendente = null;
      }
      // Texto copiado antes de o canal abrir (ex.: o visualizador, no início da sessão).
      if (this.areaPendente !== null) {
        canal.send(this.areaPendente);
        this.areaPendente = null;
      }
    });
    canal.addEventListener('close', () => {
      clearInterval(this.timerPing);
      // Fechado por nós (fechar) é o esperado; sem isso, o outro lado fechou
      // a conexão ou ela se perdeu de vez (não há como reabrir o canal).
      if (this.estado !== 'fechado') this.opcoes.aoPerderCanal?.();
    });
    canal.addEventListener('message', (evento) => this.aoMensagemCanal(evento.data));
  }

  private enviarNoCanal(mensagem: MensagemCanal): void {
    if (this.canal?.readyState === 'open') this.canal.send(JSON.stringify(mensagem));
  }

  private aoMensagemCanal(dados: unknown): void {
    if (this.estado === 'fechado') return; // a sessão acabou: nada mais vale
    // Regra de segurança: tudo que chega pelo canal é validado e limitado.
    if (typeof dados !== 'string' || dados.length > TAMANHO_MAXIMO_MENSAGEM_CANAL) return;
    const mensagem = decodificarMensagem(esquemaMensagemCanal, dados);
    if (!mensagem) {
      console.warn('[par] mensagem inválida no canal, ignorada');
      return;
    }
    switch (mensagem.tipo) {
      case 'ping':
        this.enviarNoCanal({ tipo: 'pong', t: mensagem.t });
        break;
      case 'pong':
        this.opcoes.aoMedirLatencia?.(Math.round(performance.now() - mensagem.t));
        break;
      case 'senha':
        // Só o anfitrião confere senha; o visualizador ignora.
        if (this.opcoes.papel === 'anfitriao') this.opcoes.aoReceberSenha?.(mensagem.senha);
        break;
      case 'autenticado':
        if (this.opcoes.papel === 'visualizador') this.opcoes.aoAutenticado?.();
        break;
      case 'encerrar':
        this.opcoes.aoEncerrarPeloParceiro?.(mensagem.motivo);
        break;
      case 'area_transferencia':
        this.opcoes.aoReceberAreaTransferencia?.(mensagem.texto);
        break;
      default:
        // Todo o resto é evento de input (mouse e teclado); o TypeScript
        // confere que "mensagem" aqui é um EventoInput.
        // O visualizador nunca é controlado: ignora input que chegue a ele.
        if (this.opcoes.papel === 'anfitriao') this.opcoes.aoReceberInput?.(mensagem);
        break;
    }
  }
}

function pararCaptura(tela: MediaStream): void {
  for (const trilha of tela.getTracks()) trilha.stop();
}
