// Preload: ponte entre o main e o renderer. Roda em sandbox e expõe
// ao renderer apenas o objeto abaixo, via contextBridge. O ipcRenderer
// nunca é exposto inteiro: cada função usa um canal fixo, e o main valida
// qualquer dado que o renderer mande junto.
import { contextBridge, ipcRenderer } from 'electron';
import { CANAL_CHAMAR_ATENCAO, CANAL_EXECUTAR_INPUT, CANAL_LIBERAR_INPUT, type ApiDoPreload } from './api';

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
};

contextBridge.exposeInMainWorld('api', api);
