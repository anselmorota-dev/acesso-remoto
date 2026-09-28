// Processo principal do Electron: cria janelas e é o único lugar que
// executa input (mouse/teclado) no sistema.
import { join } from 'node:path';
import { app, BrowserWindow, Menu } from 'electron';
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { configurarAtencao } from './atencao';
import { configurarCaptura } from './captura';
import { configurarIdentidade } from './identidade';
import { configurarIndicador } from './indicador';
import { configurarInput } from './input';
import { configurarSenha } from './senha';

let janelaPrincipal: BrowserWindow | null = null;

function criarJanelaPrincipal(): void {
  const janela = new BrowserWindow({
    width: 900,
    height: 640,
    show: false,
    title: 'Acesso Remoto',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Regras de segurança do projeto: o renderer não tem acesso ao Node
      // e só enxerga o que o preload expõe explicitamente.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  janelaPrincipal = janela;
  janela.on('closed', () => {
    if (janelaPrincipal === janela) janelaPrincipal = null;
  });

  // Mostra a janela só quando o conteúdo estiver pronto, evitando tela branca.
  janela.once('ready-to-show', () => janela.show());

  // A interface nunca deve abrir novas janelas nem navegar para outros sites.
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.webContents.on('will-navigate', (evento) => evento.preventDefault());

  // Em desenvolvimento o electron-vite serve o renderer com recarga automática;
  // no build final carregamos o HTML gerado.
  const urlDev = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && urlDev) {
    void janela.loadURL(urlDev);
  } else {
    void janela.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Uma instância por pasta de dados: duas cópias do app teriam a mesma
// identidade (mesmo ID) e ficariam derrubando uma à outra no servidor.
// Abrir de novo só traz a janela que já está aberta para frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!janelaPrincipal) return;
    if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
    janelaPrincipal.show();
    janelaPrincipal.focus();
  });

  void app.whenReady().then(() => {
    console.log(`[main] app pronto (protocolo v${PROTOCOL_VERSION})`);
    // Sem o menu padrão do Electron: seus atalhos (Ctrl+W fecha, Ctrl+R recarrega,
    // Alt abre o menu) agiriam no app em vez de ir para o computador remoto.
    Menu.setApplicationMenu(null);
    configurarCaptura();
    configurarAtencao();
    configurarIndicador();
    configurarIdentidade();
    configurarSenha();
    configurarInput(); // antes de criar a janela: registra a limpeza ao fechá-la
    criarJanelaPrincipal();

    // macOS: recria a janela ao clicar no ícone do dock se nenhuma estiver aberta.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) criarJanelaPrincipal();
    });
  });
}

// No Windows/Linux, fechar a última janela encerra o app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
