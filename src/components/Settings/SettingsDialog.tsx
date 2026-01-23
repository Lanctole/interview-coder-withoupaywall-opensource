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

type APIProvider = "openai" | "gemini" | "anthropic" | "groq";

type AIModel = {
  id: string;
  name: string;
  description: string;
};

type ModelCategory = {
  key: 'extractionModel' | 'solutionModel' | 'debuggingModel';
  title: string;
  description: string;
  openaiModels: AIModel[];
  geminiModels: AIModel[];
  anthropicModels: AIModel[];
  groqModels: AIModel[];
};

// ✅ UPDATED: Оптимизированные модели (январь 2026)
const modelCategories: ModelCategory[] = [
  {
    key: 'extractionModel',
    title: 'Problem Extraction',
    description: 'Model used to analyze screenshots and extract problem details',
    openaiModels: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        description: "Faster, more cost-effective option"
      }
    ],
    geminiModels: [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ],
    groqModels: [
      {
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
        name: "Llama 4 Scout 17B ⭐",
        description: "Vision model for OCR, replaces Llama 3.2 (free)"
      }
    ]
  },
  {
    key: 'solutionModel',
    title: 'Solution Generation',
    description: 'Model used to generate coding solutions',
    openaiModels: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        description: "Faster, more cost-effective option"
      }
    ],
    geminiModels: [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ],
    groqModels: [
      {
        id: "meta-llama/llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick 17B ⭐ RECOMMENDED",
        description: "Best for coding! 128 experts, understands Stream API, patterns (free)"
      },
      {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B",
        description: "Large 120B param model by GroqLabs (free)"
      },
      {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B Versatile",
        description: "General purpose, fast generation (free)"
      },
      {
        id: "llama-3.1-70b-versatile",
        name: "Llama 3.1 70B Versatile",
        description: "Alternative versatile model"
      },
      {
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B Instant",
        description: "Fast & lightweight, replaces Gemma"
      }
    ]
  },
  {
    key: 'debuggingModel',
    title: 'Debugging',
    description: 'Model used to debug and improve solutions',
    openaiModels: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        description: "Faster, more cost-effective option"
      }
    ],
    geminiModels: [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ],
    groqModels: [
      {
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
        name: "Llama 4 Scout 17B ⭐",
        description: "Vision model for analyzing error screenshots (free)"
      }
    ]
  }
];

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [apiKey, setApiKey] = useState("");
  const [apiProvider, setApiProvider] = useState<APIProvider>("groq");
  const [extractionModel, setExtractionModel] = useState("meta-llama/llama-4-scout-17b-16e-instruct");
  const [solutionModel, setSolutionModel] = useState("meta-llama/llama-4-maverick-17b-128e-instruct"); // ⭐ ИЗМЕНЕНО
  const [debuggingModel, setDebuggingModel] = useState("meta-llama/llama-4-scout-17b-16e-instruct");
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (onOpenChange && newOpen !== externalOpen) {
      onOpenChange(newOpen);
    }
  };

  useEffect(() => {
    if (open) {
      setIsLoading(true);
      interface Config {
        apiKey?: string;
        apiProvider?: APIProvider;
        extractionModel?: string;
        solutionModel?: string;
        debuggingModel?: string;
      }

      window.electronAPI
        .getConfig()
        .then((config: Config) => {
          setApiKey(config.apiKey || "");
          setApiProvider(config.apiProvider || "groq");
          setExtractionModel(config.extractionModel || "meta-llama/llama-4-scout-17b-16e-instruct");
          setSolutionModel(config.solutionModel || "meta-llama/llama-4-maverick-17b-128e-instruct"); // ⭐ ИЗМЕНЕНО
          setDebuggingModel(config.debuggingModel || "meta-llama/llama-4-scout-17b-16e-instruct");
        })
        .catch((error: unknown) => {
          console.error("Failed to load config:", error);
          showToast("Error", "Failed to load settings", "error");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, showToast]);

  const handleProviderChange = (provider: APIProvider) => {
    setApiProvider(provider);
    if (provider === "openai") {
      setExtractionModel("gpt-4o");
      setSolutionModel("gpt-4o");
      setDebuggingModel("gpt-4o");
    } else if (provider === "gemini") {
      setExtractionModel("gemini-1.5-pro");
      setSolutionModel("gemini-1.5-pro");
      setDebuggingModel("gemini-1.5-pro");
    } else if (provider === "anthropic") {
      setExtractionModel("claude-3-7-sonnet-20250219");
      setSolutionModel("claude-3-7-sonnet-20250219");
      setDebuggingModel("claude-3-7-sonnet-20250219");
    } else if (provider === "groq") {
      setExtractionModel("meta-llama/llama-4-scout-17b-16e-instruct");
      setSolutionModel("meta-llama/llama-4-maverick-17b-128e-instruct"); // ⭐ ИЗМЕНЕНО: Maverick по умолчанию
      setDebuggingModel("meta-llama/llama-4-scout-17b-16e-instruct");
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.updateConfig({
        apiKey,
        apiProvider,
        extractionModel,
        solutionModel,
        debuggingModel,
      });

      if (result) {
        showToast("Success", "Settings saved successfully", "success");
        handleOpenChange(false);
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      showToast("Error", "Failed to save settings", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const maskApiKey = (key: string) => {
    if (!key || key.length < 10) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
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
            Configure your API key and model preferences. You'll need your own API key to use this application.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* API Provider Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium">API Provider</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleProviderChange("groq")}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  apiProvider === "groq"
                    ? "border-green-500 bg-green-500/10"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                <div className="font-semibold">Groq ⭐ FREE</div>
                <div className="text-xs text-white/60">Llama 4 + GPT-OSS (14,400 RPD)</div>
              </button>
              <button
                onClick={() => handleProviderChange("openai")}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  apiProvider === "openai"
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                <div className="font-semibold">OpenAI</div>
                <div className="text-xs text-white/60">GPT-4o models</div>
              </button>
              <button
                onClick={() => handleProviderChange("gemini")}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  apiProvider === "gemini"
                    ? "border-purple-500 bg-purple-500/10"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                <div className="font-semibold">Gemini</div>
                <div className="text-xs text-white/60">Gemini 1.5 models</div>
              </button>
              <button
                onClick={() => handleProviderChange("anthropic")}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  apiProvider === "anthropic"
                    ? "border-orange-500 bg-orange-500/10"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                <div className="font-semibold">Claude</div>
                <div className="text-xs text-white/60">Claude 3 models</div>
              </button>
            </div>
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {apiProvider === "openai" ? "OpenAI API Key" :
               apiProvider === "gemini" ? "Gemini API Key" :
               apiProvider === "groq" ? "Groq API Key" :
               "Anthropic API Key"}
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                apiProvider === "openai" ? "sk-..." :
                apiProvider === "gemini" ? "AIza..." :
                apiProvider === "groq" ? "gsk_..." :
                "sk-ant-..."
              }
              className="bg-black/50 border-white/10 text-white"
            />
            {apiKey && (
              <p className="text-xs text-white/60">
                Current: {maskApiKey(apiKey)}
              </p>
            )}
            <p className="text-xs text-white/60">
              Your API key is stored locally and never sent to any server except{" "}
              {apiProvider === "openai" ? "OpenAI" :
               apiProvider === "gemini" ? "Google" :
               apiProvider === "groq" ? "Groq" :
               "Anthropic"}
            </p>

            {/* API Key Instructions */}
            <div className="p-3 bg-white/5 rounded-lg text-xs space-y-1">
              <p className="font-semibold">Don't have an API key?</p>
              {apiProvider === "openai" ? (
                <>
                  <p>1. Create an account at <span onClick={() => openExternalLink('https://platform.openai.com/signup')} className="text-blue-400 hover:underline cursor-pointer">OpenAI</span></p>
                  <p>2. Go to <span onClick={() => openExternalLink('https://platform.openai.com/api-keys')} className="text-blue-400 hover:underline cursor-pointer">API Keys section</span></p>
                  <p>3. Create a new secret key and paste it here</p>
                </>
              ) : apiProvider === "gemini" ? (
                <>
                  <p>1. Create an account at <span onClick={() => openExternalLink('https://aistudio.google.com/')} className="text-blue-400 hover:underline cursor-pointer">Google AI Studio</span></p>
                  <p>2. Go to the <span onClick={() => openExternalLink('https://aistudio.google.com/app/apikey')} className="text-blue-400 hover:underline cursor-pointer">API Keys section</span></p>
                  <p>3. Create a new API key and paste it here</p>
                </>
              ) : apiProvider === "groq" ? (
                <>
                  <p className="text-green-400 font-semibold">✅ FREE FOREVER - No credit card required!</p>
                  <p>1. Create an account at <span onClick={() => openExternalLink('https://console.groq.com')} className="text-blue-400 hover:underline cursor-pointer">Groq Console</span></p>
                  <p>2. Go to <span onClick={() => openExternalLink('https://console.groq.com/keys')} className="text-blue-400 hover:underline cursor-pointer">API Keys section</span></p>
                  <p>3. Create a new API key (starts with gsk_) and paste it here</p>
                  <p className="text-white/60">⚡ Limits: 30 requests/min, 14,400 requests/day (plenty for daily use!)</p>
                </>
              ) : (
                <>
                  <p>1. Create an account at <span onClick={() => openExternalLink('https://console.anthropic.com/signup')} className="text-blue-400 hover:underline cursor-pointer">Anthropic</span></p>
                  <p>2. Go to the <span onClick={() => openExternalLink('https://console.anthropic.com/settings/keys')} className="text-blue-400 hover:underline cursor-pointer">API Keys section</span></p>
                  <p>3. Create a new API key and paste it here</p>
                </>
              )}
            </div>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Keyboard Shortcuts</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Toggle Visibility</span>
                <span className="text-white/60">Ctrl+B / Cmd+B</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Take Screenshot</span>
                <span className="text-white/60">Ctrl+H / Cmd+H</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Process Screenshots</span>
                <span className="text-white/60">Ctrl+Enter / Cmd+Enter</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Delete Last Screenshot</span>
                <span className="text-white/60">Ctrl+L / Cmd+L</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Reset View</span>
                <span className="text-white/60">Ctrl+R / Cmd+R</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Quit Application</span>
                <span className="text-white/60">Ctrl+Q / Cmd+Q</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Move Window</span>
                <span className="text-white/60">Ctrl+Arrow Keys</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Decrease Opacity</span>
                <span className="text-white/60">Ctrl+[ / Cmd+[</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Increase Opacity</span>
                <span className="text-white/60">Ctrl+] / Cmd+]</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Zoom Out</span>
                <span className="text-white/60">Ctrl+- / Cmd+-</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Reset Zoom</span>
                <span className="text-white/60">Ctrl+0 / Cmd+0</span>
              </div>
              <div className="flex justify-between p-2 bg-white/5 rounded">
                <span>Zoom In</span>
                <span className="text-white/60">Ctrl+= / Cmd+=</span>
              </div>
            </div>
          </div>

          {/* AI Model Selection */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">AI Model Selection</h3>
            <p className="text-xs text-white/60">Select which models to use for each stage of the process</p>

            {modelCategories.map((category) => {
              const models = 
                apiProvider === "openai" ? category.openaiModels :
                apiProvider === "gemini" ? category.geminiModels :
                apiProvider === "groq" ? category.groqModels :
                category.anthropicModels;

              return (
                <div key={category.key} className="space-y-2">
                  <div>
                    <h4 className="text-sm font-medium">{category.title}</h4>
                    <p className="text-xs text-white/60">{category.description}</p>
                  </div>
                  <div className="space-y-2">
                    {models.map((m) => {
                      const currentValue = 
                        category.key === 'extractionModel' ? extractionModel :
                        category.key === 'solutionModel' ? solutionModel :
                        debuggingModel;

                      const setValue = 
                        category.key === 'extractionModel' ? setExtractionModel :
                        category.key === 'solutionModel' ? setSolutionModel :
                        setDebuggingModel;

                      return (
                        <button
                          key={m.id}
                          onClick={() => setValue(m.id)}
                          className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                            currentValue === m.id
                              ? "border-blue-500 bg-blue-500/10"
                              : "border-white/10 hover:border-white/30"
                          }`}
                        >
                          <div className="font-medium text-sm">{m.name}</div>
                          <div className="text-xs text-white/60">{m.description}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
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
