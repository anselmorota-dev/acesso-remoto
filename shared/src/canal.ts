// Mensagens trocadas diretamente entre os dois apps pelo DataChannel do
// WebRTC (sem passar pelo servidor): o ping que mede a latência e os
// eventos de input que o visualizador envia ao anfitrião.
import { z } from 'zod';

/** Maior mensagem aceita pelo canal, checada antes do JSON.parse. */
export const TAMANHO_MAXIMO_MENSAGEM_CANAL = 16 * 1024;

// ---------------------------------------------------------------------------
// Eventos de input (visualizador → anfitrião)
// ---------------------------------------------------------------------------

/** Posição na tela remota normalizada: 0 = borda esquerda/superior, 1 = direita/inferior. */
const coordenada = z.number().min(0).max(1);

/** Maior rolagem aceita num único evento, em pixels (vários "cliques" da roda). */
export const ROLAGEM_MAXIMA = 2000;
const rolagem = z.number().int().min(-ROLAGEM_MAXIMA).max(ROLAGEM_MAXIMA);

export const esquemaBotaoMouse = z.enum(['esquerdo', 'meio', 'direito']);
export type BotaoMouse = z.infer<typeof esquemaBotaoMouse>;

const esquemasInput = [
  /** Move o cursor para a posição. */
  z.object({ tipo: z.literal('mouse_mover'), x: coordenada, y: coordenada }),
  /**
   * Aperta ou solta um botão. Leva a posição junto para o clique cair no
   * lugar certo mesmo que o último "mover" ainda não tenha sido enviado.
   */
  z.object({
    tipo: z.literal('mouse_botao'),
    botao: esquemaBotaoMouse,
    pressionado: z.boolean(),
    x: coordenada,
    y: coordenada,
  }),
  /** Rola a roda do mouse, em pixels, como no navegador (dy > 0 = descer, dx > 0 = direita). */
  z.object({ tipo: z.literal('mouse_rolar'), dx: rolagem, dy: rolagem }),
] as const;

/** Eventos de input: chegam pelo canal e são repassados do renderer ao main. */
export const esquemaEventoInput = z.discriminatedUnion('tipo', [...esquemasInput]);
export type EventoInput = z.infer<typeof esquemaEventoInput>;

// ---------------------------------------------------------------------------
// Todas as mensagens do canal
// ---------------------------------------------------------------------------

export const esquemaMensagemCanal = z.discriminatedUnion('tipo', [
  /** Pedido de eco; "t" é o horário de envio (relógio de quem enviou). */
  z.object({ tipo: z.literal('ping'), t: z.number().finite() }),
  /** Eco do ping, devolvendo o mesmo "t" para calcular o tempo de ida e volta. */
  z.object({ tipo: z.literal('pong'), t: z.number().finite() }),
  ...esquemasInput,
]);
export type MensagemCanal = z.infer<typeof esquemaMensagemCanal>;
