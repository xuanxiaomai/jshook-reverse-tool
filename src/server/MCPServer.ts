/**
 * MCP服务器主类
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { CacheManager } from '../utils/cache.js';
import { CodeCollector } from '../modules/collector/CodeCollector.js';
import { PageController } from '../modules/collector/PageController.js';
import { DOMInspector } from '../modules/collector/DOMInspector.js';
import { ScriptManager } from '../modules/debugger/ScriptManager.js';
import { DebuggerManager } from '../modules/debugger/DebuggerManager.js';
import { RuntimeInspector } from '../modules/debugger/RuntimeInspector.js';
import { ConsoleMonitor } from '../modules/monitor/ConsoleMonitor.js';
import { BrowserToolHandlers } from './BrowserToolHandlers.js';
import { DebuggerToolHandlers } from './DebuggerToolHandlers.js';
import { AdvancedToolHandlers } from './AdvancedToolHandlers.js';
import { AIHookToolHandlers } from './AIHookToolHandlers.js';
import { browserTools } from './BrowserToolDefinitions.js';
import { debuggerTools } from './DebuggerToolDefinitions.js';
import { advancedTools } from './AdvancedToolDefinitions.js';
import { aiHookTools } from './AIHookToolDefinitions.js';
import { tokenBudgetTools } from './TokenBudgetToolDefinitions.js';
import { Deobfuscator } from '../modules/deobfuscator/Deobfuscator.js';
import { AdvancedDeobfuscator } from '../modules/deobfuscator/AdvancedDeobfuscator.js';
import { ASTOptimizer } from '../modules/deobfuscator/ASTOptimizer.js';
import { ObfuscationDetector } from '../modules/detector/ObfuscationDetector.js';
import { LLMService } from '../services/LLMService.js';
import { CodeAnalyzer } from '../modules/analyzer/CodeAnalyzer.js';
import { CryptoDetector } from '../modules/crypto/CryptoDetector.js';
import { HookManager } from '../modules/hook/HookManager.js';
import { TokenBudgetManager } from '../utils/TokenBudgetManager.js';
import { UnifiedCacheManager } from '../utils/UnifiedCacheManager.js';
import { cacheTools } from './CacheToolDefinitions.js';

export class MCPServer {
  private server: Server;
  private cache: CacheManager;
  private collector: CodeCollector;
  private pageController: PageController;
  private domInspector: DOMInspector;
  private scriptManager: ScriptManager;
  private debuggerManager: DebuggerManager;
  private runtimeInspector: RuntimeInspector;
  private consoleMonitor: ConsoleMonitor;
  private browserHandlers: BrowserToolHandlers;
  private debuggerHandlers: DebuggerToolHandlers;
  private tokenBudget: TokenBudgetManager;
  private unifiedCache: UnifiedCacheManager;
  private advancedHandlers: AdvancedToolHandlers;
  private aiHookHandlers: AIHookToolHandlers;
  private deobfuscator: Deobfuscator;
  private advancedDeobfuscator: AdvancedDeobfuscator;
  private astOptimizer: ASTOptimizer;
  private obfuscationDetector: ObfuscationDetector;
  private llm: LLMService;
  private analyzer: CodeAnalyzer;
  private cryptoDetector: CryptoDetector;
  private hookManager: HookManager;

  constructor(config: Config) {
    this.cache = new CacheManager(config.cache);
    this.collector = new CodeCollector(config.puppeteer);

    // 🆕 新增模块（依赖CodeCollector）
    this.pageController = new PageController(this.collector);
    this.domInspector = new DOMInspector(this.collector);
    this.scriptManager = new ScriptManager(this.collector);
    this.debuggerManager = new DebuggerManager(this.collector);
    this.consoleMonitor = new ConsoleMonitor(this.collector);

    // 🆕 运行时检查器（依赖DebuggerManager）
    this.runtimeInspector = new RuntimeInspector(this.collector, this.debuggerManager);

    // 现有模块（需要先初始化LLM）
    this.llm = new LLMService(config.llm);

    // 🆕 浏览器工具处理器（需要LLM服务）
    this.browserHandlers = new BrowserToolHandlers(
      this.collector,
      this.pageController,
      this.domInspector,
      this.scriptManager,
      this.consoleMonitor,
      this.llm
    );

    // 🆕 调试器工具处理器
    this.debuggerHandlers = new DebuggerToolHandlers(
      this.debuggerManager,
      this.runtimeInspector,
      this.scriptManager
    );

    // 🆕 高级工具处理器（P2）
    this.advancedHandlers = new AdvancedToolHandlers(
      this.collector,
      this.consoleMonitor
    );

    // 🆕 AI Hook工具处理器
    this.aiHookHandlers = new AIHookToolHandlers(this.pageController);

    // 其他现有模块
    this.deobfuscator = new Deobfuscator(this.llm);
    this.advancedDeobfuscator = new AdvancedDeobfuscator(this.llm);
    this.astOptimizer = new ASTOptimizer();
    this.obfuscationDetector = new ObfuscationDetector();
    this.analyzer = new CodeAnalyzer(this.llm);
    this.cryptoDetector = new CryptoDetector(this.llm);
    this.hookManager = new HookManager();

    // 🆕 Token 预算管理器
    this.tokenBudget = TokenBudgetManager.getInstance();
    logger.info('TokenBudgetManager initialized');

    // 🆕 统一缓存管理器
    this.unifiedCache = UnifiedCacheManager.getInstance();
    logger.info('UnifiedCacheManager initialized');

    // 创建MCP服务器
    this.server = new Server(
      {
        name: config.mcp.name,
        version: config.mcp.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // 立即设置处理器
    this.setupHandlers();

    logger.info('MCP Server initialized with tools');
  }

  /**
   * 注册所有缓存到统一管理器
   */
  private async registerCaches(): Promise<void> {
    try {
      logger.info('Starting cache registration...');
      
      // 使用 ES 模块的动态导入替代 require
      const { DetailedDataManager } = await import('../utils/detailedDataManager.js');
      const { createCacheAdapters } = await import('../utils/CacheAdapters.js');

      // 获取缓存实例
      const detailedDataManager = DetailedDataManager.getInstance();
      
      // 确保 collector 有这些方法
      let codeCache, codeCompressor;
      try {
        codeCache = this.collector.getCache();
        codeCompressor = this.collector.getCompressor();
      } catch (error) {
        logger.warn('Collector cache methods not available, using fallback');
        // 如果这些方法不存在，使用其他方式获取缓存
        codeCache = (this.collector as any).cache;
        codeCompressor = (this.collector as any).compressor;
      }

      // 创建适配器
      const adapters = createCacheAdapters(
        detailedDataManager,
        codeCache,
        codeCompressor
      );

      // 注册到统一管理器
      for (const adapter of adapters) {
        this.unifiedCache.registerCache(adapter);
      }

      logger.info(`All caches registered to UnifiedCacheManager (${adapters.length} adapters)`);
    } catch (error) {
      logger.error('Failed to register caches:', error);
      // 不要让缓存注册失败阻止服务器启动
      logger.warn('Continuing without cache registration');
    }
  }

  /**
   * 设置请求处理器
   */
  private setupHandlers(): void {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.getTools();
      logger.info(`Returning ${tools.length} tools`);
      return {
        tools,
      };
    });

    // 调用工具
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      logger.info(`Tool called: ${name}`);

      try {
        const toolArgs = args || {};

        // 🆕 执行工具并记录 Token 使用
        const response = await this.executeToolWithTracking(name, toolArgs);
        return response;
      } catch (error: any) {
        logger.error(`Tool execution failed: ${name}`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 执行工具并追踪 Token 使用
   */
  private async executeToolWithTracking(name: string, args: any): Promise<any> {
    try {
      // 执行工具
      const response = await this.executeToolInternal(name, args);

      // 🆕 记录 Token 使用
      this.tokenBudget.recordToolCall(name, args, response);

      return response;
    } catch (error) {
      // 即使出错也记录（用于统计）
      const errorResponse = {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
      this.tokenBudget.recordToolCall(name, args, errorResponse);
      throw error;
    }
  }

  /**
   * 内部工具执行（不含 Token 追踪）
   */
  private async executeToolInternal(name: string, toolArgs: any): Promise<any> {
    switch (name) {
      // 🆕 Token 预算管理
      case 'get_token_budget_stats':
        return await this.handleGetTokenBudgetStats(toolArgs);

      case 'manual_token_cleanup':
        return await this.handleManualTokenCleanup(toolArgs);

      case 'reset_token_budget':
        return await this.handleResetTokenBudget(toolArgs);

      // 🆕 缓存管理
      case 'get_cache_stats':
        return await this.handleGetCacheStats(toolArgs);

      case 'smart_cache_cleanup':
        return await this.handleSmartCacheCleanup(toolArgs);

      case 'clear_all_caches':
        return await this.handleClearAllCaches(toolArgs);

      case 'collect_code':
        return await this.handleCollectCode(toolArgs);

      case 'search_in_scripts':
        return await this.handleSearchInScripts(toolArgs);

      case 'extract_function_tree':
        return await this.handleExtractFunctionTree(toolArgs);

      case 'deobfuscate':
        return await this.handleDeobfuscate(toolArgs);

      case 'understand_code':
        return await this.handleUnderstandCode(toolArgs);

      case 'detect_crypto':
        return await this.handleDetectCrypto(toolArgs);

      case 'manage_hooks':
        return await this.handleManageHooks(toolArgs);

      case 'detect_obfuscation':
        return await this.handleDetectObfuscation(toolArgs);

      case 'advanced_deobfuscate':
        return await this.handleAdvancedDeobfuscate(toolArgs);

      case 'clear_collected_data':
        return await this.handleClearCollectedData(toolArgs);

      case 'get_collection_stats':
        return await this.handleGetCollectionStats(toolArgs);

      // 🆕 数据管理
      case 'get_detailed_data':
        return await this.browserHandlers.handleGetDetailedData(toolArgs);

      // 🆕 浏览器生命周期
      case 'browser_launch':
        return await this.browserHandlers.handleBrowserLaunch(toolArgs);
      case 'browser_close':
        return await this.browserHandlers.handleBrowserClose(toolArgs);
      case 'browser_status':
        return await this.browserHandlers.handleBrowserStatus(toolArgs);

      // 🆕 页面导航
      case 'page_navigate':
        return await this.browserHandlers.handlePageNavigate(toolArgs);
      case 'page_reload':
        return await this.browserHandlers.handlePageReload(toolArgs);
      case 'page_back':
        return await this.browserHandlers.handlePageBack(toolArgs);
      case 'page_forward':
        return await this.browserHandlers.handlePageForward(toolArgs);

      // 🆕 DOM查询
      case 'dom_query_selector':
        return await this.browserHandlers.handleDOMQuerySelector(toolArgs);
      case 'dom_query_all':
        return await this.browserHandlers.handleDOMQueryAll(toolArgs);
          case 'dom_get_structure':
            return await this.browserHandlers.handleDOMGetStructure(toolArgs);
          case 'dom_find_clickable':
            return await this.browserHandlers.handleDOMFindClickable(toolArgs);

          // 🆕 页面交互
          case 'page_click':
            return await this.browserHandlers.handlePageClick(toolArgs);
          case 'page_type':
            return await this.browserHandlers.handlePageType(toolArgs);
          case 'page_select':
            return await this.browserHandlers.handlePageSelect(toolArgs);
          case 'page_hover':
            return await this.browserHandlers.handlePageHover(toolArgs);
          case 'page_scroll':
            return await this.browserHandlers.handlePageScroll(toolArgs);

          // 🆕 等待和查询
          case 'page_wait_for_selector':
            return await this.browserHandlers.handlePageWaitForSelector(toolArgs);
          case 'page_evaluate':
            return await this.browserHandlers.handlePageEvaluate(toolArgs);
          case 'page_screenshot':
            return await this.browserHandlers.handlePageScreenshot(toolArgs);

          // 🆕 脚本源码
          case 'get_all_scripts':
            return await this.browserHandlers.handleGetAllScripts(toolArgs);
          case 'get_script_source':
            return await this.browserHandlers.handleGetScriptSource(toolArgs);

          // 🆕 控制台监控
          case 'console_enable':
            return await this.browserHandlers.handleConsoleEnable(toolArgs);
          case 'console_get_logs':
            return await this.browserHandlers.handleConsoleGetLogs(toolArgs);
          case 'console_execute':
            return await this.browserHandlers.handleConsoleExecute(toolArgs);

          // 🆕 高级DOM操作
          case 'dom_get_computed_style':
            return await this.browserHandlers.handleDOMGetComputedStyle(toolArgs);
          case 'dom_find_by_text':
            return await this.browserHandlers.handleDOMFindByText(toolArgs);
          case 'dom_get_xpath':
            return await this.browserHandlers.handleDOMGetXPath(toolArgs);
          case 'dom_is_in_viewport':
            return await this.browserHandlers.handleDOMIsInViewport(toolArgs);

          // 🆕 高级页面操作
          case 'page_get_performance':
            return await this.browserHandlers.handlePageGetPerformance(toolArgs);
          case 'page_inject_script':
            return await this.browserHandlers.handlePageInjectScript(toolArgs);
          case 'page_set_cookies':
            return await this.browserHandlers.handlePageSetCookies(toolArgs);
          case 'page_get_cookies':
            return await this.browserHandlers.handlePageGetCookies(toolArgs);
          case 'page_clear_cookies':
            return await this.browserHandlers.handlePageClearCookies(toolArgs);
          case 'page_set_viewport':
            return await this.browserHandlers.handlePageSetViewport(toolArgs);
          case 'page_emulate_device':
            return await this.browserHandlers.handlePageEmulateDevice(toolArgs);
          case 'page_get_local_storage':
            return await this.browserHandlers.handlePageGetLocalStorage(toolArgs);
          case 'page_set_local_storage':
            return await this.browserHandlers.handlePageSetLocalStorage(toolArgs);
          case 'page_press_key':
            return await this.browserHandlers.handlePagePressKey(toolArgs);
          case 'page_get_all_links':
            return await this.browserHandlers.handlePageGetAllLinks(toolArgs);

          // 🆕 验证码检测和处理（3个）
          case 'captcha_detect':
            return await this.browserHandlers.handleCaptchaDetect(toolArgs);
          case 'captcha_wait':
            return await this.browserHandlers.handleCaptchaWait(toolArgs);
          case 'captcha_config':
            return await this.browserHandlers.handleCaptchaConfig(toolArgs);

          // 🆕 反检测脚本注入（2个）
          case 'stealth_inject':
            return await this.browserHandlers.handleStealthInject(toolArgs);
          case 'stealth_set_user_agent':
            return await this.browserHandlers.handleStealthSetUserAgent(toolArgs);
          case 'anti_debug_inject':
            return await this.browserHandlers.handleAntiDebugInject(toolArgs);

          // 🆕 AI Hook工具（7个）
          case 'ai_hook_generate':
            return await this.aiHookHandlers.handleAIHookGenerate(toolArgs);
          case 'ai_hook_inject':
            return await this.aiHookHandlers.handleAIHookInject(toolArgs);
          case 'ai_hook_get_data':
            return await this.aiHookHandlers.handleAIHookGetData(toolArgs);
          case 'ai_hook_list':
            return await this.aiHookHandlers.handleAIHookList(toolArgs);
          case 'ai_hook_clear':
            return await this.aiHookHandlers.handleAIHookClear(toolArgs);
          case 'ai_hook_toggle':
            return await this.aiHookHandlers.handleAIHookToggle(toolArgs);
          case 'ai_hook_export':
            return await this.aiHookHandlers.handleAIHookExport(toolArgs);

          // 🆕 调试器控制（7个）
          case 'debugger_enable':
            return await this.debuggerHandlers.handleDebuggerEnable(toolArgs);
          case 'debugger_init_advanced_features':
            return await this.debuggerHandlers.handleDebuggerInitAdvancedFeatures(toolArgs);
          case 'debugger_disable':
            return await this.debuggerHandlers.handleDebuggerDisable(toolArgs);
          case 'debugger_pause':
            return await this.debuggerHandlers.handleDebuggerPause(toolArgs);
          case 'debugger_resume':
            return await this.debuggerHandlers.handleDebuggerResume(toolArgs);
          case 'debugger_step_into':
            return await this.debuggerHandlers.handleDebuggerStepInto(toolArgs);
          case 'debugger_step_over':
            return await this.debuggerHandlers.handleDebuggerStepOver(toolArgs);
          case 'debugger_step_out':
            return await this.debuggerHandlers.handleDebuggerStepOut(toolArgs);

          // 🆕 断点管理（3个）
          case 'breakpoint_set':
            return await this.debuggerHandlers.handleBreakpointSet(toolArgs);
          case 'breakpoint_remove':
            return await this.debuggerHandlers.handleBreakpointRemove(toolArgs);
          case 'breakpoint_list':
            return await this.debuggerHandlers.handleBreakpointList(toolArgs);
          case 'breakpoint_set_on_text':
            return await this.debuggerHandlers.handleBreakpointSetOnText(toolArgs);

          // 🆕 运行时检查（1个）
          case 'get_call_stack':
            return await this.debuggerHandlers.handleGetCallStack(toolArgs);

          // 🆕 高级调试功能（6个）
          case 'debugger_evaluate':
            return await this.debuggerHandlers.handleDebuggerEvaluate(toolArgs);
          case 'debugger_evaluate_global':
            return await this.debuggerHandlers.handleDebuggerEvaluateGlobal(toolArgs);
          case 'debugger_wait_for_paused':
            return await this.debuggerHandlers.handleDebuggerWaitForPaused(toolArgs);
          case 'debugger_get_paused_state':
            return await this.debuggerHandlers.handleDebuggerGetPausedState(toolArgs);
          case 'breakpoint_set_on_exception':
            return await this.debuggerHandlers.handleBreakpointSetOnException(toolArgs);
          case 'get_object_properties':
            return await this.debuggerHandlers.handleGetObjectProperties(toolArgs);

          // ✨ 增强调试功能（5个）
          case 'get_scope_variables_enhanced':
            return await this.debuggerHandlers.handleGetScopeVariablesEnhanced(toolArgs);
          case 'debugger_save_session':
            return await this.debuggerHandlers.handleSaveSession(toolArgs);
          case 'debugger_load_session':
            return await this.debuggerHandlers.handleLoadSession(toolArgs);
          case 'debugger_export_session':
            return await this.debuggerHandlers.handleExportSession(toolArgs);
          case 'debugger_list_sessions':
            return await this.debuggerHandlers.handleListSessions(toolArgs);

          // 🆕 高级调试功能（15个新工具）
          // Watch Expressions
          case 'watch_add':
            return await this.debuggerHandlers.handleWatchAdd(toolArgs);
          case 'watch_remove':
            return await this.debuggerHandlers.handleWatchRemove(toolArgs);
          case 'watch_list':
            return await this.debuggerHandlers.handleWatchList(toolArgs);
          case 'watch_evaluate_all':
            return await this.debuggerHandlers.handleWatchEvaluateAll(toolArgs);
          case 'watch_clear_all':
            return await this.debuggerHandlers.handleWatchClearAll(toolArgs);

          // XHR Breakpoints
          case 'xhr_breakpoint_set':
            return await this.debuggerHandlers.handleXHRBreakpointSet(toolArgs);
          case 'xhr_breakpoint_remove':
            return await this.debuggerHandlers.handleXHRBreakpointRemove(toolArgs);
          case 'xhr_breakpoint_list':
            return await this.debuggerHandlers.handleXHRBreakpointList(toolArgs);

          // Event Breakpoints
          case 'event_breakpoint_set':
            return await this.debuggerHandlers.handleEventBreakpointSet(toolArgs);
          case 'event_breakpoint_set_category':
            return await this.debuggerHandlers.handleEventBreakpointSetCategory(toolArgs);
          case 'event_breakpoint_remove':
            return await this.debuggerHandlers.handleEventBreakpointRemove(toolArgs);
          case 'event_breakpoint_list':
            return await this.debuggerHandlers.handleEventBreakpointList(toolArgs);

          // Blackboxing
          case 'blackbox_add':
            return await this.debuggerHandlers.handleBlackboxAdd(toolArgs);
          case 'blackbox_add_common':
            return await this.debuggerHandlers.handleBlackboxAddCommon(toolArgs);
          case 'blackbox_list':
            return await this.debuggerHandlers.handleBlackboxList(toolArgs);

          // 🆕 网络监控（6个P2工具）
          case 'network_enable':
            return await this.advancedHandlers.handleNetworkEnable(toolArgs);
          case 'network_disable':
            return await this.advancedHandlers.handleNetworkDisable(toolArgs);
          case 'network_get_status':
            return await this.advancedHandlers.handleNetworkGetStatus(toolArgs);
          case 'network_get_requests':
            return await this.advancedHandlers.handleNetworkGetRequests(toolArgs);
          case 'network_get_response_body':
            return await this.advancedHandlers.handleNetworkGetResponseBody(toolArgs);
          case 'network_get_request_initiator':
            return await this.advancedHandlers.handleNetworkGetRequestInitiator(toolArgs);
          case 'network_get_stats':
            return await this.advancedHandlers.handleNetworkGetStats(toolArgs);

          // 🆕 性能分析（4个P2工具）
          case 'performance_get_metrics':
            return await this.advancedHandlers.handlePerformanceGetMetrics(toolArgs);
          case 'performance_start_coverage':
            return await this.advancedHandlers.handlePerformanceStartCoverage(toolArgs);
          case 'performance_stop_coverage':
            return await this.advancedHandlers.handlePerformanceStopCoverage(toolArgs);
          case 'performance_take_heap_snapshot':
            return await this.advancedHandlers.handlePerformanceTakeHeapSnapshot(toolArgs);

          // 🆕 控制台高级功能（5个P2工具）
          case 'console_get_exceptions':
            return await this.advancedHandlers.handleConsoleGetExceptions(toolArgs);
          case 'console_inject_script_monitor':
            return await this.advancedHandlers.handleConsoleInjectScriptMonitor(toolArgs);
          case 'console_inject_xhr_interceptor':
            return await this.advancedHandlers.handleConsoleInjectXhrInterceptor(toolArgs);
          case 'console_inject_fetch_interceptor':
            return await this.advancedHandlers.handleConsoleInjectFetchInterceptor(toolArgs);
          case 'console_inject_function_tracer':
            return await this.advancedHandlers.handleConsoleInjectFunctionTracer(toolArgs);
          case 'hook_function':
            return await this.handleHookFunction(toolArgs);
          case 'trace_function':
            return await this.handleTraceFunction(toolArgs);

          default:
            throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * 获取工具列表
   */
  private getTools(): Tool[] {
    return [
      {
        name: 'collect_code',
        description: 'Collect JavaScript code from a target website. 🆕 Supports smart collection modes: summary (fast analysis), priority (key code first), full (complete). Use summary mode for large websites to avoid token overflow.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Target website URL',
            },
            includeInline: {
              type: 'boolean',
              description: 'Include inline scripts',
              default: true,
            },
            includeExternal: {
              type: 'boolean',
              description: 'Include external scripts',
              default: true,
            },
            includeDynamic: {
              type: 'boolean',
              description: 'Include dynamically loaded scripts',
              default: false,
            },
            smartMode: {
              type: 'string',
              description: '🆕 Smart collection mode: "summary" (only metadata, fastest), "priority" (key code first), "incremental" (on-demand), "full" (all code, default)',
              enum: ['summary', 'priority', 'incremental', 'full'],
              default: 'full',
            },
            compress: {
              type: 'boolean',
              description: '🆕 Enable gzip compression (70-90% size reduction). Compression info saved in metadata.',
              default: false,
            },
            maxTotalSize: {
              type: 'number',
              description: '🆕 Maximum total size in bytes (default: 2MB). Used with priority/incremental modes.',
              default: 2097152,
            },
            maxFileSize: {
              type: 'number',
              description: 'Maximum single file size in KB (default: 500KB). Files larger than this will be truncated.',
              default: 500,
            },
            priorities: {
              type: 'array',
              description: '🆕 Priority URL patterns for priority mode (e.g., ["encrypt", "crypto", "sign"]). Files matching these patterns are collected first.',
              items: { type: 'string' },
            },
            returnSummaryOnly: {
              type: 'boolean',
              description: '⚠️ DEPRECATED: Use smartMode="summary" instead.',
              default: false,
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'search_in_scripts',
        description: `🆕 Search for keywords in collected scripts. Auto-truncates large results to avoid context overflow.

Prerequisite:
- Call collect_code(url=...) first to collect target scripts.

Use this tool when:
- You need to find where a specific function/variable is defined
- Looking for API endpoints or encryption algorithms
- Searching for specific patterns in large codebases

⚠️ IMPORTANT: Large results (>50KB) automatically return summary only. Use specific keywords to reduce matches.

Example:
search_in_scripts(keyword="a_bogus", contextLines=5, maxMatches=50)
→ Returns all occurrences with surrounding code`,
        inputSchema: {
          type: 'object',
          properties: {
            keyword: {
              type: 'string',
              description: 'Keyword to search for (supports regex if isRegex=true)',
            },
            isRegex: {
              type: 'boolean',
              description: 'Whether the keyword is a regular expression',
              default: false,
            },
            caseSensitive: {
              type: 'boolean',
              description: 'Whether the search is case-sensitive',
              default: false,
            },
            contextLines: {
              type: 'number',
              description: 'Number of context lines to include before and after matches',
              default: 3,
            },
            maxMatches: {
              type: 'number',
              description: 'Maximum number of matches to return (default: 100). Reduce this if getting summary-only results.',
              default: 100,
            },
            returnSummary: {
              type: 'boolean',
              description: '🆕 Return summary only (match count, preview) instead of full results. Useful for large result sets.',
              default: false,
            },
            maxContextSize: {
              type: 'number',
              description: '🆕 Maximum result size in bytes (default: 50KB). Results larger than this return summary only.',
              default: 50000,
            },
          },
          required: ['keyword'],
        },
      },
      {
        name: 'extract_function_tree',
        description: `Extract a function and all its dependencies from collected scripts.

This tool solves the context overflow problem by extracting only relevant code instead of analyzing entire files.

Use this tool when:
- You want to analyze a specific function (e.g., "sign", "encrypt")
- Need to understand function dependencies
- Want to avoid context overflow with large files

Example workflow:
1. search_in_scripts(keyword="a_bogus") → Find which file contains it
2. extract_function_tree(functionName="sign", maxDepth=3) → Extract sign() and its dependencies
3. analyze_code_chunk(code=extractedCode) → Analyze the small extracted code

Returns:
- Complete code of the function and its dependencies
- Call graph showing relationships
- Total size (much smaller than original file)`,
        inputSchema: {
          type: 'object',
          properties: {
            scriptId: {
              type: 'string',
              description: 'Script ID from collect_code or search_in_scripts',
            },
            functionName: {
              type: 'string',
              description: 'Name of the function to extract',
            },
            maxDepth: {
              type: 'number',
              description: 'Maximum dependency depth to extract',
              default: 3,
            },
            maxSize: {
              type: 'number',
              description: 'Maximum total size in KB',
              default: 500,
            },
            includeComments: {
              type: 'boolean',
              description: 'Whether to include comments in extracted code',
              default: true,
            },
          },
          required: ['scriptId', 'functionName'],
        },
      },
      {
        name: 'deobfuscate',
        description: 'AI-driven code deobfuscation',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Obfuscated code to deobfuscate',
            },
            llm: {
              type: 'string',
              enum: ['gpt-4', 'claude'],
              description: 'LLM to use for deobfuscation',
              default: 'gpt-4',
            },
            aggressive: {
              type: 'boolean',
              description: 'Use aggressive deobfuscation',
              default: false,
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'understand_code',
        description: 'AI-assisted code semantic understanding',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Code to analyze',
            },
            context: {
              type: 'object',
              description: 'Additional context for analysis',
            },
            focus: {
              type: 'string',
              enum: ['structure', 'business', 'security', 'all'],
              description: 'Analysis focus',
              default: 'all',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'detect_crypto',
        description: 'Detect and analyze encryption algorithms',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Code to analyze for crypto algorithms',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'manage_hooks',
        description: 'Manage JavaScript hooks for runtime interception',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['create', 'list', 'records', 'clear'],
              description: 'Hook management action',
            },
            target: {
              type: 'string',
              description: 'Hook target (function name, API, etc.)',
            },
            type: {
              type: 'string',
              enum: ['function', 'xhr', 'fetch', 'websocket', 'localstorage', 'cookie'],
              description: 'Type of hook to create',
            },
            hookAction: {
              type: 'string',
              enum: ['log', 'block', 'modify'],
              description: 'What to do when hook is triggered',
              default: 'log',
            },
            customCode: {
              type: 'string',
              description: 'Custom JavaScript code to execute in hook',
            },
            hookId: {
              type: 'string',
              description: 'Hook ID for records/clear actions',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'detect_obfuscation',
        description: 'Detect obfuscation types in JavaScript code (supports 2024-2025 latest techniques)',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Code to analyze for obfuscation',
            },
            generateReport: {
              type: 'boolean',
              description: 'Generate detailed report',
              default: true,
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'advanced_deobfuscate',
        description: 'Advanced deobfuscation supporting VM protection, invisible unicode, control flow flattening, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Obfuscated code to deobfuscate',
            },
            detectOnly: {
              type: 'boolean',
              description: 'Only detect obfuscation types without deobfuscating',
              default: false,
            },
            aggressiveVM: {
              type: 'boolean',
              description: 'Use aggressive VM deobfuscation (experimental)',
              default: false,
            },
            useASTOptimization: {
              type: 'boolean',
              description: 'Apply AST-based optimizations',
              default: true,
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 60000,
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'clear_collected_data',
        description: '🧹 Clear all collected data (file cache, compression cache, collected URLs). Use this when switching to a new website to avoid data interference.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_collection_stats',
        description: '📊 Get statistics about collected data (cache stats, compression stats, collected URLs count).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // 🆕 添加所有新的浏览器控制工具 (36个P0工具)
      ...browserTools,

      // 🆕 添加所有调试器工具 (18个P1工具)
      ...debuggerTools,

      // 🆕 添加所有高级分析工具 (18个P2工具)
      ...advancedTools,

      // 🆕 添加AI Hook工具 (7个工具)
      ...aiHookTools,

      // 🆕 添加 Token 预算管理工具 (3个P0工具)
      ...tokenBudgetTools,

      // 🆕 添加缓存管理工具 (3个P1工具)
      ...cacheTools,
    ];
  }

  /**
   * 处理代码收集（增强版 - 支持智能模式）
   */
  private async handleCollectCode(args: Record<string, unknown>) {
    const returnSummaryOnly = (args.returnSummaryOnly as boolean) ?? false;

    // 🆕 处理智能模式（向后兼容）
    let smartMode = args.smartMode as 'summary' | 'priority' | 'incremental' | 'full' | undefined;
    if (returnSummaryOnly && !smartMode) {
      smartMode = 'summary'; // 兼容旧的 returnSummaryOnly 参数
    }

    const result = await this.collector.collect({
      url: args.url as string,
      includeInline: args.includeInline as boolean | undefined,
      includeExternal: args.includeExternal as boolean | undefined,
      includeDynamic: args.includeDynamic as boolean | undefined,
      // 🆕 传递智能收集参数
      smartMode: smartMode,
      compress: args.compress as boolean | undefined,
      maxTotalSize: args.maxTotalSize as number | undefined,
      maxFileSize: args.maxFileSize ? (args.maxFileSize as number) * 1024 : undefined, // KB -> bytes
      priorities: args.priorities as string[] | undefined,
    });

    // ✅ 如果用户明确要求只返回摘要
    if (returnSummaryOnly) {
      logger.info('📋 Returning summary only (user requested)');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              mode: 'summary',
              totalSize: result.totalSize,
              totalSizeKB: (result.totalSize / 1024).toFixed(2),
              filesCount: result.files.length,
              collectTime: result.collectTime,
              summary: result.files.map(f => ({
                url: f.url,
                type: f.type,
                size: f.size,
                sizeKB: (f.size / 1024).toFixed(2),
                truncated: f.metadata?.truncated || false,
                preview: f.content.substring(0, 200) + '...',
              })),
              hint: 'Use get_script_source tool to fetch specific files',
            }, null, 2),
          },
        ],
      };
    }

    // ✅ 智能返回：如果文件太多或太大，自动返回摘要
    const totalSize = result.totalSize;
    const MAX_SAFE_SIZE = 1 * 1024 * 1024; // 1MB

    if (totalSize > MAX_SAFE_SIZE) {
      logger.warn(`⚠️  Total code size (${(totalSize / 1024).toFixed(2)} KB) exceeds safe limit (${MAX_SAFE_SIZE / 1024} KB), auto-switching to summary mode`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              warning: '⚠️ Code size too large for full response - auto-switched to summary mode',
              totalSize,
              totalSizeKB: (totalSize / 1024).toFixed(2),
              filesCount: result.files.length,
              collectTime: result.collectTime,
              summary: result.files.map(f => ({
                url: f.url,
                type: f.type,
                size: f.size,
                sizeKB: (f.size / 1024).toFixed(2),
                truncated: f.metadata?.truncated || false,
                preview: f.content.substring(0, 200) + '...',
              })),
              recommendations: [
                '1. Use get_script_source to fetch specific files',
                '2. Filter files by URL pattern (e.g., files containing "encrypt" or "api")',
                '3. Use returnSummaryOnly=true parameter to explicitly request summary mode',
                '4. Enable caching to speed up repeated requests',
              ],
            }, null, 2),
          },
        ],
      };
    }

    // ✅ 正常返回完整代码
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理代码搜索 - 使用 ScriptManager（增强版 - 防止上下文溢出）
   */
  private async handleSearchInScripts(args: Record<string, unknown>) {
    const keyword = args.keyword as string;
    if (!keyword || typeof keyword !== 'string') {
      throw new Error('keyword is required');
    }

    const { ScriptManager } = await import('../modules/debugger/ScriptManager.js');
    const scriptManager = new ScriptManager(this.collector);

    await scriptManager.init();

    const maxMatches = (args.maxMatches as number) ?? 100;
    const returnSummary = (args.returnSummary as boolean) ?? false;
    const maxContextSize = (args.maxContextSize as number) ?? 50000; // 默认 50KB
    const isRegex = (args.isRegex as boolean) ?? false;
    const caseSensitive = (args.caseSensitive as boolean) ?? false;
    const contextLines = (args.contextLines as number) ?? 3;

    const liveResult = await scriptManager.searchInScripts(keyword, {
      isRegex,
      caseSensitive,
      contextLines,
      maxMatches: maxMatches,
    });

    // 回退：实时脚本未命中时，改为搜索 collect_code 已缓存的文件
    let cacheMatches: Array<{
      scriptId: string;
      url: string;
      line: number;
      column: number;
      matchText: string;
      context: string;
    }> = [];
    if ((liveResult.matches?.length ?? 0) === 0) {
      cacheMatches = this.searchInCollectedFiles(keyword, {
        isRegex,
        caseSensitive,
        contextLines,
        maxMatches,
      });
    }

    const mergedMatches = (liveResult.matches?.length ?? 0) > 0 ? (liveResult.matches || []) : cacheMatches;
    const result = {
      keyword,
      totalMatches: mergedMatches.length,
      matches: mergedMatches,
      source: (liveResult.matches?.length ?? 0) > 0 ? 'live-scripts' : 'collected-cache',
      hint:
        (liveResult.matches?.length ?? 0) > 0
          ? undefined
          : 'No live scripts matched; searched collected cache from collect_code.',
    };

    // 🆕 计算结果大小
    const resultStr = JSON.stringify(result);
    const resultSize = resultStr.length;
    const isTooLarge = resultSize > maxContextSize;

    // 🆕 如果结果太大或用户要求摘要，返回摘要
    if (returnSummary || isTooLarge) {
      const summary = {
        success: true,
        keyword,
        totalMatches: result.matches?.length || 0,
        resultSize: resultSize,
        resultSizeKB: (resultSize / 1024).toFixed(2),
        truncated: isTooLarge,
        source: (result as any).source,
        reason: isTooLarge
          ? `Result too large (${(resultSize / 1024).toFixed(2)} KB > ${(maxContextSize / 1024).toFixed(2)} KB)`
          : 'Summary mode enabled',
        matchesSummary: (result.matches || []).slice(0, 10).map((m: any) => ({
          scriptId: m.scriptId,
          url: m.url,
          line: m.line,
          preview: m.context?.substring(0, 100) + '...',
        })),
        tip: isTooLarge
          ? 'Reduce maxMatches parameter or use more specific keyword to get full results'
          : 'Set returnSummary=false to get full results',
        recommendations: [
          '1. Use more specific keywords to reduce matches',
          '2. Reduce maxMatches parameter (current: ' + maxMatches + ')',
          '3. Use get_script_source to fetch specific files',
          '4. Filter by scriptId or URL pattern',
        ],
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }

    // 返回完整结果
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 在 collect_code 的缓存文件中搜索关键词（回退路径）
   */
  private searchInCollectedFiles(
    keyword: string,
    options: {
      isRegex?: boolean;
      caseSensitive?: boolean;
      contextLines?: number;
      maxMatches?: number;
    } = {}
  ): Array<{
    scriptId: string;
    url: string;
    line: number;
    column: number;
    matchText: string;
    context: string;
  }> {
    const {
      isRegex = false,
      caseSensitive = false,
      contextLines = 3,
      maxMatches = 100,
    } = options;

    const files = this.collector.getAllCollectedFiles();
    if (files.length === 0) {
      return [];
    }

    const searchRegex = isRegex
      ? new RegExp(keyword, caseSensitive ? 'g' : 'gi')
      : new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');

    const matches: Array<{
      scriptId: string;
      url: string;
      line: number;
      column: number;
      matchText: string;
      context: string;
    }> = [];

    for (const file of files) {
      if (!file.content || matches.length >= maxMatches) {
        break;
      }

      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxMatches) {
          break;
        }
        const line = lines[i];
        if (!line) {
          continue;
        }

        const lineMatches = Array.from(line.matchAll(searchRegex));
        for (const match of lineMatches) {
          if (matches.length >= maxMatches) {
            break;
          }
          const startLine = Math.max(0, i - contextLines);
          const endLine = Math.min(lines.length - 1, i + contextLines);
          matches.push({
            scriptId: file.url,
            url: file.url,
            line: i + 1,
            column: match.index || 0,
            matchText: match[0],
            context: lines.slice(startLine, endLine + 1).join('\n'),
          });
        }
      }
    }

    return matches;
  }

  /**
   * 处理函数提取 - 使用 ScriptManager
   */
  private async handleExtractFunctionTree(args: Record<string, unknown>) {
    const { ScriptManager } = await import('../modules/debugger/ScriptManager.js');
    const scriptManager = new ScriptManager(this.collector);

    await scriptManager.init();

    const result = await scriptManager.extractFunctionTree(
      args.scriptId as string,
      args.functionName as string,
      {
        maxDepth: args.maxDepth as number,
        maxSize: args.maxSize as number,
        includeComments: args.includeComments as boolean,
      }
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理反混淆
   */
  private async handleDeobfuscate(args: Record<string, unknown>) {
    const result = await this.deobfuscator.deobfuscate({
      code: args.code as string,
      llm: args.llm as 'gpt-4' | 'claude' | undefined,
      aggressive: args.aggressive as boolean | undefined,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理代码理解
   */
  private async handleUnderstandCode(args: Record<string, unknown>) {
    const result = await this.analyzer.understand({
      code: args.code as string,
      context: args.context as Record<string, unknown> | undefined,
      focus: (args.focus as 'structure' | 'business' | 'security' | 'all') || 'all',
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理加密检测
   */
  private async handleDetectCrypto(args: Record<string, unknown>) {
    const result = await this.cryptoDetector.detect({
      code: args.code as string,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理Hook管理
   */
  private async handleManageHooks(args: Record<string, unknown>) {
    const action = args.action as string;

    switch (action) {
      case 'create': {
        const result = await this.hookManager.createHook({
          target: args.target as string,
          type: args.type as 'function' | 'xhr' | 'fetch' | 'websocket' | 'localstorage' | 'cookie',
          action: (args.hookAction as 'log' | 'block' | 'modify') || 'log',
          customCode: args.customCode as string | undefined,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list': {
        const hooks = this.hookManager.getAllHooks();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ hooks }, null, 2),
            },
          ],
        };
      }

      case 'records': {
        const hookId = args.hookId as string;
        const records = this.hookManager.getHookRecords(hookId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ records }, null, 2),
            },
          ],
        };
      }

      case 'clear': {
        this.hookManager.clearHookRecords(args.hookId as string | undefined);
        return {
          content: [
            {
              type: 'text',
              text: 'Hook records cleared',
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown hook action: ${action}`);
    }
  }

  /**
   * Hook 指定函数（创建并注入）
   */
  private async handleHookFunction(args: Record<string, unknown>) {
    const expression = args.expression as string;
    const logStack = (args.logStack as boolean) === true;

    if (!expression) {
      throw new Error('expression is required');
    }

    const hook = await this.hookManager.createHook({
      target: expression,
      type: 'function',
      action: 'log',
    });

    const page = await this.collector.getActivePage();

    // 立即在当前页面生效
    await page.evaluate(hook.script);
    // 后续页面导航时持续生效
    await page.evaluateOnNewDocument(hook.script);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Function hook injected: ${expression}`,
              expression,
              hookId: hook.hookId,
              stackIncludedByDefault: true,
              requestedLogStack: logStack,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * 追踪函数调用（等价于 hook_function + logStack=true）
   */
  private async handleTraceFunction(args: Record<string, unknown>) {
    return this.handleHookFunction({
      ...args,
      logStack: true,
    });
  }

  /**
   * 处理混淆检测
   */
  private async handleDetectObfuscation(args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    const code = args.code as string;
    const generateReport = (args.generateReport as boolean) ?? true;

    const result = this.obfuscationDetector.detect(code);

    let text = JSON.stringify(result, null, 2);

    if (generateReport) {
      text += '\n\n' + this.obfuscationDetector.generateReport(result);
    }

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  }

  /**
   * 处理高级反混淆
   */
  private async handleAdvancedDeobfuscate(args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    const code = args.code as string;
    const detectOnly = (args.detectOnly as boolean) ?? false;
    const aggressiveVM = (args.aggressiveVM as boolean) ?? false;
    const useASTOptimization = (args.useASTOptimization as boolean) ?? true;
    const timeout = (args.timeout as number) ?? 60000;

    // 高级反混淆
    const result = await this.advancedDeobfuscator.deobfuscate({
      code,
      detectOnly,
      aggressiveVM,
      timeout,
    });

    let finalCode = result.code;

    // AST优化
    if (useASTOptimization && !detectOnly) {
      logger.info('Applying AST optimizations...');
      finalCode = this.astOptimizer.optimize(finalCode);
    }

    const response = {
      ...result,
      code: finalCode,
      astOptimized: useASTOptimization && !detectOnly,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  /**
   * 🆕 处理清除收集数据
   */
  private async handleClearCollectedData(_args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      await this.collector.clearAllData();

      // 同时清除 ScriptManager 的数据
      this.scriptManager.clear();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: '✅ All collected data cleared successfully',
              cleared: {
                fileCache: true,
                compressionCache: true,
                collectedUrls: true,
                scriptManager: true,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to clear collected data:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * 🆕 处理获取收集统计
   */
  private async handleGetCollectionStats(_args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      const stats = await this.collector.getAllStats();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              stats,
              summary: {
                totalCachedFiles: stats.cache.memoryEntries + stats.cache.diskEntries,
                totalCacheSize: `${(stats.cache.totalSize / 1024).toFixed(2)} KB`,
                compressionRatio: `${stats.compression.averageRatio.toFixed(1)}%`,
                cacheHitRate: stats.compression.cacheHits > 0
                  ? `${((stats.compression.cacheHits / (stats.compression.cacheHits + stats.compression.cacheMisses)) * 100).toFixed(1)}%`
                  : '0%',
                collectedUrls: stats.collector.collectedUrls,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to get collection stats:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * 🆕 处理获取 Token 预算统计
   */
  private async handleGetTokenBudgetStats(_args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      const stats = this.tokenBudget.getStats();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              ...stats,
              sessionDuration: `${Math.round((Date.now() - (stats as any).sessionStartTime) / 1000)}s`,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to get token budget stats:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * 🆕 处理手动 Token 清理
   */
  private async handleManualTokenCleanup(_args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      const beforeStats = this.tokenBudget.getStats();
      this.tokenBudget.manualCleanup();
      const afterStats = this.tokenBudget.getStats();

      const freed = beforeStats.currentUsage - afterStats.currentUsage;
      const freedPercentage = Math.round((freed / beforeStats.maxTokens) * 100);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Manual cleanup completed',
              before: {
                usage: beforeStats.currentUsage,
                percentage: beforeStats.usagePercentage,
              },
              after: {
                usage: afterStats.currentUsage,
                percentage: afterStats.usagePercentage,
              },
              freed: {
                tokens: freed,
                percentage: freedPercentage,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to perform manual cleanup:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * 🆕 处理重置 Token 预算
   */
  private async handleResetTokenBudget(_args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      this.tokenBudget.reset();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Token budget reset successfully',
              currentUsage: 0,
              maxTokens: 200000,
              usagePercentage: 0,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to reset token budget:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * 🆕 处理获取缓存统计
   */
  private async handleGetCacheStats(_args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      const stats = await this.unifiedCache.getGlobalStats();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              ...stats,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to get cache stats:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * 🆕 处理智能缓存清理
   */
  private async handleSmartCacheCleanup(args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      const targetSize = args.targetSize as number | undefined;
      const result = await this.unifiedCache.smartCleanup(targetSize);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              ...result,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to cleanup cache:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * 🆕 处理清除所有缓存
   */
  private async handleClearAllCaches(_args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    try {
      await this.unifiedCache.clearAll();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'All caches cleared',
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to clear all caches:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    logger.info('Starting MCP server...');

    try {
      // 🆕 异步注册缓存
      await this.registerCaches();
      
      // 初始化缓存
      await this.cache.init();
      logger.info('Cache initialized');

      // 创建传输层
      const transport = new StdioServerTransport();
      logger.info('Transport created');

      // 连接服务器和传输层
      await this.server.connect(transport);
      logger.success('MCP server connected to transport');

      logger.success('MCP server started successfully');
    } catch (error) {
      logger.error('Failed to start MCP server:', error);
      throw error;
    }
  }

  /**
   * 关闭服务器
   */
  async close(): Promise<void> {
    logger.info('Closing MCP server...');
    await this.collector.close();
    await this.server.close();
    logger.success('MCP server closed');
  }
}