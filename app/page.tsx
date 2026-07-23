'use client';

import { useState } from 'react';

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

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
      } else {
        setError(data.error || '认证失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 检测
  const handleDetect = async () => {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, token })
      });

      const data = await res.json();

      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || '检测失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              访问密钥
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="请输入访问密钥"
              onKeyPress={(e) => e.key === 'Enter' && handleAuth()}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleAuth}
            disabled={loading || !apiKey}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '验证中...' : '进入'}
          </button>
        </div>
      </main>
    );
  }

  // 检测界面
  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">NotAI</h1>
          <p className="text-gray-500">检测文章是否由AI生成</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            输入文本（50-5000字符）
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-64 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="请粘贴要检测的文章内容..."
          />
          <div className="mt-2 text-right text-sm text-gray-500">
            {text.length} / 5000
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex justify-center mb-8">
          <button
            onClick={handleDetect}
            disabled={loading || text.length < 50 || text.length > 5000}
            className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '检测中...' : '开始检测'}
          </button>
        </div>

        {result && (
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-6">检测结果</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 mb-1">AI概率</div>
                <div className={`text-4xl font-bold ${
                  result.aiProbability > 70 ? 'text-red-600' :
                  result.aiProbability > 50 ? 'text-orange-500' :
                  result.aiProbability > 30 ? 'text-yellow-500' :
                  'text-green-600'
                }`}>
                  {result.aiProbability}%
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 mb-1">困惑度</div>
                <div className="text-4xl font-bold text-gray-700">
                  {result.perplexity}
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg text-center">
                <div className="text-sm text-gray-500 mb-1">置信度</div>
                <div className={`text-2xl font-bold ${
                  result.confidence === 'high' ? 'text-green-600' :
                  result.confidence === 'medium' ? 'text-yellow-500' :
                  'text-gray-500'
                }`}>
                  {result.confidence === 'high' ? '高' :
                   result.confidence === 'medium' ? '中' : '低'}
                </div>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">统计特征</h3>
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

            <div>
              <h3 className="text-lg font-semibold mb-3">详细分析</h3>
              <div className="bg-gray-50 p-4 rounded-lg whitespace-pre-wrap text-gray-700">
                {result.analysis}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
