// ipcHandlers.ts

import { ipcMain, shell } from "electron";
import { IIpcHandlerDeps } from "./main";
import { configHelper } from "./ConfigHelper";
import { ProviderFactory } from "./ProviderFactory";
import { ProviderConfig } from "./providers/BaseProvider";
import { AppConfig } from "../shared/types"; // импортируем общий тип

export function initializeIpcHandlers(deps: IIpcHandlerDeps): void {
  console.log("Initializing IPC handlers");

  // Конфигурация
  ipcMain.handle("get-config", () => {
    return configHelper.loadConfig();
  });

  ipcMain.handle("update-config", (_event, updates: Partial<AppConfig>) => {
    return configHelper.updateConfig(updates);
  });

  // Получение всех провайдеров с метаданными и моделями
  ipcMain.handle('get-all-providers', async () => {
    try {
      return await ProviderFactory.getAllProvidersWithDetails();
    } catch (error) {
      console.error('Error getting all providers:', error);
      return [];
    }
  });

  // Получение моделей для конкретного провайдера (с учётом ключа и baseUrl)
  ipcMain.handle('get-provider-models', async (event, provider: string, apiKey?: string, baseUrl?: string) => {
    try {
      const config: ProviderConfig = {
        apiKey: apiKey || '',
        baseUrl: baseUrl,
        defaultModels: { extraction: '', solution: '', debugging: '' }
      };
      const providerInstance = ProviderFactory.createProvider(provider as any, config);
      const models = await providerInstance.getAvailableModels();
      return models;
    } catch (error) {
      console.error(`Error getting models for provider ${provider}:`, error);
      return [];
    }
  });

  // Валидация API ключа
  ipcMain.handle("validate-api-key", async (_event, provider: string, apiKey: string) => {
    try {
      const config: ProviderConfig = {
        apiKey: apiKey,
        baseUrl: undefined, // можно передать baseUrl, если нужно
        defaultModels: { extraction: '', solution: '', debugging: '' }
      };
      const providerInstance = ProviderFactory.createProvider(provider as any, config);
      const isValid = await providerInstance.validateApiKey();
      if (isValid) {
        return { valid: true };
      } else {
        return { valid: false, error: "Invalid API key" };
      }
    } catch (error: any) {
      console.error("Error validating API key:", error);
      return { valid: false, error: error.message || "Validation failed" };
    }
  });

  // Проверка наличия валидного ключа для текущего провайдера (используется перед обработкой)
  ipcMain.handle("check-api-key-valid", async () => {
    const config = configHelper.loadConfig() as AppConfig;
    if (!config.apiProvider) return { valid: false, error: "No provider selected" };

    try {
      const providerConfig: ProviderConfig = {
        apiKey: config.apiKey || '',
        baseUrl: config.apiProvider === 'ollama' ? config.ollamaBaseUrl : undefined,
        defaultModels: {
          extraction: config.extractionModel || '',
          solution: config.solutionModel || '',
          debugging: config.debuggingModel || ''
        }
      };
      const providerInstance = ProviderFactory.createProvider(config.apiProvider as any, providerConfig);
      const isValid = await providerInstance.validateApiKey();
      return { valid: isValid };
    } catch (error: any) {
      console.error("Error checking API key validity:", error);
      return { valid: false, error: error.message };
    }
  });

  // Credits handlers (оставляем как есть, если нужны)
  ipcMain.handle("set-initial-credits", async (_event, credits: number) => {
    const mainWindow = deps.getMainWindow();
    if (!mainWindow) return;

    try {
      await mainWindow.webContents.executeJavaScript(
        `window.__CREDITS__ = ${credits}`
      );
      mainWindow.webContents.send("credits-updated", credits);
    } catch (error) {
      console.error("Error setting initial credits:", error);
      throw error;
    }
  });

  ipcMain.handle("decrement-credits", async () => {
    const mainWindow = deps.getMainWindow();
    if (!mainWindow) return;

    try {
      const currentCredits = await mainWindow.webContents.executeJavaScript(
        "window.__CREDITS__"
      );
      if (currentCredits > 0) {
        const newCredits = currentCredits - 1;
        await mainWindow.webContents.executeJavaScript(
          `window.__CREDITS__ = ${newCredits}`
        );
        mainWindow.webContents.send("credits-updated", newCredits);
      }
    } catch (error) {
      console.error("Error decrementing credits:", error);
    }
  });

  // Обработчики очередей скриншотов (без изменений)
  ipcMain.handle("get-screenshot-queue", () => {
    return deps.getScreenshotQueue();
  });

  ipcMain.handle("get-extra-screenshot-queue", () => {
    return deps.getExtraScreenshotQueue();
  });

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    return deps.deleteScreenshot(path);
  });

  ipcMain.handle("get-image-preview", async (event, path: string) => {
    return deps.getImagePreview(path);
  });

  // Обработка скриншотов (с проверкой ключа через провайдера)
  ipcMain.handle("process-screenshots", async () => {
    const mainWindow = deps.getMainWindow();
    if (!mainWindow) return;

    // Проверяем валидность ключа
    const keyCheck = await ipcMain.emit('check-api-key-valid') as any; // или вызвать напрямую функцию
    // Но emit не вернёт результат, поэтому лучше вызвать логику проверки напрямую:
    const config = configHelper.loadConfig() as AppConfig;
    if (!config.apiProvider) {
      mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
      return;
    }

    try {
      const providerConfig: ProviderConfig = {
        apiKey: config.apiKey || '',
        baseUrl: config.apiProvider === 'ollama' ? config.ollamaBaseUrl : undefined,
        defaultModels: {
          extraction: config.extractionModel || '',
          solution: config.solutionModel || '',
          debugging: config.debuggingModel || ''
        }
      };
      const providerInstance = ProviderFactory.createProvider(config.apiProvider as any, providerConfig);
      const isValid = await providerInstance.validateApiKey();
      if (!isValid) {
        mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return;
      }
    } catch (error) {
      console.error("Error validating API key before processing:", error);
      mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
      return;
    }

    await deps.processingHelper?.processScreenshots();
  });

  ipcMain.handle("trigger-process-screenshots", async () => {
    // Аналогичная проверка
    const mainWindow = deps.getMainWindow();
    if (!mainWindow) return { success: false, error: "No window" };

    const config = configHelper.loadConfig() as AppConfig;
    if (!config.apiProvider) {
      mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
      return { success: false, error: "No provider selected" };
    }

    try {
      const providerConfig: ProviderConfig = {
        apiKey: config.apiKey || '',
        baseUrl: config.apiProvider === 'ollama' ? config.ollamaBaseUrl : undefined,
        defaultModels: {
          extraction: config.extractionModel || '',
          solution: config.solutionModel || '',
          debugging: config.debuggingModel || ''
        }
      };
      const providerInstance = ProviderFactory.createProvider(config.apiProvider as any, providerConfig);
      const isValid = await providerInstance.validateApiKey();
      if (!isValid) {
        mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return { success: false, error: "Invalid API key" };
      }
    } catch (error) {
      console.error("Error validating API key:", error);
      mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
      return { success: false, error: "API key validation failed" };
    }

    await deps.processingHelper?.processScreenshots();
    return { success: true };
  });

  // Остальные обработчики (без изменений) ...
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        deps.setWindowDimensions(width, height);
      }
    }
  );

  ipcMain.handle(
    "set-window-dimensions",
    (event, width: number, height: number) => {
      deps.setWindowDimensions(width, height);
    }
  );

  ipcMain.handle("get-screenshots", async () => {
    try {
      let previews = [];
      const currentView = deps.getView();

      if (currentView === "queue") {
        const queue = deps.getScreenshotQueue();
        previews = await Promise.all(
          queue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path)
          }))
        );
      } else {
        const extraQueue = deps.getExtraScreenshotQueue();
        previews = await Promise.all(
          extraQueue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path)
          }))
        );
      }

      return previews;
    } catch (error) {
      console.error("Error getting screenshots:", error);
      throw error;
    }
  });

  ipcMain.handle("trigger-screenshot", async () => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      try {
        const screenshotPath = await deps.takeScreenshot();
        const preview = await deps.getImagePreview(screenshotPath);
        mainWindow.webContents.send("screenshot-taken", {
          path: screenshotPath,
          preview
        });
        return { success: true };
      } catch (error) {
        console.error("Error triggering screenshot:", error);
        return { error: "Failed to trigger screenshot" };
      }
    }
    return { error: "No main window available" };
  });

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await deps.takeScreenshot();
      const preview = await deps.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      console.error("Error taking screenshot:", error);
      return { error: "Failed to take screenshot" };
    }
  });

  ipcMain.handle("open-external-url", (event, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle("openLink", (event, url: string) => {
    try {
      console.log(`Opening external URL: ${url}`);
      shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error(`Error opening URL ${url}:`, error);
      return { success: false, error: `Failed to open URL: ${error}` };
    }
  });

  ipcMain.handle("open-settings-portal", () => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send("show-settings-dialog");
      return { success: true };
    }
    return { success: false, error: "Main window not available" };
  });

  ipcMain.handle("toggle-window", () => {
    try {
      deps.toggleMainWindow();
      return { success: true };
    } catch (error) {
      console.error("Error toggling window:", error);
      return { error: "Failed to toggle window" };
    }
  });

  ipcMain.handle("reset-queues", async () => {
    try {
      deps.clearQueues();
      return { success: true };
    } catch (error) {
      console.error("Error resetting queues:", error);
      return { error: "Failed to reset queues" };
    }
  });

  ipcMain.handle("trigger-reset", () => {
    try {
      deps.processingHelper?.cancelOngoingRequests();
      deps.clearQueues();
      deps.setView("queue");
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("reset-view");
        mainWindow.webContents.send("reset");
      }
      return { success: true };
    } catch (error) {
      console.error("Error triggering reset:", error);
      return { error: "Failed to trigger reset" };
    }
  });

  ipcMain.handle("trigger-move-left", () => {
    try {
      deps.moveWindowLeft();
      return { success: true };
    } catch (error) {
      console.error("Error moving window left:", error);
      return { error: "Failed to move window left" };
    }
  });

  ipcMain.handle("trigger-move-right", () => {
    try {
      deps.moveWindowRight();
      return { success: true };
    } catch (error) {
      console.error("Error moving window right:", error);
      return { error: "Failed to move window right" };
    }
  });

  ipcMain.handle("trigger-move-up", () => {
    try {
      deps.moveWindowUp();
      return { success: true };
    } catch (error) {
      console.error("Error moving window up:", error);
      return { error: "Failed to move window up" };
    }
  });

  ipcMain.handle("trigger-move-down", () => {
    try {
      deps.moveWindowDown();
      return { success: true };
    } catch (error) {
      console.error("Error moving window down:", error);
      return { error: "Failed to move window down" };
    }
  });

  ipcMain.handle("delete-last-screenshot", async () => {
    try {
      const queue = deps.getView() === "queue"
        ? deps.getScreenshotQueue()
        : deps.getExtraScreenshotQueue();

      if (queue.length === 0) {
        return { success: false, error: "No screenshots to delete" };
      }

      const lastScreenshot = queue[queue.length - 1];
      const result = await deps.deleteScreenshot(lastScreenshot);

      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screenshot-deleted", { path: lastScreenshot });
      }

      return result;
    } catch (error) {
      console.error("Error deleting last screenshot:", error);
      return { success: false, error: "Failed to delete last screenshot" };
    }
  });
}