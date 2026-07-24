# NotAI - AI内容检测工具

## 项目简介

检测文章是否由AI生成的Web工具。

**核心功能：**
- 多模型检测（支持 deepseek-v4-flash、mimo-v2.5、Qwen3-8B免费）
- 困惑度检测
- 段落级检测（定位AI生成的具体段落）
- AI来源识别（识别可能的AI工具）
- 置信区间
- 修改建议
- 对比模式
- 公开API接口
- 访问密钥认证

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

编辑 `.env.local` 文件：

```env
# API配置
API_BASE_URL=https://api.guyu.run
API_KEY=你的API密钥

# 检测模型
DETECT_MODEL=deepseek-v4-flash

# 访问密钥（用户访问网站时需要输入）
AUTH_SECRET=你的访问密钥

# JWT密钥（随机生成一个复杂字符串）
JWT_SECRET=你的JWT密钥

# 公开API密钥（第三方调用时使用）
PUBLIC_API_KEY=你的公开API密钥
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 4. 使用步骤

1. 输入访问密钥（`.env.local` 中的 `AUTH_SECRET` 值）
2. 选择检测模式（普通检测/对比模式）
3. 粘贴文本或输入链接
4. 选择模型和高级选项
5. 点击"开始检测"
6. 查看检测结果

---

## 功能详解

### 1. 普通检测

**基础功能：**
- 粘贴文本或输入URL
- 自动提取文章内容（支持微信公众号、知乎等）

**高级选项：**
- **模型选择**：可勾选多个模型进行交叉验证
  - DeepSeek V4 Flash - 速度快，成本低
  - MiMo V2.5 - 小米大模型
  - Qwen3-8B - 免费
- **段落级检测**：定位哪些段落是AI生成的
- **AI来源识别**：识别可能的AI工具（ChatGPT/Claude/Kimi等）
- **修改建议**：如何让文章更像人类写作

**检测结果：**
- AI概率（0-100%）
- 困惑度
- 置信度（高/中/低）
- 置信区间
- 多模型对比结果
- 统计特征分析
- 详细分析报告

### 2. 对比模式

上传AI样本和人类样本进行对比分析：

```
待检测文本 vs AI样本 vs 人类样本
```

系统会计算困惑度差异，判断待检测文本更接近哪一方。

### 3. 公开API

提供API接口供第三方调用：

**端点：** `POST /api/v1/detect`

**认证：**
```bash
curl -X POST https://your-domain.com/api/v1/detect \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "要检测的文本",
    "models": ["deepseek-v4-flash", "plan/qwen3-8b"],
    "enable_paragraph_detection": true,
    "enable_source_identification": true,
    "enable_suggestions": true
  }'
```

**响应：**
```json
{
  "success": true,
  "data": {
    "ai_probability": 75,
    "perplexity": 28.5,
    "confidence": "high",
    "confidence_interval": { "lower": 70, "upper": 80 },
    "statistics": { ... },
    "paragraph_results": [ ... ],
    "source_identification": { ... },
    "suggestions": [ ... ]
  }
}
```

**API文档：** 访问 `/api/v1/detect` (GET) 查看完整文档

---

## 部署到 EdgeOne Makers

### 1. 推送代码到 GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin 你的仓库地址
git push -u origin main
```

### 2. 在 EdgeOne Makers 控制台部署

1. 进入 [Makers 控制台](https://console.cloud.tencent.com/edgeone/pages)
2. 点击"导入项目"
3. 选择你的 GitHub 仓库
4. 配置环境变量（同 `.env.local` 中的内容）
5. 点击"部署"

### 3. 获得访问地址

部署成功后会自动生成一个线上URL，可以直接访问。

---

## 技术架构

```
前端 (Next.js + React + TypeScript)
    ↓
API Routes (后端接口)
    ├── /api/auth - 认证接口
    ├── /api/detect - 检测接口
    ├── /api/compare - 对比接口
    └── /api/v1/detect - 公开API
    ↓
外部API (deepseek-v4-flash / mimo-v2.5 / qwen3-8b)
```

**检测流程：**

```
输入文本
    ↓
认证验证
    ↓
多模型并行检测
    ├── 困惑度计算 (API调用)
    └── 统计特征 (本地计算)
    ↓
加权融合评分
    ↓
可选功能：
├── 段落级检测
├── AI来源识别
└── 修改建议生成
    ↓
返回结果
```

---

## 检测原理

### 1. 困惑度检测

- AI生成的文本通常困惑度较低（更"完美"）
- 人类写作的文本困惑度较高（更有变化）
- 使用模型计算每个token的概率

### 2. 统计特征分析

**句长方差：**
- AI文本：句子长度均匀，方差小
- 人类文本：句子长度变化大，方差大

**词汇多样性（TTR）：**
- AI文本：词汇重复使用，多样性低
- 人类文本：词汇丰富，多样性高

**标点分布：**
- AI文本：标点规范，感叹号/引号少
- 人类文本：标点灵活，更多表达情感

### 3. 综合评分

```
AI概率 = 困惑度评分 × 70% + 统计特征评分 × 30%
```

---

## 支持的模型

| 模型 | 支持logprobs | 特点 | 费用 |
|------|-------------|------|------|
| deepseek-v4-flash | ✓ | 速度快，成本低 | 付费 |
| mimo-v2.5 | ✗ | 小米大模型 | 付费 |
| plan/qwen3-8b | ✗ | 通义千问 | **免费** |
| glm-5.2 | ✓ | 智谱AI | 付费 |

---

## 安全说明

- 访问密钥存储在环境变量中，不会暴露给前端
- JWT token 有效期 24 小时
- 文本长度至少 50 字符（无上限）
- 不存储用户上传的文本内容

---

## 项目结构

```
notai/
├── app/
│   ├── layout.tsx          # 全局布局
│   ├── page.tsx            # 首页
│   ├── globals.css         # 全局样式
│   └── api/
│       ├── auth/route.ts   # 认证API
│       ├── detect/route.ts # 检测API
│       ├── compare/route.ts # 对比API
│       └── v1/detect/route.ts # 公开API
├── lib/
│   ├── auth.ts             # 认证工具
│   ├── detect.ts           # 检测主逻辑
│   ├── perplexity.ts       # 困惑度计算
│   ├── statistics.ts       # 统计分析
│   ├── fetch.ts            # 网页抓取
│   └── models.ts           # 模型配置
├── types/
│   └── index.ts            # 类型定义
├── .env.local              # 环境变量
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.js
```

---

## 常见问题

**Q: 检测结果准确吗？**
A: 准确率约 80-85%，建议结合人工判断。多模型检测可以提高准确率。

**Q: 为什么需要访问密钥？**
A: 防止他人盗刷你的API tokens，保护你的资源。

**Q: 支持哪些语言？**
A: 目前主要针对中文优化，英文检测也可用但准确度稍低。

**Q: 检测速度慢怎么办？**
A: 使用单个模型检测更快。段落级检测会增加时间。

**Q: 如何使用免费模型？**
A: 勾选 Qwen3-8B 模型（标注"免费"）。

**Q: 支持哪些文章链接？**
A: 支持微信公众号、知乎、简书、博客等大部分网站。

---

## License

MIT
