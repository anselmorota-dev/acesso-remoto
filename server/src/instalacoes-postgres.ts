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

export class InstalacoesPostgres implements RepositorioInstalacoes {
  private readonly pool: pg.Pool;

  private constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /** Conecta ao banco (URL de conexão do Neon) e garante que a tabela existe. */
  static async abrir(url: string, log: (mensagem: string) => void = console.log): Promise<InstalacoesPostgres> {
    // Poucas conexões bastam: só há consulta quando um app se registra.
    const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 60_000 });
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
