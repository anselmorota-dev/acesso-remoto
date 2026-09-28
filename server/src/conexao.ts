// Estado que o servidor guarda de cada conexão aberta.
import type { WebSocket } from 'ws';
import type { IdCliente, Papel } from '@acesso-remoto/shared';

/**
 * Em que situação a conexão está em relação a outra.
 * Os dois lados são sempre atualizados juntos: se A está "pedindo" para B,
 * B está com "pedido_recebido" de A; se A está "em_sessao" com B, B também.
 */
export type Vinculo =
  | { tipo: 'livre' }
  /** Visualizador aguardando o anfitrião responder. */
  | { tipo: 'pedindo'; anfitriao: Conexao; prazo: ReturnType<typeof setTimeout> }
  /** Anfitrião com um pedido para responder. */
  | { tipo: 'pedido_recebido'; visualizador: Conexao }
  | { tipo: 'em_sessao'; parceiro: Conexao; papel: Papel };

export interface Conexao {
  readonly socket: WebSocket;
  id: IdCliente | null;
  /** Vira false a cada ping e volta a true quando chega o pong. */
  viva: boolean;
  vinculo: Vinculo;
}

/** Conexão que já recebeu um ID. */
export type ConexaoRegistrada = Conexao & { id: IdCliente };
