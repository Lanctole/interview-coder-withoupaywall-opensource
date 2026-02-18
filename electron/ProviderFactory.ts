// ProviderFactory.ts
import { BaseProvider, ProviderConfig, ProviderInfo, ModelInfo } from './providers/BaseProvider';
// import { OpenAIProvider } from './providers/OpenAIProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { OpenRouterProvider } from './providers/OpenRouterProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import type { ProviderType } from "../shared/types";
// export type ProviderType = 
//   | 'openai' 
//   | 'ollama' 
//   | 'openrouter';

export class ProviderFactory {
  // Явно указываем тип значений как конструктор, принимающий ProviderConfig и возвращающий BaseProvider
  private static providers: Map<ProviderType, new (config: ProviderConfig) => BaseProvider> = new Map([
    // ['openai', OpenAIProvider as new (config: ProviderConfig) => BaseProvider],
    ['ollama', OllamaProvider as new (config: ProviderConfig) => BaseProvider],
    ['openrouter', OpenRouterProvider as new (config: ProviderConfig) => BaseProvider],
    ['gemini', GeminiProvider],
  ]);

  static createProvider(type: ProviderType, config: ProviderConfig): BaseProvider {
    const ProviderClass = this.providers.get(type);
    if (!ProviderClass) {
      throw new Error(`Unknown provider type: ${type}`);
    }
    return new ProviderClass(config);
  }

  static registerProvider(
    type: ProviderType, 
    providerClass: new (config: ProviderConfig) => BaseProvider
  ): void {
    this.providers.set(type, providerClass);
  }

  static getAvailableProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  static async getAllProvidersWithDetails(): Promise<Array<{
    type: ProviderType;
    info: ProviderInfo;
    models: ModelInfo[];
  }>> {
    const result = [];
    for (const [type, ProviderClass] of this.providers.entries()) {
      // Создаём временный экземпляр без API ключа (для получения метаданных)
      // Можно передать пустой config, но если провайдер требует ключ для getAvailableModels,
      // то этот вызов может упасть. Лучше предусмотреть, что getAvailableModels может работать и без ключа,
      // либо передавать заглушку.
      const dummyConfig: ProviderConfig = {
        apiKey: '',
        defaultModels: { extraction: '', solution: '', debugging: '' }
      };
      const instance = new ProviderClass(dummyConfig);
      const info = instance.getProviderInfo();
      let models: ModelInfo[] = [];
      try {
        models = await instance.getAvailableModels();
      } catch (e) {
        console.warn(`Failed to load models for ${type}:`, e);
        models = []; // можно вернуть пустой массив или статический fallback
      }
      result.push({ type, info, models });
    }
    return result;
  }
}
export { ProviderType };