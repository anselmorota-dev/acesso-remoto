// Autorização de captura de tela.
//
// Quando o renderer chama navigator.mediaDevices.getDisplayMedia(), o
// Electron pergunta ao processo main qual tela entregar. Aqui decidimos:
// só a janela principal do próprio app pode capturar, e ela recebe o
// monitor principal (escolher o monitor fica para a etapa 5.1).
import { BrowserWindow, desktopCapturer, screen, session } from 'electron';

export function configurarCaptura(): void {
  session.defaultSession.setDisplayMediaRequestHandler((pedido, responder) => {
    const negar = () => responder({});

    // Só aceita pedidos do quadro principal de uma janela nossa (nunca de
    // um iframe ou de outro conteúdo que venha a ser carregado).
    const quadro = pedido.frame;
    const daNossaJanela = BrowserWindow.getAllWindows().some(
      (janela) =>
        quadro !== null &&
        janela.webContents.mainFrame.processId === quadro.processId &&
        janela.webContents.mainFrame.routingId === quadro.routingId,
    );
    if (!daNossaJanela || !pedido.videoRequested) {
      console.warn('[main] pedido de captura negado:', pedido.securityOrigin);
      negar();
      return;
    }

    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((fontes) => {
        const principal = String(screen.getPrimaryDisplay().id);
        const fonte = fontes.find((f) => f.display_id === principal) ?? fontes[0];
        if (!fonte) {
          negar();
          return;
        }
        console.log(`[main] captura autorizada: ${fonte.name}`);
        responder({ video: fonte }); // sem áudio por enquanto
      })
      .catch((erro: unknown) => {
        console.error('[main] falha ao listar telas:', erro);
        negar();
      });
  });
}
