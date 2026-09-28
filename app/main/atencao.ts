// Chamar a atenção do usuário quando chega um pedido de acesso.
//
// O renderer avisa pelo canal CANAL_CHAMAR_ATENCAO e o main traz a janela
// para frente. O Windows impede que um programa em segundo plano "roube" o
// foco; nesse caso focus() não tem efeito, e por isso também piscamos o
// ícone na barra de tarefas até o usuário voltar para a janela.
import { ipcMain } from 'electron';
import { CANAL_CHAMAR_ATENCAO } from '../preload/api';
import { janelaDoQuadroPrincipal } from './quadros';

export function configurarAtencao(): void {
  ipcMain.on(CANAL_CHAMAR_ATENCAO, (evento) => {
    const janela = janelaDoQuadroPrincipal(evento.senderFrame);
    if (!janela) {
      console.warn('[main] pedido de atenção ignorado: origem desconhecida');
      return;
    }

    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();

    if (!janela.isFocused()) {
      janela.flashFrame(true);
      // No Windows a piscada para sozinha ao focar; em outros sistemas, não.
      janela.once('focus', () => janela.flashFrame(false));
    }
  });
}
