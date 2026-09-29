// Abas das sessões (várias sessões): "Início" (para acessar mais um
// computador) e uma aba por computador acessado. Clicar numa aba mostra e
// controla aquele computador; o "×" encerra a sessão com ele. Só aparece
// quando há ao menos um computador acessado.
import type { IdCliente } from '@acesso-remoto/shared';
import type { EstadoSessao } from '../sessao';
import { elemento } from './util';

export interface AbaSessao {
  parceiro: IdCliente;
  /** Apelido salvo ou o ID formatado. */
  nome: string;
  estado: EstadoSessao;
  /** Mensagens do chat ainda não vistas nessa sessão. */
  naoLidas: number;
}

export interface TelaAbas {
  /** "ativa": a aba à vista (null = Início). */
  atualizar(abas: readonly AbaSessao[], ativa: IdCliente | null): void;
}

export interface OpcoesTelaAbas {
  aoSelecionar: (parceiro: IdCliente | null) => void;
  aoFechar: (parceiro: IdCliente) => void;
}

/** Situação da sessão, para a bolinha e a dica da aba. */
export function situacaoDaAba(estado: EstadoSessao): { classe: string; texto: string } {
  if (estado.fase === 'pedindo') return { classe: 'aguardando', texto: 'aguardando o aceite' };
  if (estado.fase !== 'em_sessao') return { classe: 'aguardando', texto: '' };
  if (!estado.liberada) return { classe: 'aguardando', texto: 'conferindo a senha' };
  if (estado.reconectandoAte !== null) return { classe: 'reconectando', texto: 'reconectando' };
  if (estado.conexao === 'conectado') return { classe: 'conectado', texto: 'conectado' };
  return { classe: 'aguardando', texto: 'conectando' };
}

export function montarTelaAbas(opcoes: OpcoesTelaAbas): TelaAbas {
  const barra = elemento<HTMLElement>('#abas');
  const lista = elemento<HTMLElement>('#lista-abas');
  /** O que foi desenhado por último: só recria os botões se algo mudou. */
  let desenhado = '';

  lista.addEventListener('click', (evento) => {
    const botao = (evento.target as HTMLElement).closest<HTMLButtonElement>('button[data-aba]');
    if (!botao) return;
    const aba = botao.dataset['aba'] ?? '';
    if (botao.dataset['acao'] === 'fechar') opcoes.aoFechar(aba);
    else opcoes.aoSelecionar(aba === 'inicio' ? null : aba);
  });

  function botaoAba(chave: string, rotulo: string, ativa: boolean, dica: string): HTMLButtonElement {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'aba';
    botao.dataset['aba'] = chave;
    botao.setAttribute('role', 'tab');
    botao.setAttribute('aria-selected', String(ativa));
    botao.title = dica;
    botao.textContent = rotulo;
    return botao;
  }

  return {
    atualizar(abas, ativa) {
      barra.hidden = abas.length === 0;
      const chave = JSON.stringify([ativa, abas.map((a) => [a.parceiro, a.nome, situacaoDaAba(a.estado), a.naoLidas])]);
      if (chave === desenhado) return;
      desenhado = chave;

      const itens: HTMLElement[] = [botaoAba('inicio', 'Início', ativa === null, 'Tela inicial: acessar mais um computador')];
      for (const aba of abas) {
        const situacao = situacaoDaAba(aba.estado);
        const grupo = document.createElement('span');
        grupo.className = 'grupo-aba';
        grupo.dataset['situacao'] = situacao.classe;
        const rotulo = aba.naoLidas > 0 ? `${aba.nome} (${aba.naoLidas})` : aba.nome;
        const botao = botaoAba(aba.parceiro, rotulo, aba.parceiro === ativa, `${aba.nome}${situacao.texto ? ` — ${situacao.texto}` : ''}`);
        const bolinha = document.createElement('span');
        bolinha.className = 'bolinha';
        bolinha.setAttribute('aria-hidden', 'true');
        botao.prepend(bolinha);
        const fechar = document.createElement('button');
        fechar.type = 'button';
        fechar.className = 'fechar-aba';
        fechar.dataset['aba'] = aba.parceiro;
        fechar.dataset['acao'] = 'fechar';
        fechar.textContent = '×';
        fechar.setAttribute('aria-label', `Encerrar a sessão com ${aba.nome}`);
        fechar.title = 'Encerrar esta sessão';
        grupo.append(botao, fechar);
        itens.push(grupo);
      }
      lista.replaceChildren(...itens);
    },
  };
}
