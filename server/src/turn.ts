// Credenciais temporárias de TURN (etapa 5.3), geradas pela API da Cloudflare.
//
// O TURN repassa o tráfego quando a conexão direta não passa (redes
// corporativas, alguns 4G). O conteúdo continua cifrado de ponta a ponta
// (DTLS/SRTP): o TURN repassa pacotes que não consegue ler.
//
// O token da API fica só aqui no servidor (variável de ambiente no Render);
// o app recebe credenciais com prazo, geradas a cada sessão, e só os dois
// lados daquela sessão. No fim da sessão, elas são revogadas.
import { esquemaServidorIce, type ServidorIce } from '@acesso-remoto/shared';

export interface CredenciaisTurn {
  /** Nome de usuário na Cloudflare (serve para revogar). */
  usuario: string;
  /** O que vai ao app (só os servidores TURN; o STUN o app já tem). */
  servidores: ServidorIce[];
}

export interface ProvedorTurn {
  /** Gera credenciais novas; null se não deu (a sessão segue só com STUN). */
  gerar(): Promise<CredenciaisTurn | null>;
  /** Revoga as credenciais (fim da sessão). Não espera nem falha. */
  revogar(usuario: string): void;
}

export interface OpcoesTurnCloudflare {
  idChave: string;
  token: string;
  /** Validade das credenciais: cobre uma sessão de um dia inteiro. */
  validadeSegundos?: number;
  /** Tempo máximo esperando a API (depois disso, a sessão segue sem TURN). */
  limiteMs?: number;
  /** Injetável nos testes. */
  fetch?: typeof globalThis.fetch;
  log?: (mensagem: string) => void;
}

const API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

/** O que a API devolve em "iceServers" (só o que usamos; o resto é ignorado). */
const esquemaLista = esquemaServidorIce.array().min(1).max(8);

/**
 * Fica só com os servidores TURN que o navegador consegue usar: a porta 53
 * (alternativa da Cloudflare) é bloqueada pelos navegadores e só atrasaria a
 * conexão; o STUN o app já tem.
 */
export function servidoresParaOApp(servidores: readonly ServidorIce[]): ServidorIce[] {
  const resultado: ServidorIce[] = [];
  for (const servidor of servidores) {
    const urls = servidor.urls.filter((url) => /^turns?:/.test(url) && !/:53(\?|$)/.test(url));
    if (urls.length && servidor.username && servidor.credential) resultado.push({ ...servidor, urls });
  }
  return resultado.slice(0, 4);
}

export function criarTurnCloudflare(opcoes: OpcoesTurnCloudflare): ProvedorTurn {
  const {
    idChave,
    token,
    validadeSegundos = 24 * 60 * 60,
    limiteMs = 4000,
    fetch = globalThis.fetch,
    log = console.log,
  } = opcoes;
  const cabecalhos = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const base = `${API}/${encodeURIComponent(idChave)}`;

  return {
    async gerar() {
      try {
        const resposta = await fetch(`${base}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: cabecalhos,
          body: JSON.stringify({ ttl: validadeSegundos }),
          signal: AbortSignal.timeout(limiteMs),
        });
        if (!resposta.ok) {
          log(`[turn] a Cloudflare recusou gerar credenciais (HTTP ${resposta.status})`);
          return null;
        }
        const corpo: unknown = await resposta.json();
        const lista = esquemaLista.safeParse(typeof corpo === 'object' && corpo ? (corpo as { iceServers?: unknown }).iceServers : null);
        if (!lista.success) {
          log('[turn] resposta da Cloudflare em formato inesperado');
          return null;
        }
        const servidores = servidoresParaOApp(lista.data);
        const usuario = servidores[0]?.username;
        if (!usuario) {
          log('[turn] a Cloudflare não devolveu servidores TURN');
          return null;
        }
        return { usuario, servidores };
      } catch (erro) {
        // Sem rede, prazo esgotado...: a sessão segue só com STUN.
        log(`[turn] falha ao gerar credenciais: ${erro instanceof Error ? erro.name : 'erro'}`);
        return null;
      }
    },

    revogar(usuario) {
      fetch(`${base}/credentials/${encodeURIComponent(usuario)}/revoke`, {
        method: 'POST',
        headers: cabecalhos,
        signal: AbortSignal.timeout(limiteMs),
      })
        .then((resposta) => {
          if (!resposta.ok) log(`[turn] falha ao revogar credenciais (HTTP ${resposta.status})`);
        })
        .catch(() => log('[turn] falha ao revogar credenciais (sem resposta)'));
    },
  };
}
