// Qualidade do vídeo (visualizador, etapa 5.2): a caixa "Qualidade"
// (Automático / Nitidez / Fluidez) no painel da sessão e uma linha com o que
// está chegando ("1366×768 · 28 fps · 450 kbps · AV1 · automático: nitidez").
import type { ModoQualidade } from '@acesso-remoto/shared';
import { descreverVideo, type EstadoQualidade } from '../qualidade';
import type { EstadoSessao } from '../sessao';
import { elemento } from './util';

export interface TelaQualidade {
  atualizar(estado: EstadoSessao): void;
}

export interface OpcoesTelaQualidade {
  aoEscolher: (modo: ModoQualidade) => void;
}

/** A linha do indicador (vazia se ainda não há o que mostrar). */
export function descreverQualidade(qualidade: EstadoQualidade): string {
  const video = qualidade.video ? descreverVideo(qualidade.video) : '';
  const perfil = qualidade.modo === 'automatico' ? `automático: ${qualidade.efetivo}` : '';
  return [video, perfil].filter(Boolean).join(' · ');
}

export function montarTelaQualidade(opcoes: OpcoesTelaQualidade): TelaQualidade {
  const grupo = elemento<HTMLElement>('#qualidade-sessao');
  const caixa = elemento<HTMLSelectElement>('#modo-qualidade');
  const info = elemento<HTMLParagraphElement>('#info-video');

  caixa.addEventListener('change', () => {
    opcoes.aoEscolher(caixa.value as ModoQualidade);
    // Tira o foco da caixa: o teclado volta a ir para o computador remoto.
    caixa.blur();
  });

  return {
    atualizar(estado) {
      const qualidade =
        estado.fase === 'em_sessao' && estado.papel === 'visualizador' && estado.liberada ? estado.qualidade : null;
      grupo.hidden = !qualidade;
      if (!qualidade) {
        info.hidden = true;
        return;
      }
      // Não mexe na caixa enquanto o usuário a está usando.
      if (document.activeElement !== caixa) caixa.value = qualidade.modo;
      const texto = descreverQualidade(qualidade);
      info.textContent = texto;
      info.hidden = !texto;
    },
  };
}
