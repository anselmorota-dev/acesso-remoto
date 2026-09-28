// Geração dos IDs de 9 dígitos que identificam cada app conectado.
import { randomInt } from 'node:crypto';
import type { IdCliente } from '@acesso-remoto/shared';

const MENOR_ID = 100_000_000; // primeiro ID de 9 dígitos
const MAIOR_ID = 999_999_999;
const MAX_TENTATIVAS = 100;

/**
 * Sorteia um ID que ainda não esteja em uso.
 *
 * Usa randomInt do módulo crypto (imprevisível) em vez de Math.random:
 * IDs previsíveis facilitariam alguém "adivinhar" quem está online.
 * Com 900 milhões de combinações, colisões são raríssimas; o limite de
 * tentativas só evita um laço infinito em caso de bug.
 */
export function gerarId(
  emUso: (id: IdCliente) => boolean,
  sortear: () => number = () => randomInt(MENOR_ID, MAIOR_ID + 1),
): IdCliente {
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    const id = String(sortear());
    if (!emUso(id)) return id;
  }
  throw new Error('Não foi possível gerar um ID livre');
}
