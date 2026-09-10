# Host-M 鈥?Boss 澶栧洿鎴愮啛搴﹀眰锛?-10-M 鍒嗘敮锛?
浠诲姟涔︼細`Update-Plan/Host-M-9-10.md`
鐘舵€侊細**READY_FOR_INTEGRATION**锛堢郴缁熺骇鏈€缁堥獙鏀跺睘浜庡悗缁粺涓€ integration 闃舵锛?
## 杩欎竴杞仛浜嗕粈涔?
Host-M 娌℃湁鏀瑰姩 Boss 鐨勬牳蹇冮鏋躲€傚畠鎶?Boss 鍛ㄥ洿鐨?*娴嬭瘯銆佽瘖鏂€佽娴嬨€佽瘉鎹€侀暱鏃惰繍琛屽拰闆嗘垚鎴愮啛搴?*鍋氬帤锛氫竷涓兘鍔涳紝鍏ㄩ儴鏄澹虫ā鍧楋紝鍙互鏁翠綋鍒犻櫎鑰?Boss 鍘熺郴缁熶笉鍙楀奖鍝嶃€?
| 浼樺厛绾?| 鑳藉姏 | 鍏ュ彛 | 鍏抽敭鎶€鏈偣 |
|---|---|---|---|
| P1 | System Acceptance Hub | `node scripts/host-acceptance.cjs` | 涓€鏉″懡浠ょ紪鎺掑叏閮ㄦ棦鏈夐獙鏀堕潰锛涗簲妗ｇ姸鎬侊紱鍙湁 overall PASS 鎵?exit 0 |
| P2 | Failure Injection Lab | `node scripts/host-fault-lab.cjs` | 13 绫绘晠闅滐紝姣忕被蹇呴』閫氳繃 inject / observe / contain 涓夊叧 |
| P3 | Long-run / Soak Harness | `node scripts/host-soak.cjs --tier 30m` | 鐪熷疄璐熻浇 + 鐪熷疄璧勬簮閲囨牱 + 11 鏉′笉鍙橀噺锛涗吉閫?PASS 涓嶅彲鑳?|
| P4 | Unified Observability | `node scripts/host-observe.cjs` | 鍙鑱氬悎鍏釜鍩燂紱瑙傚療鑰呬笉浼氬彉鎴愭帶鍒惰€?|
| P5 | Evidence Inspector | `node scripts/host-evidence.cjs` | sha256 娓呭崟 + 鏉ユ簮杩借釜 + 瀛ゅ効/鎮┖寮曠敤妫€娴嬶紱鏃犲啓鍏ヨ矾寰?|
| P6 | Regression Sentinel | `node scripts/host-regression.cjs` | 涔濅釜缁村害 baseline鈫抍andidate锛涘彧鎶ュ憡锛屼笉鏀圭敓浜т唬鐮?|
| P7 | Boss Doctor | `node scripts/host-doctor.cjs` | 25 涓晠闅滈殧绂绘帰閽堬紱鍖荤敓澶辫触涓嶅奖鍝?Boss 鍚姩 |

## 涓夋潯璐┛鎬ц璁″師鍒?
**1. 缂哄け涓嶇瓑浜庨€氳繃銆?* 姣忎釜宸ュ叿閮戒細鎶?娴嬩笉鍒?鍜?娴嬪埌浜嗕笖鍋ュ悍"鍒嗗紑鎶ュ憡锛?
- Hub锛歚SKIPPED_WITH_REASON`锛堜富鍔ㄩ€夋嫨锛変笌 `BLOCKED_EXTERNAL`锛堢己鍓嶇疆鏉′欢锛夋槸涓ょ浜嬪疄锛屼粠涓嶆贩涓轰竴璋堬紝涔熼兘涓嶆槸 PASS銆?- Soak锛氫竴涓淮搴︽棤娉曟祴閲忔椂鏄笉鍙橀噺 `UNAVAILABLE`锛屼笉鏄?PASS銆?- Observer锛歴tore 涓嶅瓨鍦ㄦ椂璇ョ淮搴︽槸 `UNAVAILABLE`锛屼笉鏄?鍋ュ悍鐨?0"銆?- Doctor锛氭棤娉曡瘎浼扮殑鎺㈤拡鏄?`SKIPPED` 骞剁粰鍑哄師鍥狅紝鏃笉闈欓粯 READY 涔熶笉闃诲 FAIL銆?- Sentinel锛氬彧鏈変竴渚ф祴杩囩殑缁村害鏄?`UNAVAILABLE`锛屼笉鏄?娌″彉鍖?銆?
**2. 鍙湁鐪熸瑙傚療鍒扮殑鎵嶇畻璇佹嵁銆?* Soak 鐨?PASS 闇€瑕?璺戞弧璇ユ。浣嶆椂闀?**涓?* 鍏ㄩ儴涓嶅彉閲忔垚绔?锛汧ault Lab 鐨勪竴涓晠闅滃彧鏈夊湪娉ㄥ叆纭疄鐢熸晥銆佺郴缁熺‘瀹炲療瑙夈€佺郴缁熺‘瀹炰粛鍙敤鏃舵墠绠楀共鍑€锛汬ub 鐨?`resultFromOutcome` 閲岃秴鏃跺拰鍚姩澶辫触姘歌繙涓嶆槸 PASS銆?
**3. 鍙灏辨槸鍙銆?* Observer 鍒绘剰涓嶆瀯閫?`StateStore`锛堝叾鏋勯€犲嚱鏁颁細鎸佷箙鍖栧惎鍔ㄤ細璇濓紝浼氭妸姝ｅ湪璇荤殑鏂囦欢閲嶅啓锛夛紱Evidence Inspector 娌℃湁浠讳綍鍐欏叆璺緞锛屼笉淇銆佷笉閲嶅懡鍚嶃€佷笉鍒犻櫎锛汥octor 鍙線绯荤粺涓存椂鐩綍鍐欐帰閽堟枃浠跺苟绔嬪嵆鍒犻櫎锛汼entinel 娌℃湁浠讳綍"鑷姩搴旂敤鏀瑰姩"鐨勫紑鍏炽€?
## 鏁版嵁甯冨眬

Host-M 鑷韩涓嶅紩鍏ヤ换浣曟柊鐨勭郴缁熺骇 source of truth锛?
- 杩愯浜х墿锛歚artifacts/host-acceptance/`銆乣artifacts/host-sentinel/`銆乣artifacts/host-evidence/`銆乣artifacts/host-soak/`锛堝潎琚?`.gitignore` 瑕嗙洊锛?- 鎻愪氦鐨勮瘉鎹細`Update-Plan/Host-M/evidence/<Phase>/`
- P6 鍩虹嚎锛歚Update-Plan/Host-M/evidence/baseline/sentinel-baseline.json`
- 鐗规€у紑鍏筹細`src/shared/host-maturity-flags.ts`锛堢嫭绔嬩簬 Engine 鐨?`adaptive-flags`锛岄粯璁ゅ叏 OFF锛宖ail-closed锛?
## 鍙垹闄ゆ€?
鍒犻櫎浠ヤ笅鍐呭鍚?Boss 鍘熺郴缁熶粛鐒舵甯歌繍琛岋紙娌℃湁浠讳綍鐢熶骇璺緞渚濊禆瀹冧滑锛夛細

```
src/shared/acceptance-hub.ts      src/shared/acceptance-record.ts
src/shared/fault-lab.ts           src/shared/soak-harness.ts
src/shared/host-observer.ts       src/shared/host-maturity-flags.ts
src/shared/evidence-inspector.ts  src/shared/regression-sentinel.ts
src/shared/doctor.ts
electron/host/**
scripts/host-*.cjs
tests/unit/host-*.test.ts
Update-Plan/Host-M/**
```

Host-M 娌℃湁淇敼鍐荤粨鍖虹殑浠讳綍鍗忚銆乻chema 鎴栨寔涔呭寲鏍煎紡锛沗electron/main.ts`銆乣electron/preload.ts`銆乣src/shared/contracts.ts` 鍧囨湭鏀瑰姩锛圖octor 鍙槸**璇诲彇**瀹冧滑鏉ラ獙璇?IPC 闈級銆?
## 闂ㄧ

```
npx tsc --noEmit -p tsconfig.json            PASS
npx tsc --noEmit -p tsconfig.electron.json   PASS
npx vitest run                               72 files / 614 tests PASS锛堝熀绾?65 / 428锛?node scripts/host-acceptance.cjs             瑙?evidence/P1/
node scripts/host-fault-lab.cjs              PASS: 9 CONTAINED, 4 ACCEPTED_DEGRADATION of 13
node scripts/host-soak.cjs --tier 30m        瑙?evidence/P3/
node scripts/host-evidence.cjs               Host-M 鑼冨洿鍐?0 issue
node scripts/host-regression.cjs             PASS: 0 regression, 0 drift
node scripts/host-doctor.cjs                 READY: 15 READY, 0 DEGRADED, 0 FAIL, 10 SKIPPED
```

## 宸茬煡杈圭晫锛堝瀹炶褰曪紝涓嶇矇楗帮級

- **闀挎椂杩愯鍙窇鍒?30 鍒嗛挓妗ｃ€?* 2h / 8h / overnight 妗ｄ綅宸插疄鐜板苟鍙敤锛屼絾鏈湪鏈疆鎵ц锛涙寜浠诲姟涔﹁姹傦紝鏈墽琛岀殑妗ｄ綅鎶?`BLOCKED_EXTERNAL` 鎴栨爣娉ㄦ湭鎵ц锛屼笉浼€?PASS銆?- **Soak harness 杩愯鍦?node 涓嬶紝涓嶉┍鍔ㄦ祻瑙堝櫒銆?* renderer health 鍥犳鍦ㄦ姤鍛婇噷鏄?`UNAVAILABLE` 骞剁粰鍑哄師鍥狅紱checkpoint/degradation/continuation 娉ㄥ叆鐢?closure soak 涓?P2 fault lab 瑕嗙洊锛屽悓鏍峰湪鎶ュ憡閲岃鏄庛€?- **codex CLI 涓嶅湪 PATH 涓娿€?* 鍥涗釜 CLI 杞﹂亾鐨勯獙鏀舵鏌ュ洜姝ゆ姤 `BLOCKED_EXTERNAL`锛?an external CLI/agent binary is required; no codex CLI on PATH"锛夛紝涓嶆槸 FAIL銆?- **P5 鍙戠幇鐨勬棦鏈夐棶棰樻湭淇**锛?4 涓瘉鎹枃浠跺甫 UTF-8 BOM銆? 涓枃浠?JSON 鐪熷疄鎹熷潖銆?3 鏉＄湡瀹炴偓绌哄紩鐢紙43 鏉℃寚鍚?seeded 楠屾敹鍦ㄥ厠闅嗛噷鎵嶅垱寤虹殑鏂囦欢锛夈€侷nspector 鍙姤鍛婏紝涓嶄慨鏀广€?- **P6 benchmark 缁村害鍦ㄦ湰鏈轰负 `UNAVAILABLE`**锛屽洜涓?`artifacts/benchmark.json` 涓嶅瓨鍦紱P1 鐨?`tenx:benchmark` 妫€鏌ュ彲浠ョ敓鎴愬畠銆?