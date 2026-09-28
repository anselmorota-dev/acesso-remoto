// Servidor de sinalização: aceita conexões WebSocket dos apps, identifica
// cada instalação pelo seu ID fixo e repassa as mensagens de sinalização
// entre os pares. Nunca recebe vídeo nem comandos de input.
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  PROTOCOL_VERSION,
  decodificarMensagem,
  esquemaMensagemDoCliente,
  mensagemDeRegistro,
  type CodigoErro,
  type IdCliente,
  type MensagemDoServidor,
} from '@acesso-remoto/shared';
import type { Conexao, ConexaoRegistrada } from './conexao.js';
import { InstalacoesEmMemoria, type RepositorioInstalacoes } from './instalacoes.js';
import { criarGerenciadorSessoes } from './sessoes.js';

export interface OpcoesServidor {
  /** Porta TCP; 0 escolhe uma porta livre (útil nos testes). */
  porta: number;
  /** Intervalo do ping que detecta conexões mortas. */
  intervaloHeartbeatMs?: number;
  /** Tempo máximo entre conectar e mandar "registrar". */
  prazoRegistroMs?: number;
  /** Tempo que o anfitrião tem para aceitar ou recusar um pedido. */
  prazoRespostaPedidoMs?: number;
  /** Tamanho máximo de uma mensagem. Ofertas SDP têm poucos KB. */
  tamanhoMaximoMensagem?: number;
  /** Função de log; nos testes pode ser silenciada. */
  log?: (mensagem: string) => void;
  /** Onde ficam os IDs fixos das instalações (padrão: em memória). */
  instalacoes?: RepositorioInstalacoes;
}

export interface ServidorSinalizacao {
  /** Porta em que o servidor está escutando de fato. */
  readonly porta: number;
  /** Quantos apps estão registrados (com ID) no momento. */
  quantidadeRegistrados(): number;
  /** Encerra todas as conexões e para o servidor. */
  fechar(): Promise<void>;
}

// Códigos de fechamento do WebSocket (RFC 6455).
const FECHAMENTO_VIOLACAO_POLITICA = 1008;
const FECHAMENTO_ERRO_INTERNO = 1011;

/** Confere a assinatura Ed25519 do desafio. Chave ou assinatura malformada = não confere. */
function assinaturaConfere(chavePublica: string, desafio: string, assinatura: string): boolean {
  try {
    const chave = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: chavePublica }, format: 'jwk' });
    return verify(null, Buffer.from(mensagemDeRegistro(desafio)), chave, Buffer.from(assinatura, 'base64url'));
  } catch {
    return false;
  }
}

export async function iniciarServidor(opcoes: OpcoesServidor): Promise<ServidorSinalizacao> {
  const {
    intervaloHeartbeatMs = 30_000,
    prazoRegistroMs = 10_000,
    prazoRespostaPedidoMs = 30_000,
    tamanhoMaximoMensagem = 64 * 1024,
    log = console.log,
    instalacoes = new InstalacoesEmMemoria(),
  } = opcoes;

  const conexoes = new Set<Conexao>();
  const registrados = new Map<IdCliente, Conexao>();

  // Servidor HTTP: o WebSocket começa como uma requisição HTTP ("upgrade").
  // A rota /saude permite ao Render verificar se o serviço está no ar.
  const http: Server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/saude') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    } else {
      res.writeHead(404).end();
    }
  });

  const wss = new WebSocketServer({ server: http, maxPayload: tamanhoMaximoMensagem });

  function enviar(conexao: Conexao, mensagem: MensagemDoServidor): void {
    // A conexão pode estar fechando (ex.: avisar o parceiro de quem acabou de cair).
    if (conexao.socket.readyState === WebSocket.OPEN) {
      conexao.socket.send(JSON.stringify(mensagem));
    }
  }

  function enviarErro(conexao: Conexao, codigo: CodigoErro, mensagem: string): void {
    enviar(conexao, { tipo: 'erro', codigo, mensagem });
  }

  const sessoes = criarGerenciadorSessoes({
    registrados,
    enviar,
    enviarErro,
    prazoRespostaMs: prazoRespostaPedidoMs,
    log,
  });

  // Registro em duas etapas (ID fixo por instalação):
  //   1. "registrar" traz a chave pública; o servidor responde um desafio aleatório;
  //   2. "provar" traz a assinatura do desafio; se confere, o servidor busca
  //      (ou cria) o ID ligado àquela chave e responde "registrado".
  // Só quem tem a chave privada consegue usar o ID da instalação.

  function registrar(conexao: Conexao, versao: number, chavePublica: string | undefined): void {
    if (conexao.id || conexao.registro) {
      enviarErro(conexao, 'ja_registrado', 'Esta conexão já se registrou');
      return;
    }
    // A versão vem antes da chave: um app antigo (sem chave) precisa saber
    // que está desatualizado, e não receber "mensagem inválida".
    if (versao !== PROTOCOL_VERSION) {
      enviarErro(
        conexao,
        'versao_incompativel',
        `Servidor usa o protocolo v${PROTOCOL_VERSION}, app usa v${versao}`,
      );
      conexao.socket.close(FECHAMENTO_VIOLACAO_POLITICA, 'versao_incompativel');
      return;
    }
    if (!chavePublica) {
      enviarErro(conexao, 'mensagem_invalida', 'Falta a chave pública da instalação');
      return;
    }
    const desafio = randomBytes(32).toString('base64url');
    conexao.registro = { chavePublica, desafio };
    enviar(conexao, { tipo: 'desafio', desafio });
  }

  async function provar(conexao: Conexao, assinatura: string): Promise<void> {
    const registro = conexao.registro;
    if (conexao.id) {
      enviarErro(conexao, 'ja_registrado', `Esta conexão já tem o ID ${conexao.id}`);
      return;
    }
    if (!registro || registro.provando) {
      enviarErro(conexao, 'assinatura_invalida', 'Nenhum desafio pendente: envie "registrar" antes');
      return;
    }
    if (!assinaturaConfere(registro.chavePublica, registro.desafio, assinatura)) {
      conexao.registro = null; // o desafio vale uma vez só
      enviarErro(conexao, 'assinatura_invalida', 'A assinatura não confere com a chave pública');
      conexao.socket.close(FECHAMENTO_VIOLACAO_POLITICA, 'assinatura_invalida');
      return;
    }
    registro.provando = true;

    let id: IdCliente;
    try {
      id = await instalacoes.idDaChave(registro.chavePublica);
    } catch (erro) {
      log(`[server] falha ao buscar o ID da instalação: ${(erro as Error).message}`);
      enviarErro(conexao, 'indisponivel', 'Servidor temporariamente indisponível; tente de novo');
      conexao.socket.close(FECHAMENTO_ERRO_INTERNO, 'indisponivel');
      return;
    }
    // A conexão pode ter caído enquanto o banco respondia.
    if (conexao.socket.readyState !== WebSocket.OPEN) return;

    // A mesma instalação já estava conectada (ex.: rede caiu e voltou antes
    // do servidor perceber): a conexão nova, que provou a posse, fica com o ID.
    const antiga = registrados.get(id);
    if (antiga && antiga !== conexao) {
      sessoes.encerrar(antiga, 'parceiro_desconectou');
      registrados.delete(id);
      antiga.id = null;
      enviarErro(antiga, 'substituida', 'Este computador conectou de novo em outro lugar');
      antiga.socket.close(FECHAMENTO_VIOLACAO_POLITICA, 'substituida');
    }

    conexao.registro = null;
    conexao.id = id;
    registrados.set(id, conexao);
    enviar(conexao, { tipo: 'registrado', id });
    log(`[server] registrado ${id} (online: ${registrados.size})`);
  }

  function aoReceber(conexao: Conexao, dados: RawData, binario: boolean): void {
    const mensagem = binario
      ? null
      : decodificarMensagem(esquemaMensagemDoCliente, dados.toString());

    if (!mensagem) {
      enviarErro(conexao, 'mensagem_invalida', 'Mensagem em formato inválido');
      return;
    }

    if (mensagem.tipo === 'registrar') {
      registrar(conexao, mensagem.versao, mensagem.chavePublica);
      return;
    }
    if (mensagem.tipo === 'provar') {
      provar(conexao, mensagem.assinatura).catch((erro: unknown) => {
        log(`[server] erro inesperado no registro: ${(erro as Error).message}`);
        conexao.socket.close(FECHAMENTO_ERRO_INTERNO, 'indisponivel');
      });
      return;
    }

    // Todas as outras mensagens exigem que a conexão já tenha um ID.
    if (!conexao.id) {
      enviarErro(conexao, 'nao_registrado', 'Envie "registrar" antes de qualquer outra mensagem');
      return;
    }
    const registrada = conexao as ConexaoRegistrada;

    switch (mensagem.tipo) {
      case 'conectar':
        sessoes.conectar(registrada, mensagem.destino, mensagem.comSenha);
        return;
      case 'responder_pedido':
        sessoes.responder(registrada, mensagem.origem, mensagem.aceito, mensagem.porSenha);
        return;
      case 'sinal':
        sessoes.repassarSinal(registrada, mensagem.sinal);
        return;
      case 'encerrar':
        sessoes.encerrar(registrada, mensagem.motivo ?? 'encerrada_pelo_parceiro');
        return;
    }
  }

  wss.on('connection', (socket) => {
    const conexao: Conexao = { socket, id: null, registro: null, viva: true, vinculo: { tipo: 'livre' } };
    conexoes.add(conexao);

    // Quem conecta e não se registra a tempo é desconectado, para não
    // ocupar recursos do servidor à toa.
    const prazo = setTimeout(() => {
      if (!conexao.id) socket.close(FECHAMENTO_VIOLACAO_POLITICA, 'registro_nao_enviado');
    }, prazoRegistroMs);

    socket.on('pong', () => {
      conexao.viva = true;
    });

    socket.on('message', (dados, binario) => aoReceber(conexao, dados, binario));

    // Sem este listener, um erro de socket (ex.: mensagem acima do limite)
    // derrubaria o processo inteiro.
    socket.on('error', (erro) => log(`[server] erro na conexão ${conexao.id ?? '(sem ID)'}: ${erro.message}`));

    socket.on('close', () => {
      clearTimeout(prazo);
      conexoes.delete(conexao);
      // Avisa o outro lado de um pedido ou sessão em andamento.
      sessoes.encerrar(conexao, 'parceiro_desconectou');
      // Só libera o ID se ele ainda for desta conexão (e não de uma que a substituiu).
      if (conexao.id && registrados.get(conexao.id) === conexao) {
        registrados.delete(conexao.id);
        log(`[server] saiu ${conexao.id} (online: ${registrados.size})`);
      }
    });
  });

  // Heartbeat: a cada intervalo, derruba quem não respondeu o ping anterior
  // (queda de rede, PC que hibernou) e manda um novo ping para os demais.
  // Isso libera o ID de conexões que morreram sem avisar.
  const heartbeat = setInterval(() => {
    for (const conexao of conexoes) {
      if (!conexao.viva) {
        conexao.socket.terminate();
        continue;
      }
      conexao.viva = false;
      conexao.socket.ping();
    }
  }, intervaloHeartbeatMs);

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opcoes.porta, () => resolve());
  });

  // Guardado para que chamar fechar() mais de uma vez seja seguro.
  let fechamento: Promise<void> | null = null;

  return {
    porta: (http.address() as AddressInfo).port,
    quantidadeRegistrados: () => registrados.size,
    fechar: () =>
      (fechamento ??= new Promise<void>((resolve, reject) => {
        clearInterval(heartbeat);
        for (const conexao of conexoes) conexao.socket.terminate();
        wss.close();
        http.close((erro) => (erro ? reject(erro) : resolve()));
      })),
  };
}
