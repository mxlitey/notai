import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { detectAIContent } from '@/lib/detect';
import type { CompareResult } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const { text, aiSample, humanSample, token } = await request.json();

    // 验证token
    if (!token || !(await verifyToken(token))) {
      return NextResponse.json({
        success: false,
        error: '未授权访问'
      }, { status: 401 });
    }

    if (!text || text.length < 50) {
      return NextResponse.json({
        success: false,
        error: '待检测文本至少50字符'
      }, { status: 400 });
    }

    // 检测主文本
    const textResult = await detectAIContent(text);

    const result: CompareResult = {
      textResult: {
        perplexity: textResult.perplexity,
        aiProbability: textResult.aiProbability
      },
      comparison: {
        closerTo: 'uncertain',
        analysis: ''
      }
    };

    // 检测AI样本
    if (aiSample && aiSample.length >= 50) {
      const aiResult = await detectAIContent(aiSample);
      result.aiSampleResult = {
        perplexity: aiResult.perplexity,
        aiProbability: aiResult.aiProbability
      };
    }

    // 检测人类样本
    if (humanSample && humanSample.length >= 50) {
      const humanResult = await detectAIContent(humanSample);
      result.humanSampleResult = {
        perplexity: humanResult.perplexity,
        aiProbability: humanResult.aiProbability
      };
    }

    // 计算对比结果
    const textPerp = result.textResult.perplexity;
    const aiPerp = result.aiSampleResult?.perplexity;
    const humanPerp = result.humanSampleResult?.perplexity;

    if (aiPerp !== undefined && humanPerp !== undefined) {
      const distToAI = Math.abs(textPerp - aiPerp);
      const distToHuman = Math.abs(textPerp - humanPerp);

      if (distToAI < distToHuman - 5) {
        result.comparison.closerTo = 'ai';
        result.comparison.analysis = `待检测文本的困惑度（${textPerp.toFixed(2)}）更接近AI样本（${aiPerp.toFixed(2)}），与人类样本（${humanPerp.toFixed(2)}）差异较大。`;
      } else if (distToHuman < distToAI - 5) {
        result.comparison.closerTo = 'human';
        result.comparison.analysis = `待检测文本的困惑度（${textPerp.toFixed(2)}）更接近人类样本（${humanPerp.toFixed(2)}），与AI样本（${aiPerp.toFixed(2)}）差异较大。`;
      } else {
        result.comparison.closerTo = 'uncertain';
        result.comparison.analysis = `待检测文本的困惑度（${textPerp.toFixed(2)}）介于AI样本（${aiPerp.toFixed(2)}）和人类样本（${humanPerp.toFixed(2)}）之间，无法明确判断。`;
      }
    } else if (aiPerp !== undefined) {
      const dist = Math.abs(textPerp - aiPerp);
      result.comparison.closerTo = dist < 10 ? 'ai' : 'uncertain';
      result.comparison.analysis = `仅提供了AI样本。待检测文本困惑度（${textPerp.toFixed(2)}）与AI样本（${aiPerp.toFixed(2)}）${dist < 10 ? '接近' : '有差异'}。`;
    } else if (humanPerp !== undefined) {
      const dist = Math.abs(textPerp - humanPerp);
      result.comparison.closerTo = dist < 10 ? 'human' : 'uncertain';
      result.comparison.analysis = `仅提供了人类样本。待检测文本困惑度（${textPerp.toFixed(2)}）与人类样本（${humanPerp.toFixed(2)}）${dist < 10 ? '接近' : '有差异'}。`;
    } else {
      result.comparison.analysis = `未提供对比样本。待检测文本困惑度：${textPerp.toFixed(2)}，AI概率：${textResult.aiProbability}%。`;
    }

    return NextResponse.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('对比检测失败:', error);
    return NextResponse.json({
      success: false,
      error: '对比检测失败'
    }, { status: 500 });
  }
}
