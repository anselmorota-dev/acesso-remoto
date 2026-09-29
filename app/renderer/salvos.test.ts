// Testes da regra "salvar só se a conexão der certo".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SalvarAoConectar } from './salvos';
import type { EstadoSessao } from './sessao';

const pedido = { id: '123456789', apelido: 'Notebook', senha: 'frase secreta 1' };

function emSessao(liberada: boolean, parceiro = '123456789'): EstadoSessao {
  return {
    fase: 'em_sessao',
    parceiro,
    papel: 'visualizador',
    conexao: 'conectado',
    latenciaMs: null,
    porSenha: true,
    liberada,
    reconectandoAte: null,
    monitores: null,
    qualidade: null,
    rota: null,
  };
}

test('salva quando a sessão com esse computador fica liberada (senha conferida)', () => {
  const regra = new SalvarAoConectar();
  regra.pedir(pedido);
  assert.equal(regra.aoMudarEstado('123456789', { fase: 'pedindo', destino: '123456789', comSenha: true }), null);
  assert.equal(regra.aoMudarEstado('123456789', emSessao(false)), null); // ainda conferindo a senha
  assert.deepEqual(regra.aoMudarEstado('123456789', emSessao(true)), pedido);
  assert.equal(regra.aoMudarEstado('123456789', emSessao(true)), null); // uma vez só
});

test('senha errada, recusa ou falha: não salva (e esquece o pedido)', () => {
  const regra = new SalvarAoConectar();
  regra.pedir(pedido);
  regra.aoMudarEstado('123456789', emSessao(false));
  assert.equal(regra.aoMudarEstado('123456789', { fase: 'livre', aviso: 'Senha incorreta.' }), null);
  // Uma sessão liberada depois (outra tentativa, sem marcar "Salvar") não salva o pedido antigo.
  assert.equal(regra.aoMudarEstado('123456789', emSessao(true)), null);
});

test('sessão com outro computador não salva o pedido', () => {
  const regra = new SalvarAoConectar();
  regra.pedir(pedido);
  assert.equal(regra.aoMudarEstado('987654321', emSessao(true, '987654321')), null);
  // O fim de uma sessão com outro computador não descarta o pedido.
  assert.equal(regra.aoMudarEstado('987654321', { fase: 'livre' }), null);
  assert.deepEqual(regra.aoMudarEstado('123456789', emSessao(true)), pedido);
});
