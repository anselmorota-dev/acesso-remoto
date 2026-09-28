// Código compartilhado entre o servidor de sinalização e o app.
// Aqui ficarão os tipos das mensagens (registro, oferta/resposta, ICE, input...).
// Por enquanto só existe a versão do protocolo, usada para testar que os
// dois lados conseguem importar este pacote.

/** Versão do protocolo de mensagens. Aumentar quando o formato mudar. */
export const PROTOCOL_VERSION = 1;
