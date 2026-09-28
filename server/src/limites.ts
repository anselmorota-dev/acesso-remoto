// Limites de tentativas no servidor (regra de segurança do projeto: evitar
// força bruta e abuso). Ficam em memória: zeram quando o servidor reinicia.
//
// JanelaDeEventos conta eventos por chave (ex.: um IP) numa janela de tempo
// deslizante. Serve para dois usos:
//   - limite de taxa: tentar() recusa quando já há "limite" eventos na janela;
//   - bloqueio: registrar() anota falhas; ao atingir o limite, a chave fica
//     bloqueada por "bloqueioMs" (mesmo que a janela passe).

export interface OpcoesJanela {
  limite: number;
  janelaMs: number;
  /** Tempo de bloqueio ao atingir o limite (0 = sem bloqueio, só limite de taxa). */
  bloqueioMs?: number;
  /** Relógio em ms (injetável nos testes). */
  agora?: () => number;
}

interface Registro {
  instantes: number[];
  bloqueadoAte: number;
}

export class JanelaDeEventos {
  private readonly limite: number;
  private readonly janelaMs: number;
  private readonly bloqueioMs: number;
  private readonly agora: () => number;
  private readonly registros = new Map<string, Registro>();

  constructor(opcoes: OpcoesJanela) {
    this.limite = opcoes.limite;
    this.janelaMs = opcoes.janelaMs;
    this.bloqueioMs = opcoes.bloqueioMs ?? 0;
    this.agora = opcoes.agora ?? Date.now;
  }

  /** A chave está bloqueada agora? */
  bloqueado(chave: string): boolean {
    const registro = this.registros.get(chave);
    return registro !== undefined && registro.bloqueadoAte > this.agora();
  }

  /** Anota um evento (ex.: uma senha errada); ao atingir o limite, bloqueia. */
  registrar(chave: string): void {
    const agora = this.agora();
    const registro = this.atualizado(chave, agora);
    registro.instantes.push(agora);
    if (this.bloqueioMs > 0 && registro.instantes.length >= this.limite) {
      registro.bloqueadoAte = agora + this.bloqueioMs;
    }
  }

  /** Limite de taxa: anota e devolve true se ainda cabe; false se passou do limite. */
  tentar(chave: string): boolean {
    if (this.bloqueado(chave)) return false;
    const registro = this.atualizado(chave, this.agora());
    if (registro.instantes.length >= this.limite) return false;
    this.registrar(chave);
    return true;
  }

  /** Esquece chaves sem eventos na janela e sem bloqueio vigente. */
  limpar(): void {
    const agora = this.agora();
    for (const [chave, registro] of this.registros) {
      this.descartarAntigos(registro, agora);
      if (registro.instantes.length === 0 && registro.bloqueadoAte <= agora) this.registros.delete(chave);
    }
  }

  /** Quantas chaves estão guardadas (para testes e diagnóstico). */
  tamanho(): number {
    return this.registros.size;
  }

  private atualizado(chave: string, agora: number): Registro {
    let registro = this.registros.get(chave);
    if (!registro) {
      registro = { instantes: [], bloqueadoAte: 0 };
      this.registros.set(chave, registro);
    }
    this.descartarAntigos(registro, agora);
    return registro;
  }

  private descartarAntigos(registro: Registro, agora: number): void {
    while (registro.instantes.length > 0 && agora - (registro.instantes[0] ?? 0) >= this.janelaMs) {
      registro.instantes.shift();
    }
  }
}

/** O mínimo de uma requisição HTTP de que precisamos (facilita os testes). */
export interface PedidoHttp {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | undefined };
}

/**
 * IP de quem conectou. Atrás de proxies (Render: Cloudflare + balanceador),
 * o endereço da conexão é o do proxy, e o do cliente vem no X-Forwarded-For.
 * Mas o cliente pode mandar esse cabeçalho já preenchido (forjado): os
 * proxies só ACRESCENTAM ao fim. Por isso conta-se do fim: com N proxies
 * confiáveis, o IP real é o N-ésimo a partir do fim. Com 0, o cabeçalho é
 * ignorado.
 */
export function ipDoCliente(pedido: PedidoHttp, proxiesConfiaveis: number): string {
  const direto = normalizar(pedido.socket.remoteAddress ?? 'desconhecido');
  if (proxiesConfiaveis <= 0) return direto;
  const cabecalho = pedido.headers['x-forwarded-for'];
  const lista = (Array.isArray(cabecalho) ? cabecalho.join(',') : (cabecalho ?? ''))
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean);
  const escolhido = lista[lista.length - proxiesConfiaveis];
  return escolhido ? normalizar(escolhido) : direto;
}

/** "::ffff:1.2.3.4" (IPv4 escrito como IPv6) → "1.2.3.4". */
function normalizar(ip: string): string {
  return ip.startsWith('::ffff:') && ip.includes('.') ? ip.slice(7) : ip;
}

/**
 * Chave usada nos limites: IPv4 inteiro; IPv6 pelo prefixo /64, porque um
 * único usuário costuma receber o /64 inteiro e poderia trocar de endereço
 * à vontade para fugir do limite.
 */
export function chaveDoIp(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [antes = '', depois] = ip.split('::');
  const inicio = antes ? antes.split(':') : [];
  // Com "::", os grupos omitidos são zeros; só precisamos dos 4 primeiros.
  const grupos = depois === undefined ? inicio : [...inicio, ...Array<string>(8).fill('0')];
  return `${grupos
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

// ---------------------------------------------------------------------------
// Os limites do servidor
// ---------------------------------------------------------------------------

export interface RegraBloqueio {
  limite: number;
  janelaMs: number;
  bloqueioMs: number;
}

export interface ConfigLimites {
  /** Pedidos de conexão por minuto, contados por IP e por ID de origem. */
  pedidosPorMinuto: number;
  /** Instalações novas (IDs novos no banco) por hora, por IP. */
  instalacoesNovasPorHora: number;
  /** Senhas erradas do mesmo IP para o mesmo ID: bloqueia esse IP nesse ID. */
  errosSenhaPorIpEId: RegraBloqueio;
  /** Teto de senhas erradas para um ID, de qualquer IP: pausa o acesso com senha a ele. */
  errosSenhaPorId: RegraBloqueio;
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

export const LIMITES_PADRAO: ConfigLimites = {
  pedidosPorMinuto: 20,
  instalacoesNovasPorHora: 10,
  errosSenhaPorIpEId: { limite: 5, janelaMs: 10 * MINUTO, bloqueioMs: 15 * MINUTO },
  errosSenhaPorId: { limite: 30, janelaMs: HORA, bloqueioMs: HORA },
};

export interface LimitesServidor {
  /** Pode fazer mais um pedido de conexão? (anota a tentativa) */
  pedido(ip: string, id: string): boolean;
  /** Pode criar mais uma instalação deste IP? (anota a tentativa) */
  instalacaoNova(ip: string): boolean;
  /** Este IP ainda pode tentar senha neste destino? */
  podeTentarSenha(ip: string, destino: string): boolean;
  /** Anota uma senha errada deste IP para este destino. */
  falhaSenha(ip: string, destino: string): void;
  /** Esquece contagens antigas (chamado de tempos em tempos). */
  limpar(): void;
}

export function criarLimites(config: Partial<ConfigLimites> = {}, agora?: () => number): LimitesServidor {
  const c = { ...LIMITES_PADRAO, ...config };
  const pedidosPorIp = new JanelaDeEventos({ limite: c.pedidosPorMinuto, janelaMs: MINUTO, agora });
  const pedidosPorId = new JanelaDeEventos({ limite: c.pedidosPorMinuto, janelaMs: MINUTO, agora });
  const instalacoes = new JanelaDeEventos({ limite: c.instalacoesNovasPorHora, janelaMs: HORA, agora });
  const senhaIpId = new JanelaDeEventos({ ...c.errosSenhaPorIpEId, agora });
  const senhaId = new JanelaDeEventos({ ...c.errosSenhaPorId, agora });
  const todas = [pedidosPorIp, pedidosPorId, instalacoes, senhaIpId, senhaId];

  return {
    pedido: (ip, id) => pedidosPorIp.tentar(ip) && pedidosPorId.tentar(id),
    instalacaoNova: (ip) => instalacoes.tentar(ip),
    podeTentarSenha: (ip, destino) => !senhaIpId.bloqueado(`${ip}|${destino}`) && !senhaId.bloqueado(destino),
    falhaSenha: (ip, destino) => {
      senhaIpId.registrar(`${ip}|${destino}`);
      senhaId.registrar(destino);
    },
    limpar: () => todas.forEach((janela) => janela.limpar()),
  };
}
