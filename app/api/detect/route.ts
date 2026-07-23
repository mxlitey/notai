import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { detectAIContent } from '@/lib/detect';
import { fetchArticleFromUrl, isValidUrl } from '@/lib/fetch';

export async function POST(request: NextRequest) {
  try {
    const { text, url, token } = await request.json();

    // 验证token
    if (!token || !(await verifyToken(token))) {
      return NextResponse.json({
        success: false,
        error: '未授权访问，请先输入正确的访问密钥'
      }, { status: 401 });
    }

    let content = '';

    // 优先使用URL
    if (url && typeof url === 'string') {
      if (!isValidUrl(url)) {
        return NextResponse.json({
          success: false,
          error: '请输入有效的URL地址'
        }, { status: 400 });
      }

      try {
        content = await fetchArticleFromUrl(url.trim());
      } catch (error) {
        const message = error instanceof Error ? error.message : '获取文章失败';
        return NextResponse.json({
          success: false,
          error: `无法获取文章: ${message}`
        }, { status: 400 });
      }
    } else if (text && typeof text === 'string') {
      content = text.trim();
    } else {
      return NextResponse.json({
        success: false,
        error: '请输入文本或URL'
      }, { status: 400 });
    }

    // 文本长度限制
    if (content.length < 50) {
      return NextResponse.json({
        success: false,
        error: '文本太短，请至少输入50个字符'
      }, { status: 400 });
    }

    if (content.length > 10000) {
      // 截取前10000字符
      content = content.substring(0, 10000);
    }

    // 执行检测
    const result = await detectAIContent(content);

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        contentLength: content.length,
        source: url ? 'url' : 'text'
      }
    });
  } catch (error) {
    console.error('检测失败:', error);
    return NextResponse.json({
      success: false,
      error: '检测失败，请稍后重试'
    }, { status: 500 });
  }
}
