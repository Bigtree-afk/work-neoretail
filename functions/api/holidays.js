/**
 * 공휴일 조회 — 연차 일수(근무일) 계산용
 *
 *   GET /api/holidays?year=2026  → { year, holidays:[ 'YYYY-MM-DD', ... ], source }
 *
 * 수집 방안:
 *   1) 내장 테이블(BUILTIN) — 2026 대한민국 공휴일·대체공휴일 (즉시 동작, 검증 권장)
 *   2) 공공데이터포털 "특일 정보" API (한국천문연구원) — line_config.holidayApiKey
 *      또는 env.HOLIDAY_API_KEY 설정 시 해당 연도 자동 수집 → KV 캐시(7일).
 *      신청: data.go.kr → "한국천문연구원_특일 정보" → 일반 인증키(Encoding) 발급.
 *   결과는 내장 + API 합집합. 키 없으면 내장만 반환.
 *
 * 캐시: KV 키 eap_holidays_<year> (7일 TTL).
 */

const BUILTIN = {
  '2026': [
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02',
    '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-06', '2026-08-15', '2026-08-17',
    '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', '2026-10-03', '2026-10-05',
    '2026-10-09', '2026-12-25',
  ],
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const year = (url.searchParams.get('year') || String(new Date().getFullYear())).slice(0, 4);
  const force = url.searchParams.get('refresh') === '1';
  const cacheKey = 'eap_holidays_' + year;

  if (env.STORES_KV && !force) {
    try {
      const cached = await env.STORES_KV.get(cacheKey, 'json');
      if (cached && Array.isArray(cached.holidays)) return json(cached);
    } catch (_) {}
  }

  let holidays = (BUILTIN[year] || []).slice();
  let source = 'builtin';
  const dbg = { keyFound: false, keySource: '', apiTried: false, apiStatus: 0, apiError: '', fetchedCount: 0, httpsTried: false };

  // 공공데이터포털 특일정보 API
  let key = env && env.HOLIDAY_API_KEY ? env.HOLIDAY_API_KEY : '';
  if (key) dbg.keySource = 'env';
  if (!key && env && env.STORES_KV) {
    try { const cfg = await env.STORES_KV.get('line_config', 'json'); if (cfg && cfg.holidayApiKey) { key = cfg.holidayApiKey; dbg.keySource = 'kv'; } } catch (_) {}
  }
  dbg.keyFound = !!key;
  dbg.attempts = [];
  if (key) {
    // serviceKey 를 인코딩본(Decoding키 대응) + 원본(Encoding키 대응) 둘 다 시도,
    // https/http 둘 다, User-Agent 포함 (data.go.kr 403 회피)
    const skVariants = [['enc', encodeURIComponent(key)], ['raw', key]];
    let done = false;
    for (const proto of ['https', 'http']) {
      for (const [skTag, sk] of skVariants) {
        if (done) break;
        dbg.apiTried = true; if (proto === 'https') dbg.httpsTried = true;
        const tag = proto + '/' + skTag;
        try {
          const api = proto + '://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
            + '?serviceKey=' + sk + '&solYear=' + year + '&numOfRows=100&_type=json';
          const r = await fetch(api, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; neoretail-eapproval/1.0)', 'Accept': 'application/json' } });
          dbg.apiStatus = r.status;
          const txt = await r.text();
          if (!r.ok) { dbg.attempts.push(tag + ':HTTP' + r.status); dbg.apiError = (txt || r.statusText || '').slice(0, 120); continue; }
          let j = null; try { j = JSON.parse(txt); } catch (_) { dbg.attempts.push(tag + ':nonjson'); dbg.apiError = txt.slice(0, 120); continue; }
          const header = j && j.response && j.response.header;
          if (header && header.resultCode && header.resultCode !== '00') { dbg.attempts.push(tag + ':rc' + header.resultCode); dbg.apiError = header.resultCode + ':' + (header.resultMsg || ''); continue; }
          const items = j && j.response && j.response.body && j.response.body.items && j.response.body.items.item;
          const arr = Array.isArray(items) ? items : (items ? [items] : []);
          const fetched = arr
            .filter(it => String(it.isHoliday || 'Y') === 'Y')
            .map(it => { const s = String(it.locdate); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); });
          dbg.fetchedCount = fetched.length;
          dbg.attempts.push(tag + ':ok' + fetched.length);
          if (fetched.length) { holidays = [...new Set([...holidays, ...fetched])].sort(); source = 'api+builtin'; done = true; }
        } catch (e) { dbg.attempts.push(tag + ':err'); dbg.apiError = String(e).slice(0, 120); }
      }
      if (done) break;
    }
  }

  const out = { year, holidays: [...new Set(holidays)].sort(), source };
  if (url.searchParams.get('debug') === '1') out.debug = dbg;
  // API 성공분만 장기 캐시(7일). builtin 폴백은 짧게(10분)만 캐시 → 키 설정 후 곧 자동 반영
  if (env.STORES_KV) {
    try { await env.STORES_KV.put(cacheKey, JSON.stringify({ year, holidays: out.holidays, source }), { expirationTtl: source === 'api+builtin' ? 60 * 60 * 24 * 7 : 600 }); } catch (_) {}
  }
  return json(out);
}

function json(o, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}
