// 拓扑特征结构分析
// 检测文本的逻辑结构、信息密度分布、论证深度变化

import { AI_TEMPLATE_WORDS } from './ai-words';

// 分割句子
function splitSentences(text: string): string[] {
  const sentences = text.split(/[。！？\n]+/).filter(s => s.trim().length > 0);
  return sentences;
}

// 分割段落
function splitParagraphs(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  return paragraphs.length > 0 ? paragraphs : [text];
}

// 计算方差
function variance(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  return numbers.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / numbers.length;
}

// 提取中文词语（简单实现）
function tokenize(text: string): string[] {
  return text.split(/[\s，。！？、；：""''【】（）《》\n]+/).filter(t => t.length > 0);
}

// 名词密度估算（中文名词通常2-4字，包含常见后缀）
function estimateNounCount(text: string): number {
  const nounSuffixes = /的|了|是|在|有|和|与|或|上|下|中|里|外|前|后|还|又|也|都|就|才|便|被|把|让|使|令|向|往|从|到|为|以|对|于|按|据|因|由|凭|靠|仗/g;
  const cleaned = text.replace(nounSuffixes, ' ');
  const words = cleaned.split(/[\s，。！？、；：""''【】（）《》\n]+/).filter(w => w.length >= 2);
  return words.length;
}

// 观点密度分析
// AI文本：观点密度均匀分布
// 人类文本：观点密度有起伏（有重点段、有铺垫段）
export function analyzeInformationDensity(text: string): number {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length < 2) return 50;

  // 计算每段的名词密度（信息量指标）
  const densities = paragraphs.map(p => {
    const nouns = estimateNounCount(p);
    const length = p.replace(/\s/g, '').length;
    return length > 0 ? nouns / length : 0;
  });

  const densityVariance = variance(densities);
  const avgDensity = densities.reduce((a, b) => a + b, 0) / densities.length;

  let score = 50;

  // AI特征：密度方差极小（分布均匀）
  // 只在极端均匀时才提示，避免误判优秀人类写作
  if (densityVariance < avgDensity * 0.02 && paragraphs.length > 4) {
    score = 65;  // 方差极小，信息分布过于均匀
  } else if (densityVariance < avgDensity * 0.05) {
    score = 52;
  } else if (densityVariance > avgDensity * 0.5) {
    score = 38;  // 方差大，信息分布有起伏，更像人类
  } else {
    score = 48;
  }

  return Math.max(20, Math.min(80, score));
}

// 逻辑连接强度分析
// AI文本：段落间 AI 模板连接词密度高，线性推进
// 人类文本：连接松散，有跳跃
// 注意：自然连接词（所以/因此/但是等）不计入 AI 特征，正式人类文章常用
export function analyzeLogicalConnection(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length < 3) return 50;

  // 只统计 AI 模板词（强信号），自然连接词不计入
  let connectorCount = 0;
  for (const conn of AI_TEMPLATE_WORDS) {
    const matches = text.match(new RegExp(conn, 'g'));
    if (matches) connectorCount += matches.length;
  }

  // 句子间 AI 模板词密度
  const density = connectorCount / sentences.length;

  let score = 50;
  if (density > 0.4) {
    score = 68;  // 每 2-3 句一个 AI 模板词，AI 特征明显
  } else if (density > 0.2) {
    score = 58;
  } else if (density < 0.05) {
    score = 38;  // 模板词稀疏，更像人类
  } else {
    score = 48;
  }

  return Math.max(20, Math.min(80, score));
}

// 论证深度变化分析
// AI文本：论证深度一致（每段都展开详细）
// 人类文本：深浅不一（有些深入，有些一笔带过）
export function analyzeArgumentDepth(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length < 3) return 50;

  // 用句子内词语密度近似论证深度
  // 长句+多从句 → 深入论证
  // 短句+少修饰 → 简略提及
  const depths = sentences.map(s => {
    const tokens = tokenize(s);
    const modifierCount = (s.match(/[的地得]/g) || []).length;  // 修饰语
    const longClauseCount = (s.match(/，/g) || []).length;  // 从句数
    return tokens.length + modifierCount * 2 + longClauseCount * 3;  // 深度评分
  });

  const depthVariance = variance(depths);
  const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;

  let score = 50;
  // AI特征：深度方差小（始终深入或始终浅显）
  // 只在极端均匀时才提示，避免误判优秀人类写作
  if (depthVariance < avgDepth * 0.04 && sentences.length > 5) {
    score = 62;
  } else if (depthVariance < avgDepth * 0.1) {
    score = 52;
  } else if (depthVariance > avgDepth * 0.6) {
    score = 38;  // 深度变化大，更像人类
  } else {
    score = 48;
  }

  return Math.max(20, Math.min(80, score));
}

// 段落长度分布
// AI：段落长度均匀
// 人类：段落长短不一
export function analyzeParagraphLength(text: string): number {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length < 3) return 50;

  const lengths = paragraphs.map(p => p.replace(/\s/g, '').length);
  const lengthVariance = variance(lengths);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;

  let score = 50;
  // 只在极端均匀时才提示，避免误判优秀人类写作
  if (lengthVariance < avgLength * 0.02 && paragraphs.length > 4) {
    score = 65;
  } else if (lengthVariance < avgLength * 0.05) {
    score = 52;
  } else if (lengthVariance > avgLength * 0.5) {
    score = 38;
  } else {
    score = 48;
  }

  return Math.max(20, Math.min(80, score));
}

// 综合拓扑特征分析
export function analyzeTopology(text: string): {
  informationDensity: number;
  logicalConnection: number;
  argumentDepth: number;
  paragraphLength: number;
  overallScore: number;
} {
  const densityScore = analyzeInformationDensity(text);
  const logicalScore = analyzeLogicalConnection(text);
  const depthScore = analyzeArgumentDepth(text);
  const paragraphScore = analyzeParagraphLength(text);

  // 加权平均
  const overallScore = Math.round(
    densityScore * 0.3 +
    logicalScore * 0.3 +
    depthScore * 0.2 +
    paragraphScore * 0.2
  );

  return {
    informationDensity: densityScore,
    logicalConnection: logicalScore,
    argumentDepth: depthScore,
    paragraphLength: paragraphScore,
    overallScore: Math.max(10, Math.min(90, overallScore))
  };
}