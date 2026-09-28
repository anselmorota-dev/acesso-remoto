// Código compartilhado entre o servidor de sinalização e o app.

/** Versão do protocolo de mensagens. Aumentar quando o formato mudar. */
export const PROTOCOL_VERSION = 3;

export * from './mensagens.js';
export * from './canal.js';
export * from './senha.js';
