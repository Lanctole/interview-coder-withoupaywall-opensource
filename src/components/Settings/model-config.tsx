// model-config.ts
import type { APIProvider, AIModel, ModelCategory, ProviderConfig } from "./types";

export const modelConfig: Record<ModelCategory['key'], ModelCategory> = {
  extraction: {
    key: 'extraction',
    title: 'Problem Extraction',
    description: 'Model used to analyze screenshots and extract problem details',
    providers: {
      ollama: [
        { id: "qwen3-vl:4b", name: "Qwen3-VL 4B ⭐", description: "Best vision model for screenshot analysis (requires 16GB+ VRAM)" },
        { id: "llava:latest", name: "LLaVA", description: "Lightweight vision model for basic screenshot analysis" },
        { id: "bakllava:latest", name: "BakLLaVA", description: "Improved LLaVA with better accuracy" }
      ],
      openai: [
        { id: "gpt-4o", name: "gpt-4o", description: "Best overall performance for problem extraction" },
        { id: "gpt-4o-mini", name: "gpt-4o-mini", description: "Faster, more cost-effective option" }
      ],
      gemini: [
        { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "Best overall performance for problem extraction" },
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", description: "Faster, more cost-effective option" }
      ],
      anthropic: [
        { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", description: "Best overall performance for problem extraction" },
        { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", description: "Balanced performance and speed" },
        { id: "claude-3-opus-20240229", name: "Claude 3 Opus", description: "Top-level intelligence, fluency, and understanding" }
      ],
      groq: [
        { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B ⭐", description: "Vision model for OCR, replaces Llama 3.2 (free)" }
      ]
    }
  },
  solution: {
    key: 'solution',
    title: 'Solution Generation',
    description: 'Model used to generate coding solutions',
    providers: {
      ollama: [
        { id: "qwen3-coder:30b-a3b-q4_K_M", name: "Qwen3-Coder 30B A3B Q4_K_M ⭐", description: "Fast generation, excellent for coding tasks" },
        { id: "deepseek-coder:latest", name: "DeepSeek Coder", description: "Excellent for programming tasks" },
        { id: "llama3.2:latest", name: "Llama 3.2", description: "Good general purpose model for coding" },
        { id: "qwen3-coder:480b-cloud", name: "Qwen3-Coder 480B Cloud", description: "Powerful coding model with 480B parameters (requires 32GB+ VRAM)" }
      ],
      openai: [
        { id: "gpt-4o", name: "gpt-4o", description: "Strong overall performance for coding tasks" },
        { id: "gpt-4o-mini", name: "gpt-4o-mini", description: "Faster, more cost-effective option" }
      ],
      gemini: [
        { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "Strong overall performance for coding tasks" },
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", description: "Faster, more cost-effective option" }
      ],
      anthropic: [
        { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", description: "Strong overall performance for coding tasks" },
        { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", description: "Balanced performance and speed" },
        { id: "claude-3-opus-20240229", name: "Claude 3 Opus", description: "Top-level intelligence, fluency, and understanding" }
      ],
      groq: [
        { id: "meta-llama/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick 17B ⭐ RECOMMENDED", description: "Best for coding! 128 experts, understands Stream API, patterns (free)" },
        { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", description: "Large 120B param model by GroqLabs (free)" },
        { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", description: "General purpose, fast generation (free)" }
      ]
    }
  },
  debugging: {
    key: 'debugging',
    title: 'Debugging',
    description: 'Model used to debug and improve solutions',
    providers: {
      ollama: [
        { id: "qwen3-vl:4b", name: "Qwen3-VL 4B", description: "Can analyze error screenshots and code" },
        { id: "llama3.2:latest", name: "Llama 3.2", description: "Good for logical debugging tasks" }
      ],
      openai: [
        { id: "gpt-4o", name: "gpt-4o", description: "Best for analyzing code and error messages" },
        { id: "gpt-4o-mini", name: "gpt-4o-mini", description: "Faster, more cost-effective option" }
      ],
      gemini: [
        { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "Best for analyzing code and error messages" },
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", description: "Faster, more cost-effective option" }
      ],
      anthropic: [
        { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", description: "Best for analyzing code and error messages" },
        { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", description: "Balanced performance and speed" },
        { id: "claude-3-opus-20240229", name: "Claude 3 Opus", description: "Top-level intelligence, fluency, and understanding" }
      ],
      groq: [
        { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B ⭐", description: "Vision model for analyzing error screenshots (free)" }
      ]
    }
  }
};

export const providerConfigs: Record<APIProvider, ProviderConfig> = {
  ollama: {
    name: "Ollama",
    color: "indigo",
    isFree: true,
    instructions: {
      signup: "https://ollama.com",
      apiKeys: null,
      description: "FREE & LOCAL - Run models locally. No API key needed, but requires Ollama installation"
    }
  },
  groq: {
    name: "Groq",
    color: "green",
    isFree: true,
    instructions: {
      signup: "https://console.groq.com",
      apiKeys: "https://console.groq.com/keys",
      description: "FREE FOREVER - No credit card required! Limits: 30 requests/min, 14,400 requests/day"
    }
  },
  openai: {
    name: "OpenAI",
    color: "blue",
    isFree: false,
    instructions: {
      signup: "https://platform.openai.com/signup",
      apiKeys: "https://platform.openai.com/api-keys",
      description: "Paid service - requires billing setup"
    }
  },
  gemini: {
    name: "Gemini",
    color: "purple",
    isFree: false,
    instructions: {
      signup: "https://aistudio.google.com/",
      apiKeys: "https://aistudio.google.com/app/apikey",
      description: "Paid service - requires billing setup"
    }
  },
  anthropic: {
    name: "Claude",
    color: "orange",
    isFree: false,
    instructions: {
      signup: "https://console.anthropic.com/signup",
      apiKeys: "https://console.anthropic.com/settings/keys",
      description: "Paid service - requires billing setup"
    }
  }
};

export function getDefaultModel(provider: APIProvider, category: ModelCategory['key']): string {
  const models = modelConfig[category]?.providers[provider];
  return models?.[0]?.id || "";
}

export function addModel(
  provider: APIProvider, 
  category: ModelCategory['key'], 
  model: AIModel
): void {
  if (modelConfig[category]?.providers[provider]) {
    modelConfig[category].providers[provider].push(model);
  }
}