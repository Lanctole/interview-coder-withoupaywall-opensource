// src/config/modelConfig.ts
export const ModelConfig = {
  openai: {
    name: 'OpenAI',
    requiresApiKey: true,
    baseUrl: 'https://api.openai.com/v1',
    models: {
      extraction: ['gpt-4o', 'gpt-4o-mini'],
      solution: ['gpt-4o', 'gpt-4o-mini', 'o1-preview'],
      debugging: ['gpt-4o', 'gpt-4o-mini']
    }
  },
  anthropic: {
    name: 'Anthropic',
    requiresApiKey: true,
    baseUrl: 'https://api.anthropic.com',
    models: {
      extraction: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
      solution: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
      debugging: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229']
    }
  },
  openrouter: {
    name: 'OpenRouter',
    requiresApiKey: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    models: {
      extraction: [
        'anthropic/claude-3.5-sonnet',
        'openai/gpt-4o',
        'google/gemini-pro-1.5'
      ],
      solution: [
        'anthropic/claude-3.5-sonnet',
        'anthropic/claude-3-opus',
        'openai/gpt-4o',
        'deepseek/deepseek-coder',
        'meta-llama/llama-3.1-70b-instruct'
      ],
      debugging: [
        'anthropic/claude-3.5-sonnet',
        'openai/gpt-4o'
      ]
    }
  },
  // ... другие провайдеры
} as const;

export type ProviderConfigType = typeof ModelConfig;
export type ProviderKey = keyof ProviderConfigType;