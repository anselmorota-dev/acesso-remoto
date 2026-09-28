/// <reference types="vite/client" />
import type { ApiDoPreload } from '../preload/api';

declare global {
  interface Window {
    /** Objeto exposto pelo preload via contextBridge. */
    readonly api: ApiDoPreload;
  }
}
