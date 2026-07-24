# AI 检测逻辑优化方案

## Context（为什么做这次改动）

当前检测工具存在「人工文章误判为 AI」和「AI 文章概率偏低」两类准确性问题，根源在于检测链路有 6 个缺陷：

1. **多模型检测是假的**：`detectAIContent` 循环里每个模型都调用同一个 `detectLocal`，导致前端 `modelResults` 显示的所有模型分数完全相同。真正的模型判断在另一处取平均。
2. **段落级检测不调用模型**：`detectParagraphs` 只用本地统计+拓扑特征，与整体评分（模型 70%）不一致，正式文体段落被误判。
3. **Prompt 输出太简陋**：只要求单个整数，无推理，模型校准不一致。
4. **本地特征误判正式文体**：`topology.ts` 的 `analyzeLogicalConnection` 把「所以/因此/由于」等自然连接词也算 AI 特征；`detectLocal` 中 topology 权重 60% 过高，放大误判。
5. **段落 `startIndex/endIndex` 永远是 0**：前端无法高亮原文位置（类型有字段但未实现）。
6. **单次模型调用错误时 70% 权重无法纠正**。

用户已确认方向：段落级检测采用「批量调用模型」（一次 API 调用检测所有片段，模型返回 JSON 数组），整体偏向「最大准确性」。

另外发现一个真实 bug：`.env.local` 配置的是 `DETECT_MODEL`（旧变量名），而代码读 `PROMPT_MODEL`，导致本地只能用默认单模型 `deepseek-v4-flash`，无法加载配置的两个免费模型。需顺手修复。

预期结果：人工正式文章 AI 概率降至 <40%，AI 生成文章概率升至 >70%，段落级评分与整体一致，多模型展示真实分数。

---

## 实施步骤

### 1. 新建 `lib/ai-words.ts`：集中维护 AI 模板词清单

抽出共享常量，供 `statistics.ts`、`topology.ts`、`detect.ts` 三处引用，避免重复维护。

```ts
export const AI_TEMPLATE_WORDS = [
  '首先', '其次', '再次', '然后', '接着', '最后',
  '此外', '另外', '总之', '综上', '综上所述',
  '由此可见', '可以得出', '一方面', '另一方面',
  '与此同时', '在此基础上', '基于此', '据此', '由此',
  '值得注意的是', '需要指出的是', '值得一提的是',
  '不可否认', '毋庸置疑', '换句话说', '简而言之',
  '总的来说', '总而言之', '不仅', '而且'
];
```

### 2. `lib/topology.ts`：拆分连接词 + 收紧阈值（Goal 4）

- `analyzeLogicalConnection`（72-105）：把 `logicalConnectors` 数组拆为两组。**只对 AI 模板词计数**，自然连接词（所以/因此/由于/因为/导致/使得/从而/但是/然而/不过/虽然/尽管/可是）不再计入 AI 特征。阈值收紧：密度 `>0.4 → 68`、`>0.2 → 58`、`<0.05 → 38`、其余 `48`（旧为 `>0.3 → 68`）。
- `analyzeInformationDensity` / `analyzeArgumentDepth` / `analyzeParagraphLength`：三个「均匀分布」指标只在**极端**情况才给 65 分（阈值从 `avg*0.05` 收紧到 `avg*0.02` 且段落数/句数更多时），中等档 55 → 52，减少对优秀人类写作的误判。
- `analyzeTopology` 内部权重不变（density 0.3 / logical 0.3 / depth 0.2 / paragraph 0.2）。

### 3. `lib/statistics.ts`：权重微调 + 引用共享常量（Goal 4）

- `analyzeAIKeywords`（103-108）：`aiKeywords` 硬编码数组改为 `import { AI_TEMPLATE_WORDS } from './ai-words'`。
- `analyzeStatistics`（148-153）：权重调整为 sentence 0.20 / lexical 0.15 / punctuation 0.15 / **keyword 0.50**（旧 0.25/0.20/0.15/0.40）。AI 关键词是最可靠信号，抬高权重。

### 4. `types/index.ts`：扩展 `ModelResult`（Goal 1）

```ts
export interface ModelResult {
  modelId: string;
  modelName: string;
  aiProbability: number;
  perplexity: number;
  reason?: string;      // 新增：模型判定依据
  signals?: string[];   // 新增：检测到的具体信号
  degraded?: boolean;   // 新增：是否降级到本地
}
```

可选字段，不破坏现有 API 响应。

### 5. `lib/detect.ts`：核心重构（Goal 1/2/3/5/6）

#### 5.1 删除死代码
- `detectText`（12-18）整段删除（无外部调用）。

#### 5.2 `detectLocal` 权重反转（21-30）
```ts
// 旧: stats 0.4 + topo 0.6
const score = Math.round(stats.overallScore * 0.6 + topo.overallScore * 0.4);
```
建议抽模块常量 `LOCAL_WEIGHTS = { stats: 0.6, topo: 0.4 }`，`detectLocal` 和 `detectAIContent` 内两处共用，避免不一致。

#### 5.3 `callModelPrompt` 改结构化输出（33-106，Goal 3）
- 新返回类型 `{ aiProbability, reason, signals, degraded }`。
- `max_tokens` 从 10 提升到 **400**；超时从 90s 收紧到 **60s**。
- 请求体加 `response_format: { type: 'json_object' }`；若返回 400（模型不支持），移除该字段重试一次。
- 解析三层降级：剥 markdown 围栏 → `JSON.parse` → 正则 `/\{[^{}]*"score"\s*:\s*(\d+)[^{}]*\}/` 提取。全失败 → `detectLocal` 降级，`degraded: true`。
- Prompt 文本（核心：明确「文笔好≠AI」「自然连接词不算 AI 信号」「AI 模板词清单」「人类痕迹清单」「5 档评分尺度」），要求输出 `{"score", "reason", "signals"}`。

#### 5.4 `detectAIContent` 真实多模型（358-491，Goal 1/6）
- 删除 383-395 的假多模型循环和 411-418 的二次调用，合并为：本地评分（一次）→ 真实多模型并行 `callModelPrompt` → `modelResults` 填每个模型真实分数 + reason/signals/degraded。
- `promptScore` 只对未降级模型取平均；全部降级则回退 `localScore`。
- 新增 `reconcileScore(promptScore, localScore, stats)`（Goal 6）三路径：
  - 本地硬证据（stats>70 且 prompt<30）→ 模型 0.5 + 本地 0.5（模型可能漏看模板词）
  - 普通分歧 >40 → 模型 0.85 + 本地 0.15
  - 默认 → 模型 0.7 + 本地 0.3
- **不做第二次模型调用**（120s 预算下串行第二次会顶满超时，无容错）。
- `calculateConfidenceInterval` 的 samples 改用「成功返回的模型数」。

#### 5.5 `detectParagraphs` 批量模型 + 位置追踪（166-246，Goal 2/5）
- 句子分割改用 `matchAll` 记录每句 `[start, end)`；每 5 句一组，最多 **8 片段**（旧 10），单片段上限 300 字符。
- 新增 `callBatchParagraphModel(chunks, modelId)`：一次 API 调用，prompt 列出所有片段，要求返回 JSON 数组 `[{index, score, reason}]`。`max_tokens` 动态 `Math.min(2000, 100*chunks.length+200)`。
- `parseBatchResponse` 三层解析（整体 parse → 截取 `[...]` → 正则逐对象）。
- 组装 `ParagraphResult` 时填充真实 `startIndex/endIndex`；缺失的片段降级到 `detectLocal` 但保留位置。
- 批量调用整体失败 → 退化为逐片段 `detectLocal`，位置仍保留。

### 6. `app/page.tsx`：前端标签修正（Goal 1）
- 多模型卡片副标题「本地特征评分」→「模型评分」（320 行）。
- 可选：卡片下展示 `mr.reason` 和 `mr.degraded` 提示。

### 7. `.env.local`：修复环境变量
- 第 6 行 `DETECT_MODEL=...` 改为/新增 `PROMPT_MODEL=deepseek-v4-flash-free;mimo-v2.5-free`，使本地能加载配置的两个模型。

---

## 新权重配置总览

| 层级 | 旧 | 新 |
|------|----|----|
| `analyzeStatistics` 内部 | sentence .25 / lexical .20 / punct .15 / keyword .40 | .20 / .15 / .15 / **.50** |
| `detectLocal` 内部 | stats .40 + topo .60 | stats **.60** + topo .40 |
| 模型 vs 本地（默认） | 70 / 30 | 70 / 30 |
| 模型 vs 本地（分歧>40） | — | 85 / 15 |
| 模型 vs 本地（本地硬证据） | — | 50 / 50 |

---

## 降级策略（永不抛错）

| 风险 | 降级 |
|------|------|
| 单模型超时/失败 | 该模型 `degraded:true`，分数回退 `detectLocal`，其他模型不受影响 |
| 模型返回非 JSON | 三层解析全失败 → 该次降级 |
| `response_format` 报 400 | 移除该字段重试一次，仍失败降级 |
| 全部模型降级 | `promptScore=localScore`，前端可见降级提示 |
| 批量段落调用失败 | 退化为逐片段 `detectLocal`，保留 `startIndex/endIndex` |

---

## 验证方法

项目无测试框架，验证靠 `npm run dev` 启动后手动测两篇微信文章：
- 人类写作：`https://mp.weixin.qq.com/s/c26AKj0HoeNQeu323Tv18Q`
- AI 生成+人类加工：`https://mp.weixin.qq.com/s/WXYmH-yWYid3BzChEmenDQ`

### 验证清单
1. **整体 AI 概率**：人类文章 <40%（旧 42% 误判），AI 文章 >60%（旧 42% 偏低）。
2. **多模型真实性**：选 2 个模型，`modelResults` 两个分数应不同（旧版永远相等）。卡片标签显示「模型评分」。
3. **段落位置**：浏览器 console 跑 `result.paragraphResults.forEach(p => text.slice(p.startIndex, p.endIndex) === p.paragraph)` 应全 true（旧版全 false，因为位置是 0）。
4. **段落来源**：server 日志可见批量调用返回的 JSON。
5. **降级路径**：临时改错 `API_KEY` → 检测仍返回结果，`modelResults` 全 `degraded:true`，`aiProbability===localScore`。
6. **一致性纠偏**：`reconcileScore` 入口加 log，观察触发路径。

### 实施顺序（按依赖）
1. `lib/ai-words.ts`（新建）
2. `lib/topology.ts`（独立可测）
3. `lib/statistics.ts`（引用共享常量）
4. `types/index.ts`（扩展类型）
5. `lib/detect.ts`（5.1→5.5 逐步，每步 dev 跑一遍）
6. `app/page.tsx`（前端标签）
7. `.env.local`（修复 PROMPT_MODEL）

每步完成后 `npm run dev` 跑文章验证无回归再做下一步。
