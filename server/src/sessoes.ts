// Pedidos de conexão e sessões entre dois apps.
//
// Fluxo: visualizador manda "conectar" → anfitrião recebe "pedido_conexao"
// → anfitrião responde → se aceito, os dois recebem "sessao_iniciada" e a
// partir daí (e só então) o servidor repassa sinais WebRTC entre eles.
// Isso impede que alguém mande sinalização para um ID qualquer: os
// candidatos ICE revelam o IP, então só circulam depois do aceite.
import type {
  CodigoErro,
  IdCliente,
  MensagemDoServidor,
  MotivoEncerramento,
  Sinal,
} from '@acesso-remoto/shared';
import type { Conexao, ConexaoRegistrada } from './conexao.js';
import type { LimitesServidor } from './limites.js';

export interface OpcoesSessoes {
  registrados: ReadonlyMap<IdCliente, Conexao>;
  enviar: (conexao: Conexao, mensagem: MensagemDoServidor) => void;
  enviarErro: (conexao: Conexao, codigo: CodigoErro, mensagem: string) => void;
  /** Quanto tempo o anfitrião tem para aceitar ou recusar. */
  prazoRespostaMs: number;
  /** Bloqueio de quem erra a senha demais (o servidor sabe pelo motivo do encerramento). */
  limites: Pick<LimitesServidor, 'podeTentarSenha' | 'falhaSenha'>;
  log: (mensagem: string) => void;
}

export function criarGerenciadorSessoes(opcoes: OpcoesSessoes) {
  const { registrados, enviar, enviarErro, prazoRespostaMs, limites, log } = opcoes;

  function liberar(...conexoes: Conexao[]): void {
    for (const conexao of conexoes) {
      if (conexao.vinculo.tipo === 'pedindo') clearTimeout(conexao.vinculo.prazo);
      conexao.vinculo = { tipo: 'livre' };
    }
  }

  function conectar(visualizador: ConexaoRegistrada, destino: IdCliente, comSenha: boolean): void {
    if (visualizador.vinculo.tipo !== 'livre') {
      enviarErro(visualizador, 'ja_em_sessao', 'Já existe um pedido ou sessão em andamento');
      return;
    }
    if (destino === visualizador.id) {
      enviarErro(visualizador, 'destino_invalido', 'Não é possível acessar o próprio computador');
      return;
    }
    // Quem errou a senha demais nem chega ao anfitrião: sem pedido, sem
    // conexão direta, sem descobrir o IP dele.
    if (comSenha && !limites.podeTentarSenha(visualizador.ip, destino)) {
      enviar(visualizador, { tipo: 'pedido_recusado', destino, motivo: 'bloqueado' });
      log(`[server] acesso com senha a ${destino} bloqueado (tentativas demais)`);
      return;
    }

    const anfitriao = registrados.get(destino);
    if (!anfitriao) {
      enviar(visualizador, { tipo: 'pedido_recusado', destino, motivo: 'offline' });
      return;
    }
    if (anfitriao.vinculo.tipo !== 'livre') {
      enviar(visualizador, { tipo: 'pedido_recusado', destino, motivo: 'ocupado' });
      return;
    }

    // Se o anfitrião não responder a tempo, o pedido expira para os dois.
    const prazo = setTimeout(() => {
      liberar(visualizador, anfitriao);
      enviar(visualizador, { tipo: 'pedido_recusado', destino, motivo: 'sem_resposta' });
      enviar(anfitriao, { tipo: 'pedido_cancelado', origem: visualizador.id });
    }, prazoRespostaMs);

    visualizador.vinculo = { tipo: 'pedindo', anfitriao, prazo };
    anfitriao.vinculo = { tipo: 'pedido_recebido', visualizador, comSenha };
    enviar(anfitriao, { tipo: 'pedido_conexao', origem: visualizador.id, prazoMs: prazoRespostaMs, comSenha });
    log(`[server] pedido ${visualizador.id} → ${destino}${comSenha ? ' (com senha)' : ''}`);
  }

  function responder(anfitriao: ConexaoRegistrada, origem: IdCliente, aceito: boolean, porSenha: boolean): void {
    const vinculo = anfitriao.vinculo;
    // Só vale responder ao pedido que está de fato pendente para este anfitrião.
    if (vinculo.tipo !== 'pedido_recebido' || vinculo.visualizador.id !== origem) {
      enviarErro(anfitriao, 'pedido_inexistente', `Não há pedido pendente de ${origem}`);
      return;
    }
    // "Aceito por senha" só existe para quem veio com senha: senão o anfitrião
    // pularia o aceite com o visualizador achando que passou por uma senha.
    if (aceito && porSenha && !vinculo.comSenha) {
      enviarErro(anfitriao, 'mensagem_invalida', 'Aceite por senha só vale para pedido com senha');
      return;
    }
    const visualizador = vinculo.visualizador;
    const sessaoPorSenha = aceito && porSenha;
    liberar(visualizador, anfitriao);

    if (!aceito) {
      enviar(visualizador, { tipo: 'pedido_recusado', destino: anfitriao.id, motivo: 'recusado' });
      log(`[server] pedido ${origem} → ${anfitriao.id} recusado`);
      return;
    }

    visualizador.vinculo = { tipo: 'em_sessao', parceiro: anfitriao, papel: 'visualizador', porSenha: sessaoPorSenha };
    anfitriao.vinculo = { tipo: 'em_sessao', parceiro: visualizador, papel: 'anfitriao', porSenha: sessaoPorSenha };
    enviar(visualizador, { tipo: 'sessao_iniciada', parceiro: anfitriao.id, papel: 'visualizador', porSenha: sessaoPorSenha });
    enviar(anfitriao, { tipo: 'sessao_iniciada', parceiro: origem, papel: 'anfitriao', porSenha: sessaoPorSenha });
    log(`[server] sessão iniciada ${origem} → ${anfitriao.id}${sessaoPorSenha ? ' (por senha)' : ''}`);
  }

  function repassarSinal(conexao: Conexao, sinal: Sinal): void {
    if (conexao.vinculo.tipo !== 'em_sessao') {
      enviarErro(conexao, 'sem_sessao', 'Sinal WebRTC fora de uma sessão');
      return;
    }
    enviar(conexao.vinculo.parceiro, { tipo: 'sinal', sinal });
  }

  /**
   * Desfaz o vínculo da conexão, avisando o outro lado.
   * Usado tanto no "encerrar" quanto quando a conexão cai.
   */
  function encerrar(conexao: Conexao, motivo: MotivoEncerramento): void {
    const vinculo = conexao.vinculo;
    switch (vinculo.tipo) {
      case 'livre':
        return;
      case 'pedindo': {
        // Visualizador desistiu antes da resposta.
        liberar(conexao, vinculo.anfitriao);
        if (conexao.id) enviar(vinculo.anfitriao, { tipo: 'pedido_cancelado', origem: conexao.id });
        return;
      }
      case 'pedido_recebido': {
        // Anfitrião saiu sem responder: para quem pediu, equivale a estar offline.
        liberar(conexao, vinculo.visualizador);
        if (conexao.id) {
          const recusa = motivo === 'parceiro_desconectou' ? 'offline' : 'recusado';
          enviar(vinculo.visualizador, { tipo: 'pedido_recusado', destino: conexao.id, motivo: recusa });
        }
        return;
      }
      case 'em_sessao': {
        // O anfitrião recusou a senha: conta um erro para o IP de quem tentou.
        // Só vale em sessão por senha (senão um anfitrião com defeito poderia
        // "acusar" quem ele aceitou manualmente).
        const senhaRecusada = motivo === 'senha_incorreta' || motivo === 'senha_bloqueada';
        if (senhaRecusada && vinculo.papel === 'anfitriao' && vinculo.porSenha && conexao.id) {
          limites.falhaSenha(vinculo.parceiro.ip, conexao.id);
        }
        liberar(conexao, vinculo.parceiro);
        enviar(vinculo.parceiro, { tipo: 'sessao_encerrada', motivo });
        log(`[server] sessão encerrada ${conexao.id} ↔ ${vinculo.parceiro.id} (${motivo})`);
        return;
      }
    }
  }

  return { conectar, responder, repassarSinal, encerrar };
}
