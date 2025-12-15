export interface AugOSAPI {
  ping(): Promise<string>;
  askAgent(prompt: string): Promise<{ streaming: boolean }>;
  onToken(callback: (token: string) => void): void;
  onStreamEnd(callback: () => void): void;
  removeTokenListener(): void;
  removeStreamEndListener(): void;
}

declare global {
  interface Window {
    augos?: AugOSAPI;
  }
}
