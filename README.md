# NotAI - AI内容检测工具

## 项目简介

检测文章是否由AI生成的Web工具。

**核心功能：**
- 困惑度检测（使用 deepseek-v4-flash 模型）
- 统计特征分析（句长、词汇多样性、标点分布）
- 访问密钥认证（防止盗刷tokens）

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
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 4. 使用步骤

1. 输入访问密钥（`.env.local` 中的 `AUTH_SECRET` 值）
2. 粘贴要检测的文章（50-5000字符）
3. 点击"开始检测"
4. 查看检测结果

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
    └── /api/detect - 检测接口
    ↓
外部API (deepseek-v4-flash)
```

**检测流程：**

```
输入文本
    ↓
认证验证
    ↓
并行计算：
├── 困惑度 (API调用)
└── 统计特征 (本地计算)
    ↓
加权融合评分
    ↓
返回结果
```

---

## 检测原理

### 1. 困惑度检测

- AI生成的文本通常困惑度较低（更"完美"）
- 人类写作的文本困惑度较高（更有变化）
- 使用 deepseek-v4-flash 模型计算每个token的概率

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

## 安全说明

- 访问密钥存储在环境变量中，不会暴露给前端
- JWT token 有效期 24 小时
- 文本长度限制在 50-5000 字符
- 不存储用户上传的文本内容

---

## 自定义配置

### 修改检测模型

编辑 `.env.local` 中的 `DETECT_MODEL`：

```env
# 使用 deepseek-v4-flash（推荐，成本低）
DETECT_MODEL=deepseek-v4-flash

# 或使用 glm-5.2
DETECT_MODEL=glm-5.2
```

### 修改访问密钥

编辑 `.env.local` 中的 `AUTH_SECRET`：

```env
AUTH_SECRET=你的新密钥
```

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
│       └── detect/route.ts # 检测API
├── lib/
│   ├── auth.ts             # 认证工具
│   ├── detect.ts           # 检测主逻辑
│   ├── perplexity.ts       # 困惑度计算
│   └── statistics.ts       # 统计分析
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
A: 准确率约 80-85%，建议结合人工判断。困惑度检测对 ChatGPT/Claude 等主流模型效果较好。

**Q: 为什么需要访问密钥？**
A: 防止他人盗刷你的API tokens，保护你的资源。

**Q: 支持哪些语言？**
A: 目前主要针对中文优化，英文检测也可用但准确度稍低。

**Q: 检测速度慢怎么办？**
A: API调用需要时间，通常 3-10 秒完成检测。可以使用更快的模型如 deepseek-v4-flash。

---

## License

MIT
