/// <reference types="vite/client" />

// Generated game data, aliased to data/generated/<patch> in vite.config.ts.
declare module '@data/*' {
  const value: any;
  export default value;
}

/** True in the self-contained artifact build (vite.config.ts). */
declare const __ARTIFACT__: boolean;
