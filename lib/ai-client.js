const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_TIMEOUT_MS = 90000;

function resolveAIConfig(req) {
  const hKey = (req.headers['x-google-api-key'] || '').trim();
  const hBaseUrl = (req.headers['x-ai-base-url'] || '').trim();
  const hModel = (req.headers['x-ai-model'] || '').trim();
  const envKey = (process.env.GOOGLE_API_KEY || '').trim();
  const envModel = (process.env.GEMINI_MODEL || 'claude-sonnet-4-6').trim();
  return {
    apiKey: hKey || envKey,
    baseUrl: hBaseUrl || '',
    model: hModel || envModel,
  };
}

async function generateContent(config, prompt, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { apiKey, baseUrl, model } = config;
  if (!apiKey) throw new Error('AI API Key가 설정되지 않았습니다.');

  const work = baseUrl
    ? callOpenAICompatible(baseUrl, apiKey, model, prompt, timeoutMs)
    : callGoogleSDK(apiKey, model, prompt);

  return Promise.race([
    work,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`AI 응답 시간 초과 (${Math.round(timeoutMs / 1000)}초). 서버 상태를 확인하세요.`)),
        timeoutMs
      )
    ),
  ]);
}

async function callOpenAICompatible(baseUrl, apiKey, model, prompt, timeoutMs = 90000) {
  const base = baseUrl.replace(/\/+$/, '');
  const url = `${base}/chat/completions`;

  console.log(`[AI] ${model} → ${url} (timeout ${timeoutMs}ms)`);

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

  const abortMs = Math.max(timeoutMs - 5000, 30000);
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(abortMs);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error(`AI 응답 시간 초과 (${Math.round(abortMs / 1000)}초). 모델: ${model}`);
    }
    throw new Error(`AI 연결 실패: ${e.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI API ${res.status}: ${text.substring(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('AI 응답이 비어있습니다. 모델: ' + model);
  return text;
}

async function callGoogleSDK(apiKey, model, prompt) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model });
  const result = await m.generateContent(prompt);
  return result.response.text().trim();
}

module.exports = { resolveAIConfig, generateContent };
