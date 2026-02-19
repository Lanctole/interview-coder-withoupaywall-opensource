// imageProcessor.ts
import fs from 'node:fs';
import { Jimp } from 'jimp'; // обрати внимание на импорт для jimp v1+

/**
 * Предобрабатывает изображение: инвертирует, если оно тёмное.
 */
export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  try {
    const image = await Jimp.read(buffer);
    
    let totalBrightness = 0;
    let pixelCount = 0;
    
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      totalBrightness += brightness;
      pixelCount++;
    });
    
    const avgBrightness = totalBrightness / pixelCount;
    console.log(`[preprocess] Average brightness: ${avgBrightness.toFixed(1)}`);

    if (avgBrightness < 128) {
      console.log('[preprocess] Image is dark, inverting colors');
      image.invert();
    }

    // Новый API v1.x — используем getBuffer
    const processedBuffer = await image.getBuffer('image/png');
    return processedBuffer;
  } catch (error) {
    console.error('[preprocess] Error during preprocessing:', error);
    return buffer; // возвращаем исходный буфер в случае ошибки
  }
}

/**
 * Загружает скриншоты из файлов, применяет предобработку и возвращает base64.
 */
export async function loadScreenshotsData(
  paths: string[]
): Promise<Array<{ path: string; data: string }>> {
  const screenshots: Array<{ path: string; data: string }> = [];
  for (const screenshotPath of paths) {
    try {
      const imageBuffer = fs.readFileSync(screenshotPath);
      const processedBuffer = await preprocessImage(imageBuffer);
      const base64Data = processedBuffer.toString('base64');
      screenshots.push({ path: screenshotPath, data: base64Data });
    } catch (error) {
      console.error(`Failed to read screenshot ${screenshotPath}:`, error);
    }
  }
  return screenshots;
}