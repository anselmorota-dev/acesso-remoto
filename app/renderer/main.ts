// Ponto de entrada da interface: liga o servidor de sinalização, as sessões e
// as telas. Cada parte avisa quando seu estado muda e as telas são
// redesenhadas a partir dos estados.
//
// Várias sessões: este computador acessa até MAXIMO_SESSOES outros ao mesmo
// tempo, uma aba por computador (GerenciadorSessoes cuida dos controladores).
// As telas da sessão (painel, vídeo, monitores, qualidade, chat, arquivos)
// mostram a "sessão visível": a de quem acessa este computador, se houver
// (nesse caso não há abas), ou a da aba à vista.
import { MAXIMO_SESSOES, PROTOCOL_VERSION, type IdCliente } from '@acesso-remoto/shared';
import type { ComputadorSalvo } from '../preload/api';
import { tocarSomPedido } from './alerta';
import { GerenciadorArquivos } from './arquivos';
import { ConversaChat, textoParaEnviar } from './chat';
import { GerenciadorSessoes } from './gerenciador-sessoes';
import { formatarId } from './id';
import { ConexaoPar } from './par';
import { SalvarAoConectar } from './salvos';
import { caixaDeAceiteAberta, parceiroControlando, type EstadoSessao } from './sessao';
import { ClienteSinalizacao, type EstadoSinalizacao } from './sinalizacao';
import { montarTelaAbas } from './telas/abas';
import { montarTelaAcesso } from './telas/acesso';
import { montarTelaArquivos } from './telas/arquivos';
import { montarTelaChat } from './telas/chat';
import { montarTelaInicio } from './telas/inicio';
import { montarTelaMonitores } from './telas/monitores';
import { montarTelaQualidade } from './telas/qualidade';
import { montarTelaSalvos } from './telas/salvos';
import { montarTelaSessao } from './telas/sessao';
import { montarTelaVisualizacao } from './telas/visualizacao';

let estadoSinalizacao: EstadoSinalizacao = { fase: 'conectando' };

/** O que cada sessão aberta guarda para as telas (uma por computador). */
interface SessaoAberta {
  parceiro: IdCliente;
  estado: EstadoSessao;
  /** Visualizador: a imagem que chega desse computador. */
  video: MediaStream | null;
  conversa: ConversaChat;
  arquivos: GerenciadorArquivos;
}

const abertas = new Map<IdCliente, SessaoAberta>();
/** A aba à vista (null = Início). Só existe como visualizador. */
let abaAtiva: IdCliente | null = null;
/** Aviso da última sessão que acabou, mostrado no painel da tela inicial. */
let avisoGeral: string | undefined;

const LIVRE: EstadoSessao = { fase: 'livre' };
/** Conversa vazia para o chat quando não há sessão visível. */
const SEM_CONVERSA = new ConversaChat();

/** A sessão de quem acessa (ou pede para acessar) este computador. */
function sessaoAnfitriao(): SessaoAberta | undefined {
  for (const sessao of abertas.values()) {
    const e = sessao.estado;
    if (e.fase === 'pedido_recebido' || (e.fase === 'em_sessao' && e.papel === 'anfitriao')) return sessao;
  }
  return undefined;
}

/** As sessões como visualizador (as abas), na ordem em que foram abertas. */
function sessoesVisualizador(): SessaoAberta[] {
  const anfitriao = sessaoAnfitriao();
  return [...abertas.values()].filter((s) => s !== anfitriao);
}

function sessaoVisivel(): SessaoAberta | undefined {
  return sessaoAnfitriao() ?? (abaAtiva ? abertas.get(abaAtiva) : undefined);
}

function estadoVisivel(): EstadoSessao {
  return sessaoVisivel()?.estado ?? { fase: 'livre', aviso: avisoGeral };
}

/** A área de transferência é compartilhada só em sessão liberada (aceite ou senha conferida). */
const liberada = (estado: EstadoSessao) => estado.fase === 'em_sessao' && estado.liberada;

// Computadores salvos: a caixa "Salvar este computador" só vale se a conexão der certo.
const salvarAoConectar = new SalvarAoConectar();
let computadoresSalvos: readonly ComputadorSalvo[] = [];

/** Nome do computador para as abas e avisos: o apelido salvo ou o ID. */
function nomeDe(parceiro: IdCliente): string {
  return computadoresSalvos.find((c) => c.id === parceiro)?.apelido || formatarId(parceiro);
}

/** Por que não dá para acessar mais um computador agora (null: dá). */
function bloqueioParaConectar(): string | null {
  if (estadoSinalizacao.fase !== 'online') return '';
  if (sessaoAnfitriao()) return 'Este computador está sendo acessado; encerre a sessão para acessar outro.';
  if (abertas.size >= MAXIMO_SESSOES) return `No máximo ${MAXIMO_SESSOES} computadores ao mesmo tempo.`;
  return null;
}

async function recarregarSalvos(): Promise<void> {
  try {
    computadoresSalvos = await window.api.salvos.listar();
  } catch (erro) {
    console.warn('[salvos] não foi possível ler a lista:', erro);
  }
  renderizar();
}

/** Acessa mais um computador e já mostra a aba dele. */
function conectar(destino: IdCliente, senha: string | undefined): void {
  const motivo = gerenciador.conectar(destino, senha);
  if (motivo === 'ja_aberta') {
    selecionarAba(destino);
    return;
  }
  if (motivo) {
    telaInicio.avisar(bloqueioParaConectar() ?? 'Não é possível acessar mais um computador agora.');
    return;
  }
  avisoGeral = undefined;
  if (abertas.has(destino)) selecionarAba(destino);
  else renderizar();
}

/** Mostra (e passa a controlar) outro computador, ou o Início (null). */
function selecionarAba(parceiro: IdCliente | null): void {
  if (parceiro !== null && !abertas.has(parceiro)) parceiro = null;
  if (parceiro === abaAtiva) return;
  // Solta teclas e botões que estavam apertados no computador que sai de vista.
  telaVisualizacao.atualizar(LIVRE);
  abaAtiva = parceiro;
  telaVisualizacao.definirVideo(parceiro ? (abertas.get(parceiro)?.video ?? null) : null);
  renderizar();
}

const telaAbas = montarTelaAbas({
  aoSelecionar: (parceiro) => selecionarAba(parceiro),
  aoFechar: (parceiro) => gerenciador.obter(parceiro)?.encerrar(),
});

const telaInicio = montarTelaInicio({
  aoConectar: (idRemoto, senha, salvar) => {
    salvarAoConectar.pedir(salvar ? { id: idRemoto, apelido: salvar.apelido, senha } : null);
    conectar(idRemoto, senha);
  },
});

const telaSalvos = montarTelaSalvos({
  // Um clique conecta: com a senha salva (pedida ao main só agora) ou pedindo aceite.
  aoConectar: async (computador) => {
    if (abertas.has(computador.id)) {
      selecionarAba(computador.id);
      return;
    }
    if (bloqueioParaConectar() !== null) return;
    salvarAoConectar.pedir(null);
    let senha: string | undefined;
    if (computador.temSenha) {
      senha = (await window.api.salvos.senha(computador.id)) ?? undefined;
      if (!senha) {
        telaInicio.avisar('Não foi possível ler a senha salva deste computador. Use "Editar" para digitá-la de novo.');
        return;
      }
    } else {
      await window.api.salvos.marcarUso(computador.id);
    }
    if (bloqueioParaConectar() !== null) return; // algo mudou enquanto a senha era lida
    conectar(computador.id, senha);
    void recarregarSalvos();
  },
  aoEditar: async (id, apelido, senha) => {
    const resultado = await window.api.salvos.salvar(id, apelido, senha);
    void recarregarSalvos();
    return resultado;
  },
  aoRemover: async (id) => {
    await window.api.salvos.remover(id);
    void recarregarSalvos();
  },
});

const controladorVisivel = () => {
  const sessao = sessaoVisivel();
  return sessao ? gerenciador.obter(sessao.parceiro) : undefined;
};

const telaSessao = montarTelaSessao({
  aoEncerrar: () => controladorVisivel()?.encerrar(),
  aoResponderPedido: (aceito) => {
    const anfitriao = sessaoAnfitriao();
    if (anfitriao) gerenciador.obter(anfitriao.parceiro)?.responderPedido(aceito);
  },
  aoDispensarAviso: () => {
    avisoGeral = undefined;
    renderizar();
  },
});

// Visualizador: qual monitor do outro computador ver.
const telaMonitores = montarTelaMonitores({
  aoEscolher: (id) => controladorVisivel()?.escolherMonitor(id),
});

// Visualizador: modo de qualidade do vídeo e o que está chegando.
const telaQualidade = montarTelaQualidade({
  aoEscolher: (modo) => controladorVisivel()?.escolherQualidade(modo),
});

// Mouse e teclado vão só para o computador à vista.
const telaVisualizacao = montarTelaVisualizacao({
  aoInput: (evento) => controladorVisivel()?.enviarInput(evento),
});
const telaAcesso = montarTelaAcesso({ senha: window.api.senha, inicioAutomatico: window.api.inicioAutomatico });

// Transferência de arquivos (uma lista por sessão; a tela mostra a da sessão
// visível). Os recebidos são gravados pelo main em Downloads\Acesso Remoto.
const telaArquivos = montarTelaArquivos({
  aoEnviar: (lista) => sessaoVisivel()?.arquivos.enviar(lista),
  aoCancelar: (chave) => sessaoVisivel()?.arquivos.cancelar(chave),
  aoMostrar: (token) => window.api.arquivos.mostrar(token),
  aoLimpar: () => sessaoVisivel()?.arquivos.limpar(),
});
// A falha de gravação diz só o token: cada lista ignora os que não são seus.
window.api.arquivos.aoFalhar((token) => {
  for (const sessao of abertas.values()) sessao.arquivos.falhaNaGravacao(token);
});
function desenharArquivos(): void {
  const arquivos = sessaoVisivel()?.arquivos;
  telaArquivos.atualizar(arquivos?.lista ?? [], arquivos?.podeEnviar ?? false);
}

// Chat: uma conversa por sessão, só em memória; a tela mostra a da sessão visível.
const telaChat = montarTelaChat({
  aoEnviar: (texto) => {
    const sessao = sessaoVisivel();
    const limpo = textoParaEnviar(texto);
    if (!sessao || !limpo || !gerenciador.obter(sessao.parceiro)?.enviarChat(limpo)) return false;
    sessao.conversa.adicionar('eu', limpo, true);
    desenharChat();
    return true;
  },
  aoVer: () => {
    sessaoVisivel()?.conversa.marcarComoLidas();
    desenharChat();
  },
});
function desenharChat(): void {
  const sessao = sessaoVisivel();
  telaChat.atualizar(sessao?.conversa ?? SEM_CONVERSA, sessao ? liberada(sessao.estado) : false);
}
/** A última sessão que avisou mensagem nova (clicar na notificação abre o chat dela). */
let ultimaMensagem: IdCliente | null = null;
window.api.chat.aoAbrir(() => {
  if (ultimaMensagem && abertas.has(ultimaMensagem) && !sessaoAnfitriao()) selecionarAba(ultimaMensagem);
  telaChat.abrir();
});

function renderizar(): void {
  const visivel = estadoVisivel();
  const anfitriao = sessaoAnfitriao();
  telaAbas.atualizar(
    anfitriao
      ? []
      : sessoesVisualizador().map((s) => ({ parceiro: s.parceiro, nome: nomeDe(s.parceiro), estado: s.estado, naoLidas: s.conversa.naoLidas })),
    abaAtiva,
  );
  telaInicio.atualizar(estadoSinalizacao, bloqueioParaConectar());
  telaSalvos.atualizar(computadoresSalvos, bloqueioParaConectar() === null);
  telaSessao.atualizar(visivel);
  telaMonitores.atualizar(visivel);
  telaQualidade.atualizar(visivel);
  // A senha deste computador só não pode mudar enquanto ele é acessado.
  telaAcesso.atualizar(anfitriao?.estado ?? LIVRE);
  // Ícone da bandeja: ID e quem está controlando (o main ignora se nada mudou).
  window.api.bandeja.atualizar({
    id: estadoSinalizacao.fase === 'online' ? estadoSinalizacao.id : null,
    parceiro: anfitriao ? parceiroControlando(anfitriao.estado) : null,
  });
  telaVisualizacao.atualizar(visivel);
  desenharChat();
  desenharArquivos();
}

// Efeitos que dependem de todas as sessões juntas (lembrados para agir só na mudança).
let controlandoAntes: IdCliente | null = null;
let emSessaoAntes = false;
let compartilhaAntes = false;
let caixaAntes = false;

function atualizarEfeitosGlobais(): void {
  const estados = [...abertas.values()].map((s) => s.estado);
  // Pedido novo: traz a janela para frente e toca o aviso.
  // (Pedido com senha é tratado sozinho, sem ninguém para avisar.)
  const caixa = estados.some(caixaDeAceiteAberta);
  if (caixa && !caixaAntes) {
    window.api.chamarAtencao();
    tocarSomPedido();
  }
  caixaAntes = caixa;
  // Indicador flutuante: aparece quando alguém passa a controlar este
  // computador e some quando a sessão acaba.
  const anfitriao = sessaoAnfitriao();
  const controlando = anfitriao ? parceiroControlando(anfitriao.estado) : null;
  if (controlando !== controlandoAntes) window.api.sessao.indicar(controlando);
  controlandoAntes = controlando;
  // Em sessão (qualquer uma), o computador não suspende nem apaga a tela.
  const emSessao = estados.some((e) => e.fase === 'em_sessao');
  if (emSessao !== emSessaoAntes) window.api.sessao.manterAcordado(emSessao);
  emSessaoAntes = emSessao;
  // Área de transferência compartilhada: ligada com alguma sessão liberada. O
  // visualizador manda logo o que já tinha copiado (costuma copiar antes de
  // conectar para colar lá); o anfitrião, só o que copiar dali em diante.
  const compartilha = estados.some(liberada);
  if (compartilha !== compartilhaAntes) window.api.areaTransferencia.monitorar(compartilha, !anfitriao);
  compartilhaAntes = compartilha;
}

/** Uma sessão mudou (o gerenciador avisa; "livre" = acabou e sai da lista). */
function aoMudarSessao(parceiro: IdCliente, estado: EstadoSessao): void {
  const sessao = abertas.get(parceiro);
  if (!sessao) return;
  sessao.estado = estado;
  // "Salvar este computador": só quando a sessão com ele fica liberada (senha conferida ou aceite).
  const salvar = salvarAoConectar.aoMudarEstado(parceiro, estado);
  if (salvar) {
    void window.api.salvos.salvar(salvar.id, salvar.apelido, salvar.senha).then((resultado) => {
      if (!resultado.ok) telaSessao.avisar('Não foi possível salvar este computador.');
      void recarregarSalvos();
    });
  }
  if (estado.fase === 'livre') {
    const eraVisivel = sessaoVisivel() === sessao;
    abertas.delete(parceiro);
    if (abaAtiva === parceiro) {
      // Mostra outra aba aberta (a última), ou volta ao Início.
      const restantes = sessoesVisualizador();
      selecionarAba(restantes.at(-1)?.parceiro ?? null);
    }
    // O motivo do fim: no painel da tela inicial, ou como aviso passageiro
    // na sessão que continua à vista.
    if (estado.aviso) {
      const texto = abertas.size > 0 || !eraVisivel ? `${nomeDe(parceiro)}: ${estado.aviso}` : estado.aviso;
      if (sessaoVisivel()) telaSessao.avisar(texto);
      else avisoGeral = texto;
    }
  }
  atualizarEfeitosGlobais();
  renderizar();
}

const sinalizacao = new ClienteSinalizacao({
  url: import.meta.env.RENDERER_VITE_SERVIDOR_URL,
  // ID fixo: a chave privada da instalação fica no main, que assina o desafio.
  identidade: window.api.identidade,
  aoMudarEstado: (estado) => {
    estadoSinalizacao = estado;
    // Sem servidor, sessões já conectadas continuam (pela conexão direta);
    // ao voltar, cada uma é declarada para o servidor religar os dois lados.
    if (estado.fase === 'online') gerenciador.servidorVoltou();
    else gerenciador.servidorPerdido();
    renderizar();
  },
  aoMensagem: (mensagem) => {
    // Pedido de acesso a este computador: a sessão nova aparece no lugar do aviso antigo.
    if (mensagem.tipo === 'pedido_conexao') avisoGeral = undefined;
    gerenciador.receber(mensagem);
  },
});

const gerenciador = new GerenciadorSessoes({
  aoMudar: aoMudarSessao,
  // Cada sessão nova ganha a sua conversa, a sua lista de arquivos e a sua imagem.
  opcoesDaSessao: (parceiro) => {
    const sessao: SessaoAberta = {
      parceiro,
      estado: LIVRE,
      video: null,
      conversa: new ConversaChat(),
      arquivos: new GerenciadorArquivos({
        gravador: window.api.arquivos,
        aoMudar: () => {
          if (sessaoVisivel() === sessao) desenharArquivos();
        },
      }),
    };
    abertas.set(parceiro, sessao);
    return {
      enviar: (mensagem) => sinalizacao.enviar(mensagem),
      // RENDERER_VITE_SOMENTE_TURN=1 (app/.env.local, só para testes): proíbe o caminho direto.
      criarPar: (opcoes) => new ConexaoPar({ ...opcoes, somenteTurn: import.meta.env.RENDERER_VITE_SOMENTE_TURN === '1' }),
      aoMudarVideo: (video) => {
        sessao.video = video;
        if (sessaoVisivel() === sessao) telaVisualizacao.definirVideo(video);
      },
      // Anfitrião: quem executa input é o processo de input; o renderer apenas repassa.
      aoReceberInput: (evento) => window.api.input.executar(evento),
      aoLiberarInput: () => window.api.input.liberar(),
      // Anfitrião: os monitores deste computador (o visualizador escolhe qual ver).
      listarMonitores: () => window.api.monitores.listar(),
      // Acesso com senha: quem sabe se há senha e quem confere é o main.
      senhaDefinida: () => window.api.senha.estado().then((estado) => estado.definida),
      tentarSenha: (senha) => window.api.senha.tentar(senha),
      verificarServidor: () => sinalizacao.verificarConexao(),
      aoReceberAreaTransferencia: (texto) => window.api.areaTransferencia.escrever(texto),
      // Canal de arquivos: só com a sessão liberada (o controlador decide).
      aoMudarCanalArquivos: (canal) => sessao.arquivos.definirCanal(canal),
      aoMensagemArquivos: (dados) => sessao.arquivos.receber(dados),
      // Mensagem do chat: entra na conversa da sessão; fora de vista, conta como
      // não lida (aparece na aba) e o main avisa se a janela não estiver em foco.
      aoReceberChat: (texto) => {
        const vista = sessaoVisivel() === sessao && telaChat.visivel;
        sessao.conversa.adicionar('outro', texto, vista);
        ultimaMensagem = parceiro;
        window.api.chat.notificar(parceiro, texto);
        renderizar();
      },
    };
  },
});

// Texto copiado neste computador: vai para quem controla este computador ou,
// como visualizador, só para o computador à vista.
window.api.areaTransferencia.aoCopiar((texto) => {
  const sessao = sessaoVisivel();
  if (!sessao) return;
  const resultado = texto === null ? 'grande_demais' : (gerenciador.obter(sessao.parceiro)?.enviarAreaTransferencia(texto) ?? 'ignorado');
  if (resultado === 'grande_demais') {
    telaSessao.avisar('O texto copiado é grande demais para ir ao outro computador (limite de cerca de 250 KB).');
  }
});

// Um monitor entrou, saiu ou mudou de resolução: quem vê este computador fica
// sabendo (e, se o que ele via sumiu, a imagem volta ao principal).
window.api.monitores.aoMudar(() => {
  const anfitriao = sessaoAnfitriao();
  if (anfitriao) gerenciador.obter(anfitriao.parceiro)?.monitoresMudaram();
});

// Encerrar pelo indicador flutuante ou pelo menu da bandeja: a sessão de quem
// controla este computador.
window.api.sessao.aoPedirEncerramento(() => {
  const anfitriao = sessaoAnfitriao();
  if (anfitriao) gerenciador.obter(anfitriao.parceiro)?.encerrar();
});

sinalizacao.iniciar();
void recarregarSalvos();

const rodape = document.querySelector('#rodape');
if (rodape) {
  rodape.textContent = `Protocolo v${PROTOCOL_VERSION} · Electron ${window.api.versoes.electron}`;
}
