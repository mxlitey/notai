'use client';

import { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';

// 初始结果对象（用于立即显示结果框架）
const initialResult = {
  aiProbability: 0,
  confidence: '分析中',
  confidenceInterval: '计算中',
  signals: [],
  evaluation: '分析中',
  suggestions: null,  // 改为 null，以便正确显示加载动画
  allResults: [],
  sources: {},
  modelScore: 0,
  localScore: 0,
  paragraphResults: []  // 立即显示分段检测详情框架
};

// 转圈圈加载动画组件
const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-4">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    <span className="ml-2 text-gray-600 dark:text-gray-400">加载中...</span>
  </div>
);

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [inputMode, setInputMode] = useState<'text' | 'url'>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [progressMessage, setProgressMessage] = useState(''); // 进度消息
  const [streamContent, setStreamContent] = useState<string>(''); // 流式内容
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [showLoginModal, setShowLoginModal] = useState(false);  // 登录弹窗
  const [showBackToTop, setShowBackToTop] = useState(false);  // 回到顶部按钮

  // 检查本地缓存的token
  useEffect(() => {
    const savedToken = localStorage.getItem('notai_token');
    if (savedToken) {
      // 验证token是否有效
      fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: savedToken })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setToken(savedToken);
            setIsAuthenticated(true);
          } else {
            // token无效，清除缓存
            localStorage.removeItem('notai_token');
          }
        })
        .catch(() => {
          localStorage.removeItem('notai_token');
        });
    }
  }, []);

  // 加载模型列表
  useEffect(() => {
    if (isAuthenticated) {
      fetch('/api/models')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setModels(data.data.models);
            setDefaultModel(data.data.defaultModel);
            setSelectedModel(data.data.defaultModel);
          }
        })
        .catch(err => {
          console.error('加载模型列表失败:', err);
        });
    }
  }, [isAuthenticated]);

  // 监听滚动，显示/隐藏回到顶部按钮
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 回到顶部
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 认证
  const handleAuth = async () => {
    if (!apiKey.trim()) {
      setError('请输入访问密钥');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      if (data.success) {
        setToken(data.token);
        setIsAuthenticated(true);
        // 保存token到本地缓存
        localStorage.setItem('notai_token', data.token);
        setShowLoginModal(false);  // 关闭弹窗
      } else {
        setError(data.error || '认证失败');
      }
    } catch (err: any) {
      console.error('登录错误:', err);
      setError(err?.message || '网络错误，请检查连接后重试');
    } finally {
      setLoading(false);
    }
  };

  // 退出登录
  const handleLogout = () => {
    localStorage.removeItem('notai_token');
    setToken('');
    setIsAuthenticated(false);
    setApiKey('');
    setResult(null);
  };

  // 检测
  const handleDetect = async () => {
    // 未登录，弹出登录窗口
    if (!isAuthenticated) {
      setShowLoginModal(true);
      return;
    }

    setLoading(true);
    setError('');
    setResult(initialResult);  // ← 立即显示初始结果框架
    setProgressMessage(''); // 清空进度消息
    setStreamContent(''); // 清空流式内容

    const body = inputMode === 'url'
      ? { url, token, modelId: selectedModel }
      : { text, token, modelId: selectedModel };

    try {
      const response = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      // 检查是否是流式响应
      const contentType = response.headers.get('Content-Type');
      if (contentType?.includes('text/event-stream')) {
        // 处理流式响应
        const reader = response.body?.getReader();
        if (!reader) {
          setError('无法获取响应流');
          setLoading(false);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            try {
              const message = JSON.parse(line.slice(6));

              if (message.type === 'progress') {
                // 显示进度
                setProgressMessage(message.message);
              } else if (message.type === 'stream') {
                // 流式内容 - 实时更新
                setStreamContent(message.fullContent);
              } else if (message.type === 'update') {
                // 细粒度更新 - 逐步填充各部分
                const { updateType, data } = message;
                
                if (updateType === 'localAnalysis') {
                  setResult((prev: any) => ({
                    ...prev,
                    localScore: data.localScore,
                    signals: data.signals
                  }));
                } else if (updateType === 'statistics') {
                  setResult((prev: any) => ({
                    ...prev,
                    statistics: data
                  }));
                } else if (updateType === 'modelResults') {
                  setResult((prev: any) => ({
                    ...prev,
                    modelResults: data.modelResults
                  }));
                } else if (updateType === 'score') {
                  setResult((prev: any) => ({
                    ...prev,
                    aiProbability: data.aiProbability,
                    confidence: data.confidence,
                    confidenceInterval: data.confidenceInterval
                  }));
                } else if (updateType === 'evaluation') {
                  setResult((prev: any) => ({
                    ...prev,
                    evaluation: data.text
                  }));
                } else if (updateType === 'suggestions') {
                  setResult((prev: any) => ({
                    ...prev,
                    suggestions: data.items
                  }));
                } else if (updateType === 'sources') {
                  setResult((prev: any) => ({
                    ...prev,
                    sourceIdentification: data
                  }));
                } else if (updateType === 'paragraphFrames') {
                  // 立即显示段落框架（只有原文，评价和信号待填充）
                  setResult((prev: any) => ({
                    ...prev,
                    paragraphResults: data
                  }));
                } else if (updateType === 'paragraph') {
                  // 更新段落的评价和信号
                  setResult((prev: any) => {
                    const paragraphResults = [...(prev.paragraphResults || [])];
                    paragraphResults[data.index] = {
                      ...paragraphResults[data.index],
                      ...data.data
                    };
                    return { ...prev, paragraphResults };
                  });
                }
              } else if (message.type === 'paragraph') {
                // 段落结果 - 可以在这里实时显示（可选）
                // 暂时跳过，等待完整结果
              } else if (message.type === 'complete') {
                // 完成检测 - 合并结果，保留已显示的段落框架
                setResult((prev: any) => {
                  const finalResult = message.data;
                  // 如果最终结果的段落数量与当前不同，保留当前段落框架
                  if (prev.paragraphResults && prev.paragraphResults.length > 0) {
                    // 合并段落结果（保留框架，填充数据）
                    const mergedParagraphs = prev.paragraphResults.map((p: any, idx: number) => {
                      const finalPara = finalResult.paragraphResults?.[idx];
                      if (finalPara) {
                        return {
                          ...p,
                          ...finalPara
                        };
                      }
                      return p;
                    });
                    return {
                      ...prev,
                      ...finalResult,
                      paragraphResults: mergedParagraphs
                    };
                  }
                  return finalResult;
                });
                setError('');
                setProgressMessage('');
                setStreamContent(''); // 清空流式内容
              } else if (message.type === 'error') {
                // 错误
                setError(message.message);
                setProgressMessage('');
                setStreamContent(''); // 清空流式内容
              }
            } catch (e) {
              console.error('解析消息失败:', e);
            }
          }
        }
      } else {
        // 处理非流式响应（错误响应）
        const data = await response.json();
        setError(data.error || '检测失败');
      }
    } catch (err: any) {
      console.error('检测错误:', err);
      setError(err?.message || '网络错误');
      setProgressMessage('');
    } finally {
      setLoading(false);
    }
  };

  // 生成检测结果图片
  const imageRef = useRef<HTMLDivElement>(null);
  
  const handleGenerateImage = async () => {
    if (!imageRef.current) return;
    
    try {
      const canvas = await html2canvas(imageRef.current, {
        scale: 2, // 提高清晰度
        backgroundColor: '#ffffff',
        logging: false,
      });
      
      // iOS Safari 不支持 download 属性，使用 Web Share API
      if (navigator.share) {
        // 转换为 Blob
        const blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/png');
        });
        
        // 创建 File 对象（用于分享）
        const file = new File([blob], `notai-检测报告-${Date.now()}.png`, { type: 'image/png' });
        
        // 尝试分享
        try {
          await navigator.share({
            files: [file],
            title: 'AI检测报告',
            text: '查看我的AI检测结果'
          });
        } catch (shareError) {
          // 用户取消分享或其他错误，降级到新窗口打开
          console.log('分享失败，使用新窗口打开');
          const image = canvas.toDataURL('image/png');
          const newWindow = window.open();
          if (newWindow) {
            newWindow.document.write(`<img src="${image}" style="max-width: 100%;">`);
            newWindow.document.title = 'AI检测报告 - 长按保存';
          }
        }
      } else {
        // 不支持 Web Share API，使用传统下载或新窗口打开
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        
        if (isIOS) {
          // iOS 设备但不支持分享，新窗口打开
          const image = canvas.toDataURL('image/png');
          const newWindow = window.open();
          if (newWindow) {
            newWindow.document.write(`<img src="${image}" style="max-width: 100%;">`);
            newWindow.document.title = 'AI检测报告 - 长按保存';
          }
        } else {
          // 非 iOS 设备，使用传统下载
          const image = canvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.href = image;
          link.download = `notai-检测报告-${new Date().getTime()}.png`;
          link.click();
        }
      }
    } catch (err) {
      console.error('生成图片失败:', err);
      alert('生成图片失败，请稍后重试');
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-gray-900 dark:text-white">NotAI</h1>
            <p className="text-gray-500 dark:text-gray-400">检测文章是否由AI生成</p>
          </div>
          {isAuthenticated && (
            <button
              onClick={handleLogout}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-sm underline"
            >
              退出登录
            </button>
          )}
        </div>

        {/* 输入区域 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6">
          {/* 输入模式切换 */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setInputMode('text')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${inputMode === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              粘贴文本
            </button>
            <button
              onClick={() => setInputMode('url')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${inputMode === 'url' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              输入链接
            </button>
          </div>

          {inputMode === 'text' ? (
            <>
              <div className="relative">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value.substring(0, 10000))}
                  className="w-full h-48 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none pr-20 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="请粘贴要检测的文章内容（最多10000字符）..."
                />
                <button
                  onClick={async () => {
                    try {
                      const clipText = await navigator.clipboard.readText();
                      setText(clipText.substring(0, 10000));
                    } catch (err) {
                      console.error('粘贴失败:', err);
                    }
                  }}
                  className="absolute top-2 right-2 px-3 py-1 text-sm bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded transition-colors"
                  title="从剪贴板粘贴（最多10000字符）"
                >
                  粘贴
                </button>
              </div>
              <div className="mt-2 text-right text-sm">
                <span className={text.length >= 10000 ? 'text-red-600 font-medium' : 'text-gray-500 dark:text-gray-400'}>
                  {text.length} / 10000 字符
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  placeholder="https://example.com/article"
                />
                <button
                  onClick={async () => {
                    try {
                      const clipText = await navigator.clipboard.readText();
                      setUrl(clipText);
                    } catch (err) {
                      console.error('粘贴失败:', err);
                    }
                  }}
                  className="px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors whitespace-nowrap"
                  title="从剪贴板粘贴"
                >
                  粘贴
                </button>
              </div>
              <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                支持微信公众号、知乎、博客等文章链接（最多提取10000字符）
              </div>
            </>
          )}
        </div>

        {/* 模型选择 */}
        {models.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4 mb-6">
            <div className="mb-2 text-sm text-gray-600 dark:text-gray-400 font-medium">
              检测模型：
            </div>
            <div className="flex flex-wrap gap-3">
              {models.map(model => {
                const isFree = model.endsWith('-free');
                // 处理模型名称：去掉 -free 后缀，取 / 右边的内容
                let displayName = isFree ? model.replace(/-free$/i, '') : model;
                if (displayName.includes('/')) {
                  displayName = displayName.split('/').pop() || displayName;
                }
                
                return (
                  <label
                    key={model}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-colors ${
                      selectedModel === model
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={model}
                      checked={selectedModel === model}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="hidden"
                    />
                    <span className="font-medium">{displayName}</span>
                    {isFree && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        selectedModel === model
                          ? 'bg-blue-500 text-white'
                          : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                      }`}>
                        免费
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {error && <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg">{error}</div>}

        <div className="flex justify-center mb-8">
          <button
            onClick={handleDetect}
            disabled={loading || (isAuthenticated && (inputMode === 'text' ? text.length < 50 : !url))}
            className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '检测中...' : isAuthenticated ? '开始检测' : '登录并检测'}
          </button>
        </div>

        {/* 检测结果 */}
        {result && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">检测结果</h2>
              <button
                onClick={handleGenerateImage}
                className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                生成图片
              </button>
            </div>

            {/* 主要指标 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">AI概率</div>
                {result.aiProbability === 0 ? (
                  <LoadingSpinner />
                ) : (
                  <div className={`text-4xl font-bold ${result.aiProbability > 70 ? 'text-red-600' : result.aiProbability > 50 ? 'text-orange-500' : result.aiProbability > 30 ? 'text-yellow-500' : 'text-green-600'}`}>
                    {result.aiProbability}%
                  </div>
                )}
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">模型评分</div>
                {result.modelScore === 0 ? (
                  <LoadingSpinner />
                ) : (
                  <div className="text-4xl font-bold text-gray-700 dark:text-gray-300">{result.modelScore ?? '—'}%</div>
                )}
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">置信度</div>
                {result.confidence === '分析中' ? (
                  <LoadingSpinner />
                ) : (
                  <div className={`text-2xl font-bold ${result.confidence === '高' ? 'text-green-600' : result.confidence === '中' ? 'text-yellow-500' : 'text-gray-500 dark:text-gray-400'}`}>
                    {result.confidence}
                  </div>
                )}
              </div>
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">置信区间</div>
                {result.confidenceInterval === '计算中' ? (
                  <LoadingSpinner />
                ) : (
                  <div className="text-xl font-bold text-gray-700 dark:text-gray-300">
                    {typeof result.confidenceInterval === 'object' 
                      ? `${result.confidenceInterval.lower}% - ${result.confidenceInterval.upper}%`
                      : result.confidenceInterval}
                  </div>
                )}
              </div>
            </div>

            {/* 模型检测结果 */}
            <div className="mb-6">
              <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">模型检测结果</h3>
              {result.modelResults && result.modelResults.length > 0 ? (
                  result.modelResults.map((mr: any) => (
                    <div key={mr.modelId} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg mb-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-medium text-gray-900 dark:text-white">{mr.modelName}</span>
                        <span className={`text-2xl font-bold ${mr.aiProbability === 0 ? 'text-gray-400' : mr.aiProbability > 70 ? 'text-red-600' : mr.aiProbability > 50 ? 'text-orange-500' : 'text-green-600'}`}>
                          {mr.aiProbability === 0 ? (
                            <span className="flex items-center gap-2 text-sm">
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                              <span>分析中...</span>
                            </span>
                          ) : `${mr.aiProbability}%`}
                        </span>
                      </div>
                    {mr.reason ? (
                      <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">{mr.reason}</div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                        <span>分析中...</span>
                      </div>
                    )}
                    <div className="mt-2">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">检测信号：</div>
                      {mr.signals && mr.signals.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {mr.signals.map((signal: string, idx: number) => (
                            <span key={idx} className="inline-flex items-center justify-center px-3 py-1 text-xs bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded text-gray-700 dark:text-gray-200 leading-none">
                              {signal}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                          <span>分析中...</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <LoadingSpinner />
              )}
            </div>

            {/* 统计特征 */}
            {/* 统计特征 */}
            {result.statistics ? (
              <div className="mb-6">
                <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">统计特征</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
                    <span className="text-gray-600 dark:text-gray-300">句长方差</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{result.statistics.sentenceLengthVariance}/100</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
                    <span className="text-gray-600 dark:text-gray-300">词汇多样性</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{result.statistics.lexicalDiversity}/100</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded">
                    <span className="text-gray-600 dark:text-gray-300">标点分布</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{result.statistics.punctuationScore}/100</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">统计特征</h3>
                <LoadingSpinner />
              </div>
            )}

            {/* AI来源识别 */}
            {result.sourceIdentification && Object.keys(result.sourceIdentification).length > 0 ? (
              <div className="mb-6">
                <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">可能的AI来源</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(result.sourceIdentification).map(([source, prob]) => (
                    <div key={source} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded">
                      <span className="text-gray-600 dark:text-gray-300 capitalize text-sm">{source}</span>
                      <div className="flex items-center gap-2">
                        {/* 进度条：手机端隐藏，平板/电脑端显示 */}
                        <div className="hidden md:flex flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded overflow-hidden max-w-[80px]">
                          <div className="h-full bg-blue-500" style={{ width: `${prob as number}%` }} />
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{prob as number}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">可能的AI来源</h3>
                <LoadingSpinner />
              </div>
            )}

            {/* 段落级检测 - 分段详情 */}
            {result.paragraphResults && (
              <div className="mb-6">
                <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">分段检测详情</h3>
                {result.paragraphResults.length > 0 ? (
                  <>
                    <div className="text-sm mb-3 text-gray-500 dark:text-gray-400">
                      <span className="inline-block mr-4">
                        <span className="inline-block w-4 h-4 bg-red-200 dark:bg-red-800 border border-red-300 dark:border-red-600 mr-1"></span>
                        疑似AI生成
                      </span>
                      <span className="inline-block mr-4">
                        <span className="inline-block w-4 h-4 bg-green-200 dark:bg-green-800 border border-green-300 dark:border-green-600 mr-1"></span>
                        可能人类写作
                      </span>
                      <span className="inline-block">
                        <span className="inline-block w-4 h-4 bg-yellow-200 dark:bg-yellow-800 border border-yellow-300 dark:border-yellow-600 mr-1"></span>
                        不确定
                      </span>
                    </div>
                    <div className="space-y-4">
                  {result.paragraphResults.map((p: any, i: number) => (
                    <div 
                      key={i} 
                      className={`p-4 rounded-lg border ${
                        p.aiProbability === 0
                          ? 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600'  // 未分析完成
                          : p.aiProbability > 70 
                            ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800' 
                            : p.aiProbability > 40 
                              ? 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800' 
                              : 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold text-gray-800 dark:text-gray-200">片段 {i + 1}</span>
                        <span className={`text-lg font-bold ${
                          p.aiProbability === 0
                            ? 'text-gray-400'  // 未分析完成
                            : p.aiProbability > 70 
                              ? 'text-red-600' 
                              : p.aiProbability > 40 
                                ? 'text-yellow-600' 
                                : 'text-green-600'
                        }`}>
                          {p.aiProbability === 0 ? (
                            <span className="flex items-center gap-2 text-sm">
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                              <span>分析中...</span>
                            </span>
                          ) : `${p.aiProbability}% AI`}
                        </span>
                      </div>
                      
                      {/* 原文 */}
                      <div className="mb-3">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">原文：</div>
                        <div className="p-2 bg-white dark:bg-gray-800 bg-opacity-60 rounded text-gray-700 dark:text-gray-300">{p.paragraph}</div>
                      </div>

                      {/* 模型评价 */}
                      <div className="mb-3">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">模型评价：</div>
                        {p.reason ? (
                          <div className="text-sm text-gray-600 dark:text-gray-300">{p.reason}</div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-gray-400">
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                            <span>分析中...</span>
                          </div>
                        )}
                      </div>

                      {/* 检测信号 */}
                      <div className="mb-3">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">检测信号：</div>
                        {p.signals && p.signals.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {p.signals.map((signal: string, k: number) => (
                              <span
                                key={k}
                                className="inline-flex items-center justify-center px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs rounded-full leading-none"
                              >
                                {signal}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-gray-400">
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                            <span>分析中...</span>
                          </div>
                        )}
                      </div>

                      {/* 修改建议 */}
                      {p.suggestions && p.suggestions.length > 0 && (
                        <div className="mb-3">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">修改建议：</div>
                          <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                            {p.suggestions.map((s: string, j: number) => (
                              <li key={j}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                    <span>正在分析段落...</span>
                  </div>
                )}
              </div>
            )}

            {/* 修改建议 */}
            {result.suggestions && result.suggestions.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-3 text-gray-900 dark:text-white">修改建议</h3>
                <ul className="space-y-2">
                  {result.suggestions.map((s: string, i: number) => (
                    <li key={i} className="text-gray-700 dark:text-gray-300">{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 登录弹窗 */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-center mb-2 text-gray-900 dark:text-white">登录验证</h2>
            <p className="text-gray-500 dark:text-gray-400 text-center mb-6">请输入访问密钥以使用检测功能</p>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">访问密钥</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                placeholder="请输入访问密钥"
                onKeyPress={(e) => e.key === 'Enter' && handleAuth()}
                autoFocus
              />
            </div>

            {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg text-sm">{error}</div>}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowLoginModal(false);
                  setError('');
                  setApiKey('');
                }}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAuth}
                disabled={loading || !apiKey}
                className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? '验证中...' : '登录'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 隐藏的图片模板（用于生成分享图片） */}
      {result && (
        <div
          ref={imageRef}
          style={{
            position: 'absolute',
            left: '-9999px',
            top: '-9999px',
            width: '800px',
            backgroundColor: '#ffffff',
            padding: '40px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {/* 头部 */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '30px', borderBottom: '2px solid #3b82f6', paddingBottom: '20px' }}>
            <h1 style={{ fontSize: '36px', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>NotAI</h1>
            <span style={{ marginLeft: 'auto', fontSize: '14px', color: '#6b7280' }}>AI内容检测报告</span>
          </div>

          {/* 主要指标 */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
            <div style={{ flex: 1, backgroundColor: result.aiProbability > 70 ? '#fee2e2' : result.aiProbability > 50 ? '#fef3c7' : '#d1fae5', padding: '20px', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>AI概率</div>
              <div style={{ fontSize: '48px', fontWeight: 'bold', color: result.aiProbability > 70 ? '#dc2626' : result.aiProbability > 50 ? '#d97706' : '#059669' }}>
                {result.aiProbability}%
              </div>
            </div>
            <div style={{ flex: 1, backgroundColor: '#f3f4f6', padding: '20px', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>置信度</div>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: result.confidence === 'high' ? '#059669' : result.confidence === 'medium' ? '#d97706' : '#6b7280' }}>
                {result.confidence === 'high' ? '高' : result.confidence === 'medium' ? '中' : '低'}
              </div>
            </div>
            <div style={{ flex: 1, backgroundColor: '#f3f4f6', padding: '20px', borderRadius: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>置信区间</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#374151' }}>
                {typeof result.confidenceInterval === 'object' 
                  ? `${result.confidenceInterval.lower}% - ${result.confidenceInterval.upper}%`
                  : result.confidenceInterval}
              </div>
            </div>
          </div>

          {/* 检测信号 */}
          {result.modelResults?.[0]?.signals && result.modelResults[0].signals.length > 0 && (
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '15px', color: '#1f2937' }}>检测信号</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {result.modelResults[0].signals.map((signal: string, i: number) => (
                  <span key={i} style={{ 
                    backgroundColor: '#dbeafe', 
                    color: '#1e40af', 
                    padding: '8px 16px', 
                    borderRadius: '20px', 
                    fontSize: '14px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: '1',
                    height: '28px'
                  }}>
                    {signal}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 评价 */}
          {result.modelResults?.[0]?.reason && (
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '15px', color: '#1f2937' }}>综合评价</h3>
              <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#374151', margin: 0 }}>
                {result.modelResults[0].reason}
              </p>
            </div>
          )}

          {/* 修改建议 */}
          {result.suggestions && result.suggestions.length > 0 && (
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '15px', color: '#1f2937' }}>修改建议</h3>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                {result.suggestions.map((s: string, i: number) => (
                  <li key={i} style={{ fontSize: '14px', lineHeight: '1.8', color: '#374151', marginBottom: '8px' }}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 段落详情 */}
          {result.paragraphResults && result.paragraphResults.length > 0 && (
            <div style={{ marginTop: '40px', borderTop: '2px solid #e5e7eb', paddingTop: '30px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '20px', color: '#1f2937' }}>
                段落详情 ({result.paragraphResults.length} 个片段)
              </h3>
              
              {result.paragraphResults.map((para: any, idx: number) => (
                <div key={idx} style={{ 
                  marginBottom: '25px', 
                  padding: '20px', 
                  backgroundColor: '#f9fafb', 
                  borderRadius: '12px',
                  border: '1px solid #e5e7eb'
                }}>
                  {/* 段落标题和评分 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <span style={{ fontSize: '16px', fontWeight: '600', color: '#374151' }}>
                      片段 {idx + 1}
                    </span>
                    <span style={{ 
                      fontSize: '24px', 
                      fontWeight: 'bold', 
                      color: para.aiProbability > 70 ? '#dc2626' : para.aiProbability > 50 ? '#d97706' : '#059669'
                    }}>
                      {para.aiProbability}%
                    </span>
                  </div>

                  {/* 原文 */}
                  {para.paragraph && (
                    <div style={{ marginBottom: '15px' }}>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '5px' }}>原文：</div>
                      <div style={{ fontSize: '14px', color: '#374151', lineHeight: '1.6', backgroundColor: '#ffffff', padding: '10px', borderRadius: '8px' }}>
                        {para.paragraph.length > 150 ? para.paragraph.substring(0, 150) + '...' : para.paragraph}
                      </div>
                    </div>
                  )}

                  {/* 模型评价 */}
                  {para.reason && (
                    <div style={{ marginBottom: '15px' }}>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '5px' }}>评价：</div>
                      <div style={{ fontSize: '14px', color: '#374151', lineHeight: '1.6' }}>
                        {para.reason}
                      </div>
                    </div>
                  )}

                  {/* 检测信号 */}
                  {para.signals && para.signals.length > 0 && (
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '5px' }}>检测信号：</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {para.signals.map((signal: string, i: number) => (
                          <span key={i} style={{ 
                            backgroundColor: '#dbeafe', 
                            color: '#1e40af', 
                            padding: '4px 12px', 
                            borderRadius: '12px', 
                            fontSize: '12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            lineHeight: '1',
                            height: '24px'
                          }}>
                            {signal}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 修改建议 */}
                  {para.suggestions && para.suggestions.length > 0 && (
                    <div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '5px' }}>建议：</div>
                      <div style={{ fontSize: '13px', color: '#374151', lineHeight: '1.5' }}>
                        {para.suggestions.join('；')}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 底部信息 */}
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>
              检测时间: {new Date().toLocaleString('zh-CN')}
            </span>
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>
              文本长度: {result.contentLength} 字符
            </span>
          </div>

          {/* 水印 */}
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <span style={{ fontSize: '12px', color: '#d1d5db' }}>
              Generated by NotAI - AI内容检测工具
            </span>
          </div>
        </div>
      )}

      {/* 回到顶部按钮 */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-8 right-8 w-12 h-12 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all duration-300 flex items-center justify-center z-50"
          title="回到顶部"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      )}
    </main>
  );
}
