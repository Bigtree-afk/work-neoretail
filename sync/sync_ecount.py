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
        raise SystemExit(f'❌ 환경변수 {key} 누락 — sync/.env 또는 시스템 환경변수에 설정하세요.')
    return val


def log(msg: str) -> None:
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


# ── 이카운트 API ──────────────────────────────────────

def get_zone(com_code: str) -> str:
    """회사 코드로 zone 조회. (V2 Zone API)"""
    log('zone 조회 중...')
    res = requests.post(
        'https://oapi.ecounterp.com/OAPI/V2/Zone/ZoneInfo',
        json={'COM_CODE': com_code},
        timeout=30,
    )
    res.raise_for_status()
    data = res.json()
    zone = (data.get('Data') or {}).get('ZONE') or ''
    if not zone:
        raise RuntimeError(f'zone 조회 실패: {data}')
    log(f'  → zone={zone}')
    return zone


def login(zone: str, com_code: str, user_id: str, api_cert_key: str) -> str:
    log('OAPI 로그인 중...')
    url = f'https://oapi{zone}.ecounterp.com/OAPI/V2/OAPILogin/Login'
    res = requests.post(
        url,
        json={
            'COM_CODE': com_code,
            'USER_ID': user_id,
            'API_CERT_KEY': api_cert_key,
            'LAN_TYPE': 'ko-KR',
            'ZONE': zone,
        },
        timeout=30,
    )
    res.raise_for_status()
    data = res.json()
    sid = ((data.get('Data') or {}).get('Datas') or {}).get('SESSION_ID')
    if not sid:
        raise RuntimeError(f'로그인 실패: {data}')
    log('  → 세션 발급 완료')
    return sid


def fetch_customers(zone: str, session_id: str) -> list[dict]:
    log('거래처(GetBasicCust) 조회 중...')
    url = f'https://oapi{zone}.ecounterp.com/OAPI/V2/AccountBasic/GetBasicCust'
    # SESSION_ID는 쿼리스트링으로
    res = requests.post(
        url,
        params={'SESSION_ID': session_id},
        json={'SEARCH_FLAG': '1'},  # 1: 전체. 변경분만 받으려면 LAST_UPD_DATE 사용
        timeout=120,
    )
    res.raise_for_status()
    payload = res.json()
    rows = ((payload.get('Data') or {}).get('Result')) or payload.get('Data') or []
    if isinstance(rows, dict):
        rows = rows.get('Result') or []
    log(f'  → {len(rows)}건 수신')
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
        log('⚠ 거래처 0건 — 푸시 생략 (안전장치).')
        return 0

    result = push_to_worker(stores, sync_url, sync_secret, source='ecount-oapi')
    log(f'✅ 완료: {result}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:
        log(f'❌ 오류: {e}')
        traceback.print_exc()
        sys.exit(1)
