import { NextResponse } from 'next/server';
import { getAvailableModels, getDefaultModel } from '@/lib/detect';

// 强制动态渲染
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const models = getAvailableModels();
    const defaultModel = getDefaultModel();

    return NextResponse.json({
      success: true,
      data: {
        models,
        defaultModel
      }
    });
  } catch (error) {
    console.error('获取模型列表失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取模型列表失败'
    }, { status: 500 });
  }
}
