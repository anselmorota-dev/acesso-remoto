// Ponto de entrada da interface: liga o servidor de sinalização, o
// controlador de sessão e as telas. Cada parte avisa quando seu estado muda
// e as telas são redesenhadas a partir dos dois estados.
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { tocarSomPedido } from './alerta';
import { ConexaoPar } from './par';
import { ControladorSessao, parceiroControlando, type EstadoSessao } from './sessao';
import { ClienteSinalizacao, type EstadoSinalizacao } from './sinalizacao';
import { montarTelaAcesso } from './telas/acesso';
import { montarTelaInicio } from './telas/inicio';
import { montarTelaSessao } from './telas/sessao';
import { montarTelaVisualizacao } from './telas/visualizacao';

let estadoSinalizacao: EstadoSinalizacao = { fase: 'conectando' };
let estadoSessao: EstadoSessao = { fase: 'livre' };

const telaInicio = montarTelaInicio({
  aoConectar: (idRemoto) => controlador.conectar(idRemoto),
});
const telaSessao = montarTelaSessao({
  aoEncerrar: () => controlador.encerrar(),
  aoResponderPedido: (aceito) => controlador.responderPedido(aceito),
});

const telaVisualizacao = montarTelaVisualizacao({
  aoInput: (evento) => controlador.enviarInput(evento),
});
const telaAcesso = montarTelaAcesso(window.api.senha);

function renderizar(): void {
  telaInicio.atualizar(estadoSinalizacao, estadoSessao);
  telaSessao.atualizar(estadoSessao);
  telaAcesso.atualizar(estadoSessao);
  telaVisualizacao.atualizar(estadoSessao);
}

const sinalizacao = new ClienteSinalizacao({
  url: import.meta.env.RENDERER_VITE_SERVIDOR_URL,
  aoMudarEstado: (estado) => {
    estadoSinalizacao = estado;
    if (estado.fase !== 'online') controlador.servidorPerdido();
    renderizar();
  },
  aoMensagem: (mensagem) => controlador.receber(mensagem),
});

const controlador = new ControladorSessao({
  enviar: (mensagem) => sinalizacao.enviar(mensagem),
  aoMudarEstado: (estado) => {
    // Pedido novo: traz a janela para frente e toca o aviso.
    if (estado.fase === 'pedido_recebido' && estadoSessao.fase !== 'pedido_recebido') {
      window.api.chamarAtencao();
      tocarSomPedido();
    }
    // Indicador flutuante: aparece quando alguém passa a controlar este
    // computador e some quando a sessão acaba.
    const controlando = parceiroControlando(estado);
    if (controlando !== parceiroControlando(estadoSessao)) window.api.sessao.indicar(controlando);
    estadoSessao = estado;
    renderizar();
  },
  criarPar: (opcoes) => new ConexaoPar(opcoes),
  aoMudarVideo: (video) => telaVisualizacao.definirVideo(video),
  // Anfitrião: só o main executa input; o renderer apenas repassa.
  aoReceberInput: (evento) => window.api.input.executar(evento),
  aoLiberarInput: () => window.api.input.liberar(),
});

// Encerrar pelo botão do indicador flutuante.
window.api.sessao.aoPedirEncerramento(() => controlador.encerrar());

sinalizacao.iniciar();

const rodape = document.querySelector('#rodape');
if (rodape) {
  rodape.textContent = `Protocolo v${PROTOCOL_VERSION} · Electron ${window.api.versoes.electron}`;
}
