'use client';

import { useState, useEffect } from 'react';

// 模型配置类型
interface ModelConfig {
  id: string;
  name: string;
  isFree: boolean;
  supportsLogprobs: boolean;
}

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

  // 模型列表（从API获取）
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  // 获取模型列表
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          setModels(data.data);
          if (data.data.length > 0) {
            setSelectedModels([data.data[0].id]);
          }
        }
      })
      .catch(err => console.error('获取模型列表失败:', err));
  }, []);

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

  // 认证
  const handleAuth = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });

      const data = await res.json();

      if (data.success) {
        setToken(data.token);
        setIsAuthenticated(true);
        // 保存token到本地缓存
        localStorage.setItem('notai_token', data.token);
      } else {
        setError(data.error || '认证失败');
      }
    } catch {
      setError('网络错误');
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

  // 切换模型选择
  const toggleModel = (modelId: string) => {
    if (selectedModels.includes(modelId)) {
      if (selectedModels.length > 1) {
        setSelectedModels(selectedModels.filter(m => m !== modelId));
      }
    } else {
      setSelectedModels([...selectedModels, modelId]);
    }
  };

  // 检测
  const handleDetect = async () => {
    setLoading(true);
    setError('');
    setResult(null);

    const body = inputMode === 'url'
      ? { url, token, models: selectedModels }
      : { text, token, models: selectedModels };

    try {
      const res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || '检测失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  };

  // 认证界面
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-100 to-gray-200">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full mx-4">
          <h1 className="text-3xl font-bold text-center mb-2">NotAI</h1>
          <p className="text-gray-500 text-center mb-6">AI内容检测工具</p>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">访问密钥</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="请输入访问密钥"
              onKeyPress={(e) => e.key === 'Enter' && handleAuth()}
            />
          </div>

          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

          <button
            onClick={handleAuth}
            disabled={loading || !apiKey}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '验证中...' : '进入'}
          </button>
        </div>
      </main>
    );
  }

  // 主界面
  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">NotAI</h1>
            <p className="text-gray-500">检测文章是否由AI生成</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-500 hover:text-gray-700 text-sm underline"
          >
            退出登录
          </button>
        </div>

        {/* 输入区域 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          {/* 输入模式切换 */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setInputMode('text')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${inputMode === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              粘贴文本
            </button>
            <button
              onClick={() => setInputMode('url')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${inputMode === 'url' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              输入链接
            </button>
          </div>

          {inputMode === 'text' ? (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full h-48 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="请粘贴要检测的文章内容..."
              />
              <div className="mt-2 text-right text-sm text-gray-500">{text.length} / 10000</div>
            </>
          ) : (
            <>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/article"
              />
              <div className="mt-2 text-sm text-gray-500">支持微信公众号、知乎、博客等文章链接</div>
            </>
          )}
        </div>

        {/* 模型选择 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <h3 className="font-semibold mb-4">选择检测模型（可多选）</h3>
          {models.length === 0 ? (
            <div className="text-gray-500">加载模型列表...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {models.map(model => (
                <label
                  key={model.id}
                  className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${selectedModels.includes(model.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedModels.includes(model.id)}
                    onChange={() => toggleModel(model.id)}
                    className="mr-3"
                  />
                  <div className="font-medium">
                      {model.name}
                      {model.isFree && <span className="ml-2 text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">免费</span>}
                    </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">{error}</div>}

        <div className="flex justify-center mb-8">
          <button
            onClick={handleDetect}
            disabled={loading || (inputMode === 'text' ? text.length < 50 : !url) || selectedModels.length === 0}
            className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '检测中...' : '开始检测'}
          </button>
        </div>

        {/* 检测结果 */}
        {result && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-bold mb-6">检测结果</h2>

            {/* 主要指标 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 mb-1">AI概率</div>
                <div className={`text-4xl font-bold ${result.aiProbability > 70 ? 'text-red-600' : result.aiProbability > 50 ? 'text-orange-500' : result.aiProbability > 30 ? 'text-yellow-500' : 'text-green-600'}`}>
                  {result.aiProbability}%
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 mb-1">模型评分</div>
                <div className="text-4xl font-bold text-gray-700">{result.modelScore ?? '—'}%</div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 mb-1">置信度</div>
                <div className={`text-2xl font-bold ${result.confidence === 'high' ? 'text-green-600' : result.confidence === 'medium' ? 'text-yellow-500' : 'text-gray-500'}`}>
                  {result.confidence === 'high' ? '高' : result.confidence === 'medium' ? '中' : '低'}
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 mb-1">置信区间</div>
                <div className="text-xl font-bold text-gray-700">{result.confidenceInterval.lower}% - {result.confidenceInterval.upper}%</div>
              </div>
            </div>

            {/* 模型检测结果 */}
            {result.modelResults && result.modelResults.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-3">{result.modelResults.length > 1 ? '多模型检测结果' : '模型检测结果'}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {result.modelResults.map((mr: any) => (
                    <div key={mr.modelId} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                      <div>
                        <div className="font-medium">{mr.modelName}</div>
                        <div className="text-xs text-gray-500">模型评分</div>
                        {mr.reason && <div className="text-xs text-gray-400 mt-1 break-all">{mr.reason}</div>}
                        {mr.degraded && <div className="text-xs text-orange-500 mt-1">（已降级到本地）</div>}
                      </div>
                      <div className={`text-lg font-bold ${mr.aiProbability > 70 ? 'text-red-600' : mr.aiProbability > 50 ? 'text-orange-500' : 'text-green-600'}`}>
                        {mr.aiProbability}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 统计特征 */}
            <div className="mb-6">
              <h3 className="font-semibold mb-3">统计特征</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                  <span className="text-gray-600">句长方差</span>
                  <span className="font-semibold">{result.statistics.sentenceLengthVariance}/100</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                  <span className="text-gray-600">词汇多样性</span>
                  <span className="font-semibold">{result.statistics.lexicalDiversity}/100</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                  <span className="text-gray-600">标点分布</span>
                  <span className="font-semibold">{result.statistics.punctuationScore}/100</span>
                </div>
              </div>
            </div>

            {/* AI来源识别 */}
            {result.sourceIdentification && (
              <div className="mb-6">
                <h3 className="font-semibold mb-3">可能的AI来源</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(result.sourceIdentification).map(([source, prob]) => (
                    <div key={source} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                      <span className="text-gray-600 capitalize">{source}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-gray-200 rounded overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${prob as number}%` }} />
                        </div>
                        <span className="text-sm font-semibold w-10 text-right">{prob as number}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 段落级检测 - 分段详情 */}
            {result.paragraphResults && result.paragraphResults.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-3">分段检测详情</h3>
                <div className="text-sm mb-3 text-gray-500">
                  <span className="inline-block mr-4">
                    <span className="inline-block w-4 h-4 bg-red-200 border border-red-300 mr-1"></span>
                    疑似AI生成
                  </span>
                  <span className="inline-block mr-4">
                    <span className="inline-block w-4 h-4 bg-green-200 border border-green-300 mr-1"></span>
                    可能人类写作
                  </span>
                  <span className="inline-block">
                    <span className="inline-block w-4 h-4 bg-yellow-200 border border-yellow-300 mr-1"></span>
                    不确定
                  </span>
                </div>
                <div className="space-y-4">
                  {result.paragraphResults.map((p: any, i: number) => (
                    <div 
                      key={i} 
                      className={`p-4 rounded-lg border ${
                        p.aiProbability > 70 
                          ? 'bg-red-50 border-red-200' 
                          : p.aiProbability > 40 
                            ? 'bg-yellow-50 border-yellow-200' 
                            : 'bg-green-50 border-green-200'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold text-gray-800">片段 {i + 1}</span>
                        <span className={`text-lg font-bold ${
                          p.aiProbability > 70 
                            ? 'text-red-600' 
                            : p.aiProbability > 40 
                              ? 'text-yellow-600' 
                              : 'text-green-600'
                        }`}>
                          {p.aiProbability}% AI
                        </span>
                      </div>
                      
                      {/* 原文 */}
                      <div className="mb-3">
                        <div className="text-xs text-gray-500 mb-1">原文：</div>
                        <div className="p-2 bg-white bg-opacity-60 rounded text-gray-700">{p.paragraph}</div>
                      </div>

                      {/* 模型评价 */}
                      {p.reason && (
                        <div className="mb-3">
                          <div className="text-xs text-gray-500 mb-1">模型评价：</div>
                          <div className="p-2 bg-blue-50 bg-opacity-60 rounded text-gray-700 text-sm">{p.reason}</div>
                        </div>
                      )}

                      {/* 修改建议 */}
                      {p.suggestions && p.suggestions.length > 0 && (
                        <div className="mb-3">
                          <div className="text-xs text-gray-500 mb-1">修改建议：</div>
                          <ul className="text-sm text-gray-600 space-y-1">
                            {p.suggestions.map((s: string, j: number) => (
                              <li key={j}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 修改建议 */}
            {result.suggestions && result.suggestions.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-3">修改建议</h3>
                <ul className="space-y-2">
                  {result.suggestions.map((s: string, i: number) => (
                    <li key={i} className="text-gray-700">{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 详细分析 */}
            <div>
              <h3 className="font-semibold mb-3">详细分析</h3>
              <div className="bg-gray-50 p-4 rounded-lg whitespace-pre-wrap text-gray-700">{result.analysis}</div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
