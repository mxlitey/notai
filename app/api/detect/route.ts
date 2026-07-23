import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { detectAIContent } from '@/lib/detect';

export async function POST(request: NextRequest) {
  try {
    const { text, token } = await request.json();

    // 验证token
    if (!token || !(await verifyToken(token))) {
      return NextResponse.json({
        success: false,
        error: '未授权访问，请先输入正确的访问密钥'
      }, { status: 401 });
    }

    // 验证文本
    if (!text || typeof text !== 'string') {
      return NextResponse.json({
        success: false,
        error: '请输入要检测的文本'
      }, { status: 400 });
    }

    // 文本长度限制
    if (text.length < 50) {
      return NextResponse.json({
        success: false,
        error: '文本太短，请至少输入50个字符'
      }, { status: 400 });
    }

    if (text.length > 5000) {
      return NextResponse.json({
        success: false,
        error: '文本太长，请限制在5000字符以内'
      }, { status: 400 });
    }

    // 执行检测
    const result = await detectAIContent(text);

    return NextResponse.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('检测失败:', error);
    return NextResponse.json({
      success: false,
      error: '检测失败，请稍后重试'
    }, { status: 500 });
  }
}
