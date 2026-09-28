// Testes da identidade da instalação (par de chaves Ed25519 guardado em arquivo).
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mensagemDeRegistro } from '@acesso-remoto/shared';
import { ChavesInstalacao, type Cifra } from './chaves-instalacao';

/** Cifra falsa (no app é o safeStorage do Electron): embaralha de forma reversível. */
const cifraFalsa: Cifra = {
  disponivel: () => true,
  cifrar: (texto) => Buffer.from(`cifrado:${Buffer.from(texto).toString('hex')}`),
  decifrar: (dados) => {
    const texto = dados.toString();
    if (!texto.startsWith('cifrado:')) throw new Error('não foi cifrado por esta máquina');
    return Buffer.from(texto.slice('cifrado:'.length), 'hex').toString();
  },
};
const semCifra: Cifra = { ...cifraFalsa, disponivel: () => false };

const novaPasta = () => mkdtempSync(join(tmpdir(), 'chaves-'));
const abrir = (arquivo: string, cifra: Cifra = cifraFalsa) => ChavesInstalacao.abrir({ arquivo, cifra, log: () => {} });

/** Confere a assinatura como o servidor faz. */
function servidorAceita(chavePublica: string, desafio: string, assinatura: string): boolean {
  const chave = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: chavePublica }, format: 'jwk' });
  return verify(null, Buffer.from(mensagemDeRegistro(desafio)), chave, Buffer.from(assinatura, 'base64url'));
}

const DESAFIO = 'A'.repeat(43);

test('primeira execução gera as chaves; a assinatura confere como no servidor', async () => {
  const arquivo = join(novaPasta(), 'identidade.json');
  const chaves = await abrir(arquivo);
  assert.match(chaves.chavePublica, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(existsSync(arquivo));
  const assinatura = chaves.assinarDesafio(DESAFIO);
  assert.match(assinatura, /^[A-Za-z0-9_-]{86}$/);
  assert.ok(servidorAceita(chaves.chavePublica, DESAFIO, assinatura));
});

test('reabrir mantém a mesma identidade (e portanto o mesmo ID)', async () => {
  const arquivo = join(novaPasta(), 'identidade.json');
  const primeira = await abrir(arquivo);
  const segunda = await abrir(arquivo);
  assert.equal(segunda.chavePublica, primeira.chavePublica);
  assert.ok(servidorAceita(primeira.chavePublica, DESAFIO, segunda.assinarDesafio(DESAFIO)));
});

test('a chave privada fica cifrada no arquivo', async () => {
  const arquivo = join(novaPasta(), 'identidade.json');
  await abrir(arquivo);
  const conteudo = JSON.parse(readFileSync(arquivo, 'utf8')) as { cifrada: boolean; chavePrivada: string };
  assert.equal(conteudo.cifrada, true);
  assert.ok(Buffer.from(conteudo.chavePrivada, 'base64').toString().startsWith('cifrado:'));
});

test('só assina desafios no formato do protocolo', async () => {
  const chaves = await abrir(join(novaPasta(), 'identidade.json'));
  assert.throws(() => chaves.assinarDesafio('qualquer texto'), /desafio inválido/);
  assert.throws(() => chaves.assinarDesafio('A'.repeat(44)), /desafio inválido/);
});

test('arquivo que não decifra (copiado de outra máquina) gera identidade nova e guarda o antigo', async () => {
  const pasta = novaPasta();
  const arquivo = join(pasta, 'identidade.json');
  const original = await abrir(arquivo);
  const outraMaquina: Cifra = { ...cifraFalsa, decifrar: () => { throw new Error('DPAPI: outro usuário'); } };
  const nova = await abrir(arquivo, outraMaquina);
  assert.notEqual(nova.chavePublica, original.chavePublica);
  assert.ok(existsSync(`${arquivo}.invalido`));
});

test('arquivo corrompido gera identidade nova', async () => {
  const arquivo = join(novaPasta(), 'identidade.json');
  writeFileSync(arquivo, '{ não é json');
  const chaves = await abrir(arquivo);
  assert.ok(servidorAceita(chaves.chavePublica, DESAFIO, chaves.assinarDesafio(DESAFIO)));
});

test('sem cifra do sistema, guarda sem cifrar (e avisa)', async () => {
  const arquivo = join(novaPasta(), 'identidade.json');
  const avisos: string[] = [];
  const chaves = await ChavesInstalacao.abrir({ arquivo, cifra: semCifra, log: (m) => avisos.push(m) });
  const conteudo = JSON.parse(readFileSync(arquivo, 'utf8')) as { cifrada: boolean };
  assert.equal(conteudo.cifrada, false);
  assert.ok(avisos.some((a) => /sem cifra/i.test(a)));
  assert.equal((await ChavesInstalacao.abrir({ arquivo, cifra: semCifra, log: () => {} })).chavePublica, chaves.chavePublica);
});
