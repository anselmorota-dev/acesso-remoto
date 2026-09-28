// Ponto de entrada do servidor de sinalização.
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { iniciarServidor } from './servidor.js';

// O Render informa a porta pela variável PORT.
const porta = Number(process.env.PORT ?? 8080);

const servidor = await iniciarServidor({ porta });
console.log(`[server] escutando na porta ${servidor.porta} (protocolo v${PROTOCOL_VERSION})`);

// Encerramento limpo ao receber Ctrl+C ou o sinal de parada do Render.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    console.log(`[server] ${sinal} recebido, encerrando...`);
    void servidor.fechar().then(() => process.exit(0));
  });
}
