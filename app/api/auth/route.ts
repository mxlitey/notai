import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey, generateToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: '请输入访问密钥'
      }, { status: 400 });
    }

    if (!validateApiKey(apiKey)) {
      return NextResponse.json({
        success: false,
        error: '访问密钥无效'
      }, { status: 401 });
    }

    const token = await generateToken();

    return NextResponse.json({
      success: true,
      token
    });
  } catch (error) {
    console.error('认证失败:', error);
    return NextResponse.json({
      success: false,
      error: '认证失败'
    }, { status: 500 });
  }
}
