// Visualizador: traduz eventos de teclado locais em eventos do protocolo.
//
// Modelo híbrido:
//   - texto (letras, acentos, símbolos) vai como caractere pronto ("texto"),
//     já composto aqui (tecla morta ´ + a = á), sem depender do layout do
//     teclado do anfitrião;
//   - teclas especiais (Enter, setas, F1...) e atalhos (Ctrl+C) vão como
//     teclas ("tecla"), com descida e subida.
//
// Modificadores (Ctrl, Shift, Alt, Win) ficam pendentes aqui e só vão ao
// anfitrião quando fazem diferença: antes de uma tecla/atalho ou de um
// clique/rolagem (sincronizar). Assim Shift+a chega como "A" e o AltGr do
// ABNT2 (que o Chromium informa como Ctrl+Alt) não vira um atalho Ctrl+Alt
// no anfitrião. Um modificador tocado sozinho (ex.: Alt, para abrir o menu
// de um programa) vai como toque.
//
// Não mexe no DOM: recebe os campos do KeyboardEvent e devolve o que enviar.
import type { EventoInput, TeclaNomeada } from '@acesso-remoto/shared';

/** Os campos do KeyboardEvent que importam (altGraph = getModifierState('AltGraph')). */
export interface EventoTecla {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  altGraph: boolean;
}

/** Tecla física do modificador → nome no protocolo. */
const MODIFICADORES: Partial<Record<string, TeclaNomeada>> = {
  ControlLeft: 'control',
  ControlRight: 'right_control',
  ShiftLeft: 'shift',
  ShiftRight: 'right_shift',
  AltLeft: 'alt',
  AltRight: 'right_alt',
  MetaLeft: 'command',
  MetaRight: 'command',
};
const NOMES_MODIFICADORES = new Set(['Control', 'Shift', 'Alt', 'Meta']);

/** KeyboardEvent.key das teclas especiais → nome no protocolo. */
const ESPECIAIS: Partial<Record<string, TeclaNomeada>> = {
  Enter: 'enter',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Escape: 'escape',
  ' ': 'space',
  Insert: 'insert',
  ContextMenu: 'menu',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  F1: 'f1',
  F2: 'f2',
  F3: 'f3',
  F4: 'f4',
  F5: 'f5',
  F6: 'f6',
  F7: 'f7',
  F8: 'f8',
  F9: 'f9',
  F10: 'f10',
  F11: 'f11',
  F12: 'f12',
};

/**
 * Caractere ASCII de um atalho. Letras seguem o layout (Ctrl+Z no AZERTY é
 * o "z", mesmo na posição física do W); números seguem a tecla física
 * (Ctrl+Shift+1 informa "!"); em outros alfabetos (ex.: russo), a posição física.
 */
function caractereDeAtalho(key: string, code: string): string | null {
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  const digito = /^Digit(\d)$/.exec(code);
  if (digito) return digito[1] ?? null;
  const letra = /^Key([A-Z])$/.exec(code);
  if (letra) return letra[1]?.toLowerCase() ?? null;
  if (/^[\x21-\x7e]$/.test(key)) return key;
  return null;
}

const desce = (tecla: string): EventoInput => ({ tipo: 'tecla', tecla, pressionada: true });
const sobe = (tecla: string): EventoInput => ({ tipo: 'tecla', tecla, pressionada: false });

export class TradutorTeclado {
  /** Modificadores apertados aqui no visualizador (tecla física → nome). */
  private readonly locais = new Map<string, TeclaNomeada>();
  /** Modificadores já apertados no anfitrião. */
  private readonly noAnfitriao = new Set<TeclaNomeada>();
  /** Teclas (não modificadoras) apertadas no anfitrião, por tecla física, para soltar a mesma. */
  private readonly teclas = new Map<string, string>();
  /** Modificador apertado sem nada acontecer desde então: se soltar assim, foi um "toque". */
  private sozinho: string | null = null;

  desceu(evento: EventoTecla): EventoInput[] {
    const modificador = MODIFICADORES[evento.code];
    if (modificador && NOMES_MODIFICADORES.has(evento.key)) {
      if (!this.locais.has(evento.code)) this.sozinho = evento.code; // repetição não reinicia
      this.locais.set(evento.code, modificador);
      return [];
    }
    this.sozinho = null;

    const especial = ESPECIAIS[evento.key];
    if (especial) return this.apertar(evento.code, especial);

    // Sobram os caracteres; "Dead", "AltGraph", "CapsLock", "Process"... são ignorados.
    if ([...evento.key].length !== 1) return [];

    const atalho = (evento.ctrlKey || evento.altKey || evento.metaKey) && !evento.altGraph;
    if (!atalho) return [{ tipo: 'texto', texto: evento.key }];

    const caractere = caractereDeAtalho(evento.key, evento.code);
    return caractere ? this.apertar(evento.code, caractere) : [];
  }

  subiu(evento: EventoTecla): EventoInput[] {
    const modificador = this.locais.get(evento.code);
    if (modificador) {
      this.locais.delete(evento.code);
      const toque = this.sozinho === evento.code;
      this.sozinho = null;
      // Ex.: Shift esquerdo e direito são nomes diferentes, mas Win esquerdo e
      // direito são o mesmo "command": só solta quando nenhum dos dois está apertado.
      const aindaApertado = [...this.locais.values()].includes(modificador);
      if (this.noAnfitriao.has(modificador)) {
        if (aindaApertado) return [];
        this.noAnfitriao.delete(modificador);
        return [sobe(modificador)];
      }
      return toque ? [desce(modificador), sobe(modificador)] : [];
    }

    const tecla = this.teclas.get(evento.code);
    if (!tecla) return [];
    this.teclas.delete(evento.code);
    return [sobe(tecla)];
  }

  /** Leva ao anfitrião os modificadores apertados aqui (antes de tecla, clique ou rolagem). */
  sincronizar(): EventoInput[] {
    this.sozinho = null;
    const desejados = new Set(this.locais.values());
    const eventos: EventoInput[] = [];
    for (const modificador of [...this.noAnfitriao]) {
      if (desejados.has(modificador)) continue;
      this.noAnfitriao.delete(modificador);
      eventos.push(sobe(modificador));
    }
    for (const modificador of desejados) {
      if (this.noAnfitriao.has(modificador)) continue;
      this.noAnfitriao.add(modificador);
      eventos.push(desce(modificador));
    }
    return eventos;
  }

  /** Solta no anfitrião tudo que está apertado e esquece o estado (perda de foco, fim da sessão). */
  soltarTudo(): EventoInput[] {
    const eventos = [...new Set(this.teclas.values())].map(sobe);
    for (const modificador of this.noAnfitriao) eventos.push(sobe(modificador));
    this.teclas.clear();
    this.noAnfitriao.clear();
    this.locais.clear();
    this.sozinho = null;
    return eventos;
  }

  private apertar(code: string, tecla: string): EventoInput[] {
    this.teclas.set(code, tecla);
    return [...this.sincronizar(), desce(tecla)];
  }
}
