// Tela inicial: mostra o ID deste computador e o campo para acessar outro.
// Padrão das telas: a função "montar" liga os eventos uma única vez e
// devolve "atualizar", que redesenha a tela a partir do estado atual.
import type { IdCliente } from '@acesso-remoto/shared';
import { ehIdValido, extrairDigitos, formatarId } from '../id';
import type { EstadoSessao } from '../sessao';
import type { EstadoSinalizacao } from '../sinalizacao';
import { elemento } from './util';

export interface TelaInicio {
  atualizar(estado: EstadoSinalizacao, sessao: EstadoSessao): void;
  /** Mostra um aviso abaixo do formulário (ex.: senha salva que não decifrou). */
  avisar(texto: string): void;
}

export interface OpcoesTelaInicio {
  /**
   * Chamado quando o usuário pede para acessar outro ID (já validado). Com
   * senha, é acesso não supervisionado; sem, o outro lado precisa aceitar.
   */
  aoConectar: (idRemoto: IdCliente, senha: string | undefined, salvar: { apelido: string } | null) => void;
}

export function montarTelaInicio(opcoes: OpcoesTelaInicio): TelaInicio {
  const meuId = elemento<HTMLOutputElement>('#meu-id');
  const botaoCopiar = elemento<HTMLButtonElement>('#copiar-id');
  const status = elemento<HTMLParagraphElement>('#status-conexao');
  const form = elemento<HTMLFormElement>('#form-conectar');
  const campoRemoto = elemento<HTMLInputElement>('#id-remoto');
  const campoSenha = elemento<HTMLInputElement>('#senha-remota');
  const botaoConectar = elemento<HTMLButtonElement>('#botao-conectar');
  const aviso = elemento<HTMLParagraphElement>('#aviso-conectar');
  const caixaSalvar = elemento<HTMLInputElement>('#salvar-computador');
  const grupoApelido = elemento<HTMLElement>('#grupo-apelido');
  const campoApelido = elemento<HTMLInputElement>('#apelido-computador');
  /** Aviso vindo de fora (fica até o próximo aviso do formulário). */
  let avisoExterno = '';

  let estado: EstadoSinalizacao = { fase: 'conectando' };
  let sessao: EstadoSessao = { fase: 'livre' };

  /** Liga/desliga o botão Conectar e explica o motivo quando desligado. */
  function atualizarFormulario(): void {
    const digitos = extrairDigitos(campoRemoto.value);
    const online = estado.fase === 'online';
    const proprioId = estado.fase === 'online' && digitos === estado.id;
    const livre = sessao.fase === 'livre';

    botaoConectar.disabled = !online || !livre || !ehIdValido(digitos) || proprioId;
    if (avisoExterno) {
      aviso.textContent = avisoExterno;
    } else if (proprioId) {
      aviso.textContent = 'Esse é o ID deste computador.';
    } else if (digitos.length === 9 && !ehIdValido(digitos)) {
      aviso.textContent = 'ID inválido: não pode começar com 0.';
    } else {
      aviso.textContent = '';
    }
  }

  // Salvar este computador: o apelido só aparece com a caixa marcada.
  caixaSalvar.addEventListener('change', () => {
    grupoApelido.hidden = !caixaSalvar.checked;
  });

  // Formata enquanto digita/cola: mantém só dígitos, agrupados de 3 em 3.
  campoRemoto.addEventListener('input', () => {
    avisoExterno = '';
    campoRemoto.value = formatarId(extrairDigitos(campoRemoto.value));
    atualizarFormulario();
  });

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const digitos = extrairDigitos(campoRemoto.value);
    if (botaoConectar.disabled || !ehIdValido(digitos)) return;
    const senha = campoSenha.value;
    // A senha não fica na página depois de usada.
    campoSenha.value = '';
    const salvar = caixaSalvar.checked ? { apelido: campoApelido.value } : null;
    caixaSalvar.checked = false;
    campoApelido.value = '';
    grupoApelido.hidden = true;
    avisoExterno = '';
    opcoes.aoConectar(digitos, senha || undefined, salvar);
  });

  botaoCopiar.addEventListener('click', async () => {
    if (estado.fase !== 'online') return;
    try {
      await navigator.clipboard.writeText(estado.id);
      botaoCopiar.textContent = 'Copiado!';
      setTimeout(() => (botaoCopiar.textContent = 'Copiar'), 1500);
    } catch {
      botaoCopiar.textContent = 'Falhou';
    }
  });

  return {
    avisar(texto) {
      avisoExterno = texto;
      atualizarFormulario();
    },
    atualizar(novoEstado, novaSessao) {
      estado = novoEstado;
      sessao = novaSessao;
      status.dataset['fase'] = estado.fase;

      if (estado.fase === 'online') {
        meuId.value = formatarId(estado.id);
        botaoCopiar.disabled = false;
      } else {
        meuId.value = '— — —';
        botaoCopiar.disabled = true;
      }

      switch (estado.fase) {
        case 'conectando':
          status.textContent = 'Conectando ao servidor…';
          break;
        case 'online':
          status.textContent = 'Pronto para receber conexões';
          break;
        case 'offline':
          status.textContent = `Sem conexão com o servidor. Tentando de novo em ${Math.round(estado.proximaTentativaMs / 1000)} s…`;
          break;
        case 'incompativel':
          status.textContent = `Versão do app incompatível com o servidor. Atualize o app. (${estado.mensagem})`;
          break;
        case 'substituida':
          status.textContent =
            'Este computador se conectou de novo em outro lugar (o app foi copiado para outra máquina?). Reabra o app para reconectar.';
          break;
      }

      atualizarFormulario();
    },
  };
}
