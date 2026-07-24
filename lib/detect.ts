import { analyzeStatistics } from './statistics';
import { analyzeTopology } from './topology';
import { getModelConfig } from './models';
import { AI_TEMPLATE_WORDS } from './ai-words';
import type { DetectionResult, ParagraphResult, ModelResult } from '@/types';

// API配置
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.guyu.run';
const API_KEY = process.env.API_KEY || '';
const PROMPT_MODEL = process.env.PROMPT_MODEL || 'deepseek-v4-flash';

// 本地综合评分权重：统计特征（AI关键词最可靠）+ 拓扑分析
const LOCAL_WEIGHTS = { stats: 0.6, topo: 0.4 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// 本地综合检测：统计特征 + 拓扑分析
function detectLocal(text: string): { perplexity: number; aiProbability: number } {
  const stats = analyzeStatistics(text);
  const topo = analyzeTopology(text);
  const score = Math.round(stats.overallScore * LOCAL_WEIGHTS.stats + topo.overallScore * LOCAL_WEIGHTS.topo);
  return {
    perplexity: 0,
    aiProbability: Math.max(0, Math.min(100, score))
  };
}

// ----- 结构化 Prompt 模型判断 -----

interface ModelPromptResult {
  aiProbability: number;
  reason: string;
  signals: string[];
  suggestions: string[];
  degraded: boolean;
}

// 剥 markdown 代码围栏
function stripCodeFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

// 解析模型返回的 JSON（含 score/reason/signals/suggestions），三层降级
function parseModelJson(content: string): { score: number; reason: string; signals: string[]; suggestions: string[] } | null {
  const cleaned = stripCodeFence(content);

  // Step 1: 整体 JSON.parse
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj.score === 'number') {
      return {
        score: obj.score,
        reason: String(obj.reason || ''),
        signals: Array.isArray(obj.signals) ? obj.signals.map(String) : [],
        suggestions: Array.isArray(obj.suggestions) ? obj.suggestions.map(String) : []
      };
    }
  } catch { /* 继续 */ }

  // Step 2: 截取最外层 { ... }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const obj = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
      if (obj && typeof obj.score === 'number') {
        return {
          score: obj.score,
          reason: String(obj.reason || ''),
          signals: Array.isArray(obj.signals) ? obj.signals.map(String) : [],
          suggestions: Array.isArray(obj.suggestions) ? obj.suggestions.map(String) : []
        };
      }
    } catch { /* 继续 */ }
  }

  // Step 3: 正则提取 score
  const scoreMatch = cleaned.match(/"score"\s*:\s*(\d+)/);
  if (scoreMatch) {
    const reasonMatch = cleaned.match(/"reason"\s*:\s*"([^"]*)"/);
    return {
      score: parseInt(scoreMatch[1], 10),
      reason: reasonMatch ? reasonMatch[1] : '',
      signals: [],
      suggestions: []
    };
  }

  // Step 4: 从推理过程的结尾部分提取评分（处理 DeepSeek 推理模型）
  // 推理模型通常在最后给出结论，所以检查最后 500 字符
  const lastPart = cleaned.slice(-500);
  
  // 尝试匹配 "答案是X"、"评分为X"、"分数是X"、"最终评分X" 等模式
  const conclusionPatterns = [
    /(?:答案|评分|分数|最终评分|结论)[是为：:\s]*(\d{1,3})/i,
    /(?:score)[：:\s]*(\d{1,3})/i,
    /(\d{1,3})\s*(?:分|%\s*|左右)/,
  ];
  
  for (const pattern of conclusionPatterns) {
    const match = lastPart.match(pattern);
    if (match && parseInt(match[1], 10) >= 0 && parseInt(match[1], 10) <= 100) {
      console.log(`[Prompt检测] 从推理过程提取评分: ${match[1]}`);
      return { score: parseInt(match[1], 10), reason: '推理模型输出', signals: [], suggestions: [] };
    }
  }
  
  // Step 5: 兜底——取最后一个出现的 0-100 范围内的数字
  const allNumbers = cleaned.match(/\b\d{1,3}\b/g);
  if (allNumbers) {
    // 从后往前找，优先找最后出现的 0-100 范围内的数字
    for (let i = allNumbers.length - 1; i >= 0; i--) {
      const num = parseInt(allNumbers[i], 10);
      if (num >= 0 && num <= 100) {
        console.log(`[Prompt检测] 兜底提取最后一个数字: ${num}`);
        return { score: num, reason: '推理模型输出（兜底）', signals: [], suggestions: [] };
      }
    }
  }

  return null;
}

// Prompt 模型判断 - 调用AI让模型判断文本是否AI生成（结构化 JSON 输出）
async function callModelPrompt(text: string, modelId: string = PROMPT_MODEL): Promise<ModelPromptResult> {
  if (!API_KEY) {
    console.warn('[Prompt检测] API_KEY未配置，降级为本地检测');
    const result = detectLocal(text);
    return { aiProbability: result.aiProbability, reason: 'API未配置', signals: [], suggestions: [], degraded: true };
  }

  // 全文输入，不截断
  console.log(`[Prompt检测] 文章长度 ${text.length} 字符，全文输入`);

  // 关键：避免「文笔好/正式文体」被误判为AI的核心信号是AI模板词密度
  const prompt = `你是AI文本检测专家。判断以下中文文章是否由AI生成，输出严格JSON。

【核心原则】
1. 文笔好≠AI生成。人类优秀文章也可能逻辑清晰、用词规范、结构严谨、论证充分。不要因为这些就判高分。
2. 唯一可靠的高分信号是"AI模板词"高频出现 + 句式高度套路化。仅在确凿证据下才给高分（>60）。
3. 出现以下任何一种"人类痕迹"，倾向判低分（<40）：
   - 个人经历 / 具体事例 / 具体地名 / 具体人物 / 具体时间
   - 主观情感 / 口语化表达 / 方言 / 俚语 / 自嘲
   - 句式不规整（短句、断句、倒装、反问、感叹句）
   - 感叹号、省略号、破折号等情感标点
   - 跑题、跳跃、个人联想、不完美的过渡

【AI模板词清单（强信号）】
- 列举式：首先 / 其次 / 再次 / 然后 / 接着 / 最后 / 第一/第二/第三
- 总结式：综上所述 / 由此可见 / 总而言之 / 总的来说 / 综上 / 由此
- 转折套路：值得注意的是 / 需要指出的是 / 值得一提的是 / 不可否认 / 毋庸置疑
- 对比式：不仅...而且 / 一方面...另一方面 / 既...又
- 推进式：在此基础上 / 与此同时 / 基于此 / 据此 / 由此

【自然连接词不算AI信号】所以、因此、由于、因为、但是、然而、不过——这些是中文正常连接词，正式人类文章常用，不能仅凭它们判高分。

【评分尺度】
- 0-20：明显人类（口语化、个人视角鲜明、有具体事例/情感/方言）
- 20-40：可能人类（文笔不错但有人类痕迹：特定事例/方言/情感起伏/非完美句式）
- 40-60：模糊（无明显AI模板词，也无明显个人痕迹）
- 60-80：偏AI（出现AI模板词但混入部分人类风格）
- 80-100：高AI（大量AI模板词 + 句式极度规整 + 无个人视角 + 信息密度均匀）

【输出格式】严格JSON，不要任何额外文字、不要markdown代码块：
{"score": 0到100的整数, "reason": "一句话核心依据，指出主要信号", "signals": ["信号1", "信号2"], "suggestions": ["修改建议1", "修改建议2"]}

【修改建议规则】
- score < 40：建议为空数组，因为文章已足够自然
- score >= 40：给出2-3条具体、可操作的修改建议，例如：
  - "把'综上所述'替换为自己的总结表达"
  - "加入一句个人感受或具体事例"
  - "用短句打破句式均匀感"

示例：
{"score": 75, "reason": "高频出现首先/其次/综上所述，无个人视角", "signals": ["AI模板词:首先/其次/综上所述", "句式均匀", "无个人事例"], "suggestions": ["减少'首先/其次'等模板词，用自己的语言连接", "加入个人观点或具体事例", "用短句或感叹句打破均匀句式"]}

【待检测文章】
${text}`;

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1500,  // 增加到 1500，给推理模型足够的输出空间
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  const doFetch = (b: Record<string, unknown>) => fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify(b),
    signal: AbortSignal.timeout(100000)  // 100秒超时
  });

  try {
    let response = await doFetch(body);

    // 若 response_format 不被支持（可能返回400/503），移除该字段重试一次
    if (response.status === 400 || response.status === 503) {
      console.warn(`[Prompt检测] 模型 ${modelId} 返回 ${response.status}，尝试移除 response_format 重试`);
      const bodyNoFmt = { ...body };
      delete bodyNoFmt.response_format;
      response = await doFetch(bodyNoFmt);
    }

    if (!response.ok) {
      // 尝试读取错误详情
      let errorDetail = '';
      try {
        const errData = await response.json();
        errorDetail = errData.error?.message || JSON.stringify(errData);
      } catch { /* ignore */ }
      console.error(`[Prompt检测] API请求失败: ${response.status} ${errorDetail}`);
      const result = detectLocal(text);
      return { aiProbability: result.aiProbability, reason: `API请求失败:${response.status}`, signals: [], suggestions: [], degraded: true };
    }

    const data = await response.json();
    // 某些模型（如 DeepSeek 推理模型）会把回答放到 reasoning_content 字段
    let content = data.choices?.[0]?.message?.content || '';
    const reasoningContent = data.choices?.[0]?.message?.reasoning_content || '';
    
    // 如果 content 为空但 reasoning_content 有内容，使用 reasoning_content
    if (!content && reasoningContent) {
      console.log(`[Prompt检测] 模型 ${modelId} content 为空，使用 reasoning_content`);
      content = reasoningContent;
    }
    
    // 打印完整响应用于调试
    if (!content) {
      console.error(`[Prompt检测] 模型 ${modelId} 返回空内容，完整响应:`, JSON.stringify(data).substring(0, 500));
      // 空内容降级到本地
      const result = detectLocal(text);
      return { aiProbability: result.aiProbability, reason: '模型返回空内容', signals: [], suggestions: [], degraded: true };
    }
    
    console.log(`[Prompt检测] 模型 ${modelId} 返回: ${content.substring(0, 200)}`);

    const parsed = parseModelJson(content);
    if (parsed === null) {
      const result = detectLocal(text);
      return { aiProbability: result.aiProbability, reason: '无法解析评分', signals: [], suggestions: [], degraded: true };
    }

    return {
      aiProbability: clamp(parsed.score, 0, 100),
      reason: parsed.reason || '模型判断',
      signals: parsed.signals,
      suggestions: parsed.suggestions,
      degraded: false
    };
  } catch (error) {
    console.error('[Prompt检测] 异常:', error);
    const result = detectLocal(text);
    return { aiProbability: result.aiProbability, reason: '调用异常', signals: [], suggestions: [], degraded: true };
  }
}

// 一致性纠偏：综合模型评分与本地评分
function reconcileScore(
  promptScore: number,
  localScore: number,
  stats: { overallScore: number }
): number {
  const diff = Math.abs(promptScore - localScore);

  // 路径 A：本地硬证据——AI 关键词密度极高，但模型给低分（模型可能漏看模板词）
  if (stats.overallScore > 70 && promptScore < 30) {
    console.log(`[纠偏] 路径A 本地硬证据 prompt=${promptScore} local=${localScore} → 50/50`);
    return clamp(Math.round(promptScore * 0.5 + localScore * 0.5), 0, 100);
  }

  // 路径 B：严重分歧 > 40，倾向于信任模型（本地特征已校准但仍偏噪）
  if (diff > 40) {
    console.log(`[纠偏] 路径B 严重分歧 diff=${diff} → 85/15`);
    return clamp(Math.round(promptScore * 0.85 + localScore * 0.15), 0, 100);
  }

  // 路径 C：默认 模型 70% + 本地 30%
  return clamp(Math.round(promptScore * 0.7 + localScore * 0.3), 0, 100);
}

// ----- 段落级批量检测 -----

interface SentenceInfo { text: string; start: number; end: number; }
interface ChunkInfo { index: number; text: string; start: number; end: number; }

// 解析批量段落返回的 JSON 数组，多层降级
function parseBatchResponse(content: string): Map<number, { score: number; reason: string; suggestions: string[] }> {
  const result = new Map<number, { score: number; reason: string; suggestions: string[] }>();
  let cleaned = stripCodeFence(content);

  // Step 1: 整体 JSON.parse
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item.index === 'number' && typeof item.score === 'number') {
          result.set(item.index, {
            score: clamp(item.score, 0, 100),
            reason: String(item.reason || '').substring(0, 200),
            suggestions: Array.isArray(item.suggestions) ? item.suggestions.map(String) : []
          });
        }
      }
      if (result.size > 0) return result;
    }
  } catch { /* 继续 */ }

  // Step 2: 截取最外层 [ ... ]
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    try {
      const arr = JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item.index === 'number' && typeof item.score === 'number') {
            result.set(item.index, {
              score: clamp(item.score, 0, 100),
              reason: String(item.reason || '').substring(0, 200),
              suggestions: Array.isArray(item.suggestions) ? item.suggestions.map(String) : []
            });
          }
        }
        if (result.size > 0) return result;
      }
    } catch { /* 继续 */ }
  }

  // Step 3: 尝试包装成数组（处理 "{...}, {...}, {...}" 格式）
  // 移除首尾逗号，加上方括号
  const trimmed = cleaned.trim().replace(/^,+\s*/, '').replace(/,+\s*$/, '');
  if (trimmed.startsWith('{')) {
    try {
      const arr = JSON.parse('[' + trimmed + ']');
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item.index === 'number' && typeof item.score === 'number') {
            result.set(item.index, {
              score: clamp(item.score, 0, 100),
              reason: String(item.reason || '').substring(0, 200),
              suggestions: Array.isArray(item.suggestions) ? item.suggestions.map(String) : []
            });
          }
        }
        if (result.size > 0) return result;
      }
    } catch { /* 继续 */ }
  }

  // Step 4: 逐对象正则提取（处理多行 JSON 对象）
  // 匹配 { ... "index": N ... "score": M ... } 格式，支持多行
  const objRegex = /\{[\s\S]*?"index"\s*:\s*(\d+)[\s\S]*?"score"\s*:\s*(\d+)[\s\S]*?\}/g;
  let m: RegExpExecArray | null;
  while ((m = objRegex.exec(cleaned)) !== null) {
    const idx = parseInt(m[1], 10);
    const score = clamp(parseInt(m[2], 10), 0, 100);
    // 提取 reason（可能跨行，用非贪婪匹配）
    const reasonMatch = m[0].match(/"reason"\s*:\s*"([\s\S]*?)"/);
    const reason = reasonMatch ? reasonMatch[1].replace(/\\n/g, ' ').substring(0, 200) : '';
    // 提取 suggestions（数组格式）
    const suggestionsMatch = m[0].match(/"suggestions"\s*:\s*\[([\s\S]*?)\]/);
    let suggestions: string[] = [];
    if (suggestionsMatch) {
      try {
        suggestions = JSON.parse('[' + suggestionsMatch[1] + ']');
      } catch { /* 忽略解析错误 */ }
    }
    result.set(idx, { score, reason, suggestions });
  }

  return result;
}

// 一次 API 调用检测所有片段，返回 { index: { score, reason } }
async function callBatchParagraphModel(
  chunks: ChunkInfo[],
  modelId: string
): Promise<Map<number, { score: number; reason: string; suggestions: string[] }>> {
  if (!API_KEY || chunks.length === 0) return new Map();

  const fragments = chunks.map(ch => `【片段${ch.index}】\n${ch.text}`).join('\n\n');
  const prompt = `你是AI文本检测专家。下面有 ${chunks.length} 个文本片段，逐个判断是否AI生成。输出严格JSON数组。

【核心原则】
1. 文笔好≠AI生成。人类优秀文章也可能结构严谨、用词规范。不要因为这些就判高分。
2. 唯一可靠的高分信号是"AI模板词"高频出现 + 句式高度套路化。仅在确凿证据下才给高分（>60）。
3. 出现以下任何一种"人类痕迹"，倾向判低分（<40）：
   - 个人经历 / 具体事例 / 具体地名 / 具体人物 / 具体时间
   - 主观情感 / 口语化表达 / 方言 / 俚语 / 自嘲
   - 句式不规整（短句、断句、倒装、反问、感叹句）
   - 感叹号、省略号、破折号等情感标点

【AI模板词清单（强信号）】
- 列举式：首先 / 其次 / 再次 / 然后 / 接着 / 最后
- 总结式：综上所述 / 由此可见 / 总而言之 / 总的来说 / 综上
- 转折套路：值得注意的是 / 需要指出的是 / 值得一提的是 / 不可否认
- 对比式：不仅...而且 / 一方面...另一方面 / 既...又

【自然连接词不算AI信号】所以、因此、由于、因为、但是、然而、不过、同时、开始、负责、能够、通过、进行——这些是中文正常词汇，不能仅凭它们判高分。

【评分尺度】
- 0-20：明显人类（口语化、有具体事例/情感）
- 20-40：可能人类（有人类痕迹但文笔不错）
- 40-60：模糊（无明显AI模板词，也无明显人类痕迹）
- 60-80：偏AI（出现AI模板词但混入部分人类风格）
- 80-100：高AI（大量AI模板词 + 句式极度规整）

【输出格式】严格JSON数组，每个元素对应一个片段，index 必须与输入一致。不要输出任何其他文字、不要markdown代码块：
[
  {"index": 1, "score": 0到100整数, "reason": "一句话依据", "suggestions": ["修改建议1", "修改建议2"]},
  {"index": 2, "score": ..., "reason": ..., "suggestions": ...}
]

【修改建议规则】
- score < 40：suggestions 为空数组，因为片段已足够自然
- score >= 40：给出1-2条具体、可操作的修改建议

${fragments}`;

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: Math.min(2000, 100 * chunks.length + 200),
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  const doFetch = (b: Record<string, unknown>) => fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify(b),
    signal: AbortSignal.timeout(100000)  // 100秒超时
  });

  try {
    let response = await doFetch(body);

    // response_format 不支持则移除重试（400/503）
    if (response.status === 400 || response.status === 503) {
      console.warn(`[段落检测] 模型 ${modelId} 返回 ${response.status}，尝试移除 response_format 重试`);
      const bodyNoFmt = { ...body };
      delete bodyNoFmt.response_format;
      response = await doFetch(bodyNoFmt);
    }

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errData = await response.json();
        errorDetail = errData.error?.message || JSON.stringify(errData);
      } catch { /* ignore */ }
      console.error(`[段落检测] API请求失败: ${response.status} ${errorDetail}`);
      return new Map();
    }

    const data = await response.json();
    // 某些模型（如 DeepSeek 推理模型）会把回答放到 reasoning_content 字段
    let content = data.choices?.[0]?.message?.content || '';
    const reasoningContent = data.choices?.[0]?.message?.reasoning_content || '';
    
    // 如果 content 为空但 reasoning_content 有内容，使用 reasoning_content
    if (!content && reasoningContent) {
      console.log(`[段落检测] 模型 ${modelId} content 为空，使用 reasoning_content`);
      content = reasoningContent;
    }
    
    // 打印完整响应用于调试
    if (!content) {
      console.error(`[段落检测] 模型 ${modelId} 返回空内容，完整响应:`, JSON.stringify(data).substring(0, 500));
      return new Map();
    }
    console.log(`[段落检测] 模型 ${modelId} 返回: ${content.substring(0, 300)}`);

    return parseBatchResponse(content);
  } catch (error) {
    console.error('[段落检测] 异常:', error);
    return new Map();
  }
}

// 段落级检测（全文标注，支持多模型并行）
export async function detectParagraphs(text: string, modelIds: string | string[] = PROMPT_MODEL): Promise<ParagraphResult[]> {
  // 统一处理为模型数组
  const modelList = Array.isArray(modelIds) ? modelIds : [modelIds];
  
  // 句子分割 + 位置追踪
  const sentences: SentenceInfo[] = [];
  const re = /[^。！？\n]+[。！？\n]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s.length >= 10) {
      sentences.push({ text: s, start: m.index, end: m.index + m[0].length });
    }
  }

  if (sentences.length === 0) {
    // 无法分割，直接返回整体
    const { aiProbability } = detectLocal(text);
    return [{
      paragraph: text,
      startIndex: 0,
      endIndex: text.length,
      aiProbability,
      isAI: aiProbability > 60,
      suggestions: []
    }];
  }

  // 每5句一组，最多8片段，单片段300字上限
  const CHUNK_SIZE = 5;
  const MAX_CHUNKS = 8;
  const MAX_CHUNK_CHARS = 300;
  const chunks: ChunkInfo[] = [];
  for (let i = 0; i < sentences.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
    const group = sentences.slice(i, i + CHUNK_SIZE);
    if (group.length === 0) continue;
    let chunkText = group.map(g => g.text).join('');
    let start = group[0].start;
    let end = group[group.length - 1].end;
    if (chunkText.length > MAX_CHUNK_CHARS) {
      chunkText = chunkText.substring(0, MAX_CHUNK_CHARS);
      end = start + chunkText.length;
    }
    chunks.push({ index: chunks.length + 1, text: chunkText, start, end });
  }

  // 多模型并行调用
  console.log(`[段落检测] 调用 ${modelList.length} 个模型并行检测...`);
  const allResults = await Promise.all(
    modelList.map(modelId => callBatchParagraphModel(chunks, modelId))
  );

  // 统计成功的模型数
  const successCount = allResults.filter(r => r.size > 0).length;
  console.log(`[段落检测] 成功模型: ${successCount}/${modelList.length}`);

  // 组装结果（多模型取平均，缺失片段降级到本地）
  return chunks.map(ch => {
    // 收集所有成功模型的评分、reason、suggestions
    const scores: number[] = [];
    let firstReason = '';
    let firstSuggestions: string[] = [];
    
    // 收集各模型的独立结果
    const modelResults: { modelId: string; modelName: string; score: number; reason: string; suggestions: string[] }[] = [];
    
    for (let i = 0; i < allResults.length; i++) {
      const batchResult = allResults[i];
      const modelId = modelList[i];
      const modelConfig = getModelConfig(modelId);
      const r = batchResult.get(ch.index);
      
      if (r) {
        scores.push(r.score);
        if (!firstReason) firstReason = r.reason;
        if (firstSuggestions.length === 0) firstSuggestions = r.suggestions;
        
        // 添加到 modelResults
        modelResults.push({
          modelId,
          modelName: modelConfig?.name || modelId,
          score: r.score,
          reason: r.reason,
          suggestions: r.suggestions
        });
      }
    }
    
    // 计算平均评分
    let ai: number;
    let reason: string;
    let suggestions: string[];
    
    if (scores.length > 0) {
      ai = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      reason = firstReason || '多模型平均';
      suggestions = firstSuggestions;
    } else {
      // 所有模型都失败，降级到本地
      ai = detectLocal(ch.text).aiProbability;
      reason = '本地降级';
      suggestions = [];
    }
    
    return {
      paragraph: ch.text,
      startIndex: ch.start,
      endIndex: ch.end,
      aiProbability: ai,
      isAI: ai > 60,
      reason,
      suggestions,
      modelResults
    };
  });
}

// AI来源识别
export function identifyAISource(text: string): { chatgpt: number; claude: number; kimi: number; qwen: number; deepseek: number; other: number } {
  const features = analyzeStatistics(text);

  // 基于特征判断来源
  // ChatGPT: 结构化强，"首先其次"多
  const chatgptScore = (features.punctuationScore > 70 ? 20 : 10) +
                       (text.includes('首先') || text.includes('其次') ? 25 : 0) +
                       (text.includes('此外') || text.includes('总之') ? 20 : 0);

  // Claude: 温和详细，爱用举例
  const claudeScore = (text.includes('例如') || text.includes('比如') ? 25 : 0) +
                      (text.includes('可能') || text.includes('或许') ? 20 : 0) +
                      (features.lexicalDiversity > 50 ? 15 : 5);

  // Kimi: 逻辑清晰，知识密集
  const kimiScore = (features.sentenceLengthVariance < 40 ? 20 : 10) +
                    (text.includes('根据') || text.includes('基于') ? 20 : 0) +
                    (text.includes('数据') || text.includes('研究') ? 15 : 5);

  // Qwen: 中式表达，成语多
  const qwenScore = (text.match(/[\u4e00-\u9fa5]{4}/g) || []).length > 5 ? 25 : 10;

  // DeepSeek: 技术感，代码相关
  const deepseekScore = (text.includes('代码') || text.includes('算法') ? 25 : 0) +
                        (text.includes('实现') || text.includes('函数') ? 20 : 0);

  // 其他
  const total = chatgptScore + claudeScore + kimiScore + qwenScore + deepseekScore;
  const otherScore = Math.max(100 - total, 10);

  // 归一化到100%
  const sum = chatgptScore + claudeScore + kimiScore + qwenScore + deepseekScore + otherScore;

  return {
    chatgpt: Math.round(chatgptScore / sum * 100),
    claude: Math.round(claudeScore / sum * 100),
    kimi: Math.round(kimiScore / sum * 100),
    qwen: Math.round(qwenScore / sum * 100),
    deepseek: Math.round(deepseekScore / sum * 100),
    other: Math.round(otherScore / sum * 100)
  };
}

// 计算置信区间
export function calculateConfidenceInterval(aiProbability: number, samples: number = 3): { lower: number; upper: number } {
  // 基于概率和样本数计算置信区间
  const stdDev = 10 + (50 - Math.abs(aiProbability - 50)) * 0.3; // 越接近50%，不确定性越大
  const margin = stdDev * 1.96 / Math.sqrt(samples);

  return {
    lower: Math.max(0, Math.round(aiProbability - margin)),
    upper: Math.min(100, Math.round(aiProbability + margin))
  };
}

// 主检测函数
export async function detectAIContent(
  text: string,
  options: {
    models?: string[];
    enableParagraphDetection?: boolean;
    enableSourceIdentification?: boolean;
    enableSuggestions?: boolean;
  } = {}
): Promise<DetectionResult> {
  const {
    models = ['deepseek-v4-flash'],
    enableParagraphDetection = false,
    enableSourceIdentification = false,
    enableSuggestions = false
  } = options;

  console.log('[检测] 开始检测, 模型:', models);

  try {
    // 1. 本地评分（一次性，所有模型共用）
    const stats = analyzeStatistics(text);
    const topo = analyzeTopology(text);
    const localScore = Math.round(stats.overallScore * LOCAL_WEIGHTS.stats + topo.overallScore * LOCAL_WEIGHTS.topo);
    const perplexity = 0;

    // 2. 真实多模型并行调用
    console.log('[检测] 调用模型深度判断...');
    const promptModels = models.length > 0 ? models : [PROMPT_MODEL];
    const promptResults = await Promise.all(
      promptModels.map(m => callModelPrompt(text, m))
    );

    // 3. 构造 modelResults（真实分数 + 依据 + 降级标记）
    const modelResults: ModelResult[] = promptResults.map((r, i) => {
      const cfg = getModelConfig(promptModels[i]);
      return {
        modelId: promptModels[i],
        modelName: cfg?.name || promptModels[i],
        aiProbability: r.aiProbability,
        perplexity: 0,
        reason: r.reason,
        signals: r.signals,
        degraded: r.degraded
      };
    });

    // 4. 只对未降级模型取平均作为 promptScore
    // 全部降级时用保守值 50（不确定），而不是 localScore（避免本地评分偏高误判）
    const validResults = promptResults.filter(r => !r.degraded);
    const allDegraded = validResults.length === 0;
    
    const promptScore = validResults.length > 0
      ? Math.round(validResults.reduce((s, r) => s + r.aiProbability, 0) / validResults.length)
      : 50;  // 全部降级时用保守值
    
    const promptReason = validResults[0]?.reason || (allDegraded ? '全部模型降级' : '本地降级');
    
    // 如果全部模型降级，降低置信度并打印警告
    if (allDegraded) {
      console.warn(`[检测] 警告：全部模型降级，使用保守评分 50，本地评分为 ${localScore}`);
    }

    // 5. 一致性纠偏综合评分
    const aiProbability = reconcileScore(promptScore, localScore, stats);

    // 置信度判断
    let confidence: 'high' | 'medium' | 'low';
    if (aiProbability > 80 || aiProbability < 20) {
      confidence = 'high';
    } else if (aiProbability > 60 || aiProbability < 40) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }
    console.log(`[检测] 本地评分 ${localScore} + 模型评分 ${promptScore} = 综合评分 ${aiProbability}% (${promptReason})`);

    // 6. 置信区间（样本数=成功返回的模型数）
    const confidenceInterval = calculateConfidenceInterval(aiProbability, Math.max(1, validResults.length));

    // 7. 生成分析说明
    const analysis = generateAnalysis(aiProbability, perplexity, stats, modelResults, topo, promptScore);

    // 8. 段落级检测（可选）
    // 使用所有成功的模型进行段落检测
    let paragraphResults: ParagraphResult[] | undefined;
    if (enableParagraphDetection && text.length > 200) {
      try {
        // 收集所有成功模型的 ID
        const successModelIds: string[] = [];
        promptResults.forEach((r, i) => {
          if (!r.degraded) {
            successModelIds.push(promptModels[i]);
          }
        });
        
        // 如果没有成功的模型，用第一个模型尝试（可能降级）
        const modelsToUse = successModelIds.length > 0 ? successModelIds : [models[0] || PROMPT_MODEL];
        
        console.log(`[段落检测] 使用 ${successModelIds.length}/${promptModels.length} 个成功模型`);
        paragraphResults = await detectParagraphs(text, modelsToUse);
      } catch (error) {
        console.error('[检测] 段落级检测失败:', error);
      }
    }

    // 9. AI来源识别（可选）
    let sourceIdentification;
    if (enableSourceIdentification) {
      sourceIdentification = identifyAISource(text);
    }

    // 10. 修改建议（可选，从模型返回中获取）
    let suggestions: string[] | undefined;
    if (enableSuggestions) {
      // 取第一个成功模型的 suggestions
      suggestions = validResults[0]?.suggestions;
    }

    console.log(`[检测] 完成, AI概率: ${aiProbability}%`);

    return {
      aiProbability,
      perplexity,
      modelScore: promptScore,
      localScore,
      confidence,
      confidenceInterval,
      statistics: {
        sentenceLengthVariance: stats.sentenceLengthVariance,
        lexicalDiversity: stats.lexicalDiversity,
        punctuationScore: stats.punctuationScore
      },
      analysis,
      suggestions,
      sourceIdentification,
      paragraphResults,
      modelResults,
      contentLength: text.length,
      source: 'text'
    };
  } catch (error) {
    console.error('[检测] 检测失败:', error);
    throw error;
  }
}

// 生成分析说明
function generateAnalysis(
  aiProbability: number,
  perplexity: number,
  stats: { sentenceLengthVariance: number; lexicalDiversity: number; punctuationScore: number; overallScore: number },
  modelResults: ModelResult[],
  topo?: { informationDensity: number; logicalConnection: number; argumentDepth: number; paragraphLength: number; overallScore: number },
  promptScore?: number
): string {
  const lines: string[] = [];

  if (aiProbability > 70) {
    lines.push('⚠️ 检测结果显示该文本很可能由AI生成。');
  } else if (aiProbability > 50) {
    lines.push('⚠️ 检测结果显示该文本有较大可能由AI生成。');
  } else if (aiProbability > 30) {
    lines.push('✓ 检测结果显示该文本可能是人类写作。');
  } else {
    lines.push('✓ 检测结果显示该文本很可能由人类写作。');
  }

  // 多模型结果
  if (modelResults.length > 1) {
    lines.push(`\n**多模型检测结果**：`);
    modelResults.forEach(r => {
      const tag = r.degraded ? '（已降级到本地）' : '';
      lines.push(`- ${r.modelName}: ${r.aiProbability}% AI概率${tag}`);
    });
  }

  // 模型深度分析
  if (promptScore !== undefined) {
    lines.push(`\n**模型深度分析**：${promptScore}/100 AI概率`);
    if (promptScore < 20) {
      lines.push('- 模型判定为纯人类原创');
    } else if (promptScore < 40) {
      lines.push('- 模型判定为可能人类写作');
    } else if (promptScore < 70) {
      lines.push('- 模型判定为人类加工过的AI文本');
    } else {
      lines.push('- 模型判定为AI生成');
    }
  }

  lines.push(`\n**统计特征分析**：`);
  lines.push(`- 句长方差评分：${stats.sentenceLengthVariance}/100`);
  lines.push(`- 词汇多样性：${stats.lexicalDiversity}/100`);
  lines.push(`- 标点分布：${stats.punctuationScore}/100`);

  // 拓扑特征分析
  if (topo) {
    lines.push(`\n**结构特征分析**：`);
    lines.push(`- 信息密度分布：${topo.informationDensity}/100`);
    lines.push(`- 逻辑连接强度：${topo.logicalConnection}/100`);
    lines.push(`- 论证深度变化：${topo.argumentDepth}/100`);
    lines.push(`- 段落长度分布：${topo.paragraphLength}/100`);
  }

  return lines.join('\n');
}
