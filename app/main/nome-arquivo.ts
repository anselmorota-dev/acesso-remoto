// Nome seguro para um arquivo recebido do outro computador. O nome vem da
// rede: não pode escolher a pasta ("..\..\Windows"), usar nomes reservados
// do Windows (CON, NUL...) nem sobrescrever um arquivo que já existe.

/** Caracteres proibidos em nomes de arquivo no Windows (e controles). */
const PROIBIDOS = /[<>:"/\\|?*\x00-\x1f\x7f]/g;
/** Nomes que o Windows reserva para dispositivos, com ou sem extensão. */
const RESERVADOS = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
/** Comprimento máximo do nome final (a pasta também conta no limite do Windows). */
const COMPRIMENTO_MAXIMO = 150;

/** Separa "relatorio.final.pdf" em ["relatorio.final", ".pdf"]. */
function separarExtensao(nome: string): [string, string] {
  const ponto = nome.lastIndexOf('.');
  // Ponto no início (".bashrc") não é extensão.
  return ponto > 0 ? [nome.slice(0, ponto), nome.slice(ponto)] : [nome, ''];
}

export function nomeSeguro(recebido: string): string {
  // Só o último pedaço: qualquer caminho que venha junto é descartado.
  const partes = recebido.split(/[/\\]/);
  let nome = (partes[partes.length - 1] ?? '').replace(PROIBIDOS, '_');
  // O Windows ignora pontos e espaços no fim (e "a." viraria "a").
  nome = nome.replace(/[. ]+$/, '').trim();
  if (!nome || nome === '.' || nome === '..') nome = 'arquivo';
  if (RESERVADOS.test(nome)) nome = `_${nome}`;
  if (nome.length > COMPRIMENTO_MAXIMO) {
    const [base, extensao] = separarExtensao(nome);
    const ext = extensao.length <= 20 ? extensao : '';
    nome = base.slice(0, COMPRIMENTO_MAXIMO - ext.length) + ext;
  }
  return nome;
}

/**
 * Primeiro nome livre na pasta: "foto.jpg", "foto (2).jpg", "foto (3).jpg"...
 * Nunca sobrescreve. "existe" diz se o nome já está em uso (sem diferenciar
 * maiúsculas, como o Windows).
 */
export function nomeLivre(nome: string, existe: (nome: string) => boolean): string {
  if (!existe(nome)) return nome;
  const [base, extensao] = separarExtensao(nome);
  for (let n = 2; n < 10_000; n++) {
    const candidato = `${base} (${n})${extensao}`;
    if (!existe(candidato)) return candidato;
  }
  return `${base} (${Date.now()})${extensao}`;
}
