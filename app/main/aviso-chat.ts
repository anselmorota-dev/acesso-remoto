// Textos do aviso de mensagem nova no chat (puro, testado).

/** Maior trecho da mensagem mostrado na notificação. */
const RESUMO_MAXIMO = 120;

/** "123 456 789" (como na tela do app). */
export function formatarIdAviso(id: string): string {
  return id.replace(/(\d{3})(?=\d)/g, '$1 ');
}

/** Começo da mensagem numa linha só, para caber na notificação. */
export function resumoMensagem(texto: string): string {
  const linha = texto.replace(/\s+/g, ' ').trim();
  return linha.length > RESUMO_MAXIMO ? `${linha.slice(0, RESUMO_MAXIMO - 1)}…` : linha;
}

/**
 * Evita uma chuva de notificações: no máximo uma a cada "intervaloMs"
 * (as mensagens continuam chegando ao chat; só o aviso é poupado).
 */
export function criarLimiteDeAvisos(intervaloMs: number, agora: () => number = Date.now): () => boolean {
  let ultimo = -Infinity;
  return () => {
    const instante = agora();
    if (instante - ultimo < intervaloMs) return false;
    ultimo = instante;
    return true;
  };
}
