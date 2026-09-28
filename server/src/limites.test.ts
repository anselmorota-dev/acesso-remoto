// Testes dos limites de tentativas e da leitura do IP do cliente.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JanelaDeEventos, chaveDoIp, ipDoCliente } from './limites.js';

function relogio() {
  let agora = 0;
  return { agora: () => agora, avancar: (ms: number) => (agora += ms) };
}

test('limite de taxa: no máximo N por janela, e volta a permitir quando a janela passa', () => {
  const r = relogio();
  const pedidos = new JanelaDeEventos({ limite: 3, janelaMs: 60_000, agora: r.agora });
  assert.deepEqual([1, 2, 3, 4].map(() => pedidos.tentar('ip-a')), [true, true, true, false]);
  assert.equal(pedidos.tentar('ip-b'), true, 'outra chave não é afetada');
  r.avancar(30_000);
  assert.equal(pedidos.tentar('ip-a'), false);
  r.avancar(30_001); // os 3 primeiros saíram da janela
  assert.equal(pedidos.tentar('ip-a'), true);
});

test('bloqueio: ao atingir o limite, bloqueia pelo tempo definido (mesmo depois da janela)', () => {
  const r = relogio();
  const erros = new JanelaDeEventos({ limite: 5, janelaMs: 10 * 60_000, bloqueioMs: 15 * 60_000, agora: r.agora });
  for (let i = 0; i < 4; i++) erros.registrar('ip|id');
  assert.equal(erros.bloqueado('ip|id'), false);
  erros.registrar('ip|id'); // 5º erro
  assert.equal(erros.bloqueado('ip|id'), true);
  r.avancar(10 * 60_000 + 1); // a janela passou, mas o bloqueio dura 15 min
  assert.equal(erros.bloqueado('ip|id'), true);
  r.avancar(5 * 60_000);
  assert.equal(erros.bloqueado('ip|id'), false);
});

test('erros espaçados (fora da janela) não bloqueiam', () => {
  const r = relogio();
  const erros = new JanelaDeEventos({ limite: 3, janelaMs: 1000, bloqueioMs: 5000, agora: r.agora });
  for (let i = 0; i < 10; i++) {
    erros.registrar('x');
    r.avancar(600); // no máximo 2 erros cabem em 1 s
  }
  assert.equal(erros.bloqueado('x'), false);
});

test('limpar esquece chaves antigas (a memória não cresce para sempre)', () => {
  const r = relogio();
  const pedidos = new JanelaDeEventos({ limite: 2, janelaMs: 1000, bloqueioMs: 2000, agora: r.agora });
  for (let i = 0; i < 100; i++) pedidos.tentar(`ip-${i}`);
  pedidos.registrar('bloqueado');
  pedidos.registrar('bloqueado');
  assert.equal(pedidos.tamanho(), 101);
  r.avancar(1500);
  pedidos.limpar();
  assert.equal(pedidos.tamanho(), 1, 'só o bloqueio ainda vigente fica');
  r.avancar(1000);
  pedidos.limpar();
  assert.equal(pedidos.tamanho(), 0);
});

test('IP do cliente: direto ou atrás de proxies confiáveis (contando do fim)', () => {
  const pedido = (xff: string | undefined, remoto = '10.0.0.1') => ({
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    socket: { remoteAddress: remoto },
  });
  // Sem proxy: o endereço da conexão (o cabeçalho é ignorado: qualquer um o forja).
  assert.equal(ipDoCliente(pedido('6.6.6.6'), 0), '10.0.0.1');
  // 1 proxy que acrescenta: o último da lista é o que ele viu.
  assert.equal(ipDoCliente(pedido('200.1.1.1'), 1), '200.1.1.1');
  // O cliente tentou forjar "1.2.3.4" no começo: não adianta.
  assert.equal(ipDoCliente(pedido('1.2.3.4, 200.1.1.1'), 1), '200.1.1.1');
  // 2 proxies (ex.: Cloudflare + balanceador): o penúltimo.
  assert.equal(ipDoCliente(pedido('1.2.3.4, 200.1.1.1, 172.16.0.9'), 2), '200.1.1.1');
  // Lista menor que o esperado: usa o endereço da conexão.
  assert.equal(ipDoCliente(pedido(undefined), 1), '10.0.0.1');
  // IPv4 escrito como IPv6.
  assert.equal(ipDoCliente(pedido(undefined, '::ffff:127.0.0.1'), 0), '127.0.0.1');
});

test('chave do IP: IPv4 inteiro; IPv6 pelo prefixo /64 (um usuário costuma ter o /64 todo)', () => {
  assert.equal(chaveDoIp('200.1.1.1'), '200.1.1.1');
  assert.equal(chaveDoIp('2804:14c:5b:8000:1:2:3:4'), '2804:14c:5b:8000::/64');
  assert.equal(chaveDoIp('2804:14c:5b:8000:ffff:0:0:9'), '2804:14c:5b:8000::/64');
  assert.equal(chaveDoIp('2804:14c::1'), '2804:14c:0:0::/64', 'forma abreviada com ::');
  assert.equal(chaveDoIp('::1'), '0:0:0:0::/64');
});
