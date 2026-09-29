// Autorização de captura de tela.
//
// Quando o renderer chama navigator.mediaDevices.getDisplayMedia(), o
// Electron pergunta ao processo main qual tela entregar. Aqui decidimos:
// só a janela principal do próprio app pode capturar, e ela recebe o
// monitor que o visualizador escolheu (monitores.ts; no começo, o principal).
import { desktopCapturer, session } from 'electron';
import { definirMonitorMostrado, monitorParaCapturar } from './monitores';
import { janelaDoQuadroPrincipal } from './quadros';

export function configurarCaptura(): void {
  session.defaultSession.setDisplayMediaRequestHandler((pedido, responder) => {
    const negar = () => responder({});

    // Só aceita pedidos do quadro principal de uma janela nossa.
    if (!janelaDoQuadroPrincipal(pedido.frame) || !pedido.videoRequested) {
      console.warn('[main] pedido de captura negado:', pedido.securityOrigin);
      negar();
      return;
    }

    const monitor = monitorParaCapturar();
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((fontes) => {
        // O "display_id" da fonte é o mesmo id do monitor no Electron. Se não
        // der para casar (sistema que não informa), fica com a primeira fonte.
        const fonte = fontes.find((f) => f.display_id === monitor?.id) ?? fontes[0];
        if (!fonte) {
          negar();
          return;
        }
        // O mouse do visualizador passa a agir no monitor entregue.
        const entregue = fonte.display_id || monitor?.id;
        if (entregue) definirMonitorMostrado(entregue);
        console.log(`[main] captura autorizada: ${fonte.name} (monitor ${entregue ?? '?'})`);
        responder({ video: fonte }); // sem áudio por enquanto
      })
      .catch((erro: unknown) => {
        console.error('[main] falha ao listar telas:', erro);
        negar();
      });
  });
}
