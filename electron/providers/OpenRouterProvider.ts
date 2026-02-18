// electron/providers/OpenRouterProvider.ts
import { BaseProvider, ProviderConfig, Message, ModelInfo, ProviderInfo } from './BaseProvider';
import OpenAI from 'openai';

interface OpenRouterModel {
 id: string;
  name: string;
  context_length: number;
  architecture: { modality: string };
  pricing?: {
    prompt: string;
    completion: string;
  };
  description?: string;// например, "text+image"
}


const ALLOWED_MODEL_IDS = new Set([
  'google/gemma-3-27b-it:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'google/gemma-3-4b-it:free',
  'google/gemma-3-12b-it:free',
  'openrouter/free'
]);

export class OpenRouterProvider extends BaseProvider {
  private client: OpenAI;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/Lanctole/interview-coder',
        'X-Title': 'Interview Coder'
      }
    });
  }

  getName(): string {
    return 'OpenRouter';
  }

 async getAvailableModels(): Promise<ModelInfo[]> {
    return this.fetchModelsWithCache(async () => {
      const response = await fetch(`${this.baseUrl}/models`);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const data = await response.json();
      
      // Фильтруем только те модели, которые есть в ALLOWED_MODEL_IDS
      const allowedModels = data.data.filter((model: OpenRouterModel) =>
        ALLOWED_MODEL_IDS.has(model.id)
      );

      return allowedModels.map((model: OpenRouterModel) => {
        // Определяем поддержку vision более тщательно
        const supportsVision =
          model.architecture?.modality === 'text+image' ||
          model.id.includes('vision') ||
          model.id.includes('vl') ||          // для моделей с VL (vision-language)
          model.id.includes('claude-3') ||
          model.id.includes('gpt-4');

        return {
          id: model.id,
          name: model.name || model.id,
          supportsVision,
          contextLength: model.context_length,
          description: model.description
        };
      });
    });
  }

  supportsVision(): boolean {
    return true; // OpenRouter поддерживает много vision-моделей
  }

  // Опционально: метод для проверки конкретной модели (можно оставить)
  async supportsModelVision(modelId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      const data = await response.json();
      const model = data.data.find((m: OpenRouterModel) => m.id === modelId);
      return model?.architecture?.modality === 'text+image' || false;
    } catch {
      return modelId.includes('vision') || modelId.includes('claude-3') || modelId.includes('gpt-4');
    }
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await this.client.models.list();
      return response.data.length > 0;
    } catch {
      return false;
    }
  }

  async chat(messages: Message[], model: string, options?: {
    temperature?: number;
    maxTokens?: number;
  }): Promise<any> {
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await this.client.chat.completions.create({
      model: model,
      messages: formattedMessages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      usage: response.usage ? {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens
      } : undefined
    };
  }
  getProviderInfo(): ProviderInfo {
    return {
      name: "OpenRouter",
      color: "purple", // выберите подходящий цвет
      isFree: false,
      instructions: {
        signup: "https://openrouter.ai/signup",
        apiKeys: "https://openrouter.ai/keys",
        description: "Unified API for many models. Paid service, but offers free trial."
      }
    };
  }
}