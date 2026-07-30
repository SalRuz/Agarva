/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute WS URL baked at build time, e.g. wss://game.example.com/ws */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
