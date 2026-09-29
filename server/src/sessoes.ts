// Pedidos de conexão e sessões entre apps.
//
// Fluxo: visualizador manda "conectar" → anfitrião recebe "pedido_conexao"
// → anfitrião responde → se aceito, os dois recebem "sessao_iniciada" e a
// partir daí (e só então) o servidor repassa sinais WebRTC entre eles.
// Isso impede que alguém mande sinalização para um ID qualquer: os
// candidatos ICE revelam o IP, então só circulam depois do aceite.
//
// Várias sessões: o visualizador acessa até MAXIMO_SESSOES computadores ao
// mesmo tempo; cada conexão guarda um vínculo por parceiro, e as mensagens de
// sessão dizem com quem são ("parceiro"). O anfitrião tem no máximo um
// vínculo, e só recebe pedidos se estiver totalmente livre (nem acessando
// outros: escolha do usuário).
//
// Sessões longas: depois de conectados, vídeo e comandos vão direto entre os
// dois computadores, então a sessão sobrevive a uma queda do servidor (ou de
// um dos lados em relação a ele). Quem fica fica "retomando"; quem volta
// declara a sessão com "retomar"; quando os dois lados declaram a mesma
// sessão, o servidor os liga de novo ("sessao_retomada").
import {
  MAXIMO_SESSOES,
  type CodigoErro,
  type IdCliente,
  type MensagemDoServidor,
  type MotivoEncerramento,
  type Papel,
  type Sinal,
} from '@acesso-remoto/shared';
import type { Conexao, ConexaoRegistrada, Vinculo } from './conexao.js';
import type { LimitesServidor } from './limites.js';
import type { ProvedorTurn } from './turn.js';

export interface OpcoesSessoes {
  registrados: ReadonlyMap<IdCliente, Conexao>;
  enviar: (conexao: Conexao, mensagem: MensagemDoServidor) => void;
  enviarErro: (conexao: Conexao, codigo: CodigoErro, mensagem: string, parceiro?: IdCliente) => void;
  /** Quanto tempo o anfitrião tem para aceitar ou recusar. */
  prazoRespostaMs: number;
  /**
   * Quanto tempo quem voltou ao servidor tem para declarar a sessão em que
   * estava ("retomar"). O app declara logo depois de se registrar; se não
   * declarar, é porque a sessão acabou do lado dele (ex.: o app foi reaberto).
   */
  prazoRetomadaMs: number;
  /** Bloqueio de quem erra a senha demais (o servidor sabe pelo motivo do encerramento). */
  limites: Pick<LimitesServidor, 'podeTentarSenha' | 'falhaSenha'>;
  /** Credenciais temporárias de TURN para cada sessão (sem isto: só STUN). */
  turn?: ProvedorTurn;
  log: (mensagem: string) => void;
}

/** Chave de uma sessão pelos dois IDs (na mesma ordem, venha de qual lado vier). */
const chaveSessao = (a: IdCliente, b: IdCliente) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** A conexão está do lado anfitrião de algum pedido ou sessão? */
function hospedando(conexao: Conexao): boolean {
  for (const v of conexao.vinculos.values()) {
    if (v.tipo === 'pedido_recebido' || ((v.tipo === 'em_sessao' || v.tipo === 'retomando') && v.papel === 'anfitriao')) return true;
  }
  return false;
}

export function criarGerenciadorSessoes(opcoes: OpcoesSessoes) {
  const { registrados, enviar, enviarErro, prazoRespostaMs, prazoRetomadaMs, limites, turn, log } = opcoes;
  /** Usuário TURN de cada sessão em andamento, para revogar no fim. */
  const turnPorSessao = new Map<string, string>();

  /**
   * A sessão acabou de vez (alguém encerrou, ou o parceiro voltou sem ela):
   * as credenciais de TURN dela deixam de valer. Quedas do servidor não
   * contam (a conexão direta pode seguir pelo TURN sem o servidor).
   */
  function revogarTurn(a: IdCliente | null, b: IdCliente): void {
    if (!a) return;
    const chave = chaveSessao(a, b);
    const usuario = turnPorSessao.get(chave);
    if (!usuario) return;
    turnPorSessao.delete(chave);
    turn?.revogar(usuario);
  }

  /** Tira o vínculo da conexão com esse parceiro (e cancela o prazo dele, se houver). */
  function desfazer(conexao: Conexao, parceiro: IdCliente): void {
    const vinculo = conexao.vinculos.get(parceiro);
    if (!vinculo) return;
    if (vinculo.tipo === 'pedindo' || vinculo.tipo === 'retomando') clearTimeout(vinculo.prazo);
    conexao.vinculos.delete(parceiro);
  }

  /** Encerra a sessão de quem esperava um parceiro que não vai mais retomá-la. */
  function desistirDaRetomada(conexao: Conexao, parceiro: IdCliente): void {
    if (conexao.vinculos.get(parceiro)?.tipo !== 'retomando') return;
    desfazer(conexao, parceiro);
    revogarTurn(conexao.id, parceiro);
    enviar(conexao, { tipo: 'sessao_encerrada', parceiro, motivo: 'parceiro_desconectou' });
    log(`[server] sessão ${conexao.id} ↔ ${parceiro} encerrada: o parceiro voltou sem ela`);
  }

  /** O parceiro esperado já está no servidor: ele tem um prazo para declarar a sessão. */
  function iniciarPrazoRetomada(conexao: Conexao, parceiro: IdCliente): void {
    const vinculo = conexao.vinculos.get(parceiro);
    if (vinculo?.tipo !== 'retomando' || vinculo.prazo) return;
    vinculo.prazo = setTimeout(() => {
      if (conexao.vinculos.get(parceiro) === vinculo) desistirDaRetomada(conexao, parceiro);
    }, prazoRetomadaMs);
  }

  function conectar(visualizador: ConexaoRegistrada, destino: IdCliente, comSenha: boolean): void {
    if (destino === visualizador.id) {
      enviarErro(visualizador, 'destino_invalido', 'Não é possível acessar o próprio computador', destino);
      return;
    }
    // Quem está sendo acessado (ou tem um pedido para responder) não acessa outros.
    if (hospedando(visualizador) || visualizador.vinculos.has(destino)) {
      enviarErro(visualizador, 'ja_em_sessao', 'Já existe um pedido ou sessão em andamento', destino);
      return;
    }
    if (visualizador.vinculos.size >= MAXIMO_SESSOES) {
      enviarErro(visualizador, 'limite_sessoes', `No máximo ${MAXIMO_SESSOES} computadores ao mesmo tempo`, destino);
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
    // O destino ainda espera retomar uma sessão com quem está pedindo agora:
    // se este lado pede uma conexão nova, a antiga já acabou para ele.
    if (anfitriao.vinculos.get(visualizador.id)?.tipo === 'retomando') desistirDaRetomada(anfitriao, visualizador.id);
    // Só recebe quem está totalmente livre (nem sendo acessado, nem acessando outros).
    if (anfitriao.vinculos.size > 0) {
      enviar(visualizador, { tipo: 'pedido_recusado', destino, motivo: 'ocupado' });
      return;
    }

    // Se o anfitrião não responder a tempo, o pedido expira para os dois.
    const prazo = setTimeout(() => {
      desfazer(visualizador, destino);
      desfazer(anfitriao, visualizador.id);
      enviar(visualizador, { tipo: 'pedido_recusado', destino, motivo: 'sem_resposta' });
      enviar(anfitriao, { tipo: 'pedido_cancelado', origem: visualizador.id });
    }, prazoRespostaMs);

    visualizador.vinculos.set(destino, { tipo: 'pedindo', anfitriao, prazo });
    anfitriao.vinculos.set(visualizador.id, { tipo: 'pedido_recebido', visualizador, comSenha });
    enviar(anfitriao, { tipo: 'pedido_conexao', origem: visualizador.id, prazoMs: prazoRespostaMs, comSenha });
    log(`[server] pedido ${visualizador.id} → ${destino}${comSenha ? ' (com senha)' : ''}`);
  }

  function responder(anfitriao: ConexaoRegistrada, origem: IdCliente, aceito: boolean, porSenha: boolean): void {
    const vinculo = anfitriao.vinculos.get(origem);
    // Só vale responder ao pedido que está de fato pendente para este anfitrião.
    if (vinculo?.tipo !== 'pedido_recebido') {
      enviarErro(anfitriao, 'pedido_inexistente', `Não há pedido pendente de ${origem}`, origem);
      return;
    }
    // "Aceito por senha" só existe para quem veio com senha: senão o anfitrião
    // pularia o aceite com o visualizador achando que passou por uma senha.
    if (aceito && porSenha && !vinculo.comSenha) {
      enviarErro(anfitriao, 'mensagem_invalida', 'Aceite por senha só vale para pedido com senha', origem);
      return;
    }
    if (!aceito) {
      desfazer(vinculo.visualizador, anfitriao.id);
      desfazer(anfitriao, origem);
      enviar(vinculo.visualizador, { tipo: 'pedido_recusado', destino: anfitriao.id, motivo: 'recusado' });
      log(`[server] pedido ${origem} → ${anfitriao.id} recusado`);
      return;
    }
    void aceitar(anfitriao, vinculo, porSenha);
  }

  /**
   * Pedido aceito: gera as credenciais de TURN (se houver) e só então inicia a
   * sessão. Enquanto a API responde, o pedido continua pendente (pode expirar
   * ou ser cancelado como sempre); depois, só vale se continuar o mesmo.
   */
  async function aceitar(
    anfitriao: ConexaoRegistrada,
    pedido: Extract<Vinculo, { tipo: 'pedido_recebido' }>,
    porSenha: boolean,
  ): Promise<void> {
    const visualizador = pedido.visualizador;
    const credenciais = turn ? await turn.gerar() : null;
    const doVisualizador = visualizador.id ? visualizador.vinculos.get(anfitriao.id) : undefined;
    const aindaPendente =
      visualizador.id !== null &&
      anfitriao.vinculos.get(visualizador.id) === pedido &&
      doVisualizador?.tipo === 'pedindo' &&
      doVisualizador.anfitriao === anfitriao;
    if (!aindaPendente || !visualizador.id) {
      // Cancelado, expirado ou respondido de novo nesse meio-tempo: nada de sessão.
      if (credenciais) turn?.revogar(credenciais.usuario);
      return;
    }

    desfazer(visualizador, anfitriao.id);
    desfazer(anfitriao, visualizador.id);
    visualizador.vinculos.set(anfitriao.id, { tipo: 'em_sessao', parceiro: anfitriao, papel: 'visualizador', porSenha });
    anfitriao.vinculos.set(visualizador.id, { tipo: 'em_sessao', parceiro: visualizador, papel: 'anfitriao', porSenha });
    if (credenciais) turnPorSessao.set(chaveSessao(visualizador.id, anfitriao.id), credenciais.usuario);
    const ice = credenciais ? { iceServers: credenciais.servidores } : {};
    enviar(visualizador, { tipo: 'sessao_iniciada', parceiro: anfitriao.id, papel: 'visualizador', porSenha, ...ice });
    enviar(anfitriao, { tipo: 'sessao_iniciada', parceiro: visualizador.id, papel: 'anfitriao', porSenha, ...ice });
    log(`[server] sessão iniciada ${visualizador.id} → ${anfitriao.id}${porSenha ? ' (por senha)' : ''}${credenciais ? ' com TURN' : ''}`);
  }

  /**
   * Quem voltou ao servidor declara uma sessão em que continua. Só religa
   * quando os DOIS lados declaram a mesma sessão (um o parceiro do outro,
   * papéis opostos): ninguém consegue se ligar a um ID que não o espera. O ID
   * de cada lado já foi provado pela chave da instalação.
   */
  function retomar(conexao: ConexaoRegistrada, parceiro: IdCliente, papel: Papel, porSenha: boolean): void {
    if (parceiro === conexao.id) {
      enviarErro(conexao, 'destino_invalido', 'Uma sessão não pode ser com o próprio computador', parceiro);
      return;
    }
    // Mesmas regras de conectar: anfitrião só com uma sessão; visualizador até o limite.
    const conflito =
      conexao.vinculos.has(parceiro) ||
      (papel === 'anfitriao' ? conexao.vinculos.size > 0 : hospedando(conexao));
    if (conflito) {
      enviarErro(conexao, 'ja_em_sessao', 'Já existe um pedido ou sessão em andamento', parceiro);
      return;
    }
    if (conexao.vinculos.size >= MAXIMO_SESSOES) {
      enviarErro(conexao, 'limite_sessoes', `No máximo ${MAXIMO_SESSOES} computadores ao mesmo tempo`, parceiro);
      return;
    }

    const outra = registrados.get(parceiro);
    const espera = outra?.vinculos.get(conexao.id);
    if (outra && espera?.tipo === 'retomando' && espera.papel !== papel && espera.porSenha === porSenha) {
      clearTimeout(espera.prazo);
      conexao.vinculos.set(parceiro, { tipo: 'em_sessao', parceiro: outra, papel, porSenha });
      outra.vinculos.set(conexao.id, { tipo: 'em_sessao', parceiro: conexao, papel: espera.papel, porSenha });
      enviar(conexao, { tipo: 'sessao_retomada', parceiro });
      enviar(outra, { tipo: 'sessao_retomada', parceiro: conexao.id });
      log(`[server] sessão retomada ${conexao.id} ↔ ${parceiro}`);
      return;
    }

    // O parceiro ainda não voltou (ou não declarou ainda): espera por ele.
    conexao.vinculos.set(parceiro, { tipo: 'retomando', parceiro, papel, porSenha, ipParceiro: null, prazo: undefined });
    // Se ele já está no servidor, tem um prazo para declarar a sessão.
    if (outra) iniciarPrazoRetomada(conexao, parceiro);
  }

  /** Uma instalação acabou de se registrar: quem esperava por ela começa a contar o prazo. */
  function aoRegistrar(conexao: ConexaoRegistrada): void {
    // Poucos apps online: percorrer todos é simples e barato.
    for (const outra of registrados.values()) {
      if (outra.vinculos.get(conexao.id)?.tipo === 'retomando') iniciarPrazoRetomada(outra, conexao.id);
    }
  }

  function repassarSinal(conexao: ConexaoRegistrada, parceiro: IdCliente, sinal: Sinal): void {
    const vinculo = conexao.vinculos.get(parceiro);
    if (vinculo?.tipo !== 'em_sessao') {
      enviarErro(conexao, 'sem_sessao', 'Sinal WebRTC fora de uma sessão', parceiro);
      return;
    }
    enviar(vinculo.parceiro, { tipo: 'sinal', parceiro: conexao.id, sinal });
  }

  /** Desfaz o pedido ou a sessão com esse parceiro (pedido do app), avisando o outro lado. */
  function encerrar(conexao: Conexao, parceiro: IdCliente, motivo: MotivoEncerramento): void {
    const vinculo = conexao.vinculos.get(parceiro);
    if (!vinculo) return;
    switch (vinculo.tipo) {
      case 'pedindo': {
        // Visualizador desistiu antes da resposta.
        desfazer(conexao, parceiro);
        if (conexao.id) {
          desfazer(vinculo.anfitriao, conexao.id);
          enviar(vinculo.anfitriao, { tipo: 'pedido_cancelado', origem: conexao.id });
        }
        return;
      }
      case 'pedido_recebido': {
        // Anfitrião saiu sem responder: para quem pediu, equivale a estar offline.
        desfazer(conexao, parceiro);
        if (conexao.id) {
          desfazer(vinculo.visualizador, conexao.id);
          const recusa = motivo === 'parceiro_desconectou' ? 'offline' : 'recusado';
          enviar(vinculo.visualizador, { tipo: 'pedido_recusado', destino: conexao.id, motivo: recusa });
        }
        return;
      }
      case 'em_sessao': {
        // O anfitrião recusou a senha: conta um erro para o IP de quem tentou.
        // Só vale em sessão por senha (senão um anfitrião com defeito poderia
        // "acusar" quem ele aceitou manualmente).
        if (senhaRecusada(motivo) && vinculo.papel === 'anfitriao' && vinculo.porSenha && conexao.id) {
          limites.falhaSenha(vinculo.parceiro.ip, conexao.id);
        }
        desfazer(conexao, parceiro);
        if (conexao.id) {
          desfazer(vinculo.parceiro, conexao.id);
          revogarTurn(conexao.id, parceiro);
          enviar(vinculo.parceiro, { tipo: 'sessao_encerrada', parceiro: conexao.id, motivo });
        }
        log(`[server] sessão encerrada ${conexao.id} ↔ ${parceiro} (${motivo})`);
        return;
      }
      case 'retomando':
        // Senha recusada enquanto o visualizador está fora do servidor (ex.:
        // saiu de propósito logo depois de conectar): ainda conta o erro.
        if (senhaRecusada(motivo) && vinculo.papel === 'anfitriao' && vinculo.porSenha && vinculo.ipParceiro && conexao.id) {
          limites.falhaSenha(vinculo.ipParceiro, conexao.id);
        }
        // O parceiro não está ligado a esta conexão: não há a quem avisar aqui
        // (se a conexão direta ainda existir, o app avisa por ela).
        desfazer(conexao, parceiro);
        revogarTurn(conexao.id, parceiro);
        log(`[server] sessão encerrada ${conexao.id} ↔ ${parceiro} (${motivo}, sem o parceiro no servidor)`);
        return;
    }
  }

  /**
   * A conexão caiu (ou foi substituída por uma nova da mesma instalação).
   * Pedidos acabam; sessões não: cada parceiro passa a esperar a retomada.
   */
  function desconectou(conexao: Conexao): void {
    for (const [parceiro, vinculo] of [...conexao.vinculos]) {
      if (vinculo.tipo === 'em_sessao' && conexao.id) {
        const outro = vinculo.parceiro;
        const doOutro = outro.vinculos.get(conexao.id);
        desfazer(conexao, parceiro);
        if (doOutro?.tipo !== 'em_sessao') continue; // não deveria acontecer
        outro.vinculos.set(conexao.id, {
          tipo: 'retomando',
          parceiro: conexao.id,
          papel: doOutro.papel,
          porSenha: vinculo.porSenha,
          ipParceiro: conexao.ip,
          prazo: undefined,
        });
        enviar(outro, { tipo: 'parceiro_ausente', parceiro: conexao.id });
        log(`[server] ${conexao.id} saiu no meio da sessão com ${outro.id}: aguardando a retomada`);
      } else if (vinculo.tipo === 'retomando') {
        desfazer(conexao, parceiro);
      } else {
        encerrar(conexao, parceiro, 'parceiro_desconectou');
      }
    }
  }

  return { conectar, responder, retomar, aoRegistrar, repassarSinal, encerrar, desconectou };
}

function senhaRecusada(motivo: MotivoEncerramento): boolean {
  return motivo === 'senha_incorreta' || motivo === 'senha_bloqueada';
}
