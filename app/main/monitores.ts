// Monitores deste computador (lado anfitrião), etapa 5.1.
//
// O visualizador escolhe qual monitor quer ver. O renderer do anfitrião avisa
// aqui qual monitor a próxima captura deve entregar (CANAL_MONITORES_PREPARAR)
// e chama getDisplayMedia; o autorizador da captura (captura.ts) entrega esse
// monitor e anota que é ele que está sendo mostrado. O mouse do visualizador
// passa a agir só nesse monitor (input.ts manda a área ao processo de input).
//
// Quando monitores entram, saem ou mudam de resolução/escala, a lista é
// refeita e a janela principal é avisada (CANAL_MONITORES_MUDOU).
import { ipcMain, screen, type WebContents } from 'electron';
import { esquemaIdMonitor } from '@acesso-remoto/shared';
import { CANAL_MONITORES_LISTAR, CANAL_MONITORES_MUDOU, CANAL_MONITORES_PREPARAR } from '../preload/api';
import {
  areaDoRobo,
  escolherMonitor,
  montarMonitores,
  paraVisualizador,
  type MonitorSistema,
  type Retangulo,
} from './lista-monitores';
import { janelaDoQuadroPrincipal } from './quadros';

/** Lista atual (refeita quando os monitores mudam). */
let cache: MonitorSistema[] | null = null;
/** Monitor que a próxima captura deve entregar (null: o principal). */
let pedido: string | null = null;
/** Monitor que está sendo capturado (onde o mouse do visualizador age). */
let mostrado: string | null = null;
/** A janela que usa os monitores (a principal): recebe o aviso de mudança. */
let interessado: WebContents | null = null;
const aoMudar: Array<() => void> = [];
const aoMudarArea: Array<() => void> = [];

function monitores(): MonitorSistema[] {
  cache ??= montarMonitores(screen.getAllDisplays(), screen.getPrimaryDisplay().id, (d) =>
    areaDoRobo(d, process.platform, (limites) => screen.dipToScreenRect(null, limites)),
  );
  return cache;
}

/** Para o autorizador da captura: o monitor a entregar agora. */
export function monitorParaCapturar(): MonitorSistema | null {
  const monitor = escolherMonitor(monitores(), pedido);
  pedido = null; // o pedido vale para uma captura só
  return monitor;
}

/** O autorizador entregou este monitor: o mouse passa a agir nele. */
export function definirMonitorMostrado(id: string): void {
  mostrado = id;
  for (const tratar of aoMudarArea) tratar();
}

/** Área do monitor mostrado, nas coordenadas do robotjs (se sumiu, a do principal). */
export function areaDoMonitorMostrado(): Retangulo {
  return escolherMonitor(monitores(), mostrado)?.area ?? { x: 0, y: 0, largura: 1, altura: 1 };
}

/** Registra quem precisa saber quando os monitores mudam (ex.: o robotjs). */
export function aoMudarMonitores(tratar: () => void): void {
  aoMudar.push(tratar);
}

/** Registra quem precisa saber quando a área do monitor mostrado muda (o processo de input). */
export function aoMudarAreaMostrada(tratar: () => void): void {
  aoMudarArea.push(tratar);
}

export function configurarMonitores(): void {
  const mudou = () => {
    cache = null;
    for (const tratar of aoMudar) tratar();
    for (const tratar of aoMudarArea) tratar(); // o mesmo monitor pode ter mudado de lugar ou de escala
    if (interessado && !interessado.isDestroyed()) interessado.send(CANAL_MONITORES_MUDOU);
  };
  screen.on('display-added', mudou);
  screen.on('display-removed', mudou);
  screen.on('display-metrics-changed', mudou);

  ipcMain.handle(CANAL_MONITORES_LISTAR, (evento) => {
    if (!janelaDoQuadroPrincipal(evento.senderFrame)) return [];
    interessado = evento.sender;
    return paraVisualizador(monitores());
  });

  // Devolve o monitor que a próxima captura vai entregar (o pedido, ou o
  // principal se o pedido não existir mais).
  ipcMain.handle(CANAL_MONITORES_PREPARAR, (evento, id: unknown) => {
    if (!janelaDoQuadroPrincipal(evento.senderFrame)) return null;
    interessado = evento.sender;
    pedido = esquemaIdMonitor.safeParse(id).success ? (id as string) : null;
    return escolherMonitor(monitores(), pedido)?.id ?? null;
  });
}
