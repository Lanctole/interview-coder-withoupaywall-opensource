// electron/providers/OpenAIProvider.ts

import OpenAI from 'openai';
import { LLMProvider, LLMModel, ProviderConfig } from './LLMProvider';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  // Статический список моделей OpenAI (можно расширить)
  private readonly models: LLMModel[] = [
    { id: 'gpt-4o', name: 'GPT-4o', provider: this.name, supportsVision: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: this.name, supportsVision: true },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: this.name, supportsVision: true },
    { id: 'gpt-4', name: 'GPT-4', provider: this.name, supportsVision: false },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: this.name, supportsVision: false },
  ];

  getAvailableModels(): LLMModel[] {
    return this.models;
  }

  async processVision(screenshots: string[], prompt: string, config: ProviderConfig): Promise<string> {
    const openai = new OpenAI({ apiKey: config.apiKey, dangerouslyAllowBrowser: true });

    const content: any[] = [{ type: 'text', text: prompt }];
    for (const base64Image of screenshots) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64Image}` },
      });
    }

    try {
      const response = await openai.chat.completions.create({
        model: config.modelId,
        messages: [{ role: 'user', content }],
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature ?? 0.7,
      });
      return response.choices[0]?.message?.content || '⚠️ Пустой ответ от OpenAI.';
    } catch (error: any) {
      console.error('OpenAI Vision Error:', error);
      throw new Error(`OpenAI request failed: ${error.message}`);
    }
  }

  async chat(messages: any[], config: ProviderConfig): Promise<string> {
    const openai = new OpenAI({ apiKey: config.apiKey, dangerouslyAllowBrowser: true });

    try {
      const response = await openai.chat.completions.create({
        model: config.modelId,
        messages,
        max_tokens: config.maxTokens || 2048,
        temperature: config.temperature ?? 0.7,
      });
      return response.choices[0]?.message?.content || '';
    } catch (error: any) {
      console.error('OpenAI Chat Error:', error);
      throw new Error(`OpenAI chat failed: ${error.message}`);
    }
  }
}