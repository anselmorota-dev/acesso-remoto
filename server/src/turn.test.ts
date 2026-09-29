// Testes do cliente da API de TURN da Cloudflare (com um fetch falso).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarTurnCloudflare, servidoresParaOApp } from './turn.js';

/** Resposta no formato da documentação da Cloudflare (com a porta 53, que o navegador não usa). */
const RESPOSTA = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turn:turn.cloudflare.com:3478?transport=tcp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'usuario-temporario',
      credential: 'senha-temporaria',
    },
  ],
};

function fetchFalso(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return responder(String(url), init ?? {});
  }) as typeof globalThis.fetch;
  return { fn, chamadas };
}

const json = (dados: unknown, status = 201) => new Response(JSON.stringify(dados), { status });

test('gera credenciais: chama a API certa, com o token, e devolve só os TURN usáveis', async () => {
  const { fn, chamadas } = fetchFalso(() => json(RESPOSTA));
  const turn = criarTurnCloudflare({ idChave: 'chave-id', token: 'segredo', fetch: fn, log: () => {} });
  const credenciais = await turn.gerar();

  assert.equal(chamadas[0]?.url, 'https://rtc.live.cloudflare.com/v1/turn/keys/chave-id/credentials/generate-ice-servers');
  assert.equal(chamadas[0]?.init.method, 'POST');
  assert.equal((chamadas[0]?.init.headers as Record<string, string>)['Authorization'], 'Bearer segredo');
  assert.deepEqual(JSON.parse(String(chamadas[0]?.init.body)), { ttl: 86_400 });
  assert.deepEqual(credenciais, {
    usuario: 'usuario-temporario',
    servidores: [
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:3478?transport=tcp',
          'turns:turn.cloudflare.com:5349?transport=tcp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'usuario-temporario',
        credential: 'senha-temporaria',
      },
    ],
  });
});

test('falhas da API viram null (a sessão segue só com STUN)', async () => {
  const casos: Array<() => Response | Promise<Response>> = [
    () => json({ erro: 'token inválido' }, 401),
    () => json({ iceServers: 'lixo' }),
    () => json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }), // sem TURN
    () => Promise.reject(new TypeError('sem rede')),
  ];
  for (const caso of casos) {
    const { fn } = fetchFalso(caso);
    const turn = criarTurnCloudflare({ idChave: 'k', token: 't', fetch: fn, log: () => {} });
    assert.equal(await turn.gerar(), null);
  }
});

test('API que não responde: desiste no prazo', async () => {
  const { fn } = fetchFalso(
    (_url, init) =>
      new Promise((_ok, falhar) => init.signal?.addEventListener('abort', () => falhar(init.signal?.reason))),
  );
  const turn = criarTurnCloudflare({ idChave: 'k', token: 't', fetch: fn, limiteMs: 50, log: () => {} });
  const inicio = Date.now();
  assert.equal(await turn.gerar(), null);
  assert.ok(Date.now() - inicio < 1000);
});

test('revogar chama a API de revogação do usuário', async () => {
  const { fn, chamadas } = fetchFalso(() => new Response(null, { status: 204 }));
  const turn = criarTurnCloudflare({ idChave: 'chave-id', token: 'segredo', fetch: fn, log: () => {} });
  turn.revogar('usuario/estranho');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(chamadas[0]?.url, 'https://rtc.live.cloudflare.com/v1/turn/keys/chave-id/credentials/usuario%2Festranho/revoke');
  assert.equal(chamadas[0]?.init.method, 'POST');
});

test('só servidores TURN com credencial, sem a porta 53', () => {
  assert.deepEqual(servidoresParaOApp([{ urls: ['turn:x:53?transport=udp'], username: 'u', credential: 'c' }]), []);
  assert.deepEqual(servidoresParaOApp([{ urls: ['turn:x:3478'] }]), []); // sem credencial
});
