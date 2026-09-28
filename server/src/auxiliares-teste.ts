// Funções auxiliares usadas pelos testes do servidor (não é um arquivo de teste).
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type MensagemDoServidor } from '@acesso-remoto/shared';

const abertos: WebSocket[] = [];

/** Derruba todos os clientes criados pelos testes. */
export function encerrarClientes(): void {
  for (const socket of abertos.splice(0)) socket.terminate();
}

export type ClienteTeste = Awaited<ReturnType<typeof conectarCliente>>;

/** Cliente WebSocket de teste que enfileira as mensagens recebidas. */
export async function conectarCliente(porta: number, opcoes: { autoPong?: boolean } = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${porta}`, opcoes);
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

/** Conecta e registra; devolve o cliente com seu ID. */
export async function registrarCliente(porta: number) {
  const cliente = await conectarCliente(porta);
  cliente.enviar({ tipo: 'registrar', versao: PROTOCOL_VERSION });
  const resposta = await cliente.proxima();
  assert.equal(resposta.tipo, 'registrado');
  return { ...cliente, id: resposta.id };
}

/** Espera uma condição ficar verdadeira (para efeitos assíncronos no servidor). */
export async function aguardar(condicao: () => boolean, limiteMs = 2000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) throw new Error('Tempo esgotado');
    await new Promise((r) => setTimeout(r, 10));
  }
}
