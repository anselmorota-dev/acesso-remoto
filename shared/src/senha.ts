// Regras da senha de acesso não supervisionado. Usadas pelo app ao definir
// a senha e, a partir da 3.3, ao conectar com ela.

export const SENHA_MINIMA = 8;
/** Limite generoso (frases-senha), só para barrar abusos. */
export const SENHA_MAXIMA = 128;

/**
 * Normaliza para a forma Unicode NFC: "ç" pode chegar como um caractere só
 * ou como "c" + cedilha, dependendo do sistema e do teclado. Sem isso, a
 * mesma senha digitada no macOS e no Windows poderia não bater.
 */
export function normalizarSenha(senha: string): string {
  return senha.normalize('NFC');
}

export type ProblemaSenha = 'curta' | 'longa';

/** O que impede a senha de ser aceita, ou null se ela serve. Conta caracteres, não bytes. */
export function problemaNaSenha(senha: string): ProblemaSenha | null {
  const tamanho = [...normalizarSenha(senha)].length;
  if (tamanho < SENHA_MINIMA) return 'curta';
  if (tamanho > SENHA_MAXIMA) return 'longa';
  return null;
}
