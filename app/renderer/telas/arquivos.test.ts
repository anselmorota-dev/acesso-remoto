// Testa os textos da lista de arquivos (tamanhos e situação de cada item).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Transferencia } from '../arquivos';
import { descreverTransferencia, formatarTamanho } from './arquivos';

test('tamanhos em português, com a unidade certa', () => {
  assert.equal(formatarTamanho(0), '0 bytes');
  assert.equal(formatarTamanho(1), '1 byte');
  assert.equal(formatarTamanho(1023), '1023 bytes');
  assert.equal(formatarTamanho(1536), '1,5 KB');
  assert.equal(formatarTamanho(820 * 1024), '820 KB');
  assert.equal(formatarTamanho(5.25 * 1024 * 1024), '5,3 MB');
  assert.equal(formatarTamanho(3 * 1024 ** 3), '3,0 GB');
});

const base: Transferencia = {
  chave: 't1',
  direcao: 'enviando',
  nome: 'relatorio.pdf',
  tamanho: 10 * 1024 * 1024,
  transferidos: 0,
  estado: 'na_fila',
};

test('situação de cada item', () => {
  assert.equal(descreverTransferencia(base, 0), '10 MB · na fila');
  assert.equal(
    descreverTransferencia({ ...base, estado: 'transferindo', transferidos: 4 * 1024 * 1024, iniciadoEm: 0 }, 2000),
    '4,0 MB de 10 MB · 2,0 MB/s',
  );
  assert.equal(descreverTransferencia({ ...base, estado: 'finalizando' }, 0), '10 MB · aguardando confirmação…');
  assert.equal(descreverTransferencia({ ...base, direcao: 'recebendo', estado: 'finalizando' }, 0), '10 MB · gravando…');
  assert.equal(
    descreverTransferencia({ ...base, direcao: 'recebendo', estado: 'concluido' }, 0),
    '10 MB · salvo em Downloads\\Acesso Remoto',
  );
  assert.equal(descreverTransferencia({ ...base, estado: 'cancelado', motivo: 'cancelado por você' }, 0), 'cancelado (cancelado por você)');
  assert.equal(descreverTransferencia({ ...base, estado: 'erro', motivo: 'o arquivo chegou incompleto' }, 0), 'erro: o arquivo chegou incompleto');
});
