// Utilitários comuns às telas.

/** Busca um elemento obrigatório da página; falha cedo se o HTML mudar. */
export function elemento<T extends HTMLElement>(seletor: string): T {
  const encontrado = document.querySelector<T>(seletor);
  if (!encontrado) throw new Error(`Elemento ${seletor} não encontrado`);
  return encontrado;
}
