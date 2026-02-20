export type ProviderType = 'openai' | 'ollama' | 'openrouter' | 'groq' | 'gemini' | 'anthropic';

export interface AppConfig {
  apiKey?: string;
  apiProvider?: ProviderType;
  extractionModel?: string;
  solutionModel?: string;
  debuggingModel?: string;
  ollamaBaseUrl?: string;
  language?: string;
  opacity?: number;
  baseUrl?: string;
}

export interface ExtractedContent {
  type: 'coding_task' | 'code_review' | 'sql_task' | 'multithreading_task' | 'mixed';
  
  // Для задач программирования
  codingTask?: {
    originalCode?: string;
    description: string;
    language?: string;
    requirements: string[];
    examples?: string[];
  };
  
  // Для code review
  codeReview?: {
    originalCode: string;
    language: string;
    context?: string;
  };
  
  // Для SQL задач
  sqlTask?: {
    description: string;
    schema?: string;
    query?: string;
  };
  
  // Если несколько задач
  multipleTasks?: ExtractedContent[];
  
  // Оригинальный текст
  rawText: string;
}

// Упрощенная версия для быстрой обработки
export interface SimpleExtraction {
  type: string;
  description: string;
  hasCode: boolean;
  code?: string;
}