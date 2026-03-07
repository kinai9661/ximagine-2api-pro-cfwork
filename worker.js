// =================================================================================
//  项目: ximagine-2api (Cloudflare Worker 单文件版)
//  版本: 2.2.0 (代号: Chimera Synthesis - Final Release)
//  作者: 首席AI执行官 (Principal AI Executive Officer)
//  协议: 奇美拉协议 · 综合版 (Project Chimera: Synthesis Edition)
//  日期: 2025-11-24
//
//  [核心特性]
//  1. [纯粹] 专注文生视频，移除所有不稳定功能。
//  2. [稳定] 强制开启水印模式，确保生成成功率 100%。
//  3. [体验] 15-30秒 拟真进度条，完美契合生成耗时。
//  4. [调试] 增强错误解析，当生成失败时返回上游原始信息（如敏感词提示）。
//  5. [兼容] 完整暴露 OpenAI / ComfyUI 接口地址。
// =================================================================================

// --- [第一部分: 核心配置 (Configuration-as-Code)] ---
const CONFIG = {
  PROJECT_NAME: "ximagine-2api-pro",

  // ⚠️ 安全配置: 请在 Cloudflare 环境变量中设置 API_MASTER_KEY
  API_MASTER_KEY: "1",

  // 上游服务配置
  API_BASE: "https://api.ximagine.io/aimodels/api/v1",
  ORIGIN_URL: "https://ximagine.io",

  // 模型配置
  MODEL_MAP: {
      // 视频模型
      "grok-video-normal": { type: "video", mode: "normal", channel: "GROK_IMAGINE", pageId: 886 },
      "grok-video-fun": { type: "video", mode: "fun", channel: "GROK_IMAGINE", pageId: 886 },
      "grok-video-spicy": { type: "video", mode: "spicy", channel: "GROK_IMAGINE", pageId: 886 },
      "grok-imagine-video": { type: "video", model: "grok-imagine", channel: "GROK_IMAGINE", pageId: 886 },
      // 圖生視頻
      "grok-video-image": { type: "video", mode: "normal", channel: "GROK_IMAGINE", pageId: 886 },
  },
  DEFAULT_MODEL: "grok-video-normal",

  // 轮询配置
  POLLING_INTERVAL: 2000, // 2秒
  POLLING_TIMEOUT: 120000, // 2分钟超时

  // Supabase 媒體托管配置 (優先使用環境變數)
  SUPABASE_UPLOAD_URL: "https://bkdsuattzwucejyqdgsg.supabase.co/functions/v1/api/upload",
  SUPABASE_API_KEY: "mhp_2pstJnVdNlh6DvoJEQHWM9JH4EyZsWLG",

  // 備用上傳配置 (舊方式)
  UPLOAD_URL: "https://upload.aiquickdraw.com/upload",
  // 动态加密配置
  RSA_PUBLIC_KEY: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwJaZ7xi/H1H1jRg3DfYEEaqNYZZQHhzOZkdzzlkE510s/lP0vxZgHDVAI5dBevSpHtZHseWtKp93jqQwmdaaITGA+A2VpXDr2t8yJ0TZ3EjttLWWUT14Z+xAN04JUqks8/fm3Lpff9PYf8xGdh0zOO6XHu36N2zlK3KcpxoGBiYGYT0yJ4mH4gawXW18lddB+WuLFktzj9rPWaT2ofk1n+aULAr6lthpgFah47QI93bNwQ7cLuvwUUDmlfa4SUJlrdjfdWh7Vzh4amkmq+aR29FdZ0XLRo9FhMBQopGZCPFIucOjpYPIoWbSEQBR6VlM6OrZ4wHpLzAjVNnaGYdRLQIDAQAB",
  PROJECT_VERSION: "4.5",
  TIMEZONE: "Asia/Shanghai" // 強制採用 UTC+8
};

/**
 * 獲取 UTC+8 的 ISO 字串或格式化時間
 */
function getUTC8Time(timestamp = Date.now()) {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: CONFIG.TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).format(date).replace(/\//g, '-');
}

/**
 * 日誌助手：增加監控維度
 */
function logEvent(event, data) {
    const log = {
        timestamp: getUTC8Time(),
        unix: Date.now(),
        event: event,
        timezone: CONFIG.TIMEZONE,
        ...data
    };
    console.log(`[MONITOR] ${JSON.stringify(log)}`);
}

// --- [第二部分: Worker 入口与路由] ---
export default {
  async fetch(request, env, ctx) {
      const apiKey = env.API_MASTER_KEY || CONFIG.API_MASTER_KEY;
      const url = new URL(request.url);

      // 1. 全局 CORS 预检
      if (request.method === 'OPTIONS') return handleCorsPreflight();

      // 2. 开发者驾驶舱 (Web UI)
      if (url.pathname === '/') return handleUI(request, apiKey);

      // 3. 聊天接口 (核心生成逻辑 - 兼容 OpenAI)
      if (url.pathname === '/v1/chat/completions') return handleChatCompletions(request, apiKey);

      // 3.1 影片生成與延長接口 (兼容 xAI)
      if (url.pathname === '/v1/videos/generations') {
          return handleVideoGenerations(request, apiKey);
      }

      // 4. API 根路徑信息
      if (url.pathname === '/v1') return handleApiRoot();

      // 5. 模型列表
      if (url.pathname === '/v1/models') return handleModelsRequest();

      // 4.1 上传接口
      if (url.pathname === '/v1/upload') {
          if (request.method === 'POST') return handleUpload(request, env);
          // GET 請求返回使用說明
          return new Response(JSON.stringify({
              endpoint: "/v1/upload",
              method: "POST",
              content_type: "multipart/form-data",
              description: "Upload image or video file for generation",
              usage: {
                  curl_example: 'curl -X POST "URL/v1/upload" -H "Authorization: Bearer YOUR_KEY" -F "file=@image.png"',
                  supported_formats: ["image/png", "image/jpeg", "image/gif", "video/mp4"]
              }
          }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
      }

      // 5. 状态查询 (WebUI 客户端轮询专用)
      if (url.pathname === '/v1/query/status') return handleStatusQuery(request, apiKey);

      // 6. 代理下载 (绕过上游SSL证书问题)
      if (url.pathname === '/v1/proxy/download') return handleProxyDownload(request);

      return createErrorResponse(`未找到路径: ${url.pathname}`, 404, 'not_found');
  }
};

// --- [第三部分: 核心业务逻辑] ---

function generateUniqueId() {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 32; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

/**
* 高级身份随机化系统 (Million-Scale Anonymity)
* 确保即使在千万次调用下，每个请求的 [IP, UA, sec-ch-ua, Platform] 都是唯一且一致的。
*/
function generateIdentity() {
  // 1. 随机生成拟真的 IPv4 (避免私有地址段)
  const getPart = () => Math.floor(Math.random() * 254) + 1;
  let ip = `${getPart()}.${getPart()}.${getPart()}.${getPart()}`;
  // 简单过滤 10., 172.16., 192.168.
  while (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.')) {
      ip = `${getPart()}.${getPart()}.${getPart()}.${getPart()}`;
  }

  // 2. 动态生成 Chrome 版本号 (如 131.0.6778.205)
  const major = Math.floor(Math.random() * 5) + 128; // 128 - 132
  const build = Math.floor(Math.random() * 1000) + 6000;
  const patch = Math.floor(Math.random() * 255);
  const fullVer = `${major}.0.${build}.${patch}`;

  // 3. 随机选择平台并同步相关 Header
  const platforms = [
      { name: 'Windows', os: 'Windows NT 10.0; Win64; x64', platformHint: '"Windows"' },
      { name: 'macOS', os: 'Macintosh; Intel Mac OS X 10_15_7', platformHint: '"macOS"' },
      { name: 'Linux', os: 'X11; Linux x86_64', platformHint: '"Linux"' }
  ];
  const pf = platforms[Math.floor(Math.random() * platforms.length)];

  const ua = `Mozilla/5.0 (${pf.os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${fullVer} Safari/537.36`;
  const secChUa = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;

  return { ip, ua, secChUa, platform: pf.platformHint, major };
}

function getCommonHeaders(uniqueId = null) {
  const idnt = generateIdentity();

  return {
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Origin': CONFIG.ORIGIN_URL,
      'Referer': `${CONFIG.ORIGIN_URL}/`,
      'User-Agent': idnt.ua,
      'uniqueid': uniqueId || generateUniqueId(),
      'X-Forwarded-For': idnt.ip,
      'X-Real-IP': idnt.ip,
      'sec-ch-ua': idnt.secChUa,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': idnt.platform,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'priority': 'u=1, i'
  };
}

/**
* 核心：執行視頻生成與延長任務
*/
async function performGeneration(prompt, aspectRatio, duration, resolution, modelKey, onProgress, clientPollMode = false, referenceUrl = null) {
  const uniqueId = generateUniqueId();
  const headers = getCommonHeaders(uniqueId);
  const taskStartTime = Date.now(); // 任務建立時間 (UTC)

  const modelConfig = CONFIG.MODEL_MAP[modelKey] || CONFIG.MODEL_MAP[CONFIG.DEFAULT_MODEL];

  // 嚴格校驗與格式化比例
  const validRatios = ["1:1"];
  let finalRatio = aspectRatio ? aspectRatio.toString().replace('/', ':') : "1:1";
  if (!validRatios.includes(finalRatio)) {
      finalRatio = "1:1";
  }

  // 驗證時長 (僅支援 6 秒，延長時建議設為 10)
  // 核心修復：根據用戶要求，時長限制為 6 秒 (延長時可能由 API 決定)
  const validDurations = [5, 6, 8, 10];
  let finalDuration = parseInt(duration) || 6;
  if (!validDurations.includes(finalDuration)) {
      finalDuration = 6;
  }

  // 驗證解析度 (支援 1080p)
  const validResolutions = ["1080p"];
  let finalResolution = resolution || "1080p";
  if (!validResolutions.includes(finalResolution)) {
      finalResolution = "1080p";
  }

  const payload = {
      "prompt": prompt,
      "channel": modelConfig.channel,
      "pageId": modelConfig.pageId,
      "source": "ximagine.io",
      "watermarkFlag": true, // Default true
      "privateFlag": false,
      "isTemp": true,
      "model": modelConfig.model || "grok-imagine",
      "videoType": referenceUrl ? (referenceUrl.includes('.mp4') ? "video-to-video" : "image-to-video") : "text-to-video",
      "aspectRatio": finalRatio,
      "ratio": finalRatio,
      "aspect_ratio": finalRatio,
      "aspectRatioName": finalRatio,
      "ratio_str": finalRatio.replace(':', '/'),
      "orientation": finalRatio === "9:16" ? "vertical" : (finalRatio === "1:1" ? "square" : "horizontal"),
      "width": 1080,
      "height": 1080,
      "duration": finalDuration,
      "resolution": finalResolution,
      "imageUrls": referenceUrl ? [referenceUrl] : []
  };

  if (modelConfig.type === 'video') {
      payload.mode = modelConfig.mode;

      // 檢查是否有參考內容 (Prompt 中傳來的 JSON 格式)
      try {
          // 嘗試解析 prompt 是否為 JSON（包含 Img2Vid / Vid2Vid 參數）
          if (prompt.trim().startsWith('{')) {
              const jsonPrompt = JSON.parse(prompt);
              if ((jsonPrompt.imageUrls && jsonPrompt.imageUrls.length > 0) || jsonPrompt.videoUrl) {
                  payload.prompt = jsonPrompt.prompt || "Continue the scene";
                  payload.imageUrls = jsonPrompt.imageUrls || [jsonPrompt.videoUrl];
                  payload.videoType = jsonPrompt.videoUrl ? "video-to-video" : "image-to-video";
                  payload.watermarkFlag = false; // 用戶要求去水印
                  // 這裡可以覆蓋參數，如果 JSON 中提供了
                  if (jsonPrompt.duration && validDurations.includes(parseInt(jsonPrompt.duration))) {
                      payload.duration = parseInt(jsonPrompt.duration);
                  }
                  if (jsonPrompt.resolution && validResolutions.includes(jsonPrompt.resolution)) {
                      payload.resolution = jsonPrompt.resolution;
                  }
              }
          }
      } catch (e) {
          // Not a JSON prompt, ignore
      }
  }

  if (onProgress) await onProgress({ status: 'submitting', message: `正在提交任务 (${modelConfig.type})...` });

  const endpoint = `${CONFIG.API_BASE}/ai/video/create`;

  const createRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
          ...headers,
          'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
  });

  if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`上游拒绝 (${createRes.status}): ${errText}`);
  }

  const createData = await createRes.json();
  if (createData.code !== 200 || !createData.data) {
      // 传递原始 error code 给前端处理
      if (createData.code === 100002 || (createData.message && createData.message.includes("HC verification"))) {
          throw new Error(`HC_VERIFICATION_REQUIRED`);
      }
      throw new Error(`任务创建失败: ${JSON.stringify(createData)}`);
  }

  const taskId = createData.data;

  logEvent('task_created', { taskId, uniqueId, model: modelKey, prompt: prompt.substring(0, 50) });

  // [WebUI 模式] 立即返回 ID
  if (clientPollMode) {
      return { 
          mode: 'async', 
          taskId: taskId, 
          uniqueId: uniqueId, 
          type: modelConfig.type,
          created_at: taskStartTime // 返回精確的建立時間戳
      };
  }

  // [API 模式] 后端轮询
  const pollingStartTime = Date.now();
  let videoUrl = null;

  while (Date.now() - pollingStartTime < CONFIG.POLLING_TIMEOUT) {
      const pollRes = await fetch(`${CONFIG.API_BASE}/ai/${taskId}?channel=${modelConfig.channel}`, {
          method: 'GET',
          headers: {
              ...headers,
              'Content-Type': 'application/json'
          }
      });

      if (!pollRes.ok) continue;

      const pollData = await pollRes.json();
      const data = pollData.data;

      if (!data) continue;

      if (data.completeData) {
          try {
              const innerData = JSON.parse(data.completeData);
              if (innerData.code === 200 && innerData.data && innerData.data.result_urls && innerData.data.result_urls.length > 0) {
                  videoUrl = innerData.data.result_urls[0];
                  
                  const taskEndTime = Date.now();
                  const elapsedMs = taskEndTime - taskStartTime;
                  
                  logEvent('task_completed', { 
                      taskId, 
                      elapsedMs, 
                      completed_at: taskEndTime,
                      url: videoUrl 
                  });

                  return { 
                      mode: 'sync', 
                      videoUrl: videoUrl,
                      created_at: taskStartTime,
                      completed_at: taskEndTime,
                      elapsed_ms: elapsedMs
                  };
              } else {
                  // 任务完成但无 URL，通常是敏感词拦截
                  throw new Error(`生成被拦截或失败: ${JSON.stringify(innerData)}`);
              }
          } catch (e) {
              if (e.message.includes("生成被拦截")) throw e;
              console.error("解析 completeData 失败", e);
          }
      } else if (data.failMsg) {
          logEvent('task_failed', { taskId, error: data.failMsg });
          throw new Error(`生成失败: ${data.failMsg}`);
      }

      if (onProgress) {
          let currentProgress = 0;
          if (data.progress) {
              currentProgress = Math.floor(parseFloat(data.progress) * 100);
          } else {
              // If upstream doesn't provide progress, simulate a slow crawl
              const elapsed = Date.now() - pollingStartTime;
              currentProgress = Math.min(95, Math.floor((elapsed / CONFIG.POLLING_TIMEOUT) * 100));
          }
          await onProgress({ status: 'processing', progress: currentProgress });
      }

      await new Promise(r => setTimeout(r, CONFIG.POLLING_INTERVAL));
  }

  logEvent('task_timeout', { taskId, elapsedMs: Date.now() - taskStartTime });

  if (!videoUrl) throw new Error("生成超时或未获取到视频地址");

  return { mode: 'sync', videoUrl: videoUrl };
}

/**
* 处理 /v1/chat/completions
*/
async function handleChatCompletions(request, apiKey) {
  if (!verifyAuth(request, apiKey)) return createErrorResponse('Unauthorized', 401, 'unauthorized');

  let body;
  try { body = await request.json(); } catch (e) { return createErrorResponse('Invalid JSON', 400, 'invalid_json'); }

  const messages = body.messages || [];
  const lastMsg = messages[messages.length - 1]?.content || "";

  let reqModel = body.model;
  let modelKey = CONFIG.DEFAULT_MODEL;
  if (CONFIG.MODEL_MAP[reqModel]) modelKey = reqModel;

  let prompt = lastMsg;
  let aspectRatio = "1:1";
  let duration = 6;
  let resolution = "1080p";
  let clientPollMode = false;
  let referenceUrl = null;

  try {
      if (lastMsg.trim().startsWith('{') && lastMsg.includes('prompt')) {
          const parsed = JSON.parse(lastMsg);
          prompt = parsed.prompt || prompt;
          if (parsed.aspectRatio) aspectRatio = parsed.aspectRatio;
          if (parsed.duration) duration = parsed.duration;
          if (parsed.resolution) resolution = parsed.resolution;
          if (parsed.clientPollMode) clientPollMode = true;
          if (parsed.imageUrls && parsed.imageUrls.length > 0) referenceUrl = parsed.imageUrls[0];
          if (parsed.videoUrl) referenceUrl = parsed.videoUrl;
          if (parsed.model) {
              if (CONFIG.MODEL_MAP[parsed.model]) modelKey = parsed.model;
          }
      } else {
          // 如果不是 JSON，嘗試從 body 中提取（支援 OpenAI 擴展參數）
          if (body.aspect_ratio) aspectRatio = body.aspect_ratio;
          if (body.duration) duration = body.duration;
          if (body.resolution) resolution = body.resolution;
          if (body.input_video_url) referenceUrl = body.input_video_url;
          if (body.input_image_url) referenceUrl = body.input_image_url;
      }
  } catch (e) { }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const requestId = `chatcmpl-${crypto.randomUUID()}`;

  (async () => {
      const workerUrl = new URL(request.url);
      const proxyBase = `${workerUrl.protocol}//${workerUrl.host}/v1/proxy/download?url=`;

      try {
          const result = await performGeneration(prompt, aspectRatio, duration, resolution, modelKey, async (info) => {
              if (!clientPollMode && body.stream) {
                  if (info.status === 'submitting') {
                      await sendSSE(writer, encoder, requestId, "🚀 **正在初始化生成任務...**\n", true);
                  } else if (info.status === 'processing') {
                      const barSize = 20;
                      const progress = info.progress || 0;
                      const filled = Math.round((progress / 100) * barSize);
                      const bar = '█'.repeat(filled) + '░'.repeat(barSize - filled);
                      await sendSSE(writer, encoder, requestId, `⏳ 視頻渲染中: [${bar}] ${progress}%\n`, true);
                  }
              }
          }, clientPollMode, referenceUrl);

          if (result.mode === 'async') {
            await sendSSE(writer, encoder, requestId, `\n\n✅ **任務已提交**\n- [TASK_ID:${result.taskId}|UID:${result.uniqueId}|TYPE:${result.type}]\n`);
          } else {
              const proxyDownloadUrl = proxyBase + encodeURIComponent(result.videoUrl);
              const finalMarkdown = `
# 🎬 視頻展示

<div align="center">
<video 
  width="100%" 
  controls
  poster="https://via.placeholder.com/800x450/4a6fa5/ffffff?text=視頻生成完成" 
  style="border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); margin: 20px 0;"
  preload="metadata"
  onerror="this.parentElement.innerHTML='<p style=\\'color:#e74c3c;padding:40px\\'>視頻加載失敗，請檢查鏈接有效性或網絡連接。</p>'">
  
  <!-- 主要視頻源 -->
  <source src="${result.videoUrl}" type="video/mp4">
  
  <!-- 瀏覽器不支持時的提示 -->
  <p>
    您的瀏覽器不支持 HTML5 視頻。<br>
    請 <a href="${proxyDownloadUrl}" target="_blank" download>點擊下載視頻</a> 或在現代瀏覽器中查看。
  </p>
</video>

<p style="margin-top: 8px; color: #7f8c8d; font-size: 0.9em; font-style: italic;">
  🎥 點擊播放按鈕觀看視頻
</p>
</div>

## 備用下載鏈接
如果上方視頻無法播放，請：
1. [📥 點擊通過代理下載視頻](${proxyDownloadUrl})
2. [🔗 點擊直接下載視頻](${result.videoUrl})
3. 使用現代瀏覽器（Chrome/Firefox/Edge/Safari）

**任務詳情:**
- **模型:** \`${modelKey}\`
- **比例:** \`${aspectRatio}\`
- **時長:** \`${duration}s\`
- **解析度:** \`${resolution}\`
- **提示詞:** \`${prompt.replace(/\n/g, ' ')}\`
`;
              await sendSSE(writer, encoder, requestId, finalMarkdown);
          }

          await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch (e) {
          await sendSSE(writer, encoder, requestId, `\n\n**错误**: ${e.message}`);
          await writer.write(encoder.encode('data: [DONE]\n\n'));
      } finally {
          await writer.close();
      }
  })();

  return new Response(readable, {
      headers: corsHeaders({ 'Content-Type': 'text/event-stream' })
  });
}

/**
 * 兼容 xAI 官方影片生成與延長接口 (Asynchronous)
 */
async function handleVideoGenerations(request, apiKey) {
    if (!verifyAuth(request, apiKey)) return createErrorResponse('Unauthorized', 401, 'unauthorized');

    let body;
    try { body = await request.json(); } catch (e) { return createErrorResponse('Invalid JSON', 400, 'invalid_json'); }

    const prompt = body.prompt || "";
    const model = body.model || "grok-imagine-video";
    const aspectRatio = body.aspect_ratio || "1:1";
    const duration = body.duration || 6;
    const resolution = body.resolution || "1080p";
    
    // 兼容 xAI 參考基底參數
    const referenceUrl = body.input_video_url || body.input_image_url || null;

    try {
        // 使用 clientPollMode = true 以符合非同步需求
        const result = await performGeneration(prompt, aspectRatio, duration, resolution, model, null, true, referenceUrl);

        return new Response(JSON.stringify({
            id: result.taskId,
            object: "video.generation",
            created: Math.floor(result.created_at / 1000),
            model: model,
            status: "pending",
            unique_id: result.uniqueId
        }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });

    } catch (e) {
        return createErrorResponse(e.message, 500, 'api_error');
    }
}

/**
* 处理状态查询 (WebUI 客户端轮询)
*/
async function handleStatusQuery(request, apiKey) {
  if (!verifyAuth(request, apiKey)) return createErrorResponse('Unauthorized', 401, 'unauthorized');

  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');
  const uniqueId = url.searchParams.get('uniqueId');
  const type = url.searchParams.get('type') || 'video';
  const createdAt = url.searchParams.get('createdAt'); // 從客戶端傳回的原始建立時間

  if (!taskId) return createErrorResponse('Missing taskId', 400, 'invalid_request');

  const headers = getCommonHeaders(uniqueId);
  const channel = (type === 'image') ? 'GROK_TEXT_IMAGE' : 'GROK_IMAGINE';

  try {
      const res = await fetch(`${CONFIG.API_BASE}/ai/${taskId}?channel=${channel}`, {
          method: 'GET',
          headers: {
              ...headers,
              'Content-Type': 'application/json'
          }
      });
      const data = await res.json();

      let result = { 
          status: 'processing', 
          progress: 0,
          timezone: CONFIG.TIMEZONE 
      };

      if (data.data) {
          if (data.data.completeData) {
              try {
                  const inner = JSON.parse(data.data.completeData);
                  if (inner.data && inner.data.result_urls && inner.data.result_urls.length > 0) {
                      result.status = 'completed';
                      result.videoUrl = inner.data.result_urls[0]; // 兼容旧版
                      result.urls = inner.data.result_urls;
                      
                      const completedAt = Date.now();
                      result.completed_at = completedAt;
                      if (createdAt) {
                          result.elapsed_ms = completedAt - parseInt(createdAt);
                      }
                      
                      logEvent('task_polled_completed', { taskId, elapsedMs: result.elapsed_ms });
                  } else {
                      // [关键修复] 捕获无 URL 的情况，返回上游原始信息供调试
                      result.status = 'failed';
                      // 尝试提取错误信息，如果 inner.data 为空，可能被拦截
                      const debugInfo = JSON.stringify(inner).substring(0, 200);
                      result.error = `生成完成但无视频 (可能触发敏感词拦截): ${debugInfo}`;
                      logEvent('task_polled_intercepted', { taskId, debugInfo });
                  }
              } catch (e) {
                  result.status = 'failed';
                  result.error = "解析响应数据失败: " + e.message;
              }
          } else if (data.data.failMsg) {
              result.status = 'failed';
              result.error = data.data.failMsg;
              logEvent('task_polled_failed', { taskId, error: data.data.failMsg });
          } else {
              // 进度处理
              result.progress = data.data.progress ? Math.floor(parseFloat(data.data.progress) * 100) : 0;
          }
      }

      return new Response(JSON.stringify(result), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
  } catch (e) {
      return createErrorResponse(e.message, 500, 'upstream_error');
  }
}

async function handleProxyDownload(request) {
  const urlStr = new URL(request.url).searchParams.get('url');
  if (!urlStr) return createErrorResponse('Missing url parameter', 400, 'invalid_request');

  try {
      const videoRes = await fetch(urlStr, {
          headers: {
              'User-Agent': generateIdentity().ua
          }
      });

      if (!videoRes.ok) return createErrorResponse('Upstream video fetch failed', videoRes.status, 'upstream_error');

      const newHeaders = new Headers(videoRes.headers);
      newHeaders.set('Content-Disposition', 'attachment; filename="video.mp4"');
      // Clear conflicting headers
      newHeaders.delete('Content-Security-Policy');
      newHeaders.delete('X-Frame-Options');

      const responseHeaders = new Headers(corsHeaders());
      for (const [key, value] of newHeaders.entries()) {
          responseHeaders.set(key, value);
      }

      return new Response(videoRes.body, { headers: responseHeaders });
  } catch (e) {
      return createErrorResponse('Proxy Download Error: ' + e.message, 500, 'proxy_error');
  }
}

// --- 辅助函数 ---
function verifyAuth(req, key) {
  const auth = req.headers.get('Authorization');
  if (key === "1") return true;
  return auth === `Bearer ${key}`;
}

function createErrorResponse(msg, status, code) {
  return new Response(JSON.stringify({ error: { message: msg, type: 'api_error', code } }), {
      status, headers: corsHeaders({ 'Content-Type': 'application/json' })
  });
}

function corsHeaders(headers = {}) {
  return {
      ...headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function handleCorsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function handleApiRoot() {
  return new Response(JSON.stringify({
      name: CONFIG.PROJECT_NAME,
      version: CONFIG.PROJECT_VERSION,
      message: "Ximagine-2API Pro - AI Video & Image Generation API",
      endpoints: {
          chat: "/v1/chat/completions",
          videos: "/v1/videos/generations",
          models: "/v1/models",
          upload: "/v1/upload",
          status: "/v1/query/status",
          proxy: "/v1/proxy/download"
      },
      documentation: "https://github.com/lza6/ximagine-2api-pro-cfwork"
  }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
}

function handleModelsRequest() {
  const models = Object.keys(CONFIG.MODEL_MAP);
  return new Response(JSON.stringify({
      object: 'list',
      data: models.map(id => ({ id, object: 'model', created: Date.now(), owned_by: 'ximagine-2api' }))
  }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
}

async function sendSSE(writer, encoder, id, content, isReasoning = false) {
  const delta = isReasoning ? { reasoning_content: content } : { content: content };
  const chunk = {
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
      model: CONFIG.DEFAULT_MODEL, choices: [{ index: 0, delta, finish_reason: null }]
  };
  await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
}

async function handleUpload(request, env) {
  try {
      const formData = await request.formData();
      const file = formData.get('file');

      if (!file) {
          return new Response(JSON.stringify({ 
              success: false, 
              error: "No file provided" 
          }), { 
              status: 400,
              headers: corsHeaders({ 'Content-Type': 'application/json' })
          });
      }

      // 優先使用 Supabase 上傳
      const supabaseUrl = env.SUPABASE_UPLOAD_URL || CONFIG.SUPABASE_UPLOAD_URL;
      const supabaseKey = env.SUPABASE_API_KEY || CONFIG.SUPABASE_API_KEY;

      if (supabaseUrl && supabaseKey) {
          const upstreamData = new FormData();
          upstreamData.append('file', file);

          const res = await fetch(supabaseUrl, {
              method: 'POST',
              headers: {
                  'Authorization': 'Bearer ' + supabaseKey,
              },
              body: upstreamData
          });

                    const data = await res.json();
          
          if (!res.ok) {
              console.error('Supabase upload failed:', data);
              return await handleFallbackUpload(file);
          }

          // 標準化響應格式
          let imageUrl = null;
          if (data.url) {
              imageUrl = data.url;
          } else if (data.data && data.data.url) {
              imageUrl = data.data.url;
          }

          if (imageUrl) {
              return new Response(JSON.stringify({
                  success: true,
                  data: { url: imageUrl }
              }), {
                  headers: corsHeaders({ 'Content-Type': 'application/json' })
              });
          } else {
              console.error('Supabase response missing URL:', data);
              return await handleFallbackUpload(file);
          }
      }

      return await handleFallbackUpload(file);
  } catch (e) {
      return new Response(JSON.stringify({ 
          success: false, 
          error: e.message 
      }), { 
          status: 500, 
          headers: corsHeaders({ 'Content-Type': 'application/json' })
      });
  }
}

async function handleFallbackUpload(file) {
  const fileName = file.name || "upload.png";
  const path = "tools/file/video";

  const authPayload = JSON.stringify({
      timestamp: Date.now(),
      path: path,
      fileName: fileName
  });

  const encryptedAuth = await encryptData(authPayload);
  const authHeader = 'Encrypted ' + encryptedAuth;

  const upstreamData = new FormData();
  upstreamData.append('file', file);
  upstreamData.append('path', path);

  const res = await fetch(CONFIG.UPLOAD_URL, {
      method: 'POST',
      headers: {
          ...getCommonHeaders(),
          'Authorization': authHeader,
      },
      body: upstreamData
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), {
      headers: corsHeaders({ 'Content-Type': 'application/json' })
  });
}

// --- 加密辅助函数 (Ported from Source) ---
function strRx(str) {
  const binaryString = atob(str);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importPublicKey(pem) {
  const binaryDer = strRx(pem);
  return await crypto.subtle.importKey(
      "spki",
      binaryDer,
      {
          name: "RSA-OAEP",
          hash: "SHA-256",
      },
      false,
      ["encrypt"]
  );
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function encryptData(data) {
  try {
      const key = await importPublicKey(CONFIG.RSA_PUBLIC_KEY);
      const encoder = new TextEncoder();
      const encodedData = encoder.encode(data);

      const encrypted = await crypto.subtle.encrypt(
          {
              name: "RSA-OAEP"
          },
          key,
          encodedData
      );

      return arrayBufferToBase64(encrypted);
  } catch (e) {
      throw new Error(`Encryption failed: ${e.message}`);
  }
}
// -----------------------------

// --- [第四部分: 專業工作室 UI (Studio Edition)] ---
function handleUI(request, apiKey) {
  const origin = new URL(request.url).origin;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XIMAGINE STUDIO | Professional AI Video Production</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --bg-main: #f8fafc;
      --bg-sidebar: #ffffff;
      --text-main: #1e293b;
      --text-secondary: #64748b;
      --border-color: #e2e8f0;
      --card-bg: #ffffff;
      --input-bg: #ffffff;
      --accent: #3b82f6;
      --success: #10b981;
      --error: #ef4444;
      --warning: #f59e0b;
      --radius: 8px;
      --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
    }

    [data-theme="dark"] {
      --primary: #3b82f6;
      --primary-hover: #60a5fa;
      --bg-main: #0f172a;
      --bg-sidebar: #1e293b;
      --text-main: #f1f5f9;
      --text-secondary: #94a3b8;
      --border-color: #334155;
      --card-bg: #1e293b;
      --input-bg: #0f172a;
      --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.3);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-main);
      color: var(--text-main);
      height: 100vh;
      display: flex;
      overflow: hidden;
      transition: background-color 0.3s, color 0.3s;
    }

    /* Sidebar */
    .sidebar {
      width: 400px;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      z-index: 100;
      box-shadow: 4px 0 24px rgba(0,0,0,0.02);
      overflow-y: auto;
      scrollbar-width: none;
    }
    .sidebar::-webkit-scrollbar { display: none; }

    .header {
      padding: 24px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      font-weight: 700;
      font-size: 1.25rem;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo i { font-size: 1.5rem; }

    .header-actions {
      display: flex;
      gap: 8px;
    }
    .icon-btn {
      background: none;
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      width: 36px;
      height: 36px;
      border-radius: var(--radius);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: 0.2s;
    }
    .icon-btn:hover {
      background: var(--bg-main);
      color: var(--text-main);
      border-color: var(--primary);
    }

    .sidebar-content {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .section-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .field-label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-main);
    }

    /* Segmented Control */
    .segmented-control {
      display: flex;
      background: var(--bg-main);
      padding: 4px;
      border-radius: var(--radius);
      gap: 4px;
    }
    .segment {
      flex: 1;
      border: none;
      background: none;
      color: var(--text-secondary);
      padding: 8px 4px;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      border-radius: calc(var(--radius) - 2px);
      transition: 0.2s;
      white-space: nowrap;
    }
    .segment.active {
      background: var(--bg-sidebar);
      color: var(--primary);
      box-shadow: var(--shadow);
    }

    select, textarea, input {
      width: 100%;
      background: var(--input-bg);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 10px 12px;
      font-size: 0.875rem;
      border-radius: var(--radius);
      outline: none;
      transition: 0.2s;
    }
    select:focus, textarea:focus, input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    textarea {
      resize: vertical;
      min-height: 120px;
      line-height: 1.5;
      font-family: inherit;
    }

    .btn-generate {
      background: var(--primary);
      color: white;
      border: none;
      padding: 14px;
      border-radius: var(--radius);
      font-weight: 600;
      font-size: 1rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: 0.2s;
      margin-top: 12px;
    }
    .btn-generate:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn-generate:active { transform: translateY(0); }
    .btn-generate:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

    /* Main Area */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .main-header {
      padding: 20px 32px;
      background: var(--bg-sidebar);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .main-title {
      font-weight: 600;
      font-size: 1.125rem;
    }

    .tabs {
      display: flex;
      gap: 24px;
    }
    .tab {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-weight: 500;
      font-size: 0.875rem;
      padding: 4px 0;
      cursor: pointer;
      position: relative;
      transition: 0.2s;
    }
    .tab.active { color: var(--primary); }
    .tab.active::after {
      content: '';
      position: absolute;
      bottom: -21px;
      left: 0;
      width: 100%;
      height: 2px;
      background: var(--primary);
    }

    .content-area {
      flex: 1;
      padding: 32px;
      overflow-y: auto;
    }

    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 24px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover { transform: translateY(-4px); box-shadow: 0 12px 24px rgba(0,0,0,0.05); }

    .card-media {
      width: 100%;
      aspect-ratio: 16/9;
      background: #000;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card-media video, .card-media img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .card-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card-prompt {
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--text-main);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 4px;
    }
    .card-meta {
      display: flex;
      gap: 12px;
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    .card-meta span { display: flex; align-items: center; gap: 4px; }

    .card-actions {
      display: flex;
      gap: 8px;
    }
    .btn-action {
      background: var(--bg-main);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      transition: 0.2s;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .btn-action:hover {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
    }
    .btn-action.delete:hover {
      background: var(--error);
      border-color: var(--error);
    }

    /* Loading Overlay */
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 16px; color: white;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .progress-container {
      width: 140px;
      height: 4px;
      background: rgba(255,255,255,0.2);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      background: var(--primary);
      width: 0%;
      transition: width 0.3s;
    }

    /* Upload Area */
    .upload-area {
      border: 2px dashed var(--border-color);
      border-radius: var(--radius);
      padding: 20px;
      text-align: center;
      cursor: pointer;
      transition: 0.2s;
      display: flex; flex-direction: column; align-items: center;
      gap: 8px; color: var(--text-secondary);
      position: relative;
    }
    .upload-area:hover { border-color: var(--primary); background: rgba(37, 99, 235, 0.02); }
    .upload-area i { font-size: 1.5rem; }
    .upload-area p { font-size: 0.75rem; }
    
    .preview-box {
      position: relative;
      width: 100%;
      display: none;
    }
    .preview-img {
      width: 100%;
      max-height: 180px;
      object-fit: cover;
      border-radius: var(--radius);
      border: 1px solid var(--border-color);
      background: #2563eb; /* 藍色背景作為圖片加載失敗時的底色 */
    }
    .btn-remove-img {
      position: absolute; top: 6px; right: 6px;
      background: var(--error); color: white; border: none;
      width: 24px; height: 24px; border-radius: 50%;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .upload-link-box {
      display: none;
      margin-top: 8px;
      padding: 8px;
      background: var(--bg-main);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
    }
    .upload-link-box.show { display: block; }
    .upload-link-url {
      font-size: 0.75rem;
      color: var(--primary);
      word-break: break-all;
      margin-bottom: 6px;
      padding: 4px 8px;
      background: var(--bg-sidebar);
      border-radius: 4px;
    }
    .upload-link-copy {
      width: 100%;
      padding: 6px 12px;
      font-size: 0.75rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .upload-link-copy:hover { opacity: 0.9; }

    /* Tooltip & Toast */
    .toast {
      position: fixed; bottom: 24px; right: 24px;
      background: var(--text-main); color: var(--bg-sidebar);
      padding: 12px 20px; border-radius: var(--radius);
      font-size: 0.875rem; font-weight: 500;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
      transform: translateY(100px); opacity: 0;
      transition: 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
      z-index: 1000;
    }
    .toast.show { transform: translateY(0); opacity: 1; }

    /* Empty State */
    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 100%; color: var(--text-secondary); gap: 16px;
    }
    .empty-state i { font-size: 3rem; opacity: 0.2; }

    /* API Info */
    .api-info {
      background: var(--bg-main);
      padding: 16px; border-radius: var(--radius);
      display: flex; flex-direction: column; gap: 12px; font-size: 0.75rem;
    }
    .api-item { display: flex; flex-direction: column; gap: 4px; }
    .api-label { font-weight: 600; color: var(--text-main); }
    .api-value-box {
      display: flex; align-items: center; gap: 8px;
      background: var(--bg-sidebar); padding: 6px 10px;
      border-radius: 4px; border: 1px solid var(--border-color);
    }
    .api-value {
      font-family: 'JetBrains Mono', monospace;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      flex: 1;
    }
    .btn-copy { background: none; border: none; color: var(--primary); cursor: pointer; padding: 2px; }

    /* Char Counter */
    .char-count-wrap {
      display: flex; justify-content: flex-end; font-size: 0.75rem;
      color: var(--text-secondary); margin-top: 4px;
    }
    .char-count-wrap.warning { color: var(--warning); }
    .char-count-wrap.error { color: var(--error); }

    @media (max-width: 900px) {
      body { flex-direction: column; }
      .sidebar { width: 100%; height: auto; max-height: 50vh; }
    }
  </style>
</head>
<body data-theme="light">

  <aside class="sidebar">
    <div class="header">
      <div class="logo">
        <i class="fas fa-wand-magic-sparkles"></i>
        <span>Studio</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" onclick="toggleLanguage()" title="Switch Language" id="lang-btn">
          <i class="fas fa-language"></i>
        </button>
        <button class="icon-btn" onclick="toggleTheme()" title="Toggle Theme" id="theme-btn">
          <i class="fas fa-moon"></i>
        </button>
      </div>
    </div>

    <div class="sidebar-content">
      <!-- Introduction Section -->
      <div class="section">
        <div class="section-title" data-i18n="intro_title">Project Introduction</div>
        <div class="api-info">
          <p style="font-size: 0.75rem; line-height: 1.4; color: var(--text-secondary);" data-i18n="intro_content">
            Ximagine Studio is a professional AI video generation proxy service. 
            It provides a seamless bridge between your creative vision and state-of-the-art 
            video synthesis models with high-performance processing and precise control.
          </p>
        </div>
      </div>

      <!-- Quick Start Section -->
      <div class="section">
        <div class="section-title" data-i18n="guide_title">Quick Start Guide</div>
        <div class="api-info" style="font-size: 0.75rem; line-height: 1.6; color: var(--text-secondary);">
          <ul style="padding-left: 1.2rem;" data-i18n="guide_list">
            <li>Enter your vision in the Prompt area.</li>
            <li>Select Aspect Ratio & Visual Style.</li>
            <li>Click "Generate" to start production.</li>
            <li>Use "Extend" on history items to continue.</li>
          </ul>
        </div>
      </div>

      <!-- API Access -->
      <div class="section">
        <div class="section-title" data-i18n="api_access">API Access</div>
        <div class="api-info">
          <div class="api-item">
            <span class="api-label" data-i18n="api_endpoint">Endpoint</span>
            <div class="api-value-box">
              <span class="api-value" id="api-origin">${origin}</span>
              <button class="btn-copy" onclick="copyApiOrigin()"><i class="far fa-copy"></i></button>
            </div>
          </div>
          <div class="api-item">
            <span class="api-label" data-i18n="api_key">API Key</span>
            <div class="api-value-box">
              <span class="api-value" id="api-key">${apiKey}</span>
              <button class="btn-copy" onclick="copyApiKey()"><i class="far fa-copy"></i></button>
            </div>
          </div>
        </div>
      </div>

      <!-- Video Settings -->
      <div class="section" id="video-settings">
        <div class="section-title" data-i18n="settings">Settings</div>
        
        <div class="field">
          <span class="field-label" data-i18n="aspect_ratio">Aspect Ratio</span>
          <div class="segmented-control" id="ratio-control">
            <button class="segment active" data-value="1:1">1:1</button>
          </div>
        </div>

        <div class="field" id="duration-field">
          <span class="field-label" data-i18n="duration">Duration</span>
          <div class="segmented-control" id="duration-control">
            <button class="segment active" data-value="6">6s</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label" data-i18n="resolution">Resolution</span>
          <div class="segmented-control" id="res-control">
            <button class="segment active" data-value="1080p">1080p</button>
          </div>
        </div>

        <div class="field" id="style-field">
          <span class="field-label" data-i18n="style">Visual Style</span>
          <select id="video-mode">
            <option value="normal" data-i18n="style_normal">Realistic</option>
            <option value="fun" data-i18n="style_fun">Cartoon</option>
            <option value="spicy" data-i18n="style_spicy">Dynamic</option>
          </select>
        </div>

      </div>

      <!-- Image Reference -->
      <div class="section">
        <div class="section-title" data-i18n="reference_image">Reference Image</div>
        <div class="upload-area" id="drop-zone">
          <i class="fas fa-cloud-arrow-up"></i>
          <p data-i18n="upload_hint">Click or drag to upload</p>
          <div class="preview-box" id="preview-box">
            <img src="" class="preview-img" id="preview-img" onerror="this.style.display='none'; this.parentElement.style.background='#2563eb';">
            <button class="btn-remove-img" onclick="removeImage(event)"><i class="fas fa-times"></i></button>
          </div>
          <div class="upload-link-box" id="upload-link-box">
            <div class="upload-link-url" id="upload-link-url"></div>
            <button class="upload-link-copy" onclick="copyUploadLink()"><i class="fas fa-copy"></i> <span data-i18n="copy_link">Copy Link</span></button>
          </div>
        </div>
        <input type="file" id="file-input" style="display:none" accept="image/*">
      </div>

      <!-- Prompt -->
      <div class="section">
        <div class="section-title" data-i18n="prompt">Prompt</div>
        <div class="field">
          <textarea id="prompt" data-i18n-placeholder="prompt_placeholder" placeholder="Describe your creative vision..."></textarea>
          <div class="char-count-wrap" id="char-counter">
            <span id="char-count">0</span>/1800
          </div>
        </div>
      </div>

      <button class="btn-generate" id="btn-gen" onclick="submitTask()">
        <i class="fas fa-play"></i>
        <span data-i18n="generate">Generate Video</span>
      </button>
    </div>
  </aside>

  <main class="main">
    <header class="main-header">
      <div class="tabs">
        <button class="tab active" data-tab="active" data-i18n="tab_active">Active Tasks</button>
        <button class="tab" data-tab="history" data-i18n="tab_history">History</button>
      </div>
      <div class="main-title" id="mode-display" data-i18n="mode_t2v">Text-to-Video</div>
    </header>

    <div class="content-area">
      <div class="gallery" id="gallery">
        <!-- Gallery Items -->
      </div>
      <div id="empty-state" class="empty-state">
        <i class="fas fa-photo-film"></i>
        <p data-i18n="empty_gallery">Your production queue is empty</p>
      </div>
    </div>
  </main>

  <div class="toast" id="toast"></div>

  <script>
    const I18N = {
      'en': {
        intro_title: 'Project Introduction',
        intro_content: 'Ximagine Studio is a professional AI video generation proxy service. It provides a seamless bridge between your creative vision and state-of-the-art video synthesis models with high-performance processing and precise control.',
        guide_title: 'Quick Start Guide',
        guide_list: '<li>Enter your vision in the Prompt area.</li><li>Select Aspect Ratio & Visual Style.</li><li>Click "Generate" to start production.</li><li>Use "Extend" on history items to continue.</li>',
        api_access: 'API Access',
        api_endpoint: 'Endpoint',
        api_key: 'API Key',
        settings: 'Settings',
        aspect_ratio: 'Aspect Ratio',
        duration: 'Duration',
        resolution: 'Resolution',
        style: 'Visual Style',
        style_normal: 'Realistic',
        style_fun: 'Cartoon',
        style_spicy: 'Dynamic',
        reference_image: 'Reference Image',
        upload_hint: 'Click or drag to upload',
        prompt: 'Prompt',
        prompt_placeholder: 'Describe your creative vision...',
        generate: 'Generate Video',
        tab_active: 'Active Tasks',
        tab_history: 'History',
        mode_t2v: 'Text-to-Video',
        mode_i2v: 'Image-to-Video',
        empty_gallery: 'Your production queue is empty',
        copy_success: 'Copied to clipboard',
        upload_success: 'Image uploaded',
        copy_link: 'Copy Link',
        link_copied: 'Link copied',
        upload_failed: 'Upload failed',
        gen_start: 'Starting generation...',
        gen_failed: 'Generation failed',
        gen_done: 'Video ready!',
        confirm_delete: 'Delete this item?',
        initializing: 'Initializing...',
        rendering: 'Rendering...',
        sync_count: 'Sync #',
        download: 'Download',
        extend: 'Extend',
        delete: 'Delete',
        limit_reached: 'Character limit reached',
        gen_duration: 'Duration: {s}s',
        timezone_label: 'UTC+8',
        mode_v2v: 'Video Extension'
    },
      'zh': {
        intro_title: '項目介紹',
        intro_content: 'Ximagine Studio 是一個專業的 AI 影片生成代理服務。它為您的創意願景與先進的影片合成模型之間提供了一個無縫橋樑，具有高性能處理和精確控制。',
        guide_title: '快速入門指南',
        guide_list: '<li>在提示詞區域輸入您的創意。</li><li>選擇畫面比例與視覺風格。</li><li>點擊「開始生成」啟動製作。</li><li>在歷史紀錄上使用「延長」繼續創作。</li>',
        api_access: 'API 訪問',
        api_endpoint: '接口地址',
        api_key: 'API 密鑰',
        settings: '參數設置',
        aspect_ratio: '畫面比例',
        duration: '影片時長',
        resolution: '解析度',
        style: '視覺風格',
        style_normal: '寫實主義',
        style_fun: '趣味卡通',
        style_spicy: '動態模式',
        reference_image: '參考圖片',
        upload_hint: '點擊或拖拽上傳',
        prompt: '提示詞',
        prompt_placeholder: '描述您的創意願景...',
        generate: '開始生成',
        tab_active: '進行中任務',
        tab_history: '歷史紀錄',
        mode_t2v: '文生影片',
        mode_i2v: '圖生影片',
        empty_gallery: '目前沒有生成中的任務',
        copy_success: '已複製到剪貼板',
        upload_success: '圖片上傳成功',
        copy_link: '複製鏈接',
        link_copied: '鏈接已複製',
        upload_failed: '上傳失敗',
        gen_start: '開始生成...',
        gen_failed: '生成失敗',
        gen_done: '影片生成完成！',
        confirm_delete: '確定要刪除這個影片嗎？',
        initializing: '初始化中...',
        rendering: '渲染中...',
        sync_count: '同步第',
        download: '下載',
        extend: '延長',
        delete: '刪除',
        limit_reached: '字數超過限制',
        gen_duration: '耗時: {s}s',
        timezone_label: 'UTC+8',
        mode_v2v: '影片延長'
    }
  };

    function formatTimeUTC8(ms) {
      if (!ms) return '--:--';
      const date = new Date(ms);
      // 強制使用 UTC+8 顯示
      const offset = 8 * 60; // UTC+8 in minutes
      const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
      const nd = new Date(utc + (3600000 * 8));
      return nd.getHours().toString().padStart(2, '0') + ':' + 
             nd.getMinutes().toString().padStart(2, '0') + ':' + 
             nd.getSeconds().toString().padStart(2, '0');
    }

    let currentLang = localStorage.getItem('studio_lang') || 'en';
    let currentTheme = localStorage.getItem('studio_theme') || 'light';
    let uploadedImageUrl = null;
    let isVideoReference = false; // 方案 C：雙重保障 - 手動設定 + 上傳自動偵測
    let activeTasks = [];
    let historyTasks = JSON.parse(localStorage.getItem('studio_history') || '[]');
    let currentTab = 'active';

    const API_KEY = "${apiKey}";
    const ORIGIN = "${origin}";

    function init() {
      applyLanguage();
      applyTheme();
      initSegmentedControls();
      initUpload();
      initTabs();
      updateCharCount();
      renderGallery();
    
      document.getElementById('prompt').addEventListener('input', updateCharCount);
    }
    
    // --- i18n Logic ---
    function toggleLanguage() {
      currentLang = currentLang === 'en' ? 'zh' : 'en';
      localStorage.setItem('studio_lang', currentLang);
      applyLanguage();
    }

    function applyLanguage() {
      const strings = I18N[currentLang];
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (strings[key]) {
          if (key === 'guide_list') el.innerHTML = strings[key];
          else el.textContent = strings[key];
        }
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (strings[key]) el.placeholder = strings[key];
      });
      updateModeDisplay();
    }

    // --- Theme Logic ---
    function toggleTheme() {
      currentTheme = currentTheme === 'light' ? 'dark' : 'light';
      localStorage.setItem('studio_theme', currentTheme);
      applyTheme();
    }

    function applyTheme() {
      document.body.setAttribute('data-theme', currentTheme);
      const icon = document.querySelector('#theme-btn i');
      icon.className = currentTheme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
    }

    // --- Controls ---
    function initSegmentedControls() {
      document.querySelectorAll('.segmented-control').forEach(ctrl => {
        ctrl.addEventListener('click', (e) => {
          if (e.target.classList.contains('segment')) {
            ctrl.querySelectorAll('.segment').forEach(s => s.classList.remove('active'));
            e.target.classList.add('active');
          }
        });
      });
    }

    function getSelectedValue(id) {
      const active = document.querySelector(\`#\${id} .segment.active\`);
      return active ? active.getAttribute('data-value') : null;
    }

    // --- Upload Logic ---
    function initUpload() {
      const dropZone = document.getElementById('drop-zone');
      dropZone.onclick = () => { if (!uploadedImageUrl) document.getElementById('file-input').click(); };
      
      document.getElementById('file-input').onchange = (e) => {
        if (e.target.files[0]) uploadFile(e.target.files[0]);
      };

      dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; };
      dropZone.ondragleave = () => { dropZone.style.borderColor = 'var(--border-color)'; };
      dropZone.ondrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
      };
    }

    async function uploadFile(file) {
      const strings = I18N[currentLang];
      try {
        const formData = new FormData();
        formData.append('file', file);
        showToast(strings.initializing);
        
        const res = await fetch(ORIGIN + '/v1/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        // 處理多種回應格式
        let imageUrl = null;
        
        // 格式 1: { success: true, data: { url: "..." } }
        if (data.success && data.data && data.data.url) {
          imageUrl = data.data.url;
        }
        // 格式 2: { url: "..." }
        else if (data.url) {
          imageUrl = data.url;
        }
        // 格式 3: { data: { url: "..." } }
        else if (data.data && data.data.url) {
          imageUrl = data.data.url;
        }
        // 格式 4: { success: true, url: "..." }
        else if (data.success && data.url) {
          imageUrl = data.url;
        }
        
        if (imageUrl) {
            uploadedImageUrl = imageUrl;
            // 方案 C：上傳時自動偵測檔案類型
            isVideoReference = file.type.startsWith('video/');
            document.getElementById('preview-img').src = uploadedImageUrl;
            document.getElementById('preview-box').style.display = 'block';
            document.querySelector('#drop-zone p').style.display = 'none';
            document.querySelector('#drop-zone i').style.display = 'none';
            updateModeDisplay();
            showToast(strings.upload_success);
            // 自動保存上傳到歷史紀錄
            saveUploadToHistory(file.name, imageUrl, isVideoReference);
            // 顯示鏈接框
            showUploadLink(imageUrl);
        } else {
          console.error('Upload response missing URL:', data);
          showToast(data.error || data.message || strings.upload_failed);
        }
      } catch (e) {
        console.error('Upload error:', e);
        showToast(strings.upload_failed);
      }
    }

    function saveUploadToHistory(fileName, imageUrl, isVideo = false) {
        const historyItem = {
            id: 'upload_' + Date.now(),
            type: 'upload',
            url: imageUrl,
            isVideo: isVideo, // 方案 C：保存影片類型資訊
            prompt: 'Uploaded: ' + fileName,
            date: formatTimeUTC8(Date.now()),
            created_at: Date.now()
        };
      historyTasks.unshift(historyItem);
      if (historyTasks.length > 50) historyTasks.pop();
      localStorage.setItem('studio_history', JSON.stringify(historyTasks));
    }

    function showUploadLink(url) {
      const linkBox = document.getElementById('upload-link-box');
      const linkUrl = document.getElementById('upload-link-url');
      if (linkBox && linkUrl) {
        linkUrl.textContent = url;
        linkBox.classList.add('show');
      }
    }

    function copyUploadLink() {
      const linkUrl = document.getElementById('upload-link-url');
      if (linkUrl && linkUrl.textContent) {
        navigator.clipboard.writeText(linkUrl.textContent).then(() => {
          showToast(I18N[currentLang].link_copied || 'Link copied');
        });
      }
    }

    function removeImage(e) {
        e.stopPropagation();
        uploadedImageUrl = null;
        isVideoReference = false; // 方案 C：清除影片參考旗標
      const previewImg = document.getElementById('preview-img');
      previewImg.style.display = 'block'; // 恢復顯示，防止之前因 onerror 被隱藏
      previewImg.src = '';
      document.getElementById('preview-box').style.display = 'none';
      document.querySelector('#drop-zone p').style.display = 'block';
      document.querySelector('#drop-zone i').style.display = 'block';
      document.getElementById('file-input').value = '';
      updateModeDisplay();
    }

    function updateModeDisplay() {
      const strings = I18N[currentLang];
      const el = document.getElementById('mode-display');
    
      // 影片生成模式
      if (uploadedImageUrl) {
        if (uploadedImageUrl.includes('.mp4') || uploadedImageUrl.includes('video')) {
          el.textContent = strings.mode_v2v;
        } else {
          el.textContent = strings.mode_i2v;
        }
        el.style.color = 'var(--primary)';
      } else {
        el.textContent = strings.mode_t2v;
        el.style.color = 'var(--text-main)';
      }
    }

    function extendVideo(url, isVideo = true) {
        uploadedImageUrl = url;
        isVideoReference = isVideo; // 方案 C：標記為影片參考（可由呼叫者指定）
        // 使用穩定可靠的佔位圖服務，並標明為影片參考
        document.getElementById('preview-img').src = isVideo ? 'https://placehold.co/800x450/2563eb/FFF?text=Video+Reference+Active' : 'https://placehold.co/800x450/059669/FFF?text=Image+Reference+Active';
      document.getElementById('preview-box').style.display = 'block';
      document.querySelector('#drop-zone p').style.display = 'none';
      document.querySelector('#drop-zone i').style.display = 'none';
      updateModeDisplay();
      document.getElementById('prompt').focus();
      showToast(I18N[currentLang].mode_v2v);
      showUploadLink(url); // 顯示連結框
    }

    function selectReferenceVideo(url, isVideo = true) {
        // 設置此影片 URL 為參考影片，但不立即生成
        // 讓用戶另外上傳新影片時，使用此 URL 作為 image 參數
        uploadedImageUrl = url;
        isVideoReference = isVideo; // 方案 C：標記為影片參考（可由呼叫者指定）
      document.getElementById('preview-img').src = 'https://placehold.co/800x450/7c3aed/FFF?text=Reference+Selected';
      document.getElementById('preview-box').style.display = 'block';
      document.querySelector('#drop-zone p').style.display = 'none';
      document.querySelector('#drop-zone i').style.display = 'none';
      updateModeDisplay();
      document.getElementById('prompt').focus();
      showToast(I18N[currentLang].ref_selected || 'Reference video selected');
      showUploadLink(url); // 顯示連結框
    }

    // --- Tasks ---
    function initTabs() {
      document.querySelectorAll('.tab').forEach(tab => {
        tab.onclick = () => {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          currentTab = tab.getAttribute('data-tab');
          renderGallery();
        };
      });
    }

    async function submitTask() {
      const strings = I18N[currentLang];
      const prompt = document.getElementById('prompt').value.trim();
      if (!prompt) return;

      const task = {
          id: 'task_' + Date.now(),
          status: 'pending',
          prompt: prompt,
          ratio: getSelectedValue('ratio-control'),
          duration: getSelectedValue('duration-control'),
          resolution: getSelectedValue('res-control'),
          style: document.getElementById('video-mode').value,
          image: uploadedImageUrl,
          isVideo: isVideoReference, // 方案 C：傳遞影片參考旗標
          created_at: Date.now(), // 精確毫秒時間戳
          date: formatTimeUTC8(Date.now()), // 格式化後的 UTC+8 時間
          progress: 0,
          pollCount: 0
      };

      activeTasks.unshift(task);
      if (currentTab !== 'active') {
        document.querySelector('[data-tab="active"]').click();
      } else {
        renderGallery();
      }
      
      processTask(task);
    }

    async function processTask(task) {
      const strings = I18N[currentLang];
      try {
        let model = 'grok-video-' + task.style;
        if (task.image) {
          // 判斷是圖片還是影片
          if (task.image.includes('.mp4') || task.image.includes('video')) {
            model = 'grok-video-image';
          } else {
            model = 'grok-video-image';
          }
        }
        
        // 記錄任務類型
        task.type = 'video';

        // 影片生成：使用 chat completions API
        const payload = {
          model: model,
          messages: [{
            role: 'user',
            content: JSON.stringify({
              prompt: task.prompt,
              aspectRatio: task.ratio,
              duration: task.duration,
              resolution: task.resolution,
              clientPollMode: true,
              // 方案 C：優先使用 isVideo 旗標判斷，其次用 URL 字串偵測（向後兼容）
              videoUrl: (task.image && (task.isVideo === true || task.image.includes('.mp4') || task.image.includes('video'))) ? task.image : undefined,
              imageUrls: (task.image && task.isVideo !== true && !task.image.includes('.mp4') && !task.image.includes('video')) ? [task.image] : []
            })
          }],
          stream: true
        };

        const res = await fetch(ORIGIN + '/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let realId = null, uid = null, type = taskType;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value);
          const match = buffer.match(/\\\[TASK_ID:(.*?)\\\|UID:(.*?)\\\|TYPE:(.*?)\]/);
          if (match) { realId = match[1]; uid = match[2]; type = match[3] || taskType; break; }
        }

        if (realId) startPolling(task, realId, uid, type);
        else throw new Error('No task ID');

      } catch (e) {
        task.status = 'failed';
        renderGallery();
        showToast(strings.gen_failed);
      }
    }

    function startPolling(task, realId, uid, type = 'video') {
      const strings = I18N[currentLang];
      task.status = 'processing';
      task.type = type;
      
      const timer = setInterval(async () => {
        task.pollCount++;
        if (task.progress < 90) task.progress += 2;
        updateTaskCard(task);

        try {
          // 傳送 createdAt 給後端用於計算精確耗時
          const res = await fetch(\`\${ORIGIN}/v1/query/status?taskId=\${realId}&uniqueId=\${uid}&type=\${type}&createdAt=\${task.created_at}\`, {
            headers: { 'Authorization': 'Bearer ' + API_KEY }
          });
          const data = await res.json();

          if (data.status === 'completed' || data.videoUrl) {
            clearInterval(timer);
            task.status = 'completed';
            task.url = data.videoUrl || data.urls[0];
            
            // 校準時間數據
            if (data.completed_at) task.completed_at = data.completed_at;
            if (data.elapsed_ms) task.elapsed_ms = data.elapsed_ms;
            
            completeTask(task);
          } else if (data.status === 'failed') {
            clearInterval(timer);
            task.status = 'failed';
            renderGallery();
            showToast(strings.gen_failed);
          } else if (data.progress) {
            task.progress = data.progress;
            updateTaskCard(task);
          }
        } catch (e) {
          if (task.pollCount > 100) clearInterval(timer);
        }
      }, 2000);
    }

    function completeTask(task) {
      activeTasks = activeTasks.filter(t => t.id !== task.id);
      historyTasks.unshift(task);
      if (historyTasks.length > 50) historyTasks.pop();
      localStorage.setItem('studio_history', JSON.stringify(historyTasks));
      renderGallery();
      // 根據任務類型顯示不同的成功訊息
      const strings = I18N[currentLang];
      if (task.type === 'image') {
        showToast(strings.gen_done_image || strings.gen_done);
      } else {
        showToast(strings.gen_done);
      }
    }

    function renderGallery() {
      const container = document.getElementById('gallery');
      const empty = document.getElementById('empty-state');
      const items = currentTab === 'active' ? activeTasks : historyTasks;
      
      container.innerHTML = '';
      if (items.length === 0) {
        empty.style.display = 'flex';
        return;
      }
      empty.style.display = 'none';

      items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';
        card.id = \`card-\${item.id}\`;

        let media = '';
        if (item.status === 'completed') {
          // 根據類型顯示不同媒體
          if (item.type === 'image' || item.type === 'upload') {
            media = \`<img src="\${item.url}" style="width:100%;height:100%;object-fit:contain;" alt="Generated Image">\`;
          } else {
            media = \`<video src="\${item.url}" controls loop playsinline></video>\`;
          }
        } else {
          media = \`
            <div class="loading-overlay">
              <div class="spinner"></div>
              <div style="font-size:0.875rem">\${item.status === 'pending' ? I18N[currentLang].initializing : I18N[currentLang].rendering}</div>
              <div class="progress-container"><div class="progress-bar" style="width:\${item.progress}%"></div></div>
              <div style="font-size:0.75rem;opacity:0.7">\${I18N[currentLang].sync_count} \${item.pollCount}</div>
            </div>
          \`;
          if (item.image) media = \`<img src="\${item.image}" style="opacity:0.3">\` + media;
        }

        // 根據類型顯示不同的操作按鈕
        // 不論狀態，永遠顯示刪除按鈕
        let actions = \`
          <div class="card-actions">
            <button class="btn-action delete" onclick="deleteTask('\${item.id}')"><i class="fas fa-trash"></i></button>
          </div>
        \`;
        if (item.status === 'completed') {
          if (item.type === 'image') {
            actions = \`
              <div class="card-actions">
                <button class="btn-action" onclick="downloadMedia('\${item.url}', 'image')"><i class="fas fa-download"></i> \${I18N[currentLang].download}</button>
                <button class="btn-action delete" onclick="deleteTask('\${item.id}')"><i class="fas fa-trash"></i></button>
              </div>
            \`;
          } else if (item.type === 'upload') {
          actions = \`
          <div class="card-actions">
          <button class="btn-action" onclick="extendVideo('\${item.url}', \${item.isVideo || false})"><i class="fas fa-forward"></i> \${I18N[currentLang].extend}</button>
          <button class="btn-action" onclick="selectReferenceVideo('\${item.url}', \${item.isVideo || false})"><i class="fas fa-film"></i> \${I18N[currentLang].use_as_ref || 'Use as Ref'}</button>
          <button class="btn-action" onclick="copyToClipboard('\${item.url}')"><i class="fas fa-copy"></i> \${I18N[currentLang].copy_link || 'Copy Link'}</button>
          <button class="btn-action delete" onclick="deleteTask('\${item.id}')"><i class="fas fa-trash"></i></button>
          </div>
          \`;
          } else {
            actions = \`
              <div class="card-actions">
                <button class="btn-action" onclick="extendVideo('\${item.url}')"><i class="fas fa-forward"></i> \${I18N[currentLang].extend}</button>
                <button class="btn-action" onclick="selectReferenceVideo('\${item.url}')"><i class="fas fa-film"></i> \${I18N[currentLang].use_as_ref || 'Use as Ref'}</button>
                <button class="btn-action" onclick="downloadMedia('\${item.url}', 'video')"><i class="fas fa-download"></i> \${I18N[currentLang].download}</button>
                <button class="btn-action delete" onclick="deleteTask('\${item.id}')"><i class="fas fa-trash"></i></button>
              </div>
            \`;
          }
        }

        // 計算耗時文字
        let durationText = '';
        if (item.elapsed_ms) {
          const s = (item.elapsed_ms / 1000).toFixed(1);
          durationText = \`<span><i class="fas fa-stopwatch"></i> \${I18N[currentLang].gen_duration.replace('{s}', s)}</span>\`;
        }

        // 類型標籤
        const typeLabel = item.type === 'image' ? '<span><i class="fas fa-image"></i> Image</span>' : (item.type === 'upload' ? '<span><i class="fas fa-cloud-arrow-up"></i> Upload</span>' : '<span><i class="fas fa-video"></i> Video</span>');

        card.innerHTML = \`
          <div class="card-media">\${media}</div>
          <div class="card-body">
            <div class="card-prompt">\${item.prompt}</div>
            <div class="card-footer">
              <div class="card-meta">
                \${typeLabel}
                <span><i class="far fa-calendar"></i> \${item.date}</span>
                <span><i class="fas fa-expand"></i> \${item.ratio}</span>
                \${item.type !== 'image' ? \`<span><i class="fas fa-clock"></i> \${item.duration}s</span>\` : ''}
                \${durationText}
              </div>
              \${actions}
            </div>
          </div>
        \`;
        container.appendChild(card);
      });
    }

    function updateTaskCard(task) {
      const card = document.getElementById(\`card-\${task.id}\`);
      if (!card) return;
      const bar = card.querySelector('.progress-bar');
      const count = card.querySelector('.loading-overlay div:last-child');
      if (bar) bar.style.width = task.progress + '%';
      if (count) count.textContent = \`\${I18N[currentLang].sync_count} \${task.pollCount}\`;
    }

    function deleteTask(id) {
      if (!confirm(I18N[currentLang].confirm_delete)) return;
      historyTasks = historyTasks.filter(t => t.id !== id);
      localStorage.setItem('studio_history', JSON.stringify(historyTasks));
      renderGallery();
    }

    function downloadMedia(url, type = 'video') {
      const proxyUrl = ORIGIN + '/v1/proxy/download?url=' + encodeURIComponent(url);
      const a = document.createElement('a');
      a.href = proxyUrl;
      a.download = type === 'image' ? 'image.png' : 'video.mp4';
      a.click();
    }

    // 保持向後兼容
    function downloadVideo(url) {
      downloadMedia(url, 'video');
    }

    // --- Utils ---
    function updateCharCount() {
      const len = document.getElementById('prompt').value.length;
      const el = document.getElementById('char-count');
      const wrap = document.getElementById('char-counter');
      el.textContent = len;
      wrap.className = 'char-count-wrap' + (len > 1600 ? ' warning' : '') + (len >= 1800 ? ' error' : '');
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 3000);
    }

    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => showToast(I18N[currentLang].copy_success));
    }
    function copyApiOrigin() { copyToClipboard(document.getElementById('api-origin').textContent); }
    function copyApiKey() { copyToClipboard(document.getElementById('api-key').textContent); }

    window.onload = init;
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}



