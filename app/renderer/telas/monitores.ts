// Escolha do monitor (visualizador, etapa 5.1): botões "1", "2"... no painel
// da sessão, um por monitor do anfitrião (da esquerda para a direita). Só
// aparecem com mais de um monitor. O botão do monitor à vista fica marcado.
import type { IdMonitor, Monitor } from '@acesso-remoto/shared';
import type { EstadoSessao } from '../sessao';
import { elemento } from './util';

export interface TelaMonitores {
  atualizar(estado: EstadoSessao): void;
}

export interface OpcoesTelaMonitores {
  aoEscolher: (id: IdMonitor) => void;
}

/** Descrição do monitor para a dica e o leitor de tela: "Monitor 2 · 1920×1080 (principal)". */
export function descreverMonitor(monitor: Monitor, indice: number): string {
  const principal = monitor.principal ? ' (principal)' : '';
  return `Monitor ${indice + 1} · ${monitor.largura}×${monitor.altura}${principal}`;
}

export function montarTelaMonitores(opcoes: OpcoesTelaMonitores): TelaMonitores {
  const grupo = elemento<HTMLElement>('#monitores-sessao');
  const botoes = elemento<HTMLElement>('#botoes-monitores');
  /** Lista desenhada por último: os botões só são recriados quando ela muda. */
  let desenhada = '';

  botoes.addEventListener('click', (evento) => {
    const botao = (evento.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    const id = botao?.dataset['id'];
    if (id) opcoes.aoEscolher(id);
  });

  return {
    atualizar(estado) {
      const monitores =
        estado.fase === 'em_sessao' && estado.papel === 'visualizador' && estado.liberada ? estado.monitores : null;
      grupo.hidden = !monitores || monitores.lista.length < 2;
      if (!monitores) {
        desenhada = '';
        return;
      }

      const chave = JSON.stringify(monitores.lista);
      if (chave !== desenhada) {
        desenhada = chave;
        botoes.replaceChildren(
          ...monitores.lista.map((monitor, indice) => {
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'secundario pequeno';
            botao.dataset['id'] = monitor.id;
            botao.textContent = String(indice + 1);
            botao.title = descreverMonitor(monitor, indice);
            botao.setAttribute('aria-label', botao.title);
            return botao;
          }),
        );
      }
      for (const botao of botoes.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
        botao.setAttribute('aria-pressed', String(botao.dataset['id'] === monitores.atual));
      }
    },
  };
}
