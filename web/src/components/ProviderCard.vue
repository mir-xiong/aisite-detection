<script setup lang="ts">
import { computed } from 'vue'
import type { ProviderDetectionResult } from '../../../shared/detection'

const providerLabels: Record<string, string> = {
  'openai-chat': 'OpenAI Chat',
  'openai-codex': 'OpenAI Codex',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

const props = defineProps<{
  result: ProviderDetectionResult
  redetecting?: boolean
}>()

const emit = defineEmits<{
  showTrace: [result: ProviderDetectionResult]
  redetect: [provider: string]
}>()

const displayName = computed(() => providerLabels[props.result.provider] ?? props.result.provider)

const statusLabel = computed(() => {
  if (props.result.supported && props.result.errorType === 'auth') {
    return 'Supported · Key invalid'
  }

  if (props.result.supported) {
    return 'Supported'
  }

  if (props.result.errorType === 'auth') {
    return 'Authentication failed'
  }

  if (props.result.errorType === 'timeout') {
    return 'Timed out'
  }

  if (props.result.errorType === 'unsupported_format') {
    return 'Unsupported response'
  }

  return 'Not detected'
})
</script>

<template>
  <article class="provider-card">
    <header class="provider-header">
      <div>
        <h3>{{ displayName }}</h3>
        <p :class="{ 'status-auth-error': result.supported && result.errorType === 'auth' }">{{ statusLabel }}</p>
      </div>
      <div class="header-actions">
        <button
          type="button"
          class="redetect-btn"
          :disabled="redetecting"
          @click="emit('redetect', result.provider)"
        >
          {{ redetecting ? 'Detecting…' : 'Re-detect' }}
        </button>
        <span class="confidence-badge">{{ result.confidence }}</span>
      </div>
    </header>

    <dl class="provider-meta">
      <div>
        <dt>Endpoint</dt>
        <dd>{{ result.endpointTried }}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{{ result.statusCode ?? '—' }}</dd>
      </div>
    </dl>

    <div class="provider-section">
      <p class="section-title">Models</p>
      <div v-if="result.models.length" class="model-list">
        <span v-for="model in result.models" :key="model" class="model-pill">{{ model }}</span>
      </div>
      <p v-else class="provider-message">{{ result.message ?? 'No models reported.' }}</p>
    </div>

    <p v-if="result.message && result.models.length" class="provider-message">{{ result.message }}</p>

    <button type="button" class="trace-button" @click="emit('showTrace', result)">View trace</button>
  </article>
</template>

<style scoped>
.provider-card {
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 20px;
  background: var(--card-bg);
}

.provider-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.header-actions {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.redetect-btn {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}

.redetect-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.provider-header h3 {
  margin: 0;
}

.provider-header p {
  margin: 6px 0 0;
  color: var(--text-secondary);
}

.status-auth-error {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  background: #fde8e8;
  color: #c0392b;
  font-weight: 600;
}

.confidence-badge {
  height: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f0f3f8;
  color: var(--text-primary);
  text-transform: capitalize;
  font-size: 13px;
}

.provider-meta {
  display: grid;
  gap: 12px;
  margin: 0 0 16px;
}

.provider-meta dt {
  margin-bottom: 4px;
  color: var(--text-secondary);
  font-size: 13px;
}

.provider-meta dd {
  margin: 0;
  word-break: break-all;
}

.provider-section {
  margin-bottom: 16px;
}

.section-title {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.model-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-pill {
  padding: 4px 10px;
  border-radius: 999px;
  background: #f0f3f8;
}

.provider-message {
  margin: 0;
  color: var(--text-secondary);
}

.trace-button {
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
</style>
