/**
 * 浏览器工具处理器
 *
 * 包含所有新增的浏览器控制、DOM查询、脚本管理等工具的处理器
 *
 * 2024-2025更新：
 * - 集成验证码自动检测
 * - 支持无头/有头模式动态切换
 * - 增强反检测能力
 */

import type { CodeCollector } from '../modules/collector/CodeCollector.js';
import type { PageController } from '../modules/collector/PageController.js';
import type { DOMInspector } from '../modules/collector/DOMInspector.js';
import type { ScriptManager } from '../modules/debugger/ScriptManager.js';
import type { ConsoleMonitor } from '../modules/monitor/ConsoleMonitor.js';
import { AICaptchaDetector } from '../modules/captcha/AICaptchaDetector.js';
import { LLMService } from '../services/LLMService.js';
import { StealthScripts2025 } from '../modules/stealth/StealthScripts2025.js';
import { DetailedDataManager } from '../utils/detailedDataManager.js';
import { logger } from '../utils/logger.js';

export class BrowserToolHandlers {
  private captchaDetector: AICaptchaDetector;
  private autoDetectCaptcha: boolean = true;
  private autoSwitchHeadless: boolean = true;
  private captchaTimeout: number = 300000; // 5分钟
  private detailedDataManager: DetailedDataManager;

  constructor(
    private collector: CodeCollector,
    private pageController: PageController,
    private domInspector: DOMInspector,
    private scriptManager: ScriptManager,
    private consoleMonitor: ConsoleMonitor,
    llmService: LLMService
  ) {
    // ✅ 传入截图保存目录（默认为 ./screenshots）
    const screenshotDir = process.env.CAPTCHA_SCREENSHOT_DIR || './screenshots';
    this.captchaDetector = new AICaptchaDetector(llmService, screenshotDir);
    this.detailedDataManager = DetailedDataManager.getInstance();
  }

  // ==================== 数据管理 ====================

  /**
   * 获取详细数据
   */
  async handleGetDetailedData(args: Record<string, unknown>) {
    try {
      const detailId = args.detailId as string;
      const path = args.path as string | undefined;

      const data = this.detailedDataManager.retrieve(detailId, path);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                detailId,
                path: path || 'full',
                data,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to get detailed data:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                hint: 'DetailId may have expired (TTL: 10 minutes) or is invalid',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  // ==================== 浏览器生命周期 ====================

  async handleBrowserLaunch(_args: Record<string, unknown>) {
    await this.collector.init();
    const status = await this.collector.getStatus();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Browser launched successfully',
          status,
        }, null, 2),
      }],
    };
  }

  async handleBrowserClose(_args: Record<string, unknown>) {
    await this.collector.close();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Browser closed successfully',
        }, null, 2),
      }],
    };
  }

  async handleBrowserStatus(_args: Record<string, unknown>) {
    const status = await this.collector.getStatus();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(status, null, 2),
      }],
    };
  }

  // ==================== 页面导航 ====================

  async handlePageNavigate(args: Record<string, unknown>) {
    const url = args.url as string;
    const waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' =
      (args.waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2') ?? 'domcontentloaded';
    const timeout = (args.timeout as number) ?? 30000;
    // ✅ 可选的自动网络监控
    const enableNetworkMonitoring = args.enableNetworkMonitoring as boolean | undefined;

    let networkMonitoringEnabled = false;
    if (enableNetworkMonitoring) {
      if (!this.consoleMonitor.isNetworkEnabled()) {
        try {
          await this.consoleMonitor.enable({
            enableNetwork: true,
            enableExceptions: true,
          });
          networkMonitoringEnabled = true;
          logger.info('✅ Network monitoring auto-enabled before navigation');
        } catch (error) {
          logger.warn('Failed to auto-enable network monitoring:', error);
        }
      } else {
        networkMonitoringEnabled = true;
        logger.info('✅ Network monitoring already enabled');
      }
    }

    try {
      await this.pageController.navigate(url, { waitUntil, timeout });
    } catch (navError: unknown) {
      logger.error('Navigation error:', navError);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: navError instanceof Error ? navError.message : String(navError),
            url,
            hint: 'Try increasing timeout or using waitUntil: "domcontentloaded"',
          }, null, 2),
        }],
      };
    }

    // 自动检测验证码
    if (this.autoDetectCaptcha) {
      const page = await this.pageController.getPage();
      if (page) {
        const captchaResult = await this.captchaDetector.detect(page);

        if (captchaResult.detected) {
          logger.warn(`⚠️ 检测到验证码 (类型: ${captchaResult.type}, 置信度: ${captchaResult.confidence}%)`);

          // 返回验证码检测结果，让用户决定如何处理
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                captcha_detected: true,
                captcha_info: captchaResult,
                url: await this.pageController.getURL(),
                title: await this.pageController.getTitle(),
                message: '检测到验证码，请使用 captcha_handle 工具处理或手动完成验证',
                network_monitoring_enabled: networkMonitoringEnabled,
              }, null, 2),
            }],
          };
        }
      }
    }

    const currentUrl = await this.pageController.getURL();
    const title = await this.pageController.getTitle();

    // ✅ 如果启用了网络监控，返回状态信息
    const result: any = {
      success: true,
      captcha_detected: false,
      url: currentUrl,
      title,
    };

    if (networkMonitoringEnabled) {
      const networkStatus = this.consoleMonitor.getNetworkStatus();
      result.network_monitoring = {
        enabled: true,
        auto_enabled: true,
        message: '✅ Network monitoring is active. Use network_get_requests to retrieve captured requests.',
        requestCount: networkStatus.requestCount,
        responseCount: networkStatus.responseCount,
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }

  async handlePageReload(_args: Record<string, unknown>) {
    await this.pageController.reload();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Page reloaded',
        }, null, 2),
      }],
    };
  }

  async handlePageBack(_args: Record<string, unknown>) {
    await this.pageController.goBack();
    const url = await this.pageController.getURL();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          url,
        }, null, 2),
      }],
    };
  }

  async handlePageForward(_args: Record<string, unknown>) {
    await this.pageController.goForward();
    const url = await this.pageController.getURL();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          url,
        }, null, 2),
      }],
    };
  }

  // ==================== DOM查询 ====================

  async handleDOMQuerySelector(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const getAttributes = (args.getAttributes as boolean) ?? true;

    const element = await this.domInspector.querySelector(selector, getAttributes);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(element, null, 2),
      }],
    };
  }

  async handleDOMQueryAll(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const limit = (args.limit as number) ?? 100;

    const elements = await this.domInspector.querySelectorAll(selector, limit);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: elements.length,
          elements,
        }, null, 2),
      }],
    };
  }

  async handleDOMGetStructure(args: Record<string, unknown>) {
    const maxDepth = (args.maxDepth as number) ?? 3;
    const includeText = (args.includeText as boolean) ?? true;

    const structure = await this.domInspector.getStructure(maxDepth, includeText);

    // 🔑 智能处理：大 DOM 结构自动返回摘要 + detailId
    const processedStructure = this.detailedDataManager.smartHandle(structure, 51200);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(processedStructure, null, 2),
        },
      ],
    };
  }

  async handleDOMFindClickable(args: Record<string, unknown>) {
    const filterText = args.filterText as string | undefined;

    const clickable = await this.domInspector.findClickable(filterText);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: clickable.length,
          elements: clickable,
        }, null, 2),
      }],
    };
  }

  // ==================== 页面交互 ====================

  async handlePageClick(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const button = args.button as any;
    const clickCount = args.clickCount as number;
    const delay = args.delay as number;

    await this.pageController.click(selector, { button, clickCount, delay });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Clicked: ${selector}`,
        }, null, 2),
      }],
    };
  }

  async handlePageType(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const text = args.text as string;
    const delay = args.delay as number;

    await this.pageController.type(selector, text, { delay });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Typed into ${selector}`,
        }, null, 2),
      }],
    };
  }

  async handlePageSelect(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const values = args.values as string[];

    await this.pageController.select(selector, ...values);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Selected in ${selector}: ${values.join(', ')}`,
        }, null, 2),
      }],
    };
  }

  async handlePageHover(args: Record<string, unknown>) {
    const selector = args.selector as string;

    await this.pageController.hover(selector);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Hovered: ${selector}`,
        }, null, 2),
      }],
    };
  }

  async handlePageScroll(args: Record<string, unknown>) {
    const x = args.x as number;
    const y = args.y as number;

    await this.pageController.scroll({ x, y });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Scrolled to: x=${x || 0}, y=${y || 0}`,
        }, null, 2),
      }],
    };
  }

  // ==================== 等待和查询 ====================

  async handlePageWaitForSelector(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const timeout = args.timeout as number;

    const result = await this.pageController.waitForSelector(selector, timeout);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }

  async handlePageEvaluate(args: Record<string, unknown>) {
    const code = args.code as string;
    const autoSummarize = (args.autoSummarize as boolean) ?? true;
    const maxSize = (args.maxSize as number) ?? 51200; // 50KB

    const result = await this.pageController.evaluate(code);

    // 🔑 智能处理：大数据自动返回摘要 + detailId
    const processedResult = autoSummarize
      ? this.detailedDataManager.smartHandle(result, maxSize)
      : result;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              result: processedResult,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageScreenshot(args: Record<string, unknown>) {
    const path = args.path as string;
    const type = args.type as 'png' | 'jpeg';
    const quality = args.quality as number;
    const fullPage = args.fullPage as boolean;

    const buffer = await this.pageController.screenshot({ path, type, quality, fullPage });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Screenshot taken${path ? `: ${path}` : ''}`,
          size: buffer.length,
        }, null, 2),
      }],
    };
  }

  // ==================== 脚本源码 ====================

  async handleGetAllScripts(args: Record<string, unknown>) {
    const includeSource = (args.includeSource as boolean) ?? false;

    const scripts = await this.scriptManager.getAllScripts(includeSource);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: scripts.length,
          scripts,
        }, null, 2),
      }],
    };
  }

  async handleGetScriptSource(args: Record<string, unknown>) {
    const scriptId = args.scriptId as string | undefined;
    const url = args.url as string | undefined;
    const preview = (args.preview as boolean) ?? false;
    const maxLines = (args.maxLines as number) ?? 100;
    const startLine = args.startLine as number | undefined;
    const endLine = args.endLine as number | undefined;

    const script = await this.scriptManager.getScriptSource(scriptId, url);

    if (!script) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Script not found',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // 🔑 处理预览模式或部分获取
    if (preview || startLine !== undefined || endLine !== undefined) {
      const source = script.source || '';
      const lines = source.split('\n');
      const totalLines = lines.length;
      const size = source.length;

      let previewContent: string;
      let actualStartLine: number;
      let actualEndLine: number;

      if (startLine !== undefined && endLine !== undefined) {
        // 部分获取
        actualStartLine = Math.max(1, startLine);
        actualEndLine = Math.min(totalLines, endLine);
        previewContent = lines.slice(actualStartLine - 1, actualEndLine).join('\n');
      } else {
        // 预览模式
        actualStartLine = 1;
        actualEndLine = Math.min(maxLines, totalLines);
        previewContent = lines.slice(0, maxLines).join('\n');
      }

      const result = {
        success: true,
        scriptId: script.scriptId,
        url: script.url,
        preview: true,
        totalLines,
        size,
        sizeKB: (size / 1024).toFixed(1) + 'KB',
        showingLines: `${actualStartLine}-${actualEndLine}`,
        content: previewContent,
        hint:
          size > 51200
            ? `⚠️ Script is large (${(size / 1024).toFixed(1)}KB). Use startLine/endLine to get specific sections, or set preview=false to get full source (will return detailId).`
            : 'Set preview=false to get full source',
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    // 🔑 完整源码：智能处理大文件
    const processedScript = this.detailedDataManager.smartHandle(script, 51200);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(processedScript, null, 2),
        },
      ],
    };
  }

  // ==================== 控制台监控 ====================

  async handleConsoleEnable(_args: Record<string, unknown>) {
    await this.consoleMonitor.enable();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Console monitoring enabled',
        }, null, 2),
      }],
    };
  }

  async handleConsoleGetLogs(args: Record<string, unknown>) {
    const type = args.type as any;
    const limit = args.limit as number;
    const since = args.since as number;

    const logs = this.consoleMonitor.getLogs({ type, limit, since });

    const result = {
      count: logs.length,
      logs,
    };

    // 🔑 智能处理：大量日志自动返回摘要 + detailId
    const processedResult = this.detailedDataManager.smartHandle(result, 51200);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(processedResult, null, 2),
        },
      ],
    };
  }

  async handleConsoleExecute(args: Record<string, unknown>) {
    const expression = args.expression as string;

    const result = await this.consoleMonitor.execute(expression);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          result,
        }, null, 2),
      }],
    };
  }

  // ==================== 🆕 高级DOM操作 ====================

  async handleDOMGetComputedStyle(args: Record<string, unknown>) {
    const selector = args.selector as string;

    const styles = await this.domInspector.getComputedStyle(selector);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          selector,
          styles,
        }, null, 2),
      }],
    };
  }

  async handleDOMFindByText(args: Record<string, unknown>) {
    const text = args.text as string;
    const tag = args.tag as string | undefined;

    const elements = await this.domInspector.findByText(text, tag);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: elements.length,
          elements,
        }, null, 2),
      }],
    };
  }

  async handleDOMGetXPath(args: Record<string, unknown>) {
    const selector = args.selector as string;

    const xpath = await this.domInspector.getXPath(selector);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          selector,
          xpath,
        }, null, 2),
      }],
    };
  }

  async handleDOMIsInViewport(args: Record<string, unknown>) {
    const selector = args.selector as string;

    const inViewport = await this.domInspector.isInViewport(selector);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          selector,
          inViewport,
        }, null, 2),
      }],
    };
  }

  // ==================== 🆕 高级页面操作 ====================

  async handlePageGetPerformance(_args: Record<string, unknown>) {
    const metrics = await this.pageController.getPerformanceMetrics();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          metrics,
        }, null, 2),
      }],
    };
  }

  async handlePageInjectScript(args: Record<string, unknown>) {
    const script = args.script as string;

    await this.pageController.injectScript(script);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Script injected',
        }, null, 2),
      }],
    };
  }

  async handlePageSetCookies(args: Record<string, unknown>) {
    const cookies = args.cookies as any[];

    await this.pageController.setCookies(cookies);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Set ${cookies.length} cookies`,
        }, null, 2),
      }],
    };
  }

  async handlePageGetCookies(_args: Record<string, unknown>) {
    const cookies = await this.pageController.getCookies();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: cookies.length,
          cookies,
        }, null, 2),
      }],
    };
  }

  async handlePageClearCookies(_args: Record<string, unknown>) {
    await this.pageController.clearCookies();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Cookies cleared',
        }, null, 2),
      }],
    };
  }

  async handlePageSetViewport(args: Record<string, unknown>) {
    const width = args.width as number;
    const height = args.height as number;

    await this.pageController.setViewport(width, height);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          viewport: { width, height },
        }, null, 2),
      }],
    };
  }

  async handlePageEmulateDevice(args: Record<string, unknown>) {
    const device = args.device as 'iPhone' | 'iPad' | 'Android';

    await this.pageController.emulateDevice(device);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          device,
        }, null, 2),
      }],
    };
  }

  async handlePageGetLocalStorage(_args: Record<string, unknown>) {
    const storage = await this.pageController.getLocalStorage();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: Object.keys(storage).length,
          storage,
        }, null, 2),
      }],
    };
  }

  async handlePageSetLocalStorage(args: Record<string, unknown>) {
    const key = args.key as string;
    const value = args.value as string;

    await this.pageController.setLocalStorage(key, value);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          key,
        }, null, 2),
      }],
    };
  }

  async handlePagePressKey(args: Record<string, unknown>) {
    const key = args.key as string;

    await this.pageController.pressKey(key);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          key,
        }, null, 2),
      }],
    };
  }

  async handlePageGetAllLinks(_args: Record<string, unknown>) {
    const links = await this.pageController.getAllLinks();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: links.length,
          links,
        }, null, 2),
      }],
    };
  }

  // ==================== 验证码检测和处理 (2024-2025新增) ====================

  /**
   * 检测当前页面是否包含验证码
   */
  async handleCaptchaDetect(_args: Record<string, unknown>) {
    const page = await this.pageController.getPage();
    const result = await this.captchaDetector.detect(page);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          captcha_detected: result.detected,
          captcha_info: result,
        }, null, 2),
      }],
    };
  }

  /**
   * 等待用户完成验证码
   */
  async handleCaptchaWait(args: Record<string, unknown>) {
    const timeout = (args.timeout as number) || this.captchaTimeout;
    const page = await this.pageController.getPage();

    logger.info('⏳ 等待用户完成验证码...');
    const completed = await this.captchaDetector.waitForCompletion(page, timeout);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: completed,
          message: completed ? '✅ 验证码已完成' : '❌ 验证码完成超时',
        }, null, 2),
      }],
    };
  }

  /**
   * 配置验证码检测选项
   */
  async handleCaptchaConfig(args: Record<string, unknown>) {
    if (args.autoDetectCaptcha !== undefined) {
      this.autoDetectCaptcha = args.autoDetectCaptcha as boolean;
    }
    if (args.autoSwitchHeadless !== undefined) {
      this.autoSwitchHeadless = args.autoSwitchHeadless as boolean;
    }
    if (args.captchaTimeout !== undefined) {
      this.captchaTimeout = args.captchaTimeout as number;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          config: {
            autoDetectCaptcha: this.autoDetectCaptcha,
            autoSwitchHeadless: this.autoSwitchHeadless,
            captchaTimeout: this.captchaTimeout,
          },
        }, null, 2),
      }],
    };
  }

  // ==================== 反检测脚本注入 (2024-2025新增) ====================

  /**
   * 注入2024-2025最新反检测脚本
   */
  async handleStealthInject(_args: Record<string, unknown>) {
    const page = await this.pageController.getPage();
    await StealthScripts2025.injectAll(page);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: '🛡️ 反检测脚本已注入',
        }, null, 2),
      }],
    };
  }

  /**
   * 设置真实的User-Agent
   */
  async handleStealthSetUserAgent(args: Record<string, unknown>) {
    const platform = (args.platform as 'windows' | 'mac' | 'linux') || 'windows';
    const page = await this.pageController.getPage();

    await StealthScripts2025.setRealisticUserAgent(page, platform);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          platform,
          message: `User-Agent已设置为${platform}平台`,
        }, null, 2),
      }],
    };
  }

  /**
   * 注入 AntiDebug_Breaker 反调试脚本（可按参数开关各项）
   */
  async handleAntiDebugInject(args: Record<string, unknown>) {
    const page = await this.pageController.getPage();
    const enabled: string[] = [];
    const disabled: string[] = [];
    const checks: Array<{ key: string; method: keyof typeof StealthScripts2025; name: string }> = [
      { key: 'bypassDebugger', method: 'bypassDebugger', name: '绕过debugger' },
      { key: 'hookConsoleClear', method: 'hookConsoleClear', name: '禁止清除控制台' },
      { key: 'hookWindowClose', method: 'hookWindowClose', name: '阻止页面关闭' },
      { key: 'hookHistory', method: 'hookHistoryBack', name: '阻止历史跳转' },
      { key: 'fixedWindowSize', method: 'fixedWindowSize', name: '固定窗口大小' },
      { key: 'hookConsoleMethods', method: 'hookConsoleLog', name: '防止重写console' },
      { key: 'bypassPerformanceCheck', method: 'bypassPerformanceCheck', name: '绕过时间差检测' },
      { key: 'hookLocationHref', method: 'hookLocationHref', name: '阻断页面跳转' },
    ];
    for (const check of checks) {
      const isEnabled = args[check.key] !== false;
      if (isEnabled) {
        await (StealthScripts2025[check.method] as (page: import('puppeteer').Page) => Promise<void>)(page);
        enabled.push(check.name);
      } else {
        disabled.push(check.name);
      }
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: '🔒 AntiDebug_Breaker反调试脚本已注入',
          enabled,
          disabled,
          totalEnabled: enabled.length,
          totalDisabled: disabled.length,
        }, null, 2),
      }],
    };
  }
}

