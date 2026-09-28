// Ponto de entrada da interface: liga o servidor de sinalização, o
// controlador de sessão e as telas. Cada parte avisa quando seu estado muda
// e as telas são redesenhadas a partir dos dois estados.
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { tocarSomPedido } from './alerta';
import { GerenciadorArquivos } from './arquivos';
import { ConexaoPar } from './par';
import { ControladorSessao, caixaDeAceiteAberta, parceiroControlando, type EstadoSessao } from './sessao';
import { ClienteSinalizacao, type EstadoSinalizacao } from './sinalizacao';
import { montarTelaAcesso } from './telas/acesso';
import { montarTelaArquivos } from './telas/arquivos';
import { montarTelaInicio } from './telas/inicio';
import { montarTelaSessao } from './telas/sessao';
import { montarTelaVisualizacao } from './telas/visualizacao';

let estadoSinalizacao: EstadoSinalizacao = { fase: 'conectando' };
let estadoSessao: EstadoSessao = { fase: 'livre' };

/** A área de transferência é compartilhada só em sessão liberada (aceite ou senha conferida). */
const compartilhaAreaTransferencia = (estado: EstadoSessao) => estado.fase === 'em_sessao' && estado.liberada;

const telaInicio = montarTelaInicio({
  aoConectar: (idRemoto, senha) => controlador.conectar(idRemoto, senha),
});
const telaSessao = montarTelaSessao({
  aoEncerrar: () => controlador.encerrar(),
  aoResponderPedido: (aceito) => controlador.responderPedido(aceito),
});

const telaVisualizacao = montarTelaVisualizacao({
  aoInput: (evento) => controlador.enviarInput(evento),
});
const telaAcesso = montarTelaAcesso({ senha: window.api.senha, inicioAutomatico: window.api.inicioAutomatico });

// Transferência de arquivos: os dois lados enviam; os recebidos são gravados
// pelo main em Downloads\Acesso Remoto.
const arquivos = new GerenciadorArquivos({
  gravador: window.api.arquivos,
  aoMudar: (lista) => telaArquivos.atualizar(lista, arquivos.podeEnviar),
});
const telaArquivos = montarTelaArquivos({
  aoEnviar: (lista) => arquivos.enviar(lista),
  aoCancelar: (chave) => arquivos.cancelar(chave),
  aoMostrar: (token) => window.api.arquivos.mostrar(token),
  aoLimpar: () => arquivos.limpar(),
});
window.api.arquivos.aoFalhar((token) => arquivos.falhaNaGravacao(token));

function renderizar(): void {
  telaInicio.atualizar(estadoSinalizacao, estadoSessao);
  telaSessao.atualizar(estadoSessao);
  telaAcesso.atualizar(estadoSessao);
  // Ícone da bandeja: ID e quem está controlando (o main ignora se nada mudou).
  window.api.bandeja.atualizar({
    id: estadoSinalizacao.fase === 'online' ? estadoSinalizacao.id : null,
    parceiro: parceiroControlando(estadoSessao),
  });
  telaVisualizacao.atualizar(estadoSessao);
}

const sinalizacao = new ClienteSinalizacao({
  url: import.meta.env.RENDERER_VITE_SERVIDOR_URL,
  // ID fixo: a chave privada da instalação fica no main, que assina o desafio.
  identidade: window.api.identidade,
  aoMudarEstado: (estado) => {
    estadoSinalizacao = estado;
    // Sem servidor, uma sessão já conectada continua (pela conexão direta);
    // ao voltar, o controlador a declara para o servidor religar os dois.
    if (estado.fase === 'online') controlador.servidorVoltou();
    else controlador.servidorPerdido();
    renderizar();
  },
  aoMensagem: (mensagem) => controlador.receber(mensagem),
});

const controlador = new ControladorSessao({
  enviar: (mensagem) => sinalizacao.enviar(mensagem),
  aoMudarEstado: (estado) => {
    // Pedido novo: traz a janela para frente e toca o aviso.
    // (Pedido com senha é tratado sozinho, sem ninguém para avisar.)
    if (caixaDeAceiteAberta(estado) && !caixaDeAceiteAberta(estadoSessao)) {
      window.api.chamarAtencao();
      tocarSomPedido();
    }
    // Indicador flutuante: aparece quando alguém passa a controlar este
    // computador e some quando a sessão acaba.
    const controlando = parceiroControlando(estado);
    if (controlando !== parceiroControlando(estadoSessao)) window.api.sessao.indicar(controlando);
    // Em sessão, nenhum dos dois computadores suspende nem apaga a tela.
    const emSessao = estado.fase === 'em_sessao';
    if (emSessao !== (estadoSessao.fase === 'em_sessao')) window.api.sessao.manterAcordado(emSessao);
    // Área de transferência compartilhada: só com a sessão liberada. O
    // visualizador manda logo o que já tinha copiado (costuma copiar antes de
    // conectar para colar lá); o anfitrião, só o que copiar dali em diante.
    const compartilhar = compartilhaAreaTransferencia(estado);
    if (compartilhar !== compartilhaAreaTransferencia(estadoSessao)) {
      window.api.areaTransferencia.monitorar(compartilhar, estado.fase === 'em_sessao' && estado.papel === 'visualizador');
    }
    estadoSessao = estado;
    renderizar();
  },
  criarPar: (opcoes) => new ConexaoPar(opcoes),
  aoMudarVideo: (video) => telaVisualizacao.definirVideo(video),
  // Anfitrião: só o main executa input; o renderer apenas repassa.
  aoReceberInput: (evento) => window.api.input.executar(evento),
  aoLiberarInput: () => window.api.input.liberar(),
  // Acesso com senha: quem sabe se há senha e quem confere é o main.
  senhaDefinida: () => window.api.senha.estado().then((estado) => estado.definida),
  tentarSenha: (senha) => window.api.senha.tentar(senha),
  verificarServidor: () => sinalizacao.verificarConexao(),
  aoReceberAreaTransferencia: (texto) => window.api.areaTransferencia.escrever(texto),
  // Canal de arquivos: só com a sessão liberada (o controlador decide).
  aoMudarCanalArquivos: (canal) => arquivos.definirCanal(canal),
  aoMensagemArquivos: (dados) => arquivos.receber(dados),
});

// Texto copiado neste computador durante a sessão: vai para o outro.
window.api.areaTransferencia.aoCopiar((texto) => {
  const resultado = texto === null ? 'grande_demais' : controlador.enviarAreaTransferencia(texto);
  if (resultado === 'grande_demais') {
    telaSessao.avisar('O texto copiado é grande demais para ir ao outro computador (limite de cerca de 250 KB).');
  }
});

// Encerrar pelo botão do indicador flutuante.
window.api.sessao.aoPedirEncerramento(() => controlador.encerrar());

sinalizacao.iniciar();

const rodape = document.querySelector('#rodape');
if (rodape) {
  rodape.textContent = `Protocolo v${PROTOCOL_VERSION} · Electron ${window.api.versoes.electron}`;
}
