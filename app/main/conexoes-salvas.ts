// Computadores salvos pelo visualizador: ID, apelido e, se quiser, a senha de
// acesso, para não precisar digitar toda vez.
//
// A senha precisa ser recuperável (vai para o outro computador), então não
// pode ser só um hash: fica cifrada com o DPAPI do Windows (safeStorage),
// que só a mesma conta do Windows, neste computador, consegue decifrar. Só o
// main a decifra, e só no instante de conectar; a tela recebe a lista sem
// senhas. Arquivo gravado de forma atômica (temporário + rename).
import { readFile, rename, writeFile } from 'node:fs/promises';
import { esquemaId, SENHA_MAXIMA, type IdCliente } from '@acesso-remoto/shared';

/** Cifra da senha (safeStorage no app; uma falsa nos testes). */
export interface CifraSenhas {
  disponivel(): boolean;
  cifrar(texto: string): Buffer;
  decifrar(dados: Buffer): string;
}

/** O que a tela vê de cada computador salvo (sem a senha). */
export interface ComputadorSalvo {
  id: IdCliente;
  apelido: string;
  temSenha: boolean;
  /** Última vez que foi usado para conectar (ms); ordena a lista. */
  usadoEm: number;
}

export interface OpcoesConexoesSalvas {
  arquivo: string;
  cifra: CifraSenhas;
  agora?: () => number;
}

/** Limites para o arquivo não crescer sem controle. */
export const MAXIMO_SALVOS = 50;
export const APELIDO_MAXIMO = 60;

const VERSAO_ARQUIVO = 1;

interface ItemArquivo {
  id: IdCliente;
  apelido: string;
  /** Senha cifrada (base64), ou null. */
  senha: string | null;
  usadoEm: number;
}

export type ErroSalvar = 'id_invalido' | 'senha_invalida' | 'cifra_indisponivel' | 'lista_cheia';

/** Apelido limpo: sem espaços nas pontas, no máximo APELIDO_MAXIMO caracteres. */
export function limparApelido(apelido: unknown): string {
  if (typeof apelido !== 'string') return '';
  return [...apelido.trim().replace(/\s+/g, ' ')].slice(0, APELIDO_MAXIMO).join('');
}

function itemValido(item: unknown): item is ItemArquivo {
  if (typeof item !== 'object' || item === null) return false;
  const i = item as Record<string, unknown>;
  return (
    esquemaId.safeParse(i['id']).success &&
    typeof i['apelido'] === 'string' &&
    (i['senha'] === null || typeof i['senha'] === 'string') &&
    typeof i['usadoEm'] === 'number'
  );
}

export class ConexoesSalvas {
  private readonly opcoes: OpcoesConexoesSalvas;
  private readonly agora: () => number;
  private itens: ItemArquivo[];
  /** Gravações em fila: nunca duas ao mesmo tempo no mesmo arquivo. */
  private gravando: Promise<void> = Promise.resolve();

  private constructor(opcoes: OpcoesConexoesSalvas, itens: ItemArquivo[]) {
    this.opcoes = opcoes;
    this.agora = opcoes.agora ?? Date.now;
    this.itens = itens;
  }

  /** Abre lendo o arquivo; arquivo ausente ou inválido = lista vazia. */
  static async abrir(opcoes: OpcoesConexoesSalvas): Promise<ConexoesSalvas> {
    let itens: ItemArquivo[] = [];
    try {
      const conteudo = JSON.parse(await readFile(opcoes.arquivo, 'utf8')) as { versao?: unknown; itens?: unknown };
      if (conteudo.versao === VERSAO_ARQUIVO && Array.isArray(conteudo.itens)) {
        itens = conteudo.itens.filter(itemValido).slice(0, MAXIMO_SALVOS);
      }
    } catch {
      // Sem arquivo (primeira vez) ou corrompido: começa vazio.
    }
    return new ConexoesSalvas(opcoes, itens);
  }

  /** A lista para a tela, sem senhas, do usado mais recentemente para o mais antigo. */
  listar(): ComputadorSalvo[] {
    return [...this.itens]
      .sort((a, b) => b.usadoEm - a.usadoEm)
      .map((i) => ({ id: i.id, apelido: i.apelido, temSenha: i.senha !== null, usadoEm: i.usadoEm }));
  }

  /**
   * Salva (ou atualiza) um computador. "senha": texto = guardar essa;
   * null = esquecer a senha; undefined = manter a que já estava.
   */
  async salvar(id: unknown, apelido: unknown, senha: string | null | undefined): Promise<{ ok: true } | { ok: false; erro: ErroSalvar }> {
    if (!esquemaId.safeParse(id).success) return { ok: false, erro: 'id_invalido' };
    const idValido = id as IdCliente;
    if (typeof senha === 'string' && (senha.length === 0 || senha.length > SENHA_MAXIMA * 4)) {
      return { ok: false, erro: 'senha_invalida' };
    }
    if (typeof senha === 'string' && !this.opcoes.cifra.disponivel()) return { ok: false, erro: 'cifra_indisponivel' };

    const existente = this.itens.find((i) => i.id === idValido);
    if (!existente && this.itens.length >= MAXIMO_SALVOS) return { ok: false, erro: 'lista_cheia' };
    const senhaCifrada =
      senha === undefined ? (existente?.senha ?? null) : senha === null ? null : this.opcoes.cifra.cifrar(senha).toString('base64');
    const item: ItemArquivo = {
      id: idValido,
      apelido: limparApelido(apelido),
      senha: senhaCifrada,
      usadoEm: existente?.usadoEm ?? this.agora(),
    };
    this.itens = existente ? this.itens.map((i) => (i.id === idValido ? item : i)) : [...this.itens, item];
    await this.gravar();
    return { ok: true };
  }

  async remover(id: unknown): Promise<void> {
    const antes = this.itens.length;
    this.itens = this.itens.filter((i) => i.id !== id);
    if (this.itens.length !== antes) await this.gravar();
  }

  /**
   * A senha para conectar (e marca o uso, para ordenar a lista). null: não há
   * senha salva, ou não foi possível decifrar (ex.: outra conta do Windows).
   */
  async senhaParaConectar(id: unknown): Promise<string | null> {
    const item = this.itens.find((i) => i.id === id);
    if (!item) return null;
    item.usadoEm = this.agora();
    await this.gravar();
    if (!item.senha) return null;
    try {
      return this.opcoes.cifra.decifrar(Buffer.from(item.senha, 'base64'));
    } catch {
      return null;
    }
  }

  /** Marca o uso de um computador salvo conectado sem senha (ordena a lista). */
  async marcarUso(id: unknown): Promise<void> {
    const item = this.itens.find((i) => i.id === id);
    if (!item) return;
    item.usadoEm = this.agora();
    await this.gravar();
  }

  private gravar(): Promise<void> {
    const conteudo = JSON.stringify({ versao: VERSAO_ARQUIVO, itens: this.itens });
    const vez = this.gravando.then(async () => {
      const temporario = `${this.opcoes.arquivo}.tmp`;
      await writeFile(temporario, conteudo, { encoding: 'utf8', mode: 0o600 });
      await rename(temporario, this.opcoes.arquivo);
    });
    this.gravando = vez.catch(() => {});
    return vez;
  }
}
