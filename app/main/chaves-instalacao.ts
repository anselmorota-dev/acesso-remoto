// Identidade da instalação: um par de chaves Ed25519 gerado na primeira
// execução. O servidor liga o ID fixo à chave pública; a cada conexão o app
// prova que é o dono assinando um desafio com a chave privada.
//
// - A chave privada fica em userData, cifrada pelo sistema operacional
//   (safeStorage do Electron: DPAPI no Windows, Keychain no macOS). Assim o
//   arquivo copiado para outra máquina/usuário não serve para se passar por
//   esta instalação.
// - Se o arquivo sumir, estiver corrompido ou não decifrar, uma identidade
//   nova é gerada (e com ela um ID novo); o arquivo antigo é guardado ao lado.
// - Só assina desafios no formato do protocolo, sempre com o prefixo de
//   registro: a chave não serve para assinar outra coisa.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { esquemaDesafio, mensagemDeRegistro } from '@acesso-remoto/shared';

/** Cifra do sistema (no app, o safeStorage do Electron; nos testes, uma falsa). */
export interface Cifra {
  disponivel(): boolean;
  cifrar(texto: string): Buffer;
  decifrar(dados: Buffer): string;
}

export interface OpcoesChaves {
  arquivo: string;
  cifra: Cifra;
  log?: (mensagem: string) => void;
}

const VERSAO_ARQUIVO = 1;

interface ConteudoArquivo {
  versao: number;
  /** Chave pública em base64url (é o que vai para o servidor). */
  chavePublica: string;
  /** Chave privada PKCS#8 (DER), cifrada ou não, em base64. */
  chavePrivada: string;
  cifrada: boolean;
}

export class ChavesInstalacao {
  readonly chavePublica: string;
  private readonly chavePrivada: KeyObject;

  private constructor(chavePrivada: KeyObject) {
    this.chavePrivada = chavePrivada;
    this.chavePublica = chavePublicaDe(chavePrivada);
  }

  /** Carrega a identidade do arquivo, ou gera e grava uma nova. */
  static async abrir(opcoes: OpcoesChaves): Promise<ChavesInstalacao> {
    const log = opcoes.log ?? console.log;
    const carregada = await carregar(opcoes, log);
    if (carregada) return new ChavesInstalacao(carregada);

    const { privateKey } = generateKeyPairSync('ed25519');
    await gravar(opcoes, privateKey, log);
    log('[main] identidade da instalação criada (novo ID fixo)');
    return new ChavesInstalacao(privateKey);
  }

  /** Assina o desafio do servidor (prefixo de registro + desafio). */
  assinarDesafio(desafio: string): string {
    if (!esquemaDesafio.safeParse(desafio).success) throw new Error('desafio inválido');
    return sign(null, Buffer.from(mensagemDeRegistro(desafio)), this.chavePrivada).toString('base64url');
  }
}

function chavePublicaDe(chavePrivada: KeyObject): string {
  const x = createPublicKey(chavePrivada).export({ format: 'jwk' }).x;
  if (!x) throw new Error('chave sem componente público');
  return x;
}

/** Lê a chave privada do arquivo; null se não existe ou não serve (guarda o inválido ao lado). */
async function carregar(opcoes: OpcoesChaves, log: (mensagem: string) => void): Promise<KeyObject | null> {
  let texto: string;
  try {
    texto = await readFile(opcoes.arquivo, 'utf8');
  } catch {
    return null; // primeira execução
  }
  try {
    const conteudo = JSON.parse(texto) as ConteudoArquivo;
    if (conteudo.versao !== VERSAO_ARQUIVO) throw new Error(`versão ${conteudo.versao}`);
    const bytes = Buffer.from(conteudo.chavePrivada, 'base64');
    const der = conteudo.cifrada ? Buffer.from(opcoes.cifra.decifrar(bytes), 'base64') : bytes;
    const chave = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    // Confere que a chave privada corresponde à pública anotada (integridade).
    if (chave.asymmetricKeyType !== 'ed25519' || chavePublicaDe(chave) !== conteudo.chavePublica) {
      throw new Error('chaves não correspondem');
    }
    return chave;
  } catch (erro) {
    log(`[main] identidade da instalação ilegível (${(erro as Error).message}); será criada outra`);
    await rename(opcoes.arquivo, `${opcoes.arquivo}.invalido`).catch(() => {});
    return null;
  }
}

async function gravar(opcoes: OpcoesChaves, chavePrivada: KeyObject, log: (mensagem: string) => void): Promise<void> {
  const der = chavePrivada.export({ format: 'der', type: 'pkcs8' });
  const cifrada = opcoes.cifra.disponivel();
  if (!cifrada) log('[main] aviso: sem cifra do sistema disponível; a chave da instalação fica sem cifrar');
  const conteudo: ConteudoArquivo = {
    versao: VERSAO_ARQUIVO,
    chavePublica: chavePublicaDe(chavePrivada),
    chavePrivada: cifrada ? opcoes.cifra.cifrar(der.toString('base64')).toString('base64') : der.toString('base64'),
    cifrada,
  };
  // Gravação atômica: um arquivo pela metade custaria o ID da instalação.
  const temporario = `${opcoes.arquivo}.tmp`;
  await writeFile(temporario, JSON.stringify(conteudo), { encoding: 'utf8', mode: 0o600 });
  await rename(temporario, opcoes.arquivo);
}
