import { expect, test } from 'vitest'
import { resolveProvider } from '../lib/provider'

const env = {
  AI_API_KEY: 'g-key',
  AI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  AI_MODEL_NAME: 'gemma-4-31b-it\r',
  OPENROUTER_API_KEY: 'sk-or-key',
  OPENROUTER_MODEL: 'stealth/union-alpha',
}

test('defaults to google, reading the AI_* vars', () => {
  expect(resolveProvider(env)).toEqual({
    name: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: 'g-key',
    model: 'gemma-4-31b-it',
  })
})

test('AI_PROVIDER=openrouter reads the OPENROUTER_* vars', () => {
  expect(resolveProvider({ ...env, AI_PROVIDER: 'OpenRouter ' })).toEqual({
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-or-key',
    model: 'stealth/union-alpha',
  })
})

test('AI_PROVIDER=explabs reads the EXPLABS_* vars and defaults base URL', () => {
  expect(resolveProvider({
    AI_PROVIDER: 'explabs',
    EXPLABS_API_KEY: 'ex-key',
    EXPLABS_MODEL: 'gpt-6-luna',
  })).toEqual({
    name: 'explabs',
    baseURL: 'https://api.experientiallabs.ai/v1',
    apiKey: 'ex-key',
    model: 'gpt-6-luna',
  })
})

test('AI_PROVIDER=explabs supports custom EXPLABS_BASE_URL', () => {
  expect(resolveProvider({
    AI_PROVIDER: 'explabs',
    EXPLABS_BASE_URL: 'https://custom.explabs.ai/v1/',
    EXPLABS_API_KEY: 'ex-key',
  })).toEqual({
    name: 'explabs',
    baseURL: 'https://custom.explabs.ai/v1',
    apiKey: 'ex-key',
    model: undefined,
  })
})

test('an unknown provider fails loudly', () => {
  expect(() => resolveProvider({ AI_PROVIDER: 'gemini' })).toThrow(/AI_PROVIDER must be "google", "openrouter", or "explabs"/)
})

test('no model set leaves the agent file in charge', () => {
  expect(resolveProvider({ AI_PROVIDER: 'openrouter' }).model).toBeUndefined()
  expect(resolveProvider({ AI_PROVIDER: 'explabs' }).model).toBeUndefined()
})
