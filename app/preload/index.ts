// Preload: ponte entre o main e o renderer. Roda em sandbox e expõe
// ao renderer apenas o objeto abaixo, via contextBridge. O ipcRenderer
// nunca é exposto inteiro: cada função usa um canal fixo, e o main valida
// qualquer dado que o renderer mande junto.
import { contextBridge, ipcRenderer } from 'electron';
import {
  CANAL_CHAMAR_ATENCAO,
  CANAL_EXECUTAR_INPUT,
  CANAL_INDICAR_SESSAO,
  CANAL_LIBERAR_INPUT,
  CANAL_PEDIDO_ENCERRAR,
  type ApiDoPreload,
} from './api';

const api: ApiDoPreload = {
  versoes: {
    electron: process.versions.electron ?? '?',
    chrome: process.versions.chrome ?? '?',
    node: process.versions.node,
  },
  chamarAtencao: () => ipcRenderer.send(CANAL_CHAMAR_ATENCAO),
  input: {
    executar: (evento) => ipcRenderer.send(CANAL_EXECUTAR_INPUT, evento),
    liberar: () => ipcRenderer.send(CANAL_LIBERAR_INPUT),
  },
  sessao: {
    indicar: (parceiro) => ipcRenderer.send(CANAL_INDICAR_SESSAO, parceiro),
    // O evento do IPC não é repassado: daria ao renderer acesso ao ipcRenderer.
    aoPedirEncerramento: (tratar) => {
      ipcRenderer.on(CANAL_PEDIDO_ENCERRAR, () => tratar());
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
