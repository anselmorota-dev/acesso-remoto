// Servidor de sinalização: aceita conexões WebSocket dos apps, atribui um
// ID a cada um e (a partir da 1.4) repassa as mensagens entre os pares.
// Nunca recebe vídeo nem comandos de input, só mensagens de sinalização.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  decodificarMensagem,
  esquemaMensagemDoCliente,
  type CodigoErro,
  type IdCliente,
  type MensagemDoServidor,
} from '@acesso-remoto/shared';
import { gerarId } from './ids.js';

export interface OpcoesServidor {
  /** Porta TCP; 0 escolhe uma porta livre (útil nos testes). */
  porta: number;
  /** Intervalo do ping que detecta conexões mortas. */
  intervaloHeartbeatMs?: number;
  /** Tempo máximo entre conectar e mandar "registrar". */
  prazoRegistroMs?: number;
  /** Tamanho máximo de uma mensagem. Ofertas SDP têm poucos KB. */
  tamanhoMaximoMensagem?: number;
  /** Função de log; nos testes pode ser silenciada. */
  log?: (mensagem: string) => void;
}

export interface ServidorSinalizacao {
  /** Porta em que o servidor está escutando de fato. */
  readonly porta: number;
  /** Quantos apps estão registrados (com ID) no momento. */
  quantidadeRegistrados(): number;
  /** Encerra todas as conexões e para o servidor. */
  fechar(): Promise<void>;
}

/** Estado que o servidor guarda de cada conexão aberta. */
interface Conexao {
  readonly socket: WebSocket;
  id: IdCliente | null;
  /** Vira false a cada ping e volta a true quando chega o pong. */
  viva: boolean;
}

// Códigos de fechamento do WebSocket (RFC 6455).
const FECHAMENTO_VIOLACAO_POLITICA = 1008;

export async function iniciarServidor(opcoes: OpcoesServidor): Promise<ServidorSinalizacao> {
  const {
    intervaloHeartbeatMs = 30_000,
    prazoRegistroMs = 10_000,
    tamanhoMaximoMensagem = 64 * 1024,
    log = console.log,
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
    conexao.socket.send(JSON.stringify(mensagem));
  }

  function enviarErro(conexao: Conexao, codigo: CodigoErro, mensagem: string): void {
    enviar(conexao, { tipo: 'erro', codigo, mensagem });
  }

  function aoReceber(conexao: Conexao, dados: RawData, binario: boolean): void {
    const mensagem = binario
      ? null
      : decodificarMensagem(esquemaMensagemDoCliente, dados.toString());

    if (!mensagem) {
      enviarErro(conexao, 'mensagem_invalida', 'Mensagem em formato inválido');
      return;
    }

    switch (mensagem.tipo) {
      case 'registrar': {
        if (conexao.id) {
          enviarErro(conexao, 'ja_registrado', `Esta conexão já tem o ID ${conexao.id}`);
          return;
        }
        if (mensagem.versao !== PROTOCOL_VERSION) {
          enviarErro(
            conexao,
            'versao_incompativel',
            `Servidor usa o protocolo v${PROTOCOL_VERSION}, app usa v${mensagem.versao}`,
          );
          conexao.socket.close(FECHAMENTO_VIOLACAO_POLITICA, 'versao_incompativel');
          return;
        }
        const id = gerarId((candidato) => registrados.has(candidato));
        conexao.id = id;
        registrados.set(id, conexao);
        enviar(conexao, { tipo: 'registrado', id });
        log(`[server] registrado ${id} (online: ${registrados.size})`);
        return;
      }
    }
  }

  wss.on('connection', (socket) => {
    const conexao: Conexao = { socket, id: null, viva: true };
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
      if (conexao.id) {
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

  return {
    porta: (http.address() as AddressInfo).port,
    quantidadeRegistrados: () => registrados.size,
    fechar: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(heartbeat);
        for (const conexao of conexoes) conexao.socket.terminate();
        wss.close();
        http.close((erro) => (erro ? reject(erro) : resolve()));
      }),
  };
}
