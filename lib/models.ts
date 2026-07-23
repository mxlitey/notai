// 模型配置
export interface ModelConfig {
  id: string;
  name: string;
  isFree: boolean;
  supportsLogprobs: boolean;
}

// 从环境变量解析模型列表
function parseModelsFromEnv(): ModelConfig[] {
  const modelStr = process.env.DETECT_MODEL || 'deepseek-v4-flash';
  const models = modelStr.split(';').map(m => m.trim()).filter(Boolean);

  return models.map(modelId => {
    // 显示名称：如果有 '/' 取右边，否则取整个
    const displayName = modelId.includes('/') ? modelId.split('/').pop() || modelId : modelId;

    // 判断是否免费（根据特定标识）
    const isFree = modelId.includes('free') || modelId.includes('qwen3');

    // 判断是否支持logprobs（已知支持的模型）
    const supportsLogprobs = ['deepseek', 'glm'].some(m => modelId.toLowerCase().includes(m));

    return {
      id: modelId,
      name: displayName || modelId,
      isFree,
      supportsLogprobs
    };
  });
}

// 可用模型列表（从环境变量加载）
export const AVAILABLE_MODELS: ModelConfig[] = parseModelsFromEnv();

// 获取模型配置
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return AVAILABLE_MODELS.find(m => m.id === modelId);
}

// 验证模型ID
export function isValidModel(modelId: string): boolean {
  return AVAILABLE_MODELS.some(m => m.id === modelId);
}

// 获取所有模型ID列表
export function getModelIds(): string[] {
  return AVAILABLE_MODELS.map(m => m.id);
}
