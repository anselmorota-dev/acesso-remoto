// Executa no anfitrião os eventos de input que chegam do visualizador.
//
// Recebe eventos já validados (esquema Zod) e cuida do resto:
//   - converte as coordenadas normalizadas (0 a 1) em pixels do monitor;
//   - limita a taxa de eventos, para um parceiro com defeito (ou mal-
//     intencionado) não inundar o sistema;
//   - lembra quais botões estão apertados, para soltá-los no fim da sessão
//     (senão um botão "preso" continuaria arrastando no anfitrião).
// Quem mexe de fato no mouse é o Robo (robotjs no app, um falso nos testes).
import type { BotaoMouse, EventoInput } from '@acesso-remoto/shared';

export interface Robo {
  /** Tamanho do monitor principal, no mesmo sistema de coordenadas de moverPara. */
  tamanhoTela(): { largura: number; altura: number };
  moverPara(x: number, y: number): void;
  botao(botao: BotaoMouse, pressionado: boolean): void;
  /** Rola na unidade do sistema (ver rolagemParaSistema). */
  rolar(x: number, y: number): void;
}

export interface OpcoesExecutor {
  plataforma: NodeJS.Platform;
  /** Relógio em ms (injetável nos testes). */
  agora?: () => number;
}

/**
 * Quantos eventos por segundo o anfitrião aceita. O visualizador manda no
 * máximo um "mover" por quadro (~60/s) mais cliques e rolagens, então
 * sobra folga; acima disso é abuso ou defeito e o excesso é descartado.
 */
export const LIMITE_EVENTOS_POR_SEGUNDO = 200;

export class ExecutorInput {
  private readonly robo: Robo;
  private readonly plataforma: NodeJS.Platform;
  private readonly agora: () => number;
  private readonly pressionados = new Set<BotaoMouse>();
  // Limite de taxa por "balde de fichas": cada evento gasta uma ficha e as
  // fichas voltam aos poucos (LIMITE por segundo), até encher o balde.
  private fichas = LIMITE_EVENTOS_POR_SEGUNDO;
  private ultimaRecarga: number;

  constructor(robo: Robo, opcoes: OpcoesExecutor) {
    this.robo = robo;
    this.plataforma = opcoes.plataforma;
    this.agora = opcoes.agora ?? Date.now;
    this.ultimaRecarga = this.agora();
  }

  /** Executa o evento; false se foi descartado pelo limite de taxa. */
  executar(evento: EventoInput): boolean {
    // Soltar um botão apertado sempre passa: descartá-lo deixaria o botão preso.
    const soltando = evento.tipo === 'mouse_botao' && !evento.pressionado;
    if (!soltando && !this.gastarFicha()) return false;

    switch (evento.tipo) {
      case 'mouse_mover':
        this.mover(evento.x, evento.y);
        break;
      case 'mouse_botao':
        if (evento.pressionado === this.pressionados.has(evento.botao)) break; // já está assim
        this.mover(evento.x, evento.y);
        this.robo.botao(evento.botao, evento.pressionado);
        if (evento.pressionado) this.pressionados.add(evento.botao);
        else this.pressionados.delete(evento.botao);
        break;
      case 'mouse_rolar': {
        const { x, y } = rolagemParaSistema(evento.dx, evento.dy, this.plataforma);
        if (x !== 0 || y !== 0) this.robo.rolar(x, y);
        break;
      }
    }
    return true;
  }

  /** Solta todos os botões apertados (fim da sessão). */
  liberar(): void {
    for (const botao of this.pressionados) this.robo.botao(botao, false);
    this.pressionados.clear();
  }

  private mover(x: number, y: number): void {
    const { largura, altura } = this.robo.tamanhoTela();
    this.robo.moverPara(Math.round(x * (largura - 1)), Math.round(y * (altura - 1)));
  }

  private gastarFicha(): boolean {
    const agora = this.agora();
    const recarga = ((agora - this.ultimaRecarga) / 1000) * LIMITE_EVENTOS_POR_SEGUNDO;
    this.fichas = Math.min(LIMITE_EVENTOS_POR_SEGUNDO, this.fichas + recarga);
    this.ultimaRecarga = agora;
    if (this.fichas < 1) return false;
    this.fichas -= 1;
    return true;
  }
}

/**
 * Converte a rolagem do navegador (pixels; dy > 0 = descer, dx > 0 = direita)
 * para o que o robotjs espera em cada sistema:
 *   - Windows: unidades da roda (120 = um "clique"; o Chromium conta um
 *     clique como 100 px). Positivo = para cima; no eixo x o robotjs inverte
 *     o sinal por conta própria, então positivo = para a esquerda.
 *   - macOS: pixels; positivo = para cima/esquerda. (Ainda não testado.)
 *   - Linux (X11): número de "cliques"; positivo = para cima/esquerda.
 */
export function rolagemParaSistema(dx: number, dy: number, plataforma: NodeJS.Platform): { x: number; y: number } {
  let x: number;
  let y: number;
  if (plataforma === 'win32') {
    x = Math.round(-dx * 1.2);
    y = Math.round(-dy * 1.2);
  } else if (plataforma === 'darwin') {
    x = -dx;
    y = -dy;
  } else {
    // Qualquer rolagem, mesmo pequena (touchpad), vale pelo menos um clique.
    const cliques = (d: number) => (d === 0 ? 0 : Math.sign(-d) * Math.max(1, Math.round(Math.abs(d) / 100)));
    x = cliques(dx);
    y = cliques(dy);
  }
  // Evita -0 (Object.is(-0, 0) é false e confunde comparações).
  return { x: x || 0, y: y || 0 };
}
