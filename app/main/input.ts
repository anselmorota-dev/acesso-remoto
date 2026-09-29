// Controle de mouse e teclado no anfitrião: o main cria e supervisiona o
// processo de input (processo-input.ts) e liga a janela principal a ele.
//
// Regra do projeto: só o processo de input executa input. O renderer recebe
// os eventos pelo DataChannel, valida e os envia por um MessagePort direto
// ao processo de input, que valida de novo e executa com o robotjs. O main
// não fica no caminho: se ele travar num laço do Windows (ex.: o
// visualizador clicou em minimizar a janela do app), o input continua.
import { join } from 'node:path';
import { app, MessageChannelMain, utilityProcess, type BrowserWindow, type UtilityProcess, type WebContents } from 'electron';
import { CANAL_INPUT_PORTA } from '../preload/api';
import type { ComandoDoMain } from './servico-input';
import { aoMudarAreaMostrada, aoMudarMonitores, areaDoMonitorMostrado } from './monitores';

let processo: UtilityProcess | null = null;
/** A página da janela principal ligada ao processo de input (recebe o canal a cada carregamento). */
let pagina: WebContents | null = null;
let saindo = false;

function comandar(comando: ComandoDoMain): void {
  processo?.postMessage(comando);
}

/** Canal novo entre a página e o processo de input (o anterior deixa de valer). */
function entregarPorta(): void {
  if (!processo || !pagina || pagina.isDestroyed()) return;
  const { port1, port2 } = new MessageChannelMain();
  processo.postMessage({ tipo: 'porta' }, [port1]);
  pagina.postMessage(CANAL_INPUT_PORTA, null, [port2]);
}

function iniciarProcesso(): void {
  const novo = utilityProcess.fork(join(__dirname, 'processo-input.js'), [], { serviceName: 'Acesso Remoto (input)' });
  processo = novo;
  novo.on('exit', (codigo) => {
    if (processo !== novo) return;
    processo = null;
    if (saindo) return;
    // Caiu (não deveria): recria e religa a página, soltando nada preso.
    console.error(`[main] processo de input terminou (código ${codigo}); recriando`);
    setTimeout(() => {
      if (saindo) return;
      iniciarProcesso();
      entregarPorta();
    }, 1000);
  });
  comandar({ tipo: 'area', area: areaDoMonitorMostrado() });
}

export function configurarInput(): void {
  app.on('before-quit', () => {
    saindo = true;
  });
  iniciarProcesso();
  // O mouse age só no monitor mostrado ao visualizador (5.1).
  aoMudarAreaMostrada(() => comandar({ tipo: 'area', area: areaDoMonitorMostrado() }));
  aoMudarMonitores(() => comandar({ tipo: 'monitores_mudaram' }));
}

/**
 * Liga a janela principal (e só ela) ao processo de input: um canal novo a
 * cada carregamento da página; ao fechar, travar ou recarregar, solta o que
 * estiver apertado (o aviso do renderer pode não chegar).
 */
export function ligarJanelaAoInput(janela: BrowserWindow): void {
  const conteudo = janela.webContents;
  pagina = conteudo;
  conteudo.on('did-finish-load', entregarPorta);
  const liberar = () => comandar({ tipo: 'liberar' });
  conteudo.on('render-process-gone', liberar);
  conteudo.on('did-start-loading', liberar);
  janela.on('closed', () => {
    liberar();
    if (pagina === conteudo) pagina = null;
  });
}
