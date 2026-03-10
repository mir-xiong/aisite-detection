<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DetectResponse, ProviderDetectionResult, ProviderKind } from '../../shared/detection'
import { detectSite, detectOne } from './api/detection'
import DetectForm from './components/DetectForm.vue'
import ProviderCard from './components/ProviderCard.vue'
import RequestTraceDrawer from './components/RequestTraceDrawer.vue'
import ResultSummary from './components/ResultSummary.vue'

const title = 'AI Site Detection'
const loading = ref(false)
const error = ref('')
const result = ref<DetectResponse | null>(null)
const activeTrace = ref<ProviderDetectionResult | null>(null)
const redetectingProvider = ref<ProviderKind | null>(null)
const formRef = ref<InstanceType<typeof DetectForm> | null>(null)

const providerResults = computed(() => result.value?.results ?? [])
const hasAnySupport = computed(() => providerResults.value.some((item) => item.supported))

async function handleSubmit(payload: { baseUrl: string; apiKey: string; timeoutMs?: number }) {
  loading.value = true
  error.value = ''

  try {
    result.value = await detectSite(payload)
  } catch (submitError) {
    result.value = null
    error.value = submitError instanceof Error ? submitError.message : 'Detection failed'
  } finally {
    loading.value = false
  }
}

function openTrace(resultItem: ProviderDetectionResult) {
  activeTrace.value = resultItem
}

function closeTrace() {
  activeTrace.value = null
}

async function handleRedetect(provider: ProviderKind) {
  if (!formRef.value || !result.value) return

  const formValues = formRef.value.getFormValues()
  if (!formValues.baseUrl || !formValues.apiKey) {
    error.value = 'Base URL and API key are required'
    return
  }

  redetectingProvider.value = provider

  try {
    const updatedResult = await detectOne({
      baseUrl: formValues.baseUrl,
      apiKey: formValues.apiKey,
      provider,
      timeoutMs: formValues.timeoutMs,
    })

    const idx = result.value.results.findIndex((r) => r.provider === provider)
    if (idx !== -1) {
      result.value.results[idx] = updatedResult
    }
  } catch (redetectError) {
    error.value = redetectError instanceof Error ? redetectError.message : 'Re-detection failed'
  } finally {
    redetectingProvider.value = null
  }
}
</script>

<template>
  <main class="app-shell">
    <section class="hero-card">
      <h1>{{ title }}</h1>
      <p>Check whether a gateway supports OpenAI, Anthropic, or Gemini-compatible APIs.</p>
    </section>

    <section class="panel-card">
      <DetectForm ref="formRef" :loading="loading" @submit="handleSubmit" />
    </section>

    <section v-if="loading" class="panel-card state-card">
      <p>Running provider checks…</p>
    </section>

    <section v-else-if="error" class="panel-card error-card">
      <p>{{ error }}</p>
    </section>

    <template v-else-if="result">
      <section class="panel-card">
        <ResultSummary :result="result" />
      </section>

      <section v-if="!hasAnySupport" class="panel-card state-card">
        <p>No compatible provider was detected. Review the provider cards for details.</p>
      </section>

      <section class="provider-grid">
        <ProviderCard
          v-for="item in providerResults"
          :key="item.provider"
          :result="item"
          :redetecting="redetectingProvider === item.provider"
          @show-trace="openTrace"
          @redetect="handleRedetect"
        />
      </section>
    </template>

    <section v-else class="panel-card state-card">
      <p>Enter a base URL and API key to begin detection.</p>
    </section>

    <RequestTraceDrawer :open="Boolean(activeTrace)" :result="activeTrace" @close="closeTrace" />
  </main>
</template>

<style scoped>
.app-shell {
  max-width: 880px;
  margin: 0 auto;
  padding: 32px 16px 48px;
}

.hero-card,
.panel-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.hero-card {
  margin-bottom: 20px;
}

.hero-card h1 {
  margin: 0 0 8px;
}

.hero-card p,
.state-card p,
.error-card p {
  margin: 0;
  color: var(--text-secondary);
}

.panel-card + .panel-card {
  margin-top: 16px;
}

.error-card p {
  color: #c0392b;
}

.provider-grid {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

@media (min-width: 720px) {
  .provider-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
