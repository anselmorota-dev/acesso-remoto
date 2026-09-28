// Registro das instalações do app: liga cada chave pública (identidade da
// instalação) a um ID fixo de 9 dígitos.
//
// Duas implementações da mesma interface:
//   - em memória (aqui): desenvolvimento e testes; esquece tudo ao reiniciar;
//   - Postgres (instalacoes-postgres.ts): produção, os IDs sobrevivem a
//     reinícios do servidor (o plano gratuito do Render não guarda arquivos).
import type { IdCliente } from '@acesso-remoto/shared';
import { gerarId } from './ids.js';

export interface RepositorioInstalacoes {
  /** ID da instalação com esta chave, ou null se a chave é nova. */
  buscarId(chavePublica: string): Promise<IdCliente | null>;
  /**
   * Cria um ID para a chave. Se ela foi cadastrada agora mesmo por outra
   * conexão (corrida), devolve o ID que já existe.
   * (Separado de buscarId para o servidor poder limitar instalações novas.)
   */
  criarId(chavePublica: string): Promise<IdCliente>;
  /** Libera recursos (conexões com o banco). */
  fechar(): Promise<void>;
}

export class InstalacoesEmMemoria implements RepositorioInstalacoes {
  private readonly porChave = new Map<string, IdCliente>();
  private readonly ids = new Set<IdCliente>();
  private readonly sortear: (() => number) | undefined;

  /** "sortear" é injetável nos testes (para forçar colisões de ID). */
  constructor(sortear?: () => number) {
    this.sortear = sortear;
  }

  async buscarId(chavePublica: string): Promise<IdCliente | null> {
    return this.porChave.get(chavePublica) ?? null;
  }

  async criarId(chavePublica: string): Promise<IdCliente> {
    const existente = this.porChave.get(chavePublica);
    if (existente) return existente;
    const id = gerarId((candidato) => this.ids.has(candidato), this.sortear);
    this.porChave.set(chavePublica, id);
    this.ids.add(id);
    return id;
  }

  async fechar(): Promise<void> {}
}
