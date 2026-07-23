// 中文分词（简单实现，基于标点和空格分割）
function tokenize(text: string): string[] {
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
// 返回AI概率（0-100），只作为辅助参考
export function analyzeSentenceLength(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return 50;

  const lengths = sentences.map(s => s.length);
  const varLength = variance(lengths);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

  // AI特征：句子长度极其均匀（方差很小）且句子较长
  // 人类特征：句子长度变化大，有短句有长句
  
  let score = 50; // 基准值

  // 方差极度均匀（方差<平均长度的5%）才开始怀疑AI
  if (varLength < avgLength * 0.05 && avgLength > 25) {
    score = 62;
  } else if (varLength < avgLength * 0.1 && avgLength > 25) {
    score = 55;
  } else if (varLength > avgLength * 0.5) {
    // 方差很大，更可能是人类
    score = 38;
  } else {
    score = 48;
  }

  // 如果有非常短的句子（<5字），更可能是人类
  if (lengths.some(l => l <= 5 && lengths.length > 3)) {
    score -= 5;
  }

  return Math.max(20, Math.min(80, score));
}

// 词汇多样性（TTR - Type-Token Ratio）
export function analyzeLexicalDiversity(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 50;

  const uniqueTokens = new Set(tokens);
  const ttr = uniqueTokens.size / tokens.length;

  // TTR与文本长度有关，长文本TTR自然偏低
  // 不能简单用TTR判断AI
  
  let score = 50;

  // 极低TTR（大量重复）可能是AI特征
  if (ttr < 0.2 && tokens.length > 100) {
    score = 58;
  } else if (ttr < 0.3) {
    score = 52;
  } else if (ttr > 0.7) {
    // 词汇非常丰富，更可能是人类
    score = 38;
  } else {
    score = 48;
  }

  return Math.max(20, Math.min(80, score));
}

// 标点符号分析
export function analyzePunctuation(text: string): number {
  const totalLength = text.length;
  if (totalLength === 0) return 50;

  const commas = (text.match(/，/g) || []).length;
  const periods = (text.match(/。/g) || []).length;
  const exclamations = (text.match(/[！？]/g) || []).length;
  const quotes = (text.match(/[""]/g) || []).length;
  const ellipsis = (text.match(/[…\.\.\.]/g) || []).length;

  // AI文本标点使用规范，几乎不用感叹号、省略号
  // 但正式文体的人类文章也不用感叹号，所以这个指标权重很低
  
  let score = 50;

  // 有感叹号或省略号，更可能是人类（情感表达）
  if (exclamations > 0 || ellipsis > 0) {
    score = 38;
  }

  // 完全没有句号但文本很长，可能有问题
  if (periods === 0 && totalLength > 200) {
    score = 55;
  }

  return Math.max(20, Math.min(80, score));
}

// AI常用词检测
export function analyzeAIKeywords(text: string): number {
  const aiKeywords = [
    '首先', '其次', '此外', '另外', '总之', '综上所述', 
    '由此可见', '值得注意的是', '需要指出的是', '值得一提',
    '总的来说', '简而言之', '换句话说', '从某种意义上说',
    '在此基础上', '与此同时', '不仅...而且', '既...又'
  ];

  let count = 0;
  for (const keyword of aiKeywords) {
    const matches = text.match(new RegExp(keyword, 'g'));
    if (matches) count += matches.length;
  }

  // 句子数量
  const sentenceCount = splitSentences(text).length;
  if (sentenceCount === 0) return 50;

  // AI常用词密度
  const density = count / sentenceCount;

  let score = 50;
  if (density > 0.5) {
    score = 65;  // 每两句就有一个AI常用词
  } else if (density > 0.3) {
    score = 58;
  } else if (density > 0.15) {
    score = 53;
  } else if (density < 0.05) {
    score = 40;
  } else {
    score = 48;
  }

  return Math.max(20, Math.min(80, score));
}

// 综合统计特征分析
export function analyzeStatistics(text: string) {
  const sentenceScore = analyzeSentenceLength(text);
  const lexicalScore = analyzeLexicalDiversity(text);
  const punctuationScore = analyzePunctuation(text);
  const keywordScore = analyzeAIKeywords(text);

  // 加权平均
  // 降低各指标权重，避免误判
  const overallScore = Math.round(
    sentenceScore * 0.25 + 
    lexicalScore * 0.2 + 
    punctuationScore * 0.15 + 
    keywordScore * 0.4
  );

  return {
    sentenceLengthVariance: sentenceScore,
    lexicalDiversity: lexicalScore,
    punctuationScore: punctuationScore,
    overallScore: Math.max(10, Math.min(90, overallScore))
  };
}