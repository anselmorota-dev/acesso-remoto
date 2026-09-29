// Ponto de entrada do servidor de sinalização.
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { InstalacoesEmMemoria, type RepositorioInstalacoes } from './instalacoes.js';
import { InstalacoesPostgres } from './instalacoes-postgres.js';
import { iniciarServidor } from './servidor.js';
import { criarTurnCloudflare } from './turn.js';

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

// Quantos proxies confiáveis acrescentam ao X-Forwarded-For (para achar o IP
// real do cliente, contando do fim). No Render (que define RENDER=true),
// medido em 28/09/2026: "cliente, Cloudflare, balanceador" + proxy local →
// o cliente é o 3º a partir do fim. PROXIES_CONFIAVEIS sobrescreve.
const PROXIES_NO_RENDER = 3;
const proxiesConfiaveis = Number(process.env.PROXIES_CONFIAVEIS ?? (process.env.RENDER ? PROXIES_NO_RENDER : 0));
console.log(`[server] proxies confiáveis no caminho: ${proxiesConfiaveis}`);

// TURN (etapa 5.3): com a chave da Cloudflare cadastrada no Render (nunca no
// git), cada sessão recebe credenciais temporárias. Sem ela, só STUN.
const idChaveTurn = process.env.CLOUDFLARE_TURN_KEY_ID;
const tokenTurn = process.env.CLOUDFLARE_TURN_API_TOKEN;
const turn = idChaveTurn && tokenTurn ? criarTurnCloudflare({ idChave: idChaveTurn, token: tokenTurn }) : undefined;
console.log(turn ? '[server] TURN da Cloudflare ligado' : '[server] TURN desligado (sem CLOUDFLARE_TURN_KEY_ID/_API_TOKEN): só STUN');

const servidor = await iniciarServidor({ porta, instalacoes, proxiesConfiaveis, turn });
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
