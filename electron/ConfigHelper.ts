import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { EventEmitter } from "events";
import { OpenAI } from "openai";

interface Config {
  apiKey: string;
  apiProvider: "openai" | "gemini" | "anthropic" | "groq";
  extractionModel: string;
  solutionModel: string;
  debuggingModel: string;
  language: string;
  opacity: number;
}

export class ConfigHelper extends EventEmitter {
  private configPath: string;
  private defaultConfig: Config = {
    apiKey: "",
    apiProvider: "groq",
    extractionModel: "meta-llama/llama-4-scout-17b-16e-instruct", // ✅ Vision для OCR
    solutionModel: "meta-llama/llama-4-maverick-17b-128e-instruct", // ⭐ ИЗМЕНЕНО: Maverick для кода
    debuggingModel: "meta-llama/llama-4-scout-17b-16e-instruct", // ✅ Vision для анализа
    language: "python",
    opacity: 1.0
  };

  constructor() {
    super();
    try {
      this.configPath = path.join(app.getPath('userData'), 'config.json');
      console.log('Config path:', this.configPath);
    } catch (err) {
      console.warn('Could not access user data path, using fallback');
      this.configPath = path.join(process.cwd(), 'config.json');
    }
    this.ensureConfigExists();
  }

  private ensureConfigExists(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.saveConfig(this.defaultConfig);
      }
    } catch (err) {
      console.error("Error ensuring config exists:", err);
    }
  }

  private sanitizeModelSelection(model: string, provider: "openai" | "gemini" | "anthropic" | "groq"): string {
    if (provider === "openai") {
      const allowedModels = ['gpt-4o', 'gpt-4o-mini'];
      if (!allowedModels.includes(model)) {
        console.warn(`Invalid OpenAI model specified: ${model}. Using default model: gpt-4o`);
        return 'gpt-4o';
      }
      return model;
    } else if (provider === "gemini") {
      const allowedModels = ['gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-2.5-flash'];
      if (!allowedModels.includes(model)) {
        console.warn(`Invalid Gemini model specified: ${model}. Using default model: gemini-2.0-flash`);
        return 'gemini-2.0-flash';
      }
      return model;
    } else if (provider === "anthropic") {
      const allowedModels = ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'];
      if (!allowedModels.includes(model)) {
        console.warn(`Invalid Anthropic model specified: ${model}. Using default model: claude-3-7-sonnet-20250219`);
        return 'claude-3-7-sonnet-20250219';
      }
      return model;
    } else if (provider === "groq") {
      // ✅ UPDATED: Актуальные Groq модели (январь 2026)
      const allowedModels = [
        // Vision models (Llama 4 Scout)
        'meta-llama/llama-4-scout-17b-16e-instruct', // ⭐ Vision OCR
        // Coding models (Llama 4 Maverick) - ПРИОРИТЕТ
        'meta-llama/llama-4-maverick-17b-128e-instruct', // ⭐ Best for coding (128 experts)
        // Text generation models
        'llama-3.3-70b-versatile', // ⭐ General purpose
        'llama-3.1-70b-versatile', // Alternative
        'llama-3.1-8b-instant', // Fast & lightweight
        'openai/gpt-oss-120b', // ⭐ Large 120B model
        'openai/gpt-oss-20b', // Smaller variant
        // Other models
        'qwen/qwen3-32b', // General purpose
        'moonshotai/kimi-k2-instruct-0905' // 256K context
      ];

      if (!allowedModels.includes(model)) {
        console.warn(`Invalid Groq model specified: ${model}. Using default model: meta-llama/llama-4-maverick-17b-128e-instruct`);
        return 'meta-llama/llama-4-maverick-17b-128e-instruct'; // ⭐ ИЗМЕНЕНО: Maverick по умолчанию
      }
      return model;
    }
    return model;
  }

  public loadConfig(): Config {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configData);

        // Validate provider
        if (config.apiProvider !== "openai" && config.apiProvider !== "gemini" && 
            config.apiProvider !== "anthropic" && config.apiProvider !== "groq") {
          config.apiProvider = "groq";
        }

        // Sanitize model selections
        if (config.extractionModel) {
          config.extractionModel = this.sanitizeModelSelection(config.extractionModel, config.apiProvider);
        }
        if (config.solutionModel) {
          config.solutionModel = this.sanitizeModelSelection(config.solutionModel, config.apiProvider);
        }
        if (config.debuggingModel) {
          config.debuggingModel = this.sanitizeModelSelection(config.debuggingModel, config.apiProvider);
        }

        return {
          ...this.defaultConfig,
          ...config
        };
      }
      this.saveConfig(this.defaultConfig);
      return this.defaultConfig;
    } catch (err) {
      console.error("Error loading config:", err);
      return this.defaultConfig;
    }
  }

  public saveConfig(config: Config): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error("Error saving config:", err);
    }
  }

  public updateConfig(updates: Partial<Config>): Config {
    try {
      const currentConfig = this.loadConfig();
      let provider = updates.apiProvider || currentConfig.apiProvider;

      // Auto-detect API provider from key format
      if (updates.apiKey && !updates.apiProvider) {
        const key = updates.apiKey.trim();
        if (key.startsWith('sk-ant-')) {
          provider = "anthropic";
          console.log("Auto-detected Anthropic API key format");
        } else if (key.startsWith('sk-')) {
          provider = "openai";
          console.log("Auto-detected OpenAI API key format");
        } else if (key.startsWith('gsk_')) {
          provider = "groq";
          console.log("Auto-detected Groq API key format");
        } else if (key.startsWith('AIza')) {
          provider = "gemini";
          console.log("Auto-detected Gemini API key format");
        } else {
          provider = "groq";
          console.log("Using Groq as default provider");
        }
        updates.apiProvider = provider;
      }

      // Set default models when switching providers
      if (updates.apiProvider && updates.apiProvider !== currentConfig.apiProvider) {
        if (updates.apiProvider === "openai") {
          updates.extractionModel = "gpt-4o";
          updates.solutionModel = "gpt-4o";
          updates.debuggingModel = "gpt-4o";
        } else if (updates.apiProvider === "anthropic") {
          updates.extractionModel = "claude-3-7-sonnet-20250219";
          updates.solutionModel = "claude-3-7-sonnet-20250219";
          updates.debuggingModel = "claude-3-7-sonnet-20250219";
        } else if (updates.apiProvider === "groq") {
          // ⭐ ИЗМЕНЕНО: Maverick для Solution по умолчанию
          updates.extractionModel = "meta-llama/llama-4-scout-17b-16e-instruct";
          updates.solutionModel = "meta-llama/llama-4-maverick-17b-128e-instruct";
          updates.debuggingModel = "meta-llama/llama-4-scout-17b-16e-instruct";
        } else {
          updates.extractionModel = "gemini-2.0-flash";
          updates.solutionModel = "gemini-2.0-flash";
          updates.debuggingModel = "gemini-2.0-flash";
        }
      }

      // Sanitize individual model updates
      if (updates.extractionModel) {
        updates.extractionModel = this.sanitizeModelSelection(updates.extractionModel, provider);
      }
      if (updates.solutionModel) {
        updates.solutionModel = this.sanitizeModelSelection(updates.solutionModel, provider);
      }
      if (updates.debuggingModel) {
        updates.debuggingModel = this.sanitizeModelSelection(updates.debuggingModel, provider);
      }

      const newConfig = { ...currentConfig, ...updates };
      this.saveConfig(newConfig);

      // Emit event for config changes that affect processing
      if (updates.apiKey !== undefined || updates.apiProvider !== undefined ||
          updates.extractionModel !== undefined || updates.solutionModel !== undefined ||
          updates.debuggingModel !== undefined || updates.language !== undefined) {
        this.emit('config-updated', newConfig);
      }

      return newConfig;
    } catch (error) {
      console.error('Error updating config:', error);
      return this.defaultConfig;
    }
  }

  public hasApiKey(): boolean {
    const config = this.loadConfig();
    return !!config.apiKey && config.apiKey.trim().length > 0;
  }

  public isValidApiKeyFormat(apiKey: string, provider?: "openai" | "gemini" | "anthropic" | "groq"): boolean {
    const key = apiKey.trim();

    if (!provider) {
      if (key.startsWith('sk-ant-')) {
        provider = "anthropic";
      } else if (key.startsWith('sk-')) {
        provider = "openai";
      } else if (key.startsWith('gsk_')) {
        provider = "groq";
      } else if (key.startsWith('AIza')) {
        provider = "gemini";
      } else {
        provider = "groq";
      }
    }

    if (provider === "openai") {
      return /^sk-[a-zA-Z0-9]{32,}$/.test(key);
    } else if (provider === "gemini") {
      return key.length >= 10 && key.startsWith('AIza');
    } else if (provider === "anthropic") {
      return /^sk-ant-[a-zA-Z0-9]{32,}$/.test(key);
    } else if (provider === "groq") {
      return /^gsk_[a-zA-Z0-9]{32,}$/.test(key);
    }

    return false;
  }

  public getOpacity(): number {
    const config = this.loadConfig();
    return config.opacity !== undefined ? config.opacity : 1.0;
  }

  public setOpacity(opacity: number): void {
    const validOpacity = Math.min(1.0, Math.max(0.1, opacity));
    this.updateConfig({ opacity: validOpacity });
  }

  public getLanguage(): string {
    const config = this.loadConfig();
    return config.language || "python";
  }

  public setLanguage(language: string): void {
    this.updateConfig({ language });
  }

  public async testApiKey(apiKey: string, provider?: "openai" | "gemini" | "anthropic" | "groq"): Promise<{valid: boolean, error?: string}> {
    const key = apiKey.trim();

    if (!provider) {
      if (key.startsWith('sk-ant-')) {
        provider = "anthropic";
      } else if (key.startsWith('sk-')) {
        provider = "openai";
      } else if (key.startsWith('gsk_')) {
        provider = "groq";
      } else if (key.startsWith('AIza')) {
        provider = "gemini";
      } else {
        provider = "groq";
      }
    }

    if (provider === "openai") {
      return this.testOpenAIKey(apiKey);
    } else if (provider === "gemini") {
      return this.testGeminiKey(apiKey);
    } else if (provider === "anthropic") {
      return this.testAnthropicKey(apiKey);
    } else if (provider === "groq") {
      return this.testGroqKey(apiKey);
    }

    return { valid: false, error: "Unknown API provider" };
  }

  private async testOpenAIKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      const openai = new OpenAI({ apiKey });
      await openai.models.list();
      return { valid: true };
    } catch (error: any) {
      console.error('OpenAI API key test failed:', error);
      let errorMessage = 'Unknown error validating OpenAI API key';
      if (error.status === 401) {
        errorMessage = 'Invalid API key. Please check your OpenAI key and try again.';
      } else if (error.status === 429) {
        errorMessage = 'Rate limit exceeded or insufficient quota.';
      } else if (error.status === 500) {
        errorMessage = 'OpenAI server error. Please try again later.';
      } else if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }
      return { valid: false, error: errorMessage };
    }
  }

  private async testGeminiKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      if (apiKey && apiKey.trim().length >= 20 && apiKey.startsWith('AIza')) {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid Gemini API key format.' };
    } catch (error: any) {
      console.error('Gemini API key test failed:', error);
      return { valid: false, error: `Error: ${error.message}` };
    }
  }

  private async testAnthropicKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      if (apiKey && /^sk-ant-[a-zA-Z0-9]{32,}$/.test(apiKey.trim())) {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid Anthropic API key format.' };
    } catch (error: any) {
      console.error('Anthropic API key test failed:', error);
      return { valid: false, error: `Error: ${error.message}` };
    }
  }

  private async testGroqKey(apiKey: string): Promise<{valid: boolean, error?: string}> {
    try {
      const groq = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://api.groq.com/openai/v1"
      });
      await groq.models.list();
      return { valid: true };
    } catch (error: any) {
      console.error('Groq API key test failed:', error);
      let errorMessage = 'Unknown error validating Groq API key';
      if (error.status === 401) {
        errorMessage = 'Invalid Groq API key. Get one at console.groq.com/keys';
      } else if (error.status === 429) {
        errorMessage = 'Rate limit exceeded. Wait a minute and try again.';
      } else if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }
      return { valid: false, error: errorMessage };
    }
  }
}

export const configHelper = new ConfigHelper();
