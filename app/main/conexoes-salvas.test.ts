// Testes dos computadores salvos (arquivo temporário e uma cifra falsa).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { APELIDO_MAXIMO, ConexoesSalvas, MAXIMO_SALVOS, limparApelido, type CifraSenhas } from './conexoes-salvas';

/** "Cifra" de teste: inverte os bytes (o bastante para ver que não fica em texto puro). */
const cifraFalsa = (disponivel = true): CifraSenhas => ({
  disponivel: () => disponivel,
  cifrar: (texto) => Buffer.from(texto, 'utf8').reverse(),
  decifrar: (dados) => Buffer.from(dados).reverse().toString('utf8'),
});

async function abrir(opcoes: { arquivo?: string; cifra?: CifraSenhas } = {}) {
  const arquivo = opcoes.arquivo ?? join(mkdtempSync(join(tmpdir(), 'salvos-')), 'conexoes.json');
  let agora = 1000;
  const salvos = await ConexoesSalvas.abrir({ arquivo, cifra: opcoes.cifra ?? cifraFalsa(), agora: () => agora++ });
  return { salvos, arquivo };
}

test('salva com senha cifrada; a lista não traz a senha; conectar devolve a senha', async () => {
  const { salvos, arquivo } = await abrir();
  assert.deepEqual(await salvos.salvar('123456789', '  Notebook   do escritório ', 'frase secreta 123'), { ok: true });
  assert.deepEqual(salvos.listar(), [{ id: '123456789', apelido: 'Notebook do escritório', temSenha: true, usadoEm: 1000 }]);
  // No arquivo, a senha não aparece em texto.
  assert.ok(!readFileSync(arquivo, 'utf8').includes('frase secreta'));
  assert.equal(await salvos.senhaParaConectar('123456789'), 'frase secreta 123');
  // Reabrir o arquivo traz tudo de volta.
  const { salvos: reaberto } = await abrir({ arquivo });
  assert.equal(await reaberto.senhaParaConectar('123456789'), 'frase secreta 123');
});

test('atualizar: senha undefined mantém, null esquece; apelido muda', async () => {
  const { salvos } = await abrir();
  await salvos.salvar('123456789', 'A', 'senha-inicial');
  await salvos.salvar('123456789', 'B', undefined);
  assert.equal(salvos.listar()[0]?.apelido, 'B');
  assert.equal(await salvos.senhaParaConectar('123456789'), 'senha-inicial');
  await salvos.salvar('123456789', 'B', null);
  assert.equal(salvos.listar()[0]?.temSenha, false);
  assert.equal(await salvos.senhaParaConectar('123456789'), null);
});

test('a lista vem do usado mais recente para o mais antigo', async () => {
  const { salvos } = await abrir();
  await salvos.salvar('111111111', 'um', undefined);
  await salvos.salvar('222222222', 'dois', undefined);
  await salvos.marcarUso('111111111');
  assert.deepEqual(
    salvos.listar().map((c) => c.id),
    ['111111111', '222222222'],
  );
});

test('recusa ID inválido, senha vazia, lista cheia e senha sem cifra disponível', async () => {
  const { salvos } = await abrir();
  assert.deepEqual(await salvos.salvar('012345678', 'x', undefined), { ok: false, erro: 'id_invalido' });
  assert.deepEqual(await salvos.salvar('123456789', 'x', ''), { ok: false, erro: 'senha_invalida' });
  for (let i = 0; i < MAXIMO_SALVOS; i++) await salvos.salvar(String(100000000 + i), '', undefined);
  assert.deepEqual(await salvos.salvar('999999999', '', undefined), { ok: false, erro: 'lista_cheia' });

  const { salvos: semCifra } = await abrir({ cifra: cifraFalsa(false) });
  assert.deepEqual(await semCifra.salvar('123456789', 'x', 'senha-qualquer'), { ok: false, erro: 'cifra_indisponivel' });
  assert.deepEqual(await semCifra.salvar('123456789', 'x', undefined), { ok: true }); // sem senha dá
});

test('remover; arquivo corrompido ou com itens inválidos não quebra', async () => {
  const { salvos, arquivo } = await abrir();
  await salvos.salvar('123456789', 'x', undefined);
  await salvos.remover('123456789');
  assert.deepEqual(salvos.listar(), []);

  writeFileSync(arquivo, '{ não é json');
  assert.deepEqual((await abrir({ arquivo })).salvos.listar(), []);
  writeFileSync(arquivo, JSON.stringify({ versao: 1, itens: [{ id: 'abc' }, { id: '123456789', apelido: 'ok', senha: null, usadoEm: 5 }] }));
  assert.deepEqual((await abrir({ arquivo })).salvos.listar(), [{ id: '123456789', apelido: 'ok', temSenha: false, usadoEm: 5 }]);
});

test('senha que não decifra (outra conta do Windows) vira null', async () => {
  const { salvos, arquivo } = await abrir();
  await salvos.salvar('123456789', 'x', 'senha-qualquer');
  const quebrada: CifraSenhas = { ...cifraFalsa(), decifrar: () => { throw new Error('não decifra'); } };
  const { salvos: outraConta } = await abrir({ arquivo, cifra: quebrada });
  assert.equal(await outraConta.senhaParaConectar('123456789'), null);
});

test('apelido: espaços normalizados e tamanho limitado', () => {
  assert.equal(limparApelido('  a   b  '), 'a b');
  assert.equal([...limparApelido('x'.repeat(200))].length, APELIDO_MAXIMO);
  assert.equal(limparApelido(42), '');
});
