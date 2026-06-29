/**
 * 전자결재 LINE 알림 — 결재 상신/차례/완료/반려 시 다음 결재자(또는 기안자)에게 push
 *
 *   POST /api/eapproval-notify
 *     body: {
 *       to:      '홍길동',          // 받는 사람 이름 (직원명) — lineMap 으로 userId 조회
 *       title:   '지출결의서',       // 문서 제목
 *       docId:   'Dxxxx',          // 딥링크용 문서 id
 *       kind:    'pay'|'leave'|...  // (선택) 배지용
 *       event:   'request'|'approved'|'rejected'|'done', // 알림 종류
 *       drafter: '김기사',          // (선택) 기안자명
 *     }
 *
 *   목적지 결정:
 *     1) eapproval_config.lineMap[to]  (직원명 → LINE userId)
 *     2) line_config.lineMap[to]
 *     3) line_config.alertRecipientId (fallback — 그룹/채널에 이름 멘션 포함)
 *
 *   딥링크: https://work.neoretail.net/m/eapproval/?doc=<docId>
 */

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const BASE_URL = 'https://work.neoretail.net';

const EVENT_LABEL = {
  request:  '📋 결재 요청',
  approved: '✅ 결재 승인',
  rejected: '⛔ 결재 반려',
  done:     '🎉 최종 승인 완료',
  exec:     '💸 자금 집행완료',
};

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return json({ ok: false, error: 'KV not bound' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const toName = String(body?.to || '').trim();
  const title = String(body?.title || '').trim() || '(제목 없음)';
  const docId = String(body?.docId || '').trim();
  const event = String(body?.event || 'request').trim();
  const drafter = String(body?.drafter || '').trim();
  if (!toName) return json({ ok: false, error: 'to_required' }, 400);

  const cfg = (await getJson(env, 'line_config', {})) || {};
  if (!cfg.channelAccessToken) {
    return json({ ok: false, error: 'no_channel_token' }, 200);
  }

  // lineMap 조회 — eapproval_config 우선, 없으면 line_config. toUserId 직접 지정 시 우선(테스트용)
  const eapCfg = (await getJson(env, 'eapproval_config', {})) || {};
  const lineMap = Object.assign({}, cfg.lineMap || {}, eapCfg.lineMap || {});
  const toUserId = String(body?.toUserId || '').trim();
  let to = toUserId || (lineMap[toName] || '').trim();
  let viaGroup = false;
  if (!to) { to = String(cfg.alertRecipientId || '').trim(); viaGroup = true; }
  if (!to) return json({ ok: false, error: 'no_recipient', detail: `${toName} 의 LINE userId 미등록 + alertRecipientId 없음` }, 200);

  const label = EVENT_LABEL[event] || EVENT_LABEL.request;
  const link = docId ? `${BASE_URL}/m/eapproval/?doc=${encodeURIComponent(docId)}` : `${BASE_URL}/m/eapproval/`;

  let line1;
  if (event === 'approved' || event === 'done' || event === 'exec' || event === 'rejected') {
    // 기안자에게 결과 통지
    line1 = `${label}\n\n"${title}"${drafter ? ` (기안: ${drafter})` : ''}`;
  } else {
    // 다음 결재자에게 요청
    line1 = `${label}\n\n${viaGroup ? `[${toName}님] ` : ''}"${title}" 결재를 요청합니다.${drafter ? `\n기안자: ${drafter}` : ''}`;
  }
  const text = `${line1}\n\n📱 결재하러 가기:\n${link}`;

  try {
    const r = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${cfg.channelAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    });
    if (!r.ok) {
      let detail = ''; try { detail = await r.text(); } catch (_) {}
      // 흔한 원인 힌트: 친구추가 안 됨(개인 푸시 불가)
      let hint = '';
      if (r.status === 403 || r.status === 400) {
        hint = '수신자가 공식계정을 "친구추가"하지 않았을 수 있습니다. 해당 직원이 봇을 1:1 친구추가해야 개인 알림이 전송됩니다.';
      }
      return json({ ok: false, status: r.status, error: 'line_api_failed', hint, detail: detail.slice(0, 300), viaGroup }, 200);
    }
    return json({ ok: true, sentTo: to.slice(0, 10) + '…', viaGroup }, 200);
  } catch (e) {
    return json({ ok: false, error: 'fetch_failed', detail: String(e) }, 200);
  }
}

async function getJson(env, key, fallback) {
  try {
    const v = await env.STORES_KV.get(key, 'json');
    return v == null ? fallback : v;
  } catch (_) { return fallback; }
}

function json(o, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}
