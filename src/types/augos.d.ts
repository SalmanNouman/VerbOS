export interface AugOSAPI {
  ping(): Promise<string>;
  askAgent(prompt: string): Promise<string>;
}

declare global {
  interface Window {
    augos?: AugOSAPI;
  }
}
