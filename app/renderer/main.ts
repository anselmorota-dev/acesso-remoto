// Ponto de entrada da interface: liga o servidor de sinalização, o
// controlador de sessão e as telas. Cada parte avisa quando seu estado muda
// e as telas são redesenhadas a partir dos dois estados.
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { ConexaoPar } from './par';
import { ControladorSessao, type EstadoSessao } from './sessao';
import { ClienteSinalizacao, type EstadoSinalizacao } from './sinalizacao';
import { montarTelaInicio } from './telas/inicio';
import { montarTelaSessao } from './telas/sessao';

let estadoSinalizacao: EstadoSinalizacao = { fase: 'conectando' };
let estadoSessao: EstadoSessao = { fase: 'livre' };

const telaInicio = montarTelaInicio({
  aoConectar: (idRemoto) => controlador.conectar(idRemoto),
});
const telaSessao = montarTelaSessao({
  aoEncerrar: () => controlador.encerrar(),
  aoResponderPedido: (aceito) => controlador.responderPedido(aceito),
});

function renderizar(): void {
  telaInicio.atualizar(estadoSinalizacao, estadoSessao);
  telaSessao.atualizar(estadoSessao);
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
    estadoSessao = estado;
    renderizar();
  },
  criarPar: (opcoes) => new ConexaoPar(opcoes),
});

sinalizacao.iniciar();

const rodape = document.querySelector('#rodape');
if (rodape) {
  rodape.textContent = `Protocolo v${PROTOCOL_VERSION} · Electron ${window.api.versoes.electron}`;
}
