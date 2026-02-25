/**
 * 函数树提取器 - 按函数名提取函数及其依赖形成的调用树
 */

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';

export interface FunctionInfo {
  name: string;
  code: string;
  startLine: number;
  endLine: number;
  dependencies: string[];
  size: number;
}

export interface ExtractionResult {
  mainFunction: string;
  code: string;
  functions: FunctionInfo[];
  callGraph: Record<string, string[]>;
  totalSize: number;
  extractedCount: number;
}

export interface ExtractOptions {
  maxDepth?: number;
  maxSize?: number;
  includeComments?: boolean;
}

export class FunctionExtractor {
  async extractFunctionTree(
    code: string,
    functionName: string,
    options: ExtractOptions = {}
  ): Promise<ExtractionResult> {
    const {
      maxDepth = 3,
      maxSize = 500,
      includeComments = true,
    } = options;

    logger.info(`🔍 提取函数: ${functionName}`);
    logger.info(`📊 最大深度: ${maxDepth}, 最大大小: ${maxSize}KB`);

    try {
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      const allFunctions = new Map<string, FunctionInfo>();
      const callGraph: Record<string, string[]> = {};
      const self = this;

      traverse(ast, {
        FunctionDeclaration(path) {
          const name = path.node.id?.name;
          if (!name) return;
          const funcCode = generate(path.node, { comments: includeComments })
            .code;
          const deps = self.extractDependencies(path);
          allFunctions.set(name, {
            name,
            code: funcCode,
            startLine: path.node.loc?.start.line ?? 0,
            endLine: path.node.loc?.end.line ?? 0,
            dependencies: deps,
            size: funcCode.length,
          });
          callGraph[name] = deps;
        },
        VariableDeclarator(path) {
          if (
            t.isIdentifier(path.node.id) &&
            (t.isFunctionExpression(path.node.init) ||
              t.isArrowFunctionExpression(path.node.init))
          ) {
            const name = path.node.id.name;
            const funcCode = generate(path.node, {
              comments: includeComments,
            }).code;
            const deps = self.extractDependencies(path);
            allFunctions.set(name, {
              name,
              code: funcCode,
              startLine: path.node.loc?.start.line ?? 0,
              endLine: path.node.loc?.end.line ?? 0,
              dependencies: deps,
              size: funcCode.length,
            });
            callGraph[name] = deps;
          }
        },
      });

      logger.info(`✅ 找到 ${allFunctions.size} 个函数定义`);

      if (!allFunctions.has(functionName)) {
        throw new Error(`函数 "${functionName}" 未找到`);
      }

      const extracted = new Set<string>();
      const toExtract: string[] = [functionName];
      const functions: FunctionInfo[] = [];
      let totalSize = 0;
      let currentDepth = 0;

      while (toExtract.length > 0 && currentDepth < maxDepth) {
        const current = toExtract.shift()!;
        if (extracted.has(current)) continue;

        const funcInfo = allFunctions.get(current);
        if (!funcInfo) continue;

        if (totalSize + funcInfo.size > maxSize * 1024) {
          logger.warn(`⚠️ 达到大小限制: ${maxSize}KB`);
          break;
        }

        extracted.add(current);
        functions.push(funcInfo);
        totalSize += funcInfo.size;
        toExtract.push(...funcInfo.dependencies);
        currentDepth++;
      }

      logger.info(
        `✅ 提取完成: ${functions.length} 个函数, ${(totalSize / 1024).toFixed(2)}KB`
      );

      const fullCode = functions.map((f) => f.code).join('\n\n');
      return {
        mainFunction: functionName,
        code: fullCode,
        functions,
        callGraph,
        totalSize,
        extractedCount: functions.length,
      };
    } catch (error) {
      logger.error('❌ 函数提取失败', error);
      throw error;
    }
  }

  private extractDependencies(path: { traverse: (visitor: any) => void }): string[] {
    const deps = new Set<string>();
    path.traverse({
      CallExpression(callPath: any) {
        if (t.isIdentifier(callPath.node.callee)) {
          deps.add(callPath.node.callee.name);
        } else if (
          t.isMemberExpression(callPath.node.callee) &&
          t.isIdentifier(callPath.node.callee.property)
        ) {
          deps.add(callPath.node.callee.property.name);
        }
      },
    });
    return Array.from(deps);
  }

  formatResult(result: ExtractionResult): string {
    const lines: string[] = [];
    lines.push(`🎯 主函数: ${result.mainFunction}`);
    lines.push(`📊 提取了 ${result.extractedCount} 个函数`);
    lines.push(`📦 总大小: ${(result.totalSize / 1024).toFixed(2)}KB`);
    lines.push('');
    lines.push('📋 函数列表:');
    for (const func of result.functions) {
      lines.push(
        `  - ${func.name} (${func.size} bytes, 依赖: ${func.dependencies.join(', ') || '无'})`
      );
    }
    lines.push('');
    lines.push('🔗 调用关系图:');
    for (const [caller, callees] of Object.entries(result.callGraph)) {
      if (callees.length > 0) {
        lines.push(`  ${caller} → ${callees.join(', ')}`);
      }
    }
    lines.push('');
    lines.push('📝 完整代码:');
    lines.push('```javascript');
    lines.push(result.code);
    lines.push('```');
    return lines.join('\n');
  }
}
