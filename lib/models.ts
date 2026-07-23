// 模型配置
export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  isFree: boolean;
  supportsLogprobs: boolean;
}

// 可用模型列表
export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: '速度快，成本低',
    isFree: false,
    supportsLogprobs: true
  },
  {
    id: 'mimo-v2.5',
    name: 'MiMo V2.5',
    description: '小米大模型',
    isFree: false,
    supportsLogprobs: false
  },
  {
    id: 'plan/qwen3-8b',
    name: 'Qwen3-8B',
    description: '通义千问，免费使用',
    isFree: true,
    supportsLogprobs: false
  }
];

// 获取模型配置
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return AVAILABLE_MODELS.find(m => m.id === modelId);
}

// 验证模型ID
export function isValidModel(modelId: string): boolean {
  return AVAILABLE_MODELS.some(m => m.id === modelId);
}
