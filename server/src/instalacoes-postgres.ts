// Registro das instalações no Postgres (Neon em produção).
//
// Tabela única, criada na primeira execução:
//   instalacoes(id, chave_publica, criada_em, vista_em)
// "id" e "chave_publica" são únicos: uma chave tem um só ID e vice-versa.
import { randomInt } from 'node:crypto';
import pg from 'pg';
import type { IdCliente } from '@acesso-remoto/shared';
import type { RepositorioInstalacoes } from './instalacoes.js';

const CRIAR_TABELA = `
  CREATE TABLE IF NOT EXISTS instalacoes (
    id text PRIMARY KEY CHECK (id ~ '^[1-9][0-9]{8}$'),
    chave_publica text NOT NULL UNIQUE,
    criada_em timestamptz NOT NULL DEFAULT now(),
    vista_em timestamptz NOT NULL DEFAULT now()
  )`;

/** Tentativas de sortear um ID livre (colisões são raríssimas em 900 milhões). */
const MAX_TENTATIVAS = 10;

/**
 * Garante a checagem completa do certificado TLS do banco. O Neon entrega a
 * URL com "sslmode=require"; hoje o driver pg trata isso como "verify-full",
 * mas a partir do pg 9 vai seguir a libpq, em que "require" nem confere o
 * certificado (aceitaria um impostor no meio do caminho). Sem sslmode (ex.:
 * banco local sem TLS) ou com "disable", a URL fica como está.
 */
export function comCertificadoVerificado(url: string): string {
  const endereco = new URL(url);
  const modo = endereco.searchParams.get('sslmode');
  if (modo === 'prefer' || modo === 'require' || modo === 'verify-ca') {
    endereco.searchParams.set('sslmode', 'verify-full');
  }
  return endereco.toString();
}

export class InstalacoesPostgres implements RepositorioInstalacoes {
  private readonly pool: pg.Pool;

  private constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /** Conecta ao banco (URL de conexão do Neon) e garante que a tabela existe. */
  static async abrir(url: string, log: (mensagem: string) => void = console.log): Promise<InstalacoesPostgres> {
    // Poucas conexões bastam: só há consulta quando um app se registra.
    const pool = new pg.Pool({ connectionString: comCertificadoVerificado(url), max: 3, idleTimeoutMillis: 60_000 });
    // O Neon suspende o banco sem uso e derruba conexões ociosas; sem este
    // listener, esse erro em segundo plano derrubaria o servidor inteiro.
    pool.on('error', (erro) => log(`[server] conexão com o banco caiu (será refeita): ${erro.message}`));
    await pool.query(CRIAR_TABELA);
    return new InstalacoesPostgres(pool);
  }

  async idDaChave(chavePublica: string): Promise<IdCliente> {
    // Instalação conhecida: devolve o ID e anota quando foi vista.
    const conhecida = await this.pool.query<{ id: string }>(
      'UPDATE instalacoes SET vista_em = now() WHERE chave_publica = $1 RETURNING id',
      [chavePublica],
    );
    const id = conhecida.rows[0]?.id;
    if (id) return id;

    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      const candidato = String(randomInt(100_000_000, 1_000_000_000));
      const nova = await this.pool.query<{ id: string }>(
        'INSERT INTO instalacoes (id, chave_publica) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id',
        [candidato, chavePublica],
      );
      const criado = nova.rows[0]?.id;
      if (criado) return criado;
      // Conflito: ou o ID sorteado já existe (sorteia de novo), ou a mesma
      // chave foi cadastrada agora mesmo por outra conexão (usa aquele ID).
      const corrida = await this.pool.query<{ id: string }>('SELECT id FROM instalacoes WHERE chave_publica = $1', [
        chavePublica,
      ]);
      const existente = corrida.rows[0]?.id;
      if (existente) return existente;
    }
    throw new Error('Não foi possível gerar um ID livre');
  }

  async fechar(): Promise<void> {
    await this.pool.end();
  }
}
