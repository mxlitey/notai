// 检测结果类型
export interface DetectionResult {
  aiProbability: number;        // AI概率 (0-100)
  perplexity: number;           // 困惑度（已弃用，保留兼容）
  modelScore?: number;          // 模型深度判断评分 (0-100)
  localScore?: number;          // 本地综合评分 (0-100)
  confidence: 'high' | 'medium' | 'low';  // 置信度
  confidenceInterval: {
    lower: number;  // 置信区间下限
    upper: number;  // 置信区间上限
  };
  statistics: {
    sentenceLengthVariance: number;  // 句长方差
    lexicalDiversity: number;        // 词汇多样性
    punctuationScore: number;        // 标点符号评分
  };
  analysis: string;  // 分析说明
  suggestions?: string[];  // 修改建议
  sourceIdentification?: {  // AI来源识别
    chatgpt: number;
    claude: number;
    kimi: number;
    qwen: number;
    deepseek: number;
    other: number;
  };
  paragraphResults?: ParagraphResult[];  // 段落级检测结果
  modelResults?: ModelResult[];  // 多模型检测结果
  contentLength: number;
  source: 'text' | 'url';
}

// 段落级检测结果
export interface ParagraphResult {
  paragraph: string;      // 段落内容
  startIndex: number;     // 起始位置
  endIndex: number;       // 结束位置
  aiProbability: number;  // AI概率
  isAI: boolean;          // 是否为AI生成
  suggestions?: string[]; // 针对该段的修改建议
  modifiedText?: string;  // 修改后的文本示例
}

// 多模型检测结果
export interface ModelResult {
  modelId: string;
  modelName: string;
  aiProbability: number;
  perplexity: number;
}

// API响应类型
export interface APIResponse {
  success: boolean;
  data?: DetectionResult;
  error?: string;
}

// 认证相关类型
export interface AuthRequest {
  apiKey: string;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  error?: string;
}

// 检测请求类型
export interface DetectRequest {
  text?: string;
  url?: string;
  token: string;
  models?: string[];  // 选中的模型ID列表
  enableParagraphDetection?: boolean;  // 是否启用段落级检测
  enableSourceIdentification?: boolean;  // 是否启用来源识别
  enableSuggestions?: boolean;  // 是否生成修改建议
}

// 对比模式请求
export interface CompareRequest {
  text: string;
  aiSample?: string;   // AI样本
  humanSample?: string;  // 人类样本
  token: string;
}

// 对比模式结果
export interface CompareResult {
  textResult: {
    perplexity: number;
    aiProbability: number;
  };
  aiSampleResult?: {
    perplexity: number;
    aiProbability: number;
  };
  humanSampleResult?: {
    perplexity: number;
    aiProbability: number;
  };
  comparison: {
    closerTo: 'ai' | 'human' | 'uncertain';
    analysis: string;
  };
}

// 模型配置类型
export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  isFree: boolean;
  supportsLogprobs: boolean;
}
