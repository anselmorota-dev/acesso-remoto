// Cartão "Computadores salvos": um clique conecta (com a senha salva, se
// houver); "Editar" abre a caixa para renomear, trocar ou esquecer a senha,
// ou remover. A tela nunca recebe as senhas: só se cada um tem senha.
import { problemaNaSenha, SENHA_MAXIMA, SENHA_MINIMA } from '@acesso-remoto/shared';
import type { ComputadorSalvo, ResultadoSalvar } from '../../preload/api';
import { formatarId } from '../id';
import { elemento } from './util';

export interface TelaSalvos {
  /** "podeConectar": online e sem pedido/sessão em andamento. */
  atualizar(lista: readonly ComputadorSalvo[], podeConectar: boolean): void;
}

export interface OpcoesTelaSalvos {
  aoConectar: (computador: ComputadorSalvo) => void;
  /** senha: texto = trocar; null = esquecer; undefined = manter. */
  aoEditar: (id: string, apelido: string, senha: string | null | undefined) => Promise<ResultadoSalvar>;
  aoRemover: (id: string) => Promise<void>;
}

const TEXTO_ERRO_SALVAR: Record<Exclude<ResultadoSalvar, { ok: true }>['erro'], string> = {
  id_invalido: 'ID inválido.',
  senha_invalida: 'Senha inválida.',
  cifra_indisponivel: 'Não foi possível proteger a senha neste computador; ela não foi salva.',
  lista_cheia: 'Limite de computadores salvos atingido.',
};

export function montarTelaSalvos(opcoes: OpcoesTelaSalvos): TelaSalvos {
  const cartao = elemento<HTMLElement>('#cartao-salvos');
  const lista = elemento<HTMLUListElement>('#lista-salvos');
  const dialogo = elemento<HTMLDialogElement>('#dialogo-salvo');
  const form = elemento<HTMLFormElement>('#form-salvo');
  const titulo = elemento<HTMLElement>('#id-salvo');
  const campoApelido = elemento<HTMLInputElement>('#apelido-salvo');
  const campoSenha = elemento<HTMLInputElement>('#senha-salva');
  const grupoEsquecer = elemento<HTMLElement>('#grupo-esquecer-senha');
  const caixaEsquecer = elemento<HTMLInputElement>('#esquecer-senha');
  const erro = elemento<HTMLParagraphElement>('#erro-salvo');
  const botaoRemover = elemento<HTMLButtonElement>('#remover-salvo');
  const botaoCancelar = elemento<HTMLButtonElement>('#cancelar-salvo');

  let itens: readonly ComputadorSalvo[] = [];
  let editando: ComputadorSalvo | null = null;

  // Um ouvinte só para a lista: "Conectar" (o item) ou "Editar".
  lista.addEventListener('click', (evento) => {
    const alvo = (evento.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    const item = itens.find((i) => i.id === alvo?.dataset['id']);
    if (!alvo || !item) return;
    if (alvo.dataset['acao'] === 'editar') abrirEdicao(item);
    else opcoes.aoConectar(item);
  });

  function abrirEdicao(item: ComputadorSalvo): void {
    editando = item;
    titulo.textContent = formatarId(item.id);
    campoApelido.value = item.apelido;
    campoSenha.value = '';
    campoSenha.placeholder = item.temSenha ? 'Deixe em branco para manter a salva' : 'Opcional';
    caixaEsquecer.checked = false;
    grupoEsquecer.hidden = !item.temSenha;
    erro.textContent = '';
    dialogo.showModal();
  }

  function fecharEdicao(): void {
    campoSenha.value = ''; // a senha não fica na página
    editando = null;
    dialogo.close();
  }

  caixaEsquecer.addEventListener('change', () => {
    campoSenha.disabled = caixaEsquecer.checked;
    if (caixaEsquecer.checked) campoSenha.value = '';
  });

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!editando) return;
    const nova = campoSenha.value;
    if (nova && problemaNaSenha(nova)) {
      erro.textContent = `A senha precisa ter de ${SENHA_MINIMA} a ${SENHA_MAXIMA} caracteres.`;
      return;
    }
    const senha = caixaEsquecer.checked ? null : nova ? nova : undefined;
    const resultado = await opcoes.aoEditar(editando.id, campoApelido.value, senha);
    if (resultado.ok) fecharEdicao();
    else erro.textContent = TEXTO_ERRO_SALVAR[resultado.erro];
  });

  botaoRemover.addEventListener('click', async () => {
    if (!editando) return;
    await opcoes.aoRemover(editando.id);
    fecharEdicao();
  });
  botaoCancelar.addEventListener('click', fecharEdicao);
  dialogo.addEventListener('cancel', () => {
    campoSenha.value = '';
    editando = null;
  });

  return {
    atualizar(novos, podeConectar) {
      itens = novos;
      cartao.hidden = novos.length === 0;
      lista.replaceChildren(
        ...novos.map((item) => {
          const li = document.createElement('li');
          li.className = 'salvo';
          const conectar = document.createElement('button');
          conectar.type = 'button';
          conectar.className = 'secundario conectar-salvo';
          conectar.dataset['id'] = item.id;
          conectar.disabled = !podeConectar;
          const nome = document.createElement('span');
          nome.className = 'nome-salvo';
          nome.textContent = item.apelido || formatarId(item.id);
          const detalhe = document.createElement('span');
          detalhe.className = 'nota';
          detalhe.textContent = `${formatarId(item.id)}${item.temSenha ? ' · com senha' : ' · pede aceite'}`;
          conectar.append(nome, detalhe);
          conectar.title = item.temSenha ? 'Conectar com a senha salva' : 'Pedir acesso (o outro computador precisa aceitar)';
          const editar = document.createElement('button');
          editar.type = 'button';
          editar.className = 'secundario pequeno';
          editar.dataset['id'] = item.id;
          editar.dataset['acao'] = 'editar';
          editar.textContent = 'Editar';
          editar.setAttribute('aria-label', `Editar ${item.apelido || formatarId(item.id)}`);
          li.append(conectar, editar);
          return li;
        }),
      );
    },
  };
}
