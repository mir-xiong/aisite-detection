import type { DetectRequest, DetectResponse, DetectOneRequest, ProviderDetectionResult } from '../../../shared/detection'

export async function detectSite(payload: DetectRequest): Promise<DetectResponse> {
  const response = await fetch('/api/detect', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(errorBody.message ?? 'Detection failed')
  }

  return (await response.json()) as DetectResponse
}

export async function detectOne(payload: DetectOneRequest): Promise<ProviderDetectionResult> {
  const response = await fetch('/api/detect-one', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(errorBody.message ?? 'Re-detection failed')
  }

  return (await response.json()) as ProviderDetectionResult
}
