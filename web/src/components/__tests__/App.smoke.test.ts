import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App.vue'

vi.mock('../../api/detection', () => ({
  detectSite: vi.fn().mockResolvedValue({
    ok: true,
    normalizedBaseUrl: 'https://example.com',
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1000).toISOString(),
    results: [],
  }),
}))

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('App smoke', () => {
  it('renders the title and form fields', () => {
    render(App)

    expect(screen.getByText('AI Site Detection')).toBeTruthy()
    expect(screen.getByLabelText('Base URL')).toBeTruthy()
    expect(screen.getByLabelText('API Key')).toBeTruthy()
  })

  it('shows validation feedback when submitting empty values', async () => {
    render(App)

    await fireEvent.click(screen.getByRole('button', { name: 'Detect' }))

    expect(screen.getByText('Base URL is required')).toBeTruthy()
    expect(screen.getByText('API key is required')).toBeTruthy()
  })

  it('toggles loading state when submitting valid input', async () => {
    const pending = new Promise(() => undefined)
    const { detectSite } = await import('../../api/detection')
    vi.mocked(detectSite).mockReturnValueOnce(pending as never)

    render(App)

    await fireEvent.update(screen.getByLabelText('Base URL'), 'https://example.com')
    await fireEvent.update(screen.getByLabelText('API Key'), 'sk-test')
    await fireEvent.click(screen.getByRole('button', { name: 'Detect' }))

    expect(screen.getByRole('button', { name: 'Detecting…' })).toBeTruthy()
  })
})
