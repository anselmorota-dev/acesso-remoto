// Testa a conversa do chat (mensagens em memória e não lidas).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_TEXTO_MAXIMO, decodificarMensagem, esquemaMensagemCanal } from '@acesso-remoto/shared';
import { ConversaChat, MENSAGENS_MAXIMAS, textoParaEnviar } from './chat';

test('texto para enviar: sem espaços nas pontas; vazio ou longo demais não vai', () => {
  assert.equal(textoParaEnviar('  olá\nsegunda linha  '), 'olá\nsegunda linha');
  assert.equal(textoParaEnviar('   \n  '), null);
  assert.equal(textoParaEnviar('x'.repeat(CHAT_TEXTO_MAXIMO)), 'x'.repeat(CHAT_TEXTO_MAXIMO));
  assert.equal(textoParaEnviar('x'.repeat(CHAT_TEXTO_MAXIMO + 1)), null);
});

test('não lidas: só as do outro lado, e só se o chat não estava à vista', () => {
  let agora = 1000;
  const conversa = new ConversaChat(() => agora);
  conversa.adicionar('eu', 'oi', true);
  conversa.adicionar('outro', 'oi! (vista)', true);
  conversa.adicionar('outro', 'chegou com o chat fechado', false);
  agora = 2000;
  conversa.adicionar('outro', 'mais uma', false);
  assert.equal(conversa.naoLidas, 2);
  assert.deepEqual(
    conversa.mensagens.map((m) => [m.de, m.em]),
    [
      ['eu', 1000],
      ['outro', 1000],
      ['outro', 1000],
      ['outro', 2000],
    ],
  );
  conversa.marcarComoLidas();
  assert.equal(conversa.naoLidas, 0);
});

test('guarda no máximo as últimas mensagens; "total" continua contando', () => {
  const conversa = new ConversaChat();
  for (let i = 0; i < MENSAGENS_MAXIMAS + 5; i++) conversa.adicionar('outro', `m${i}`, true);
  assert.equal(conversa.mensagens.length, MENSAGENS_MAXIMAS);
  assert.equal(conversa.mensagens[0]?.texto, 'm5');
  assert.equal(conversa.total, MENSAGENS_MAXIMAS + 5);
});

test('limpar (sessão nova) apaga a conversa e muda a geração', () => {
  const conversa = new ConversaChat();
  conversa.adicionar('outro', 'antiga', false);
  const geracao = conversa.geracao;
  conversa.limpar();
  assert.deepEqual([conversa.mensagens.length, conversa.naoLidas, conversa.total], [0, 0, 0]);
  assert.notEqual(conversa.geracao, geracao);
});

test('quem recebe recusa mensagem vazia ou longa demais (e tira espaços)', () => {
  const ler = (texto: string) => decodificarMensagem(esquemaMensagemCanal, JSON.stringify({ tipo: 'chat', texto }));
  assert.equal(ler('   '), null);
  assert.equal(ler('x'.repeat(CHAT_TEXTO_MAXIMO + 1)), null);
  // Marcação chega como texto (a tela mostra com textContent, nunca como HTML).
  assert.deepEqual(ler('  <b>oi</b>  '), { tipo: 'chat', texto: '<b>oi</b>' });
});
