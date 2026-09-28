// Testa o limite de tamanho do texto da área de transferência no canal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TAMANHO_MAXIMO_MENSAGEM_CANAL,
  decodificarMensagem,
  esquemaMensagemCanal,
} from '@acesso-remoto/shared';
import { serializarAreaTransferencia } from './area-transferencia';

test('texto comum vira uma mensagem válida do canal, idêntica na volta', () => {
  const texto = 'linha 1\r\nlinha 2\tação ✓ 😀 "aspas" \\ barra';
  const mensagem = serializarAreaTransferencia(texto);
  assert.ok(mensagem);
  assert.deepEqual(decodificarMensagem(esquemaMensagemCanal, mensagem), { tipo: 'area_transferencia', texto });
});

test('o limite é em bytes: com acentos cabem menos caracteres', () => {
  const limite = 1000;
  // ~990 bytes de ASCII cabem; 400 "ç" (2 bytes cada) = 800 bytes cabem; 600 não.
  assert.ok(serializarAreaTransferencia('a'.repeat(950), limite));
  assert.ok(serializarAreaTransferencia('ç'.repeat(400), limite));
  assert.equal(serializarAreaTransferencia('ç'.repeat(600), limite), null);
});

test('texto grande demais para o canal não é enviado', () => {
  assert.equal(serializarAreaTransferencia('x'.repeat(TAMANHO_MAXIMO_MENSAGEM_CANAL)), null);
  // Um texto grande, mas dentro do limite, passa (e o outro lado aceita).
  const grande = serializarAreaTransferencia('x'.repeat(150_000));
  assert.ok(grande);
  assert.equal(decodificarMensagem(esquemaMensagemCanal, grande)?.tipo, 'area_transferencia');
});

test('quem recebe recusa texto vazio ou acima do máximo', () => {
  for (const texto of ['', 'x'.repeat(200_001)]) {
    assert.equal(decodificarMensagem(esquemaMensagemCanal, JSON.stringify({ tipo: 'area_transferencia', texto })), null);
  }
});
