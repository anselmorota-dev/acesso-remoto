// Qualidade do vídeo (etapa 5.2).
//
// Medições nesta máquina (i3-7020U, tela 1366x768, texto rolando; ver CLAUDE.md):
//   - AV1 dá texto nítido até ~250 kbps; o VP8 (padrão do WebRTC) borra já a
//     500 kbps. Por isso o anfitrião põe o AV1 em primeiro lugar na oferta.
//   - Em modo "tela" (contentHint "detail") o WebRTC mantém a resolução e,
//     com pouca banda, derruba o fps. Em modo "movimento" ("motion") ele
//     mantém o fps e reduz a resolução sozinho. Reduzir a resolução por
//     conta própria no modo tela não ajudou (o fps quase não subiu).
// Daí os perfis "nitidez" (tela) e "fluidez" (movimento). No modo automático
// o anfitrião fica em nitidez e só passa para fluidez enquanto a tela está em
// movimento E o fps enviado cai (a conexão não acompanha); parado o movimento,
// volta para nitidez.
//
// Como saber se a tela está em movimento: a captura do Windows entrega ~20
// quadros/s mesmo com a tela parada, então o anfitrião compara ele mesmo um
// quadro reduzido (64x36) da captura com o anterior, uma vez por segundo.
import type { ModoQualidade, PerfilVideo } from '@acesso-remoto/shared';

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

/** Ordem de preferência: AV1, depois VP8 (reserva), depois o resto na ordem original. */
export function ordenarCodecs<T extends { mimeType: string }>(codecs: readonly T[]): T[] {
  const prioridade = (c: T) => {
    const tipo = c.mimeType.toLowerCase();
    if (tipo === 'video/av1') return 0;
    if (tipo === 'video/vp8') return 1;
    return 2;
  };
  // sort é estável: dentro da mesma prioridade, mantém a ordem original.
  return [...codecs].sort((a, b) => prioridade(a) - prioridade(b));
}

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

export interface ConfiguracaoPerfil {
  contentHint: 'detail' | 'motion';
  degradationPreference: RTCDegradationPreference;
}

export const PERFIS: Record<PerfilVideo, ConfiguracaoPerfil> = {
  nitidez: { contentHint: 'detail', degradationPreference: 'maintain-resolution' },
  fluidez: { contentHint: 'motion', degradationPreference: 'maintain-framerate' },
};

// ---------------------------------------------------------------------------
// Movimento na tela
// ---------------------------------------------------------------------------

/** Tamanho do quadro reduzido comparado a cada amostra. */
export const LARGURA_AMOSTRA = 64;
export const ALTURA_AMOSTRA = 36;
/** Diferença de cinza (0–255) a partir da qual uma célula conta como mudada. */
export const LIMIAR_CELULA = 10;

/** Converte RGBA em tons de cinza (um byte por pixel). */
export function paraCinza(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const cinza = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < cinza.length; i++) {
    cinza[i] = (rgba[i * 4]! * 299 + rgba[i * 4 + 1]! * 587 + rgba[i * 4 + 2]! * 114) / 1000;
  }
  return cinza;
}

/** Fração (0–1) das células que mudaram mais que o limiar entre dois quadros reduzidos. */
export function fracaoDiferente(a: Uint8Array, b: Uint8Array, limiar = LIMIAR_CELULA): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let mudadas = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > limiar) mudadas++;
  return mudadas / a.length;
}

// ---------------------------------------------------------------------------
// Modo automático
// ---------------------------------------------------------------------------

/** Acima desta fração de células mudando por segundo, a tela está "em movimento". */
export const MOVIMENTO_MINIMO = 0.03;
/** Abaixo deste fps enviado (em nitidez, com movimento), a conexão não está acompanhando. */
export const FPS_MINIMO_NITIDEZ = 12;
/** Quantas amostras seguidas (1/s) confirmam uma troca de perfil (evita ficar trocando). */
export const AMOSTRAS_PARA_TROCAR = 3;

export interface AmostraAjuste {
  /** Fração da tela que mudou desde a amostra anterior (null: sem medida). */
  movimento: number | null;
  /** Quadros por segundo saindo do codificador. */
  fpsEnviado: number | null;
}

/** Decide o perfil do modo automático a partir das amostras (uma por segundo). */
export class AjusteAutomatico {
  private perfilAtual: PerfilVideo = 'nitidez';
  private seguidas = 0;

  get perfil(): PerfilVideo {
    return this.perfilAtual;
  }

  /** Recomeça em nitidez (ex.: o visualizador voltou para o automático). */
  reiniciar(): void {
    this.perfilAtual = 'nitidez';
    this.seguidas = 0;
  }

  /** Registra uma amostra e devolve o perfil a usar. */
  registrar(amostra: AmostraAjuste): PerfilVideo {
    const emMovimento = amostra.movimento !== null && amostra.movimento >= MOVIMENTO_MINIMO;
    const pedeTroca =
      this.perfilAtual === 'nitidez'
        ? emMovimento && amostra.fpsEnviado !== null && amostra.fpsEnviado < FPS_MINIMO_NITIDEZ
        : amostra.movimento !== null && !emMovimento;
    this.seguidas = pedeTroca ? this.seguidas + 1 : 0;
    if (this.seguidas >= AMOSTRAS_PARA_TROCAR) {
      this.perfilAtual = this.perfilAtual === 'nitidez' ? 'fluidez' : 'nitidez';
      this.seguidas = 0;
    }
    return this.perfilAtual;
  }
}

/** Perfil a usar para um modo (no automático, o que o ajuste decidiu). */
export function perfilDoModo(modo: ModoQualidade, automatico: PerfilVideo): PerfilVideo {
  return modo === 'automatico' ? automatico : modo;
}

// ---------------------------------------------------------------------------
// Indicador (o que o visualizador vê no painel)
// ---------------------------------------------------------------------------

/** Estatísticas do vídeo num instante (de getStats; enviado no anfitrião, recebido no visualizador). */
export interface AmostraVideo {
  /** Instante (ms) e bytes acumulados, para calcular a taxa. */
  t: number;
  bytes: number;
  largura: number | null;
  altura: number | null;
  fps: number | null;
  /** Ex.: "video/AV1". */
  codec: string | null;
}

export interface ResumoVideo {
  largura: number | null;
  altura: number | null;
  fps: number | null;
  kbps: number | null;
  /** Só o nome: "AV1". */
  codec: string | null;
}

export function resumirVideo(anterior: AmostraVideo | null, atual: AmostraVideo): ResumoVideo {
  const intervalo = anterior ? atual.t - anterior.t : 0;
  const kbps =
    anterior && intervalo > 0 && atual.bytes >= anterior.bytes
      ? Math.round(((atual.bytes - anterior.bytes) * 8) / intervalo)
      : null;
  return {
    largura: atual.largura,
    altura: atual.altura,
    fps: atual.fps === null ? null : Math.round(atual.fps),
    kbps,
    codec: atual.codec ? atual.codec.replace(/^video\//i, '') : null,
  };
}

/** "1366×768 · 28 fps · 450 kbps · AV1" (só o que se sabe). */
export function descreverVideo(resumo: ResumoVideo): string {
  const partes: string[] = [];
  if (resumo.largura && resumo.altura) partes.push(`${resumo.largura}×${resumo.altura}`);
  if (resumo.fps !== null) partes.push(`${resumo.fps} fps`);
  if (resumo.kbps !== null) partes.push(resumo.kbps >= 1000 ? `${(resumo.kbps / 1000).toFixed(1).replace('.', ',')} Mbps` : `${resumo.kbps} kbps`);
  if (resumo.codec) partes.push(resumo.codec);
  return partes.join(' · ');
}

// ---------------------------------------------------------------------------
// Controle da qualidade durante a sessão
// ---------------------------------------------------------------------------

/** O que o controle de qualidade precisa da conexão (o par real ou um falso nos testes). */
export interface ParQualidade {
  /** Anfitrião: aplica o perfil ao vídeo (e às próximas capturas). */
  definirPerfil(perfil: PerfilVideo): void;
  /** Estatísticas do vídeo (enviado no anfitrião, recebido no visualizador). */
  estatisticasVideo(): Promise<AmostraVideo | null>;
  /** Anfitrião: fração da tela que mudou desde a última medida (null: sem imagem). */
  medirMovimento(): Promise<number | null>;
  enviarQualidade(modo: ModoQualidade): void;
  enviarEstadoQualidade(modo: ModoQualidade, efetivo: PerfilVideo): void;
}

export interface EstadoQualidade {
  modo: ModoQualidade;
  efetivo: PerfilVideo;
  /** Visualizador: o que está chegando (null antes da primeira medida). */
  video: ResumoVideo | null;
}

export interface OpcoesControleQualidade {
  papel: 'anfitriao' | 'visualizador';
  par: ParQualidade;
  aoMudar: (estado: EstadoQualidade) => void;
  /** De quanto em quanto tempo mede (padrão 1 s); nos testes, amostrar() é chamado à mão. */
  intervaloMs?: number;
}

/**
 * Uma por sessão liberada. No anfitrião: aplica o modo pedido pelo
 * visualizador e, no automático, troca o perfil conforme as medidas. No
 * visualizador: pede o modo e mede o que chega (para o indicador).
 */
export class ControleQualidade {
  private readonly opcoes: OpcoesControleQualidade;
  private readonly ajuste = new AjusteAutomatico();
  private estadoAtual: EstadoQualidade = { modo: 'automatico', efetivo: 'nitidez', video: null };
  private anterior: AmostraVideo | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private amostrando = false;
  private parado = false;

  constructor(opcoes: OpcoesControleQualidade) {
    this.opcoes = opcoes;
  }

  get estado(): EstadoQualidade {
    return this.estadoAtual;
  }

  /** Começa a medir; o anfitrião anuncia o estado inicial. */
  iniciar(): void {
    if (this.opcoes.papel === 'anfitriao') this.aplicar();
    this.timer = setInterval(() => void this.amostrar(), this.opcoes.intervaloMs ?? 1000);
  }

  parar(): void {
    this.parado = true;
    clearInterval(this.timer);
  }

  /** Visualizador: escolheu um modo (o anfitrião confirma com o estado). */
  escolher(modo: ModoQualidade): void {
    if (this.opcoes.papel !== 'visualizador' || this.parado) return;
    this.opcoes.par.enviarQualidade(modo);
  }

  /** Anfitrião: o visualizador pediu um modo. */
  pedirModo(modo: ModoQualidade): void {
    if (this.opcoes.papel !== 'anfitriao' || this.parado || modo === this.estadoAtual.modo) return;
    if (modo === 'automatico') this.ajuste.reiniciar();
    this.estadoAtual = { ...this.estadoAtual, modo };
    this.aplicar();
  }

  /** Visualizador: o anfitrião informou o modo e o perfil em uso. */
  receberEstado(modo: ModoQualidade, efetivo: PerfilVideo): void {
    if (this.opcoes.papel !== 'visualizador' || this.parado) return;
    this.mudar({ ...this.estadoAtual, modo, efetivo });
  }

  /** Uma rodada de medidas (chamada pelo timer). */
  async amostrar(): Promise<void> {
    if (this.amostrando || this.parado) return;
    this.amostrando = true;
    try {
      const { par, papel } = this.opcoes;
      const video = await par.estatisticasVideo();
      if (this.parado) return;
      if (papel === 'visualizador') {
        if (video) {
          const resumo = resumirVideo(this.anterior, video);
          this.anterior = video;
          this.mudar({ ...this.estadoAtual, video: resumo });
        }
        return;
      }
      if (this.estadoAtual.modo !== 'automatico') return;
      const movimento = await par.medirMovimento();
      if (this.parado) return;
      const perfil = this.ajuste.registrar({ movimento, fpsEnviado: video?.fps ?? null });
      if (perfil !== this.estadoAtual.efetivo) this.aplicar();
    } catch (erro) {
      console.warn('[qualidade] falha ao medir:', erro);
    } finally {
      this.amostrando = false;
    }
  }

  /** Anfitrião: aplica o perfil do modo atual e avisa o visualizador. */
  private aplicar(): void {
    const efetivo = perfilDoModo(this.estadoAtual.modo, this.ajuste.perfil);
    this.opcoes.par.definirPerfil(efetivo);
    this.opcoes.par.enviarEstadoQualidade(this.estadoAtual.modo, efetivo);
    this.mudar({ ...this.estadoAtual, efetivo });
  }

  private mudar(estado: EstadoQualidade): void {
    this.estadoAtual = estado;
    this.opcoes.aoMudar(estado);
  }
}
