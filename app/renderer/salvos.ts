// "Salvar este computador": o pedido de salvar só vale se a conexão der
// certo (senha conferida ou pedido aceito). Assim uma senha digitada errada
// (ou um ID que recusou) nunca fica guardada.
import type { IdCliente } from '@acesso-remoto/shared';
import type { EstadoSessao } from './sessao';

export interface PedidoSalvar {
  id: IdCliente;
  apelido: string;
  /** A senha usada nesta conexão (undefined: conectou sem senha, mantém a salva). */
  senha: string | undefined;
}

export class SalvarAoConectar {
  private pendente: PedidoSalvar | null = null;

  /** Ao conectar com a caixa "Salvar" marcada (ou null, se desmarcada). */
  pedir(pedido: PedidoSalvar | null): void {
    this.pendente = pedido;
  }

  /**
   * A cada mudança da sessão: devolve o que salvar quando a sessão com esse
   * computador fica liberada; descarta o pedido se a tentativa acabar antes.
   */
  aoMudarEstado(estado: EstadoSessao): PedidoSalvar | null {
    const pendente = this.pendente;
    if (!pendente) return null;
    if (estado.fase === 'em_sessao' && estado.papel === 'visualizador' && estado.parceiro === pendente.id && estado.liberada) {
      this.pendente = null;
      return pendente;
    }
    // Recusado, senha errada, falha, cancelado: não salva nada.
    if (estado.fase === 'livre') this.pendente = null;
    return null;
  }
}
