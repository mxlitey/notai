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
    // 判断是否免费：以 -free 结尾
    const isFree = modelId.toLowerCase().endsWith('-free');

    // 显示名称处理
    let displayName = modelId;
    if (isFree) {
      // 如果以 -free 结尾，去掉后缀
      displayName = modelId.replace(/-free$/i, '');
    }
    // 如果有 '/' 取右边
    if (displayName.includes('/')) {
      displayName = displayName.split('/').pop() || displayName;
    }

    // 判断是否支持logprobs（已知支持的模型）
    const supportsLogprobs = ['deepseek', 'glm'].some(m => modelId.toLowerCase().includes(m));

    return {
      id: modelId,
      name: displayName,
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
