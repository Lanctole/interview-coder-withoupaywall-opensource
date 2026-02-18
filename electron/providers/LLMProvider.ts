// electron/providers/LLMProvider.ts

/**
 * Описание модели, которую предоставляет провайдер
 */
export interface LLMModel {
  /** Уникальный идентификатор модели (например, 'openai/gpt-4o') */
  id: string;
  /** Человеко-читаемое название (например, 'GPT-4o') */
  name: string;
  /** Имя провайдера (например, 'openai', 'openrouter') */
  provider: string;
  /** Поддерживает ли модель Vision (анализ изображений) */
  supportsVision: boolean;
  /** Максимальное количество токенов (опционально) */
  maxTokens?: number;
}

/**
 * Конфигурация для запроса к провайдеру
 */
export interface ProviderConfig {
  /** API ключ */
  apiKey: string;
  /** ID выбранной модели */
  modelId: string;
  /** Температура (опционально) */
  temperature?: number;
  /** Максимальное количество токенов в ответе (опционально) */
  maxTokens?: number;
}

/**
 * Единый интерфейс для всех LLM-провайдеров
 */
export interface LLMProvider {
  /** Уникальное имя провайдера (например, 'openai') */
  readonly name: string;

  /**
   * Возвращает список доступных моделей от этого провайдера.
   * Может быть асинхронным, если модели загружаются через API.
   */
  getAvailableModels(): Promise<LLMModel[]> | LLMModel[];

  /**
   * Отправляет текстовый чат-запрос и возвращает ответ.
   * Используется для генерации решений, дебага и т.д.
   */
  chat(messages: any[], config: ProviderConfig): Promise<string>;

  /**
   * Отправляет запрос с изображениями (скриншотами) и возвращает ответ.
   * Используется для извлечения задачи из скриншотов.
   */
  processVision(screenshots: string[], prompt: string, config: ProviderConfig): Promise<string>;
}