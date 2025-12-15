export interface AugOSAPI {
  ping(): Promise<string>;
}

declare global {
  interface Window {
    augos?: AugOSAPI;
  }
}
