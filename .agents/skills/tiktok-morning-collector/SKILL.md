---
name: tiktok-morning-collector
description: Windows의 로그인된 Chrome에서 CELDYQUE TikTok 아침 지표 23개를 기존 v4 절차로 수집하고 전달용 JSON 하나를 outputs에 생성한다. 다른 PC의 일회성 수집과 재수집에 사용하며 웹 게시와 메일 발송은 포함하지 않는다.
---

# Windows에서 동일하게 수집하고 JSON으로 전달

저장소 루트에서 실행한다. 기존 운영 수집기의 `core.mjs`를 그대로 복사한 검증기가 수집 규칙의 기준이다. [수집 계약](references/collection.md)과 [CAPTCHA 대응](references/captcha-recovery.md)을 시작 전에 읽는다. JSON 필드와 전달 방식은 [관측값 작성](references/observations.md)을 따른다.

## 시작

1. 첫 실행이고 `.local/config.json`이 없으면 `npm.cmd run init`을 실행한다. `profiles/celdyque.json`은 계정·상품 식별자만 포함하며 로그인 상태가 아니다. 이미 설정이 있으면 초기화하거나 덮어쓰지 않는다.
2. `npm.cmd run doctor`를 실행한다. 설정 검증이 통과해야 한다.
3. 현재 Codex의 지원되는 computer-use/browser 도구로 연결된 Chrome을 확인한다. 설치된 computer-use 스킬과 실제 도구 문서를 읽고 따른다. Seller Center의 CELDYQUE 계정과 Affiliate Center의 shop_id를 새 화면에서 확인한다. 접속 URL에는 각각 `https://seller-global-us.tiktok.com/homepage`와 `https://affiliate-global.tiktok.com/affiliate/assets/creator-management?shop_id=8651858975596646872&shop_region=US`를 사용할 수 있다. 로그인은 사용자가 이 PC에서 수행하며 로그인 정보나 프로필을 내보내지 않는다.
4. `npm.cmd run begin`으로 새 실행을 시작한다. 출력된 manifest와 observations 경로를 읽고 정확히 23개·contract v4인지 확인한다. 보고 날짜는 실행일 KST다. 토·일요일도 동일하다.

## 수집

반환된 observations.json만 현재 화면의 새 값으로 채운다. 각 UI 동작은 현재 상태에서 도출하며, 이동·필터 변경·페이지 이동 뒤에는 새 상태로 다시 확인한다. 과거 숫자나 고정 좌표를 재사용하지 않는다. 두 시간 내 같은 KST 날짜에서 수집한다.

- Pending returns, 샘플 Open/Target 독립 전체 페이지, Awaiting reply 전체 페이지, Manage creators Total rows, 지정 상품별 값, SPS·AHR·공식 계정 CHR·Top Rated·랭킹을 [수집 계약](references/collection.md) 그대로 확인한다.
- 카퍼펩 Views는 Seller Center의 정확한 상품 ID 행에서, 공유와 전체 영상은 Affiliate Center의 같은 ID 행에서 수집한다. 나머지 네 상품도 같은 행의 공유와 Shop Ads 허용 영상만 수집한다.
- 샘플은 Open collaboration부터, 다시 Page 1에서 Target collaboration을 독립 수집한다. 각 페이지의 선택 전 0, 선택 가능 행 수, 헤더 선택 후 N selected 일치, 해제 후 0과 Next 상태를 기록한다. Approve/Reject는 누르지 않는다. 첫 빈 화면에서 0으로 확정하지 않는다.
- 랭킹이 비어 있으면 최대 30초 세 번 확인하고 한 번 새로고침한 뒤, 정규화 URL이 같은 연결된 기존 Chrome 탭도 모두 검사한다. 단일 탭에 완전한 행·필터·업데이트·방향이 함께 있어야 한다.
- 화면에서 못 얻은 값은 status=error와 구체적 이유를 남긴다. 값은 얻었지만 필수 증거가 부족하면 그 증거를 꾸며 true로 만들지 않는다. 검증기가 실패를 판정하게 한다.
- CAPTCHA는 매번 새 이미지에서 측정하고 `node scripts/measure-distance.mjs <measurement.json>`으로 후보만 계산한다. 제출 직전 현재 도구가 요구하는 확인을 받아야 하며 미응답이면 제출하지 않는다. 드래그와 상태 읽기를 순서대로 실행한다. 성공 후 계정·ID·필터를 다시 확인하고 새로 수집한다. 해결되지 않은 항목은 오류로 종료한다.

GMV MAX·VOC·EUKA 페이지와 고객 메시지는 열거나 수집하지 않는다. 수동 입력 영역, 예전 GMV/Creative/tROI 보완, 웹 서버나 SQLite는 이 패키지의 범위가 아니다.

## 증거와 종료

구조화된 증거는 observations 안에 기록한다. 한 파일로 보낼 추가 증거가 필요하면 반환된 `evidence_directory` 아래에 필요한 개인정보 없는 텍스트/JSON/이미지만 저장한다. 이 폴더만 JSON에 포함되며 전체 raw 디렉터리나 브라우저 상태는 자동으로 보내지 않는다. 첨부 합계는 12 MiB 이하로 유지한다. CAPTCHA 진단용 raw 체크포인트는 로컬에 보존할 수 있다.

수집을 마치거나 로그인·CAPTCHA 등으로 더 진행할 수 없으면 다음을 실행한다.

```powershell
npm.cmd run finish -- --run <run_id>
npm.cmd run verify -- "<finish가 반환한 JSON 절대 경로>"
```

종료 코드 0은 23개 모두 검증 통과, 2는 수집/검증 실패가 남았지만 전달용 JSON 생성 완료, 1은 형식·실행 오류로 정상 종료하지 못한 상태다. 미완성도 JSON을 생성하며 23개 항목과 실패 사유를 유지한다. 다른 사람의 과거 값으로 보완하지 않는다.

`outputs/YYYY-MM-DD-<run_id>.json`을 열어 run_id·날짜·23개 항목·검증 개수·원래 수집 완료 시각을 확인한다. 최종 응답에는 JSON의 클릭 가능한 절대 경로, 성공/실패 개수와 사유를 알린다. 운영 서버나 현재 웹에 반영됐다고 말하지 않는다. 메일이나 사이트로 자동 전송하지 않는다.
