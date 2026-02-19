// rendererHelper.ts
import { BrowserWindow } from 'electron';

/**
 * Ожидает инициализации рендерера (проверяет флаг __IS_INITIALIZED__).
 */
export async function waitForInitialization(mainWindow: BrowserWindow): Promise<void> {
  let attempts = 0;
  const maxAttempts = 50;

  while (attempts < maxAttempts) {
    const isInitialized = await mainWindow.webContents.executeJavaScript(
      'window.__IS_INITIALIZED__'
    );
    if (isInitialized) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }
  throw new Error('App failed to initialize after 5 seconds');
}

/**
 * Получает язык из окна рендерера или возвращает значение из конфига.
 */
export async function getLanguageFromWindow(
  mainWindow: BrowserWindow | null,
  configLanguage?: string
): Promise<string> {
  if (configLanguage) return configLanguage;

  if (mainWindow) {
    try {
      await waitForInitialization(mainWindow);
      const language = await mainWindow.webContents.executeJavaScript('window.__LANGUAGE__');
      if (typeof language === 'string' && language !== undefined && language !== null) {
        return language;
      }
    } catch (err) {
      console.warn('Could not get language from window', err);
    }
  }
  return 'python'; // значение по умолчанию
}