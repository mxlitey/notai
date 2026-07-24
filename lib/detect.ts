import { analyzeStatistics } from './statistics';
import { analyzeTopology } from './topology';
import { getModelConfig } from './models';
import { AI_TEMPLATE_WORDS } from './ai-words';
import type { DetectionResult, ParagraphResult, ModelResult } from '@/types';

// API配置
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.guyu.run';
const API_KEY = process.env.API_KEY || '';
// 支持多模型配置（分号分隔）
const PROMPT_MODELS = (process.env.PROMPT_MODEL || 'deepseek-v4-flash')
  .split(';')
  .map(m => m.trim())
  .filter(m => m.length > 0);

// 获取可用模型列表
export function getAvailableModels(): string[] {
  return PROMPT_MODELS;
}

// 获取默认模型
export function getDefaultModel(): string {
  return PROMPT_MODELS[0];
}

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

// 检测文本是否为网页代码（HTML/CSS/JavaScript/JSON等）
function isWebCode(text: string): boolean {
  // 常见的网页代码特征
  const webCodePatterns = [
    /<\s*[\w]+[^>]*>/,                                    // HTML标签
    /<\/\s*[\w]+\s*>/,                                    // HTML闭合标签
    /\b(function|const|let|var)\s+[\w]+\s*[=\(]/,        // JavaScript变量/函数声明
    /\$\([^)]*\)\s*\./,                                   // jQuery
    /\.\w+\s*\([^)]*\)/,                                 // 方法调用（不要求分号）
    /{\s*"\w+"\s*:\s*[^}]+}/,                            // JSON对象
    /\b(def |class |import |from |return )/i,            // Python代码特征
    /\b(if|else|for|while)\s*\([^)]*\)\s*{/,             // 控制语句
    /console\.(log|error|warn)\s*\(/,                    // console输出
    /document\.\w+/,                                      // document对象（更宽松）
    /window\.\w+/,                                        // window对象
    /@media\s*\(/,                                        // CSS媒体查询
    /\.\w+\s*{\s*\w+:\s*[^}]+;?\s*}/,                    // CSS样式块
    /<!--.*-->/,                                          // HTML注释
    /\/\*[\s\S]*?\*\//,                                   // 多行注释
    /\bdata-\w+=/,                                        // data属性
    /\bclass=["'][^"']+["']/,                            // class属性
    /\bid=["'][^"']+["']/,                               // id属性
    /\bhref=["'][^"']+["']/,                             // href属性
    /\bsrc=["'][^"']+["']/,                              // src属性
    /\bon\w+=["'][^"']+["']/,                            // 事件属性
    /\.\w+\s*=\s*[^;]+;/,                                // 属性赋值
    /\bpreventDefault\s*\(/,                             // 事件阻止默认行为
    /\bgetRangeAt\s*\(/,                                 // Selection API
    /\bcommonAncestorContainer\b/,                       // DOM Range API
    /\bgetElementById\s*\(/,                             // DOM获取元素
    /\bquerySelector\s*\(/,                              // DOM查询
    /\baddEventListener\s*\(/,                           // 事件监听
    /\bsetAttribute\s*\(/,                               // 设置属性
    /\bappendChild\s*\(/,                                // 添加子节点
    /\binnerHTML\b/,                                     // innerHTML属性
    /\bouterHTML\b/,                                     // outerHTML属性
    /\btextContent\b/,                                   // textContent属性
    /\+new Date\s*\(\)/,                                 // +new Date() 时间戳写法
    /\bmetaKey\b/,                                       // 事件 metaKey
    /\bctrlKey\b/,                                       // 事件 ctrlKey
    /\bkeyCode\b/,                                       // 事件 keyCode
    /\bshiftKey\b/,                                      // 事件 shiftKey
    /\be\.key\s*===?\s*['"]/,                           // e.key === 'xxx'
    /\bnew\s+\w+\s*\(/,                                  // new 构造函数
  ];

  // 计算匹配的模式数量
  let matchCount = 0;
  for (const pattern of webCodePatterns) {
    if (pattern.test(text)) {
      matchCount++;
    }
  }

  // 如果匹配 2 个或以上模式，认为是网页代码
  if (matchCount >= 2) return true;

  return false;
}

// ----- 结构化 Prompt 模型判断 -----

interface ModelPromptResult {
  aiProbability: number;
  reason: string;
  signals: string[];
  suggestions: string[];
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

  return null;
}

// Prompt 模型判断 - 调用AI让模型判断文本是否AI生成（结构化 JSON 输出）
async function callModelPrompt(text: string, modelId: string = getDefaultModel()): Promise<ModelPromptResult> {
  if (!API_KEY) {
    console.error('[Prompt检测] API_KEY未配置');
    throw new Error('API_KEY未配置，无法进行检测');
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
    // 不限制 max_tokens，让模型完整输出
    temperature: 0.1,
    response_format: { type: 'json_object' },
    reasoning_effort: 'low'  // 低推理强度，但某些模型可能不生效
  };

  const doFetch = (b: Record<string, unknown>) => fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify(b),
    signal: AbortSignal.timeout(110000)  // 110秒超时
  });

  // 不重试，直接返回错误
  try {
    let response = await doFetch(body);

    // 若 response_format 不被支持（可能返回400/500/503），移除该字段重试
    if (response.status === 400 || response.status === 500 || response.status === 503) {
      console.warn(`[Prompt检测] 模型 ${modelId} 返回 ${response.status}，尝试移除 response_format`);
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
      throw new Error(`API请求失败: ${response.status} ${errorDetail}`);
    }

    const data = await response.json();
    
    // 智能提取最终结果（过滤推理过程）
    let content = data.choices?.[0]?.message?.content || '';
    
    // 检查是否有 reasoning_content 字段（推理模型的特殊字段）
    const reasoningContent = data.choices?.[0]?.message?.reasoning_content;
    if (reasoningContent) {
      console.log(`[Prompt检测] 检测到推理过程，长度 ${reasoningContent.length} 字符，已过滤`);
    }

    // 打印完整响应用于调试
    if (!content) {
      console.error(`[Prompt检测] 模型 ${modelId} 返回空内容，完整响应:`, JSON.stringify(data));
      throw new Error('模型返回空内容');
    }

    console.log(`[Prompt检测] 模型 ${modelId} 返回: ${content}`);

    const parsed = parseModelJson(content);
    if (parsed === null) {
      throw new Error('无法解析模型返回的评分');
    }

    return {
      aiProbability: clamp(parsed.score, 0, 100),
      reason: parsed.reason || '模型判断',
      signals: parsed.signals,
      suggestions: parsed.suggestions
    };
  } catch (error) {
    console.error(`[Prompt检测] 错误:`, error);
    throw error;
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
function parseBatchResponse(content: string): Map<number, { score: number; reason: string; signals: string[]; suggestions: string[] }> {
  const result = new Map<number, { score: number; reason: string; signals: string[]; suggestions: string[] }>();
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
            signals: Array.isArray(item.signals) ? item.signals.map(String) : [],
            suggestions: Array.isArray(item.suggestions) ? item.suggestions.map(String) : []
          });
        }
      }
      if (result.size > 0) return result;
    }
  } catch { /* 继续 */ }

  // Step 2: 截取最外层 [ ... ]（处理推理输出后跟着 JSON 的情况）
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    try {
      const jsonStr = cleaned.substring(firstBracket, lastBracket + 1);
      const arr = JSON.parse(jsonStr);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item.index === 'number' && typeof item.score === 'number') {
            result.set(item.index, {
              score: clamp(item.score, 0, 100),
              reason: String(item.reason || '').substring(0, 200),
              signals: Array.isArray(item.signals) ? item.signals.map(String) : [],
              suggestions: Array.isArray(item.suggestions) ? item.suggestions.map(String) : []
            });
          }
        }
        if (result.size > 0) return result;
      }
    } catch { /* 继续 */ }
  }

  // Step 3: 尝试包装成数组（处理 "{...}, {...}, {...}" 格式）
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
              signals: Array.isArray(item.signals) ? item.signals.map(String) : [],
              suggestions: Array.isArray(item.suggestions) ? item.suggestions.map(String) : []
            });
          }
        }
        if (result.size > 0) return result;
      }
    } catch { /* 继续 */ }
  }

  // 所有解析方法都失败，抛出错误
  console.error('[段落检测] 模型返回格式错误，无法解析JSON:');
  console.error('返回内容前200字符:', cleaned.substring(0, 200));
  throw new Error('模型返回格式错误：未找到有效的JSON数据');
}

// 基于段落检测结果，调用模型进行综合分析
async function callModelOverallAnalysis(
  text: string,
  paragraphResults: ParagraphResult[],
  modelId: string
): Promise<{ aiProbability: number; reason: string; signals: string[]; suggestions: string[] } | null> {
  if (!API_KEY) return null;

  // 构造段落评分摘要
  const normalResults = paragraphResults.filter(r => !r.skipped);
  const summary = normalResults.map((r, i) => ({
    index: i + 1,
    score: r.aiProbability,
    reason: r.reason || ''
  }));

  const avgScore = normalResults.length > 0
    ? Math.round(normalResults.reduce((a, b) => a + b.aiProbability, 0) / normalResults.length)
    : 50;

  const prompt = `你是AI文本检测专家。基于段落检测结果对全文进行综合分析。

【原文】
${text}

【段落检测结果】
共 ${normalResults.length} 个片段

详细评分：
${JSON.stringify(summary, null, 2)}

【任务】
请综合分析原文和段落检测结果，给出：
1. 整体AI概率评分（0-100）
2. 一句话判断依据（reason）
3. 检测到的信号（signals数组，如"具体人物"、"AI模板词"等）
4. 修改建议（suggestions数组，score >= 40时提供1-2条建议）

【输出格式】（JSON对象）
{
  "score": 0-100,
  "reason": "一句话核心依据",
  "signals": ["信号1", "信号2"],
  "suggestions": []
}

直接输出JSON对象，不要任何其他内容：`;

  try {
    const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(60000)  // 60秒超时
    });

    if (!response.ok) {
      console.error(`[综合分析] API错误: ${response.status}`);
      return null;
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';

    // 过滤推理过程
    if (data.choices?.[0]?.message?.reasoning_content) {
      console.log(`[综合分析] 检测到推理过程，已过滤`);
    }

    if (!content) {
      console.error('[综合分析] 模型返回空内容');
      return null;
    }

    // 解析 JSON
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(cleaned);

    if (result && typeof result.score === 'number') {
      return {
        aiProbability: Math.max(0, Math.min(100, result.score)),
        reason: String(result.reason || '').substring(0, 200),
        signals: Array.isArray(result.signals) ? result.signals.map(String) : [],
        suggestions: Array.isArray(result.suggestions) ? result.suggestions.map(String) : []
      };
    }

    return null;
  } catch (error) {
    console.error('[综合分析] 错误:', error);
    return null;
  }
}

// 一次 API 调用检测所有片段，返回 { index: { score, reason, signals, suggestions } }
async function callBatchParagraphModel(
  chunks: ChunkInfo[],
  modelId: string
): Promise<Map<number, { score: number; reason: string; signals: string[]; suggestions: string[] }>> {
  if (!API_KEY || chunks.length === 0) return new Map();

  const fragments = chunks.map(ch => `【片段${ch.index}】\n${ch.text}`).join('\n\n');

  const systemPrompt = `你是AI文本检测专家。直接输出JSON数组，不要推理过程。

【禁止事项】
- 禁止输出推理过程、分析步骤、思考内容
- 禁止输出任何解释性文字
- 禁止使用 ម 或其他标记

【必须格式】
[{"index": N, "score": 0-100, "reason": "一句话", "signals": ["信号1","信号2"], "suggestions": []}]

【关键规则】
1. 立即输出JSON数组，不要任何前置内容
2. index 必须与【片段N】的编号N一致
3. signals 是检测到的特征数组，如："具体人物"、"真实地名"、"AI模板词"、"口语化表达"、"个人经历"等
4. score < 40 时 suggestions 为空数组
5. score >= 40 时给出1-2条修改建议`;

  const userPrompt = `立即输出这 ${chunks.length} 个片段的AI概率评分（JSON数组）：

${fragments}

现在立即输出JSON数组：`;

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    // 不限制 max_tokens，让模型完整输出
    // max_tokens: 不设置，使用 API 默认值或无限制
    temperature: 0.1,
    reasoning_effort: 'low'  // 低推理强度，但某些模型可能不生效
    // 注意：不使用 response_format，因为我们需要数组格式，json_object 要求对象格式
  };

  // 打印请求体大小用于调试
  const promptLength = systemPrompt.length + userPrompt.length;
  console.log(`[段落检测] ${chunks.length} 个片段，prompt 长度 ${promptLength} 字符，max_tokens ${body.max_tokens}`);

  const doFetch = (b: Record<string, unknown>) => fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify(b),
    signal: AbortSignal.timeout(110000)  // 110秒超时
  });

  // 不重试，直接返回错误
  try {
    const response = await doFetch(body);

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errData = await response.json();
        errorDetail = JSON.stringify(errData);
      } catch { /* ignore */ }

      console.error(`[段落检测] API请求失败: ${response.status} ${errorDetail}`);
      throw new Error(`API请求失败: ${response.status} ${errorDetail}`);
    }

    const data = await response.json();
    
    // 智能提取最终结果（过滤推理过程）
    let content = data.choices?.[0]?.message?.content || '';
    
    // 检查是否有 reasoning_content 字段（推理模型的特殊字段）
    const reasoningContent = data.choices?.[0]?.message?.reasoning_content;
    if (reasoningContent) {
      console.log(`[段落检测] 检测到推理过程，长度 ${reasoningContent.length} 字符，已过滤`);
    }

    // 打印完整响应用于调试
    if (!content) {
      console.error(`[段落检测] 模型 ${modelId} 返回空内容，完整响应:`, JSON.stringify(data));
      throw new Error('模型返回空内容');
    }
    
    console.log(`[段落检测] 模型 ${modelId} 返回: ${content}`);
    
    const parsed = parseBatchResponse(content);
    console.log(`[段落检测] 解析结果: ${parsed.size} 个片段`);
    parsed.forEach((val, idx) => {
      console.log(`  片段 ${idx}: score=${val.score}, signals=${JSON.stringify(val.signals)}, suggestions=${JSON.stringify(val.suggestions)}`);
    });
    
    return parsed;
  } catch (error) {
    console.error(`[段落检测] 错误:`, error);
    throw error;
  }
}

// 段落级检测（全文标注，支持多模型并行）
export async function detectParagraphs(
  text: string,
  modelIds: string | string[] = getDefaultModel(),
  options?: {
    preFilteredSentences?: SentenceInfo[];  // 预过滤的句子列表（可选）
  }
): Promise<ParagraphResult[]> {
  // 统一处理为模型数组
  const modelList = Array.isArray(modelIds) ? modelIds : [modelIds];
  
  // 如果提供了预过滤句子，直接使用；否则重新分割
  let sentences: SentenceInfo[];
  
  if (options?.preFilteredSentences && options.preFilteredSentences.length > 0) {
    // 使用主检测已过滤的句子（已排除网页代码）
    sentences = options.preFilteredSentences;
    console.log(`[段落检测] 使用预过滤句子，共 ${sentences.length} 个片段`);
  } else {
    // 原有逻辑：句子分割 + 网页代码过滤
    const allSentences: SentenceInfo[] = [];
    const re = /[^。！？\n]+[。！？\n]?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const s = m[0].trim();
      if (s.length >= 10) {
        allSentences.push({ text: s, start: m.index, end: m.index + m[0].length });
      }
    }
    
    // 过滤网页代码
    sentences = allSentences.filter(s => !isWebCode(s.text));
    console.log(`[段落检测] 原始 ${allSentences.length} 个片段，过滤后 ${sentences.length} 个`);
  }

  if (sentences.length === 0) {
    throw new Error('无法分割文本进行段落检测');
  }

  // 每5句一组，单片段300字上限
  const CHUNK_SIZE = 5;
  const MAX_CHUNK_CHARS = 300;
  const chunks: ChunkInfo[] = [];
  for (let i = 0; i < sentences.length; i += CHUNK_SIZE) {
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

  console.log(`[段落检测] 共 ${chunks.length} 个片段`);

  // 单模型分批并行调用（避免串行叠加超时）
  const modelId = modelList[0];  // 使用第一个模型
  const BATCH_SIZE = 20;  // 每批最多20个片段
  const batches: ChunkInfo[][] = [];

  // 划分批次（余下的片段自动成为最后一批）
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    batches.push(chunks.slice(i, i + BATCH_SIZE));
  }
  console.log(`[段落检测] 使用模型 ${modelId}，共 ${chunks.length} 个片段，分 ${batches.length} 批并行`);

  // 并行请求所有批次
  const batchPromises = batches.map((batch, batchIndex) => {
    const startTime = Date.now();
    console.log(`[段落检测] [${new Date().toISOString()}] 启动批次 ${batchIndex + 1}/${batches.length}，片段 ${batch[0].index}-${batch[batch.length - 1].index}`);
    return callBatchParagraphModel(batch, modelId)
      .then(result => {
        const elapsed = Date.now() - startTime;
        console.log(`[段落检测] [${new Date().toISOString()}] 批次 ${batchIndex + 1} 完成，耗时 ${elapsed}ms`);
        return { batchIndex, result, error: null };
      })
      .catch(error => {
        const elapsed = Date.now() - startTime;
        console.warn(`[段落检测] [${new Date().toISOString()}] 批次 ${batchIndex + 1} 失败 (耗时 ${elapsed}ms):`, error.message);
        return { batchIndex, result: null, error };
      });
  });

  // 等待所有批次完成
  const batchResults = await Promise.all(batchPromises);

  // 合并结果
  const allResults = new Map<number, { score: number; reason: string; signals: string[]; suggestions: string[] }>();
  batchResults.forEach(({ batchIndex, result, error }) => {
    const batch = batches[batchIndex];
    console.log(`[段落检测] 处理批次 ${batchIndex + 1}，成功: ${!!result}，错误: ${error ? error.message : '无'}`);
    if (result) {
      console.log(`[段落检测] 批次 ${batchIndex + 1} 返回 ${result.size} 个结果`);
      
      // 检查模型返回的 index 是否在批次范围内
      const batchIndices = batch.map(ch => ch.index);
      const returnedIndices = Array.from(result.keys());
      const indicesMatch = returnedIndices.every(idx => batchIndices.includes(idx));
      
      if (!indicesMatch && returnedIndices.length === batch.length) {
        // index 不匹配但数量一致，按位置映射
        console.log(`[段落检测] 批次 ${batchIndex + 1} index 不匹配，按位置映射`);
        returnedIndices.forEach((returnedIdx, position) => {
          const actualIdx = batchIndices[position];
          const val = result.get(returnedIdx);
          if (val) {
            console.log(`[段落检测] 映射片段 ${returnedIdx} → ${actualIdx}，score=${val.score}`);
            allResults.set(actualIdx, val);
          }
        });
      } else {
        // index 匹配或无法映射，直接使用
        result.forEach((val, idx) => {
          console.log(`[段落检测] 存储片段 ${idx} 的结果: score=${val.score}`);
          allResults.set(idx, val);
        });
      }
    } else {
      // 批次失败，使用本地评分
      console.log(`[段落检测] 批次 ${batchIndex + 1} 失败，使用本地评分降级，错误:`, error?.message || '未知错误');
      batch.forEach(ch => {
        const { aiProbability } = detectLocal(ch.text);
        allResults.set(ch.index, {
          score: aiProbability,
          reason: `模型检测失败: ${error?.message || '未知错误'}`,
          signals: [],
          suggestions: []
        });
      });
    }
  });
  console.log(`[段落检测] 合并完成，共 ${allResults.size} 个结果`);

  // 组装结果
  return chunks.map(ch => {
    const r = allResults.get(ch.index);

    if (r) {
      console.log(`[段落检测] 片段 ${ch.index} 结果: score=${r.score}, signals=${JSON.stringify(r.signals)}, suggestions=${JSON.stringify(r.suggestions)}`);
      return {
        paragraph: ch.text,
        startIndex: ch.start,
        endIndex: ch.end,
        aiProbability: r.score,
        isAI: r.score > 60,
        reason: r.reason || '模型判断',
        signals: r.signals,
        suggestions: r.suggestions
      };
    } else {
      // 缺失片段降级到本地评分
      const { aiProbability } = detectLocal(ch.text);
      return {
        paragraph: ch.text,
        startIndex: ch.start,
        endIndex: ch.end,
        aiProbability,
        isAI: aiProbability > 60,
        reason: '模型未返回结果，使用本地评分',
        signals: [],
        suggestions: []
      };
    }
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
    enableParagraphDetection?: boolean;
    enableSourceIdentification?: boolean;
    enableSuggestions?: boolean;
    modelId?: string;  // 可选：指定检测模型
  } = {}
): Promise<DetectionResult> {
  const {
    enableParagraphDetection = false,
    enableSourceIdentification = false,
    enableSuggestions = false,
    modelId: customModelId
  } = options;

  const modelId = customModelId || getDefaultModel();
  console.log('[检测] 开始检测, 模型:', modelId);

  try {
    // 0. 过滤网页代码片段（带位置信息）
    const sentencesWithPos: SentenceInfo[] = [];
    const re = /[^。！？\n]+[。！？\n]?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const s = m[0].trim();
      if (s.length >= 10) {
        sentencesWithPos.push({ 
          text: s, 
          start: m.index, 
          end: m.index + m[0].length,
          isWebCode: isWebCode(s) 
        } as SentenceInfo & { isWebCode: boolean });
      }
    }
    
    // 过滤网页代码
    const normalSentences = sentencesWithPos.filter(s => !(s as any).isWebCode);
    const webCodeSentences = sentencesWithPos.filter(s => (s as any).isWebCode);
    
    // 过滤后的文本（移除网页代码）
    const filteredText = normalSentences.map(s => s.text).join('');
    
    if (webCodeSentences.length > 0) {
      console.log(`[检测] 过滤 ${webCodeSentences.length} 个网页代码片段，剩余 ${normalSentences.length} 个正常片段`);
    }
    
    // 如果过滤后文本为空，使用原文（避免完全无法检测）
    const textForDetection = filteredText.length > 50 ? filteredText : text;

    // 1. 本地评分（使用过滤后的文本）
    const stats = analyzeStatistics(textForDetection);
    const topo = analyzeTopology(textForDetection);
    const localScore = Math.round(stats.overallScore * LOCAL_WEIGHTS.stats + topo.overallScore * LOCAL_WEIGHTS.topo);
    const perplexity = 0;

    // 2. 段落级检测（核心检测）
    console.log('[检测] 调用段落检测...');
    
    const paragraphResults = enableParagraphDetection && normalSentences.length > 0
      ? await detectParagraphs(text, [modelId], {
          preFilteredSentences: normalSentences as SentenceInfo[]
        }).catch(error => {
          console.error('[检测] 段落级检测失败:', error);
          return undefined;
        })
      : undefined;

    // 3. 基于段落检测结果，调用模型进行综合分析
    let modelScore: number;
    let modelReason: string;
    let modelSignals: string[];
    let modelSuggestions: string[];

    if (paragraphResults && paragraphResults.length > 0) {
      // 调用模型综合分析段落检测结果和原文
      console.log('[检测] 调用模型综合分析段落检测结果...');
      
      const overallResult = await callModelOverallAnalysis(textForDetection, paragraphResults, modelId).catch(error => {
        console.error('[检测] 综合分析失败:', error);
        return null;
      });
      
      if (overallResult) {
        modelScore = overallResult.aiProbability;
        modelReason = overallResult.reason;
        modelSignals = overallResult.signals || [];
        modelSuggestions = overallResult.suggestions || [];
        console.log(`[检测] 综合分析完成，模型评分 ${modelScore}`);
      } else {
        // 综合分析失败，使用段落平均分
        const scores = paragraphResults
          .filter(r => !r.skipped)
          .map(r => r.aiProbability);
        
        modelScore = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 50;
        
        const reasons = paragraphResults
          .filter(r => r.reason && !r.skipped)
          .map(r => r.reason)
          .slice(0, 3);
        
        modelReason = reasons.length > 0
          ? reasons.join('；')
          : '基于段落分析';
        
        const allSignals = new Set<string>();
        paragraphResults.forEach(r => {
          if (r.signals && !r.skipped) {
            r.signals.forEach(s => allSignals.add(s));
          }
        });
        modelSignals = Array.from(allSignals).slice(0, 5);
        
        const allSuggestions = new Set<string>();
        paragraphResults.forEach(r => {
          if (r.suggestions && !r.skipped) {
            r.suggestions.forEach(s => allSuggestions.add(s));
          }
        });
        modelSuggestions = Array.from(allSuggestions).slice(0, 3);
        
        console.log(`[检测] 综合分析失败，使用段落平均分 ${modelScore}`);
      }
    } else {
      // 段落检测失败，使用本地评分
      modelScore = localScore;
      modelReason = '段落检测失败，使用本地评分';
      modelSignals = [];
      modelSuggestions = [];
    }

    // 4. 构造 modelResults
    const modelConfig = getModelConfig(modelId);
    const modelResults: ModelResult[] = [{
      modelId,
      modelName: modelConfig?.name || modelId,
      aiProbability: modelScore,
      perplexity: 0,
      reason: modelReason,
      signals: modelSignals
    }];

    // 5. 一致性纠偏综合评分
    const aiProbability = reconcileScore(modelScore, localScore, stats);

    // 置信度判断
    let confidence: 'high' | 'medium' | 'low';
    if (aiProbability > 80 || aiProbability < 20) {
      confidence = 'high';
    } else if (aiProbability > 60 || aiProbability < 40) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }
    console.log(`[检测] 本地评分 ${localScore} + 模型评分 ${modelScore} = 综合评分 ${aiProbability}% (${modelReason})`);

    // 6. 置信区间
    const confidenceInterval = calculateConfidenceInterval(aiProbability, 1);

    // 7. 生成分析说明
    const analysis = generateAnalysis(aiProbability, perplexity, stats, modelResults, topo, modelScore);

    // 8. AI来源识别（可选，使用过滤后的文本）
    let sourceIdentification;
    if (enableSourceIdentification) {
      sourceIdentification = identifyAISource(textForDetection);
    }

    // 9. 修改建议（可选，从段落检测结果中综合）
    let suggestions: string[] | undefined;
    if (enableSuggestions && modelSuggestions.length > 0) {
      suggestions = modelSuggestions;
    }

    console.log(`[检测] 完成, AI概率: ${aiProbability}%`);

    return {
      aiProbability,
      perplexity,
      modelScore,
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
      lines.push(`- ${r.modelName}: ${r.aiProbability}% AI概率`);
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
