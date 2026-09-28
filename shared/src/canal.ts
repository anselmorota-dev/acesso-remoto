// Mensagens trocadas diretamente entre os dois apps pelo DataChannel do
// WebRTC (sem passar pelo servidor). Na fase 2 entram aqui os eventos de
// mouse e teclado; por enquanto só o ping que mede a latência.
import { z } from 'zod';

/** Maior mensagem aceita pelo canal, checada antes do JSON.parse. */
export const TAMANHO_MAXIMO_MENSAGEM_CANAL = 16 * 1024;

export const esquemaMensagemCanal = z.discriminatedUnion('tipo', [
  /** Pedido de eco; "t" é o horário de envio (relógio de quem enviou). */
  z.object({ tipo: z.literal('ping'), t: z.number().finite() }),
  /** Eco do ping, devolvendo o mesmo "t" para calcular o tempo de ida e volta. */
  z.object({ tipo: z.literal('pong'), t: z.number().finite() }),
]);
export type MensagemCanal = z.infer<typeof esquemaMensagemCanal>;
