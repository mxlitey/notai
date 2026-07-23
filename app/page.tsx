'use client';

import { useState } from 'react';

// 模型配置
const MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', desc: '速度快，成本低', isFree: false },
  { id: 'mimo-v2.5', name: 'MiMo V2.5', desc: '小米大模型', isFree: false },
  { id: 'plan/qwen3-8b', name: 'Qwen3-8B', desc: '通义千问', isFree: true }
];

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState<'detect' | 'compare'>('detect');
  const [inputMode, setInputMode] = useState<'text' | 'url'>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  // 高级选项
  const [selectedModels, setSelectedModels] = useState<string[]>(['deepseek-v4-flash']);
  const [enableParagraphDetection, setEnableParagraphDetection] = useState(false);
  const [enableSourceIdentification, setEnableSourceIdentification] = useState(false);
  const [enableSuggestions, setEnableSuggestions] = useState(false);

  // 对比模式
  const [aiSample, setAiSample] = useState('');
  const [humanSample, setHumanSample] = useState('');
  const [compareResult, setCompareResult] = useState<any>(null);

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
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
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
      ? { url, token, models: selectedModels, enableParagraphDetection, enableSourceIdentification, enableSuggestions }
      : { text, token, models: selectedModels, enableParagraphDetection, enableSourceIdentification, enableSuggestions };

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

  // 对比检测
  const handleCompare = async () => {
    setLoading(true);
    setError('');
    setCompareResult(null);

    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, aiSample, humanSample, token })
      });

      const data = await res.json();

      if (data.success) {
        setCompareResult(data.data);
      } else {
        setError(data.error || '对比失败');
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
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">NotAI</h1>
          <p className="text-gray-500">检测文章是否由AI生成</p>
        </div>

        {/* 模式切换 */}
        <div className="flex justify-center gap-2 mb-6">
          <button
            onClick={() => setMode('detect')}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${mode === 'detect' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          >
            普通检测
          </button>
          <button
            onClick={() => setMode('compare')}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${mode === 'compare' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          >
            对比模式
          </button>
        </div>

        {/* 普通检测模式 */}
        {mode === 'detect' && (
          <>
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

            {/* 高级选项 */}
            <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
              <h3 className="font-semibold mb-4">高级选项</h3>

              {/* 模型选择 */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">检测模型（可多选）</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {MODELS.map(model => (
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
                      <div>
                        <div className="font-medium">
                          {model.name}
                          {model.isFree && <span className="ml-2 text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">免费</span>}
                        </div>
                        <div className="text-xs text-gray-500">{model.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* 功能开关 */}
              <div className="space-y-2">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableParagraphDetection}
                    onChange={(e) => setEnableParagraphDetection(e.target.checked)}
                    className="mr-3"
                  />
                  <span>段落级检测（定位AI生成的具体段落）</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableSourceIdentification}
                    onChange={(e) => setEnableSourceIdentification(e.target.checked)}
                    className="mr-3"
                  />
                  <span>AI来源识别（识别可能的AI工具）</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableSuggestions}
                    onChange={(e) => setEnableSuggestions(e.target.checked)}
                    className="mr-3"
                  />
                  <span>修改建议（如何让文章更像人类写作）</span>
                </label>
              </div>
            </div>

            {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">{error}</div>}

            <div className="flex justify-center mb-8">
              <button
                onClick={handleDetect}
                disabled={loading || (inputMode === 'text' ? text.length < 50 : !url)}
                className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? '检测中...' : '开始检测'}
              </button>
            </div>
          </>
        )}

        {/* 对比模式 */}
        {mode === 'compare' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-2xl shadow-lg p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">待检测文本</label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full h-40 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="粘贴要检测的文本..."
                />
                <div className="mt-2 text-sm text-gray-500">{text.length} 字符</div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">AI样本（可选）</label>
                <textarea
                  value={aiSample}
                  onChange={(e) => setAiSample(e.target.value)}
                  className="w-full h-40 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="粘贴AI生成的文本..."
                />
                <div className="mt-2 text-sm text-gray-500">{aiSample.length} 字符</div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">人类样本（可选）</label>
                <textarea
                  value={humanSample}
                  onChange={(e) => setHumanSample(e.target.value)}
                  className="w-full h-40 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="粘贴人类写作的文本..."
                />
                <div className="mt-2 text-sm text-gray-500">{humanSample.length} 字符</div>
              </div>
            </div>

            {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">{error}</div>}

            <div className="flex justify-center mb-8">
              <button
                onClick={handleCompare}
                disabled={loading || text.length < 50}
                className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? '对比中...' : '开始对比'}
              </button>
            </div>
          </>
        )}

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
                <div className="text-sm text-gray-500 mb-1">困惑度</div>
                <div className="text-4xl font-bold text-gray-700">{result.perplexity}</div>
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

            {/* 多模型结果 */}
            {result.modelResults && result.modelResults.length > 1 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-3">多模型检测结果</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {result.modelResults.map((mr: any) => (
                    <div key={mr.modelId} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                      <div>
                        <div className="font-medium">{mr.modelName}</div>
                        <div className="text-xs text-gray-500">困惑度: {mr.perplexity}</div>
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
                          <div className="h-full bg-blue-500" style={{ width: `${prob}%` }} />
                        </div>
                        <span className="text-sm font-semibold w-10 text-right">{prob}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 段落级检测 */}
            {result.paragraphResults && result.paragraphResults.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-3">段落级检测</h3>
                <div className="space-y-2">
                  {result.paragraphResults.map((p: any, i: number) => (
                    <div key={i} className={`p-3 rounded border ${p.isAI ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium">段落 {i + 1}</span>
                        <span className={`text-sm font-bold ${p.isAI ? 'text-red-600' : 'text-green-600'}`}>
                          {p.aiProbability}% {p.isAI ? '(疑似AI)' : '(正常)'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">{p.paragraph}</div>
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

        {/* 对比结果 */}
        {compareResult && (
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-6">对比结果</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm text-gray-500 mb-1">待检测文本</div>
                <div className="text-2xl font-bold">{compareResult.textResult.aiProbability}%</div>
                <div className="text-sm text-gray-500">困惑度: {compareResult.textResult.perplexity?.toFixed(2)}</div>
              </div>
              {compareResult.aiSampleResult && (
                <div className="bg-red-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-500 mb-1">AI样本</div>
                  <div className="text-2xl font-bold">{compareResult.aiSampleResult.aiProbability}%</div>
                  <div className="text-sm text-gray-500">困惑度: {compareResult.aiSampleResult.perplexity?.toFixed(2)}</div>
                </div>
              )}
              {compareResult.humanSampleResult && (
                <div className="bg-green-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-500 mb-1">人类样本</div>
                  <div className="text-2xl font-bold">{compareResult.humanSampleResult.aiProbability}%</div>
                  <div className="text-sm text-gray-500">困惑度: {compareResult.humanSampleResult.perplexity?.toFixed(2)}</div>
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="font-semibold mb-2">
                结论: {compareResult.comparison.closerTo === 'ai' ? '更接近AI生成' : compareResult.comparison.closerTo === 'human' ? '更接近人类写作' : '无法确定'}
              </div>
              <div className="text-gray-700">{compareResult.comparison.analysis}</div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
