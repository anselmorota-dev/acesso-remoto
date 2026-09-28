// Código compartilhado entre o servidor de sinalização e o app.

/** Versão do protocolo de mensagens. Aumentar quando o formato mudar. */
export const PROTOCOL_VERSION = 1;

export * from './mensagens.js';
export * from './canal.js';
