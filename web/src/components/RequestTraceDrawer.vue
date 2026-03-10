<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProviderDetectionResult } from '../../../shared/detection'

const providerLabels: Record<string, string> = {
  'openai-chat': 'OpenAI Chat',
  'openai-codex': 'OpenAI Codex',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

const props = defineProps<{
  open: boolean
  result: ProviderDetectionResult | null
}>()

const emit = defineEmits<{
  close: []
}>()

const displayName = computed(() =>
  props.result ? (providerLabels[props.result.provider] ?? props.result.provider) : '',
)

const expandedSet = ref<Set<number>>(new Set())

function toggleDetail(index: number) {
  const next = new Set(expandedSet.value)
  if (next.has(index)) {
    next.delete(index)
  } else {
    next.add(index)
  }
  expandedSet.value = next
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
</script>

<template>
  <div v-if="open && result" class="drawer-backdrop" @click.self="emit('close')">
    <aside class="drawer-panel">
      <header class="drawer-header">
        <div>
          <h3>{{ displayName }} trace</h3>
          <p>Masked request metadata</p>
        </div>
        <button type="button" class="drawer-close" @click="emit('close')">Close</button>
      </header>

      <ul class="trace-list">
        <li v-for="(trace, index) in result.traces" :key="`${result.provider}-${index}`" class="trace-item">
          <div class="trace-summary">
            <div>
              <p><strong>{{ trace.method }}</strong> {{ trace.url }}</p>
              <p>Status: {{ trace.statusCode ?? '—' }} · Auth: {{ trace.authMode }} · {{ trace.latencyMs ?? '—' }} ms</p>
              <p v-if="trace.note" class="trace-note">{{ trace.note }}</p>
            </div>
            <button type="button" class="detail-btn" @click="toggleDetail(index)">
              {{ expandedSet.has(index) ? 'Hide' : 'Details' }}
            </button>
          </div>

          <div v-if="expandedSet.has(index)" class="trace-detail">
            <div v-if="trace.requestHeaders && Object.keys(trace.requestHeaders).length" class="detail-section">
              <p class="detail-title">Request Headers</p>
              <pre class="detail-pre">{{ formatJson(trace.requestHeaders) }}</pre>
            </div>

            <div v-if="trace.requestBody" class="detail-section">
              <p class="detail-title">Request Body</p>
              <pre class="detail-pre">{{ formatJson(trace.requestBody) }}</pre>
            </div>

            <div class="detail-section">
              <p class="detail-title">Response Body</p>
              <pre class="detail-pre">{{ formatJson(trace.responseBody) }}</pre>
            </div>
          </div>
        </li>
      </ul>
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  justify-content: flex-end;
  z-index: 30;
}

.drawer-panel {
  width: min(520px, 100%);
  height: 100%;
  background: var(--card-bg);
  padding: 24px;
  overflow-y: auto;
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.drawer-header h3,
.drawer-header p {
  margin: 0;
}

.drawer-header p {
  margin-top: 6px;
  color: var(--text-secondary);
}

.drawer-close {
  height: fit-content;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}

.trace-list {
  display: grid;
  gap: 12px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.trace-item {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 14px;
}

.trace-summary {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.trace-summary p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.trace-summary p + p {
  margin-top: 4px;
}

.trace-summary p:first-child {
  color: var(--text-primary);
  font-size: 14px;
}

.trace-note {
  font-style: italic;
}

.detail-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.trace-detail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.detail-section + .detail-section {
  margin-top: 12px;
}

.detail-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f5f7fa;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
