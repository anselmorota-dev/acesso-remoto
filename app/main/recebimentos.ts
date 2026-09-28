// Gravação dos arquivos recebidos do outro computador (independe do Electron:
// recebe a pasta de destino, para ser testado numa pasta temporária).
//
// Cada arquivo é gravado primeiro num nome temporário (".<token>.parcial")
// e só ganha o nome de verdade quando chega inteiro, com o tamanho anunciado.
// Assim um arquivo pela metade (queda, cancelamento) nunca parece completo.
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { nomeLivre, nomeSeguro } from './nome-arquivo';

interface Recebimento {
  nome: string;
  tamanho: number;
  gravados: number;
  temporario: string;
  fluxo: WriteStream;
  falhou: boolean;
}

export type ResultadoConclusao = { ok: true; nome: string; caminho: string } | { ok: false; erro: 'tamanho' | 'disco' };

export class Recebimentos {
  private readonly pasta: string;
  private readonly aoFalhar: (token: string) => void;
  private readonly emAndamento = new Map<string, Recebimento>();
  /** Arquivos concluídos nesta execução (token → caminho), para "Mostrar na pasta". */
  private readonly concluidos = new Map<string, string>();

  constructor(pasta: string, aoFalhar: (token: string) => void = () => {}) {
    this.pasta = pasta;
    this.aoFalhar = aoFalhar;
  }

  /** Começa a receber um arquivo; devolve o token usado nas próximas chamadas (ou null se não deu). */
  iniciar(nome: string, tamanho: number): string | null {
    try {
      mkdirSync(this.pasta, { recursive: true });
    } catch {
      return null;
    }
    const token = randomUUID();
    const temporario = join(this.pasta, `.${token}.parcial`);
    const fluxo = createWriteStream(temporario, { flags: 'wx' });
    const recebimento: Recebimento = { nome: nomeSeguro(nome), tamanho, gravados: 0, temporario, fluxo, falhou: false };
    // Disco cheio, sem permissão...: avisa já, para quem envia parar.
    fluxo.on('error', () => {
      if (recebimento.falhou) return;
      recebimento.falhou = true;
      this.aoFalhar(token);
    });
    this.emAndamento.set(token, recebimento);
    return token;
  }

  /** Grava um pedaço; false se não há esse recebimento, ele falhou ou passou do tamanho anunciado. */
  gravar(token: string, pedaco: Uint8Array): boolean {
    const r = this.emAndamento.get(token);
    if (!r || r.falhou) return false;
    if (r.gravados + pedaco.byteLength > r.tamanho) return false;
    r.gravados += pedaco.byteLength;
    r.fluxo.write(pedaco);
    return true;
  }

  /** Terminou de chegar: confere o tamanho e dá o nome de verdade (sem sobrescrever nada). */
  async concluir(token: string): Promise<ResultadoConclusao> {
    const r = this.emAndamento.get(token);
    if (!r) return { ok: false, erro: 'disco' };
    this.emAndamento.delete(token);
    // Espera o arquivo FECHAR (não só terminar de gravar): no Windows, um
    // arquivo aberto não pode ser renomeado.
    await fechar(r.fluxo, true);
    if (r.falhou) {
      apagar(r.temporario);
      return { ok: false, erro: 'disco' };
    }
    if (r.gravados !== r.tamanho) {
      apagar(r.temporario);
      return { ok: false, erro: 'tamanho' };
    }
    try {
      const existentes = new Set(readdirSync(this.pasta).map((n) => n.toLowerCase()));
      const nome = nomeLivre(r.nome, (candidato) => existentes.has(candidato.toLowerCase()));
      const caminho = join(this.pasta, nome);
      // Última conferência: nunca sobrescrever (o rename do Windows substituiria).
      if (existsSync(caminho)) throw new Error('nome ocupado');
      renameSync(r.temporario, caminho);
      this.concluidos.set(token, caminho);
      return { ok: true, nome, caminho };
    } catch {
      apagar(r.temporario);
      return { ok: false, erro: 'disco' };
    }
  }

  /** Abandona um recebimento (cancelado, sessão encerrada): apaga o parcial. */
  descartar(token: string): void {
    const r = this.emAndamento.get(token);
    if (!r) return;
    this.emAndamento.delete(token);
    // No Windows o arquivo só pode ser apagado depois de fechado.
    void fechar(r.fluxo, false).then(() => apagar(r.temporario));
  }

  descartarTodos(): void {
    for (const token of [...this.emAndamento.keys()]) this.descartar(token);
  }

  /** Caminho de um arquivo concluído nesta execução (para "Mostrar na pasta"). */
  caminhoConcluido(token: string): string | undefined {
    return this.concluidos.get(token);
  }

  /** Quantos recebimentos estão abertos (para testes). */
  get abertos(): number {
    return this.emAndamento.size;
  }
}

/** Fecha o arquivo (terminando de gravar, ou abandonando o que falta) e espera ele fechar de fato. */
function fechar(fluxo: WriteStream, terminarDeGravar: boolean): Promise<void> {
  return new Promise((resolve) => {
    if (fluxo.closed) return resolve();
    fluxo.once('close', () => resolve());
    if (terminarDeGravar && !fluxo.destroyed) fluxo.end();
    else fluxo.destroy();
  });
}

function apagar(caminho: string): void {
  try {
    rmSync(caminho, { force: true });
  } catch {
    // Se não deu para apagar agora, fica escondido (".parcial"); não atrapalha.
  }
}
