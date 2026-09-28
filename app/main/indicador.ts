// Indicador de sessão ativa no anfitrião (regra de segurança do projeto):
// enquanto alguém vê e controla este computador, uma barra pequena fica
// no topo da tela, por cima de tudo, com o botão Encerrar.
//
// - Não rouba o foco ao aparecer (focusable: false; o anfitrião pode estar
//   digitando em outro programa) e não aparece na barra de tarefas.
// - Não pode ser fechada (closable: false): só some quando a sessão acaba.
// - Aparece também no vídeo que o visualizador recebe, e isso é proposital:
//   os dois lados sabem que a sessão está visível.
//
// Fluxo: a janela principal avisa início/fim (CANAL_INDICAR_SESSAO); o botão
// do indicador pede o encerramento (CANAL_ENCERRAR_PELO_INDICADOR), que o
// main repassa à janela principal (CANAL_PEDIDO_ENCERRAR), dona da sessão.
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, screen, type WebContents } from 'electron';
import { esquemaId, type IdCliente } from '@acesso-remoto/shared';
import { CANAL_INDICAR_SESSAO, CANAL_PEDIDO_ENCERRAR } from '../preload/api';
import { CANAL_ENCERRAR_PELO_INDICADOR } from '../preload/api-indicador';
import { janelaDoQuadroPrincipal } from './quadros';

const LARGURA = 520;
const ALTURA = 48;
/** Distância do topo da área útil da tela. */
const MARGEM = 8;

let indicador: BrowserWindow | null = null;
/** A janela principal que pediu o indicador: é ela quem recebe o pedido de encerrar. */
let dono: WebContents | null = null;

/** Se a janela principal fechar, travar ou recarregar, a sessão acabou: some o indicador. */
const aoPerderDono = () => esconder();
const EVENTOS_PERDA_DONO = ['destroyed', 'render-process-gone', 'did-start-loading'] as const;

function esconder(): void {
  if (dono && !dono.isDestroyed()) {
    for (const evento of EVENTOS_PERDA_DONO) dono.off(evento as 'destroyed', aoPerderDono);
  }
  dono = null;
  const janela = indicador;
  indicador = null;
  // destroy() e não close(): a janela não é "fechável" pelo usuário.
  if (janela && !janela.isDestroyed()) janela.destroy();
}

function mostrar(parceiro: IdCliente, novoDono: WebContents): void {
  esconder();
  dono = novoDono;
  for (const evento of EVENTOS_PERDA_DONO) novoDono.on(evento as 'destroyed', aoPerderDono);

  const area = screen.getPrimaryDisplay().workArea;
  const janela = new BrowserWindow({
    width: LARGURA,
    height: ALTURA,
    x: Math.round(area.x + (area.width - LARGURA) / 2),
    y: area.y + MARGEM,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Sessão ativa — Acesso Remoto',
    webPreferences: {
      preload: join(__dirname, '../preload/indicador.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Nível "screen-saver": fica por cima até de programas em tela cheia.
  janela.setAlwaysOnTop(true, 'screen-saver');
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.webContents.on('will-navigate', (evento) => evento.preventDefault());
  janela.once('ready-to-show', () => janela.showInactive());

  const urlDev = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && urlDev) {
    void janela.loadURL(`${urlDev}/indicador.html?parceiro=${parceiro}`);
  } else {
    void janela.loadFile(join(__dirname, '../renderer/indicador.html'), { query: { parceiro } });
  }
  indicador = janela;
}

export function configurarIndicador(): void {
  ipcMain.on(CANAL_INDICAR_SESSAO, (evento, dados: unknown) => {
    // Só a janela principal (nunca o próprio indicador) liga ou desliga o indicador.
    const janela = janelaDoQuadroPrincipal(evento.senderFrame);
    if (!janela || janela === indicador) return;

    if (dados === null) {
      if (evento.sender === dono) esconder();
      return;
    }
    const parceiro = esquemaId.safeParse(dados);
    if (parceiro.success) mostrar(parceiro.data, evento.sender);
    else console.warn('[main] pedido de indicador com ID inválido, ignorado');
  });

  ipcMain.on(CANAL_ENCERRAR_PELO_INDICADOR, (evento) => {
    // Só vale se vier do indicador atual.
    if (!indicador || janelaDoQuadroPrincipal(evento.senderFrame) !== indicador) return;
    if (dono && !dono.isDestroyed()) dono.send(CANAL_PEDIDO_ENCERRAR);
  });
}
