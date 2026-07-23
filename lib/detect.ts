import { analyzeStatistics } from './statistics';
import { getModelConfig } from './models';
import type { DetectionResult, ParagraphResult, ModelResult } from '@/types';

// 纯统计特征检测，不依赖模型API
// 检测指定文本的AI概率
function detectText(text: string): { perplexity: number; aiProbability: number } {
  const stats = analyzeStatistics(text);
  return {
    perplexity: 0,
    aiProbability: stats.overallScore
  };
}

// 生成针对片段的修改建议
function generateParagraphSuggestions(text: string, aiProbability: number): { suggestions: string[]; modifiedText?: string } {
  const suggestions: string[] = [];
  
  if (aiProbability < 50) {
    return { suggestions: ['该片段风格自然，无明显AI特征。'] };
  }

  // 检测句式问题
  const sentences = text.split(/[。！？.!?]/).filter(s => s.trim());
  const sentenceLengths = sentences.map(s => s.length);
  const avgLength = sentenceLengths.reduce((a, b) => a + b, 0) / (sentenceLengths.length || 1);
  const varLen = sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / (sentenceLengths.length || 1);

  // 检测AI常用词
  const aiWords = ['首先', '其次', '此外', '总之', '综上所述', '由此可见', '因此', '值得注意的是', '需要指出的是'];
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

  // 生成针对性建议
  if (aiProbability > 70) {
    suggestions.push('该片段有较明显的AI特征，建议重写。');
  } else {
    suggestions.push('该片段有一些AI特征，建议优化。');
  }
  suggestions.push('');

  if (varLen < avgLength * 0.1 && avgLength > 20) {
    suggestions.push('【句式】句子长度过于均匀');
    suggestions.push('  - 穿插短句，如"真的。""确实如此。"');
  }

  if (foundAiWords.length > 0) {
    suggestions.push(`【用词】检测到AI常用词：${foundAiWords.join('、')}`);
    suggestions.push('  - 用自己的话重新表达这些连接关系');
  }

  if (repeatedWords.length > 0) {
    suggestions.push(`【词汇】重复用词：${repeatedWords.slice(0, 3).join('、')}`);
    suggestions.push('  - 尝试同义词替换或省略');
  }

  suggestions.push('【内容】加入个人观点或具体例子');

  // 不再生成机械的修改示例
  return { suggestions };
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
    const { aiProbability } = detectText(text);
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
      const { aiProbability } = detectText(chunk.text);
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
    suggestions.push('文章整体风格自然，未检测到明显的AI生成特征。');
    suggestions.push('继续保持个人写作风格，文章质量良好。');
    return suggestions;
  }

  if (aiProbability > 80) {
    suggestions.push('文章有多项AI写作特征，建议大幅重写。');
  } else if (aiProbability > 60) {
    suggestions.push('文章存在一些AI写作特征，建议重点修改以下方面：');
  } else {
    suggestions.push('文章存在少量AI写作特征，可参考以下建议优化：');
  }

  suggestions.push('');

  // 句式建议
  if (statistics.sentenceLengthVariance > 55) {
    suggestions.push('【句式】句子长度过于规整，建议：');
    suggestions.push('  - 穿插一些短句（5-10字），打破均匀节奏');
    suggestions.push('  - 尝试倒装、反问等句式变化');
    suggestions.push('  - 可以用"对。""嗯。""真的。"这类极短句');
  }

  // 词汇建议
  if (statistics.lexicalDiversity < 45) {
    suggestions.push('【词汇】词汇重复较多，建议：');
    suggestions.push('  - 用具体的描述替代抽象的表达（如"好"→"让人眼前一亮"）');
    suggestions.push('  - 加入一些口语词，如"反正""倒是""怎么说呢"');
    suggestions.push('  - 适当使用比喻、拟人等修辞手法');
  }

  // 标点建议
  if (statistics.punctuationScore > 55) {
    suggestions.push('【标点】标点使用过于规范，建议：');
    suggestions.push('  - 可以用省略号（...）表示停顿或留白');
    suggestions.push('  - 用破折号（——）做补充说明，更口语化');
    suggestions.push('  - 不必每句都用句号，可以用逗号连接短句');
  }

  // 通用建议
  suggestions.push('【内容】增加个人痕迹：');
  suggestions.push('  - 加入自己的经历、感受或观点');
  suggestions.push('  - 用"我觉得""说实话""讲真"等主观表达');
  suggestions.push('  - 可以适当跑题、插入个人联想');

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
        const result = detectText(text);
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
    // 困惑度（模型回复概率）不可靠，降低权重到20%
    // 统计特征更可靠，权重80%
    const aiProbability = Math.round(modelAiProbability * 0.2 + stats.overallScore * 0.8);

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
