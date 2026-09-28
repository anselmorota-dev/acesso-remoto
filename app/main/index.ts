// Processo principal do Electron: cria janelas e é o único lugar que
// executa input (mouse/teclado) no sistema.
import { join } from 'node:path';
import { app, BrowserWindow, Menu } from 'electron';
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { configurarAtencao } from './atencao';
import { ARGUMENTO_OCULTO, avisarQueContinuaNaBandeja, configurarBandeja } from './bandeja';
import { configurarCaptura } from './captura';
import { configurarIdentidade } from './identidade';
import { configurarIndicador } from './indicador';
import { configurarInput } from './input';
import { configurarSenha } from './senha';

let janelaPrincipal: BrowserWindow | null = null;
/** true depois do "Sair": aí fechar a janela encerra o app de verdade. */
let saindo = false;

/** Iniciado pelo sistema (login): começa só na bandeja, sem mostrar a janela. */
const iniciouOculto = process.argv.includes(ARGUMENTO_OCULTO);

function mostrarJanela(): void {
  if (!janelaPrincipal) return;
  if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
  janelaPrincipal.show();
  janelaPrincipal.focus();
}

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
      // Escondida na bandeja, a janela continua sendo o anfitrião: sem isto o
      // Chromium desacelera timers e trabalho de janelas em segundo plano.
      backgroundThrottling: false,
    },
  });

  janelaPrincipal = janela;
  janela.on('closed', () => {
    if (janelaPrincipal === janela) janelaPrincipal = null;
  });

  // O X só esconde: o app continua na bandeja, pronto para receber acessos.
  janela.on('close', (evento) => {
    if (saindo) return;
    evento.preventDefault();
    janela.hide();
    avisarQueContinuaNaBandeja();
  });

  // Mostra a janela só quando o conteúdo estiver pronto, evitando tela branca
  // (e não mostra se o app foi iniciado junto com o sistema).
  janela.once('ready-to-show', () => {
    if (!iniciouOculto) janela.show();
  });

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
// Abrir de novo só traz a janela que já está aberta (ou escondida) para frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', mostrarJanela);

  void app.whenReady().then(() => {
    console.log(`[main] app pronto (protocolo v${PROTOCOL_VERSION})${iniciouOculto ? ' — iniciado na bandeja' : ''}`);
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
    configurarBandeja({ janela: () => janelaPrincipal, mostrarJanela });

    // macOS: clicar no ícone do dock mostra a janela (ou recria, se não houver).
    app.on('activate', () => {
      if (janelaPrincipal) mostrarJanela();
      else criarJanelaPrincipal();
    });
  });
}

// "Sair" (menu da bandeja) ou fim da sessão do sistema: fechar passa a valer.
app.on('before-quit', () => {
  saindo = true;
});

// Com o X escondendo a janela, isto só acontece ao sair de verdade.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
