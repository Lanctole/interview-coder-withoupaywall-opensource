// electron/ConfigHelper.ts
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { EventEmitter } from "events";
import { AppConfig } from "../shared/types"; // импортируем общий тип

export class ConfigHelper extends EventEmitter {
  private configPath: string;
  private defaultConfig: AppConfig = {
    apiKey: "",
    apiProvider: "ollama",
    extractionModel: "",
    solutionModel: "",
    debuggingModel: "",
    ollamaBaseUrl: "http://localhost:11434",
    language: "java",
    opacity: 0.0
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

  public loadConfig(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configData);
        // Просто возвращаем, без валидации (валидация будет в UI или провайдерах)
        return { ...this.defaultConfig, ...config };
      }
      this.saveConfig(this.defaultConfig);
      return this.defaultConfig;
    } catch (err) {
      console.error("Error loading config:", err);
      return this.defaultConfig;
    }
  }

  public saveConfig(config: AppConfig): void {
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

  public updateConfig(updates: Partial<AppConfig>): AppConfig {
    try {
      const currentConfig = this.loadConfig();
      const newConfig = { ...currentConfig, ...updates };
      this.saveConfig(newConfig);
      this.emit('config-updated', newConfig);
      return newConfig;
    } catch (error) {
      console.error('Error updating config:', error);
      return this.defaultConfig;
    }
  }

  // Удалены: hasApiKey, isValidApiKeyFormat, testApiKey, testOpenAIKey, testGeminiKey,
  // testAnthropicKey, testGroqKey, sanitizeModelSelection, getOpacity, setOpacity,
  // getLanguage, setLanguage (их можно оставить, если они используются в других местах,
  // но лучше перенести логику в соответствующие провайдеры или UI)
}

export const configHelper = new ConfigHelper();