import { app, BrowserWindow, screen, shell, ipcMain, Display } from "electron"
import path from "path"
import fs from "fs"
import { initializeIpcHandlers } from "./ipcHandlers"
import { ProcessingHelper } from "./ProcessingHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { ShortcutsHelper } from "./shortcuts"
import { initAutoUpdater } from "./autoUpdater"
import { configHelper } from "./ConfigHelper"
import * as dotenv from "dotenv"

// ============================================================================
// HIGH DPI SUPPORT - КРИТИЧНО для 2K/4K мониторов
// ============================================================================
app.commandLine.appendSwitch('high-dpi-support', '1')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

// Constants
const isDev = process.env.NODE_ENV === "development"

// Application State
const state = {
  // Window management properties
  mainWindow: null as BrowserWindow | null,
  isWindowVisible: false,
  windowPosition: null as { x: number; y: number } | null,
  windowSize: null as { width: number; height: number } | null,
  screenWidth: 0,
  screenHeight: 0,
  step: 0,
  currentX: 0,
  currentY: 0,

  // Отслеживание scale factor для поддержки High DPI
  currentScaleFactor: 1.0,
  currentDisplay: null as Display | null,

  // Application helpers
  screenshotHelper: null as ScreenshotHelper | null,
  shortcutsHelper: null as ShortcutsHelper | null,
  processingHelper: null as ProcessingHelper | null,

  // View and state management
  view: "queue" as "queue" | "solutions" | "debug",
  problemInfo: null as any,
  hasDebugged: false,

  // Processing events
  PROCESSING_EVENTS: {
    UNAUTHORIZED: "processing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",
    OUT_OF_CREDITS: "out-of-credits",
    API_KEY_INVALID: "api-key-invalid",
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const
}

// Add interfaces for helper classes
export interface IProcessingHelperDeps {
  getScreenshotHelper: () => ScreenshotHelper | null
  getMainWindow: () => BrowserWindow | null
  getView: () => "queue" | "solutions" | "debug"
  setView: (view: "queue" | "solutions" | "debug") => void
  getProblemInfo: () => any
  setProblemInfo: (info: any) => void
  getScreenshotQueue: () => string[]
  getExtraScreenshotQueue: () => string[]
  clearQueues: () => void
  takeScreenshot: () => Promise<string>
  getImagePreview: (filepath: string) => Promise<string>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  setHasDebugged: (value: boolean) => void
  getHasDebugged: () => boolean
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS
}

export interface IShortcutsHelperDeps {
  getMainWindow: () => BrowserWindow | null
  takeScreenshot: () => Promise<string>
  getImagePreview: (filepath: string) => Promise<string>
  processingHelper: ProcessingHelper | null
  clearQueues: () => void
  setView: (view: "queue" | "solutions" | "debug") => void
  isVisible: () => boolean
  toggleMainWindow: () => void
  moveWindowLeft: () => void
  moveWindowRight: () => void
  moveWindowUp: () => void
  moveWindowDown: () => void
}

export interface IIpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null
  setWindowDimensions: (width: number, height: number) => void
  getScreenshotQueue: () => string[]
  getExtraScreenshotQueue: () => string[]
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  getImagePreview: (filepath: string) => Promise<string>
  processingHelper: ProcessingHelper | null
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS
  takeScreenshot: () => Promise<string>
  getView: () => "queue" | "solutions" | "debug"
  toggleMainWindow: () => void
  clearQueues: () => void
  setView: (view: "queue" | "solutions" | "debug") => void
  moveWindowLeft: () => void
  moveWindowRight: () => void
  moveWindowUp: () => void
  moveWindowDown: () => void
}

// ============================================================================
// Debounce utility для оптимизации частых событий
// ============================================================================
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  return function(...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Initialize helpers
function initializeHelpers() {
  state.screenshotHelper = new ScreenshotHelper(state.view)
  state.processingHelper = new ProcessingHelper({
    getScreenshotHelper,
    getMainWindow,
    getView,
    setView,
    getProblemInfo,
    setProblemInfo,
    getScreenshotQueue,
    getExtraScreenshotQueue,
    clearQueues,
    takeScreenshot,
    getImagePreview,
    deleteScreenshot,
    setHasDebugged,
    getHasDebugged,
    PROCESSING_EVENTS: state.PROCESSING_EVENTS
  } as IProcessingHelperDeps)
  state.shortcutsHelper = new ShortcutsHelper({
    getMainWindow,
    takeScreenshot,
    getImagePreview,
    processingHelper: state.processingHelper,
    clearQueues,
    setView,
    isVisible: () => state.isWindowVisible,
    toggleMainWindow,
    moveWindowLeft: () => moveWindowLeft(),
    moveWindowRight: () => moveWindowRight(),
    moveWindowUp: () => moveWindowUp(),
    moveWindowDown: () => moveWindowDown()
  } as IShortcutsHelperDeps)
}

// Register the interview-coder protocol
if (process.platform === "darwin") {
  app.setAsDefaultProtocolClient("interview-coder")
} else {
  app.setAsDefaultProtocolClient("interview-coder", process.execPath, [
    path.resolve(process.argv[1] || "")
  ])
}

// Handle the protocol
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient("interview-coder", process.execPath, [
    path.resolve(process.argv[1])
  ])
}

// Force Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on("second-instance", (event, commandLine) => {
    if (state.mainWindow) {
      if (state.mainWindow.isMinimized()) state.mainWindow.restore()
      state.mainWindow.focus()
    }
  })
}

// ============================================================================
// Window management functions
// ============================================================================

/**
 * Обновление размеров экрана с учётом текущего дисплея
 */
function updateScreenDimensions(display: Display): void {
  const workArea = display.workArea
  const scaleFactor = display.scaleFactor

  state.screenWidth = workArea.width
  state.screenHeight = workArea.height
  state.currentScaleFactor = scaleFactor
  state.currentDisplay = display

  console.log(`Screen dimensions:`, {
    workArea: `${workArea.width}x${workArea.height}`,
    scaleFactor: scaleFactor,
    physicalSize: `${Math.round(workArea.width * scaleFactor)}x${Math.round(workArea.height * scaleFactor)}`
  })
}

async function createWindow(): Promise<void> {
  if (state.mainWindow) {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore()
    state.mainWindow.focus()
    return
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  updateScreenDimensions(primaryDisplay)

  state.step = 60
  state.currentY = 50

  const windowSettings: Electron.BrowserWindowConstructorOptions = {
    width: 800,
    height: 600,
    minWidth: 750,
    minHeight: 550,
    x: state.currentX,
    y: 50,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: isDev
        ? path.join(__dirname, "../dist-electron/preload.js")
        : path.join(__dirname, "preload.js"),
      scrollBounce: true
      // НЕ устанавливаем zoomFactor здесь - Electron сам управляет
    },
    show: true,
    frame: false,
    transparent: true,
    fullscreenable: false,
    hasShadow: false,
    opacity: 1.0,
    backgroundColor: "#00000000",
    focusable: true,
    skipTaskbar: true,
    type: "panel",
    paintWhenInitiallyHidden: true,
    titleBarStyle: "hidden",
    enableLargerThanScreen: true,
    movable: true
  }

  state.mainWindow = new BrowserWindow(windowSettings)

  // ========================================================================
  // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Устанавливаем zoom = 1.0 после загрузки
  // ========================================================================
  state.mainWindow.webContents.on("did-finish-load", () => {
    console.log("Window loaded")

    // ВСЕГДА устанавливаем zoom factor = 1.0 для корректного размера шрифтов
    state.mainWindow?.webContents.setZoomFactor(1.0)
    console.log("✅ Zoom factor set to 1.0")

    // Проверяем результат
    state.mainWindow?.webContents.executeJavaScript('window.devicePixelRatio')
      .then(ratio => {
        console.log(`✅ devicePixelRatio: ${ratio}`)
        if (ratio < 0.95 || ratio > 1.05) {
          console.warn(`⚠️ Unexpected devicePixelRatio: ${ratio} (expected ~1.0)`)
          console.warn(`⚠️ Check Windows display scaling settings`)
        }
      })
      .catch(() => {})
  })

  state.mainWindow.webContents.on(
    "did-fail-load",
    async (event, errorCode, errorDescription) => {
      console.error("Window failed to load:", errorCode, errorDescription)
      if (isDev) {
        console.log("Retrying to load development server...")
        setTimeout(() => {
          state.mainWindow?.loadURL("http://localhost:54321").catch((error) => {
            console.error("Failed to load dev server on retry:", error)
          })
        }, 1000)
      }
    }
  )

  if (isDev) {
    console.log("Loading from development server: http://localhost:54321")
    state.mainWindow.loadURL("http://localhost:54321").catch((error) => {
      console.error("Failed to load dev server, falling back to local file:", error)
      const indexPath = path.join(__dirname, "../dist/index.html")
      console.log("Falling back to:", indexPath)
      if (fs.existsSync(indexPath)) {
        state.mainWindow?.loadFile(indexPath)
      } else {
        console.error("Could not find index.html in dist folder")
      }
    })
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html")
    console.log("Loading production build:", indexPath)

    if (fs.existsSync(indexPath)) {
      state.mainWindow.loadFile(indexPath)
    } else {
      console.error("Could not find index.html in dist folder")
    }
  }

  if (isDev) {
    state.mainWindow.webContents.openDevTools()
  }

  state.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log("Attempting to open URL:", url)
    try {
      const parsedURL = new URL(url)
      const hostname = parsedURL.hostname
      const allowedHosts = ["google.com", "supabase.co"]
      if (allowedHosts.includes(hostname) || hostname.endsWith(".google.com") || hostname.endsWith(".supabase.co")) {
        shell.openExternal(url)
        return { action: "deny" }
      }
    } catch (error) {
      console.error("Invalid URL in setWindowOpenHandler:", url, error)
      return { action: "deny" }
    }
    return { action: "allow" }
  })

  // Enhanced screen capture resistance
  state.mainWindow.setContentProtection(true)

  state.mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  })
  state.mainWindow.setAlwaysOnTop(true, "screen-saver", 1)

  // Additional screen capture resistance settings
  if (process.platform === "darwin") {
    state.mainWindow.setHiddenInMissionControl(true)
    state.mainWindow.setWindowButtonVisibility(false)
    state.mainWindow.setBackgroundColor("#00000000")
    state.mainWindow.setSkipTaskbar(true)
    state.mainWindow.setHasShadow(false)
  }

  // Prevent the window from being captured by screen recording
  state.mainWindow.webContents.setBackgroundThrottling(false)
  state.mainWindow.webContents.setFrameRate(60)

  // Set up window listeners with debounce для оптимизации
  const debouncedMove = debounce(handleWindowMove, 50)
  const debouncedResize = debounce(handleWindowResize, 50)

  state.mainWindow.on("move", debouncedMove)
  state.mainWindow.on("resize", debouncedResize)
  state.mainWindow.on("closed", handleWindowClosed)

  // Initialize window state
  const bounds = state.mainWindow.getBounds()
  state.windowPosition = { x: bounds.x, y: bounds.y }
  state.windowSize = { width: bounds.width, height: bounds.height }
  state.currentX = bounds.x
  state.currentY = bounds.y
  state.isWindowVisible = true

  // Set opacity based on user preferences
  const savedOpacity = configHelper.getOpacity()
  console.log(`Initial opacity from config: ${savedOpacity}`)

  state.mainWindow.showInactive()

  if (savedOpacity <= 0.1) {
    console.log('Initial opacity too low, setting to 0 and hiding window')
    state.mainWindow.setOpacity(0)
    state.isWindowVisible = false
  } else {
    console.log(`Setting initial opacity to ${savedOpacity}`)
    state.mainWindow.setOpacity(savedOpacity)
    state.isWindowVisible = true
  }
}

/**
 * Обработчик перемещения окна - с поддержкой смены дисплея
 */
function handleWindowMove(): void {
  if (!state.mainWindow) return

  const bounds = state.mainWindow.getBounds()
  state.windowPosition = { x: bounds.x, y: bounds.y }
  state.currentX = bounds.x
  state.currentY = bounds.y

  // Проверяем, не переместилось ли окно на другой дисплей
  const currentDisplay = screen.getDisplayNearestPoint({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  })

  // Если scale factor изменился, обновляем размеры экрана
  if (currentDisplay.scaleFactor !== state.currentScaleFactor) {
    console.log(`Display changed! Scale factor: ${state.currentScaleFactor} -> ${currentDisplay.scaleFactor}`)
    updateScreenDimensions(currentDisplay)

    // ВСЕГДА держим zoom = 1.0, независимо от дисплея
    state.mainWindow.webContents.setZoomFactor(1.0)
    console.log("Zoom factor reset to 1.0 on display change")
  }
}

function handleWindowResize(): void {
  if (!state.mainWindow) return
  const bounds = state.mainWindow.getBounds()
  state.windowSize = { width: bounds.width, height: bounds.height }
}

function handleWindowClosed(): void {
  state.mainWindow = null
  state.isWindowVisible = false
  state.windowPosition = null
  state.windowSize = null
}

// ============================================================================
// Window visibility functions
// ============================================================================

function hideMainWindow(): void {
  if (!state.mainWindow?.isDestroyed()) {
    const bounds = state.mainWindow.getBounds()
    state.windowPosition = { x: bounds.x, y: bounds.y }
    state.windowSize = { width: bounds.width, height: bounds.height }
    state.mainWindow.setIgnoreMouseEvents(true, { forward: true })
    state.mainWindow.setOpacity(0)
    state.isWindowVisible = false
    console.log('Window hidden, opacity set to 0')
  }
}

function showMainWindow(): void {
  if (!state.mainWindow?.isDestroyed()) {
    if (state.windowPosition && state.windowSize) {
      state.mainWindow.setBounds({
        ...state.windowPosition,
        ...state.windowSize
      })
    }
    state.mainWindow.setIgnoreMouseEvents(false)
    state.mainWindow.setAlwaysOnTop(true, "screen-saver", 1)
    state.mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })
    state.mainWindow.setContentProtection(true)
    state.mainWindow.setOpacity(0)
    state.mainWindow.showInactive()
    state.mainWindow.setOpacity(1)
    state.isWindowVisible = true
    console.log('Window shown with showInactive(), opacity set to 1')
  }
}

function toggleMainWindow(): void {
  console.log(`Toggling window. Current state: ${state.isWindowVisible ? 'visible' : 'hidden'}`)
  if (state.isWindowVisible) {
    hideMainWindow()
  } else {
    showMainWindow()
  }
}

// ============================================================================
// Window movement functions - ИСПРАВЛЕННЫЕ для корректной работы
// ============================================================================

/**
 * Перемещение окна влево
 */
function moveWindowLeft(): void {
  if (!state.mainWindow) return

  const newX = state.currentX - state.step
  const bounds = state.mainWindow.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  })

  // Минимум: окно может уйти влево на половину своей ширины
  const minX = display.workArea.x - bounds.width / 2

  state.currentX = Math.max(minX, newX)
  state.mainWindow.setPosition(Math.round(state.currentX), Math.round(state.currentY))

  console.log(`Moved left to ${state.currentX} (min: ${minX})`)
}

/**
 * Перемещение окна вправо - ИСПРАВЛЕНО
 */
function moveWindowRight(): void {
  if (!state.mainWindow) return

  const newX = state.currentX + state.step
  const bounds = state.mainWindow.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  })

  // ИСПРАВЛЕНИЕ: Максимум = начало рабочей области + ширина - половина окна
  const maxX = display.workArea.x + display.workArea.width - bounds.width / 2

  state.currentX = Math.min(maxX, newX)
  state.mainWindow.setPosition(Math.round(state.currentX), Math.round(state.currentY))

  console.log(`Moved right to ${state.currentX} (max: ${maxX}, workArea: ${display.workArea.x}+${display.workArea.width})`)
}

/**
 * Перемещение окна вверх
 */
function moveWindowUp(): void {
  if (!state.mainWindow) return

  const newY = state.currentY - state.step
  const bounds = state.mainWindow.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  })

  // Разрешаем окну уйти вверх на 2/3 своей высоты
  const minY = display.workArea.y - (bounds.height * 2) / 3

  state.currentY = Math.max(minY, newY)
  state.mainWindow.setPosition(Math.round(state.currentX), Math.round(state.currentY))

  console.log(`Moved up to ${state.currentY} (min: ${minY})`)
}

/**
 * Перемещение окна вниз
 */
function moveWindowDown(): void {
  if (!state.mainWindow) return

  const newY = state.currentY + state.step
  const bounds = state.mainWindow.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  })

  // Разрешаем окну уйти вниз на 2/3 своей высоты
  const maxY = display.workArea.y + display.workArea.height + (bounds.height * 2) / 3

  state.currentY = Math.min(maxY, newY)
  state.mainWindow.setPosition(Math.round(state.currentX), Math.round(state.currentY))

  console.log(`Moved down to ${state.currentY} (max: ${maxY})`)
}

// ============================================================================
// Window dimension functions
// ============================================================================

function setWindowDimensions(width: number, height: number): void {
  if (!state.mainWindow?.isDestroyed()) {
    const [currentX, currentY] = state.mainWindow.getPosition()
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea
    const maxWidth = Math.floor(workArea.width * 0.5)

    state.mainWindow.setBounds({
      x: Math.min(currentX, workArea.x + workArea.width - maxWidth),
      y: currentY,
      width: Math.min(width + 32, maxWidth),
      height: Math.ceil(height)
    })
  }
}

// ============================================================================
// Environment setup
// ============================================================================

function loadEnvVariables() {
  if (isDev) {
    console.log("Loading env variables from:", path.join(process.cwd(), ".env"))
    dotenv.config({ path: path.join(process.cwd(), ".env") })
  } else {
    console.log(
      "Loading env variables from:",
      path.join(process.resourcesPath, ".env")
    )
    dotenv.config({ path: path.join(process.resourcesPath, ".env") })
  }
  console.log("Environment variables loaded for open-source version")
}

// ============================================================================
// Initialize application
// ============================================================================

async function initializeApp() {
  try {
    // Set custom cache directory to prevent permission issues
    const appDataPath = path.join(app.getPath('appData'), 'interview-coder-v1')
    const sessionPath = path.join(appDataPath, 'session')
    const tempPath = path.join(appDataPath, 'temp')
    const cachePath = path.join(appDataPath, 'cache')

    // Create directories if they don't exist
    for (const dir of [appDataPath, sessionPath, tempPath, cachePath]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }

    app.setPath('userData', appDataPath)
    app.setPath('sessionData', sessionPath)      
    app.setPath('temp', tempPath)
    app.setPath('cache', cachePath)

    loadEnvVariables()

    // Ensure a configuration file exists
    if (!configHelper.hasApiKey()) {
      console.log("No API key found in configuration. User will need to set up.")
    }

    initializeHelpers()
    initializeIpcHandlers({
      getMainWindow,
      setWindowDimensions,
      getScreenshotQueue,
      getExtraScreenshotQueue,
      deleteScreenshot,
      getImagePreview,
      processingHelper: state.processingHelper,
      PROCESSING_EVENTS: state.PROCESSING_EVENTS,
      takeScreenshot,
      getView,
      toggleMainWindow,
      clearQueues,
      setView,
      moveWindowLeft,
      moveWindowRight,
      moveWindowUp,
      moveWindowDown
    })
    await createWindow()
    state.shortcutsHelper?.registerGlobalShortcuts()

    // Initialize auto-updater regardless of environment
    initAutoUpdater()
    console.log(
      "Auto-updater initialized in",
      isDev ? "development" : "production",
      "mode"
    )
  } catch (error) {
    console.error("Failed to initialize application:", error)
    app.quit()
  }
}

// ============================================================================
// Protocol and instance handling
// ============================================================================

app.on("open-url", (event, url) => {
  console.log("open-url event received:", url)
  event.preventDefault()
})

app.on("second-instance", (event, commandLine) => {
  console.log("second-instance event received:", commandLine)

  if (!state.mainWindow) {
    createWindow()
  } else {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore()
    state.mainWindow.focus()
  }
})

// Prevent multiple instances of the app
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
      state.mainWindow = null
    }
  })
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// ============================================================================
// State getter/setter functions
// ============================================================================

function getMainWindow(): BrowserWindow | null {
  return state.mainWindow
}

function getView(): "queue" | "solutions" | "debug" {
  return state.view
}

function setView(view: "queue" | "solutions" | "debug"): void {
  state.view = view
  state.screenshotHelper?.setView(view)
}

function getScreenshotHelper(): ScreenshotHelper | null {
  return state.screenshotHelper
}

function getProblemInfo(): any {
  return state.problemInfo
}

function setProblemInfo(problemInfo: any): void {
  state.problemInfo = problemInfo
}

function getScreenshotQueue(): string[] {
  return state.screenshotHelper?.getScreenshotQueue() || []
}

function getExtraScreenshotQueue(): string[] {
  return state.screenshotHelper?.getExtraScreenshotQueue() || []
}

function clearQueues(): void {
  state.screenshotHelper?.clearQueues()
  state.problemInfo = null
  setView("queue")
}

async function takeScreenshot(): Promise<string> {
  if (!state.mainWindow) throw new Error("No main window available")
  return (
    state.screenshotHelper?.takeScreenshot(
      () => hideMainWindow(),
      () => showMainWindow()
    ) || ""
  )
}

async function getImagePreview(filepath: string): Promise<string> {
  return state.screenshotHelper?.getImagePreview(filepath) || ""
}

async function deleteScreenshot(
  path: string
): Promise<{ success: boolean; error?: string }> {
  return (
    state.screenshotHelper?.deleteScreenshot(path) || {
      success: false,
      error: "Screenshot helper not initialized"
    }
  )
}

function setHasDebugged(value: boolean): void {
  state.hasDebugged = value
}

function getHasDebugged(): boolean {
  return state.hasDebugged
}

// ============================================================================
// Export state and functions for other modules
// ============================================================================

export {
  state,
  createWindow,
  hideMainWindow,
  showMainWindow,
  toggleMainWindow,
  setWindowDimensions,
  getMainWindow,
  getView,
  setView,
  getScreenshotHelper,
  getProblemInfo,
  setProblemInfo,
  getScreenshotQueue,
  getExtraScreenshotQueue,
  clearQueues,
  takeScreenshot,
  getImagePreview,
  deleteScreenshot,
  setHasDebugged,
  getHasDebugged
}

app.whenReady().then(initializeApp)