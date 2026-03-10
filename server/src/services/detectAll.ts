import type { DetectRequest, DetectOneRequest, ProviderDetectionResult } from '../../../shared/detection.js'
import { detectAnthropic } from '../providers/anthropic.js'
import { detectGemini } from '../providers/gemini.js'
import { detectOpenAI } from '../providers/openai.js'
import { normalizeBaseUrl } from '../lib/url.js'

export interface DetectAllResult {
  normalizedBaseUrl: string
  results: ProviderDetectionResult[]
}

export async function detectAll(request: DetectRequest): Promise<DetectAllResult> {
  const normalizedBaseUrl = normalizeBaseUrl(request.baseUrl)
  const timeoutMs = request.timeoutMs ?? 8000

  const [openaiResults, anthropicResult, geminiResult] = await Promise.all([
    detectOpenAI(normalizedBaseUrl, request.apiKey, timeoutMs),
    detectAnthropic(normalizedBaseUrl, request.apiKey, timeoutMs),
    detectGemini(normalizedBaseUrl, request.apiKey, timeoutMs),
  ])

  return {
    normalizedBaseUrl,
    results: [...openaiResults, anthropicResult, geminiResult],
  }
}

export async function detectOne(request: DetectOneRequest): Promise<ProviderDetectionResult> {
  const normalizedBaseUrl = normalizeBaseUrl(request.baseUrl)
  const timeoutMs = request.timeoutMs ?? 8000

  switch (request.provider) {
    case 'openai-chat': {
      const results = await detectOpenAI(normalizedBaseUrl, request.apiKey, timeoutMs)
      return results[0]
    }
    case 'openai-codex': {
      const results = await detectOpenAI(normalizedBaseUrl, request.apiKey, timeoutMs)
      return results[1]
    }
    case 'anthropic':
      return detectAnthropic(normalizedBaseUrl, request.apiKey, timeoutMs)
    case 'gemini':
      return detectGemini(normalizedBaseUrl, request.apiKey, timeoutMs)
    default:
      throw new Error(`Unknown provider: ${request.provider}`)
  }
}
