// 检测结果类型
export interface DetectionResult {
  aiProbability: number;        // AI概率 (0-100)
  perplexity: number;           // 困惑度
  confidence: 'high' | 'medium' | 'low';  // 置信度
  statistics: {
    sentenceLengthVariance: number;  // 句长方差
    lexicalDiversity: number;        // 词汇多样性
    punctuationScore: number;        // 标点符号评分
  };
  analysis: string;  // 分析说明
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
  text: string;
  token: string;
}
