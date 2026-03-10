<script setup lang="ts">
import { computed } from 'vue'
import type { DetectResponse } from '../../../shared/detection'

const providerLabels: Record<string, string> = {
  'openai-chat': 'OpenAI Chat',
  'openai-codex': 'OpenAI Codex',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

const props = defineProps<{
  result: DetectResponse
}>()

const elapsedMs = computed(() => {
  const startedAt = new Date(props.result.startedAt).getTime()
  const finishedAt = new Date(props.result.finishedAt).getTime()
  return Math.max(0, finishedAt - startedAt)
})

const supportedProviders = computed(() =>
  props.result.results
    .filter((item) => item.supported)
    .map((item) => ({ key: item.provider, label: providerLabels[item.provider] ?? item.provider })),
)
</script>

<template>
  <section class="summary-strip">
    <div>
      <p class="summary-label">Normalized URL</p>
      <p class="summary-value">{{ result.normalizedBaseUrl }}</p>
    </div>
    <div>
      <p class="summary-label">Elapsed</p>
      <p class="summary-value">{{ elapsedMs }} ms</p>
    </div>
    <div>
      <p class="summary-label">Supported</p>
      <div class="tag-list">
        <span v-for="p in supportedProviders" :key="p.key" class="provider-tag">
          {{ p.label }}
        </span>
        <span v-if="supportedProviders.length === 0" class="summary-muted">None</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.summary-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.summary-label {
  margin: 0 0 6px;
  color: var(--text-secondary);
  font-size: 13px;
}

.summary-value {
  margin: 0;
  font-weight: 600;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.provider-tag {
  padding: 4px 10px;
  border-radius: 999px;
  background: #e8f0ff;
  color: var(--accent-color);
  font-size: 13px;
  font-weight: 600;
  text-transform: capitalize;
}

.summary-muted {
  color: var(--text-secondary);
}
</style>
