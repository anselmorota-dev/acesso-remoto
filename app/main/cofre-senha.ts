// Cofre da senha de acesso não supervisionado (regra de segurança do projeto:
// a senha é guardada apenas como hash, nunca em texto).
//
// - Hash com argon2id (resistente a ataques com GPU porque exige memória).
//   O resultado é uma string no formato PHC ("$argon2id$v=19$m=...$sal$hash"),
//   que já leva o sal aleatório e os parâmetros usados.
// - Fica num arquivo JSON na pasta de dados do app, gravado de forma atômica
//   (arquivo temporário + rename) para não corromper se o app cair no meio.
// - Alterar ou remover exige a senha atual e é bloqueado durante uma sessão:
//   quem está controlando este computador não pode criar um acesso para si.
// - Só o processo main lê o hash; o renderer só sabe se há senha definida.
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hash, verify } from '@node-rs/argon2';
import { normalizarSenha, problemaNaSenha } from '@acesso-remoto/shared';
import type { ResultadoSenha } from '../preload/api';

export interface OpcoesCofre {
  /** Caminho do arquivo onde o hash é guardado. */
  arquivo: string;
  /** true enquanto alguém controla este computador: bloqueia mudanças. */
  emSessao: () => boolean;
  /** Custo do argon2 (os testes usam um menor para rodar rápido). */
  custo?: { memoriaKiB: number; passagens: number };
}

/** 64 MiB e 3 passagens: ~0,1–0,3 s por verificação num notebook comum. */
const CUSTO_PADRAO = { memoriaKiB: 64 * 1024, passagens: 3 };
const VERSAO_ARQUIVO = 1;

interface ConteudoArquivo {
  versao: number;
  senha: string;
}

export class CofreSenha {
  private readonly opcoes: OpcoesCofre;
  private hashSenha: string | null;

  private constructor(opcoes: OpcoesCofre, hashSenha: string | null) {
    this.opcoes = opcoes;
    this.hashSenha = hashSenha;
  }

  /** Abre o cofre lendo o arquivo (se existir). */
  static async abrir(opcoes: OpcoesCofre): Promise<CofreSenha> {
    return new CofreSenha(opcoes, await lerHash(opcoes.arquivo));
  }

  get definida(): boolean {
    return this.hashSenha !== null;
  }

  /** Confere se a senha é a definida (false se não há senha). */
  async confere(senha: string): Promise<boolean> {
    if (!this.hashSenha) return false;
    try {
      return await verify(this.hashSenha, normalizarSenha(senha));
    } catch {
      return false;
    }
  }

  /** Define a senha (ou troca: aí "atual" precisa conferir). */
  async definir(nova: string, atual: string | null): Promise<ResultadoSenha> {
    const bloqueio = await this.checarPermissao(atual);
    if (bloqueio) return bloqueio;
    const problema = problemaNaSenha(nova);
    if (problema) return { ok: false, erro: problema };

    const custo = this.opcoes.custo ?? CUSTO_PADRAO;
    // O algoritmo padrão da biblioteca é o argon2id (o enum Algorithm é um
    // "const enum", que o nosso tsconfig não permite importar). O teste e o
    // lerHash exigem o prefixo $argon2id$, então uma mudança de padrão seria pega.
    const novoHash = await hash(normalizarSenha(nova), {
      memoryCost: custo.memoriaKiB,
      timeCost: custo.passagens,
      parallelism: 1,
    });
    await gravarAtomico(this.opcoes.arquivo, { versao: VERSAO_ARQUIVO, senha: novoHash });
    this.hashSenha = novoHash;
    return { ok: true };
  }

  /** Remove a senha, desativando o acesso não supervisionado. */
  async remover(atual: string): Promise<ResultadoSenha> {
    const bloqueio = await this.checarPermissao(atual);
    if (bloqueio) return bloqueio;
    await rm(this.opcoes.arquivo, { force: true });
    this.hashSenha = null;
    return { ok: true };
  }

  /** Bloqueia mudanças durante a sessão e, se já há senha, exige a atual. */
  private async checarPermissao(atual: string | null): Promise<ResultadoSenha | null> {
    if (this.opcoes.emSessao()) return { ok: false, erro: 'sessao_ativa' };
    if (this.hashSenha && (atual === null || !(await this.confere(atual)))) {
      return { ok: false, erro: 'senha_atual_incorreta' };
    }
    return null;
  }
}

/**
 * Lê o hash do arquivo. Arquivo ausente, corrompido ou com algo que não é um
 * hash argon2id vale como "sem senha": na dúvida, o acesso sem aceite fica
 * desligado (o lado seguro).
 */
async function lerHash(arquivo: string): Promise<string | null> {
  let texto: string;
  try {
    texto = await readFile(arquivo, 'utf8');
  } catch {
    return null; // ainda não existe
  }
  try {
    const conteudo = JSON.parse(texto) as Partial<ConteudoArquivo>;
    if (conteudo.versao === VERSAO_ARQUIVO && typeof conteudo.senha === 'string' && conteudo.senha.startsWith('$argon2id$')) {
      return conteudo.senha;
    }
  } catch {
    // cai no aviso abaixo
  }
  console.warn('[main] arquivo de senha inválido; acesso não supervisionado desativado');
  return null;
}

async function gravarAtomico(arquivo: string, conteudo: ConteudoArquivo): Promise<void> {
  const temporario = `${arquivo}.tmp`;
  await writeFile(temporario, JSON.stringify(conteudo), { encoding: 'utf8', mode: 0o600 });
  await rename(temporario, arquivo);
}
