// responseParser.ts

/**
 * Парсит ответ модели при извлечении задачи.
 * Пытается извлечь JSON, при ошибке возвращает структуру с сырым текстом.
 */
export function parseProblemInfoResponse(content: string): any {
  // Очищаем от markdown code blocks
  let cleaned = content.replace(/```json|```/g, '').trim();
  
  // Пытаемся найти JSON в ответе (модель может обернуть его в текст)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    return JSON.parse(cleaned);
  } catch (parseError) {
    console.warn('Failed to parse JSON response, using fallback extraction:', cleaned);
    
    // Fallback: создаем структуру из всего ответа как problem_statement
    return {
      problem_statement: cleaned,
      constraints: 'No specific constraints extracted',
      example_input: 'Not extracted',
      example_output: 'Not extracted',
      _raw_response: content,
      _parse_error: true,
    };
  }
}

/**
 * Парсит мультизадачный ответ при генерации решения.
 * Извлекает код, размышления, временную и пространственную сложности.
 */
export function parseMultiTaskResponse(responseContent: string): {
  code: string;
  thoughts: string[];
  time_complexity: string;
  space_complexity: string;
} {
  console.log('📄 Parsing multi-task response...');

  const codeMatches = [...responseContent.matchAll(/```(?:\w+)?\s*([\s\S]*?)```/g)];

  const code =
    codeMatches.length > 1
      ? codeMatches
          .map((match, i) => {
            const taskTitle = `Задача ${i + 1}`;
            return `// ========== ${taskTitle} ==========\n\n${match[1].trim()}`;
          })
          .join('\n\n\n')
      : codeMatches.length === 1
      ? `// ========== Задача 1 ==========\n\n${codeMatches[0][1].trim()}`
      : responseContent;

  console.log('✅ Code extracted, length:', code.length);

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
        bulletPoints.forEach((point) => {
          thoughts.push(point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim());
        });
      } else {
        const lines = thoughtsText.split('\n').map((l) => l.trim()).filter(Boolean);
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

  const timeComplexity =
    timeComplexities.length > 1
      ? timeComplexities.map((m, i) => `**Задача ${i + 1}:** ${m[1].trim()}`).join('\n\n')
      : timeComplexities.length === 1
      ? `**Задача 1:** ${timeComplexities[0][1].trim()}`
      : 'O(n) - Линейная сложность';

  const spaceComplexity =
    spaceComplexities.length > 1
      ? spaceComplexities.map((m, i) => `**Задача ${i + 1}:** ${m[1].trim()}`).join('\n\n')
      : spaceComplexities.length === 1
      ? `**Задача 1:** ${spaceComplexities[0][1].trim()}`
      : 'O(1) - Константная память';

  return {
    code,
    thoughts: thoughts.length > 0 ? thoughts : ['Решение оптимизировано для читаемости и эффективности'],
    time_complexity: timeComplexity,
    space_complexity: spaceComplexity,
  };
}