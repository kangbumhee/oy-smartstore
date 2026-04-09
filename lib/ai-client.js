/**
 * Unified AI client: Google Generative AI SDK + OpenAI-compatible APIs.
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_TIMEOUT_MS = 55000;

function resolveAIConfig(req) {
  const hKey = (req.headers['x-google-api-key'] || '').trim();
  const hBaseUrl = (req.headers['x-ai-base-url'] || '').trim();
  const hModel = (req.headers['x-ai-model'] || '').trim();

  const envKey = (process.env.GOOGLE_API_KEY || '').trim();
  const envModel = (process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();

  return {
    apiKey: hKey || envKey,
    baseUrl: hBaseUrl || '',
    model: hModel || envModel,
  };
}

async function generateContent(config, prompt, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { apiKey, baseUrl, model } = config;
  if (!apiKey) throw new Error('AI API Key가 설정되지 않았습니다. 설정 페이지에서 입력하세요.');

  const work = baseUrl
    ? callOpenAICompatible(baseUrl, apiKey, model, prompt)
    : callGoogleSDK(apiKey, model, prompt);

  return Promise.race([
    work,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`AI 응답 시간 초과 (${Math.round(timeoutMs / 1000)}초)`)), timeoutMs)
    ),
  ]);
}

async function callOpenAICompatible(baseUrl, apiKey, model, prompt) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';

  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 8192,
    }),
  };

  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(50000);
  }

  const res = await fetch(url, init);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI API error ${res.status}: ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('AI 응답이 비어있습니다.');
  return text;
}

async function callGoogleSDK(apiKey, model, prompt) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model });
  const result = await m.generateContent(prompt);
  return result.response.text().trim();
}

module.exports = { resolveAIConfig, generateContent };
