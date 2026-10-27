# 전달 JSON 형식 v1

format은 `celdyque.tiktok-morning.transfer`, schema_version은 1, collection_contract_version은 4입니다. 보고서 입력을 새 CSV나 사람이 쓰는 텍스트로 변환하지 않고 기존 JSON을 감쌉니다.

| 필드 | 내용 |
| --- | --- |
| format, schema_version, collection_contract_version | 전달 형식과 수집 계약 버전 |
| producer | 생성 패키지와 버전 |
| report_date, run_id | 발행일 KST와 실행 UUID |
| config | 동일 계정과 상품을 검증할 식별자 설정. 로그인 정보 없음 |
| manifest | 기존 buildPlan(config, date, 4) 결과와 run_id/started_at |
| input | 기존 observations.json의 루트 정보·23개 observations와 원래 completed_at |
| validation | 기존 validateRun이 산정한 status, values, issues. 증감은 계산하지 않음 |
| attachments | 해당 실행의 evidence 폴더에 명시적으로 놓은 필수 증거. base64 원문과 파일별 SHA256 포함 |
| integrity | integrity 필드를 제외한 JSON의 기존 hash() 기준 SHA256 |

input 안의 항목 이름·필드 의미와 검증 규칙은 기존 수집기와 같습니다. 성공 숫자만 추린 JSON이 아니라 실패 항목까지 23개를 모두 포함합니다. 키가 없거나 범위를 늘리면 패키지 종료를 거부합니다. 수집 실패와 항목 검증 실패는 validation.issues에서 구분합니다.

## 원래 서버에서 처리할 때

1. 전달 형식·실행 ID·무결성과 승인된 서버 설정을 확인합니다. checksum은 전송 중 변경 검출용이며 수집자 신원 서명이나 실제 화면의 진위 보증은 아닙니다.
2. manifest를 같은 v4 buildPlan으로 확인합니다. bundle.input을 원래 completed_at 그대로 validateRun에 전달합니다. 업로드 시각으로 바꾸지 않습니다.
3. bundle.validation을 믿고 채택하지 말고 서버에서 재검증합니다. 이 패키지의 verify도 그 과정을 수행합니다.
4. 원래 서버의 직전 날짜 원장으로 withDeltas를 적용하고 render로 Markdown을 생성합니다. 검증된 원장과 보고서를 기존 게시 경로로 반영합니다.

원래 서버에 오늘 run 폴더가 없다는 이유로 현재 시각으로 새 begin을 만들거나 finish를 그대로 호출하지 않습니다. 이메일로 받은 파일의 원래 실행·수집 시각을 보존하는 가져오기 절차가 필요합니다. 서버가 파일을 받은 시각은 별도로 남깁니다.

전일 원장이 없어도 현재 보고서를 만들 수 있지만 증감은 비교 기준 없음입니다. 과거 차트나 메모는 이 JSON 하나에서 새로 생기지 않습니다. 이번 패키지는 수집과 JSON 출력까지만 구현하며 원래 서버와 사이트에 자동으로 쓰지 않습니다.

## 추가 증거

observation.evidence와 checks/pages가 기본 검증 증거입니다. 필수 스크린샷 등도 한 파일로 전달하려면 `.local/runs/<run_id>/evidence/` 아래에 개인정보를 제거한 txt/json/png/jpg/jpeg/webp만 놓습니다. 전체 raw나 임의 폴더를 자동 포함하지 않습니다. 심볼릭 링크와 상위 경로, 실행 파일은 허용하지 않으며 파일 내용 합계 상한은 12 MiB입니다.

수집자의 새 화면 확인을 꾸며내거나, 모든 checks를 미리 true로 채워 넣지 않습니다. 증거가 부족하면 기존 검증기가 실패로 남깁니다. 키·값·필터·상품 ID를 사람이 임의로 작성하는 별도 입력 모드는 없습니다.
