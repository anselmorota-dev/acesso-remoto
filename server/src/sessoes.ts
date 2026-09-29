// Pedidos de conexão e sessões entre dois apps.
//
// Fluxo: visualizador manda "conectar" → anfitrião recebe "pedido_conexao"
// → anfitrião responde → se aceito, os dois recebem "sessao_iniciada" e a
// partir daí (e só então) o servidor repassa sinais WebRTC entre eles.
// Isso impede que alguém mande sinalização para um ID qualquer: os
// candidatos ICE revelam o IP, então só circulam depois do aceite.
//
// Sessões longas: depois de conectados, vídeo e comandos vão direto entre os
// dois computadores, então a sessão sobrevive a uma queda do servidor (ou de
// um dos lados em relação a ele). Quem fica fica "retomando"; quem volta
// declara a sessão com "retomar"; quando os dois lados declaram a mesma
// sessão, o servidor os liga de novo ("sessao_retomada").
import type {
  CodigoErro,
  IdCliente,
  MensagemDoServidor,
  MotivoEncerramento,
  Papel,
  Sinal,
} from '@acesso-remoto/shared';
import type { Conexao, ConexaoRegistrada, Vinculo } from './conexao.js';
import type { LimitesServidor } from './limites.js';
import type { ProvedorTurn } from './turn.js';

export interface OpcoesSessoes {
  registrados: ReadonlyMap<IdCliente, Conexao>;
  enviar: (conexao: Conexao, mensagem: MensagemDoServidor) => void;
  enviarErro: (conexao: Conexao, codigo: CodigoErro, mensagem: string) => void;
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

  function liberar(...conexoes: Conexao[]): void {
    for (const conexao of conexoes) {
      const vinculo = conexao.vinculo;
      if (vinculo.tipo === 'pedindo' || vinculo.tipo === 'retomando') clearTimeout(vinculo.prazo);
      conexao.vinculo = { tipo: 'livre' };
    }
  }

  /** Encerra a sessão de quem esperava um parceiro que não vai mais retomá-la. */
  function desistirDaRetomada(conexao: Conexao): void {
    if (conexao.vinculo.tipo !== 'retomando') return;
    const parceiro = conexao.vinculo.parceiro;
    liberar(conexao);
    revogarTurn(conexao.id, parceiro);
    enviar(conexao, { tipo: 'sessao_encerrada', motivo: 'parceiro_desconectou' });
    log(`[server] sessão ${conexao.id} ↔ ${parceiro} encerrada: o parceiro voltou sem ela`);
  }

  /** O parceiro esperado já está no servidor: ele tem um prazo para declarar a sessão. */
  function iniciarPrazoRetomada(conexao: Conexao): void {
    const vinculo = conexao.vinculo;
    if (vinculo.tipo !== 'retomando' || vinculo.prazo) return;
    vinculo.prazo = setTimeout(() => {
      if (conexao.vinculo === vinculo) desistirDaRetomada(conexao);
    }, prazoRetomadaMs);
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
    // O destino ainda espera retomar uma sessão com quem está pedindo agora:
    // se este lado pede uma conexão nova, a antiga já acabou para ele.
    if (anfitriao.vinculo.tipo === 'retomando' && anfitriao.vinculo.parceiro === visualizador.id) {
      desistirDaRetomada(anfitriao);
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
    if (!aceito) {
      liberar(vinculo.visualizador, anfitriao);
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
    const aindaPendente =
      anfitriao.vinculo === pedido && visualizador.vinculo.tipo === 'pedindo' && visualizador.vinculo.anfitriao === anfitriao;
    if (!aindaPendente || !visualizador.id) {
      // Cancelado, expirado ou respondido de novo nesse meio-tempo: nada de sessão.
      if (credenciais) turn?.revogar(credenciais.usuario);
      return;
    }

    liberar(visualizador, anfitriao);
    visualizador.vinculo = { tipo: 'em_sessao', parceiro: anfitriao, papel: 'visualizador', porSenha };
    anfitriao.vinculo = { tipo: 'em_sessao', parceiro: visualizador, papel: 'anfitriao', porSenha };
    if (credenciais) turnPorSessao.set(chaveSessao(visualizador.id, anfitriao.id), credenciais.usuario);
    const ice = credenciais ? { iceServers: credenciais.servidores } : {};
    enviar(visualizador, { tipo: 'sessao_iniciada', parceiro: anfitriao.id, papel: 'visualizador', porSenha, ...ice });
    enviar(anfitriao, { tipo: 'sessao_iniciada', parceiro: visualizador.id, papel: 'anfitriao', porSenha, ...ice });
    log(`[server] sessão iniciada ${visualizador.id} → ${anfitriao.id}${porSenha ? ' (por senha)' : ''}${credenciais ? ' com TURN' : ''}`);
  }

  /**
   * Quem voltou ao servidor declara a sessão em que continua. Só religa quando
   * os DOIS lados declaram a mesma sessão (um o parceiro do outro, papéis
   * opostos): ninguém consegue se ligar a um ID que não o espera. O ID de cada
   * lado já foi provado pela chave da instalação.
   */
  function retomar(conexao: ConexaoRegistrada, parceiro: IdCliente, papel: Papel, porSenha: boolean): void {
    if (conexao.vinculo.tipo !== 'livre') {
      enviarErro(conexao, 'ja_em_sessao', 'Já existe um pedido ou sessão em andamento');
      return;
    }
    if (parceiro === conexao.id) {
      enviarErro(conexao, 'destino_invalido', 'Uma sessão não pode ser com o próprio computador');
      return;
    }

    const outra = registrados.get(parceiro);
    const espera = outra?.vinculo;
    if (
      outra &&
      espera?.tipo === 'retomando' &&
      espera.parceiro === conexao.id &&
      espera.papel !== papel &&
      espera.porSenha === porSenha
    ) {
      clearTimeout(espera.prazo);
      conexao.vinculo = { tipo: 'em_sessao', parceiro: outra, papel, porSenha };
      outra.vinculo = { tipo: 'em_sessao', parceiro: conexao, papel: espera.papel, porSenha };
      enviar(conexao, { tipo: 'sessao_retomada', parceiro });
      enviar(outra, { tipo: 'sessao_retomada', parceiro: conexao.id });
      log(`[server] sessão retomada ${conexao.id} ↔ ${parceiro}`);
      return;
    }

    // O parceiro ainda não voltou (ou não declarou ainda): espera por ele.
    conexao.vinculo = { tipo: 'retomando', parceiro, papel, porSenha, ipParceiro: null, prazo: undefined };
    // Se ele já está no servidor, tem um prazo para declarar a sessão.
    if (outra) iniciarPrazoRetomada(conexao);
  }

  /** Uma instalação acabou de se registrar: quem esperava por ela começa a contar o prazo. */
  function aoRegistrar(conexao: ConexaoRegistrada): void {
    // Poucos apps online: percorrer todos é simples e barato.
    for (const outra of registrados.values()) {
      if (outra.vinculo.tipo === 'retomando' && outra.vinculo.parceiro === conexao.id) {
        iniciarPrazoRetomada(outra);
      }
    }
  }

  function repassarSinal(conexao: Conexao, sinal: Sinal): void {
    if (conexao.vinculo.tipo !== 'em_sessao') {
      enviarErro(conexao, 'sem_sessao', 'Sinal WebRTC fora de uma sessão');
      return;
    }
    enviar(conexao.vinculo.parceiro, { tipo: 'sinal', sinal });
  }

  /** Desfaz o pedido ou a sessão da conexão (pedido do app), avisando o outro lado. */
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
        if (senhaRecusada(motivo) && vinculo.papel === 'anfitriao' && vinculo.porSenha && conexao.id) {
          limites.falhaSenha(vinculo.parceiro.ip, conexao.id);
        }
        liberar(conexao, vinculo.parceiro);
        if (vinculo.parceiro.id) revogarTurn(conexao.id, vinculo.parceiro.id);
        enviar(vinculo.parceiro, { tipo: 'sessao_encerrada', motivo });
        log(`[server] sessão encerrada ${conexao.id} ↔ ${vinculo.parceiro.id} (${motivo})`);
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
        liberar(conexao);
        revogarTurn(conexao.id, vinculo.parceiro);
        log(`[server] sessão encerrada ${conexao.id} ↔ ${vinculo.parceiro} (${motivo}, sem o parceiro no servidor)`);
        return;
    }
  }

  /**
   * A conexão caiu (ou foi substituída por uma nova da mesma instalação).
   * Pedidos acabam; sessões não: o parceiro passa a esperar a retomada.
   */
  function desconectou(conexao: Conexao): void {
    const vinculo = conexao.vinculo;
    if (vinculo.tipo === 'em_sessao' && conexao.id) {
      const parceiro = vinculo.parceiro;
      if (parceiro.vinculo.tipo !== 'em_sessao') return; // não deveria acontecer
      liberar(conexao);
      parceiro.vinculo = {
        tipo: 'retomando',
        parceiro: conexao.id,
        papel: parceiro.vinculo.papel,
        porSenha: vinculo.porSenha,
        ipParceiro: conexao.ip,
        prazo: undefined,
      };
      enviar(parceiro, { tipo: 'parceiro_ausente', parceiro: conexao.id });
      log(`[server] ${conexao.id} saiu no meio da sessão com ${parceiro.id}: aguardando a retomada`);
      return;
    }
    if (vinculo.tipo === 'retomando') {
      liberar(conexao);
      return;
    }
    encerrar(conexao, 'parceiro_desconectou');
  }

  return { conectar, responder, retomar, aoRegistrar, repassarSinal, encerrar, desconectou };
}

function senhaRecusada(motivo: MotivoEncerramento): boolean {
  return motivo === 'senha_incorreta' || motivo === 'senha_bloqueada';
}
