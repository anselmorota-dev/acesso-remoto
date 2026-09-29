// Monitores do anfitrião (parte pura, sem Electron, testada).
//
// Cada monitor tem duas medidas:
//   - "limites": posição e tamanho em DIP, como o Electron informa (serve
//     para ordenar da esquerda para a direita);
//   - "area": onde ele fica no sistema de coordenadas do robotjs, que é
//     onde o mouse de fato se move (ver areaDoRobo).
import { MONITORES_MAXIMO, type Monitor } from '@acesso-remoto/shared';

export interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface MonitorSistema {
  id: string;
  principal: boolean;
  /** Em DIP (pixels independentes de escala), como o Electron informa. */
  limites: Retangulo;
  /** Resolução real (pixels físicos), mostrada ao visualizador. */
  pixels: { largura: number; altura: number };
  /** Área no sistema de coordenadas do robotjs (moveMouse). */
  area: Retangulo;
}

/** O que o Electron informa de cada monitor (o mínimo usado aqui). */
export interface DisplayEletron {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

/**
 * Onde o monitor fica para o robotjs:
 *   - Windows: pixels físicos da área de trabalho virtual (o app é "per-monitor
 *     DPI aware", e o robotjs usa SendInput nesse sistema). A conversão de DIP
 *     para pixels físicos depende da escala de cada monitor, por isso vem do
 *     próprio Electron (screen.dipToScreenRect).
 *   - macOS: pontos (o mesmo sistema do Electron). Ainda não testado.
 *   - Linux (X11): pixels físicos; aproximado pela escala. Ainda não testado.
 */
export function areaDoRobo(
  display: DisplayEletron,
  plataforma: NodeJS.Platform,
  dipParaTela: (limites: DisplayEletron['bounds']) => DisplayEletron['bounds'],
): Retangulo {
  let r = display.bounds;
  if (plataforma === 'win32') {
    r = dipParaTela(display.bounds);
  } else if (plataforma !== 'darwin') {
    const s = display.scaleFactor;
    r = { x: r.x * s, y: r.y * s, width: r.width * s, height: r.height * s };
  }
  return { x: Math.round(r.x), y: Math.round(r.y), largura: Math.round(r.width), altura: Math.round(r.height) };
}

/** Monta a lista do sistema, ordenada da esquerda para a direita (e de cima para baixo). */
export function montarMonitores(
  displays: readonly DisplayEletron[],
  idPrincipal: number,
  area: (display: DisplayEletron) => Retangulo,
): MonitorSistema[] {
  return displays
    .map((d) => ({
      id: String(d.id),
      principal: d.id === idPrincipal,
      limites: { x: d.bounds.x, y: d.bounds.y, largura: d.bounds.width, altura: d.bounds.height },
      pixels: {
        largura: Math.max(1, Math.round(d.bounds.width * d.scaleFactor)),
        altura: Math.max(1, Math.round(d.bounds.height * d.scaleFactor)),
      },
      area: area(d),
    }))
    .sort((a, b) => a.limites.x - b.limites.x || a.limites.y - b.limites.y);
}

/** O monitor pedido; se não existir (ou nenhum foi pedido), o principal. */
export function escolherMonitor(monitores: readonly MonitorSistema[], pedido: string | null): MonitorSistema | null {
  return (
    monitores.find((m) => m.id === pedido) ?? monitores.find((m) => m.principal) ?? monitores[0] ?? null
  );
}

/** A lista como vai ao visualizador (só o que ele precisa ver; no máximo o que o protocolo aceita). */
export function paraVisualizador(monitores: readonly MonitorSistema[]): Monitor[] {
  return monitores
    .slice(0, MONITORES_MAXIMO)
    .map((m) => ({ id: m.id, largura: m.pixels.largura, altura: m.pixels.altura, principal: m.principal }));
}
