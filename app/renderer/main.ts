// Ponto de entrada da interface: conecta no servidor de sinalização e
// liga o estado dessa conexão à tela inicial.
import { PROTOCOL_VERSION } from '@acesso-remoto/shared';
import { formatarId } from './id';
import { ClienteSinalizacao } from './sinalizacao';
import { montarTelaInicio } from './telas/inicio';

const tela = montarTelaInicio({
  aoConectar(idRemoto) {
    // O pedido de conexão ao outro computador chega na etapa 1.4.
    console.log(`[app] pedido de conexão para ${idRemoto} (ainda não implementado)`);
    const aviso = document.querySelector('#aviso-conectar');
    if (aviso) aviso.textContent = `Conexão com ${formatarId(idRemoto)}: disponível na próxima etapa.`;
  },
});

const sinalizacao = new ClienteSinalizacao({
  url: import.meta.env.RENDERER_VITE_SERVIDOR_URL,
  aoMudarEstado: (estado) => tela.atualizar(estado),
});
sinalizacao.iniciar();

const rodape = document.querySelector('#rodape');
if (rodape) {
  rodape.textContent = `Protocolo v${PROTOCOL_VERSION} · Electron ${window.api.versoes.electron}`;
}
