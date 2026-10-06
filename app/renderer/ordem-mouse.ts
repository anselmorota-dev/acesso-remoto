// Ordem dos movimentos do mouse no anfitrião.
//
// O "mover" vai por um canal sem ordem e sem retransmissão (canal "mouse"):
// numa rede com perda, um pacote perdido não segura os movimentos seguintes,
// e o próximo já traz a posição mais nova. Em troca, um movimento antigo pode
// chegar depois de um novo; esta regra descarta os atrasados (pelo número de
// sequência), para a seta não "voltar". O clique (que vai pelo canal confiável)
// leva o número do último movimento enviado: os mais antigos que ele também
// são descartados, para nada mexer no mouse depois de um clique.
import type { EventoInput } from '@acesso-remoto/shared';

export class OrdemMouse {
  /** Maior número de sequência já visto (movimento executado ou clique). */
  private ultimo = -1;

  /** true se o evento deve ser executado. */
  aceitar(evento: EventoInput): boolean {
    if (evento.tipo !== 'mouse_mover' && evento.tipo !== 'mouse_botao') return true;
    // Sem número (versão anterior do visualizador): executa como sempre.
    if (evento.n === undefined) return true;
    if (evento.tipo === 'mouse_botao') {
      this.ultimo = Math.max(this.ultimo, evento.n);
      return true; // clique e soltar sempre valem
    }
    if (evento.n <= this.ultimo) return false; // chegou atrasado
    this.ultimo = evento.n;
    return true;
  }
}

/** Visualizador: numera os movimentos e diz aos cliques qual foi o último. */
export class NumeradorMouse {
  private proximo = 0;
  private ultimoEnviado = -1;

  /** Põe o número de sequência no evento (só movimentos e cliques). */
  numerar(evento: EventoInput): EventoInput {
    if (evento.tipo === 'mouse_mover') {
      this.ultimoEnviado = this.proximo++;
      return { ...evento, n: this.ultimoEnviado };
    }
    if (evento.tipo === 'mouse_botao' && this.ultimoEnviado >= 0) return { ...evento, n: this.ultimoEnviado };
    return evento;
  }
}
