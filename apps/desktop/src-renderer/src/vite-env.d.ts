/// <reference types="vite/client" />

import type { StsApi } from "../../../src-preload";

declare global {
  interface Window {
    sts: StsApi;
  }
}
