// 计算困惑度
export function calculatePerplexity(logprobs: number[]): number {
  if (logprobs.length === 0) return 0;

  const avgNegativeLogProb = logprobs.reduce((sum, lp) => sum + lp, 0) / logprobs.length;
  const perplexity = Math.exp(-avgNegativeLogProb);

  return perplexity;
}

// 根据困惑度判断AI概率
// 注意：chat completions API返回的logprobs是模型回复的概率，不是输入文本的概率
// 因此困惑度只能作为辅助参考，不能作为主要判断依据
export function perplexityToAIScore(perplexity: number): number {
  if (perplexity === 0) return 50; // 无数据时返回中性值

  // 降低困惑度的权重和置信度
  // 返回40-60之间的值，作为辅助参考
  if (perplexity < 10) return 58;
  if (perplexity < 20) return 55;
  if (perplexity < 30) return 52;
  if (perplexity < 50) return 50;
  if (perplexity < 80) return 48;
  if (perplexity < 120) return 45;
  return 42;
}