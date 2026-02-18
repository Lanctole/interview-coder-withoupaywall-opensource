// electron/ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { configHelper } from "./ConfigHelper"
import { ProviderFactory, ProviderType } from './ProviderFactory';
import { BaseProvider, Message } from './providers/BaseProvider';

// Тип для конфигурации приложения (должен совпадать с используемым)
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
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private provider: BaseProvider;
  private config: AppConfig;

  // AbortControllers для отмены запросов
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()
    this.config = configHelper.loadConfig() as AppConfig

    // Инициализируем провайдера согласно конфигу
    this.initializeProvider()

    // Слушаем изменения конфига
    configHelper.on('config-updated', (newConfig: AppConfig) => {
      this.config = newConfig
      this.initializeProvider()
    })
  }

  /**
   * Создаёт или обновляет экземпляр провайдера на основе текущей конфигурации
   */
  private initializeProvider(): void {
    const providerConfig = {
      apiKey: this.config.apiKey || '',
      baseUrl: this.config.apiProvider === 'ollama' ? this.config.ollamaBaseUrl : this.config.baseUrl,
      defaultModels: {
        extraction: this.config.extractionModel,
        solution: this.config.solutionModel,
        debugging: this.config.debuggingModel,
      }
    }

    this.provider = ProviderFactory.createProvider(
      this.config.apiProvider as ProviderType,
      providerConfig
    )
  }

  /**
   * Ожидание инициализации рендерера (для получения credits и языка)
   */
  private async waitForInitialization(mainWindow: BrowserWindow): Promise<void> {
    let attempts = 0
    const maxAttempts = 50

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getCredits(): Promise<number> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return 999

    try {
      await this.waitForInitialization(mainWindow)
      return 999
    } catch (error) {
      console.error("Error getting credits:", error)
      return 999
    }
  }

  private async getLanguage(): Promise<string> {
    try {
      if (this.config.language) {
        return this.config.language
      }

      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )
          if (typeof language === "string" && language !== undefined && language !== null) {
            return language;
          }
        } catch (err) {
          console.warn("Could not get language from window", err);
        }
      }
      return "python";
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  // ==================== Публичные методы ====================

  /**
   * Основной метод обработки скриншотов (извлечение задачи + генерация решения)
   */
  public async processScreenshots(): Promise<void> {
    // Создаём новый AbortController для этого процесса
    this.cancelOngoingRequests() // отменяем предыдущие, если есть
    this.currentProcessingAbortController = new AbortController()
    const signal = this.currentProcessingAbortController.signal

    try {
      const mainWindow = this.deps.getMainWindow()
      if (!mainWindow) return

      // Получаем текущую очередь скриншотов
      const queue = this.screenshotHelper.getScreenshotQueue()
      if (queue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      // Проверяем API ключ (если требуется)
      if (!await this.validateApiKey()) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID)
        return
      }

      // Отправляем событие начала
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)

      // Преобразуем пути в base64 данные
      const screenshots = await this.loadScreenshotsData(queue)

      // Этап 1: Извлечение задачи
      mainWindow.webContents.send("processing-status", {
        message: "Analyzing problem from screenshots...",
        progress: 20
      })

      const problemInfo = await this.extractProblemInfo(screenshots, signal)
      console.log(problemInfo)
      // Сохраняем извлечённую информацию
      this.deps.setProblemInfo(problemInfo)

      mainWindow.webContents.send(
        this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        problemInfo
      )

      mainWindow.webContents.send("processing-status", {
        message: "Problem analyzed successfully. Preparing to generate solution...",
        progress: 40
      })

      // Этап 2: Генерация решения
      const solutionResult = await this.generateSolutionsHelper(signal)

      if (solutionResult.success) {
        // Очищаем очередь дополнительных скриншотов (если были)
        this.screenshotHelper.clearExtraScreenshotQueue()

        mainWindow.webContents.send("processing-status", {
          message: "Solution generated successfully",
          progress: 100
        })

        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          solutionResult.data
        )
      } else {
        throw new Error(solutionResult.error || "Failed to generate solutions")
      }
    } catch (error: any) {
      this.handleProcessingError(error, this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR)
    } finally {
      this.currentProcessingAbortController = null
    }
  }

  /**
   * Обработка дополнительных скриншотов (режим дебага)
   */
  public async processExtraScreenshots(): Promise<void> {
    this.cancelOngoingRequests()
    this.currentExtraProcessingAbortController = new AbortController()
    const signal = this.currentExtraProcessingAbortController.signal

    try {
      const mainWindow = this.deps.getMainWindow()
      if (!mainWindow) return

      const extraQueue = this.screenshotHelper.getExtraScreenshotQueue()
      if (extraQueue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      if (!await this.validateApiKey()) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID)
        return
      }

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      const screenshots = await this.loadScreenshotsData(extraQueue)

      const debugResult = await this.processDebugHelper(screenshots, signal)

      if (debugResult.success) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
          debugResult.data
        )
      } else {
        throw new Error(debugResult.error || "Debug failed")
      }
    } catch (error: any) {
      this.handleProcessingError(error, this.deps.PROCESSING_EVENTS.DEBUG_ERROR)
    } finally {
      this.currentExtraProcessingAbortController = null
    }
  }

  /**
   * Отмена всех текущих запросов
   */
  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)
    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }

  // ==================== Приватные вспомогательные методы ====================

  /**
   * Загружает изображения из файлов и возвращает массив с base64 данными
   */
  private async loadScreenshotsData(paths: string[]): Promise<Array<{ path: string; data: string }>> {
    const screenshots: Array<{ path: string; data: string }> = []
    for (const screenshotPath of paths) {
      try {
        const imageBuffer = fs.readFileSync(screenshotPath)
        const base64Data = imageBuffer.toString('base64')
        screenshots.push({ path: screenshotPath, data: base64Data })
      } catch (error) {
        console.error(`Failed to read screenshot ${screenshotPath}:`, error)
      }
    }
    return screenshots
  }

  /**
   * Валидация API ключа (если провайдер его требует)
   */
  private async validateApiKey(): Promise<boolean> {
    // Если провайдер не требует ключ (Ollama), считаем валидным
    if (this.config.apiProvider === 'ollama') {
      return true
    }
    // Иначе проверяем через провайдера
    try {
      return await this.provider.validateApiKey()
    } catch {
      return false
    }
  }

  /**
   * Извлечение задачи из скриншотов
   */
    /**
   * Извлечение задачи из скриншотов
   */
  private async extractProblemInfo(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ): Promise<any> {
    const language = await this.getLanguage()
 const systemPrompt = `You are a coding challenge interpreter. Your task is to analyze screenshots and extract information in STRICT JSON format.

CRITICAL: Return ONLY valid JSON without any markdown formatting, code blocks, or explanatory text.

Required JSON structure:
{
  "problem_statement": "full problem description here",
  "constraints": "any constraints mentioned",
  "example_input": "example input if provided",
  "example_output": "example output if provided"
}

Rules:
- Return ONLY the JSON object
- No markdown (no \`\`\`json)
- No explanatory text before or after
- Use empty string "" if field not found
- Ensure valid JSON syntax`
    const userPrompt = `Extract the coding problem details from these screenshots. Return in JSON format. Preferred coding language we gonna use for this problem is ${language}.`

    const content: any[] = [{ type: "text", text: userPrompt }]
    for (const screenshot of screenshots) {
      content.push(this.provider.formatImageForProvider(screenshot.data))
    }

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content }
    ]

    console.log(`[extractProblemInfo] Sending request to model: ${this.config.extractionModel}`);
console.log(`[extractProblemInfo] Number of messages: ${messages.length}`);
const startTime = Date.now();
const response = await this.provider.chat(messages, this.config.extractionModel, {
  temperature: 0.2,
  maxTokens: 4000,
});
const elapsed = Date.now() - startTime;
console.log(`[extractProblemInfo] Response received in ${elapsed} ms`);
console.log(`[extractProblemInfo] Response content length: ${response?.content?.length}`);
if (response?.content) {
  console.log(`[extractProblemInfo] First 200 chars: ${response.content.substring(0, 200)}`);
} else {
  console.error(`[extractProblemInfo] Response content is empty or undefined`);
}

    // Улучшенная обработка JSON с fallback
        console.log("Raw extraction response:", response.content)
    
    return this.parseProblemInfoResponse(response.content)
  }

  /**
   * Парсинг ответа с извлечением задачи (с обработкой ошибок)
   */
  private parseProblemInfoResponse(content: string): any {
    // Очищаем от markdown code blocks
    let cleaned = content.replace(/```json|```/g, '').trim()
    
    // Пытаемся найти JSON в ответе (модель может обернуть его в текст)
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    try {
      console.log(cleaned)
      return JSON.parse(cleaned)
    } catch (parseError) {
      console.warn("Failed to parse JSON response, using fallback extraction:", cleaned)
      
      // Fallback: создаем структуру из всего ответа как problem_statement
      return {
        problem_statement: cleaned,
        constraints: "No specific constraints extracted",
        example_input: "Not extracted",
        example_output: "Not extracted",
        _raw_response: content, // Сохраняем оригинал для дебага
        _parse_error: true
      }
    }
  }

  /**
   * Генерация решения на основе извлечённой задачи
   */
  private async generateSolutionsHelper(signal: AbortSignal): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const problemInfo = this.deps.getProblemInfo()
      const language = await this.getLanguage()
      const mainWindow = this.deps.getMainWindow()

      if (!problemInfo) {
        throw new Error("No problem info available")
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Генерируем решения для всех задач...",
          progress: 60
        })
      }

      // Формируем промпт (скопирован из оригинального кода)
      const promptText = `
You are an expert coding interview assistant. Analyze ALL problems in the text and provide complete solutions for EACH ONE.

FULL TEXT WITH ALL TASKS:
${problemInfo.problem_statement}

CONSTRAINTS (if any):
${problemInfo.constraints || "No specific constraints provided."}

EXAMPLES (if any):
${problemInfo.example_input || "No example input provided."}

EXAMPLE OUTPUT:
${problemInfo.example_output || "No example output provided."}

CRITICAL REQUIREMENTS:

1. AUTO-DETECT TASKS:
   - If text contains "Task 1", "Task 2", etc - solve EACH task separately
   - If text contains "Problem 1", "Problem 2", etc - solve EACH problem separately
   - Write code for each task

2. LANGUAGE AUTO-DETECTION:
   - SQL: SELECT, JOIN, WHERE, table, database, Column Name, SQL Schema
   - Java: class, public static, List, ArrayList, import (default)
   LANGUAGE AUTO-DETECTION WITH CONTEXT
   - **SQL/PostgreSQL** if keywords present: SELECT, JOIN, WHERE, table, database, "Column Name", "SQL Schema"
   - **Java** if keywords: class, public static, List, ArrayList, import
   - **Default to Java** if unclear

   ⚠️ IMPORTANT FOR JAVA:
   - If task mentions "поток" (stream), "генерирующий" (generating), "сортирующий" (sorting) → USE Java Stream API
   - DO NOT use Arrays.sort() or loops when Stream API is more appropriate
   - Examples of Stream API keywords: IntStream, Stream, .filter(), .map(), .sorted(), .collect()
   - Use ThreadLocalRandom instead of Random for thread safety

3. OUTPUT FORMAT FOR EACH TASK:
---
## Задача N: [Title]

### Код
${'```' + language}
[Solution - NO comments in code unless necessary if explained below]
${'```'}

**Key Insights:**
- Insight 1 in RUSSIAN
- Insight 2 in RUSSIAN

### Размышления
- [Insight 1 in RUSSIAN]
- [Insight 2 in RUSSIAN]

### Временная сложность
O(X) - [1-2 sentences in RUSSIAN explaining why]

### Пространственная сложность
O(X) - [1-2 sentences in RUSSIAN explaining why]
---

RULES:
- All explanations = RUSSIAN ONLY
- Code = detected language (Java/SQL/etc)
- Clean, production-ready
- Use modern APIs Stream API for Java
- Clean code, no inline comments
- Handle edge cases
- For Java tasks about "streams/потоки" → ALWAYS use Stream API
- For sorting/filtering → prefer functional style over imperative только если это не противоречит условию задачи

4. **INTELLIGENT MODE DETECTION**:
   - If text contains ANY explanation keywords ("ревью", "исправить", "улучшить", "объясни", "поясни", "как работает", "найди ошибку", "исправь ошибку", "ошибка в коде", "оптимизируй", "улучшить производительность", "ускорить") → perform solution or bug fixing
   - If text contains ONLY code or task is not clear (no explanation keywords found) → 
     **PERFORM CODE REFACTORING AND IMPROVEMENTS**
     - Analyze code quality
     - Apply best practices
     - Optimize algorithms
     - Improve readability and structure
     - Remove redundancy
     - Optimize performance
     - Apply proper naming conventions

5. INTENT AUTO-DETECTION (BEHAVIOR BASED ON INPUT TYPE):
   - IF input is ONLY CODE (or mostly code) WITHOUT clear instructions/tasks:
     - ACT as a Senior Developer.
     - PERFORM deep code review and REFACTORING by default.
     - FIX all anti-patterns (N+1, transactional issues, thread-safety, etc.).
     - OUTPUT the refactored version as the "Solution".
   
   - IF text contains keywords: "ревью", "исправить", "улучшить", "найди ошибку", "оптимизируй":
     - PERFORM code review + refactoring.
     
   - IF text contains clear algorithmic tasks:
     - SOLVE them as stated.
`

      const messages: Message[] = [
        { role: "system", content: "Expert coding assistant. Multi-task solver. Russian explanations." },
        { role: "user", content: promptText }
      ]

      const response = await this.provider.chat(messages, this.config.solutionModel, {
        temperature: 0.2,
        maxTokens: 8000,
        // signal
      })

      const solution = this.parseMultiTaskResponse(response.content)
      return { success: true, data: solution }
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return { success: false, error: "Processing was canceled." }
      }
      if (error?.response?.status === 401) {
        return { success: false, error: "Invalid API key." }
      } else if (error?.response?.status === 429) {
        return { success: false, error: "API rate limit exceeded." }
      }
      console.error("Solution generation error:", error)
      return { success: false, error: error.message || "Failed to generate solution" }
    }
  }

  /**
   * Обработка дебаг-режима
   */
  private async processDebugHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const problemInfo = this.deps.getProblemInfo()
      const language = await this.getLanguage()
      const mainWindow = this.deps.getMainWindow()

      if (!problemInfo) {
        throw new Error("No problem info available")
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        })
      }

      const debugSystemPrompt = `You are a coding interview assistant helping debug and improve solutions. Analyze these screenshots which include either error messages, incorrect outputs, or test cases, and provide detailed debugging help.

Your response MUST follow this exact structure with these section headers (use ### for headers):
### Issues Identified
- List each issue as a bullet point with clear explanation

### Specific Improvements and Corrections
- List specific code changes needed as bullet points

### Optimizations
- List any performance optimizations if applicable

### Explanation of Changes Needed
Here provide a clear explanation of why the changes are needed

### Key Points
- Summary bullet points of the most important takeaways

If you include code examples, use proper markdown code blocks with language specification (e.g. java).`

      const debugUserPrompt = `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. Here are screenshots of my code, the errors or test cases. Please provide a detailed analysis with:
1. What issues you found in my code
2. Specific improvements and corrections
3. Any optimizations that would make the solution better
4. A clear explanation of the changes needed`

      const content: any[] = [{ type: "text", text: debugUserPrompt }]
      for (const screenshot of screenshots) {
        content.push(this.provider.formatImageForProvider(screenshot.data))
      }

      const messages: Message[] = [
        { role: "system", content: debugSystemPrompt },
        { role: "user", content }
      ]

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing code and generating debug feedback...",
          progress: 60
        })
      }

      const response = await this.provider.chat(messages, this.config.debuggingModel, {
        temperature: 0.2,
        maxTokens: 4000,
        // signal
      })

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        })
      }

      // Парсим ответ (логика из оригинального кода)
      let extractedCode = "// Debug mode - see analysis below"
      const codeMatch = response.content.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/)
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim()
      }

      let formattedDebugContent = response.content

      if (!formattedDebugContent.includes('# ') && !formattedDebugContent.includes('## ')) {
        formattedDebugContent = formattedDebugContent
          .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
          .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
          .replace(/optimizations|performance improvements/i, '## Optimizations')
          .replace(/explanation|detailed analysis/i, '## Explanation')
      }

      const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g)
      const thoughts = bulletPoints 
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"]

      const result = {
        code: extractedCode,
        debug_analysis: formattedDebugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      }

      return { success: true, data: result }
    } catch (error: any) {
      console.error("Debug processing error:", error)
      return { success: false, error: error.message || "Failed to process debug request" }
    }
  }

  /**
   * Парсинг мультизадачного ответа (из оригинального кода)
   */
  private parseMultiTaskResponse(responseContent: string) {
    console.log("📄 Parsing multi-task response...")

    const codeMatches = [...responseContent.matchAll(/```(?:\w+)?\s*([\s\S]*?)```/g)]

    const code = codeMatches.length > 1
      ? codeMatches.map((match, i) => {
          const taskTitle = `Задача ${i + 1}`
          return `// ========== ${taskTitle} ==========\n\n${match[1].trim()}`
        }).join('\n\n\n')
      : (codeMatches.length === 1 ? `// ========== Задача 1 ==========\n\n${codeMatches[0][1].trim()}` : responseContent)

    console.log("✅ Code extracted, length:", code.length)

    const thoughtsPattern = /(?:Размышления|Thoughts):?\s*([\s\S]*?)(?=###|##|Временная|Time complexity|$)/gi
    const allThoughts = [...responseContent.matchAll(thoughtsPattern)]
    const thoughts: string[] = []

    console.log(`🧠 Found ${allThoughts.length} thought section(s)`)

    allThoughts.forEach((match, taskIndex) => {
      if (match) {
        const thoughtsText = match[1]
        const bulletPoints = thoughtsText.match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g)
        if (bulletPoints) {
          if (allThoughts.length > 1) {
            thoughts.push(`**Задача ${taskIndex + 1}:**`)
          }
          bulletPoints.forEach(point => {
            thoughts.push(point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim())
          })
        } else {
          const lines = thoughtsText.split('\n').map(l => l.trim()).filter(Boolean)
          if (lines.length > 0) {
            if (allThoughts.length > 1) {
              thoughts.push(`**Задача ${taskIndex + 1}:**`)
            }
            thoughts.push(...lines)
          }
        }
      }
    })

    const timeComplexityPattern = /(?:Временная сложность|Time complexity):?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Пространственная|Space complexity|###|##|---|$))/gi
    const spaceComplexityPattern = /(?:Пространственная сложность|Space complexity):?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:###|##|---|Задача|$))/gi

    const timeComplexities = [...responseContent.matchAll(timeComplexityPattern)]
    const spaceComplexities = [...responseContent.matchAll(spaceComplexityPattern)]

    console.log(`⏱️ Found ${timeComplexities.length} time complexity section(s)`)
    console.log(`💾 Found ${spaceComplexities.length} space complexity section(s)`)

    const timeComplexity = timeComplexities.length > 1
      ? timeComplexities.map((m, i) => `**Задача ${i + 1}:** ${m[1].trim()}`).join('\n\n')
      : (timeComplexities.length === 1 ? `**Задача 1:** ${timeComplexities[0][1].trim()}` : "O(n) - Линейная сложность")

    const spaceComplexity = spaceComplexities.length > 1
      ? spaceComplexities.map((m, i) => `**Задача ${i + 1}:** ${m[1].trim()}`).join('\n\n')
      : (spaceComplexities.length === 1 ? `**Задача 1:** ${spaceComplexities[0][1].trim()}` : "O(1) - Константная память")

    return {
      code,
      thoughts: thoughts.length > 0 ? thoughts : ["Решение оптимизировано для читаемости и эффективности"],
      time_complexity: timeComplexity,
      space_complexity: spaceComplexity
    }
  }

  /**
   * Централизованная обработка ошибок и отправка событий
   */
  private handleProcessingError(error: any, errorEvent: string): void {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    let errorMessage = error.message || "Unknown error"

    if (axios.isCancel(error)) {
      errorMessage = "Processing was canceled by the user."
    } else if (error?.response?.status === 401) {
      errorMessage = "Invalid API key. Please check your settings."
    } else if (error?.response?.status === 429) {
      errorMessage = "API rate limit exceeded. Please try again later."
    } else if (error?.response?.status === 500) {
      errorMessage = "Server error. Please try again later."
    }

    console.error("Processing error:", error)
    mainWindow.webContents.send(errorEvent, errorMessage)
    mainWindow.webContents.send("processing-status", {
      message: "Error: " + errorMessage,
      progress: 0,
      error: true
    })
  }
}