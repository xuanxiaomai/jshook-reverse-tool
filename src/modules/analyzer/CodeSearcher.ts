/**
 * 代码搜索器 - 在多个脚本中按关键词/正则搜索并带上下文
 */

import { logger } from '../../utils/logger.js';

export interface SearchMatch {
  file: string;
  scriptId: string;
  line: number;
  column: number;
  matchText: string;
  context: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface SearchResult {
  keyword: string;
  totalMatches: number;
  matches: SearchMatch[];
  searchTime: number;
}

export interface SearchOptions {
  isRegex?: boolean;
  caseSensitive?: boolean;
  contextLines?: number;
  maxMatches?: number;
}

export interface ScriptInput {
  scriptId: string;
  url: string;
  content: string;
}

export class CodeSearcher {
  async search(
    scripts: ScriptInput[],
    keyword: string,
    options: SearchOptions = {}
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const {
      isRegex = false,
      caseSensitive = false,
      contextLines = 3,
      maxMatches = 100,
    } = options;

    logger.info(`🔍 搜索关键词: ${keyword}`);
    logger.info(`📊 搜索范围: ${scripts.length} 个文件`);

    const matches: SearchMatch[] = [];

    try {
      let searchRegex: RegExp;
      if (isRegex) {
        searchRegex = new RegExp(keyword, caseSensitive ? 'g' : 'gi');
      } else {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        searchRegex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }

      for (const script of scripts) {
        const lines = script.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;

          const lineMatches = Array.from(line.matchAll(searchRegex));
          for (const match of lineMatches) {
            if (matches.length >= maxMatches) {
              logger.warn(`⚠️ 达到最大匹配数限制: ${maxMatches}`);
              break;
            }
            const column = match.index ?? 0;
            const contextBefore = lines.slice(
              Math.max(0, i - contextLines),
              i
            );
            const contextAfter = lines.slice(
              i + 1,
              Math.min(lines.length, i + 1 + contextLines)
            );
            const context = [...contextBefore, line, ...contextAfter].join(
              '\n'
            );
            matches.push({
              file: script.url,
              scriptId: script.scriptId,
              line: i + 1,
              column: column + 1,
              matchText: match[0],
              context,
              contextBefore,
              contextAfter,
            });
          }
          if (matches.length >= maxMatches) break;
        }
        if (matches.length >= maxMatches) break;
      }

      const searchTime = Date.now() - startTime;
      logger.info(`✅ 搜索完成: 找到 ${matches.length} 个匹配`);
      logger.info(`⏱️ 搜索耗时: ${searchTime}ms`);

      return {
        keyword,
        totalMatches: matches.length,
        matches,
        searchTime,
      };
    } catch (error) {
      logger.error('❌ 搜索失败', error);
      throw error;
    }
  }

  formatResults(result: SearchResult): string {
    const lines: string[] = [];
    lines.push(`🔍 搜索关键词: "${result.keyword}"`);
    lines.push(`📊 找到 ${result.totalMatches} 个匹配`);
    lines.push(`⏱️ 搜索耗时: ${result.searchTime}ms`);
    lines.push('');
    for (const match of result.matches) {
      lines.push(`📄 文件: ${match.file}`);
      lines.push(`📍 位置: 第 ${match.line} 行, 第 ${match.column} 列`);
      lines.push(`🎯 匹配: "${match.matchText}"`);
      lines.push('');
      lines.push('```javascript');
      lines.push(match.context);
      lines.push('```');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    return lines.join('\n');
  }
}
