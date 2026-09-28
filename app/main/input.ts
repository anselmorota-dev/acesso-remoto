// Controle de mouse e teclado no anfitrião.
//
// Regra do projeto: só o processo main executa input. O renderer recebe os
// eventos pelo DataChannel, valida e repassa por IPC; aqui eles são
// validados de novo (o IPC é outra fronteira) e executados com o robotjs.
import * as robot from '@jitsi/robotjs';
import { app, ipcMain } from 'electron';
import { esquemaEventoInput, type BotaoMouse } from '@acesso-remoto/shared';
import { CANAL_EXECUTAR_INPUT, CANAL_LIBERAR_INPUT } from '../preload/api';
import { ExecutorInput, type Robo } from './executor-input';
import { janelaDoQuadroPrincipal } from './quadros';

const BOTOES_ROBOTJS: Record<BotaoMouse, 'left' | 'middle' | 'right'> = {
  esquerdo: 'left',
  meio: 'middle',
  direito: 'right',
};

function criarRobo(): Robo {
  // Por padrão o robotjs dorme 10 ms depois de cada ação, travando o main.
  robot.setMouseDelay(0);
  robot.setKeyboardDelay(0);
  return {
    tamanhoTela: () => {
      const { width, height } = robot.getScreenSize();
      return { largura: width, altura: height };
    },
    moverPara: (x, y) => robot.moveMouse(x, y),
    botao: (botao, pressionado) => robot.mouseToggle(pressionado ? 'down' : 'up', BOTOES_ROBOTJS[botao]),
    rolar: (x, y) => robot.scrollMouse(x, y),
    tecla: (tecla, pressionada) => {
      try {
        robot.keyToggle(tecla, pressionada ? 'down' : 'up');
      } catch (erro) {
        // O robotjs lança erro para tecla desconhecida (o esquema já deveria barrar).
        console.warn(`[main] tecla não executada (${tecla}):`, erro);
      }
    },
    digitar: (texto) => {
      // unicodeTap envia uma unidade UTF-16 por vez (valores acima de 0xFFFF
      // são cortados), então caracteres como emojis vão em duas partes.
      for (let i = 0; i < texto.length; i++) robot.unicodeTap(texto.charCodeAt(i));
    },
  };
}

export function configurarInput(): void {
  const executor = new ExecutorInput(criarRobo(), { plataforma: process.platform });
  const liberar = () => executor.liberar();

  ipcMain.on(CANAL_EXECUTAR_INPUT, (evento, dados: unknown) => {
    if (!janelaDoQuadroPrincipal(evento.senderFrame)) return;
    const resultado = esquemaEventoInput.safeParse(dados);
    if (!resultado.success) {
      console.warn('[main] evento de input inválido, ignorado');
      return;
    }
    executor.executar(resultado.data);
  });

  // O renderer avisa quando a sessão acaba; soltamos o que ficou apertado.
  ipcMain.on(CANAL_LIBERAR_INPUT, (evento) => {
    if (janelaDoQuadroPrincipal(evento.senderFrame)) liberar();
  });

  // Se a janela fechar ou o renderer travar no meio de um arraste, o aviso
  // acima nunca chega: solta os botões mesmo assim.
  app.on('browser-window-created', (_evento, janela) => {
    janela.on('closed', liberar);
    janela.webContents.on('render-process-gone', liberar);
  });
}
