// Visualização remota: mostra ao visualizador a tela do anfitrião.
// Enquanto está visível, a tela inicial fica escondida (body[data-tela]).
// O mouse sobre o vídeo vira eventos de input para o anfitrião (controle.ts).
import type { EventoInput } from '@acesso-remoto/shared';
import { montarControleRemoto } from '../controle';
import type { EstadoSessao } from '../sessao';
import { elemento } from './util';

export interface TelaVisualizacao {
  atualizar(estado: EstadoSessao): void;
  /** Vídeo recebido do anfitrião, ou null quando a sessão acaba. */
  definirVideo(video: MediaStream | null): void;
}

export interface OpcoesTelaVisualizacao {
  /** Evento de mouse/teclado sobre a tela remota, a enviar ao anfitrião. */
  aoInput: (evento: EventoInput) => void;
}

export function montarTelaVisualizacao(opcoes: OpcoesTelaVisualizacao): TelaVisualizacao {
  const secao = elemento<HTMLElement>('#tela-remota');
  const video = elemento<HTMLVideoElement>('#video-remoto');
  const aguardando = elemento<HTMLParagraphElement>('#aguardando-video');
  const controle = montarControleRemoto(video, opcoes.aoInput);

  // Some o aviso assim que o primeiro quadro tem tamanho conhecido.
  const aoTerImagem = () => {
    aguardando.hidden = video.videoWidth > 0;
  };
  video.addEventListener('loadedmetadata', aoTerImagem);
  video.addEventListener('resize', aoTerImagem);

  return {
    atualizar(estado) {
      const visivel = estado.fase === 'em_sessao' && estado.papel === 'visualizador';
      secao.hidden = !visivel;
      document.body.dataset['tela'] = visivel ? 'remota' : 'inicio';
      if (!visivel) controle.redefinir();
    },
    definirVideo(stream) {
      video.srcObject = stream;
      aguardando.hidden = false;
      if (stream) {
        // autoplay costuma bastar; play() garante caso o navegador segure.
        video.play().catch((erro: unknown) => console.warn('[visualizacao] play falhou:', erro));
      }
    },
  };
}
