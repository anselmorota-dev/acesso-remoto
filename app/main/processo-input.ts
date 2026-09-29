// Processo de input (Electron "utility process"): o único lugar que mexe no
// mouse e no teclado deste computador.
//
// Por que um processo à parte: quando o visualizador aperta o botão de
// minimizar (ou fechar, ou o menu da bandeja) do próprio app, o Windows
// prende o processo main num laço esperando o botão ser solto — e o "soltar"
// vindo do visualizador precisava desse mesmo main para ser executado: os
// dois ficavam esperando um pelo outro e o controle remoto travava.
// Aqui, os eventos chegam do renderer por um MessagePort direto, sem passar
// pelo main, e são executados mesmo com o main preso.
//
// Quem cria este processo e entrega o MessagePort (só à janela principal) é
// o main (input.ts); dele vêm também a área do monitor mostrado e o "soltar
// tudo" quando a janela fecha ou trava.
import * as robot from '@jitsi/robotjs';
import type { BotaoMouse } from '@acesso-remoto/shared';
import { ServicoInput, type RoboDoProcesso } from './servico-input';

const BOTOES_ROBOTJS: Record<BotaoMouse, 'left' | 'middle' | 'right'> = {
  esquerdo: 'left',
  meio: 'middle',
  direito: 'right',
};

function criarRobo(): RoboDoProcesso {
  // Por padrão o robotjs dorme 10 ms depois de cada ação.
  robot.setMouseDelay(0);
  robot.setKeyboardDelay(0);
  return {
    moverPara: (x, y) => robot.moveMouse(x, y),
    botao: (botao, pressionado) => robot.mouseToggle(pressionado ? 'down' : 'up', BOTOES_ROBOTJS[botao]),
    rolar: (x, y) => robot.scrollMouse(x, y),
    tecla: (tecla, pressionada) => {
      try {
        robot.keyToggle(tecla, pressionada ? 'down' : 'up');
      } catch (erro) {
        // O robotjs lança erro para tecla desconhecida (o esquema já deveria barrar).
        console.warn(`[input] tecla não executada (${tecla}):`, erro);
      }
    },
    digitar: (texto) => {
      // unicodeTap envia uma unidade UTF-16 por vez (valores acima de 0xFFFF
      // são cortados), então caracteres como emojis vão em duas partes.
      for (let i = 0; i < texto.length; i++) robot.unicodeTap(texto.charCodeAt(i));
    },
    atualizarTela: () => robot.updateScreenMetrics(),
  };
}

const servico = new ServicoInput(criarRobo(), { plataforma: process.platform });
/** O canal com o renderer da janela principal (um por carregamento da página). */
let porta: Electron.MessagePortMain | null = null;

process.parentPort.on('message', (mensagem) => {
  const [novaPorta] = mensagem.ports;
  if (novaPorta) {
    // Página nova (ou recarregada): o canal antigo não vale mais.
    porta?.close();
    servico.liberar();
    porta = novaPorta;
    novaPorta.on('message', (evento) => {
      if (porta === novaPorta) servico.doRenderer(evento.data);
    });
    // O renderer foi embora (fechou, travou, recarregou): solta o que ficou apertado.
    novaPorta.on('close', () => {
      if (porta === novaPorta) servico.liberar();
    });
    novaPorta.start();
    return;
  }
  servico.doMain(mensagem.data);
});
