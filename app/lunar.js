/* ════════════════════════════════════════════════════════════════
   음력 ↔ 양력 변환 (한국/중국 음력, 1900–2100)
   - 데이터·알고리즘 이식: solarlunar (MIT) — lunarInfo 윤/대소월 비트표
   - 검증: 설날 2023~2026, 추석 2024, 음10/19 각 연도 양력 (2026-11-27 등)
   - 용도: 음력 생일/기념일을 매년 정확한 양력으로 표시 (일정·캘린더)
   진입점: window.LunarKR = { lunarToSolar, lunarBirthdayInSolarYear, ... }
════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  // 农历 1900-2100 윤/대소월 정보표 (each: bit15..4 = 1~12월 대소, bit16 = 윤월 대소, bit3..0 = 윤월 번호)
  var lunarInfo = [
    0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2, // 1900
    0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977, // 1910
    0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970, // 1920
    0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950, // 1930
    0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557, // 1940
    0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0, // 1950
    0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0, // 1960
    0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6, // 1970
    0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570, // 1980
    0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0, // 1990
    0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5, // 2000
    0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930, // 2010
    0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530, // 2020
    0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45, // 2030
    0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0, // 2040
    0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0, // 2050
    0x092e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4, // 2060
    0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0, // 2070
    0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160, // 2080
    0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a4d0,0x0d150,0x0f252, // 2090
    0x0d520 // 2100
  ];

  function info(y) { return lunarInfo[y - 1900]; }
  function leapMonth(y) { return info(y) & 0xf; }                         // 윤월 번호 (0 = 없음)
  function leapDays(y) { return leapMonth(y) ? ((info(y) & 0x10000) ? 30 : 29) : 0; }
  function monthDays(y, m) { return (info(y) & (0x10000 >> m)) ? 30 : 29; } // 평월 m 의 일수
  function lYearDays(y) { var s = 348, v = info(y); for (var i = 0x8000; i > 0x8; i >>= 1) s += (v & i) ? 1 : 0; return s + leapDays(y); }

  // 음력(y,m,d [,윤달]) → 양력 {year,month,day} | null
  function lunarToSolar(y, m, d, isLeap) {
    y = +y; m = +m; d = +d; isLeap = !!isLeap;
    if (isNaN(y) || isNaN(m) || isNaN(d) || y < 1900 || y > 2100 || m < 1 || m > 12) return null;
    var lm = leapMonth(y);
    if (isLeap && lm !== m) isLeap = false;                 // 그 해 해당월이 윤달이 아니면 평달로 취급
    var offset = 0, i;
    for (i = 1900; i < y; i++) offset += lYearDays(i);
    var isAdd = false;
    for (i = 1; i < m; i++) {
      if (!isAdd && lm > 0 && lm <= i) { offset += leapDays(y); isAdd = true; }  // 지나온 윤월 보정
      offset += monthDays(y, i);
    }
    if (isLeap) offset += monthDays(y, m);                  // 윤달 대상이면 해당 평월만큼 추가
    var stmap = Date.UTC(1900, 1, 30);                      // 기준: 음력 1900-01-01 = 양력 1900-01-31
    var cal = new Date((offset + d - 31) * 86400000 + stmap);
    return { year: cal.getUTCFullYear(), month: cal.getUTCMonth() + 1, day: cal.getUTCDate() };
  }

  // 반복 기념일: 음력 (월,일) 이 지정 양력연도(solarYear)에 떨어지는 양력일 — 매년 달라짐
  //   음력 11~12월 생일은 양력으로 이듬해 1~2월이 될 수 있어, 후보 연도(sy-1,sy,sy+1) 중
  //   양력연도 == sy 인 것을 고른다.
  function lunarBirthdayInSolarYear(lm, ld, solarYear) {
    lm = +lm; ld = +ld; solarYear = +solarYear;
    var cands = [solarYear, solarYear - 1, solarYear + 1];
    for (var k = 0; k < cands.length; k++) {
      var ly = cands[k];
      if (ly < 1900 || ly > 2100) continue;
      var d2 = Math.min(ld, monthDays(ly, lm));            // 그 해 해당월이 29일이면 30 → 29 로 보정
      var s = lunarToSolar(ly, lm, d2, false);
      if (s && s.year === solarYear) return s;
    }
    return null;
  }

  // 'YYYY-MM-DD' 편의 반환
  function pad(n) { return String(n).padStart(2, '0'); }
  function lunarToSolarStr(y, m, d, isLeap) { var s = lunarToSolar(y, m, d, isLeap); return s ? (s.year + '-' + pad(s.month) + '-' + pad(s.day)) : null; }
  function lunarBirthdayStr(lm, ld, solarYear) { var s = lunarBirthdayInSolarYear(lm, ld, solarYear); return s ? (s.year + '-' + pad(s.month) + '-' + pad(s.day)) : null; }

  window.LunarKR = {
    lunarToSolar: lunarToSolar,
    lunarToSolarStr: lunarToSolarStr,
    lunarBirthdayInSolarYear: lunarBirthdayInSolarYear,
    lunarBirthdayStr: lunarBirthdayStr,
    leapMonth: leapMonth, leapDays: leapDays, monthDays: monthDays, lYearDays: lYearDays,
  };
})();
