// Teste do repositório Postgres contra um banco de verdade. Só roda se a
// variável TESTE_DATABASE_URL estiver definida (de preferência um banco ou
// "branch" do Neon só para testes); sem ela, é pulado.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { InstalacoesPostgres } from './instalacoes-postgres.js';

const url = process.env.TESTE_DATABASE_URL;
const opcoes = { skip: url ? false : 'defina TESTE_DATABASE_URL para rodar' };

let repositorio: InstalacoesPostgres;
const chaves: string[] = [];
const novaChave = () => {
  const chave = randomBytes(32).toString('base64url');
  chaves.push(chave);
  return chave;
};

before(async () => {
  if (url) repositorio = await InstalacoesPostgres.abrir(url, () => {});
});

after(async () => {
  if (!url) return;
  // Apaga o que o teste criou.
  const pg = await import('pg');
  const cliente = new pg.default.Client({ connectionString: url });
  await cliente.connect();
  await cliente.query('DELETE FROM instalacoes WHERE chave_publica = ANY($1)', [chaves]);
  await cliente.end();
  await repositorio.fechar();
});

test('mesma chave, mesmo ID; chaves diferentes, IDs diferentes', opcoes, async () => {
  const a = novaChave();
  const idA = await repositorio.idDaChave(a);
  assert.match(idA, /^[1-9]\d{8}$/);
  assert.equal(await repositorio.idDaChave(a), idA);
  assert.notEqual(await repositorio.idDaChave(novaChave()), idA);
});

test('duas conexões da mesma chave ao mesmo tempo recebem o mesmo ID', opcoes, async () => {
  const chave = novaChave();
  const [um, dois] = await Promise.all([repositorio.idDaChave(chave), repositorio.idDaChave(chave)]);
  assert.equal(um, dois);
});
