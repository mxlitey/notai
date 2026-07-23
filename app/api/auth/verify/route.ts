import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json({
        success: false,
        error: '缺少token'
      }, { status: 400 });
    }

    const isValid = await verifyToken(token);

    if (isValid) {
      return NextResponse.json({
        success: true,
        message: 'token有效'
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'token无效或已过期'
      }, { status: 401 });
    }
  } catch {
    return NextResponse.json({
      success: false,
      error: '验证失败'
    }, { status: 500 });
  }
}
