// Transferência de arquivos entre os dois computadores (os dois lados enviam
// e recebem). Envia um arquivo por vez, em pedaços, sem encher a memória:
// quando a fila do canal passa de um limite, espera ela esvaziar. Quem recebe
// repassa os pedaços ao main, que grava em Downloads\Acesso Remoto.
//
// Não conhece o WebRTC nem o Electron: recebe o canal e o gravador por
// injeção (no app, o canal "arquivos" do par e window.api.arquivos), o que
// permite testá-lo no Node ligando dois gerenciadores um ao outro.
import {
  NOME_ARQUIVO_MAXIMO,
  PEDACO_ARQUIVO,
  TAMANHO_MAXIMO_CONTROLE_ARQUIVOS,
  decodificarMensagem,
  esquemaMensagemArquivos,
  type MensagemArquivos,
  type MotivoErroArquivo,
} from '@acesso-remoto/shared';

/** O canal de arquivos da conexão direta (no app, um RTCDataChannel adaptado). */
export interface CanalArquivos {
  enviar(dados: string | ArrayBuffer): void;
  /** Bytes esperando para sair (bufferedAmount). */
  fila(): number;
  /** Resolve quando a fila cair a "limite" bytes (ou o canal fechar). */
  esperarFila(limite: number): Promise<void>;
}

/** Quem grava os arquivos recebidos (no app, o main, via window.api.arquivos). */
export interface GravadorArquivos {
  iniciar(nome: string, tamanho: number): Promise<string | null>;
  gravar(token: string, pedaco: Uint8Array): void;
  concluir(token: string): Promise<{ ok: true; nome: string } | { ok: false; erro: 'tamanho' | 'disco' }>;
  descartar(token: string): void;
}

export type EstadoTransferencia = 'na_fila' | 'transferindo' | 'finalizando' | 'concluido' | 'cancelado' | 'erro';

export interface Transferencia {
  /** Identifica o item na lista (único neste computador). */
  chave: string;
  direcao: 'enviando' | 'recebendo';
  nome: string;
  tamanho: number;
  transferidos: number;
  estado: EstadoTransferencia;
  /** Por que terminou em erro ou cancelado. */
  motivo?: string;
  iniciadoEm?: number;
  /** Recebido e gravado: token para "Mostrar na pasta". */
  token?: string;
}

export interface OpcoesGerenciador {
  gravador: GravadorArquivos;
  aoMudar: (lista: readonly Transferencia[]) => void;
  /** Relógio em ms (injetável nos testes). */
  agora?: () => number;
  /** Intervalo mínimo entre avisos de progresso. */
  intervaloProgressoMs?: number;
}

/**
 * Fila do canal: acima do limite alto, espera cair ao baixo. Não enche a
 * memória e mantém o Cancelar valendo: o que já está na fila chega de
 * qualquer jeito, então quanto menor ela, mais rápido o cancelamento age.
 * 1 MB ainda sustenta ~80 Mbit/s com 100 ms de ida e volta.
 */
const FILA_ALTA = 1024 * 1024;
const FILA_BAIXA = 256 * 1024;
/** De quanto em quanto tempo atualizar o progresso enquanto espera a fila. */
const INTERVALO_PROGRESSO_FILA_MS = 200;

const TEXTO_ERRO: Record<MotivoErroArquivo, string> = {
  disco: 'o outro computador não conseguiu gravar o arquivo',
  tamanho: 'o arquivo chegou incompleto',
  protocolo: 'falha na transferência',
};
const TEXTO_ERRO_LOCAL: Record<MotivoErroArquivo, string> = {
  disco: 'não foi possível gravar o arquivo neste computador',
  tamanho: 'o arquivo chegou incompleto',
  protocolo: 'falha na transferência',
};

interface Saida {
  id: number;
  arquivo: File;
  item: Transferencia;
}

interface Entrada {
  id: number;
  item: Transferencia;
  /** Token do main; null enquanto o arquivo ainda está sendo criado. */
  token: string | null;
  /** Pedaços que chegaram antes do token (gravados assim que ele vier). */
  pendentes: Uint8Array[];
  recebidos: number;
  /** O "fim" já chegou (espera o token para concluir). */
  fimRecebido: boolean;
}

export class GerenciadorArquivos {
  private readonly opcoes: OpcoesGerenciador;
  private readonly itens: Transferencia[] = [];
  private canal: CanalArquivos | null = null;
  private proximoId = 1;
  private proximaChave = 1;
  // Envio
  private readonly filaSaida: Saida[] = [];
  private enviandoAgora: Saida | null = null;
  private readonly aguardandoConfirmacao = new Map<number, Saida>();
  // Recebimento
  private entrada: Entrada | null = null;
  // Aviso de progresso (no máximo um a cada intervalo)
  private ultimoAviso = 0;
  private avisoPendente: ReturnType<typeof setTimeout> | undefined;

  constructor(opcoes: OpcoesGerenciador) {
    this.opcoes = opcoes;
  }

  get lista(): readonly Transferencia[] {
    return this.itens;
  }

  /** Pode enviar agora (há uma sessão liberada com o canal de arquivos aberto)? */
  get podeEnviar(): boolean {
    return this.canal !== null;
  }

  /**
   * O canal da sessão atual, ou null quando a sessão acaba (ou ainda não foi
   * liberada). Ao perder o canal, o que estava em andamento é abandonado.
   */
  definirCanal(canal: CanalArquivos | null): void {
    if (canal === this.canal) return;
    if (this.canal) this.abandonarTudo();
    this.canal = canal;
    this.avisar();
  }

  /** Coloca arquivos na fila de envio. */
  enviar(arquivos: readonly File[]): void {
    if (!this.canal) return;
    for (const arquivo of arquivos) {
      const item = this.novoItem('enviando', arquivo.name, arquivo.size);
      this.filaSaida.push({ id: this.proximoId++, arquivo, item });
    }
    this.avisar();
    this.enviarProximo();
  }

  /** Cancela um envio (na fila ou em andamento) ou um recebimento em andamento. */
  cancelar(chave: string): void {
    const naFila = this.filaSaida.findIndex((s) => s.item.chave === chave);
    if (naFila >= 0) {
      const [saida] = this.filaSaida.splice(naFila, 1);
      if (saida) this.terminar(saida.item, 'cancelado', 'cancelado por você');
    } else if (this.enviandoAgora?.item.chave === chave) {
      this.canal?.enviar(json({ tipo: 'arquivo_cancelar', id: this.enviandoAgora.id }));
      this.terminar(this.enviandoAgora.item, 'cancelado', 'cancelado por você');
    } else if (this.entrada?.item.chave === chave) {
      const entrada = this.entrada;
      this.entrada = null;
      this.canal?.enviar(json({ tipo: 'arquivo_cancelar', id: entrada.id }));
      if (entrada.token) this.opcoes.gravador.descartar(entrada.token);
      this.terminar(entrada.item, 'cancelado', 'cancelado por você');
    }
    this.avisar();
  }

  /** Tira da lista o que já terminou (concluído, cancelado ou com erro). */
  limpar(): void {
    const ativos = this.itens.filter((i) => !terminado(i.estado));
    this.itens.splice(0, this.itens.length, ...ativos);
    this.avisar();
  }

  /** A gravação de um arquivo falhou no main (ex.: disco cheio): para o recebimento. */
  falhaNaGravacao(token: string): void {
    if (this.entrada?.token === token) this.abandonarEntrada('disco');
  }

  /** Mensagem do canal de arquivos: controle (texto) ou pedaço de arquivo (binário). */
  receber(dados: string | ArrayBuffer): void {
    if (typeof dados !== 'string') {
      this.receberPedaco(dados);
      return;
    }
    if (dados.length > TAMANHO_MAXIMO_CONTROLE_ARQUIVOS) return;
    const mensagem = decodificarMensagem(esquemaMensagemArquivos, dados);
    if (!mensagem) {
      console.warn('[arquivos] mensagem inválida no canal, ignorada');
      return;
    }
    switch (mensagem.tipo) {
      case 'arquivo_inicio':
        this.comecarAReceber(mensagem.id, mensagem.nome, mensagem.tamanho);
        break;
      case 'arquivo_fim':
        this.fimDoRecebimento(mensagem.id);
        break;
      case 'arquivo_cancelar':
        this.canceladoPeloOutroLado(mensagem.id);
        break;
      case 'arquivo_recebido': {
        const saida = this.aguardandoConfirmacao.get(mensagem.id);
        if (!saida) break;
        this.aguardandoConfirmacao.delete(mensagem.id);
        saida.item.transferidos = saida.item.tamanho;
        this.terminar(saida.item, 'concluido');
        break;
      }
      case 'arquivo_erro': {
        const saida =
          this.enviandoAgora?.id === mensagem.id ? this.enviandoAgora : this.aguardandoConfirmacao.get(mensagem.id);
        if (!saida) break;
        this.aguardandoConfirmacao.delete(mensagem.id);
        this.terminar(saida.item, 'erro', TEXTO_ERRO[mensagem.motivo]);
        break;
      }
    }
    this.avisar();
  }

  // -------------------------------------------------------------------------
  // Envio
  // -------------------------------------------------------------------------

  private enviarProximo(): void {
    if (this.enviandoAgora || !this.canal) return;
    const saida = this.filaSaida.shift();
    if (saida) void this.transmitir(saida, this.canal);
  }

  private async transmitir(saida: Saida, canal: CanalArquivos): Promise<void> {
    const { item, arquivo } = saida;
    this.enviandoAgora = saida;
    item.estado = 'transferindo';
    item.iniciadoEm = this.agora();
    this.avisar();
    // O nome vai só como sugestão: quem recebe limpa e decide o nome final.
    const nome = arquivo.name.slice(0, NOME_ARQUIVO_MAXIMO) || 'arquivo';
    canal.enviar(json({ tipo: 'arquivo_inicio', id: saida.id, nome, tamanho: arquivo.size }));

    /** Ainda vale continuar? (cancelado, erro do outro lado ou sessão encerrada) */
    const ativo = () => this.canal === canal && item.estado === 'transferindo';
    let enviados = 0;
    // Progresso: o que já saiu de fato (descontando o que ainda está na fila).
    const atualizarProgresso = () => {
      item.transferidos = Math.max(0, enviados - canal.fila());
      this.avisarDevagar();
    };
    /** Espera a fila cair a "limite", atualizando o progresso enquanto isso. */
    const esperarFila = async (limite: number) => {
      while (canal.fila() > limite && ativo()) {
        await Promise.race([canal.esperarFila(limite), esperar(INTERVALO_PROGRESSO_FILA_MS)]);
        atualizarProgresso();
      }
    };
    try {
      while (enviados < arquivo.size) {
        if (!ativo()) return;
        if (canal.fila() > FILA_ALTA) {
          await esperarFila(FILA_BAIXA);
          continue;
        }
        const pedaco = await arquivo.slice(enviados, enviados + PEDACO_ARQUIVO).arrayBuffer();
        if (!ativo()) return;
        canal.enviar(pedaco);
        enviados += pedaco.byteLength;
        atualizarProgresso();
      }
      // O "fim" só vai quando tudo saiu: até lá o Cancelar ainda vale (o
      // aviso de cancelamento chega logo depois do que estava na fila).
      await esperarFila(0);
      if (!ativo()) return;
      canal.enviar(json({ tipo: 'arquivo_fim', id: saida.id }));
      item.estado = 'finalizando';
      item.transferidos = enviados;
      this.aguardandoConfirmacao.set(saida.id, saida);
    } catch (erro) {
      // Ex.: o arquivo foi apagado ou movido durante o envio.
      console.warn('[arquivos] falha ao ler o arquivo:', erro);
      if (ativo()) {
        canal.enviar(json({ tipo: 'arquivo_cancelar', id: saida.id }));
        this.terminar(item, 'erro', 'não foi possível ler o arquivo');
      }
    } finally {
      if (this.enviandoAgora === saida) this.enviandoAgora = null;
      this.avisar();
      this.enviarProximo();
    }
  }

  // -------------------------------------------------------------------------
  // Recebimento
  // -------------------------------------------------------------------------

  private comecarAReceber(id: number, nome: string, tamanho: number): void {
    // Um arquivo por vez: começar outro sem terminar o anterior é erro de quem envia.
    if (this.entrada) this.abandonarEntrada('protocolo');
    const entrada: Entrada = {
      id,
      item: this.novoItem('recebendo', nome, tamanho),
      token: null,
      pendentes: [],
      recebidos: 0,
      fimRecebido: false,
    };
    entrada.item.estado = 'transferindo';
    entrada.item.iniciadoEm = this.agora();
    this.entrada = entrada;

    const aindaValida = () => entrada.item.estado === 'transferindo' || entrada.item.estado === 'finalizando';
    this.opcoes.gravador.iniciar(nome, tamanho).then(
      (token) => {
        if (!aindaValida()) {
          // Cancelado enquanto o arquivo era criado: apaga o que foi criado.
          if (token) this.opcoes.gravador.descartar(token);
          return;
        }
        if (!token) {
          this.abandonarEntrada('disco', entrada);
          return;
        }
        entrada.token = token;
        for (const pedaco of entrada.pendentes.splice(0)) this.opcoes.gravador.gravar(token, pedaco);
        if (entrada.fimRecebido) void this.concluirEntrada(entrada);
      },
      () => this.abandonarEntrada('disco', entrada),
    );
  }

  private receberPedaco(dados: ArrayBuffer): void {
    const entrada = this.entrada;
    // Sem recebimento em andamento: resto de um arquivo cancelado; ignora.
    if (!entrada) return;
    if (dados.byteLength > PEDACO_ARQUIVO) {
      this.abandonarEntrada('protocolo');
      return;
    }
    if (entrada.recebidos + dados.byteLength > entrada.item.tamanho) {
      this.abandonarEntrada('tamanho');
      return;
    }
    entrada.recebidos += dados.byteLength;
    entrada.item.transferidos = entrada.recebidos;
    const pedaco = new Uint8Array(dados);
    if (entrada.token) this.opcoes.gravador.gravar(entrada.token, pedaco);
    else entrada.pendentes.push(pedaco);
    this.avisarDevagar();
  }

  private fimDoRecebimento(id: number): void {
    const entrada = this.entrada;
    if (!entrada || entrada.id !== id) return;
    if (entrada.recebidos !== entrada.item.tamanho) {
      this.abandonarEntrada('tamanho');
      return;
    }
    this.entrada = null; // o próximo arquivo já pode começar a chegar
    entrada.fimRecebido = true;
    entrada.item.estado = 'finalizando';
    if (entrada.token) void this.concluirEntrada(entrada);
  }

  private async concluirEntrada(entrada: Entrada): Promise<void> {
    if (!entrada.token) return;
    const canal = this.canal;
    const resultado = await this.opcoes.gravador.concluir(entrada.token);
    if (resultado.ok) {
      entrada.item.nome = resultado.nome;
      entrada.item.token = entrada.token;
      this.terminar(entrada.item, 'concluido');
      canal?.enviar(json({ tipo: 'arquivo_recebido', id: entrada.id }));
    } else {
      this.terminar(entrada.item, 'erro', TEXTO_ERRO_LOCAL[resultado.erro]);
      canal?.enviar(json({ tipo: 'arquivo_erro', id: entrada.id, motivo: resultado.erro }));
    }
    this.avisar();
  }

  /** Desiste do recebimento em andamento, avisando quem envia (que para de mandar). */
  private abandonarEntrada(motivo: MotivoErroArquivo, entrada = this.entrada): void {
    if (!entrada || terminado(entrada.item.estado)) return;
    if (this.entrada === entrada) this.entrada = null;
    if (entrada.token) this.opcoes.gravador.descartar(entrada.token);
    this.canal?.enviar(json({ tipo: 'arquivo_erro', id: entrada.id, motivo }));
    this.terminar(entrada.item, 'erro', TEXTO_ERRO_LOCAL[motivo]);
    this.avisar();
  }

  private canceladoPeloOutroLado(id: number): void {
    // O outro lado desistiu de mandar...
    if (this.entrada?.id === id) {
      const entrada = this.entrada;
      this.entrada = null;
      if (entrada.token) this.opcoes.gravador.descartar(entrada.token);
      this.terminar(entrada.item, 'cancelado', 'cancelado pelo outro computador');
    }
    // ...ou de receber o que estamos mandando (inclusive se o "fim" já foi e
    // cruzou com o cancelamento no caminho: a confirmação não viria nunca).
    const saida = this.enviandoAgora?.id === id ? this.enviandoAgora : this.aguardandoConfirmacao.get(id);
    if (saida) {
      this.aguardandoConfirmacao.delete(id);
      this.terminar(saida.item, 'cancelado', 'cancelado pelo outro computador');
    }
  }

  // -------------------------------------------------------------------------

  /** A sessão acabou: abandona envios e o recebimento em andamento. */
  private abandonarTudo(): void {
    const motivo = 'a sessão foi encerrada';
    for (const saida of this.filaSaida.splice(0)) this.terminar(saida.item, 'cancelado', motivo);
    if (this.enviandoAgora) this.terminar(this.enviandoAgora.item, 'cancelado', motivo);
    for (const saida of this.aguardandoConfirmacao.values()) {
      this.terminar(saida.item, 'erro', 'a sessão acabou antes da confirmação de recebimento');
    }
    this.aguardandoConfirmacao.clear();
    const entrada = this.entrada;
    this.entrada = null;
    if (entrada) {
      if (entrada.token) this.opcoes.gravador.descartar(entrada.token);
      this.terminar(entrada.item, 'cancelado', motivo);
    }
  }

  private novoItem(direcao: Transferencia['direcao'], nome: string, tamanho: number): Transferencia {
    const item: Transferencia = {
      chave: `t${this.proximaChave++}`,
      direcao,
      nome,
      tamanho,
      transferidos: 0,
      estado: 'na_fila',
    };
    this.itens.push(item);
    return item;
  }

  private terminar(item: Transferencia, estado: 'concluido' | 'cancelado' | 'erro', motivo?: string): void {
    if (terminado(item.estado)) return;
    item.estado = estado;
    if (motivo) item.motivo = motivo;
  }

  private agora(): number {
    return (this.opcoes.agora ?? Date.now)();
  }

  private avisar(): void {
    clearTimeout(this.avisoPendente);
    this.avisoPendente = undefined;
    this.ultimoAviso = this.agora();
    // Cópias: quem desenha não deve mexer nos itens (nem ver mudanças pela metade).
    this.opcoes.aoMudar(this.itens.map((item) => ({ ...item })));
  }

  /** Progresso: avisa no máximo uma vez por intervalo (e garante o último aviso). */
  private avisarDevagar(): void {
    const intervalo = this.opcoes.intervaloProgressoMs ?? 200;
    const falta = this.ultimoAviso + intervalo - this.agora();
    if (falta <= 0) this.avisar();
    else this.avisoPendente ??= setTimeout(() => this.avisar(), falta);
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminado(estado: EstadoTransferencia): boolean {
  return estado === 'concluido' || estado === 'cancelado' || estado === 'erro';
}

function json(mensagem: MensagemArquivos): string {
  return JSON.stringify(mensagem);
}
