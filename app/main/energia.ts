// Durante uma sessão, o computador não pode suspender nem apagar a tela:
// no anfitrião, a captura pararia (e a conexão cairia); no visualizador,
// quem está só olhando a tela remota veria o monitor apagar.
//
// "prevent-display-sleep" mantém a tela acesa e o sistema acordado. Não
// impede a suspensão por fechar a tampa do notebook (isso é configuração do
// Windows: "ao fechar a tampa: não fazer nada").
import { ipcMain, powerSaveBlocker, type WebContents } from 'electron';
import { CANAL_MANTER_ACORDADO } from '../preload/api';
import { janelaDoQuadroPrincipal } from './quadros';

let bloqueio: number | null = null;
/** A janela que pediu o bloqueio: se ela fechar, travar ou recarregar, a sessão acabou. */
let dono: WebContents | null = null;

const aoPerderDono = () => liberar();
const EVENTOS_PERDA_DONO = ['destroyed', 'render-process-gone', 'did-start-loading'] as const;

function liberar(): void {
  if (dono && !dono.isDestroyed()) {
    for (const evento of EVENTOS_PERDA_DONO) dono.off(evento as 'destroyed', aoPerderDono);
  }
  dono = null;
  if (bloqueio !== null) {
    powerSaveBlocker.stop(bloqueio);
    bloqueio = null;
    console.log('[main] sessão acabou: o computador volta a poder suspender');
  }
}

function manterAcordado(novoDono: WebContents): void {
  if (bloqueio !== null && dono === novoDono) return;
  liberar();
  dono = novoDono;
  for (const evento of EVENTOS_PERDA_DONO) novoDono.on(evento as 'destroyed', aoPerderDono);
  bloqueio = powerSaveBlocker.start('prevent-display-sleep');
  console.log('[main] sessão ativa: tela e sistema mantidos acordados');
}

export function configurarEnergia(): void {
  ipcMain.on(CANAL_MANTER_ACORDADO, (evento, ligar: unknown) => {
    // Só a janela principal (dona da sessão) decide.
    if (!janelaDoQuadroPrincipal(evento.senderFrame)) return;
    if (ligar === true) manterAcordado(evento.sender);
    else if (ligar === false && evento.sender === dono) liberar();
  });
}
