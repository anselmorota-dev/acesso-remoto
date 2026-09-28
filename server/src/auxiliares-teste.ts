// Funções auxiliares usadas pelos testes do servidor (não é um arquivo de teste).
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, mensagemDeRegistro, type MensagemDoServidor } from '@acesso-remoto/shared';

/** Identidade de uma instalação (par de chaves Ed25519), como o app gera. */
export interface IdentidadeTeste {
  chavePublica: string;
  assinar(desafio: string): string;
}

export function novaIdentidade(): IdentidadeTeste {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const chavePublica = publicKey.export({ format: 'jwk' }).x as string;
  return {
    chavePublica,
    assinar: (desafio) => sign(null, Buffer.from(mensagemDeRegistro(desafio)), privateKey).toString('base64url'),
  };
}

const abertos: WebSocket[] = [];

/** Derruba todos os clientes criados pelos testes. */
export function encerrarClientes(): void {
  for (const socket of abertos.splice(0)) socket.terminate();
}

export type ClienteTeste = Awaited<ReturnType<typeof conectarCliente>>;

/** Cliente WebSocket de teste que enfileira as mensagens recebidas. */
export async function conectarCliente(porta: number, opcoes: { autoPong?: boolean; ip?: string } = {}) {
  // "ip" simula o cabeçalho que o proxy do Render acrescenta (servidor com proxiesConfiaveis = 1).
  const { ip, ...resto } = opcoes;
  const socket = new WebSocket(`ws://127.0.0.1:${porta}`, {
    ...resto,
    ...(ip ? { headers: { 'x-forwarded-for': ip } } : {}),
  });
  abertos.push(socket);
  const fila: MensagemDoServidor[] = [];
  const esperando: Array<(m: MensagemDoServidor) => void> = [];
  socket.on('message', (dados) => {
    const mensagem = JSON.parse(dados.toString()) as MensagemDoServidor;
    const resolver = esperando.shift();
    if (resolver) resolver(mensagem);
    else fila.push(mensagem);
  });
  const fechado = new Promise<number>((resolve) => socket.on('close', (codigo) => resolve(codigo)));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  /** Próxima mensagem recebida; falha se nada chegar no prazo. */
  function proxima(limiteMs = 2000): Promise<MensagemDoServidor> {
    const pronta = fila.shift();
    if (pronta) return Promise.resolve(pronta);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        esperando.splice(esperando.indexOf(receber), 1);
        reject(new Error('Nenhuma mensagem recebida no prazo'));
      }, limiteMs);
      const receber = (m: MensagemDoServidor) => {
        clearTimeout(timer);
        resolve(m);
      };
      esperando.push(receber);
    });
  }

  return {
    socket,
    fechado,
    proxima,
    enviar: (dados: unknown) => socket.send(typeof dados === 'string' ? dados : JSON.stringify(dados)),
    /** Garante que nenhuma mensagem chega durante o intervalo. */
    async nadaRecebidoEm(ms = 150): Promise<void> {
      await new Promise((r) => setTimeout(r, ms));
      assert.deepEqual(fila, [], 'mensagem inesperada recebida');
    },
  };
}

/** Faz o registro numa conexão já aberta (registrar → desafio → provar); devolve o ID. */
export async function completarRegistro(cliente: ClienteTeste, identidade: IdentidadeTeste): Promise<string> {
  cliente.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION, chavePublica: identidade.chavePublica });
  const desafio = await cliente.proxima();
  assert.equal(desafio.tipo, 'desafio');
  cliente.enviar({ tipo: 'provar', assinatura: identidade.assinar(desafio.desafio) });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo, 'registrado');
  return resposta.id;
}

/** Conecta e registra; devolve o cliente com seu ID e sua identidade. */
export async function registrarCliente(porta: number, identidade: IdentidadeTeste = novaIdentidade(), ip?: string) {
  const cliente = await conectarCliente(porta, { ip });
  const id = await completarRegistro(cliente, identidade);
  return { ...cliente, id, identidade };
}

/** Espera uma condição ficar verdadeira (para efeitos assíncronos no servidor). */
export async function aguardar(condicao: () => boolean, limiteMs = 2000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) throw new Error('Tempo esgotado');
    await new Promise((r) => setTimeout(r, 10));
  }
}
