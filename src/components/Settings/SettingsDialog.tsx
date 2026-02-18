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
import { Settings, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "../../contexts/toast";
import type { ProviderType, AppConfig } from "../../../shared/types";// Импортируем только необходимые типы

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type CategoryKey = 'extraction' | 'solution' | 'debugging';

// Информация о модели, приходящая из провайдера (соответствует ModelInfo из BaseProvider)
interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  supportsVision: boolean;
  contextLength?: number;
}

// Метаданные провайдера из BaseProvider.getProviderInfo()
interface ProviderInfo {
  name: string;
  color: string;
  isFree: boolean;
  instructions: {
    signup: string;
    apiKeys: string | null;
    description: string;
  };
}

// Полная структура провайдера, возвращаемая getAllProviders()
interface ProviderWithDetails {
  type: ProviderType;
  info: ProviderInfo;
  models: ModelInfo[];
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [config, setConfig] = useState<AppConfig>(() => ({
    apiKey: "",
    apiProvider: "ollama",
    extractionModel: "",
    solutionModel: "",
    debuggingModel: "",
    ollamaBaseUrl: "http://localhost:11434"
  }));
  
  // Список всех доступных провайдеров (загружается один раз)
  const [providers, setProviders] = useState<ProviderWithDetails[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  
  // Модели для текущего выбранного провайдера (синхронизируются с providers)
  const [currentModels, setCurrentModels] = useState<ModelInfo[]>([]);
  
  // Состояние загрузки моделей (для ручного обновления)
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  // Определяем, требует ли текущий провайдер API ключ
  const requiresApiKey = config.apiProvider !== "ollama";

  // Синхронизация внешнего пропса open
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  // Загрузка сохранённой конфигурации и всех провайдеров при открытии
  useEffect(() => {
    if (!open) return;

    const loadInitialData = async () => {
      setIsLoadingProviders(true);
      try {
        // Загружаем сохранённые настройки
        const loadedConfig = await window.electronAPI.getConfig() as AppConfig;
        
        // Загружаем всех провайдеров с их метаданными и моделями
        const allProviders = await window.electronAPI.getAllProviders() as ProviderWithDetails[];
        setProviders(allProviders);

        // Определяем провайдера (из конфига или первый доступный)
        let provider = loadedConfig.apiProvider;
        if (!provider || !allProviders.some(p => p.type === provider)) {
          provider = allProviders[0]?.type || "ollama";
        }

        // Находим модели для выбранного провайдера
        const selectedProvider = allProviders.find(p => p.type === provider);
        const models = selectedProvider?.models || [];

        setCurrentModels(models);

        // Устанавливаем конфиг, подставляя дефолтные модели если нужно
        setConfig({
          apiKey: loadedConfig.apiKey || "",
          apiProvider: provider,
          extractionModel: loadedConfig.extractionModel || getDefaultModelId(models, 'extraction'),
          solutionModel: loadedConfig.solutionModel || getDefaultModelId(models, 'solution'),
          debuggingModel: loadedConfig.debuggingModel || getDefaultModelId(models, 'debugging'),
          ollamaBaseUrl: loadedConfig.ollamaBaseUrl || "http://localhost:11434"
        });
      } catch (error) {
        console.error("Failed to load initial data:", error);
        showToast("Error", "Failed to load settings", "error");
      } finally {
        setIsLoadingProviders(false);
      }
    };

    loadInitialData();
  }, [open, showToast]);

  // Вспомогательная функция для выбора модели по умолчанию
  const getDefaultModelId = (models: ModelInfo[], category: CategoryKey): string => {
    if (models.length === 0) return "";
    
    if (category === 'extraction' || category === 'debugging') {
      const visionModel = models.find(m => m.supportsVision);
      if (visionModel) return visionModel.id;
    }
    return models[0]?.id || "";
  };

  // Смена провайдера
  const handleProviderChange = (providerType: ProviderType) => {
    const selectedProvider = providers.find(p => p.type === providerType);
    if (!selectedProvider) return;

    setCurrentModels(selectedProvider.models);
    setConfig(prev => ({
      ...prev,
      apiProvider: providerType,
      apiKey: providerType === 'ollama' ? '' : prev.apiKey, // сбрасываем ключ для локального провайдера
      extractionModel: getDefaultModelId(selectedProvider.models, 'extraction'),
      solutionModel: getDefaultModelId(selectedProvider.models, 'solution'),
      debuggingModel: getDefaultModelId(selectedProvider.models, 'debugging')
    }));
  };

  // Ручное обновление моделей (например, после ввода ключа)
  const refreshModels = async () => {
    if (!config.apiProvider) return;
    
    setIsRefreshingModels(true);
    try {
      const baseUrl = config.apiProvider === 'ollama' ? config.ollamaBaseUrl : undefined;
      const freshModels = await window.electronAPI.getProviderModels(
        config.apiProvider,
        config.apiKey,
        baseUrl
      ) as ModelInfo[];
      
      // Обновляем список моделей в состоянии providers (чтобы сохранить синхронизацию)
      setProviders(prev => prev.map(p => 
        p.type === config.apiProvider 
          ? { ...p, models: freshModels } 
          : p
      ));
      
      setCurrentModels(freshModels);
      
      // Если текущие выбранные модели отсутствуют в новом списке, сбрасываем на дефолтные
      setConfig(prev => ({
        ...prev,
        extractionModel: prev.extractionModel && freshModels.some(m => m.id === prev.extractionModel) 
          ? prev.extractionModel 
          : getDefaultModelId(freshModels, 'extraction'),
        solutionModel: prev.solutionModel && freshModels.some(m => m.id === prev.solutionModel)
          ? prev.solutionModel
          : getDefaultModelId(freshModels, 'solution'),
        debuggingModel: prev.debuggingModel && freshModels.some(m => m.id === prev.debuggingModel)
          ? prev.debuggingModel
          : getDefaultModelId(freshModels, 'debugging')
      }));
      
      showToast("Success", "Models updated", "success");
    } catch (error) {
      console.error("Failed to refresh models:", error);
      showToast("Error", "Failed to refresh models", "error");
    } finally {
      setIsRefreshingModels(false);
    }
  };

  const handleModelChange = (category: CategoryKey, modelId: string) => {
    setConfig(prev => ({ ...prev, [`${category}Model`]: modelId }));
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const provider = config.apiProvider;
      if (!provider) {
        showToast("Error", "Please select a provider", "error");
        return;
      }

      // Для провайдеров, требующих ключ, проверяем наличие ключа
      if (requiresApiKey && !config.apiKey) {
        showToast("Error", `${getCurrentProviderInfo()?.name} API key is required`, "error");
        return;
      }

      // Проверяем, что все модели выбраны
      if (!config.extractionModel || !config.solutionModel || !config.debuggingModel) {
        showToast("Error", "Please select models for all stages", "error");
        return;
      }

      const result = await window.electronAPI.updateConfig(config);
      if (result) {
        showToast("Success", "Settings saved successfully", "success");
        handleOpenChange(false);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      showToast("Error", "Failed to save settings", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  const maskApiKey = (key: string) => {
    if (!key || key.length < 8) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
  };

  // Получить информацию о текущем провайдере
  const getCurrentProviderInfo = (): ProviderInfo | undefined => {
    return providers.find(p => p.type === config.apiProvider)?.info;
  };

  // Фильтрация моделей по категории
  const getModelsForCategory = (category: CategoryKey): ModelInfo[] => {
    if (!currentModels.length) return [];
    if (category === 'extraction' || category === 'debugging') {
      return currentModels.filter(m => m.supportsVision);
    }
    return currentModels;
  };

  const currentProviderInfo = getCurrentProviderInfo();

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
          {/* Загрузка провайдеров */}
          {isLoadingProviders ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-white/60" />
              <span className="ml-2 text-white/60">Loading providers...</span>
            </div>
          ) : (
            <>
              {/* API Provider Selection */}
              <div className="space-y-3">
                <label className="text-sm font-medium">AI Provider</label>
                <div className="grid grid-cols-2 gap-3">
                  {providers.map(({ type, info }) => {
                    const isActive = config.apiProvider === type;
                    const baseClasses = "p-4 rounded-lg border-2 transition-all text-left";
                    const activeClasses = isActive
                      ? {
                          indigo: "border-indigo-500 bg-indigo-500/10",
                          green: "border-green-500 bg-green-500/10",
                          blue: "border-blue-500 bg-blue-500/10",
                          purple: "border-purple-500 bg-purple-500/10",
                          orange: "border-orange-500 bg-orange-500/10",
                        }[info.color] || "border-white/10 hover:border-white/30"
                      : "border-white/10 hover:border-white/30";

                    return (
                      <button
                        key={type}
                        onClick={() => handleProviderChange(type)}
                        className={`${baseClasses} ${activeClasses}`}
                      >
                        <div className="font-semibold">
                          {info.name} {info.isFree && "⭐ FREE"}
                        </div>
                        <div className="text-xs text-white/60">
                          {type === "ollama" && "Local models (Qwen, Llama, etc.)"}
                          {type === "openrouter" && "Unified API for many models"}
                          {type === "openai" && "GPT-4o models"}
                          {type === "groq" && "Fast inference"}
                          {type === "gemini" && "Gemini models"}
                          {type === "anthropic" && "Claude 3 models"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* API Key Input (if required) */}
              {requiresApiKey && currentProviderInfo && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {currentProviderInfo.name} API Key
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={config.apiKey || ""}
                      onChange={(e) => setConfig({...config, apiKey: e.target.value})}
                      placeholder={
                        config.apiProvider === "openai" ? "sk-..." :
                        config.apiProvider === "gemini" ? "AIza..." :
                        config.apiProvider === "groq" ? "gsk_..." :
                        config.apiProvider === "anthropic" ? "sk-ant-..." :
                        "Enter API key"
                      }
                      className="flex-1 bg-black/50 border-white/10 text-white"
                    />
                    <Button
                      onClick={refreshModels}
                      disabled={isRefreshingModels || !config.apiKey}
                      variant="outline"
                      size="icon"
                      title="Refresh models after entering key"
                    >
                      <RefreshCw className={`h-4 w-4 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  {config.apiKey && (
                    <p className="text-xs text-white/60">
                      Current: {maskApiKey(config.apiKey)}
                    </p>
                  )}
                  <p className="text-xs text-white/60">
                    Your API key is stored locally and never sent to any server except {currentProviderInfo.name}
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
              {currentProviderInfo && (
                <div className="p-3 bg-white/5 rounded-lg text-xs space-y-2">
                  <p className="font-semibold">
                    {requiresApiKey ? "Don't have an API key?" : "How to setup Ollama?"}
                  </p>
                  {currentProviderInfo.instructions.apiKeys ? (
                    <>
                      <p>1. Create an account at{" "}
                        <span 
                          onClick={() => openExternalLink(currentProviderInfo.instructions.signup)} 
                          className="text-blue-400 hover:underline cursor-pointer"
                        >
                          {currentProviderInfo.name}
                        </span>
                      </p>
                      <p>2. Go to{" "}
                        <span 
                          onClick={() => openExternalLink(currentProviderInfo.instructions.apiKeys!)} 
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
                          onClick={() => openExternalLink(currentProviderInfo.instructions.signup)} 
                          className="text-blue-400 hover:underline cursor-pointer"
                        >
                          Ollama
                        </span>
                      </p>
                      <p>2. Open terminal and run models, e.g.:{" "}
                        <code className="bg-black/30 px-1 rounded">ollama pull qwen2.5-coder:7b</code>
                      </p>
                      <p>3. Start Ollama and keep it running in background</p>
                      <p>4. Ensure the base URL above matches your Ollama instance</p>
                    </>
                  )}
                  {currentProviderInfo.instructions.description && (
                    <p className="text-white/60">{currentProviderInfo.instructions.description}</p>
                  )}
                </div>
              )}

              {/* AI Model Selection */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">AI Model Selection</h3>
                <p className="text-xs text-white/60">Select which models to use for each stage of the process</p>
                
                {isRefreshingModels ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-white/60" />
                    <span className="ml-2 text-white/60">Refreshing models...</span>
                  </div>
                ) : currentModels.length === 0 ? (
                  <div className="text-center py-8 text-white/60">
                    No models available for this provider. 
                    {config.apiProvider === 'ollama' && ' Make sure Ollama is running.'}
                    {requiresApiKey && ' Enter your API key and click refresh.'}
                  </div>
                ) : (
                  (['extraction', 'solution', 'debugging'] as CategoryKey[]).map((category) => {
                    const models = getModelsForCategory(category);
                    const currentValue = config[`${category}Model`] as string;
                    const categoryTitles = {
                      extraction: "Problem Extraction",
                      solution: "Solution Generation",
                      debugging: "Debugging"
                    };
                    const categoryDescriptions = {
                      extraction: "Model used to analyze screenshots and extract problem details",
                      solution: "Model used to generate coding solutions",
                      debugging: "Model used to debug and improve solutions"
                    };

                    if (models.length === 0) {
                      return (
                        <div key={category} className="space-y-2 opacity-50">
                          <h4 className="text-sm font-medium">{categoryTitles[category]}</h4>
                          <p className="text-xs text-white/60">No compatible models available</p>
                        </div>
                      );
                    }

                    return (
                      <div key={category} className="space-y-2">
                        <div>
                          <h4 className="text-sm font-medium">{categoryTitles[category]}</h4>
                          <p className="text-xs text-white/60">{categoryDescriptions[category]}</p>
                        </div>
                        <div className="space-y-2">
                          {models.map((model) => (
                            <button
                              key={model.id}
                              onClick={() => handleModelChange(category, model.id)}
                              className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                                currentValue === model.id
                                  ? "border-blue-500 bg-blue-500/10"
                                  : "border-white/10 hover:border-white/30"
                              }`}
                            >
                              <div className="font-medium text-sm">{model.name}</div>
                              <div className="text-xs text-white/60">
                                {model.description || (model.supportsVision ? "👁️ Supports vision" : "Text only")}
                                {model.contextLength && ` • Context: ${model.contextLength} tokens`}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* Keyboard Shortcuts (оставляем как есть) */}
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
          <Button 
            onClick={handleSave} 
            disabled={isLoading || isLoadingProviders || isRefreshingModels}
          >
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