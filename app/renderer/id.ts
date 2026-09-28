// Funções puras para lidar com o ID digitado/exibido na interface.
import { esquemaId, type IdCliente } from '@acesso-remoto/shared';

const TAMANHO_ID = 9;

/** Mantém só os dígitos do texto, no máximo 9 (aceita colar "123-456-789"). */
export function extrairDigitos(texto: string): string {
  return texto.replace(/\D/g, '').slice(0, TAMANHO_ID);
}

/** Agrupa os dígitos de 3 em 3 para leitura: "123456789" → "123 456 789". */
export function formatarId(digitos: string): string {
  return digitos.match(/\d{1,3}/g)?.join(' ') ?? '';
}

/** Diz se os dígitos formam um ID válido (mesma regra do servidor). */
export function ehIdValido(digitos: string): digitos is IdCliente {
  return esquemaId.safeParse(digitos).success;
}
