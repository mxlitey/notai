import { calculatePerplexity, perplexityToAIScore } from './perplexity';
import { analyzeStatistics } from './statistics';

const API_BASE_URL = process.env.API_BASE_URL || 'https://api.guyu.run';
const API_KEY = process.env.API_KEY || '';
const DETECT_MODEL = process.env.DECTECT_MODEL || 'deepseek-v4-flash';

interface LogprobsContent {
  token: string;
  logprob: number;
}

// 调用API获取logprobs
async function getLogprobs(text: string): Promise<number[]> {
  const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: DETECT_MODEL,
      messages: [{ role: 'user', content: text }],
      logprobs: true
    })
  });

  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status}`);
  }

  const data = await response.json();

  // 提取logprobs
  const logprobsContent: LogprobsContent[] = data.choices?.[0]?.logprobs?.content || [];

  // 只提取内容部分的logprob（排除reasoning_content）
  const logprobs = logprobsContent.map(item => item.logprob);

  return logprobs;
}

// 主检测函数
export async function detectAIContent(text: string) {
  try {
    // 1. 计算困惑度
    const logprobs = await getLogprobs(text);
    const perplexity = calculatePerplexity(logprobs);
    const perplexityScore = perplexityToAIScore(perplexity);

    // 2. 统计特征分析
    const stats = analyzeStatistics(text);

    // 3. 综合评分（困惑度70% + 统计特征30%）
    const aiProbability = Math.round(perplexityScore * 0.7 + stats.overallScore * 0.3);

    // 4. 确定置信度
    let confidence: 'high' | 'medium' | 'low';
    if (aiProbability > 80 || aiProbability < 20) {
      confidence = 'high';
    } else if (aiProbability > 60 || aiProbability < 40) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    // 5. 生成分析说明
    const analysis = generateAnalysis(aiProbability, perplexity, stats);

    return {
      aiProbability,
      perplexity: Math.round(perplexity * 100) / 100,
      confidence,
      statistics: {
        sentenceLengthVariance: stats.sentenceLengthVariance,
        lexicalDiversity: stats.lexicalDiversity,
        punctuationScore: stats.punctuationScore
      },
      analysis
    };
  } catch (error) {
    console.error('检测失败:', error);
    throw error;
  }
}

// 生成分析说明
function generateAnalysis(
  aiProbability: number,
  perplexity: number,
  stats: { sentenceLengthVariance: number; lexicalDiversity: number; punctuationScore: number }
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

  lines.push(`\n**困惑度分析**：${perplexity.toFixed(2)}`);
  if (perplexity < 30) {
    lines.push('困惑度较低，文本生成模式化，符合AI生成特征。');
  } else if (perplexity < 50) {
    lines.push('困惑度中等，文本有一定变化，检测结果不确定。');
  } else {
    lines.push('困惑度较高，文本富有变化，符合人类写作特征。');
  }

  lines.push(`\n**统计特征分析**：`);
  lines.push(`- 句长方差评分：${stats.sentenceLengthVariance}/100 (${stats.sentenceLengthVariance > 50 ? '变化大，偏人类' : '变化小，偏AI'})`);
  lines.push(`- 词汇多样性：${stats.lexicalDiversity}/100 (${stats.lexicalDiversity > 50 ? '丰富，偏人类' : '单一，偏AI'})`);
  lines.push(`- 标点分布：${stats.punctuationScore}/100 (${stats.punctuationScore > 50 ? '有创意，偏人类' : '规范，偏AI'})`);

  return lines.join('\n');
}
