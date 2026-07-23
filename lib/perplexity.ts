// 计算困惑度
export function calculatePerplexity(logprobs: number[]): number {
  if (logprobs.length === 0) return 0;

  // 计算平均负对数概率
  const avgNegativeLogProb = logprobs.reduce((sum, lp) => sum + lp, 0) / logprobs.length;

  // 困惑度 = exp(avg(-logprob))
  // 注意：logprobs已经是负数，所以直接取平均
  const perplexity = Math.exp(-avgNegativeLogProb);

  return perplexity;
}

// 根据困惑度判断AI概率
export function perplexityToAIScore(perplexity: number): number {
  // 经验值：
  // AI文本困惑度通常 < 30
  // 人类文本困惑度通常 > 50

  if (perplexity < 20) return 95;
  if (perplexity < 30) return 85;
  if (perplexity < 40) return 70;
  if (perplexity < 50) return 50;
  if (perplexity < 60) return 30;
  if (perplexity < 80) return 15;
  return 5;
}
