// electron/providers/GeminiProvider.ts
import { BaseProvider, ProviderConfig, Message, ModelInfo, ProviderInfo } from './BaseProvider';

// Интерфейсы для ответа Gemini
interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
    finishReason?: string;
  }>;
  error?: { message: string };
}

export class GeminiProvider extends BaseProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'Gemini',
      color: 'purple',
      isFree: false,
      instructions: {
        signup: 'https://aistudio.google.com/',
        apiKeys: 'https://aistudio.google.com/app/apikey',
        description: 'Paid service - requires billing setup. Offers powerful multimodal models.'
      }
    };
  }

  getName(): string {
    return 'Gemini';
  }

  supportsVision(): boolean {
    return true; // Есть модели с поддержкой vision
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    return this.fetchModelsWithCache(async () => {
      // Попробуем получить актуальный список моделей через API, если есть ключ
      if (this.config.apiKey) {
        try {
          const url = `${this.baseUrl}/models?key=${this.config.apiKey}`;
          const response = await fetch(url);
          if (response.ok) {
            const data = await response.json();
            // Фильтруем только генеративные модели (поддерживающие generateContent)
            const models = data.models
              .filter((m: any) => 
                m.supportedGenerationMethods?.includes('generateContent')
              )
              .map((m: any) => ({
                id: m.name.replace('models/', ''), // убираем префикс 'models/'
                name: m.displayName || m.name,
                supportsVision: m.description?.toLowerCase().includes('vision') || 
                                m.name.toLowerCase().includes('vision') ||
                                m.supportedGenerationMethods?.includes('generateContent') && 
                                m.inputTokenLimit > 100000, // эвристика
                contextLength: m.inputTokenLimit,
                description: m.description
              }));
            if (models.length > 0) return models;
          }
        } catch (e) {
          console.warn('Failed to fetch Gemini models via API, using static list', e);
        }
      }

      // Статический список моделей (fallback)
      return [
        {
          id: 'gemini-2.5-flash',
          name: 'Gemini 2.5 Flash',
          supportsVision: true,
          contextLength: 1_000_000,
          description: 'Experimental multimodal model with vision support'
        },
        {
          id: 'gemini-2.0-flash',
          name: 'Gemini 2.0 Flash',
          supportsVision: true,
          contextLength: 1_000_000,
          description: 'Fast, efficient multimodal model'
        },
        {
          id: 'gemini-1.5-pro',
          name: 'Gemini 1.5 Pro',
          supportsVision: true,
          contextLength: 2_000_000,
          description: 'Largest and most capable multimodal model'
        },
        {
          id: 'gemini-1.5-flash',
          name: 'Gemini 1.5 Flash',
          supportsVision: true,
          contextLength: 1_000_000,
          description: 'Balanced speed and capabilities'
        },
        {
          id: 'gemini-1.0-pro',
          name: 'Gemini 1.0 Pro',
          supportsVision: false,
          contextLength: 30_000,
          description: 'Legacy text-only model'
        }
      ];
    });
  }

  async validateApiKey(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const url = `${this.baseUrl}/models?key=${this.config.apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async chat(
    messages: Message[],
    model: string,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
  ): Promise<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number } }> {
    if (!this.config.apiKey) {
      throw new Error('Gemini API key is required');
    }

    // Преобразуем наши сообщения в формат Gemini
    const contents: GeminiContent[] = [];
    let systemInstruction = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini не поддерживает system напрямую, добавим как первый пользовательский с префиксом
        systemInstruction = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        continue;
      }

      const role = msg.role === 'user' ? 'user' : 'model';
      const parts: GeminiPart[] = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url' && part.image_url?.url) {
            // Ожидаем data URL: data:image/png;base64,...
            const matches = part.image_url.url.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
            if (matches) {
              parts.push({
                inlineData: {
                  mimeType: `image/${matches[1]}`,
                  data: matches[2]
                }
              });
            }
          }
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    // Если есть system instruction, добавляем её в начало первого пользовательского сообщения
    if (systemInstruction && contents.length > 0 && contents[0].role === 'user') {
      const firstParts = contents[0].parts;
      if (firstParts[0]?.text) {
        firstParts[0].text = `${systemInstruction}\n\n${firstParts[0].text}`;
      } else {
        firstParts.unshift({ text: systemInstruction });
      }
    }

    const requestBody: GeminiRequest = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 4096
      }
    };

    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.config.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options?.signal
    });

    if (!response.ok) {
      const errorData = await response.json() as GeminiResponse;
      throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json() as GeminiResponse;
    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.[0]?.text) {
      throw new Error('Empty response from Gemini API');
    }

    return {
      content: candidate.content.parts[0].text,
      usage: undefined // Gemini не возвращает токены в этом API
    };
  }

  // Переопределяем формат для изображений, так как Gemini использует inlineData
  public formatImageForProvider(base64Image: string): any {
    return {
      type: 'image_url',
      image_url: {
        url: `data:image/png;base64,${base64Image}`
      }
    };
  }
}