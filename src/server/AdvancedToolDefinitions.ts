/**
 * P2工具定义 - 高级分析功能（新增工具，不重复已有的）
 * 
 * 已在BrowserToolDefinitions.ts中的工具（不重复）：
 * - console_enable, console_get_logs, console_execute (3个)
 * 
 * 本文件新增的P2工具：
 * - 网络监控（5个）
 * - 性能分析（4个）
 * - 存储操作（4个）
 * - 控制台高级功能（5个）
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const advancedTools: Tool[] = [
  // ==================== 网络监控（5个）====================

  {
    name: 'network_enable',
    description: `启用网络监控（监听所有HTTP请求和响应）

⚠️ 重要：网络监控必须在页面加载前启用才能捕获请求！

正确用法：
1. network_enable()
2. page_navigate("https://example.com")
3. network_get_requests()

错误用法：
1. page_navigate("https://example.com")  ❌ 请求不会被捕获
2. network_enable()
3. network_get_requests()  // 返回空数组

提示：也可以使用 page_navigate 的 enableNetworkMonitoring 参数自动启用`,
    inputSchema: {
      type: 'object',
      properties: {
        enableExceptions: {
          type: 'boolean',
          description: '是否同时启用异常监控',
          default: true,
        },
      },
    },
  },

  {
    name: 'network_disable',
    description: '禁用网络监控',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'network_get_status',
    description: '获取网络监控状态（是否启用、请求数量等）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'network_get_requests',
    description: `获取已捕获的网络请求列表（支持过滤）

⚠️ IMPORTANT: Large results (>50KB) automatically return summary + detailId.

前置条件：
1. 必须先调用 network_enable 启用网络监控
2. 必须在启用监控后导航到页面

返回数据包含：
- requestId: 请求ID（用于获取响应体）
- url: 请求URL
- method: HTTP方法（GET/POST等）
- headers: 请求头
- postData: POST数据（如果有）
- timestamp: 时间戳
- type: 资源类型（Document/Script/XHR等）

Best Practices:
1. Use specific URL filter to reduce results
2. Set reasonable limit (default: 50, max: 100)
3. If getting summary, use get_detailed_data(detailId) for full data

示例：
network_enable() → page_navigate("https://api.example.com") → network_get_requests(url="api", limit=20)`,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL过滤（包含匹配），例如 "api" 匹配所有包含api的URL',
        },
        method: {
          type: 'string',
          description: 'HTTP方法过滤（GET, POST, PUT, DELETE等）',
        },
        limit: {
          type: 'number',
          description: '返回的最大数量（默认50，推荐≤100以避免溢出）',
          default: 50,
        },
      },
    },
  },

  {
    name: 'network_get_response_body',
    description: '🆕 Get response body for a specific request. Auto-truncates large responses (>100KB) to avoid context overflow. Use returnSummary=true for large files.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string',
          description: 'Request ID (from network_get_requests)',
        },
        maxSize: {
          type: 'number',
          description: '🆕 Maximum response size in bytes (default: 100KB). Responses larger than this return summary only.',
          default: 100000,
        },
        returnSummary: {
          type: 'boolean',
          description: '🆕 Return summary only (size, preview) instead of full body. Useful for large responses.',
          default: false,
        },
      },
      required: ['requestId'],
    },
  },

  {
    name: 'network_get_request_initiator',
    description: `Get JavaScript initiator info for a request (who triggered this request).

Use case:
- Locate which script/function initiated an API request
- Analyze request stack traces for signature generation paths

Input:
- requestId from network_get_requests`,
    inputSchema: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string',
          description: 'Request ID from network_get_requests',
        },
      },
      required: ['requestId'],
    },
  },

  {
    name: 'network_get_stats',
    description: '获取网络统计信息（请求数、响应数、按方法/状态分组等）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ==================== 性能分析（4个）====================

  {
    name: 'performance_get_metrics',
    description: '获取性能指标（Web Vitals: FCP, LCP, FID, CLS等）',
    inputSchema: {
      type: 'object',
      properties: {
        includeTimeline: {
          type: 'boolean',
          description: '是否包含详细的性能时间线',
          default: false,
        },
      },
    },
  },

  {
    name: 'performance_start_coverage',
    description: '启动代码覆盖率收集',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'performance_stop_coverage',
    description: '停止代码覆盖率收集并获取结果',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'performance_take_heap_snapshot',
    description: '获取堆快照（内存分析）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ==================== 控制台高级功能（5个）====================

  {
    name: 'console_get_exceptions',
    description: '获取捕获的异常列表',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL过滤（包含匹配）',
        },
        limit: {
          type: 'number',
          description: '返回的最大数量',
          default: 50,
        },
      },
    },
  },

  {
    name: 'console_inject_script_monitor',
    description: '注入动态脚本监控器（监听动态添加的script标签）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'console_inject_xhr_interceptor',
    description: '注入XHR拦截器（监控AJAX请求）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'console_inject_fetch_interceptor',
    description: '注入Fetch拦截器（监控Fetch请求）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'console_inject_function_tracer',
    description: '注入函数追踪器（使用Proxy监控函数调用）',
    inputSchema: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: '要追踪的函数名（如window.someFunction）',
        },
      },
      required: ['functionName'],
    },
  },

  // ==================== Hook / 追踪（2个）====================
  {
    name: 'hook_function',
    description: 'Hook 指定函数并记录调用信息（参数/返回值，可选调用栈）',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '目标函数表达式（如 window.encrypt / obj.sign）',
        },
        logStack: {
          type: 'boolean',
          description: '是否额外记录调用栈',
          default: false,
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'trace_function',
    description: '追踪指定函数调用（等价于 hook_function + logStack=true）',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '目标函数表达式（如 window.encrypt / obj.sign）',
        },
      },
      required: ['expression'],
    },
  },
];

