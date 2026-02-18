export type ProviderType = 'openai' | 'ollama' | 'openrouter' | 'groq' | 'gemini' | 'anthropic';

export interface AppConfig {
  apiKey?: string;
  apiProvider?: ProviderType;
  extractionModel?: string;
  solutionModel?: string;
  debuggingModel?: string;
  ollamaBaseUrl?: string;
  baseUrl?: string;
}