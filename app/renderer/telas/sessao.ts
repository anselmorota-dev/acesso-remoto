// Painel de sessão (topo da janela) e caixa de aceite do anfitrião.
import { formatarId } from '../id';
import { caixaDeAceiteAberta, type EstadoSessao } from '../sessao';
import { elemento } from './util';

export interface TelaSessao {
  atualizar(estado: EstadoSessao): void;
  /** Mostra um aviso passageiro no painel da sessão (some sozinho). */
  avisar(texto: string): void;
}

/** Quanto tempo um aviso passageiro fica no painel. */
const DURACAO_AVISO_MS = 8000;

export interface OpcoesTelaSessao {
  /** Botão do painel: cancela o pedido ou encerra a sessão. */
  aoEncerrar: () => void;
  aoResponderPedido: (aceito: boolean) => void;
}

const TEXTO_CONEXAO = {
  conectando: 'estabelecendo conexão direta…',
  conectado: 'conectado (direto)',
  falhou: 'falhou',
  fechado: 'encerrada',
} as const;

/** "4:05" (minutos:segundos), para contagens regressivas. */
export function formatarDuracao(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function montarTelaSessao(opcoes: OpcoesTelaSessao): TelaSessao {
  const painel = elemento<HTMLElement>('#painel-sessao');
  const texto = elemento<HTMLParagraphElement>('#texto-sessao');
  const nota = elemento<HTMLParagraphElement>('#nota-sessao');
  let timerNota: ReturnType<typeof setTimeout> | undefined;
  const botao = elemento<HTMLButtonElement>('#botao-sessao');
  const dialogo = elemento<HTMLDialogElement>('#dialogo-pedido');
  const origem = elemento<HTMLElement>('#origem-pedido');
  const aceitar = elemento<HTMLButtonElement>('#aceitar-pedido');
  const recusar = elemento<HTMLButtonElement>('#recusar-pedido');
  const prazo = elemento<HTMLParagraphElement>('#prazo-pedido');

  let estado: EstadoSessao = { fase: 'livre' };
  /** Atualiza a contagem regressiva enquanto a caixa de aceite está aberta. */
  let relogio: ReturnType<typeof setInterval> | undefined;
  /** Atualiza a contagem enquanto a conexão direta está sendo refeita. */
  let relogioReconexao: ReturnType<typeof setInterval> | undefined;

  function mostrarPrazo(): void {
    if (estado.fase !== 'pedido_recebido') return;
    // Só informativo: quem cancela o pedido quando o prazo acaba é o servidor.
    const segundos = Math.max(0, Math.ceil((estado.expiraEm - Date.now()) / 1000));
    prazo.textContent = `Sem resposta, o pedido será recusado em ${segundos} s.`;
  }

  /** Texto do painel durante a sessão liberada. */
  function mostrarSessao(): void {
    if (estado.fase !== 'em_sessao' || !estado.liberada) return;
    const quem = estado.papel === 'anfitriao' ? 'acessado por' : 'acessando';
    const inicio = `Sessão ativa: ${quem} ${formatarId(estado.parceiro)}`;
    if (estado.reconectandoAte !== null) {
      // Só informativo: quem encerra quando o prazo acaba é o controlador.
      const restante = formatarDuracao(estado.reconectandoAte - Date.now());
      texto.textContent = `${inicio} — conexão perdida, reconectando… (se não voltar, a sessão encerra em ${restante})`;
      painel.dataset['conexao'] = 'reconectando';
      return;
    }
    const latencia = estado.latenciaMs === null ? '' : ` · latência ${estado.latenciaMs} ms`;
    texto.textContent = `${inicio} — ${TEXTO_CONEXAO[estado.conexao]}${latencia}`;
    painel.dataset['conexao'] = estado.conexao;
  }

  botao.addEventListener('click', () => {
    if (estado.fase === 'livre') painel.hidden = true; // "Fechar" só dispensa o aviso
    else opcoes.aoEncerrar();
  });
  aceitar.addEventListener('click', () => opcoes.aoResponderPedido(true));
  recusar.addEventListener('click', () => opcoes.aoResponderPedido(false));
  // Esc fecha a caixa: vale como recusa.
  dialogo.addEventListener('cancel', (evento) => {
    evento.preventDefault();
    opcoes.aoResponderPedido(false);
  });

  return {
    avisar(mensagem) {
      nota.textContent = mensagem;
      nota.hidden = false;
      clearTimeout(timerNota);
      timerNota = setTimeout(() => (nota.hidden = true), DURACAO_AVISO_MS);
    },
    atualizar(novoEstado) {
      estado = novoEstado;
      painel.dataset['fase'] = estado.fase;
      // Aviso passageiro é da sessão: some quando ela acaba.
      if (estado.fase !== 'em_sessao') nota.hidden = true;

      switch (estado.fase) {
        case 'livre':
          painel.hidden = !estado.aviso;
          texto.textContent = estado.aviso ?? '';
          botao.textContent = 'Fechar';
          break;
        case 'pedindo':
          painel.hidden = false;
          texto.textContent = estado.comSenha
            ? `Conectando a ${formatarId(estado.destino)} com senha…`
            : `Aguardando ${formatarId(estado.destino)} aceitar o acesso…`;
          botao.textContent = 'Cancelar';
          break;
        case 'pedido_recebido':
          // Com a caixa de aceite aberta o painel fica escondido; no pedido com
          // senha (sem caixa), ele mostra o que está acontecendo.
          painel.hidden = !estado.verificandoSenha;
          texto.textContent = `Pedido de acesso com senha de ${formatarId(estado.origem)}…`;
          botao.textContent = 'Recusar';
          break;
        case 'em_sessao': {
          painel.hidden = false;
          botao.textContent = 'Encerrar';
          if (!estado.liberada) {
            // Sessão por senha, antes de a senha conferir: nada de tela nem controle.
            texto.textContent =
              estado.papel === 'anfitriao'
                ? `Pedido de acesso com senha de ${formatarId(estado.parceiro)}: conferindo a senha…`
                : `Conferindo a senha com ${formatarId(estado.parceiro)}…`;
            break;
          }
          mostrarSessao();
          break;
        }
      }

      if (estado.fase === 'em_sessao' && estado.reconectandoAte !== null) {
        relogioReconexao ??= setInterval(mostrarSessao, 1000);
      } else {
        clearInterval(relogioReconexao);
        relogioReconexao = undefined;
      }

      // Caixa de aceite: aberta só enquanto há pedido para alguém responder
      // (o pedido com senha é tratado sozinho, sem caixa).
      if (estado.fase === 'pedido_recebido' && caixaDeAceiteAberta(estado)) {
        origem.textContent = formatarId(estado.origem);
        aceitar.disabled = recusar.disabled = estado.respondendo;
        mostrarPrazo();
        relogio ??= setInterval(mostrarPrazo, 250);
        if (!dialogo.open) dialogo.showModal();
      } else {
        clearInterval(relogio);
        relogio = undefined;
        if (dialogo.open) dialogo.close();
      }
    },
  };
}
