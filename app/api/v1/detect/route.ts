import { NextRequest, NextResponse } from 'next/server';
import { detectAIContent } from '@/lib/detect';
import { fetchArticleFromUrl, isValidUrl } from '@/lib/fetch';
import { isValidModel } from '@/lib/models';

// 公开API - 通过API Key认证
export async function POST(request: NextRequest) {
  try {
    // 从Header获取API Key
    const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization')?.replace('Bearer ', '');

    // 验证API Key
    const validApiKey = process.env.PUBLIC_API_KEY;
    if (!validApiKey || apiKey !== validApiKey) {
      return NextResponse.json({
        success: false,
        error: '无效的API Key'
      }, { status: 401 });
    }

    const body = await request.json();
    const { text, url, models, enable_paragraph_detection, enable_source_identification, enable_suggestions } = body;

    let content = '';

    // 处理URL或文本
    if (url && typeof url === 'string') {
      if (!isValidUrl(url)) {
        return NextResponse.json({
          success: false,
          error: '无效的URL'
        }, { status: 400 });
      }

      try {
        content = await fetchArticleFromUrl(url.trim());
      } catch (error) {
        const message = error instanceof Error ? error.message : '获取文章失败';
        return NextResponse.json({
          success: false,
          error: message
        }, { status: 400 });
      }
    } else if (text && typeof text === 'string') {
      content = text.trim();
    } else {
      return NextResponse.json({
        success: false,
        error: '请提供text或url参数'
      }, { status: 400 });
    }

    // 文本长度限制
    if (content.length < 50) {
      return NextResponse.json({
        success: false,
        error: '文本至少50字符'
      }, { status: 400 });
    }

    if (content.length > 10000) {
      content = content.substring(0, 10000);
    }

    // 验证模型
    let selectedModels = ['deepseek-v4-flash'];
    if (models && Array.isArray(models) && models.length > 0) {
      const validModels = models.filter(m => isValidModel(m));
      if (validModels.length > 0) {
        selectedModels = validModels;
      }
    }

    // 执行检测
    const result = await detectAIContent(content, {
      models: selectedModels,
      enableParagraphDetection: enable_paragraph_detection === true,
      enableSourceIdentification: enable_source_identification === true,
      enableSuggestions: enable_suggestions === true
    });

    // 返回简化的结果
    return NextResponse.json({
      success: true,
      data: {
        ai_probability: result.aiProbability,
        perplexity: result.perplexity,
        confidence: result.confidence,
        confidence_interval: result.confidenceInterval,
        statistics: result.statistics,
        paragraph_results: result.paragraphResults,
        source_identification: result.sourceIdentification,
        suggestions: result.suggestions,
        model_results: result.modelResults,
        content_length: content.length
      }
    });
  } catch (error) {
    console.error('API检测失败:', error);
    return NextResponse.json({
      success: false,
      error: '检测失败'
    }, { status: 500 });
  }
}

// API文档
export async function GET() {
  return NextResponse.json({
    name: 'NotAI Detection API',
    version: '1.0.0',
    description: 'AI内容检测API',
    authentication: {
      type: 'API Key',
      header: 'X-API-Key 或 Authorization: Bearer <key>'
    },
    endpoints: {
      'POST /api/v1/detect': {
        description: '检测文本是否由AI生成',
        parameters: {
          text: '文本内容（与url二选一）',
          url: '文章链接（与text二选一）',
          models: '模型ID数组，可选值: deepseek-v4-flash, mimo-v2.5, plan/qwen3-8b',
          enable_paragraph_detection: '是否启用段落级检测',
          enable_source_identification: '是否启用AI来源识别',
          enable_suggestions: '是否生成修改建议'
        },
        response: {
          success: '是否成功',
          data: {
            ai_probability: 'AI概率 (0-100)',
            perplexity: '困惑度',
            confidence: '置信度 (high/medium/low)',
            confidence_interval: '置信区间 { lower, upper }',
            statistics: '统计特征',
            paragraph_results: '段落级检测结果（可选）',
            source_identification: 'AI来源识别（可选）',
            suggestions: '修改建议（可选）'
          }
        }
      }
    },
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', is_free: false },
      { id: 'mimo-v2.5', name: 'MiMo V2.5', is_free: false },
      { id: 'plan/qwen3-8b', name: 'Qwen3-8B', is_free: true }
    ]
  });
}
