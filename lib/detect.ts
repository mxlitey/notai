import { calculatePerplexity, perplexityToAIScore } from './perplexity';
import { analyzeStatistics } from './statistics';
import { AVAILABLE_MODELS, getModelConfig } from './models';
import type { DetectionResult, ParagraphResult, ModelResult } from '@/types';

const API_BASE_URL = process.env.API_BASE_URL || 'https://api.guyu.run';
const API_KEY = process.env.API_KEY || '';

interface LogprobsContent {
  token: string;
  logprob: number;
}

// 调用API获取logprobs或使用模型判断
async function callModel(text: string, modelId: string): Promise<{ perplexity: number; aiProbability: number }> {
  const model = getModelConfig(modelId);
  if (!model) {
    throw new Error(`未知模型: ${modelId}`);
  }

  // 检查API密钥
  if (!API_KEY) {
    throw new Error('API_KEY 未配置');
  }

  console.log(`[检测] 使用模型: ${modelId}, 支持logprobs: ${model.supportsLogprobs}`);

  try {
    const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: text }],
        logprobs: model.supportsLogprobs,
        max_tokens: 10  // 限制token数量，因为我们只需要概率或简单回复
      }),
      signal: AbortSignal.timeout(60000) // 60秒超时
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[检测] API请求失败: ${response.status}`, errorText);
      throw new Error(`API请求失败: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[检测] API响应:`, JSON.stringify(data).substring(0, 500));

    // 检查logprobs - 支持两种字段格式
    // 1. content（标准格式，如 glm-5.2）
    // 2. reasoning_content（非标准格式，如 deepseek-v4-flash）
    const logprobsData = data.choices?.[0]?.logprobs;
    const logprobsContent = logprobsData?.content || logprobsData?.reasoning_content;

    if (model.supportsLogprobs && logprobsContent) {
      // 支持logprobs的模型
      const logprobsValues = logprobsContent.map((item: LogprobsContent) => item.logprob);
      const perplexity = calculatePerplexity(logprobsValues);
      const aiProbability = perplexityToAIScore(perplexity);
      console.log(`[检测] 困惑度: ${perplexity}, AI概率: ${aiProbability}%`);
      return { perplexity, aiProbability };
    } else {
      // 不支持logprobs的模型，使用统计特征分析
      console.log(`[检测] 模型不支持logprobs或无返回数据，使用统计特征分析`);
      const stats = analyzeStatistics(text);
      const aiProbability = stats.overallScore;
      return { perplexity: 0, aiProbability };
    }
  } catch (error) {
    console.error(`[检测] 调用模型 ${modelId} 失败:`, error);
    throw error;
  }
}

// 生成针对片段的修改建议
function generateParagraphSuggestions(text: string, aiProbability: number): { suggestions: string[]; modifiedText?: string } {
  const suggestions: string[] = [];
  
  if (aiProbability < 40) {
    return { suggestions: ['该片段风格自然，无需修改。'] };
  }

  // 检测句式问题
  const sentences = text.split(/[。！？.!?]/).filter(s => s.trim());
  const sentenceLengths = sentences.map(s => s.length);
  const avgLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
  const variance = sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / sentenceLengths.length;

  // 检测AI常用词
  const aiWords = ['首先', '其次', '此外', '总之', '综上所述', '由此可见', '因此', '所以', '值得注意的是'];
  const foundAiWords = aiWords.filter(word => text.includes(word));

  // 检测重复词汇
  const words = text.match(/[\u4e00-\u9fa5]+/g) || [];
  const wordCount: Record<string, number> = {};
  words.forEach(w => {
    if (w.length > 1) {
      wordCount[w] = (wordCount[w] || 0) + 1;
    }
  });
  const repeatedWords = Object.entries(wordCount).filter(([_, count]) => count > 2).map(([word]) => word);

  // 生成建议
  if (variance < 20) {
    suggestions.push('• 句子长度过于均匀，建议增加长短句变化');
  }

  if (foundAiWords.length > 0) {
    suggestions.push(`• 减少使用AI常用词：${foundAiWords.join('、')}`);
  }

  if (repeatedWords.length > 0) {
    suggestions.push(`• 避免重复词汇：${repeatedWords.slice(0, 3).join('、')}`);
  }

  if (avgLength > 30) {
    suggestions.push('• 适当拆分长句，增加节奏感');
  }

  suggestions.push('• 加入个人观点或具体例子');
  suggestions.push('• 使用更口语化的表达');

  // 生成修改后的示例（简单处理）
  let modifiedText = text;
  
  // 替换AI常用词
  const replacements: Record<string, string> = {
    '首先': '一开始',
    '其次': '然后',
    '此外': '另外',
    '总之': '总的来说',
    '综上所述': '综合来看',
    '由此可见': '可以看出',
    '因此': '所以',
    '所以': '于是',
    '值得注意的是': '需要指出的是'
  };

  for (const [word, replacement] of Object.entries(replacements)) {
    modifiedText = modifiedText.replace(new RegExp(word, 'g'), replacement);
  }

  // 添加一些口语化标记
  if (aiProbability > 70 && sentences.length > 1) {
    const randomIndex = Math.floor(Math.random() * sentences.length);
    modifiedText = modifiedText.replace(sentences[randomIndex], `说实话，${sentences[randomIndex]}`);
  }

  return { suggestions, modifiedText: modifiedText !== text ? modifiedText : undefined };
}

// 段落级检测（全文标注）
export async function detectParagraphs(text: string, modelId: string = 'deepseek-v4-flash'): Promise<ParagraphResult[]> {
  // 按多种方式分割：句子结束符、换行
  const sentences = text
    .replace(/([。！？.!?])/g, '$1|||')
    .split('|||')
    .map(s => s.trim())
    .filter(s => s.length >= 10);
  
  if (sentences.length === 0) {
    // 如果无法分割，直接返回整体
    const { aiProbability } = await callModel(text, modelId);
    const { suggestions, modifiedText } = generateParagraphSuggestions(text, aiProbability);
    return [{
      paragraph: text,
      startIndex: 0,
      endIndex: text.length,
      aiProbability,
      isAI: aiProbability > 60,
      suggestions,
      modifiedText
    }];
  }

  // 每5个句子作为一个检测单元
  const chunkSize = 5;
  const chunks: { text: string }[] = [];
  
  for (let i = 0; i < sentences.length; i += chunkSize) {
    const chunkSentences = sentences.slice(i, i + chunkSize);
    if (chunkSentences.length > 0) {
      chunks.push({
        text: chunkSentences.join('')
      });
    }
  }

  // 限制最多10个片段，避免超时
  const limitedChunks = chunks.slice(0, 10);

  // 并行调用API加速
  const results: ParagraphResult[] = [];
  const promises = limitedChunks.map(async (chunk) => {
    if (chunk.text.trim().length < 20) return null;
    
    try {
      const { aiProbability } = await callModel(chunk.text, modelId);
      const { suggestions, modifiedText } = generateParagraphSuggestions(chunk.text, aiProbability);
      return {
        paragraph: chunk.text,
        startIndex: 0,
        endIndex: 0,
        aiProbability,
        isAI: aiProbability > 60,
        suggestions,
        modifiedText
      };
    } catch {
      const { suggestions, modifiedText } = generateParagraphSuggestions(chunk.text, 50);
      return {
        paragraph: chunk.text,
        startIndex: 0,
        endIndex: 0,
        aiProbability: 50,
        isAI: false,
        suggestions,
        modifiedText
      };
    }
  });

  const resolvedResults = await Promise.all(promises);
  
  // 过滤掉null结果并返回
  const filteredResults: ParagraphResult[] = [];
  for (const r of resolvedResults) {
    if (r !== null) {
      filteredResults.push(r);
    }
  }
  return filteredResults;
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

// 生成修改建议
export function generateSuggestions(statistics: { sentenceLengthVariance: number; lexicalDiversity: number; punctuationScore: number }, aiProbability: number): string[] {
  const suggestions: string[] = [];

  if (aiProbability < 50) {
    suggestions.push('文本已具有人类写作特征，无需大幅修改。');
    return suggestions;
  }

  if (statistics.sentenceLengthVariance > 60) {
    suggestions.push('✓ 句子长度变化自然，继续保持。');
  } else {
    suggestions.push('• 增加句子长度变化，混合使用长短句，避免过于均匀。');
    suggestions.push('• 适当加入一些短促有力的句子，增强节奏感。');
  }

  if (statistics.lexicalDiversity > 50) {
    suggestions.push('✓ 词汇使用较为丰富。');
  } else {
    suggestions.push('• 减少重复用词，尝试使用同义词替换。');
    suggestions.push('• 加入一些口语化表达或个性化词汇。');
    suggestions.push('• 避免过度使用"首先、其次、此外"等连接词。');
  }

  if (statistics.punctuationScore < 40) {
    suggestions.push('• 适当使用感叹号、问号等表达情感。');
    suggestions.push('• 可以加入一些引号强调重点内容。');
  }

  suggestions.push('• 加入个人观点、经历或例子，增加主观性。');
  suggestions.push('• 使用一些非正式表达，如口语、俚语等。');
  suggestions.push('• 避免过于完美的逻辑结构，适当加入一些"不完美"。');

  return suggestions;
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
    // 1. 多模型检测
    const modelResults: ModelResult[] = [];
    let totalPerplexity = 0;
    let totalAiProbability = 0;
    let validModels = 0;

    for (const modelId of models) {
      try {
        console.log(`[检测] 调用模型: ${modelId}`);
        const result = await callModel(text, modelId);
        const modelConfig = getModelConfig(modelId);

        modelResults.push({
          modelId,
          modelName: modelConfig?.name || modelId,
          aiProbability: result.aiProbability,
          perplexity: result.perplexity
        });

        totalPerplexity += result.perplexity;
        totalAiProbability += result.aiProbability;
        validModels++;
        console.log(`[检测] 模型 ${modelId} 完成, AI概率: ${result.aiProbability}%`);
      } catch (error) {
        console.error(`[检测] 模型 ${modelId} 检测失败:`, error);
        // 如果模型调用失败，使用统计特征作为备选
        const stats = analyzeStatistics(text);
        const modelConfig = getModelConfig(modelId);
        modelResults.push({
          modelId,
          modelName: modelConfig?.name || modelId,
          aiProbability: stats.overallScore,
          perplexity: 0
        });
        totalAiProbability += stats.overallScore;
        validModels++;
      }
    }

    // 如果没有模型成功，使用统计特征
    if (validModels === 0) {
      console.log('[检测] 所有模型都失败，使用统计特征');
      const stats = analyzeStatistics(text);
      totalAiProbability = stats.overallScore;
      validModels = 1;
    }

    const perplexity = totalPerplexity / validModels;
    const modelAiProbability = totalAiProbability / validModels;

    // 2. 统计特征分析
    const stats = analyzeStatistics(text);

    // 3. 综合评分
    const aiProbability = Math.round(modelAiProbability * 0.7 + stats.overallScore * 0.3);

    // 4. 置信度
    let confidence: 'high' | 'medium' | 'low';
    if (aiProbability > 80 || aiProbability < 20) {
      confidence = 'high';
    } else if (aiProbability > 60 || aiProbability < 40) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    // 5. 置信区间
    const confidenceInterval = calculateConfidenceInterval(aiProbability, validModels);

    // 6. 生成分析说明
    const analysis = generateAnalysis(aiProbability, perplexity, stats, modelResults);

    // 7. 段落级检测（可选）
    let paragraphResults: ParagraphResult[] | undefined;
    if (enableParagraphDetection && text.length > 200) {
      try {
        paragraphResults = await detectParagraphs(text, models[0] || 'deepseek-v4-flash');
      } catch (error) {
        console.error('[检测] 段落级检测失败:', error);
      }
    }

    // 8. AI来源识别（可选）
    let sourceIdentification;
    if (enableSourceIdentification) {
      sourceIdentification = identifyAISource(text);
    }

    // 9. 修改建议（可选）
    let suggestions: string[] | undefined;
    if (enableSuggestions) {
      suggestions = generateSuggestions(stats, aiProbability);
    }

    console.log(`[检测] 完成, AI概率: ${aiProbability}%`);

    return {
      aiProbability,
      perplexity: Math.round(perplexity * 100) / 100,
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
  modelResults: ModelResult[]
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

  lines.push(`\n**困惑度分析**：${perplexity.toFixed(2)}`);
  if (perplexity < 30) {
    lines.push('困惑度较低，文本生成模式化，符合AI生成特征。');
  } else if (perplexity < 50) {
    lines.push('困惑度中等，文本有一定变化，检测结果不确定。');
  } else {
    lines.push('困惑度较高，文本富有变化，符合人类写作特征。');
  }

  lines.push(`\n**统计特征分析**：`);
  lines.push(`- 句长方差评分：${stats.sentenceLengthVariance}/100`);
  lines.push(`- 词汇多样性：${stats.lexicalDiversity}/100`);
  lines.push(`- 标点分布：${stats.punctuationScore}/100`);

  return lines.join('\n');
}
