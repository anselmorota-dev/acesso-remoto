// Preload: ponte entre o main e o renderer. Roda em sandbox e expõe
// ao renderer apenas o objeto abaixo, via contextBridge. O ipcRenderer
// nunca é exposto inteiro: cada função usa um canal fixo, e o main valida
// qualquer dado que o renderer mande junto.
import { contextBridge, ipcRenderer } from 'electron';
import {
  CANAL_BANDEJA_ESTADO,
  CANAL_CHAMAR_ATENCAO,
  CANAL_INICIO_AUTOMATICO_DEFINIR,
  CANAL_INICIO_AUTOMATICO_LER,
  CANAL_INICIO_AUTOMATICO_MUDOU,
  CANAL_EXECUTAR_INPUT,
  CANAL_IDENTIDADE_ASSINAR,
  CANAL_IDENTIDADE_CHAVE,
  CANAL_INDICAR_SESSAO,
  CANAL_LIBERAR_INPUT,
  CANAL_PEDIDO_ENCERRAR,
  CANAL_SENHA_DEFINIR,
  CANAL_SENHA_ESTADO,
  CANAL_SENHA_REMOVER,
  CANAL_SENHA_TENTAR,
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
  bandeja: {
    atualizar: (estado) => ipcRenderer.send(CANAL_BANDEJA_ESTADO, estado),
  },
  inicioAutomatico: {
    ligado: () => ipcRenderer.invoke(CANAL_INICIO_AUTOMATICO_LER),
    definir: (ligar) => ipcRenderer.invoke(CANAL_INICIO_AUTOMATICO_DEFINIR, ligar),
    // Só o valor (boolean) chega ao renderer, nunca o evento do IPC.
    aoMudar: (tratar) => {
      ipcRenderer.on(CANAL_INICIO_AUTOMATICO_MUDOU, (_evento, ligado: unknown) => tratar(ligado === true));
    },
  },
  identidade: {
    chavePublica: () => ipcRenderer.invoke(CANAL_IDENTIDADE_CHAVE),
    assinarDesafio: (desafio) => ipcRenderer.invoke(CANAL_IDENTIDADE_ASSINAR, desafio),
  },
  senha: {
    estado: () => ipcRenderer.invoke(CANAL_SENHA_ESTADO),
    definir: (nova, atual) => ipcRenderer.invoke(CANAL_SENHA_DEFINIR, nova, atual),
    remover: (atual) => ipcRenderer.invoke(CANAL_SENHA_REMOVER, atual),
    tentar: (senha) => ipcRenderer.invoke(CANAL_SENHA_TENTAR, senha),
  },
};

contextBridge.exposeInMainWorld('api', api);
