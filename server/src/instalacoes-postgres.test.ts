// Teste do repositório Postgres contra um banco de verdade. Só roda se a
// variável TESTE_DATABASE_URL estiver definida (de preferência um banco ou
// "branch" do Neon só para testes); sem ela, é pulado.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { InstalacoesPostgres, comCertificadoVerificado } from './instalacoes-postgres.js';

// Este roda sempre (não precisa de banco).
test('a URL do banco passa a exigir a checagem completa do certificado', () => {
  const neon = 'postgresql://usuario:s%40nha@ep-exemplo.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
  const ajustada = new URL(comCertificadoVerificado(neon));
  assert.equal(ajustada.searchParams.get('sslmode'), 'verify-full');
  assert.equal(ajustada.searchParams.get('channel_binding'), 'require');
  assert.equal(ajustada.password, 's%40nha'); // senha com caractere especial preservada
  // Já forte, ausente ou desligado de propósito: não mexe.
  for (const url of ['postgresql://u:p@h/db?sslmode=verify-full', 'postgresql://u:p@localhost/db', 'postgresql://u:p@h/db?sslmode=disable']) {
    assert.equal(new URL(comCertificadoVerificado(url)).searchParams.get('sslmode'), new URL(url).searchParams.get('sslmode'));
  }
});

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
