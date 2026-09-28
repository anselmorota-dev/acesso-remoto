// Conexão WebRTC direta com o outro computador.
//
// Negociação (os sinais passam pelo servidor):
//   1. o anfitrião cria a oferta (SDP: o que ele quer enviar/receber) e envia;
//   2. o visualizador responde com a resposta (SDP);
//   3. os dois vão descobrindo caminhos de rede (candidatos ICE) e enviando
//      um ao outro assim que surgem ("trickle ICE");
//   4. o navegador testa os caminhos e escolhe um: a conexão fica "connected".
// Depois disso os dados vão direto de um computador ao outro.
import {
  TAMANHO_MAXIMO_MENSAGEM_CANAL,
  decodificarMensagem,
  esquemaMensagemCanal,
  type MensagemCanal,
  type Papel,
  type Sinal,
} from '@acesso-remoto/shared';

export type EstadoPar = 'conectando' | 'conectado' | 'falhou' | 'fechado';

export interface OpcoesPar {
  papel: Papel;
  enviarSinal: (sinal: Sinal) => void;
  aoMudarEstado: (estado: EstadoPar) => void;
  /** Tempo de ida e volta medido pelo DataChannel. */
  aoMedirLatencia?: (ms: number) => void;
}

/** O que o controlador de sessão precisa de uma conexão (permite trocar por um falso nos testes). */
export interface Par {
  iniciar(): Promise<void>;
  receberSinal(sinal: Sinal): Promise<void>;
  fechar(): void;
}

// Sem servidores STUN/TURN por enquanto: na mesma máquina ou rede local os
// endereços locais bastam. Entre redes diferentes (etapa 2.5) será preciso STUN.
const CONFIGURACAO: RTCConfiguration = { iceServers: [] };

const INTERVALO_PING_MS = 2000;

export class ConexaoPar implements Par {
  private readonly opcoes: OpcoesPar;
  private readonly pc: RTCPeerConnection;
  private canal: RTCDataChannel | null = null;
  private timerPing: ReturnType<typeof setInterval> | undefined;
  /** Candidatos que chegaram antes da descrição remota; aplicados depois. */
  private candidatosPendentes: RTCIceCandidateInit[] = [];
  private estado: EstadoPar = 'conectando';

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

    // Quem cria a oferta cria o canal; o outro lado o recebe pronto.
    if (opcoes.papel === 'anfitriao') {
      this.prepararCanal(this.pc.createDataChannel('controle'));
    } else {
      this.pc.addEventListener('datachannel', (evento) => this.prepararCanal(evento.channel));
    }
  }

  /** O anfitrião começa a negociação; o visualizador só espera a oferta. */
  async iniciar(): Promise<void> {
    if (this.opcoes.papel !== 'anfitriao') return;
    await this.pc.setLocalDescription(await this.pc.createOffer());
    this.enviarDescricaoLocal();
  }

  async receberSinal(sinal: Sinal): Promise<void> {
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
        await this.pc.setRemoteDescription({ type: 'answer', sdp: sinal.sdp });
        await this.aplicarCandidatosPendentes();
        break;
      case 'ice':
        // Um candidato só pode ser aplicado depois da descrição remota.
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(sinal.candidato);
        else this.candidatosPendentes.push(sinal.candidato);
        break;
    }
  }

  fechar(): void {
    clearInterval(this.timerPing);
    this.canal?.close();
    this.pc.close();
    this.mudarEstado('fechado');
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
      await this.pc.addIceCandidate(candidato);
    }
  }

  private prepararCanal(canal: RTCDataChannel): void {
    this.canal = canal;
    canal.addEventListener('open', () => {
      // Os dois lados medem a latência com um ping periódico.
      const pingar = () => this.enviarNoCanal({ tipo: 'ping', t: performance.now() });
      pingar();
      this.timerPing = setInterval(pingar, INTERVALO_PING_MS);
    });
    canal.addEventListener('close', () => clearInterval(this.timerPing));
    canal.addEventListener('message', (evento) => this.aoMensagemCanal(evento.data));
  }

  private enviarNoCanal(mensagem: MensagemCanal): void {
    if (this.canal?.readyState === 'open') this.canal.send(JSON.stringify(mensagem));
  }

  private aoMensagemCanal(dados: unknown): void {
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
    }
  }
}
