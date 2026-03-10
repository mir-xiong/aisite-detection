<script setup lang="ts">
import { reactive, ref } from 'vue'

const emit = defineEmits<{
  submit: [payload: { baseUrl: string; apiKey: string; timeoutMs?: number }]
}>()

defineExpose({
  getFormValues: () => ({
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey.trim(),
    timeoutMs: form.timeoutMs,
  }),
})

const form = reactive({
  baseUrl: '',
  apiKey: '',
  timeoutMs: 8000,
})

const errors = reactive({
  baseUrl: '',
  apiKey: '',
})

const props = defineProps<{
  loading: boolean
}>()

const showApiKey = ref(false)
const smartInput = ref('')

function extractSiteAndKey(text: string): { baseUrl: string; apiKey: string } {
  const result = { baseUrl: '', apiKey: '' }
  const trimmed = text.trim()
  if (!trimmed) return result

  const urlPattern = /https?:\/\/[^\s,;'"]+/gi
  const urlMatch = trimmed.match(urlPattern)
  if (urlMatch) {
    result.baseUrl = urlMatch[0].replace(/\/+$/, '')
  }

  const keyPatterns = [
    /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,})/,
    /(?:key-[A-Za-z0-9_-]{20,})/,
    /(?:AIzaSy[A-Za-z0-9_-]{33})/,
  ]

  for (const pattern of keyPatterns) {
    const match = trimmed.match(pattern)
    if (match) {
      result.apiKey = match[0]
      return result
    }
  }

  const remaining = result.baseUrl
    ? trimmed.replace(result.baseUrl, '').trim()
    : trimmed

  const tokens = remaining.split(/[\s,;=:]+/).filter(Boolean)

  for (const token of tokens) {
    if (token.length >= 16 && /^[A-Za-z0-9_-]+$/.test(token) && !token.match(/^https?/i)) {
      result.apiKey = token
      break
    }
  }

  return result
}

function onSmartParse() {
  const parsed = extractSiteAndKey(smartInput.value)
  if (parsed.baseUrl) form.baseUrl = parsed.baseUrl
  if (parsed.apiKey) form.apiKey = parsed.apiKey
  smartInput.value = ''
}

function onSubmit() {
  errors.baseUrl = form.baseUrl.trim() ? '' : 'Base URL is required'
  errors.apiKey = form.apiKey.trim() ? '' : 'API key is required'

  if (errors.baseUrl || errors.apiKey) {
    return
  }

  emit('submit', {
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey.trim(),
    timeoutMs: form.timeoutMs,
  })
}
</script>

<template>
  <section class="detect-form">
    <div class="smart-input-group">
      <label>
        <span>Smart Paste</span>
        <textarea
          v-model="smartInput"
          aria-label="Smart Paste"
          class="smart-textarea"
          rows="2"
          placeholder="Paste text containing URL and API key, e.g.: https://api.example.com sk-proj-abc123..."
        />
      </label>
      <button type="button" class="parse-btn" :disabled="!smartInput.trim()" @click="onSmartParse">
        Extract
      </button>
    </div>

    <label>
      <span>Base URL</span>
      <input v-model="form.baseUrl" aria-label="Base URL" type="url" />
    </label>
    <p v-if="errors.baseUrl" class="field-error">{{ errors.baseUrl }}</p>

    <label>
      <span>API Key</span>
      <div class="key-input-group">
        <input
          v-model="form.apiKey"
          aria-label="API Key"
          :type="showApiKey ? 'text' : 'password'"
        />
        <button type="button" class="toggle-btn" @click="showApiKey = !showApiKey">
          {{ showApiKey ? 'Hide' : 'Show' }}
        </button>
      </div>
    </label>
    <p v-if="errors.apiKey" class="field-error">{{ errors.apiKey }}</p>

    <label>
      <span>Timeout (ms)</span>
      <input v-model.number="form.timeoutMs" aria-label="Timeout (ms)" type="number" min="1000" step="1000" />
    </label>

    <button type="button" :disabled="props.loading" @click="onSubmit">
      {{ props.loading ? 'Detecting…' : 'Detect' }}
    </button>
  </section>
</template>

<style scoped>
.detect-form {
  display: grid;
  gap: 12px;
}

label {
  display: grid;
  gap: 6px;
}

input,
.smart-textarea {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-family: inherit;
  font-size: inherit;
}

.smart-textarea {
  resize: vertical;
}

.smart-input-group {
  display: grid;
  gap: 8px;
}

.parse-btn {
  width: fit-content;
  padding: 8px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.parse-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.key-input-group {
  display: flex;
  gap: 8px;
}

.key-input-group input {
  flex: 1;
  min-width: 0;
}

.toggle-btn {
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
}

button:not(.parse-btn):not(.toggle-btn) {
  width: fit-content;
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: var(--accent-color);
  color: #fff;
  cursor: pointer;
}

button:not(.parse-btn):not(.toggle-btn):disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.field-error {
  margin: 0;
  color: #c0392b;
  font-size: 14px;
}
</style>
