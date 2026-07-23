// 从URL获取文章内容
export async function fetchArticleFromUrl(url: string): Promise<string> {
  try {
    // 验证URL格式
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('仅支持HTTP/HTTPS链接');
    }

    // 判断是否为微信公众号文章
    const isWechatArticle = urlObj.hostname === 'mp.weixin.qq.com';

    // 获取网页内容
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };

    // 公众号文章需要特殊处理
    if (isWechatArticle) {
      headers['Referer'] = 'https://weixin.qq.com/';
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000) // 15秒超时
    });

    if (!response.ok) {
      throw new Error(`获取网页失败: ${response.status}`);
    }

    const html = await response.text();

    // 提取正文内容
    const text = isWechatArticle
      ? extractWechatContent(html)
      : extractMainContent(html);

    return text;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('获取文章失败');
  }
}

// 提取微信公众号文章内容
function extractWechatContent(html: string): string {
  let text = html;

  // 公众号文章正文在 id="js_content" 的div中
  const contentMatch = text.match(/<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);

  if (contentMatch) {
    text = contentMatch[1];
  } else {
    // 备用方案：尝试提取 rich_media_content
    const richMatch = text.match(/<div[^>]*class="rich_media_content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (richMatch) {
      text = richMatch[1];
    }
  }

  // 移除section标签但保留内容
  text = text.replace(/<section[^>]*>/gi, '');
  text = text.replace(/<\/section>/gi, '\n');

  // 移除所有HTML标签
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');

  // 解码HTML实体
  text = decodeHtmlEntities(text);

  // 清理空白字符，保留段落
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n');
  text = text.trim();

  return text;
}

// 提取网页正文内容
function extractMainContent(html: string): string {
  // 移除script和style标签及其内容
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');

  // 尝试提取article标签内容
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    text = articleMatch[1];
  } else {
    // 尝试提取main标签内容
    const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      text = mainMatch[1];
    }
  }

  // 移除所有HTML标签
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');

  // 解码HTML实体
  text = decodeHtmlEntities(text);

  // 清理空白字符
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

// 解码HTML实体
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&bull;': '•',
  };

  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.split(entity).join(char);
  }

  // 解码数字实体
  decoded = decoded.replace(/&#(\d+);/g, (match, num) => {
    return String.fromCharCode(parseInt(num));
  });

  // 解码十六进制实体
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  return decoded;
}

// 验证URL格式
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch {
    return false;
  }
}

// 判断是否为微信公众号文章
export function isWechatUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'mp.weixin.qq.com';
  } catch {
    return false;
  }
}
