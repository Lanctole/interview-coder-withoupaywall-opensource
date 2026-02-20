// ProcessingHelper.ts
import { BrowserWindow } from 'electron';
import { IProcessingHelperDeps } from './main';
import { ScreenshotHelper } from './ScreenshotHelper';
import { configHelper } from './ConfigHelper';
import { ProviderFactory, ProviderType } from './ProviderFactory';
import { BaseProvider, Message } from './providers/BaseProvider';
import { EXTRACT_SYSTEM_PROMPT, EXTRACT_USER_PROMPT, SOLUTION_SYSTEM_PROMPT, SOLUTION_USER_PROMPT, EXTRACT_TASK_PROMPT, CODE_REVIEW_PROMPT, SOLUTION_PROMPT, VISION_EXTRACT_PROMPT} from './prompts';
import * as axios from 'axios';
import { SmartTaskExtractor } from './smartExtractor';
import {ExtractedContent } from '../shared/types';

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
  private smartExtractor: SmartTaskExtractor;

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps;
    this.screenshotHelper = deps.getScreenshotHelper();
    this.config = configHelper.loadConfig() as AppConfig;
    this.initializeProvider();
     this.smartExtractor = new SmartTaskExtractor();

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

    const content: any[] = [
      //  { type: 'text', text: EXTRACT_TASK_PROMPT(language) }
      //  { type: 'text', text: VISION_EXTRACT_PROMPT }
    ];
    for (const screenshot of screenshots) {
      content.push(this.provider.formatImageForProvider(screenshot.data));
    }

 const messages: Message[] = [
      { 
        role: 'system', 
        content: 'Ты ассистент, который точно описывает задачи по программированию. Будь конкретным и подробным. НА изображении распознай весь текст и просто передай его в свой ответ. В ответ только распознаный текст отдай и всё.' 
      },
       { role: 'user', content }
    ];

    const response = await this.provider.chat(messages, this.config.extractionModel, {
      temperature: 0.1,
      maxTokens: 4000,
    });

console.log("Ответ:",response,"Содержимое ответа",response.content)
    return this.smartExtractor.parseExtraction(response.content);
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

    /**
   * Генерация ответа на основе извлеченного контента
   */
  private async generateResponse(
    extracted: ExtractedContent,
    signal: AbortSignal
  ): Promise<any> {
    
    // Обработка смешанных задач
    if (extracted.multipleTasks && extracted.multipleTasks.length > 0) {
      const solutions = await Promise.all(
        extracted.multipleTasks.map(task => this.solveSingleTask(task, signal))
      );
      return {
        type: 'multiple',
        tasks: solutions
      };
    }
    
    // Обработка одного задания
    return this.solveSingleTask(extracted, signal);
  }
  
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
    
    // Загружаем скриншоты
    const screenshots = await loadScreenshotsData(queue);
    
    // Этап 1: Извлечение информации
    mainWindow.webContents.send('processing-status', {
      message: 'Анализирую содержимое скриншота...',
      progress: 20
    });
    
    const extracted = await this.extractProblemInfo(screenshots, signal);
    
    // ИСПРАВЛЕНО: Сохраняем ТОЛЬКО в старом формате, но с дополнительным полем
    const problemInfo = {
      problem_statement: extracted.rawText,
      constraints: extracted.codingTask?.requirements?.join('\n') || '',
      example_input: '',
      example_output: '',
      _extracted: extracted, // сохраняем extracted внутри problemInfo
      type: extracted.type
    };
    this.deps.setProblemInfo(problemInfo);
    
    // Отправляем событие с извлеченной информацией
    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED, {
      type: extracted.type,
      preview: extracted.rawText.substring(0, 200) + '...',
      fullText: extracted.rawText
    });
    
    // Этап 2: Генерация решения
    mainWindow.webContents.send('processing-status', {
      message: 'Генерирую решение...',
      progress: 50
    });
    
    console.log(extracted)
    // ИСПРАВЛЕНО: Используем problemInfo._extracted, а не отдельное хранилище
    const solution = await this.generateSolutionFromExtracted(extracted, signal);
    
    mainWindow.webContents.send('processing-status', {
      message: 'Готово!',
      progress: 100
    });
    
    // Отправляем результат
    console.log('Sending solution:', {
      type: solution.type,
      hasCode: !!solution.code,
      codeLength: solution.code?.length
    });
    
    mainWindow.webContents.send(
      this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
      solution
    );
    
  } catch (error: any) {
    console.error('Process error:', error);
    this.handleProcessingError(error, this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR);
  } finally {
    this.currentProcessingAbortController = null;
  }
}

  /**
   * Новый метод генерации решения из ExtractedContent
   */
 private async generateSolutionFromExtracted(
  extracted: ExtractedContent,
  signal: AbortSignal
): Promise<any> {
  const language = await this.getLanguage();
  const mainWindow = this.deps.getMainWindow();
  
  try {
    // Обработка смешанных задач
    if (extracted.multipleTasks && extracted.multipleTasks.length > 0) {
      if (mainWindow) {
        mainWindow.webContents.send('processing-status', {
          message: `Генерирую решения для ${extracted.multipleTasks.length} задач...`,
          progress: 60
        });
      }
      
      const solutions = await Promise.all(
        extracted.multipleTasks.map((task, index) => 
          this.solveSingleTask(task, index, signal)
        )
      );
      
      // Объединяем все решения
      const combinedCode = solutions.map(s => s.code).join('\n\n');
      const combinedThoughts = solutions.flatMap(s => s.thoughts || []);
      const combinedTime = solutions.map(s => s.time_complexity).filter(Boolean).join(', ');
      const combinedSpace = solutions.map(s => s.space_complexity).filter(Boolean).join(', ');
      
      return {
        code: combinedCode,
        thoughts: combinedThoughts,
        time_complexity: combinedTime || 'O(n)',
        space_complexity: combinedSpace || 'O(1)',
        type: 'multiple',
        tasks: solutions
      };
    }
    
    // Обработка одной задачи
    if (mainWindow) {
      mainWindow.webContents.send('processing-status', {
        message: 'Генерирую решение...',
        progress: 60
      });
    }
    
    return this.solveSingleTask(extracted, 0, signal);
  } catch (error) {
    console.error('Error in generateSolutionFromExtracted:', error);
    throw error;
  }
}
  
  /**
   * Решение одной задачи с форматированием под старый API
   */
  private async solveSingleTask(
  task: ExtractedContent,
  taskIndex: number,
  signal: AbortSignal
): Promise<any> {
  const language = task.type === 'sql_task' ? 'sql' : 'java';
  
  // Определяем промпт в зависимости от типа
  let prompt = '';
  if (task.type === 'code_review') {
    prompt = CODE_REVIEW_PROMPT(task.codeReview?.originalCode || task.rawText);
  } else {
    prompt = SOLUTION_PROMPT(task.rawText, language);
  }
  
  const messages: Message[] = [
    { 
      role: 'system', 
      content: 'Ты Senior Developer. Отвечай кратко, профессионально, только суть.' 
    },
    { role: 'user', content: prompt }
  ];
  
  const response = await this.provider.chat(messages, this.config.solutionModel, {
    temperature: 0.1,  // очень низкая температура для консистентности
    maxTokens: 2000,
  });
  
  return this.parseProfessionalResponse(response.content, task, taskIndex);
}

private parseProfessionalResponse(
  content: string,
  task: ExtractedContent,
  taskIndex: number
): any {
  // Ищем код
  const codeMatch = content.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  const code = codeMatch ? codeMatch[1].trim() : content;
  
  // Ищем сложность в последних строках
  const complexityLines = content.split('\n')
    .filter(line => line.includes('Сложность') || line.includes('O('))
    .slice(-2);
  
  const timeComplexity = complexityLines.find(l => 
    l.toLowerCase().includes('временная') || l.includes('time')
  ) || 'O(n)';
  
  const spaceComplexity = complexityLines.find(l => 
    l.toLowerCase().includes('пространственная') || l.includes('space')
  ) || 'O(1)';
  
  return {
    code,
    thoughts: [], // больше не нужны
    time_complexity: timeComplexity,
    space_complexity: spaceComplexity,
    type: task.type,
    professional: true
  };
}

  /**
   * Парсит ответ в формат, ожидаемый фронтендом
   */
  private parseSolutionResponse(
    content: string,
    task: ExtractedContent,
    taskIndex: number
  ): any {
    // Ищем код в markdown блоках
    const codeMatches = [...content.matchAll(/```(?:\w+)?\s*([\s\С]*?)```/g)];
    
    let code = '';
    if (codeMatches.length > 0) {
      code = codeMatches.map((match, i) => {
        if (task.multipleTasks) {
          return `// ========== Задача ${taskIndex + 1} ==========\n\n${match[1].trim()}`;
        }
        return match[1].trim();
      }).join('\n\n\n');
    } else {
      code = content;
    }
    
    // Извлекаем мысли/объяснения
    const thoughtsMatch = content.match(/(?:объяснение|explanation|approach|подход)[:\s]*([^]*?)(?=код|code|```|$)/i);
    const thoughts = thoughtsMatch 
      ? [thoughtsMatch[1].trim()]
      : [`Решение для задачи типа ${task.type}`];
    
    // Извлекаем сложность
    const timeMatch = content.match(/(?:временная сложность|time complexity)[:\s]*([^\n]+)/i);
    const spaceMatch = content.match(/(?:пространственная сложность|space complexity)[:\s]*([^\n]+)/i);
    
    return {
      code,
      thoughts,
      time_complexity: timeMatch ? timeMatch[1].trim() : 'O(n)',
      space_complexity: spaceMatch ? spaceMatch[1].trim() : 'O(1)',
      type: task.type,
      raw: content
    };
  }

  // Оставляем старый метод для обратной совместимости, но делаем его заглушкой
  private async generateSolutionsHelper(signal: AbortSignal): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    console.warn('generateSolutionsHelper is deprecated, using generateSolutionFromExtracted');
    const problemInfo = this.deps.getProblemInfo();
    if (problemInfo?._extracted) {
      const solution = await this.generateSolutionFromExtracted(problemInfo._extracted, signal);
      return { success: true, data: solution };
    }
    return { success: false, error: 'No extracted content' };
  }
}