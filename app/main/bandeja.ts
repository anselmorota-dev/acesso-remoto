// Ícone na bandeja do sistema e "iniciar junto com o computador".
//
// Com o acesso não supervisionado, o app precisa estar rodando mesmo sem
// janela: o X só esconde a janela (main/index.ts) e o app fica aqui, na
// bandeja, conectado ao servidor. Iniciado com o sistema, abre escondido
// (argumento --oculto) e já fica pronto para receber acessos.
import { app, clipboard, ipcMain, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import {
  CANAL_BANDEJA_ESTADO,
  CANAL_INICIO_AUTOMATICO_DEFINIR,
  CANAL_INICIO_AUTOMATICO_LER,
  CANAL_INICIO_AUTOMATICO_MUDOU,
  CANAL_PEDIDO_ENCERRAR,
} from '../preload/api';
import { desenharIcone } from './icone-bandeja';
import { dicaBandeja, itensMenu, type EstadoBandeja } from './menu-bandeja';
import { janelaDoQuadroPrincipal } from './quadros';

/** Argumento com que o sistema inicia o app: começa só na bandeja. */
export const ARGUMENTO_OCULTO = '--oculto';

export interface OpcoesBandeja {
  /** A janela principal (null se ainda não existe ou já fechou). */
  janela: () => BrowserWindow | null;
  /** Mostra e traz a janela principal para frente. */
  mostrarJanela: () => void;
}

let bandeja: Tray | null = null;
let avisoJaMostrado = false;
/** O que fazer se o usuário clicar no balão atual (null: nada, ex.: o aviso da bandeja). */
let aoClicarBalao: (() => void) | null = null;

function icone(emSessao: boolean): Electron.NativeImage {
  // 16 px para telas com escala 100%, 32 px para 200% (fica nítido nas duas).
  const imagem = nativeImage.createFromBitmap(desenharIcone(16, emSessao), { width: 16, height: 16, scaleFactor: 1 });
  imagem.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: desenharIcone(32, emSessao) });
  return imagem;
}

/**
 * Onde o sistema encontra o app para iniciar. Instalado, é o próprio
 * executável; em desenvolvimento, o electron.exe com a pasta do projeto.
 * Ler e gravar precisam usar os mesmos valores (o Windows compara os dois).
 */
function opcoesInicio(): { path?: string; args: string[] } {
  return app.isPackaged
    ? { args: [ARGUMENTO_OCULTO] }
    : { path: process.execPath, args: [app.getAppPath(), ARGUMENTO_OCULTO] };
}

function inicioAutomaticoLigado(): boolean {
  return app.getLoginItemSettings(opcoesInicio()).openAtLogin;
}

/** Aviso (uma vez por execução) de que o X não fechou o app. */
export function avisarQueContinuaNaBandeja(): void {
  if (!bandeja || avisoJaMostrado || process.platform !== 'win32') return;
  avisoJaMostrado = true;
  aoClicarBalao = null;
  bandeja.displayBalloon({
    title: 'Acesso Remoto continua rodando',
    content: 'Ele fica aqui na bandeja, pronto para receber acessos. Para fechar de vez, use "Sair" no menu deste ícone.',
    iconType: 'info',
  });
}

/**
 * Notificação pelo balão do ícone da bandeja (Windows). Diferente da
 * Notification do Electron, não exige atalho do app no menu Iniciar (que só
 * existe com o instalador). false: não há bandeja (use outro meio).
 */
export function notificarNaBandeja(titulo: string, texto: string, aoClicar: () => void): boolean {
  if (!bandeja || process.platform !== 'win32') return false;
  aoClicarBalao = aoClicar;
  bandeja.displayBalloon({ title: titulo, content: texto, iconType: 'info', respectQuietTime: true });
  return true;
}

export function configurarBandeja(opcoes: OpcoesBandeja): void {
  let estado: EstadoBandeja = { id: null, parceiro: null };

  const definirInicioAutomatico = (ligar: boolean): boolean => {
    app.setLoginItemSettings({ openAtLogin: ligar, ...opcoesInicio() });
    const ligado = inicioAutomaticoLigado();
    opcoes.janela()?.webContents.send(CANAL_INICIO_AUTOMATICO_MUDOU, ligado);
    atualizar();
    return ligado;
  };

  function atualizar(): void {
    if (!bandeja) return;
    bandeja.setImage(icone(estado.parceiro !== null));
    bandeja.setToolTip(dicaBandeja(estado));
    bandeja.setContextMenu(
      Menu.buildFromTemplate(
        itensMenu(estado, inicioAutomaticoLigado(), {
          abrir: opcoes.mostrarJanela,
          copiarId: () => {
            if (estado.id) clipboard.writeText(estado.id);
          },
          encerrarSessao: () => opcoes.janela()?.webContents.send(CANAL_PEDIDO_ENCERRAR),
          alternarInicioAutomatico: definirInicioAutomatico,
          sair: () => app.quit(),
        }),
      ),
    );
  }

  bandeja = new Tray(icone(false));
  // Clique no ícone abre a janela (o menu fica no botão direito).
  bandeja.on('click', opcoes.mostrarJanela);
  bandeja.on('balloon-click', () => {
    const tratar = aoClicarBalao;
    aoClicarBalao = null;
    tratar?.();
  });
  atualizar();

  // Só a janela principal informa o estado e mexe na opção.
  const daJanelaPrincipal = (quadro: Electron.WebFrameMain | null | undefined) => {
    const janela = janelaDoQuadroPrincipal(quadro);
    return janela !== null && janela === opcoes.janela();
  };

  ipcMain.on(CANAL_BANDEJA_ESTADO, (evento, dados: unknown) => {
    if (!daJanelaPrincipal(evento.senderFrame)) return;
    const { id, parceiro } = (dados ?? {}) as Partial<EstadoBandeja>;
    const idValido = (valor: unknown) => (typeof valor === 'string' && /^[1-9]\d{8}$/.test(valor) ? valor : null);
    const novo = { id: idValido(id), parceiro: idValido(parceiro) };
    if (novo.id === estado.id && novo.parceiro === estado.parceiro) return;
    estado = novo;
    atualizar();
  });

  ipcMain.handle(CANAL_INICIO_AUTOMATICO_LER, (evento) => {
    if (!daJanelaPrincipal(evento.senderFrame)) throw new Error('origem não autorizada');
    return inicioAutomaticoLigado();
  });

  ipcMain.handle(CANAL_INICIO_AUTOMATICO_DEFINIR, (evento, ligar: unknown) => {
    if (!daJanelaPrincipal(evento.senderFrame)) throw new Error('origem não autorizada');
    if (typeof ligar !== 'boolean') throw new Error('pedido inválido');
    return definirInicioAutomatico(ligar);
  });
}
