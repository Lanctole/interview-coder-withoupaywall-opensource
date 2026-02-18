import { BaseProvider, ProviderConfig, Message, ModelInfo, ProviderInfo } from './BaseProvider';

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: { 
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export class OllamaProvider extends BaseProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  getName(): string {
    return 'Ollama';
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    return this.fetchModelsWithCache(async () => {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const data = await response.json();
      return data.models.map((model: OllamaModel) => {
        const name = model.name;
        const supportsVision = name.includes('vision') || 
                               name.includes('llava') || 
                               name.includes('bakllava') || 
                               name.includes('vl');
        return {
          id: name,
          name: name,
          supportsVision,
          description: `Ollama model, size: ${(model.size / 1e9).toFixed(1)} GB`
        };
      });
    });
  }

  async supportsModelVision(modelId: string): Promise<boolean> {
    return modelId.includes('vision') || modelId.includes('llava') || modelId.includes('bakllava');
  }

  supportsVision(): boolean {
    return true;
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: Message[], model: string, options?: {
    temperature?: number;
    maxTokens?: number;
  }): Promise<any> {
    const ollamaMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' 
        ? msg.content 
        : JSON.stringify(msg.content)
    }));

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens ?? 4096
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      content: data.message?.content || '',
      usage: undefined
    };
  }

  public formatImageForProvider(base64Image: string): any {
    return {
      type: "image",
      image: base64Image
    };
  }

   getProviderInfo(): ProviderInfo {
    return {
      name: "Ollama",
      color: "indigo",
      isFree: true,
      instructions: {
        signup: "https://ollama.com",
        apiKeys: null,
        description: "FREE & LOCAL - Run models locally. No API key needed, but requires Ollama installation"
      }
    };
  }
}