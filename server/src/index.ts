// Ponto de entrada do servidor de sinalização.
// Na etapa 1.2 este arquivo vai abrir o servidor WebSocket e distribuir IDs.
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';

const PORT = Number(process.env.PORT ?? 8080);

console.log(`[server] iniciado (protocolo v${PROTOCOL_VERSION}), porta configurada: ${PORT}`);
