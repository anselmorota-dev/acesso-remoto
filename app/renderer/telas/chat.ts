// Chat na interface: botão "Chat" no painel da sessão (com as não lidas) e o
// painel com as mensagens e o campo de texto. Enter envia, Shift+Enter quebra
// a linha, Esc sai do campo (o teclado volta para a tela remota).
// As mensagens são mostradas como texto (textContent), nunca como HTML.
import type { ConversaChat } from '../chat';
import { elemento } from './util';

export interface TelaChat {
  /** Redesenha a partir da conversa; "disponivel": há sessão liberada. */
  atualizar(conversa: ConversaChat, disponivel: boolean): void;
  /** Abre o painel e põe o cursor no campo (ex.: clicou na notificação). */
  abrir(): void;
  /** O usuário está vendo o chat agora (aberto e com a janela em foco)? */
  readonly visivel: boolean;
}

export interface OpcoesTelaChat {
  /** Enviar o texto digitado; devolve false se não foi (o texto fica no campo). */
  aoEnviar: (texto: string) => boolean;
  /** O painel abriu ou a janela voltou ao foco com ele aberto: as mensagens foram vistas. */
  aoVer: () => void;
}

const hora = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function montarTelaChat(opcoes: OpcoesTelaChat): TelaChat {
  const botao = elemento<HTMLButtonElement>('#botao-chat');
  const painel = elemento<HTMLElement>('#painel-chat');
  const lista = elemento<HTMLOListElement>('#mensagens-chat');
  const campo = elemento<HTMLTextAreaElement>('#texto-chat');
  const enviar = elemento<HTMLButtonElement>('#enviar-chat');
  const fechar = elemento<HTMLButtonElement>('#fechar-chat');

  let aberto = false;
  let disponivel = false;
  /** Até onde a conversa já está na tela ("total" e "geracao" da ConversaChat). */
  let desenhadas = 0;
  let geracaoDesenhada = 0;

  const visivel = () => aberto && disponivel && document.hasFocus();

  function mostrar(abrir: boolean): void {
    aberto = abrir;
    painel.hidden = !(aberto && disponivel);
    botao.setAttribute('aria-expanded', String(aberto));
    if (aberto) {
      campo.focus();
      lista.scrollTop = lista.scrollHeight;
      opcoes.aoVer();
    }
  }

  function tentarEnviar(): void {
    if (opcoes.aoEnviar(campo.value)) campo.value = '';
    campo.focus();
  }

  botao.addEventListener('click', () => mostrar(!aberto));
  fechar.addEventListener('click', () => mostrar(false));
  enviar.addEventListener('click', tentarEnviar);
  campo.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      tentarEnviar();
    } else if (evento.key === 'Escape') {
      evento.preventDefault();
      campo.blur(); // o teclado volta para a tela remota
    }
  });
  // Voltou para a janela com o chat aberto: o que chegou foi visto.
  window.addEventListener('focus', () => {
    if (visivel()) opcoes.aoVer();
  });

  return {
    get visivel() {
      return visivel();
    },
    abrir: () => mostrar(true),
    atualizar(conversa, pode) {
      disponivel = pode;
      botao.hidden = !pode;
      painel.hidden = !(aberto && pode);
      botao.textContent = conversa.naoLidas > 0 ? `Chat (${conversa.naoLidas})` : 'Chat';
      botao.classList.toggle('com-novidade', conversa.naoLidas > 0);

      const mensagens = conversa.mensagens;
      const noFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
      // "total" só cresce durante a conversa: a diferença diz quantas são novas.
      let novas = conversa.total - desenhadas;
      if (conversa.geracao !== geracaoDesenhada || novas < 0 || novas > mensagens.length) {
        // Conversa limpa (nova sessão) ou muitas de uma vez: redesenha tudo.
        lista.replaceChildren();
        novas = mensagens.length;
      }
      for (const mensagem of mensagens.slice(mensagens.length - novas)) {
        const item = document.createElement('li');
        item.className = `mensagem-chat de-${mensagem.de}`;
        const texto = document.createElement('p');
        texto.textContent = mensagem.texto; // texto puro, nunca HTML
        const quando = document.createElement('span');
        quando.className = 'nota';
        quando.textContent = `${mensagem.de === 'eu' ? 'Você' : 'Outro computador'} · ${hora(mensagem.em)}`;
        item.append(texto, quando);
        lista.append(item);
      }
      // Na tela, no máximo as mesmas que a conversa guarda.
      while (lista.children.length > mensagens.length) lista.firstElementChild?.remove();
      desenhadas = conversa.total;
      geracaoDesenhada = conversa.geracao;
      // Acompanha as mensagens novas, a não ser que o usuário tenha rolado para cima.
      if (noFim) lista.scrollTop = lista.scrollHeight;
    },
  };
}
