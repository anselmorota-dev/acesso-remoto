// Transferência de arquivos na interface: botão "Enviar arquivos" (no painel
// da sessão), arrastar e soltar na janela e a lista com o progresso de cada
// arquivo. Os itens da lista são atualizados no lugar (não recriados): o
// progresso muda várias vezes por segundo e um botão recriado no meio de um
// clique perderia o clique.
import type { Transferencia } from '../arquivos';
import { elemento } from './util';

export interface TelaArquivos {
  atualizar(lista: readonly Transferencia[], podeEnviar: boolean): void;
}

export interface OpcoesTelaArquivos {
  aoEnviar: (arquivos: File[]) => void;
  aoCancelar: (chave: string) => void;
  aoMostrar: (token: string) => void;
  aoLimpar: () => void;
}

/** "1,5 MB", "820 KB", "12 bytes". */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const unidades = ['KB', 'MB', 'GB', 'TB'];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  const casas = valor < 10 ? 1 : 0;
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })} ${unidades[i]}`;
}

/** Texto de situação de um item (sem o nome). */
export function descreverTransferencia(t: Transferencia, agora: number): string {
  const total = formatarTamanho(t.tamanho);
  switch (t.estado) {
    case 'na_fila':
      return `${total} · na fila`;
    case 'transferindo': {
      const segundos = t.iniciadoEm === undefined ? 0 : (agora - t.iniciadoEm) / 1000;
      const velocidade = segundos > 0.5 ? ` · ${formatarTamanho(Math.round(t.transferidos / segundos))}/s` : '';
      return `${formatarTamanho(t.transferidos)} de ${total}${velocidade}`;
    }
    case 'finalizando':
      return t.direcao === 'enviando' ? `${total} · aguardando confirmação…` : `${total} · gravando…`;
    case 'concluido':
      return t.direcao === 'enviando' ? `${total} · enviado` : `${total} · salvo em Downloads\\Acesso Remoto`;
    case 'cancelado':
      return `cancelado${t.motivo ? ` (${t.motivo})` : ''}`;
    case 'erro':
      return `erro: ${t.motivo ?? 'falha na transferência'}`;
  }
}

interface Linha {
  raiz: HTMLLIElement;
  nome: HTMLSpanElement;
  detalhe: HTMLSpanElement;
  barra: HTMLProgressElement;
  botao: HTMLButtonElement;
  item: Transferencia;
}

export function montarTelaArquivos(opcoes: OpcoesTelaArquivos): TelaArquivos {
  const painel = elemento<HTMLElement>('#painel-arquivos');
  const lista = elemento<HTMLUListElement>('#lista-arquivos');
  const limpar = elemento<HTMLButtonElement>('#limpar-arquivos');
  const botaoEnviar = elemento<HTMLButtonElement>('#botao-enviar-arquivos');
  const escolher = elemento<HTMLInputElement>('#escolher-arquivos');
  const soltar = elemento<HTMLElement>('#soltar-arquivos');

  const linhas = new Map<string, Linha>();
  let podeEnviar = false;

  botaoEnviar.addEventListener('click', () => escolher.click());
  escolher.addEventListener('change', () => {
    const arquivos = [...(escolher.files ?? [])];
    escolher.value = ''; // permite escolher o mesmo arquivo de novo
    if (arquivos.length > 0 && podeEnviar) opcoes.aoEnviar(arquivos);
  });
  limpar.addEventListener('click', () => opcoes.aoLimpar());

  // Arrastar e soltar em qualquer lugar da janela. Sem sessão liberada, o
  // soltar é só bloqueado (senão a janela tentaria abrir o arquivo).
  const temArquivos = (evento: DragEvent) => evento.dataTransfer?.types.includes('Files') ?? false;
  window.addEventListener('dragover', (evento) => {
    evento.preventDefault();
    if (evento.dataTransfer) evento.dataTransfer.dropEffect = podeEnviar && temArquivos(evento) ? 'copy' : 'none';
    soltar.hidden = !(podeEnviar && temArquivos(evento));
  });
  window.addEventListener('dragleave', (evento) => {
    if (evento.relatedTarget === null) soltar.hidden = true; // saiu da janela
  });
  window.addEventListener('drop', (evento) => {
    evento.preventDefault();
    soltar.hidden = true;
    const arquivos = [...(evento.dataTransfer?.files ?? [])];
    if (arquivos.length > 0 && podeEnviar) opcoes.aoEnviar(arquivos);
  });

  function criarLinha(item: Transferencia): Linha {
    const raiz = document.createElement('li');
    raiz.className = 'transferencia';
    const seta = document.createElement('span');
    seta.className = 'seta';
    seta.textContent = item.direcao === 'enviando' ? '↑' : '↓';
    seta.title = item.direcao === 'enviando' ? 'Enviando' : 'Recebendo';
    const info = document.createElement('div');
    info.className = 'info-transferencia';
    const nome = document.createElement('span');
    nome.className = 'nome-arquivo';
    const detalhe = document.createElement('span');
    detalhe.className = 'nota';
    const barra = document.createElement('progress');
    barra.max = 1;
    info.append(nome, detalhe, barra);
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'secundario pequeno';
    const linha: Linha = { raiz, nome, detalhe, barra, botao, item };
    // Um só botão, que muda de papel conforme o estado.
    botao.addEventListener('click', () => {
      if (linha.item.estado === 'concluido' && linha.item.token) opcoes.aoMostrar(linha.item.token);
      else opcoes.aoCancelar(linha.item.chave);
    });
    raiz.append(seta, info, botao);
    return linha;
  }

  function preencher(linha: Linha, item: Transferencia, agora: number): void {
    linha.item = item;
    linha.raiz.dataset['estado'] = item.estado;
    linha.nome.textContent = item.nome;
    linha.nome.title = item.nome;
    linha.detalhe.textContent = descreverTransferencia(item, agora);
    linha.barra.value = item.tamanho > 0 ? item.transferidos / item.tamanho : item.estado === 'concluido' ? 1 : 0;
    linha.barra.hidden = !(item.estado === 'transferindo' || item.estado === 'finalizando');
    const podeCancelar = item.estado === 'na_fila' || item.estado === 'transferindo';
    const podeMostrar = item.estado === 'concluido' && item.token !== undefined;
    linha.botao.hidden = !(podeCancelar || podeMostrar);
    linha.botao.textContent = podeMostrar ? 'Mostrar na pasta' : 'Cancelar';
  }

  return {
    atualizar(itens, pode) {
      podeEnviar = pode;
      botaoEnviar.hidden = !pode;
      if (!pode) soltar.hidden = true;

      const agora = Date.now();
      const chaves = new Set(itens.map((i) => i.chave));
      for (const [chave, linha] of linhas) {
        if (!chaves.has(chave)) {
          linha.raiz.remove();
          linhas.delete(chave);
        }
      }
      for (const item of itens) {
        let linha = linhas.get(item.chave);
        if (!linha) {
          linha = criarLinha(item);
          linhas.set(item.chave, linha);
          lista.append(linha.raiz);
        }
        preencher(linha, item, agora);
      }
      painel.hidden = itens.length === 0;
      limpar.hidden = !itens.some((i) => i.estado === 'concluido' || i.estado === 'cancelado' || i.estado === 'erro');
    },
  };
}
