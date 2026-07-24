import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getAvailableModels, getDefaultModel } from '@/lib/detect';

export async function GET(request: NextRequest) {
  try {
    // 验证token（可选，如果需要公开模型列表可以移除验证）
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    
    // 如果需要验证，取消下面的注释
    // if (!token || !(await verifyToken(token))) {
    //   return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    // }

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
