import { NextResponse } from 'next/server';
import { AVAILABLE_MODELS } from '@/lib/models';

// 获取可用模型列表
export async function GET() {
  return NextResponse.json({
    success: true,
    data: AVAILABLE_MODELS.map(m => ({
      id: m.id,
      name: m.name,
      isFree: m.isFree,
      supportsLogprobs: m.supportsLogprobs
    }))
  });
}
