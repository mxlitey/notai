// 中文分词（简单实现，基于标点和空格分割）
function tokenize(text: string): string[] {
  // 使用正则分割中文句子
  const tokens = text.split(/[\s，。！？、；：""''【】（）《》\n]+/);
  return tokens.filter(t => t.length > 0);
}

// 分割句子
function splitSentences(text: string): string[] {
  const sentences = text.split(/[。！？\n]+/);
  return sentences.filter(s => s.trim().length > 0);
}

// 计算方差
function variance(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  return numbers.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / numbers.length;
}

// 句长方差分析
export function analyzeSentenceLength(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return 0;

  const lengths = sentences.map(s => s.length);

  // AI文本句子长度通常更均匀，方差小
  // 人类文本句子长度变化大，方差大
  const varLength = variance(lengths);

  // 归一化到0-100分（方差越小，AI概率越高）
  if (varLength < 10) return 90;
  if (varLength < 30) return 70;
  if (varLength < 50) return 50;
  if (varLength < 100) return 30;
  return 10;
}

// 词汇多样性（TTR - Type-Token Ratio）
export function analyzeLexicalDiversity(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;

  const uniqueTokens = new Set(tokens);
  const ttr = uniqueTokens.size / tokens.length;

  // AI文本词汇多样性通常较低
  // 人类文本词汇更丰富
  if (ttr < 0.3) return 85;
  if (ttr < 0.4) return 70;
  if (ttr < 0.5) return 50;
  if (ttr < 0.6) return 30;
  return 15;
}

// 标点符号分析
export function analyzePunctuation(text: string): number {
  const totalLength = text.length;
  if (totalLength === 0) return 0;

  // 统计各类标点
  const commas = (text.match(/，/g) || []).length;
  const periods = (text.match(/。/g) || []).length;
  const exclamations = (text.match(/[！？]/g) || []).length;
  const quotes = (text.match(/[""]/g) || []).length;

  // AI文本标点使用更规范，感叹号/引号较少
  const formalScore = commas + periods;
  const creativeScore = exclamations + quotes;

  const ratio = creativeScore / (formalScore + 1);

  // 比例越低，AI概率越高
  if (ratio < 0.05) return 80;
  if (ratio < 0.1) return 60;
  if (ratio < 0.15) return 40;
  if (ratio < 0.2) return 20;
  return 10;
}

// 综合统计特征分析
export function analyzeStatistics(text: string) {
  const sentenceScore = analyzeSentenceLength(text);
  const lexicalScore = analyzeLexicalDiversity(text);
  const punctuationScore = analyzePunctuation(text);

  // 加权平均（权重可调整）
  const overallScore = sentenceScore * 0.4 + lexicalScore * 0.35 + punctuationScore * 0.25;

  return {
    sentenceLengthVariance: sentenceScore,
    lexicalDiversity: lexicalScore,
    punctuationScore: punctuationScore,
    overallScore: Math.round(overallScore)
  };
}
