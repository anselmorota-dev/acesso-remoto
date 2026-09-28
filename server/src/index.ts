// Ponto de entrada do servidor de sinalização.
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { InstalacoesEmMemoria, type RepositorioInstalacoes } from './instalacoes.js';
import { InstalacoesPostgres } from './instalacoes-postgres.js';
import { iniciarServidor } from './servidor.js';

// O Render informa a porta pela variável PORT.
const porta = Number(process.env.PORT ?? 8080);

// Em produção, DATABASE_URL aponta para o Postgres (Neon) e os IDs fixos
// sobrevivem a reinícios. Sem ela (desenvolvimento), ficam só na memória.
const urlBanco = process.env.DATABASE_URL;
let instalacoes: RepositorioInstalacoes;
if (urlBanco) {
  instalacoes = await InstalacoesPostgres.abrir(urlBanco);
  console.log('[server] IDs fixos guardados no Postgres');
} else {
  instalacoes = new InstalacoesEmMemoria();
  console.log('[server] DATABASE_URL não definida: IDs fixos só em memória (somem ao reiniciar)');
}

// Quantos proxies confiáveis acrescentam o IP do cliente ao X-Forwarded-For.
const proxiesConfiaveis = Number(process.env.PROXIES_CONFIAVEIS ?? 0);

const servidor = await iniciarServidor({ porta, instalacoes, proxiesConfiaveis });
console.log(`[server] escutando na porta ${servidor.porta} (protocolo v${PROTOCOL_VERSION})`);

// Encerramento limpo ao receber Ctrl+C ou o sinal de parada do Render.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    console.log(`[server] ${sinal} recebido, encerrando...`);
    void servidor
      .fechar()
      .then(() => instalacoes.fechar())
      .then(() => process.exit(0));
  });
}
