// types.ts
export type APIProvider = "openai" | "gemini" | "anthropic" | "groq" | "ollama";

export interface AIModel {
  id: string;
  name: string;
  description: string;
}

export interface ModelCategory {
  key: 'extraction' | 'solution' | 'debugging';
  title: string;
  description: string;
  providers: Record<APIProvider, AIModel[]>;
}

export interface ProviderConfig {
  name: string;
  color: string;
  isFree: boolean;
  instructions: {
    signup: string;
    apiKeys: string | null;
    description: string;
  };
}

export interface AppConfig {
  apiKey?: string;
  apiProvider?: APIProvider;
  extractionModel?: string;
  solutionModel?: string;
  debuggingModel?: string;
  ollamaBaseUrl?: string;
}