// SettingsDialog.tsx
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";
import { useToast } from "../../contexts/toast";
import { 
  modelConfig, 
  providerConfigs, 
  getDefaultModel
} from "./model-config";
import type { 
  APIProvider, 
  AppConfig, 
  ProviderConfig 
} from "./types"; 

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}
type CategoryKey = 'extraction' | 'solution' | 'debugging';
export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [config, setConfig] = useState<AppConfig>(() => ({
    apiKey: "",
    apiProvider: "ollama", // Изменено с "groq" на "ollama"
    extractionModel: "qwen3-vl:4b", // Дефолтная модель для Ollama
    solutionModel: "qwen3-coder:30b-a3b-q4_K_M", // Дефолтная модель для Ollama
    debuggingModel: "qwen3-vl:4b", // Дефолтная модель для Ollama
    ollamaBaseUrl: "http://localhost:11434"
  }));
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
  };

useEffect(() => {
  if (!open) return;

  setIsLoading(true);
  window.electronAPI
    .getConfig()
    .then((loadedConfig: AppConfig) => {
      let provider = loadedConfig.apiProvider || "ollama"; // Дефолт - ollama
      
      // МИГРАЦИЯ: Если был groq без API ключа или модели от другого провайдера - сбрасываем на ollama
      const needsMigration = 
        provider === "groq" && 
        (!loadedConfig.apiKey || loadedConfig.apiKey === "") ||
        (loadedConfig.extractionModel && 
         !modelConfig.extraction.providers[provider]?.some(m => m.id === loadedConfig.extractionModel));

      if (needsMigration) {
        console.log("Migrating config from Groq to Ollama (no API key or invalid models)");
        provider = "ollama";
      }

      // Валидация моделей
      const getValidModel = (category: CategoryKey, modelId?: string) => {
        if (!modelId) return getDefaultModel(provider, category);
        
        const models = modelConfig[category].providers[provider];
        const modelExists = models?.some(m => m.id === modelId);
        return modelExists ? modelId : getDefaultModel(provider, category);
      };

      setConfig({
        apiKey: needsMigration ? "" : (loadedConfig.apiKey || ""), // Сбрасываем ключ при миграции
        apiProvider: provider,
        extractionModel: getValidModel("extraction", loadedConfig.extractionModel),
        solutionModel: getValidModel("solution", loadedConfig.solutionModel),
        debuggingModel: getValidModel("debugging", loadedConfig.debuggingModel),
        ollamaBaseUrl: loadedConfig.ollamaBaseUrl || "http://localhost:11434"
      });
    })
    .catch((error: unknown) => {
      console.error("Failed to load config:", error);
      showToast("Error", "Failed to load settings", "error");
    })
    .finally(() => {
      setIsLoading(false);
    });
}, [open, showToast]);

const handleProviderChange = (provider: APIProvider) => {
  setConfig(prev => ({
    ...prev,
    apiProvider: provider,
    extractionModel: getDefaultModel(provider, "extraction"),
    solutionModel: getDefaultModel(provider, "solution"),
    debuggingModel: getDefaultModel(provider, "debugging")
  }));
};

  const handleModelChange = (category: CategoryKey, modelId: string) => {
    setConfig(prev => ({ ...prev, [`${category}Model`]: modelId }));
  };

  const handleSave = async () => {
  setIsLoading(true);
  try {
    const provider = config.apiProvider || "ollama"; // БЫЛО: "groq", СТАЛО: "ollama"
    
    // Валидация перед сохранением
    const validatedConfig: AppConfig = {
      ...config,
      extractionModel: config.extractionModel || getDefaultModel(provider, "extraction"),
      solutionModel: config.solutionModel || getDefaultModel(provider, "solution"),
      debuggingModel: config.debuggingModel || getDefaultModel(provider, "debugging"),
    };

    const result = await window.electronAPI.updateConfig(validatedConfig);
    if (result) {
      showToast("Success", "Settings saved successfully", "success");
      handleOpenChange(false);
      setTimeout(() => window.location.reload(), 1500);
    }
  } catch (error) {
    console.error("Failed to save settings:", error);
    showToast("Error", "Failed to save settings", "error");
  } finally {
    setIsLoading(false);
  }
};

  const maskApiKey = (key: string) => {
    if (!key || key.length < 8) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
  };

const currentProvider = providerConfigs[config.apiProvider || "ollama"];
  const requiresApiKey = config.apiProvider !== "ollama";

  // Исправляем Tailwind классы для цветов
const getProviderButtonClasses = (providerKey: string, provider: {
  name: string;
  color: string;
  isFree: boolean;
  instructions: { signup: string; apiKeys: string | null; description: string };
}) => {
  const baseClasses = "p-4 rounded-lg border-2 transition-all text-left";
  const isActive = config.apiProvider === providerKey;
  
  if (isActive) {
    switch (provider.color) {
      case 'green': return `${baseClasses} border-green-500 bg-green-500/10`;
      case 'blue': return `${baseClasses} border-blue-500 bg-blue-500/10`;
      case 'purple': return `${baseClasses} border-purple-500 bg-purple-500/10`;
      case 'orange': return `${baseClasses} border-orange-500 bg-orange-500/10`;
      case 'indigo': return `${baseClasses} border-indigo-500 bg-indigo-500/10`;
      default: return `${baseClasses} border-white/10 hover:border-white/30`;
    }
  }
  
  return `${baseClasses} border-white/10 hover:border-white/30`;
};

 return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button className="p-2 rounded-lg hover:bg-white/10 transition-colors">
          <Settings className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-900 text-white border-white/10">
        <DialogHeader>
          <DialogTitle>API Settings</DialogTitle>
          <DialogDescription>
            Configure your model preferences. Use Ollama for local, free AI or cloud providers for faster responses.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* API Provider Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium">AI Provider</label>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(providerConfigs).map(([key, provider]) => (
                <button
                  key={key}
                  onClick={() => handleProviderChange(key as APIProvider)}
                  className={getProviderButtonClasses(key, provider)}
                >
                  <div className="font-semibold">
                    {provider.name} {provider.isFree && "⭐ FREE"}
                  </div>
                  <div className="text-xs text-white/60">
                    {key === "ollama" && "Local models (Qwen3-VL, Llama, etc.)"}
                    {key === "groq" && "Llama 4 + GPT-OSS (14,400 RPD)"}
                    {key === "openai" && "GPT-4o models"}
                    {key === "gemini" && "Gemini 1.5/2.0 models"}
                    {key === "anthropic" && "Claude 3 models"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* API Key Input */}
          {requiresApiKey && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {currentProvider.name} API Key
              </label>
              <Input
                type="password"
                value={config.apiKey || ""}
                onChange={(e) => setConfig({...config, apiKey: e.target.value})}
                placeholder={
                  config.apiProvider === "openai" ? "sk-..." :
                  config.apiProvider === "gemini" ? "AIza..." :
                  config.apiProvider === "groq" ? "gsk_..." :
                  "sk-ant-..."
                }
                className="bg-black/50 border-white/10 text-white"
              />
              {config.apiKey && (
                <p className="text-xs text-white/60">
                  Current: {maskApiKey(config.apiKey)}
                </p>
              )}
              <p className="text-xs text-white/60">
                Your API key is stored locally and never sent to any server except {currentProvider.name}
              </p>
            </div>
          )}

          {/* Ollama Configuration */}
          {config.apiProvider === "ollama" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Ollama Base URL</label>
              <Input
                value={config.ollamaBaseUrl || "http://localhost:11434"}
                onChange={(e) => setConfig({...config, ollamaBaseUrl: e.target.value})}
                placeholder="http://localhost:11434"
                className="bg-black/50 border-white/10 text-white"
              />
              <p className="text-xs text-white/60">
                Ensure Ollama is running locally or enter remote server URL
              </p>
            </div>
          )}

          {/* API Key Instructions */}
          <div className="p-3 bg-white/5 rounded-lg text-xs space-y-2">
            <p className="font-semibold">
              {requiresApiKey ? "Don't have an API key?" : "How to setup Ollama?"}
            </p>
            {currentProvider.instructions.apiKeys ? (
              <>
                <p>1. Create an account at{" "}
                  <span 
                    onClick={() => openExternalLink(currentProvider.instructions.signup)} 
                    className="text-blue-400 hover:underline cursor-pointer"
                  >
                    {currentProvider.name}
                  </span>
                </p>
                <p>2. Go to{" "}
                  <span 
                    onClick={() => openExternalLink(currentProvider.instructions.apiKeys!)} 
                    className="text-blue-400 hover:underline cursor-pointer"
                  >
                    API Keys section
                  </span>
                </p>
                <p>3. Create a new API key and paste it here</p>
              </>
            ) : (
              <>
                <p className="text-green-400 font-semibold">✅ FREE & LOCAL - Run models on your own machine!</p>
                <p>1. Download and install{" "}
                  <span 
                    onClick={() => openExternalLink("https://ollama.com/download")} 
                    className="text-blue-400 hover:underline cursor-pointer"
                  >
                    Ollama
                  </span>
                </p>
                <p>2. Open terminal and run:{" "}
                  <code className="bg-black/30 px-1 rounded">ollama pull qwen3-vl:4b</code>
                </p>
                <p>3. For coding tasks also run:{" "}
                  <code className="bg-black/30 px-1 rounded">ollama pull qwen3-coder:30b-a3b-q4_K_M</code>
                </p>
                <p>4. Start Ollama and keep it running in background</p>
                <p>5. Ensure the base URL above matches your Ollama instance</p>
              </>
            )}
            {currentProvider.instructions.description && (
              <p className="text-white/60">{currentProvider.instructions.description}</p>
            )}
          </div>

          {/* AI Model Selection */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">AI Model Selection</h3>
            <p className="text-xs text-white/60">Select which models to use for each stage of the process</p>
{Object.entries(modelConfig).map(([key, categoryObj]) => {
  const provider = config.apiProvider || "ollama";
  // categoryObj - это уже ModelCategory объект, не нужно индексировать modelConfig
  const models = categoryObj.providers[provider] || [];
  const currentValue = config[`${key}Model` as keyof AppConfig] as string;

  return (
    <div key={key} className="space-y-2">
      <div>
        <h4 className="text-sm font-medium">{categoryObj.title}</h4>
        <p className="text-xs text-white/60">{categoryObj.description}</p>
      </div>
      <div className="space-y-2">
        {models.map((model) => (
          <button
            key={model.id}
            onClick={() => handleModelChange(key as CategoryKey, model.id)}
            className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
              currentValue === model.id
                ? "border-blue-500 bg-blue-500/10"
                : "border-white/10 hover:border-white/30"
            }`}
          >
            <div className="font-medium text-sm">{model.name}</div>
            <div className="text-xs text-white/60">{model.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
})}
          </div>

          {/* Keyboard Shortcuts */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Keyboard Shortcuts</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {keyboardShortcuts.map((shortcut) => (
                <div key={shortcut.action} className="flex justify-between p-2 bg-white/5 rounded">
                  <span>{shortcut.action}</span>
                  <span className="text-white/60">{shortcut.keys}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => handleOpenChange(false)}
            variant="outline"
            className="border-white/10 hover:bg-white/5 text-white"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const keyboardShortcuts = [
  { action: "Toggle Visibility", keys: "Ctrl+B / Cmd+B" },
  { action: "Take Screenshot", keys: "Ctrl+H / Cmd+H" },
  { action: "Process Screenshots", keys: "Ctrl+Enter / Cmd+Enter" },
  { action: "Delete Last Screenshot", keys: "Ctrl+L / Cmd+L" },
  { action: "Reset View", keys: "Ctrl+R / Cmd+R" },
  { action: "Quit Application", keys: "Ctrl+Q / Cmd+Q" },
  { action: "Move Window", keys: "Ctrl+Arrow Keys" },
  { action: "Decrease Opacity", keys: "Ctrl+[ / Cmd+[" },
  { action: "Increase Opacity", keys: "Ctrl+] / Cmd+]" },
  { action: "Zoom Out", keys: "Ctrl+- / Cmd+-" },
  { action: "Reset Zoom", keys: "Ctrl+0 / Cmd+0" },
  { action: "Zoom In", keys: "Ctrl+= / Cmd+=" },
];