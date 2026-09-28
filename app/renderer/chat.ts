// Conversa do chat durante a sessão: as mensagens (só em memória) e quantas
// o usuário ainda não viu. Não mexe na interface nem na conexão (é testada
// no Node); a tela e o envio ficam em telas/chat.ts e no main.ts.
import { CHAT_TEXTO_MAXIMO } from '@acesso-remoto/shared';

export interface MensagemChat {
  de: 'eu' | 'outro';
  texto: string;
  /** Horário (ms), para mostrar "14:05". */
  em: number;
}

/** Mensagens guardadas no máximo (as mais antigas saem): um lado não enche a memória do outro. */
export const MENSAGENS_MAXIMAS = 200;

/** Texto pronto para enviar: sem espaços nas pontas; null se vazio ou longo demais. */
export function textoParaEnviar(texto: string): string | null {
  const limpo = texto.trim();
  return limpo && limpo.length <= CHAT_TEXTO_MAXIMO ? limpo : null;
}

export class ConversaChat {
  private readonly lista: MensagemChat[] = [];
  private naoLidasAgora = 0;
  private adicionadas = 0;
  private geracaoAtual = 0;
  private readonly agora: () => number;

  constructor(agora: () => number = Date.now) {
    this.agora = agora;
  }

  get mensagens(): readonly MensagemChat[] {
    return this.lista;
  }

  get naoLidas(): number {
    return this.naoLidasAgora;
  }

  /**
   * Quantas mensagens entraram desde o início da conversa (inclusive as que já
   * saíram da lista por excesso): a tela usa para saber quais são novas.
   */
  get total(): number {
    return this.adicionadas;
  }

  /** Muda a cada limpeza (nova conversa): a tela sabe que precisa redesenhar tudo. */
  get geracao(): number {
    return this.geracaoAtual;
  }

  /** "vista": o usuário já está vendo o chat (aberto e com a janela em foco). */
  adicionar(de: MensagemChat['de'], texto: string, vista: boolean): void {
    this.lista.push({ de, texto, em: this.agora() });
    this.adicionadas++;
    if (this.lista.length > MENSAGENS_MAXIMAS) this.lista.splice(0, this.lista.length - MENSAGENS_MAXIMAS);
    if (de === 'outro' && !vista) this.naoLidasAgora++;
  }

  marcarComoLidas(): void {
    this.naoLidasAgora = 0;
  }

  /** Nova sessão: a conversa anterior some. */
  limpar(): void {
    this.lista.length = 0;
    this.naoLidasAgora = 0;
    this.adicionadas = 0;
    this.geracaoAtual++;
  }
}
