// Identifica de onde vem um pedido feito ao processo main.
//
// Só o quadro principal (mainFrame) das nossas janelas pode pedir coisas
// sensíveis (capturar a tela, trazer a janela para frente...). Assim, um
// iframe ou outro conteúdo que venha a ser carregado não ganha esses poderes.
import { BrowserWindow, type WebFrameMain } from 'electron';

/** A janela nossa cujo quadro principal é "quadro", ou null se não for de nenhuma. */
export function janelaDoQuadroPrincipal(quadro: WebFrameMain | null | undefined): BrowserWindow | null {
  if (!quadro) return null;
  return (
    BrowserWindow.getAllWindows().find(
      (janela) =>
        janela.webContents.mainFrame.processId === quadro.processId &&
        janela.webContents.mainFrame.routingId === quadro.routingId,
    ) ?? null
  );
}
