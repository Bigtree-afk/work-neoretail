"""
이카운트 Open API → Cloudflare Worker(/api/sync) 거래처 동기화.

매일 KST 07:00 Windows 작업 스케줄러로 실행.
수기 실행: `python sync_ecount.py` 또는 `run_sync.bat`.

환경변수 (.env 또는 OS):
  ECOUNT_COM_CODE        회사 코드
  ECOUNT_USER_ID         API 사용자 ID
  ECOUNT_API_CERT_KEY    테스트/운영 인증키
  ECOUNT_ZONE            (선택) zone 코드 — 비우면 Zone API로 자동 조회
  SYNC_URL               기본 https://work.neoretail.net/api/sync
  SYNC_SECRET            Cloudflare Worker와 공유하는 시크릿
"""

from __future__ import annotations
import os
import sys
import json
import time
import traceback
from datetime import datetime
from pathlib import Path

# Windows cp949 콘솔에서도 UTF-8 출력
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import requests

# .env 자동 로드 (python-dotenv 없으면 수동 파싱)
ENV_PATH = Path(__file__).with_name('.env')
if ENV_PATH.exists():
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(ENV_PATH)
    except ImportError:
        for line in ENV_PATH.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())


def env(key: str, *, required: bool = True, default: str = '') -> str:
    val = os.environ.get(key, default).strip()
    if required and not val:
        raise SystemExit(f'[ERR] 환경변수 {key} 누락 - sync/.env 또는 시스템 환경변수에 설정하세요.')
    return val


def log(msg: str) -> None:
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    try:
        print(f'[{ts}] {msg}', flush=True)
    except UnicodeEncodeError:
        # 콘솔 인코딩 호환 안 되는 문자는 ASCII로 강제
        print(f'[{ts}] {msg.encode("ascii", "replace").decode("ascii")}', flush=True)


def post_json(url: str, *, params=None, body=None, timeout=30) -> dict:
    """POST + JSON 응답 파싱. 실패 시 응답 본문까지 출력."""
    log(f'POST {url}')
    if params: log(f'  params={params}')
    if body: log(f'  body={json.dumps(body, ensure_ascii=False)[:300]}')
    res = requests.post(url, params=params, json=body, timeout=timeout)
    log(f'  -> HTTP {res.status_code}')
    txt = res.text
    if len(txt) > 500:
        log(f'  resp(앞500): {txt[:500]}...')
    else:
        log(f'  resp: {txt}')
    if res.status_code != 200:
        raise RuntimeError(f'HTTP {res.status_code}: {txt[:300]}')
    try:
        return res.json()
    except Exception:
        raise RuntimeError(f'JSON 파싱 실패: {txt[:300]}')


# ── 이카운트 API ──────────────────────────────────────

# 시도해 볼 Zone API 엔드포인트 (이카운트가 종종 경로를 바꿈)
ZONE_ENDPOINTS = [
    'https://oapi.ecounterp.com/OAPI/V2/Zone/ZoneInfo',
    'https://oapi.ecounterp.com/OAPI/V2/Zone/GetZoneInfo',
    'https://oapi.ecounterp.com/OAPI/V2/Zone',
    'https://oapi.ecountapi.com/OAPI/V2/Zone',
]


def get_zone(com_code: str) -> str:
    """회사 코드로 zone 조회. 여러 후보 엔드포인트 시도."""
    last_err = None
    for url in ZONE_ENDPOINTS:
        try:
            log(f'zone 조회 시도 -> {url}')
            data = post_json(url, body={'COM_CODE': com_code})
            zone = ((data.get('Data') or {}).get('ZONE')
                    or (data.get('Data') or {}).get('Zone')
                    or data.get('ZONE') or '')
            if zone:
                log(f'  -> zone={zone}')
                return str(zone)
            log(f'  zone 응답에 ZONE 키 없음. 데이터: {data}')
        except Exception as e:
            last_err = e
            log(f'  실패: {e}')
    raise RuntimeError(f'모든 Zone 엔드포인트 실패. last={last_err}')


def zone_base_urls(zone: str):
    """Zone-prefixed 후보 base URL 목록 (404 회피용 자동 fallback)."""
    z = zone or ''
    return [
        f'https://oapi{z}.ecounterp.com',
        f'https://oapi{z.lower()}.ecounterp.com',
        f'https://oapi{z}.ecount.com',
        f'https://oapi{z.lower()}.ecount.com',
        f'https://sboapi{z}.ecounterp.com',
        f'https://sboapi{z.lower()}.ecounterp.com',
        f'https://sboapi{z}.ecount.com',
        f'https://sboapi{z.lower()}.ecount.com',
    ]


def call_with_fallback(zone: str, path: str, *, params=None, body=None, timeout=30) -> dict:
    """Zone subdomain 후보를 순차 시도. 200 응답이 나오면 반환."""
    last = None
    for base in zone_base_urls(zone):
        url = base + path
        log(f'시도 -> {url}')
        try:
            res = requests.post(url, params=params, json=body, timeout=timeout)
        except Exception as e:
            last = f'connection error: {e}'
            log(f'  실패: {last}')
            continue
        log(f'  HTTP {res.status_code}')
        if res.status_code == 200:
            txt = res.text
            log(f'  resp(앞300): {txt[:300]}')
            try:
                return res.json()
            except Exception as e:
                last = f'json parse: {e}'
                continue
        last = f'HTTP {res.status_code}: {res.text[:200]}'
    raise RuntimeError(f'모든 zone 호스트 실패. last={last}')


def call_paths_with_fallback(zone: str, paths, *, params=None, body=None, timeout=30) -> dict:
    """여러 경로 후보 × 여러 호스트 후보 조합으로 시도."""
    last = None
    for path in paths:
        try:
            return call_with_fallback(zone, path, params=params, body=body, timeout=timeout)
        except RuntimeError as e:
            last = e
            log(f'  경로 {path} 전체 실패, 다음 경로로...')
            continue
    raise RuntimeError(f'모든 경로 실패. last={last}')


def login(zone: str, com_code: str, user_id: str, api_cert_key: str) -> str:
    log('OAPI 로그인...')
    body = {
        'COM_CODE': com_code,
        'USER_ID': user_id,
        'API_CERT_KEY': api_cert_key,
        'LAN_TYPE': 'ko-KR',
        'ZONE': zone,
    }
    data = call_paths_with_fallback(
        zone,
        ['/OAPI/V2/OAPILogin', '/OAPI/V2/OAPILogin/Login', '/OAPI/V2/Login'],
        body=body,
    )
    sid = ((data.get('Data') or {}).get('Datas') or {}).get('SESSION_ID') \
        or (data.get('Data') or {}).get('SESSION_ID') \
        or data.get('SESSION_ID')
    if not sid:
        raise RuntimeError(f'로그인 실패: SESSION_ID 없음. data={data}')
    log(f'  -> 세션 발급 완료 (sid={str(sid)[:8]}...)')
    return sid


def fetch_customers(zone: str, session_id: str) -> list[dict]:
    log('거래처(GetBasicCust) 조회...')
    payload = call_paths_with_fallback(
        zone,
        ['/OAPI/V2/AccountBasic/GetBasicCust', '/OAPI/V2/GetBasicCust', '/OAPI/V2/AccountBasic'],
        params={'SESSION_ID': session_id},
        body={'SEARCH_FLAG': '1'},
        timeout=120,
    )
    rows = ((payload.get('Data') or {}).get('Result')) or payload.get('Data') or []
    if isinstance(rows, dict):
        rows = rows.get('Result') or []
    log(f'  -> {len(rows)}건 수신')
    return rows


# ── 매핑 ──────────────────────────────────────────────

def pick(d: dict, *keys: str, default: str = '') -> str:
    for k in keys:
        v = d.get(k)
        if v not in (None, ''):
            return str(v).strip()
    return default


def map_to_store(c: dict, idx: int) -> dict:
    """이카운트 응답 → 우리 점포 스키마 (ceo/tel/biz/addr/...)."""
    biz = pick(c, 'BUSINESS_NO', 'BIZ_NO', 'TAX_NO')
    code = pick(c, 'CUST_CD', 'CUST', 'CUST_CODE') or biz or f'EC-AUTO-{idx}'
    return {
        'id': f'EC-{code}',
        'code': code,
        'name': pick(c, 'CUST_DES', 'CUST_NAME', 'CUST_NM', default='-'),
        'ceo':  pick(c, 'BOSS_NAME', 'CEO_NAME', 'PRES_NAME'),
        'tel':  pick(c, 'TEL', 'PHONE', 'TEL_NUM'),
        'biz':  biz,
        'addr': pick(c, 'ADDR', 'ADDRESS', 'ADDR1'),
        'van':  '',
        'tid':  '',
        'pos':  '0',
        'memo': '이카운트 자동 동기화',
        'status': '거래중',
        'createdAt': int(time.time() * 1000),
    }


# ── Cloudflare Worker 푸시 ─────────────────────────────

def push_to_worker(stores: list[dict], sync_url: str, sync_secret: str, source: str) -> dict:
    log(f'Worker 푸시 중 ({len(stores)}건) → {sync_url}')
    res = requests.post(
        sync_url,
        headers={
            'authorization': f'Bearer {sync_secret}',
            'content-type': 'application/json',
        },
        json={'stores': stores, 'source': source},
        timeout=60,
    )
    if res.status_code != 200:
        raise RuntimeError(f'Worker {res.status_code}: {res.text}')
    return res.json()


# ── 메인 ───────────────────────────────────────────────

def main() -> int:
    com_code = env('ECOUNT_COM_CODE')
    user_id = env('ECOUNT_USER_ID')
    api_key = env('ECOUNT_API_CERT_KEY')
    zone_override = env('ECOUNT_ZONE', required=False)
    sync_url = env('SYNC_URL', required=False, default='https://work.neoretail.net/api/sync')
    sync_secret = env('SYNC_SECRET')

    log('=' * 50)
    log('이카운트 동기화 시작')

    zone = zone_override or get_zone(com_code)
    sid = login(zone, com_code, user_id, api_key)
    raw = fetch_customers(zone, sid)
    stores = [map_to_store(c, i) for i, c in enumerate(raw, 1)]

    # 빈 결과 보호
    if not stores:
        log('[WARN] 거래처 0건 - 푸시 생략 (안전장치).')
        return 0

    result = push_to_worker(stores, sync_url, sync_secret, source='ecount-oapi')
    log(f'[OK] 완료: {result}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:
        log(f'[ERR] 오류: {e}')
        traceback.print_exc()
        sys.exit(1)
