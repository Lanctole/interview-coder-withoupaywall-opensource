// smartExtractor.ts
import {ExtractedContent } from '../shared/types';
export class SmartTaskExtractor {
  
  /**
   * Определяет тип контента по ключевым словам
   */
  private detectContentType(text: string): string {
    const lower = text.toLowerCase();
    
    // Проверка на code review
    if (lower.includes('review') || 
        lower.includes('провести ревью') ||
        lower.includes('code review') ||
        (lower.includes('@service') || lower.includes('@autowired'))) {
      return 'code_review';
    }
    
    // Проверка на SQL
    if (lower.includes('sql') || 
        lower.includes('таблицы') ||
        lower.includes('select') ||
        lower.includes('join')) {
      return 'sql_task';
    }
    
    // Проверка на многопоточность
    if (lower.includes('многопоточ') || 
        lower.includes('multithread') ||
        lower.includes('parallel') ||
        lower.includes('потоках')) {
      return 'multithreading';
    }
    
    // Проверка на несколько задач (есть нумерация)
    if (lower.match(/(задача|task)\s*\d+/i)) {
      return 'multiple_tasks';
    }
    
    // По умолчанию - задача на программирование
    return 'coding_task';
  }
  
  /**
   * Извлекает код из текста (для code review)
   */
  private extractCode(text: string): string | undefined {
    // Ищем блоки кода
    const codeBlockMatch = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    
    // Ищем Java/Kotlin код (наличие аннотаций, классов)
    if (text.includes('@Service') || text.includes('public class')) {
      // Просто возвращаем весь текст - это уже код
      return text;
    }
    
    return undefined;
  }
  
  /**
   * Парсит ответ модели в структурированный формат
   */
  public parseExtraction(response: string): ExtractedContent {
    const type = this.detectContentType(response);
    const code = this.extractCode(response);
    
    const base: ExtractedContent = {
      type: type as any,
      rawText: response
    };
    
    // Проверка на несколько задач (есть нумерация)
    if (type === 'multiple_tasks' || response.includes('1.')) {
      const tasks = this.splitIntoTasks(response);
      return {
        ...base,
        type: 'mixed',
        multipleTasks: tasks
      };
    }
    
    // Специфичная обработка для каждого типа
    switch (type) {
      case 'code_review':
        return {
          ...base,
          codeReview: {
            originalCode: code || response,
            language: this.detectLanguage(response),
            context: this.extractContext(response)
          }
        };
        
      case 'sql_task':
        return {
          ...base,
          sqlTask: {
            description: response,
            schema: this.extractSchema(response)
          }
        };
        
      case 'coding_task':
      default:
        return {
          ...base,
          codingTask: {
            originalCode: code || response,
            description: response,
            language: this.detectLanguage(response),
            requirements: this.extractRequirements(response)
          }
        };
    }
  }
  
  /**
   * Разделяет текст на отдельные задачи
   */
  private splitIntoTasks(text: string): ExtractedContent[] {
    const tasks: ExtractedContent[] = [];
    
    // Ищем паттерны вида "1.", "2." или "Задача 1:", "Задача 2:"
    const taskPattern = /(?:^|\n)(?:\d+\.|Задача\s*\d+:|Task\s*\d+:)\s*([^\n]+(?:\n(?!\d+\.|Задача|Task)[^\n]+)*)/g;
    
    let match;
    while ((match = taskPattern.exec(text)) !== null) {
      const taskText = match[1].trim();
      tasks.push({
        type: this.detectContentType(taskText) as any,
        rawText: taskText,
        codingTask: {
          description: taskText,
          language: this.detectLanguage(taskText),
          requirements: this.extractRequirements(taskText),

        }
      });
    }
    
    return tasks;
  }
  
  /**
   * Определяет язык программирования
   */
  private detectLanguage(text: string): string {
    if (text.includes('@Service') || text.includes('@Autowired')) return 'java';
    if (text.includes('def ') || text.includes('import ') && text.includes(':')) return 'python';
    if (text.includes('SELECT ') || text.includes('FROM ')) return 'sql';
    if (text.includes('public class')) return 'java';
    if (text.includes('function ')) return 'javascript';
    return 'unknown';
  }
  
  private extractContext(text: string): string {
    // Извлекаем контекст (первые предложения)
    const sentences = text.split(/[.!?]/);
    return sentences.slice(0, 2).join('. ');
  }
  
  private extractSchema(text: string): string | undefined {
    if (text.includes('employee') && text.includes('department')) {
      return 'employee(id, department_id, work_start_date, name, salary)\ndepartment(id, name, lead_id)';
    }
    return undefined;
  }
  
  private extractRequirements(text: string): string[] {
    const requirements: string[] = [];
    
    // Ищем требования по ключевым словам
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.includes('делятся на') || 
          line.includes('меньше') || 
          line.includes('больше') ||
          line.match(/\d+/)) {
        requirements.push(line.trim());
      }
    }
    
    return requirements;
  }
}