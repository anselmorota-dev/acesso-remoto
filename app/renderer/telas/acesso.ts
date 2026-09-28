// Cartão "Acesso não supervisionado" e a caixa da senha (definir, alterar,
// remover). Quem valida de verdade e guarda o hash é o main (cofre-senha.ts);
// aqui a validação só antecipa os erros comuns para o usuário.
import { SENHA_MAXIMA, SENHA_MINIMA, problemaNaSenha } from '@acesso-remoto/shared';
import type { ApiDoPreload, ErroSenha, ResultadoSenha } from '../../preload/api';
import type { EstadoSessao } from '../sessao';
import { elemento } from './util';

export interface TelaAcesso {
  atualizar(sessao: EstadoSessao): void;
}

type Modo = 'definir' | 'alterar' | 'remover';

const TITULOS: Record<Modo, string> = {
  definir: 'Definir senha',
  alterar: 'Alterar senha',
  remover: 'Remover senha',
};

const SUCESSO: Record<Modo, string> = {
  definir: 'Senha definida.',
  alterar: 'Senha alterada.',
  remover: 'Senha removida: acesso não supervisionado desativado.',
};

const MENSAGENS_ERRO: Record<ErroSenha, string> = {
  curta: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`,
  longa: `A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`,
  senha_atual_incorreta: 'Senha atual incorreta.',
  sessao_ativa: 'Não é possível mudar a senha durante uma sessão.',
};

export interface OpcoesTelaAcesso {
  senha: ApiDoPreload['senha'];
  inicioAutomatico: ApiDoPreload['inicioAutomatico'];
}

export function montarTelaAcesso(opcoes: OpcoesTelaAcesso): TelaAcesso {
  const api = opcoes.senha;
  montarInicioAutomatico(opcoes.inicioAutomatico);
  const status = elemento<HTMLParagraphElement>('#status-senha');
  const botaoDefinir = elemento<HTMLButtonElement>('#definir-senha');
  const botaoRemover = elemento<HTMLButtonElement>('#remover-senha');
  const aviso = elemento<HTMLParagraphElement>('#aviso-senha');

  const dialogo = elemento<HTMLDialogElement>('#dialogo-senha');
  const form = elemento<HTMLFormElement>('#form-senha');
  const titulo = elemento<HTMLHeadingElement>('#titulo-senha');
  const grupoAtual = elemento<HTMLLabelElement>('#grupo-senha-atual');
  const grupoNova = elemento<HTMLLabelElement>('#grupo-senha-nova');
  const grupoConfirmacao = elemento<HTMLLabelElement>('#grupo-senha-confirmacao');
  const campoAtual = elemento<HTMLInputElement>('#senha-atual');
  const campoNova = elemento<HTMLInputElement>('#senha-nova');
  const campoConfirmacao = elemento<HTMLInputElement>('#senha-confirmacao');
  const dica = elemento<HTMLParagraphElement>('#dica-senha');
  const erro = elemento<HTMLParagraphElement>('#erro-senha');
  const botaoCancelar = elemento<HTMLButtonElement>('#cancelar-senha');
  const botaoSalvar = elemento<HTMLButtonElement>('#salvar-senha');

  let definida = false;
  let emSessao = false;
  let modo: Modo = 'definir';
  let salvando = false;
  let ultimoAviso = '';

  function desenhar(): void {
    status.dataset['definida'] = String(definida);
    status.textContent = definida ? 'Ativado: senha definida.' : 'Desativado: nenhuma senha definida.';
    botaoDefinir.textContent = definida ? 'Alterar senha' : 'Definir senha';
    botaoRemover.hidden = !definida;
    // Durante qualquer pedido ou sessão, nada muda (o main também bloqueia).
    botaoDefinir.disabled = botaoRemover.disabled = emSessao;
    aviso.textContent = emSessao ? 'Indisponível durante uma sessão.' : ultimoAviso;
  }

  /** Apaga as senhas digitadas: não ficam na página depois de usadas. */
  function limparCampos(): void {
    campoAtual.value = campoNova.value = campoConfirmacao.value = '';
    erro.textContent = '';
  }

  function abrir(novoModo: Modo): void {
    modo = novoModo;
    limparCampos();
    titulo.textContent = TITULOS[modo];
    grupoAtual.hidden = modo === 'definir';
    grupoNova.hidden = grupoConfirmacao.hidden = dica.hidden = modo === 'remover';
    botaoSalvar.textContent = modo === 'remover' ? 'Remover' : 'Salvar';
    dialogo.showModal();
    (modo === 'definir' ? campoNova : campoAtual).focus();
  }

  /** Erros que dá para apontar sem falar com o main. */
  function problemaLocal(): string | null {
    if (modo !== 'definir' && campoAtual.value === '') return 'Digite a senha atual.';
    if (modo === 'remover') return null;
    const problema = problemaNaSenha(campoNova.value);
    if (problema) return MENSAGENS_ERRO[problema];
    if (campoNova.value !== campoConfirmacao.value) return 'As senhas não conferem.';
    return null;
  }

  botaoDefinir.addEventListener('click', () => abrir(definida ? 'alterar' : 'definir'));
  botaoRemover.addEventListener('click', () => abrir('remover'));
  botaoCancelar.addEventListener('click', () => dialogo.close());
  // Fechar por qualquer caminho (Cancelar, Esc, fim abrupto) limpa os campos.
  dialogo.addEventListener('close', limparCampos);

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    if (salvando) return;
    const problema = problemaLocal();
    if (problema) {
      erro.textContent = problema;
      return;
    }
    void salvar();
  });

  async function salvar(): Promise<void> {
    salvando = true;
    botaoSalvar.disabled = true;
    const textoBotao = botaoSalvar.textContent;
    botaoSalvar.textContent = modo === 'remover' ? 'Removendo…' : 'Salvando…';
    let resultado: ResultadoSenha | null = null;
    try {
      resultado =
        modo === 'remover'
          ? await api.remover(campoAtual.value)
          : await api.definir(campoNova.value, modo === 'alterar' ? campoAtual.value : null);
    } catch (falha) {
      console.error('[acesso] falha ao salvar a senha:', falha);
    } finally {
      salvando = false;
      botaoSalvar.disabled = false;
      botaoSalvar.textContent = textoBotao;
    }

    if (!resultado) {
      erro.textContent = 'Não foi possível salvar. Tente de novo.';
    } else if (!resultado.ok) {
      erro.textContent = MENSAGENS_ERRO[resultado.erro];
      if (resultado.erro === 'senha_atual_incorreta') campoAtual.select();
    } else {
      definida = modo !== 'remover';
      ultimoAviso = SUCESSO[modo];
      dialogo.close();
      desenhar();
    }
  }

  api
    .estado()
    .then((estado) => {
      definida = estado.definida;
      desenhar();
    })
    .catch((falha: unknown) => console.error('[acesso] não foi possível ler o estado da senha:', falha));

  return {
    atualizar(sessao) {
      emSessao = sessao.fase !== 'livre';
      // Um pedido chegando fecha a caixa: o aceite tem prioridade.
      if (emSessao && dialogo.open) dialogo.close();
      desenhar();
    },
  };
}

/** Caixa "Iniciar junto com o computador": o main grava a opção no sistema. */
function montarInicioAutomatico(api: ApiDoPreload['inicioAutomatico']): void {
  const caixa = elemento<HTMLInputElement>('#iniciar-com-sistema');
  caixa.disabled = true; // até saber o valor atual

  const mostrar = (ligado: boolean) => {
    caixa.checked = ligado;
    caixa.disabled = false;
  };
  api.ligado().then(mostrar, (falha: unknown) => console.error('[acesso] não foi possível ler o início automático:', falha));
  // Mudou pelo menu da bandeja: acompanha.
  api.aoMudar(mostrar);

  caixa.addEventListener('change', () => {
    const pedido = caixa.checked;
    caixa.disabled = true;
    api.definir(pedido).then(mostrar, (falha: unknown) => {
      console.error('[acesso] não foi possível mudar o início automático:', falha);
      mostrar(!pedido);
    });
  });
}
