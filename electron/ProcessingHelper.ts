// ProcessingHelper.ts
import { BrowserWindow } from 'electron';
import { IProcessingHelperDeps } from './main';
import { ScreenshotHelper } from './ScreenshotHelper';
import { configHelper } from './ConfigHelper';
import { ProviderFactory, ProviderType } from './ProviderFactory';
import { BaseProvider, Message } from './providers/BaseProvider';
import { EXTRACT_SYSTEM_PROMPT, EXTRACT_USER_PROMPT, SOLUTION_SYSTEM_PROMPT, SOLUTION_USER_PROMPT } from './prompts';
import * as axios from 'axios';

// Импортируем вынесенные функции
import { loadScreenshotsData } from './imageProcessor';
import { parseProblemInfoResponse, parseMultiTaskResponse } from './responseParser';
import { getLanguageFromWindow, waitForInitialization } from './rendererHelper';

interface AppConfig {
  apiProvider: string;
  apiKey: string;
  extractionModel: string;
  solutionModel: string;
  debuggingModel: string;
  ollamaBaseUrl?: string;
  baseUrl?: string;
  language?: string;
}

export class ProcessingHelper {
  private deps: IProcessingHelperDeps;
  private screenshotHelper: ScreenshotHelper;
  private provider: BaseProvider;
  private config: AppConfig;
  private currentProcessingAbortController: AbortController | null = null;

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps;
    this.screenshotHelper = deps.getScreenshotHelper();
    this.config = configHelper.loadConfig() as AppConfig;
    this.initializeProvider();

    configHelper.on('config-updated', (newConfig: AppConfig) => {
      this.config = newConfig;
      this.initializeProvider();
    });
  }

  private initializeProvider(): void {
    const providerConfig = {
      apiKey: this.config.apiKey || '',
      baseUrl: this.config.apiProvider === 'ollama' ? this.config.ollamaBaseUrl : this.config.baseUrl,
      defaultModels: {
        extraction: this.config.extractionModel,
        solution: this.config.solutionModel,
        debugging: this.config.debuggingModel,
      },
    };

    this.provider = ProviderFactory.createProvider(
      this.config.apiProvider as ProviderType,
      providerConfig
    );
  }

  private async validateApiKey(): Promise<boolean> {
    if (this.config.apiProvider === 'ollama') return true;
    try {
      return await this.provider.validateApiKey();
    } catch {
      return false;
    }
  }

  private async getLanguage(): Promise<string> {
    const mainWindow = this.deps.getMainWindow();
    return getLanguageFromWindow(mainWindow, this.config.language);
  }

  private async extractProblemInfo(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ): Promise<any> {
    const language = await this.getLanguage();
    const systemPrompt = EXTRACT_SYSTEM_PROMPT;
    const userPrompt = EXTRACT_USER_PROMPT(language);

    const content: any[] = [{ type: 'text', text: userPrompt }];
    for (const screenshot of screenshots) {
      content.push(this.provider.formatImageForProvider(screenshot.data));
    }

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ];

    const response = await this.provider.chat(messages, this.config.extractionModel, {
      temperature: 0.2,
      maxTokens: 16000,
    });

    return parseProblemInfoResponse(response.content);
  }

  private async generateSolutionsHelper(signal: AbortSignal): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error('No problem info available');
      }

      if (mainWindow) {
        mainWindow.webContents.send('processing-status', {
          message: 'Генерируем решения для всех задач...',
          progress: 60,
        });
      }

      const messages: Message[] = [
        { role: 'system', content: SOLUTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: SOLUTION_USER_PROMPT(
            problemInfo.problem_statement,
            problemInfo.constraints,
            problemInfo.example_input,
            problemInfo.example_output,
            language
          ),
        },
      ];

      const response = await this.provider.chat(messages, this.config.solutionModel, {
        temperature: 0.2,
        maxTokens: 16000,
      });

      const solution = parseMultiTaskResponse(response.content);
      return { success: true, data: solution };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return { success: false, error: 'Processing was canceled.' };
      }
      if (error?.response?.status === 401) {
        return { success: false, error: 'Invalid API key.' };
      }
      if (error?.response?.status === 429) {
        return { success: false, error: 'API rate limit exceeded.' };
      }
      console.error('Solution generation error:', error);
      return { success: false, error: error.message || 'Failed to generate solution' };
    }
  }

  private handleProcessingError(error: any, errorEvent: string): void {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) return;

    let errorMessage = error.message || 'Unknown error';

    if (axios.isCancel(error)) {
      errorMessage = 'Processing was canceled by the user.';
    } else if (error?.response?.status === 401) {
      errorMessage = 'Invalid API key. Please check your settings.';
    } else if (error?.response?.status === 429) {
      errorMessage = 'API rate limit exceeded. Please try again later.';
    } else if (error?.response?.status === 500) {
      errorMessage = 'Server error. Please try again later.';
    }

    console.error('Processing error:', error);
    mainWindow.webContents.send(errorEvent, errorMessage);
    mainWindow.webContents.send('processing-status', {
      message: 'Error: ' + errorMessage,
      progress: 0,
      error: true,
    });
  }

  // ==================== Публичные методы ====================

  public async processScreenshots(): Promise<void> {
    this.cancelOngoingRequests();
    this.currentProcessingAbortController = new AbortController();
    const signal = this.currentProcessingAbortController.signal;

    try {
      const mainWindow = this.deps.getMainWindow();
      if (!mainWindow) return;

      const queue = this.screenshotHelper.getScreenshotQueue();
      if (queue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      if (!(await this.validateApiKey())) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return;
      }

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);

      const screenshots = await loadScreenshotsData(queue);

      mainWindow.webContents.send('processing-status', {
        message: 'Analyzing problem from screenshots...',
        progress: 20,
      });

      const problemInfo = await this.extractProblemInfo(screenshots, signal);
      this.deps.setProblemInfo(problemInfo);

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);

      mainWindow.webContents.send('processing-status', {
        message: 'Problem analyzed successfully. Preparing to generate solution...',
        progress: 40,
      });

      const solutionResult = await this.generateSolutionsHelper(signal);

      if (solutionResult.success) {
        mainWindow.webContents.send('processing-status', {
          message: 'Solution generated successfully',
          progress: 100,
        });

        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          solutionResult.data
        );
      } else {
        throw new Error(solutionResult.error || 'Failed to generate solutions');
      }
    } catch (error: any) {
      this.handleProcessingError(error, this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR);
    } finally {
      this.currentProcessingAbortController = null;
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false;

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort();
      this.currentProcessingAbortController = null;
      wasCancelled = true;
    }

    this.deps.setProblemInfo(null);

    const mainWindow = this.deps.getMainWindow();
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
    }
  }
}