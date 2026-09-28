// Área de transferência compartilhada (texto): liga o monitor
// (monitor-area.ts) ao clipboard do Electron e à janela principal.
//
// Fluxo: a janela principal liga o monitor quando a sessão é liberada
// (CANAL_AREA_MONITORAR); cada texto copiado aqui vai para ela
// (CANAL_AREA_COPIADO), que o envia pela conexão direta; o que chega do outro
// lado volta por CANAL_AREA_ESCREVER. Fora de sessão, nada é lido.
import { clipboard, ipcMain, type WebContents } from 'electron';
import { TEXTO_AREA_TRANSFERENCIA_MAXIMO } from '@acesso-remoto/shared';
import { CANAL_AREA_COPIADO, CANAL_AREA_ESCREVER, CANAL_AREA_MONITORAR } from '../preload/api';
import { criarContadorDeMudancas } from './contador-area';
import { MonitorAreaTransferencia } from './monitor-area';
import { janelaDoQuadroPrincipal } from './quadros';

/** A janela que ligou o monitor: recebe os textos copiados. */
let dono: WebContents | null = null;

const monitor = new MonitorAreaTransferencia({
  area: {
    lerTexto: () => clipboard.readText(),
    escreverTexto: (texto) => clipboard.writeText(texto),
    // Windows: só abre a área quando algo foi copiado (não atrapalha outros programas).
    contadorDeMudancas: criarContadorDeMudancas(),
  },
  aoCopiar: (texto) => {
    if (dono && !dono.isDestroyed()) dono.send(CANAL_AREA_COPIADO, texto);
  },
});

/** Se a janela fechar, travar ou recarregar, a sessão acabou: para de ler. */
const aoPerderDono = () => desligar();
const EVENTOS_PERDA_DONO = ['destroyed', 'render-process-gone', 'did-start-loading'] as const;

function desligar(): void {
  if (dono && !dono.isDestroyed()) {
    for (const evento of EVENTOS_PERDA_DONO) dono.off(evento as 'destroyed', aoPerderDono);
  }
  dono = null;
  monitor.desligar();
}

export function configurarAreaTransferencia(): void {
  ipcMain.on(CANAL_AREA_MONITORAR, (evento, ligar: unknown, enviarAtual: unknown) => {
    if (!janelaDoQuadroPrincipal(evento.senderFrame)) return;
    if (ligar !== true) {
      if (evento.sender === dono) desligar();
      return;
    }
    if (dono !== evento.sender) {
      desligar();
      dono = evento.sender;
      for (const nome of EVENTOS_PERDA_DONO) evento.sender.on(nome as 'destroyed', aoPerderDono);
    }
    monitor.ligar(enviarAtual === true);
  });

  // Texto recebido do outro computador (já validado no renderer; conferido de novo aqui).
  ipcMain.on(CANAL_AREA_ESCREVER, (evento, texto: unknown) => {
    if (evento.sender !== dono || !janelaDoQuadroPrincipal(evento.senderFrame)) return;
    if (typeof texto !== 'string' || !texto || texto.length > TEXTO_AREA_TRANSFERENCIA_MAXIMO) return;
    void monitor.escrever(texto);
  });
}
