// Tela inicial: mostra o ID deste computador e o campo para acessar outro.
// Padrão das telas: a função "montar" liga os eventos uma única vez e
// devolve "atualizar", que redesenha a tela a partir do estado atual.
import type { IdCliente } from '@acesso-remoto/shared';
import { ehIdValido, extrairDigitos, formatarId } from '../id';
import type { EstadoSinalizacao } from '../sinalizacao';

export interface TelaInicio {
  atualizar(estado: EstadoSinalizacao): void;
}

export interface OpcoesTelaInicio {
  /** Chamado quando o usuário pede para acessar outro ID (já validado). */
  aoConectar: (idRemoto: IdCliente) => void;
}

function elemento<T extends HTMLElement>(seletor: string): T {
  const encontrado = document.querySelector<T>(seletor);
  if (!encontrado) throw new Error(`Elemento ${seletor} não encontrado`);
  return encontrado;
}

export function montarTelaInicio(opcoes: OpcoesTelaInicio): TelaInicio {
  const meuId = elemento<HTMLOutputElement>('#meu-id');
  const botaoCopiar = elemento<HTMLButtonElement>('#copiar-id');
  const status = elemento<HTMLParagraphElement>('#status-conexao');
  const form = elemento<HTMLFormElement>('#form-conectar');
  const campoRemoto = elemento<HTMLInputElement>('#id-remoto');
  const botaoConectar = elemento<HTMLButtonElement>('#botao-conectar');
  const aviso = elemento<HTMLParagraphElement>('#aviso-conectar');

  let estado: EstadoSinalizacao = { fase: 'conectando' };

  /** Liga/desliga o botão Conectar e explica o motivo quando desligado. */
  function atualizarFormulario(): void {
    const digitos = extrairDigitos(campoRemoto.value);
    const online = estado.fase === 'online';
    const proprioId = estado.fase === 'online' && digitos === estado.id;

    botaoConectar.disabled = !online || !ehIdValido(digitos) || proprioId;
    if (proprioId) {
      aviso.textContent = 'Esse é o ID deste computador.';
    } else if (digitos.length === 9 && !ehIdValido(digitos)) {
      aviso.textContent = 'ID inválido: não pode começar com 0.';
    } else {
      aviso.textContent = '';
    }
  }

  // Formata enquanto digita/cola: mantém só dígitos, agrupados de 3 em 3.
  campoRemoto.addEventListener('input', () => {
    campoRemoto.value = formatarId(extrairDigitos(campoRemoto.value));
    atualizarFormulario();
  });

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const digitos = extrairDigitos(campoRemoto.value);
    if (botaoConectar.disabled || !ehIdValido(digitos)) return;
    opcoes.aoConectar(digitos);
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
    atualizar(novoEstado) {
      estado = novoEstado;
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
      }

      atualizarFormulario();
    },
  };
}
