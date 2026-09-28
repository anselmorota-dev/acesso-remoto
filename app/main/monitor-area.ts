// Monitor da área de transferência (texto) durante a sessão. Puro: recebe o
// acesso à área do sistema por injeção, para ser testado sem o Electron.
//
// O sistema não avisa quando algo é copiado, então o monitor confere de
// tempos em tempos e avisa quando o texto muda. O texto que chega do outro
// computador é escrito aqui e anotado como "já visto", para não voltar
// (sem eco entre os dois lados).
//
// O clipboard do Electron é assíncrono: leituras e escritas passam por uma
// fila, uma de cada vez. Sem isso, uma conferência em andamento poderia ler
// o texto recém-recebido antes de ele ser anotado e mandá-lo de volta.
import { TEXTO_AREA_TRANSFERENCIA_MAXIMO } from '@acesso-remoto/shared';

export interface AreaDoSistema {
  lerTexto(): Promise<string>;
  escreverTexto(texto: string): Promise<void>;
  /**
   * Número que muda a cada cópia, consultado sem abrir a área (Windows). Com
   * ele, o texto só é lido quando algo mudou; sem ele, lê a cada conferência.
   */
  contadorDeMudancas?: () => number;
}

export interface OpcoesMonitor {
  area: AreaDoSistema;
  /** Texto novo copiado neste computador; null se for grande demais para enviar. */
  aoCopiar: (texto: string | null) => void;
  intervaloMs?: number;
}

const INTERVALO_PADRAO_MS = 500;

export class MonitorAreaTransferencia {
  private readonly opcoes: OpcoesMonitor;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Último texto visto (copiado aqui ou recebido do outro lado). */
  private ultimo = '';
  /** Valor do contador de mudanças na última leitura (null: ler na próxima conferência). */
  private ultimoContador: number | null = null;
  /** Operações com a área do sistema, uma de cada vez. */
  private fila: Promise<void> = Promise.resolve();
  /** Já há uma conferência na fila (não precisa de outra). */
  private conferenciaNaFila = false;

  constructor(opcoes: OpcoesMonitor) {
    this.opcoes = opcoes;
  }

  get ligado(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Começa a acompanhar. "enviarAtual": o que já está copiado conta como novo
   * (o visualizador, que costuma copiar algo antes de conectar para colar lá).
   * Senão, só o que for copiado daqui em diante.
   */
  ligar(enviarAtual: boolean): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.conferir(), this.opcoes.intervaloMs ?? INTERVALO_PADRAO_MS);
    this.emFila(async () => {
      this.ultimoContador = enviarAtual ? null : this.contador();
      this.ultimo = enviarAtual ? '' : await this.ler();
    });
    if (enviarAtual) this.conferir();
  }

  desligar(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Escreve o texto recebido do outro lado (só com o monitor ligado, isto é, em sessão). */
  escrever(texto: string): Promise<boolean> {
    if (!this.timer) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.emFila(async () => {
        if (!this.timer) return resolve(false); // a sessão acabou enquanto esperava
        await this.opcoes.area.escreverTexto(texto);
        // Anota como o sistema devolve (pode normalizar algo), para não reenviar.
        this.ultimoContador = this.contador();
        this.ultimo = await this.ler();
        resolve(true);
      });
    });
  }

  /** Espera as operações pendentes (usado nos testes). */
  ocioso(): Promise<void> {
    return this.fila;
  }

  private emFila(operacao: () => Promise<void>): void {
    this.fila = this.fila.then(operacao).catch((erro: unknown) => {
      console.warn('[area] falha ao acessar a área de transferência:', erro);
    });
  }

  private async ler(): Promise<string> {
    try {
      return await this.opcoes.area.lerTexto();
    } catch {
      // Área ocupada por outro programa: tenta na próxima (mesmo que o contador não mude).
      this.ultimoContador = null;
      return this.ultimo;
    }
  }

  /** Contador de mudanças agora (null se não houver contador neste sistema). */
  private contador(): number | null {
    try {
      return this.opcoes.area.contadorDeMudancas?.() ?? null;
    } catch {
      return null;
    }
  }

  private conferir(): void {
    if (this.conferenciaNaFila) return;
    // Com contador: nada mudou desde a última leitura, nem abre a área.
    const contador = this.contador();
    if (contador !== null && contador === this.ultimoContador) return;
    this.conferenciaNaFila = true;
    this.emFila(async () => {
      this.conferenciaNaFila = false;
      if (!this.timer) return;
      this.ultimoContador = this.contador();
      const texto = await this.ler();
      if (texto === this.ultimo || !this.timer) return;
      this.ultimo = texto;
      // Vazio: copiaram algo que não é texto (ex.: uma imagem). Nada a enviar.
      if (!texto) return;
      this.opcoes.aoCopiar(texto.length > TEXTO_AREA_TRANSFERENCIA_MAXIMO ? null : texto);
    });
  }
}
