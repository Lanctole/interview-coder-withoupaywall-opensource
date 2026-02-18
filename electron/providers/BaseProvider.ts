// electron/providers/BaseProvider.ts

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModels: {
    extraction: string;
    solution: string;
    debugging: string;
  };
}

export interface ProviderInfo {
  name: string;           // Отображаемое имя (например, "Ollama")
  color: string;          // Цвет для UI (indigo, green, blue...)
  isFree: boolean;        // Бесплатный ли?
  instructions: {
    signup: string;       // Ссылка на регистрацию
    apiKeys: string | null; // Ссылка на получение ключа (null если не требуется)
    description: string;  // Описание для UI
  };
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{type: string; text?: string; image_url?: {url: string}}>;
}

/**
 * Структура информации о модели, которую ожидает UI
 */
export interface ModelInfo {
  id: string;                // Уникальный идентификатор модели (для API)
  name: string;              // Человеко-читаемое название
  supportsVision: boolean;   // Поддерживает ли анализ изображений
  contextLength?: number;    // Максимальная длина контекста (опционально)
  description?: string;      // Краткое описание (опционально)
}

export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected modelsCache: ModelInfo[] | null = null; // Кеш теперь хранит объекты
  protected lastModelsFetch: number = 0;
  protected cacheTtl: number = 5 * 60 * 1000; // 5 минут
  
  constructor(config: ProviderConfig) {
    this.config = config;
  }

  abstract getProviderInfo(): ProviderInfo;

  // Возвращает список доступных моделей с деталями
  abstract getAvailableModels(): Promise<ModelInfo[]>;

  /**
   * Вспомогательный метод для кеширования результата getAvailableModels
   * @param fetchFn функция, которая загружает ModelInfo[] (например, запрос к API)
   */
  protected async fetchModelsWithCache(fetchFn: () => Promise<ModelInfo[]>): Promise<ModelInfo[]> {
    const now = Date.now();
    if (this.modelsCache && (now - this.lastModelsFetch) < this.cacheTtl) {
      return this.modelsCache;
    }
    const models = await fetchFn();
    this.modelsCache = models;
    this.lastModelsFetch = now;
    return models;
  }

  // Абстрактные методы, которые должны реализовать все провайдеры
  abstract getName(): string;
  abstract supportsVision(): boolean; // Возможно, этот метод станет не нужен, т.к. информация есть в каждой модели
  
  // Основной метод для отправки сообщений
  abstract chat(messages: Message[], model: string, options?: {
    temperature?: number;
    maxTokens?: number;
  }): Promise<{
    content: string;
    usage?: {prompt_tokens: number; completion_tokens: number};
  }>;

  // Валидация API ключа
  abstract validateApiKey(): Promise<boolean>;

  // Утилитарные методы
  public formatImageForProvider(base64Image: string): any {
    return {
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${base64Image}`
      }
    };
  }
}