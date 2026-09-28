// Área de transferência compartilhada: monta a mensagem do canal com o texto
// copiado, se couber. O limite do WebRTC é em bytes, e o texto em UTF-8 pode
// ocupar até 3 bytes por caractere (acentos, símbolos) ou mais, com escapes.
import { TAMANHO_MAXIMO_MENSAGEM_CANAL, type MensagemCanal } from '@acesso-remoto/shared';

const codificador = new TextEncoder();

/**
 * Mensagem pronta para o canal, ou null se o texto não couber numa mensagem
 * ("limiteBytes": o menor entre o que o outro lado aceita e o que a conexão
 * negociou).
 */
export function serializarAreaTransferencia(texto: string, limiteBytes = TAMANHO_MAXIMO_MENSAGEM_CANAL): string | null {
  const mensagem = JSON.stringify({ tipo: 'area_transferencia', texto } satisfies MensagemCanal);
  // Quem recebe também confere o tamanho (em unidades de texto) antes de ler.
  if (mensagem.length > TAMANHO_MAXIMO_MENSAGEM_CANAL) return null;
  return codificador.encode(mensagem).length <= limiteBytes ? mensagem : null;
}
