/// <reference types="vite/client" />
import type { ApiDoPreload } from '../preload/api';

declare global {
  interface Window {
    /** Objeto exposto pelo preload via contextBridge. */
    readonly api: ApiDoPreload;
  }

  /** Variáveis do app/.env visíveis no renderer. */
  interface ImportMetaEnv {
    readonly RENDERER_VITE_SERVIDOR_URL: string;
  }
}
