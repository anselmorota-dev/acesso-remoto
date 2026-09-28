// Formato das mensagens trocadas entre o app e o servidor de sinalização.
// Cada mensagem é um objeto JSON com o campo "tipo", que identifica o formato.
// Os esquemas Zod servem para duas coisas: validar o que chega pela rede
// e gerar os tipos TypeScript (assim tipo e validação nunca divergem).
import { z } from 'zod';

/** ID de 9 dígitos, sem zero à esquerda (ex.: "123456789"). */
export const esquemaId = z.string().regex(/^[1-9]\d{8}$/, 'ID deve ter 9 dígitos');
export type IdCliente = z.infer<typeof esquemaId>;

/** Papel de cada lado numa sessão: quem mostra a tela e quem acessa. */
export const esquemaPapel = z.enum(['anfitriao', 'visualizador']);
export type Papel = z.infer<typeof esquemaPapel>;

// ---------------------------------------------------------------------------
// Sinais WebRTC: o servidor só repassa entre os dois lados de uma sessão.
// ---------------------------------------------------------------------------

/** Descrições SDP costumam ter poucos KB; o limite barra abusos. */
const sdp = z.string().min(1).max(32 * 1024);

export const esquemaSinal = z.discriminatedUnion('tipo', [
  /** Proposta de conexão (o anfitrião cria). */
  z.object({ tipo: z.literal('oferta'), sdp }),
  /** Resposta à oferta (o visualizador cria). */
  z.object({ tipo: z.literal('resposta'), sdp }),
  /** Um caminho de rede possível (candidato ICE), enviado assim que descoberto. */
  z.object({
    tipo: z.literal('ice'),
    candidato: z.object({
      candidate: z.string().max(1024),
      sdpMid: z.string().max(64).nullish(),
      sdpMLineIndex: z.number().int().nonnegative().nullish(),
      usernameFragment: z.string().max(256).nullish(),
    }),
  }),
]);
export type Sinal = z.infer<typeof esquemaSinal>;

/** Falhas que fazem um lado encerrar a sessão; repassadas ao outro lado. */
export const esquemaMotivoFalha = z.enum([
  /** O anfitrião não conseguiu capturar a própria tela. */
  'captura_indisponivel',
  /** A conexão direta (WebRTC) não pôde ser estabelecida ou caiu. */
  'falha_conexao',
  /** Acesso com senha: a senha não confere (ou não chegou a tempo). */
  'senha_incorreta',
  /** Acesso com senha: muitas tentativas erradas; o anfitrião recusa por um tempo. */
  'senha_bloqueada',
]);
export type MotivoFalha = z.infer<typeof esquemaMotivoFalha>;

// ---------------------------------------------------------------------------
// Identidade da instalação (ID fixo)
// ---------------------------------------------------------------------------
//
// Cada instalação tem um par de chaves Ed25519. O servidor liga o ID fixo à
// chave pública e, a cada conexão, pede que o app assine um desafio aleatório:
// só quem tem a chave privada consegue usar aquele ID.

/** Base64url sem preenchimento ("="), com o tamanho exato de N bytes. */
const base64url = (bytes: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((bytes * 4) / 3)}}$`));

/** Chave pública Ed25519 (32 bytes), em base64url. */
export const esquemaChavePublica = base64url(32);
/** Desafio aleatório do servidor (32 bytes), em base64url. */
export const esquemaDesafio = base64url(32);
/** Assinatura Ed25519 (64 bytes), em base64url. */
export const esquemaAssinatura = base64url(64);

/**
 * O que é assinado de fato: um prefixo fixo + o desafio. O prefixo impede que
 * uma assinatura feita para outro fim seja reaproveitada como prova de registro.
 */
export function mensagemDeRegistro(desafio: string): string {
  return `acesso-remoto/registro/v1:${desafio}`;
}

// ---------------------------------------------------------------------------
// App → servidor
// ---------------------------------------------------------------------------

export const esquemaMensagemDoCliente = z.discriminatedUnion('tipo', [
  /**
   * Primeira mensagem de toda conexão: apresenta a identidade da instalação
   * (chave pública) e pede o ID dela. O servidor responde com um "desafio".
   */
  z.object({
    tipo: z.literal('registrar'),
    /** Versão do protocolo do app, para o servidor recusar versões incompatíveis. */
    versao: z.number().int().nonnegative(),
    /**
     * Opcional só no esquema: um app antigo (sem identidade) precisa receber
     * "versao_incompativel", e não "mensagem_invalida". O servidor a exige.
     */
    chavePublica: esquemaChavePublica.optional(),
  }),
  /** Resposta ao desafio: prova que a instalação tem a chave privada. */
  z.object({ tipo: z.literal('provar'), assinatura: esquemaAssinatura }),
  /** Visualizador pede para acessar o computador com o ID "destino". */
  z.object({
    tipo: z.literal('conectar'),
    destino: esquemaId,
    /**
     * O visualizador vai provar uma senha (acesso não supervisionado). A senha
     * em si nunca passa pelo servidor: vai pela conexão direta depois.
     */
    comSenha: z.boolean(),
  }),
  /** Anfitrião aceita ou recusa o pedido vindo de "origem". */
  z.object({
    tipo: z.literal('responder_pedido'),
    origem: esquemaId,
    aceito: z.boolean(),
    /**
     * Aceito sem ninguém clicar, para conferir a senha pela conexão direta.
     * Só vale para pedidos "comSenha"; tela e controle ficam travados até a senha conferir.
     */
    porSenha: z.boolean(),
  }),
  /** Sinal WebRTC para o outro lado da sessão. */
  z.object({ tipo: z.literal('sinal'), sinal: esquemaSinal }),
  /** Cancela o pedido em andamento ou encerra a sessão atual (com o motivo, se foi falha). */
  z.object({ tipo: z.literal('encerrar'), motivo: esquemaMotivoFalha.optional() }),
]);
export type MensagemDoCliente = z.infer<typeof esquemaMensagemDoCliente>;

// ---------------------------------------------------------------------------
// Servidor → app
// ---------------------------------------------------------------------------

export const esquemaCodigoErro = z.enum([
  /** JSON malformado, tipo desconhecido ou campos inválidos. */
  'mensagem_invalida',
  /** App e servidor usam versões diferentes do protocolo. */
  'versao_incompativel',
  /** A conexão tentou se registrar mais de uma vez. */
  'ja_registrado',
  /** Mensagem que exige ID enviada antes de "registrar". */
  'nao_registrado',
  /** Tentou conectar no próprio ID. */
  'destino_invalido',
  /** Pediu nova conexão tendo um pedido ou sessão em andamento. */
  'ja_em_sessao',
  /** Respondeu a um pedido que não existe (ou já expirou). */
  'pedido_inexistente',
  /** Enviou sinal WebRTC sem estar numa sessão. */
  'sem_sessao',
  /** "provar" sem desafio pendente, ou assinatura que não confere com a chave. */
  'assinatura_invalida',
  /** Falha temporária do servidor (ex.: banco de dados fora do ar); tente de novo. */
  'indisponivel',
  /** A mesma instalação conectou de novo em outro lugar; esta conexão foi substituída. */
  'substituida',
  /** Muitas tentativas seguidas (pedidos, instalações novas): aguarde um pouco. */
  'limite_excedido',
]);
export type CodigoErro = z.infer<typeof esquemaCodigoErro>;

export const esquemaMotivoRecusa = z.enum([
  /** O anfitrião clicou em Recusar. */
  'recusado',
  /** Não há ninguém online com esse ID. */
  'offline',
  /** O anfitrião já está em outra sessão ou pedido. */
  'ocupado',
  /** O anfitrião não respondeu a tempo. */
  'sem_resposta',
  /** Acesso com senha pausado para este destino: senhas erradas demais (limite no servidor). */
  'bloqueado',
]);
export type MotivoRecusa = z.infer<typeof esquemaMotivoRecusa>;

export const esquemaMotivoEncerramento = z.enum([
  /** O outro lado clicou em Encerrar. */
  'encerrada_pelo_parceiro',
  /** O outro lado perdeu a conexão com o servidor. */
  'parceiro_desconectou',
  // O outro lado encerrou por uma falha:
  ...esquemaMotivoFalha.options,
]);
export type MotivoEncerramento = z.infer<typeof esquemaMotivoEncerramento>;

export const esquemaMensagemDoServidor = z.discriminatedUnion('tipo', [
  /** Resposta ao "registrar": assine este desafio e responda com "provar". */
  z.object({ tipo: z.literal('desafio'), desafio: esquemaDesafio }),
  /** Resposta ao "provar" aceito: o ID fixo desta instalação. */
  z.object({ tipo: z.literal('registrado'), id: esquemaId }),
  z.object({ tipo: z.literal('erro'), codigo: esquemaCodigoErro, mensagem: z.string() }),
  /**
   * Para o anfitrião: alguém quer acessar este computador. "prazoMs" é quanto
   * tempo ele tem para responder antes de o servidor cancelar o pedido
   * (usado para mostrar a contagem regressiva; quem decide é o servidor).
   */
  z.object({
    tipo: z.literal('pedido_conexao'),
    origem: esquemaId,
    prazoMs: z.number().int().positive().max(5 * 60_000),
    /** O visualizador tem uma senha para provar (acesso não supervisionado). */
    comSenha: z.boolean(),
  }),
  /** Para o anfitrião: quem pediu desistiu (cancelou, caiu ou o prazo acabou). */
  z.object({ tipo: z.literal('pedido_cancelado'), origem: esquemaId }),
  /** Para o visualizador: o pedido não foi aceito. */
  z.object({ tipo: z.literal('pedido_recusado'), destino: esquemaId, motivo: esquemaMotivoRecusa }),
  /** Para os dois lados: pedido aceito, podem começar a negociar o WebRTC. */
  z.object({
    tipo: z.literal('sessao_iniciada'),
    parceiro: esquemaId,
    papel: esquemaPapel,
    /** Aceita por senha: tela e controle só depois de a senha conferir pela conexão direta. */
    porSenha: z.boolean(),
  }),
  /** Sinal WebRTC vindo do outro lado da sessão. */
  z.object({ tipo: z.literal('sinal'), sinal: esquemaSinal }),
  /** A sessão terminou pelo outro lado. */
  z.object({ tipo: z.literal('sessao_encerrada'), motivo: esquemaMotivoEncerramento }),
]);
export type MensagemDoServidor = z.infer<typeof esquemaMensagemDoServidor>;

// ---------------------------------------------------------------------------
// Utilitário
// ---------------------------------------------------------------------------

/**
 * Converte o texto recebido pela rede numa mensagem validada.
 * Retorna null se não for JSON ou não seguir o esquema — nunca lança erro,
 * porque dado vindo da rede não é confiável.
 */
export function decodificarMensagem<T>(esquema: z.ZodType<T>, texto: string): T | null {
  let dados: unknown;
  try {
    dados = JSON.parse(texto);
  } catch {
    return null;
  }
  const resultado = esquema.safeParse(dados);
  return resultado.success ? resultado.data : null;
}
