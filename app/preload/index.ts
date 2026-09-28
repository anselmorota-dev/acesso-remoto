// Preload: ponte entre o main e o renderer. Roda em sandbox e expõe
// ao renderer apenas o objeto abaixo, via contextBridge. O ipcRenderer
// nunca é exposto inteiro: cada função usa um canal fixo e sem argumentos
// vindos do renderer.
import { contextBridge, ipcRenderer } from 'electron';
import { CANAL_CHAMAR_ATENCAO, type ApiDoPreload } from './api';

const api: ApiDoPreload = {
  versoes: {
    electron: process.versions.electron ?? '?',
    chrome: process.versions.chrome ?? '?',
    node: process.versions.node,
  },
  chamarAtencao: () => ipcRenderer.send(CANAL_CHAMAR_ATENCAO),
};

contextBridge.exposeInMainWorld('api', api);
