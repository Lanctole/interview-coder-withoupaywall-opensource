// ProcessingHelper.ts
import fs from "node:fs"
import path from "node:path"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import * as axios from "axios"
import { app, BrowserWindow, dialog } from "electron"
import { OpenAI } from "openai"
import { configHelper } from "./ConfigHelper"
import Anthropic from '@anthropic-ai/sdk';

// Interface for Gemini API requests
interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper
  private openaiClient: OpenAI | null = null
  private geminiApiKey: string | null = null
  private anthropicClient: Anthropic | null = null
  private groqClient: OpenAI | null = null  // ✅ Groq uses OpenAI-compatible client

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    this.screenshotHelper = deps.getScreenshotHelper()

    // Initialize AI client based on config
    this.initializeAIClient();

    // Listen for config changes to re-initialize the AI client
    configHelper.on('config-updated', () => {
      this.initializeAIClient();
    });
  }

  /**
   * Initialize or reinitialize the AI client with current config
   */
  private initializeAIClient(): void {
    try {
      const config = configHelper.loadConfig();

      // Reset all clients first
      this.openaiClient = null;
      this.geminiApiKey = null;
      this.anthropicClient = null;
      this.groqClient = null;

      if (config.apiProvider === "openai") {
        if (config.apiKey) {
          this.openaiClient = new OpenAI({ 
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2
          });
          console.log("OpenAI client initialized successfully");
        } else {
          console.warn("No API key available, OpenAI client not initialized");
        }
      } else if (config.apiProvider === "gemini") {
        if (config.apiKey) {
          this.geminiApiKey = config.apiKey;
          console.log("Gemini API key set successfully");
        } else {
          console.warn("No API key available, Gemini client not initialized");
        }
      } else if (config.apiProvider === "anthropic") {
        if (config.apiKey) {
          this.anthropicClient = new Anthropic({
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2
          });
          console.log("Anthropic client initialized successfully");
        } else {
          console.warn("No API key available, Anthropic client not initialized");
        }
      } else if (config.apiProvider === "groq") {
        // ✅ Groq initialization - uses OpenAI-compatible SDK
        if (config.apiKey) {
          this.groqClient = new OpenAI({
            apiKey: config.apiKey,
            baseURL: "https://api.groq.com/openai/v1",
            timeout: 30000,  // Groq is faster, shorter timeout
            maxRetries: 2
          });
          console.log("Groq client initialized successfully");
        } else {
          console.warn("No API key available, Groq client not initialized");
        }
      }
    } catch (error) {
      console.error("Failed to initialize AI client:", error);
      this.openaiClient = null;
      this.geminiApiKey = null;
      this.anthropicClient = null;
      this.groqClient = null;
    }
  }

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
      const config = configHelper.loadConfig();
      if (config.language) {
        return config.language;
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

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    const config = configHelper.loadConfig();

    // ✅ Verify we have a valid AI client for the selected provider
    if (config.apiProvider === "openai" && !this.openaiClient) {
      this.initializeAIClient();
      if (!this.openaiClient) {
        console.error("OpenAI client not initialized");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return;
      }
    } else if (config.apiProvider === "gemini" && !this.geminiApiKey) {
      this.initializeAIClient();
      if (!this.geminiApiKey) {
        console.error("Gemini API key not initialized");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return;
      }
    } else if (config.apiProvider === "anthropic" && !this.anthropicClient) {
      this.initializeAIClient();
      if (!this.anthropicClient) {
        console.error("Anthropic client not initialized");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return;
      }
    } else if (config.apiProvider === "groq" && !this.groqClient) {
      // ✅ Check Groq client
      this.initializeAIClient();
      if (!this.groqClient) {
        console.error("Groq client not initialized");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return;
      }
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
      console.log("Processing main queue screenshots:", screenshotQueue)

      if (!screenshotQueue || screenshotQueue.length === 0) {
        console.log("No screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      const existingScreenshots = screenshotQueue.filter(path => fs.existsSync(path));
      if (existingScreenshots.length === 0) {
        console.log("Screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        this.currentProcessingAbortController = new AbortController()
        const { signal } = this.currentProcessingAbortController

        const screenshots = await Promise.all(
          existingScreenshots.map(async (path) => {
            try {
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        const validScreenshots = screenshots.filter(Boolean);

        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data");
        }

        const result = await this.processScreenshotsHelper(validScreenshots, signal)

        if (!result.success) {
          console.log("Processing failed:", result.error)
          if (result.error?.includes("API Key") || result.error?.includes("OpenAI") || 
              result.error?.includes("Gemini") || result.error?.includes("Groq")) {
            mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID)
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            )
          }
          console.log("Resetting view to queue due to error")
          this.deps.setView("queue")
          return
        }

        console.log("Setting view to solutions after successful processing")
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        )
        this.deps.setView("solutions")
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        )
        console.error("Processing error:", error)
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          )
        }
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
      } finally {
        this.currentProcessingAbortController = null
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue = this.screenshotHelper.getExtraScreenshotQueue()
      console.log("Processing extra queue screenshots:", extraScreenshotQueue)

      if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots found in queue");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      const existingExtraScreenshots = extraScreenshotQueue.filter(path => fs.existsSync(path));
      if (existingExtraScreenshots.length === 0) {
        console.log("Extra screenshot files don't exist on disk");
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

      this.currentExtraProcessingAbortController = new AbortController()
      const { signal } = this.currentExtraProcessingAbortController

      try {
        const allPaths = [
          ...this.screenshotHelper.getScreenshotQueue(),
          ...existingExtraScreenshots
        ];

        const screenshots = await Promise.all(
          allPaths.map(async (path) => {
            try {
              if (!fs.existsSync(path)) {
                console.warn(`Screenshot file does not exist: ${path}`);
                return null;
              }
              return {
                path,
                preview: await this.screenshotHelper.getImagePreview(path),
                data: fs.readFileSync(path).toString('base64')
              };
            } catch (err) {
              console.error(`Error reading screenshot ${path}:`, err);
              return null;
            }
          })
        )

        const validScreenshots = screenshots.filter(Boolean);

        if (validScreenshots.length === 0) {
          throw new Error("Failed to load screenshot data for debugging");
        }

        console.log("Combined screenshots for processing:", validScreenshots.map((s) => s.path))

        const result = await this.processExtraScreenshotsHelper(validScreenshots, signal)

        if (result.success) {
          this.deps.setHasDebugged(true)
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS, result.data)
        } else {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, result.error)
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          )
        } else {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, error.message)
        }
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const config = configHelper.loadConfig();
      const language = await this.getLanguage();
      const mainWindow = this.deps.getMainWindow();

      const imageDataList = screenshots.map(screenshot => screenshot.data);

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Analyzing problem from screenshots...",
          progress: 20
        });
      }

      let problemInfo;

      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          this.initializeAIClient();
          if (!this.openaiClient) {
            return {
              success: false,
              error: "OpenAI API key not configured or invalid. Please check your settings."
            };
          }
        }

        const messages = [
          {
            role: "system" as const, 
            content: "You are a coding challenge interpreter. Analyze the screenshot of the coding problem and extract all relevant information. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text."
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const, 
                text: `Extract the coding problem details from these screenshots. Return in JSON format. Preferred coding language we gonna use for this problem is ${language}.`
              },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        const extractionResponse = await this.openaiClient.chat.completions.create({
          model: config.extractionModel || "gpt-4o",
          messages: messages,
          max_tokens: 4000,
          temperature: 0.2
        });

        try {
          const responseText = extractionResponse.choices[0].message.content;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error) {
          console.error("Error parsing OpenAI response:", error);
          return {
            success: false,
            error: "Failed to parse problem information. Please try again or use clearer screenshots."
          };
        }
      } else if (config.apiProvider === "gemini") {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          const geminiMessages: GeminiMessage[] = [
            {
              role: "user",
              parts: [
                {
                  text: `You are a coding challenge interpreter. Analyze the screenshots of the coding problem and extract all relevant information. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text. Preferred coding language we gonna use for this problem is ${language}.`
                },
                ...imageDataList.map(data => ({
                  inlineData: {
                    mimeType: "image/png",
                    data: data
                  }
                }))
              ]
            }
          ];

          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.extractionModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;

          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }

          const responseText = responseData.candidates[0].content.parts[0].text;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error) {
          console.error("Error using Gemini API:", error);
          return {
            success: false,
            error: "Failed to process with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `Extract the coding problem details from these screenshots. Return in JSON format with these fields: problem_statement, constraints, example_input, example_output. Preferred coding language is ${language}.`
                },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: data
                  }
                }))
              ]
            }
          ];

          const response = await this.anthropicClient.messages.create({
            model: config.extractionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          const responseText = (response.content[0] as { type: 'text', text: string }).text;
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);
        } catch (error: any) {
          console.error("Error using Anthropic API:", error);
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude. Switch to OpenAI, Gemini or Groq."
            };
          }
          return {
            success: false,
            error: "Failed to process with Anthropic API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "groq") {
        // ✅ GROQ VISION PROCESSING
        if (!this.groqClient) {
          this.initializeAIClient();
          if (!this.groqClient) {
            return {
              success: false,
              error: "Groq API key not configured. Get one at console.groq.com/keys"
            };
          }
        }

        try {
          const messages = [
            {
              role: "system" as const,
              content: "You are a coding challenge interpreter. Analyze the screenshot of the coding problem and extract all relevant information. Return the information in JSON format with these fields: problem_statement, constraints, example_input, example_output. Just return the structured JSON without any other text."
            },
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `Extract the coding problem details from these screenshots. Return in JSON format. Preferred coding language we gonna use for this problem is ${language}.`
                },
                ...imageDataList.map(data => ({
                  type: "image_url" as const,
                  image_url: { 
                    url: `data:image/png;base64,${data}`,
                    detail: "high" as const  // ✅ Better quality for code screenshots
                  }
                }))
              ]
            }
          ];

          console.log("Sending request to Groq Vision API...");

          const extractionResponse = await this.groqClient.chat.completions.create({
            model: config.extractionModel || "llama-3.2-90b-vision-preview",
            messages: messages,
            max_tokens: 4000,
            temperature: 0.2
          });

          const responseText = extractionResponse.choices[0].message.content;
          console.log("Groq Vision response received, length:", responseText?.length);

          // Parse JSON from response
          const jsonText = responseText.replace(/```json|```/g, '').trim();
          problemInfo = JSON.parse(jsonText);

          console.log("Problem extracted successfully via Groq");
        } catch (error: any) {
          console.error("Error using Groq API:", error);

          // Specific error handling for Groq
          if (error.status === 401) {
            return {
              success: false,
              error: "Invalid Groq API key. Get one at console.groq.com/keys"
            };
          } else if (error.status === 429) {
            return {
              success: false,
              error: "Groq rate limit exceeded. Free tier: 30 RPM, 14400 RPD. Wait and retry."
            };
          } else if (error.status === 413 || error.message?.includes("too large")) {
            return {
              success: false,
              error: "Images too large for Groq. Try smaller screenshots or switch to Gemini."
            };
          }

          return {
            success: false,
            error: `Failed to process with Groq API: ${error.message || 'Unknown error'}`
          };
        }
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Problem analyzed successfully. Preparing to generate solution...",
          progress: 40
        });
      }

      this.deps.setProblemInfo(problemInfo);

      if (mainWindow) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          problemInfo
        );

        const solutionsResult = await this.generateSolutionsHelper(signal);
        if (solutionsResult.success) {
          this.screenshotHelper.clearExtraScreenshotQueue();

          mainWindow.webContents.send("processing-status", {
            message: "Solution generated successfully",
            progress: 100
          });

          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            solutionsResult.data
          );
          return { success: true, data: solutionsResult.data };
        } else {
          throw new Error(solutionsResult.error || "Failed to generate solutions");
        }
      }

      return { success: false, error: "Failed to process screenshots" };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return {
          success: false,
          error: "Processing was canceled by the user."
        };
      }

      if (error?.response?.status === 401) {
        return {
          success: false,
          error: "Invalid API key. Please check your settings."
        };
      } else if (error?.response?.status === 429) {
        return {
          success: false,
          error: "API rate limit exceeded. Please try again later."
        };
      } else if (error?.response?.status === 500) {
        return {
          success: false,
          error: "Server error. Please try again later."
        };
      }

      console.error("API Error Details:", error);
      return { 
        success: false, 
        error: error.message || "Failed to process screenshots. Please try again." 
      };
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Генерируем решения для всех задач...",
          progress: 60
        });
      }

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
${[language]}
[Solution - NO comments in code unless necessary if explained below]

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
`;

      let responseContent;

      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return { success: false, error: "OpenAI API key not configured." };
        }

        const solutionResponse = await this.openaiClient.chat.completions.create({
          model: config.solutionModel || "gpt-4o",
          messages: [
            {
              role: "system",
              content: "Expert coding assistant. Multi-task solver. Russian explanations."
            },
            { role: "user", content: promptText }
          ],
          max_tokens: 8000,
          temperature: 0.2
        });
        responseContent = solutionResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini") {
        if (!this.geminiApiKey) {
          return { success: false, error: "Gemini API key not configured." };
        }

        try {
          const geminiMessages = [
            {
              role: "user",
              parts: [{ text: promptText }]
            }
          ];

          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.solutionModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 8000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;
          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          responseContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for solution:", error);
          return { success: false, error: "Failed to generate solution with Gemini API." };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return { success: false, error: "Anthropic API key not configured." };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: promptText
                }
              ]
            }
          ];

          const response = await this.anthropicClient.messages.create({
            model: config.solutionModel || "claude-3-7-sonnet-20250219",
            max_tokens: 8000,
            messages: messages,
            temperature: 0.2
          });
          responseContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for solution:", error);
          if (error.status === 429) {
            return { success: false, error: "Claude API rate limit exceeded." };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return { success: false, error: "Too much information for Claude. Switch to OpenAI, Gemini or Groq." };
          }
          return { success: false, error: "Failed to generate solution with Anthropic API." };
        }
      } else if (config.apiProvider === "groq") {
        // ✅ GROQ SOLUTION GENERATION
        if (!this.groqClient) {
          return { success: false, error: "Groq API key not configured. Get one at console.groq.com/keys" };
        }

        try {
          console.log("Generating solution with Groq...");

          const solutionResponse = await this.groqClient.chat.completions.create({
            model: config.solutionModel || "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content: "Expert coding assistant. Multi-task solver. Russian explanations."
              },
              { role: "user", content: promptText }
            ],
            max_tokens: 8000,
            temperature: 0.2
          });

          responseContent = solutionResponse.choices[0].message.content;
          console.log("Groq solution generated, length:", responseContent?.length);
        } catch (error: any) {
          console.error("Error using Groq API for solution:", error);
          if (error.status === 429) {
            return { success: false, error: "Groq rate limit exceeded. Wait and retry." };
          }
          return { success: false, error: `Failed to generate solution with Groq API: ${error.message}` };
        }
      }

      const solution = this.parseMultiTaskResponse(responseContent!);
      return { success: true, data: solution };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        return { success: false, error: "Processing was canceled." };
      }
      if (error?.response?.status === 401) {
        return { success: false, error: "Invalid API key." };
      } else if (error?.response?.status === 429) {
        return { success: false, error: "API rate limit exceeded." };
      }
      console.error("Solution generation error:", error);
      return { success: false, error: error.message || "Failed to generate solution" };
    }
  }

  // ✅ Parse multi-task response
  private parseMultiTaskResponse(responseContent: string) {
    console.log("📄 Parsing multi-task response...");

    const codeMatches = [...responseContent.matchAll(/```(?:\w+)?\s*([\s\S]*?)```/g)];

    const code = codeMatches.length > 1
      ? codeMatches.map((match, i) => {
          const taskTitle = `Задача ${i + 1}`;
          return `// ========== ${taskTitle} ==========\n\n${match[1].trim()}`;
        }).join('\n\n\n')
      : (codeMatches.length === 1 ? `// ========== Задача 1 ==========\n\n${codeMatches[0][1].trim()}` : responseContent);

    console.log("✅ Code extracted, length:", code.length);

    const thoughtsPattern = /(?:Размышления|Thoughts):?\s*([\s\S]*?)(?=###|##|Временная|Time complexity|$)/gi;
    const allThoughts = [...responseContent.matchAll(thoughtsPattern)];
    const thoughts: string[] = [];

    console.log(`🧠 Found ${allThoughts.length} thought section(s)`);

    allThoughts.forEach((match, taskIndex) => {
      if (match) {
        const thoughtsText = match[1];
        const bulletPoints = thoughtsText.match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g);
        if (bulletPoints) {
          if (allThoughts.length > 1) {
            thoughts.push(`**Задача ${taskIndex + 1}:**`);
          }
          bulletPoints.forEach(point => {
            thoughts.push(point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim());
          });
        } else {
          const lines = thoughtsText.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            if (allThoughts.length > 1) {
              thoughts.push(`**Задача ${taskIndex + 1}:**`);
            }
            thoughts.push(...lines);
          }
        }
      }
    });

    const timeComplexityPattern = /(?:Временная сложность|Time complexity):?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Пространственная|Space complexity|###|##|---|$))/gi;
    const spaceComplexityPattern = /(?:Пространственная сложность|Space complexity):?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:###|##|---|Задача|$))/gi;

    const timeComplexities = [...responseContent.matchAll(timeComplexityPattern)];
    const spaceComplexities = [...responseContent.matchAll(spaceComplexityPattern)];

    console.log(`⏱️ Found ${timeComplexities.length} time complexity section(s)`);
    console.log(`💾 Found ${spaceComplexities.length} space complexity section(s)`);

    const timeComplexity = timeComplexities.length > 1
      ? timeComplexities.map((m, i) => `**Задача ${i + 1}:** ${m[1].trim()}`).join('\n\n')
      : (timeComplexities.length === 1 ? `**Задача 1:** ${timeComplexities[0][1].trim()}` : "O(n) - Линейная сложность");

    const spaceComplexity = spaceComplexities.length > 1
      ? spaceComplexities.map((m, i) => `**Задача ${i + 1}:** ${m[1].trim()}`).join('\n\n')
      : (spaceComplexities.length === 1 ? `**Задача 1:** ${spaceComplexities[0][1].trim()}` : "O(1) - Константная память");

    return {
      code,
      thoughts: thoughts.length > 0 ? thoughts : ["Решение оптимизировано для читаемости и эффективности"],
      time_complexity: timeComplexity,
      space_complexity: spaceComplexity
    };
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      const language = await this.getLanguage();
      const config = configHelper.loadConfig();
      const mainWindow = this.deps.getMainWindow();

      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Processing debug screenshots...",
          progress: 30
        });
      }

      const imageDataList = screenshots.map(screenshot => screenshot.data);

      let debugContent;

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

If you include code examples, use proper markdown code blocks with language specification (e.g. java).`;

      const debugUserPrompt = `I'm solving this coding problem: "${problemInfo.problem_statement}" in ${language}. I need help with debugging or improving my solution. Here are screenshots of my code, the errors or test cases. Please provide a detailed analysis with:
1. What issues you found in my code
2. Specific improvements and corrections
3. Any optimizations that would make the solution better
4. A clear explanation of the changes needed`;

      if (config.apiProvider === "openai") {
        if (!this.openaiClient) {
          return {
            success: false,
            error: "OpenAI API key not configured. Please check your settings."
          };
        }

        const messages = [
          { role: "system" as const, content: debugSystemPrompt },
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: debugUserPrompt },
              ...imageDataList.map(data => ({
                type: "image_url" as const,
                image_url: { url: `data:image/png;base64,${data}` }
              }))
            ]
          }
        ];

        if (mainWindow) {
          mainWindow.webContents.send("processing-status", {
            message: "Analyzing code and generating debug feedback...",
            progress: 60
          });
        }

        const debugResponse = await this.openaiClient.chat.completions.create({
          model: config.debuggingModel || "gpt-4o",
          messages: messages,
          max_tokens: 4000,
          temperature: 0.2
        });

        debugContent = debugResponse.choices[0].message.content;
      } else if (config.apiProvider === "gemini") {
        if (!this.geminiApiKey) {
          return {
            success: false,
            error: "Gemini API key not configured. Please check your settings."
          };
        }

        try {
          const geminiMessages = [
            {
              role: "user",
              parts: [
                { text: `${debugSystemPrompt}\n\n${debugUserPrompt}` },
                ...imageDataList.map(data => ({
                  inlineData: {
                    mimeType: "image/png",
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Gemini...",
              progress: 60
            });
          }

          const response = await axios.default.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${config.debuggingModel || "gemini-2.0-flash"}:generateContent?key=${this.geminiApiKey}`,
            {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000
              }
            },
            { signal }
          );

          const responseData = response.data as GeminiResponse;

          if (!responseData.candidates || responseData.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }

          debugContent = responseData.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error("Error using Gemini API for debugging:", error);
          return {
            success: false,
            error: "Failed to process debug request with Gemini API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "anthropic") {
        if (!this.anthropicClient) {
          return {
            success: false,
            error: "Anthropic API key not configured. Please check your settings."
          };
        }

        try {
          const messages = [
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: `${debugSystemPrompt}\n\n${debugUserPrompt}` },
                ...imageDataList.map(data => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const, 
                    data: data
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Claude...",
              progress: 60
            });
          }

          const response = await this.anthropicClient.messages.create({
            model: config.debuggingModel || "claude-3-7-sonnet-20250219",
            max_tokens: 4000,
            messages: messages,
            temperature: 0.2
          });

          debugContent = (response.content[0] as { type: 'text', text: string }).text;
        } catch (error: any) {
          console.error("Error using Anthropic API for debugging:", error);
          if (error.status === 429) {
            return {
              success: false,
              error: "Claude API rate limit exceeded. Please wait a few minutes before trying again."
            };
          } else if (error.status === 413 || (error.message && error.message.includes("token"))) {
            return {
              success: false,
              error: "Your screenshots contain too much information for Claude. Switch to OpenAI, Gemini or Groq."
            };
          }
          return {
            success: false,
            error: "Failed to process debug request with Anthropic API. Please check your API key or try again later."
          };
        }
      } else if (config.apiProvider === "groq") {
        // ✅ GROQ DEBUG PROCESSING
        if (!this.groqClient) {
          return {
            success: false,
            error: "Groq API key not configured. Get one at console.groq.com/keys"
          };
        }

        try {
          const messages = [
            { role: "system" as const, content: debugSystemPrompt },
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: debugUserPrompt },
                ...imageDataList.map(data => ({
                  type: "image_url" as const,
                  image_url: { 
                    url: `data:image/png;base64,${data}`,
                    detail: "high" as const
                  }
                }))
              ]
            }
          ];

          if (mainWindow) {
            mainWindow.webContents.send("processing-status", {
              message: "Analyzing code and generating debug feedback with Groq...",
              progress: 60
            });
          }

          console.log("Sending debug request to Groq Vision API...");

          const debugResponse = await this.groqClient.chat.completions.create({
            model: config.debuggingModel || "llama-3.2-90b-vision-preview",
            messages: messages,
            max_tokens: 4000,
            temperature: 0.2
          });

          debugContent = debugResponse.choices[0].message.content;
          console.log("Groq debug response received, length:", debugContent?.length);
        } catch (error: any) {
          console.error("Error using Groq API for debugging:", error);
          if (error.status === 429) {
            return {
              success: false,
              error: "Groq rate limit exceeded. Wait and retry."
            };
          }
          return {
            success: false,
            error: `Failed to process debug request with Groq API: ${error.message}`
          };
        }
      }

      if (mainWindow) {
        mainWindow.webContents.send("processing-status", {
          message: "Debug analysis complete",
          progress: 100
        });
      }

      let extractedCode = "// Debug mode - see analysis below";
      const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        extractedCode = codeMatch[1].trim();
      }

      let formattedDebugContent = debugContent;

      if (!debugContent.includes('# ') && !debugContent.includes('## ')) {
        formattedDebugContent = debugContent
          .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
          .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
          .replace(/optimizations|performance improvements/i, '## Optimizations')
          .replace(/explanation|detailed analysis/i, '## Explanation');
      }

      const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
      const thoughts = bulletPoints 
        ? bulletPoints.map(point => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim()).slice(0, 5)
        : ["Debug analysis based on your screenshots"];

      const response = {
        code: extractedCode,
        debug_analysis: formattedDebugContent,
        thoughts: thoughts,
        time_complexity: "N/A - Debug mode",
        space_complexity: "N/A - Debug mode"
      };

      return { success: true, data: response };
    } catch (error: any) {
      console.error("Debug processing error:", error);
      return { success: false, error: error.message || "Failed to process debug request" };
    }
  }

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
}
