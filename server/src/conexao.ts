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
  | { tipo: 'pedido_recebido'; visualizador: Conexao; comSenha: boolean }
  | { tipo: 'em_sessao'; parceiro: Conexao; papel: Papel; porSenha: boolean }
  /**
   * Em sessão com alguém que não está ligado a esta conexão agora: o parceiro
   * caiu do servidor, ou esta conexão voltou (queda, reinício do servidor) e
   * declarou a sessão com "retomar". A conexão direta segue sem o servidor;
   * quando o parceiro declarar a mesma sessão, os dois voltam a "em_sessao".
   * Enquanto isso, conta como ocupado. "prazo": o parceiro já voltou ao
   * servidor e tem esse tempo para declarar a sessão (senão ela acabou).
   * "ipParceiro": IP de quem saiu (se foi ele que caiu), para ainda contar
   * uma senha recusada nesse meio-tempo (limite contra força bruta).
   */
  | {
      tipo: 'retomando';
      parceiro: IdCliente;
      papel: Papel;
      porSenha: boolean;
      ipParceiro: string | null;
      prazo: ReturnType<typeof setTimeout> | undefined;
    };

export interface Conexao {
  readonly socket: WebSocket;
  /** IP de quem conectou, já como chave dos limites (IPv6 agrupado por /64). */
  readonly ip: string;
  id: IdCliente | null;
  /**
   * Registro em andamento: a chave apresentada e o desafio que ela precisa
   * assinar. "provando" fica true enquanto o servidor busca o ID no banco.
   */
  registro: { chavePublica: string; desafio: string; provando?: boolean } | null;
  /** Vira false a cada ping e volta a true quando chega o pong. */
  viva: boolean;
  vinculo: Vinculo;
}

/** Conexão que já recebeu um ID. */
export type ConexaoRegistrada = Conexao & { id: IdCliente };
