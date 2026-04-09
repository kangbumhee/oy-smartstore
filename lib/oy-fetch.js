const OY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  Referer: 'https://www.oliveyoung.co.kr/',
  'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

async function oyFetch(url, options = {}) {
  const headers = { ...OY_HEADERS, ...(options.headers || {}) };
  return fetch(url, { ...options, headers, signal: options.signal || AbortSignal.timeout(20000) });
}

async function oyFetchWithRetry(url, options = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await oyFetch(url, options);
      if (r.ok || r.status !== 403 || i === retries) return r;
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
    } catch (e) {
      if (i === retries) throw e;
    }
  }
}

module.exports = { oyFetch, oyFetchWithRetry, OY_HEADERS };
