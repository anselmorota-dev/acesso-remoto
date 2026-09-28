// Processo principal do Electron: cria janelas e, nas próximas fases,
// será o único lugar que executa input (mouse/teclado) no sistema.
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';

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

void app.whenReady().then(() => {
  console.log(`[main] app pronto (protocolo v${PROTOCOL_VERSION})`);
  criarJanelaPrincipal();

  // macOS: recria a janela ao clicar no ícone do dock se nenhuma estiver aberta.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanelaPrincipal();
  });
});

// No Windows/Linux, fechar a última janela encerra o app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
