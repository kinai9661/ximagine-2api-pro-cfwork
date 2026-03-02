
const assert = require('assert');

// 模擬 CONFIG
const CONFIG = {
  MODEL_MAP: {
      "grok-video-normal": { type: "video", mode: "normal", channel: "GROK_IMAGINE", pageId: 886 },
      "grok-imagine-video": { type: "video", mode: "normal", channel: "GROK_IMAGINE", pageId: 886 },
  },
  DEFAULT_MODEL: "grok-video-normal",
};

// 測試用的參數驗證邏輯 (與 worker.js 保持一致)
function validateParams(prompt, aspectRatio, duration, resolution, modelKey) {
  const modelConfig = CONFIG.MODEL_MAP[modelKey] || CONFIG.MODEL_MAP[CONFIG.DEFAULT_MODEL];

  // 嚴格校驗比例
  const validRatios = ["1:1", "3:2", "2:3", "16:9", "9:16"];
  let finalRatio = aspectRatio;
  if (!validRatios.includes(finalRatio)) {
      finalRatio = "1:1";
  }

  // 驗證時長 (支援 5, 8, 10)
  const validDurations = [5, 8, 10];
  let finalDuration = parseInt(duration) || 5;
  if (!validDurations.includes(finalDuration)) {
      finalDuration = 5;
  }

  // 驗證解析度 (支援 720p, 1080p)
  const validResolutions = ["720p", "1080p"];
  let finalResolution = resolution || "720p";
  if (!validResolutions.includes(finalResolution)) {
      finalResolution = "720p";
  }

  return {
      prompt,
      aspectRatio: finalRatio,
      duration: finalDuration,
      resolution: finalResolution,
      model: modelConfig.channel,
      pageId: modelConfig.pageId
  };
}

// 測試案例
const testCases = [
  {
    name: "標準正確參數 (16:9, 8s, 720p)",
    input: ["Timelapse of a flower", "16:9", 8, "720p", "grok-imagine-video"],
    expected: { aspectRatio: "16:9", duration: 8, resolution: "720p" }
  },
  {
    name: "無效比例 (應回退至 1:1)",
    input: ["Test", "21:9", 8, "720p", "grok-imagine-video"],
    expected: { aspectRatio: "1:1", duration: 8, resolution: "720p" }
  },
  {
    name: "無效時長 (應回退至 5s)",
    input: ["Test", "16:9", 15, "720p", "grok-imagine-video"],
    expected: { aspectRatio: "16:9", duration: 5, resolution: "720p" }
  },
  {
    name: "無效解析度 (應回退至 720p)",
    input: ["Test", "16:9", 8, "4K", "grok-imagine-video"],
    expected: { aspectRatio: "16:9", duration: 8, resolution: "720p" }
  },
  {
    name: "1080p 解析度支援",
    input: ["Test", "9:16", 10, "1080p", "grok-imagine-video"],
    expected: { aspectRatio: "9:16", duration: 10, resolution: "1080p" }
  }
];

console.log("🚀 開始執行單元測試...");

testCases.forEach((tc, idx) => {
  const result = validateParams(...tc.input);
  try {
    assert.strictEqual(result.aspectRatio, tc.expected.aspectRatio);
    assert.strictEqual(result.duration, tc.expected.duration);
    assert.strictEqual(result.resolution, tc.expected.resolution);
    console.log(`✅ [${idx + 1}/${testCases.length}] ${tc.name} - 通過`);
  } catch (err) {
    console.error(`❌ [${idx + 1}/${testCases.length}] ${tc.name} - 失敗`);
    console.error(`   期望: ${JSON.stringify(tc.expected)}`);
    console.error(`   實際: ${JSON.stringify({
      aspectRatio: result.aspectRatio,
      duration: result.duration,
      resolution: result.resolution
    })}`);
  }
});

console.log("\n✨ 測試完成。");
