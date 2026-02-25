/**
 * 2024-2025最新反检测脚本库
 * 
 * 基于以下项目的最佳实践：
 * - undetected-chromedriver
 * - puppeteer-extra-plugin-stealth
 * - playwright-stealth
 * 
 * 更新日期: 2025-01-23
 */

import { Page } from 'puppeteer';
import { logger } from '../../utils/logger.js';

export class StealthScripts2025 {
  /**
   * 注入所有反检测脚本
   */
  static async injectAll(page: Page): Promise<void> {
    logger.info('🛡️ 注入2024-2025最新反检测脚本...');
    
    await Promise.all([
      this.hideWebDriver(page),
      this.mockChrome(page),
      this.mockPlugins(page),
      this.fixPermissions(page),
      this.mockCanvas(page),
      this.mockWebGL(page),
      this.fixLanguages(page),
      this.mockBattery(page),
      this.fixMediaDevices(page),
      this.mockNotifications(page),
    ]);
    
    logger.info('✅ 反检测脚本注入完成');
  }

  /**
   * 1. 隐藏 WebDriver 属性（2024-2025最新方法）
   *
   * 基于 https://blog.csdn.net/shayuchaor/article/details/103145810
   * 不仅要修改值，还要从原型链上彻底删除属性
   */
  static async hideWebDriver(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      // 方法1: 从原型链上彻底删除 webdriver 属性
      // 这样 Object.getOwnPropertyNames() 也检测不到
      const originalNavigator = navigator;
      delete (Object.getPrototypeOf(originalNavigator) as any).webdriver;

      // 方法2: 如果上面的删除失败，则设置为 undefined
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      // 方法3: 覆盖 Object.getOwnPropertyNames 以隐藏 webdriver
      const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
      Object.getOwnPropertyNames = function(obj: any) {
        const props = originalGetOwnPropertyNames(obj);
        return props.filter(prop => prop !== 'webdriver');
      };
    });
  }

  /**
   * 2. 模拟 Chrome 对象
   */
  static async mockChrome(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      (window as any).chrome = {
        runtime: {
          connect: () => {},
          sendMessage: () => {},
          onMessage: {
            addListener: () => {},
            removeListener: () => {},
          },
        },
        loadTimes: function() {
          return {
            commitLoadTime: Date.now() / 1000,
            connectionInfo: 'http/1.1',
            finishDocumentLoadTime: Date.now() / 1000,
            finishLoadTime: Date.now() / 1000,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: Date.now() / 1000,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'unknown',
            requestTime: 0,
            startLoadTime: Date.now() / 1000,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: false,
            wasNpnNegotiated: false,
          };
        },
        csi: function() {
          return {
            onloadT: Date.now(),
            pageT: Date.now(),
            startE: Date.now(),
            tran: 15,
          };
        },
        app: {},
      };
    });
  }

  /**
   * 3. 模拟真实的 Plugins
   */
  static async mockPlugins(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          {
            0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
            description: 'Portable Document Format',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Plugin',
          },
          {
            0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: '' },
            description: '',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Viewer',
          },
          {
            0: { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
            1: { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' },
            description: '',
            filename: 'internal-nacl-plugin',
            length: 2,
            name: 'Native Client',
          },
        ],
      });
    });
  }

  /**
   * 4. 修复 Permissions API
   */
  static async fixPermissions(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: (Notification as any).permission } as PermissionStatus)
          : originalQuery(parameters);
    });
  }

  /**
   * 5. Canvas 指纹一致性
   */
  static async mockCanvas(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

      // 添加一致的噪声
      const addNoise = (imageData: ImageData) => {
        const data = imageData.data;
        if (data) {
          for (let i = 0; i < data.length; i += 4) {
            data[i] = data[i]! ^ 1; // R
            data[i + 1] = data[i + 1]! ^ 1; // G
            data[i + 2] = data[i + 2]! ^ 1; // B
          }
        }
        return imageData;
      };

      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const context = this.getContext('2d');
        if (context) {
          const imageData = context.getImageData(0, 0, this.width, this.height);
          addNoise(imageData);
          context.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.apply(this, args);
      };

      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        const imageData = originalGetImageData.apply(this, args);
        return addNoise(imageData);
      };
    });
  }

  /**
   * 6. WebGL 指纹模拟
   */
  static async mockWebGL(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) {
          // UNMASKED_VENDOR_WEBGL
          return 'Intel Inc.';
        }
        if (parameter === 37446) {
          // UNMASKED_RENDERER_WEBGL
          return 'Intel Iris OpenGL Engine';
        }
        return getParameter.apply(this, [parameter]);
      };
    });
  }

  /**
   * 7. 语言和时区设置
   */
  static async fixLanguages(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'language', {
        get: () => 'en-US',
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });
  }

  /**
   * 8. Battery API 模拟
   */
  static async mockBattery(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      if ('getBattery' in navigator) {
        const originalGetBattery = (navigator as any).getBattery;
        (navigator as any).getBattery = function() {
          return originalGetBattery.call(navigator).then((battery: any) => {
            Object.defineProperty(battery, 'charging', { get: () => true });
            Object.defineProperty(battery, 'chargingTime', { get: () => 0 });
            Object.defineProperty(battery, 'dischargingTime', { get: () => Infinity });
            Object.defineProperty(battery, 'level', { get: () => 1 });
            return battery;
          });
        };
      }
    });
  }

  /**
   * 9. MediaDevices 修复
   */
  static async fixMediaDevices(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
        navigator.mediaDevices.enumerateDevices = function() {
          return originalEnumerateDevices.call(navigator.mediaDevices).then((devices) => {
            // 确保至少有一些设备
            if (devices.length === 0) {
              return [
                {
                  deviceId: 'default',
                  kind: 'audioinput' as MediaDeviceKind,
                  label: 'Default - Microphone',
                  groupId: 'default',
                  toJSON: () => ({}),
                },
                {
                  deviceId: 'default',
                  kind: 'videoinput' as MediaDeviceKind,
                  label: 'Default - Camera',
                  groupId: 'default',
                  toJSON: () => ({}),
                },
              ];
            }
            return devices;
          });
        };
      }
    });
  }

  /**
   * 10. Notification 权限模拟
   */
  static async mockNotifications(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      if ('Notification' in window) {
        Object.defineProperty(Notification, 'permission', {
          get: () => 'default',
        });
      }
    });
  }

  /**
   * 设置真实的 User-Agent
   */
  static async setRealisticUserAgent(page: Page, platform: 'windows' | 'mac' | 'linux' = 'windows'): Promise<void> {
    const userAgents = {
      windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    const platformMap = {
      windows: 'Win32',
      mac: 'MacIntel',
      linux: 'Linux x86_64',
    };

    await page.setUserAgent(userAgents[platform]);
    
    await page.evaluateOnNewDocument((platformValue) => {
      Object.defineProperty(navigator, 'platform', {
        get: () => platformValue,
      });
      Object.defineProperty(navigator, 'vendor', {
        get: () => 'Google Inc.',
      });
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
      });
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });
    }, platformMap[platform]);
  }

  // ==================== 反反调试 (AntiDebug_Breaker) ====================

  /**
   * 注入 AntiDebug_Breaker 反调试脚本（8 项）
   * 建议在 stealth_inject 之后调用，或在遇到反调试时单独调用
   */
  static async injectAntiDebug(page: Page): Promise<void> {
    logger.info('🔒 注入AntiDebug_Breaker反调试脚本...');
    await Promise.all([
      this.bypassDebugger(page),
      this.hookConsoleClear(page),
      this.hookWindowClose(page),
      this.hookHistoryBack(page),
      this.fixedWindowSize(page),
      this.hookConsoleLog(page),
      this.bypassPerformanceCheck(page),
      this.hookLocationHref(page),
    ]);
    logger.info('✅ 反调试脚本注入完成');
  }

  /** 绕过无限 debugger (eval/Function/constructor) */
  static async bypassDebugger(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const temp_eval = (window as any).eval;
      (window as any).eval = function (this: any, ...args: any[]) {
        if (typeof args[0] === 'string') {
          args[0] = args[0].replaceAll(/debugger/g, '');
        }
        return temp_eval.apply(this, args);
      };
      const Bypass_debugger = Function;
      (globalThis as any).Function = function (this: any, ..._args: any[]) {
        const arr = Array.from(arguments);
        for (let i = 0; i < arr.length; i++) {
          if (typeof arr[i] === 'string') {
            arr[i] = (arr[i] as string).replaceAll(/debugger/g, '');
          }
        }
        return (Bypass_debugger as any).apply(this, arr);
      };
      (Function as any).prototype = (Bypass_debugger as any).prototype;
      (Function as any).prototype.constructor = function (this: any) {
        const arr = Array.from(arguments);
        for (let i = 0; i < arr.length; i++) {
          if (typeof arr[i] === 'string') {
            arr[i] = (arr[i] as string).replaceAll(/debugger/g, '');
          }
        }
        return (Bypass_debugger as any)(...arr);
      };
      ((Function as any).prototype.constructor as any).prototype = (Function as any).prototype;
    });
  }

  /** 禁止 JS 清除控制台 */
  static async hookConsoleClear(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      console.clear = function () {};
    });
  }

  /** 阻止页面关闭反调试 */
  static async hookWindowClose(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      window.close = function () {};
    });
  }

  /** 阻止返回上一页或特定历史页面 */
  static async hookHistoryBack(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      window.history.go = function () {};
      window.history.back = function () {};
    });
  }

  /** 固定窗口大小绕过控制台检测 */
  static async fixedWindowSize(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const inner_height = 660;
      const inner_width = 1366;
      const outer_height = 760;
      const outer_width = 1400;
      const innerHeight_property_accessor = Object.getOwnPropertyDescriptor(
        window,
        'innerHeight'
      );
      const innerHeight_set_accessor = innerHeight_property_accessor?.set;
      Object.defineProperty(window, 'innerHeight', {
        get: function () {
          return inner_height;
        },
        set: function () {
          if (innerHeight_set_accessor) {
            innerHeight_set_accessor.call(window, inner_height);
          }
        },
      });
      const innerWidth_property_accessor = Object.getOwnPropertyDescriptor(
        window,
        'innerWidth'
      );
      const innerWidth_set_accessor = innerWidth_property_accessor?.set;
      Object.defineProperty(window, 'innerWidth', {
        get: function () {
          return inner_width;
        },
        set: function () {
          if (innerWidth_set_accessor) {
            innerWidth_set_accessor.call(window, inner_width);
          }
        },
      });
      const outerWidth_property_accessor = Object.getOwnPropertyDescriptor(
        window,
        'outerWidth'
      );
      const outerWidth_set_accessor = outerWidth_property_accessor?.set;
      Object.defineProperty(window, 'outerWidth', {
        get: function () {
          return outer_width;
        },
        set: function () {
          if (outerWidth_set_accessor) {
            outerWidth_set_accessor.call(window, outer_width);
          }
        },
      });
      const outerHeight_property_accessor = Object.getOwnPropertyDescriptor(
        window,
        'outerHeight'
      );
      const outerHeight_set_accessor = outerHeight_property_accessor?.set;
      Object.defineProperty(window, 'outerHeight', {
        get: function () {
          return outer_height;
        },
        set: function () {
          if (outerHeight_set_accessor) {
            outerHeight_set_accessor.call(window, outer_height);
          }
        },
      });
    });
  }

  /** 防止 JS 重写 console 方法 */
  static async hookConsoleLog(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const methods = ['log', 'warn', 'error', 'info', 'debug', 'table'];
      methods.forEach((method) => {
        const original = (console as any)[method];
        if (original) {
          Object.defineProperty(console, method, {
            value: function (...args: any[]) {
              return original.apply(console, args);
            },
            writable: false,
            configurable: false,
          });
        }
      });
    });
  }

  /** 绕过时间差反调试 */
  static async bypassPerformanceCheck(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const _consoleTable = console.table.bind(console);
      (console as any).table = function (arr: any) {
        if (arr && Array.isArray(arr) && arr.length >= 50) {
          return;
        }
        return _consoleTable.apply(this, arguments as any);
      };
      const _now = performance.now.bind(performance);
      let lastNow = 0;
      performance.now = function () {
        const realNow = _now();
        if (lastNow === 0 || realNow - lastNow > 10) {
          lastNow = realNow;
        }
        return lastNow;
      };
    });
  }

  /** 阻断页面跳转定位 */
  static async hookLocationHref(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      window.onbeforeunload = () => {
        return false;
      };
    });
  }

  /**
   * 获取推荐的启动参数
   */
  static getRecommendedLaunchArgs(): string[] {
    return [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1920,1080',
      '--disable-infobars',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ];
  }
}

