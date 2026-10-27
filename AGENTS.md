# CELDYQUE Windows 수집기

이 저장소는 CELDYQUE TikTok 아침 보고서 v4의 **23개 자동 지표를 수집하여 JSON 하나를 만드는 독립 패키지**다. 실제 Windows/Chrome 수집 전 `.agents/skills/tiktok-morning-collector/SKILL.md`와 그 수집·CAPTCHA 참조를 읽는다.

- 저장소가 놓인 폴더를 작업 루트로 사용한다. 기존 `DEV_CELDYQUE`나 다른 사람의 절대 경로를 사용하지 않는다.
- Chrome 조작은 현재 Codex에서 지원하는 computer-use/browser 도구와 설치된 해당 스킬을 사용한다. 로그인 상태와 브라우저 연결은 이 PC에서 직접 확인한다. 명령줄만으로 Chrome 수집이 실행되는 구조는 아니다.
- 기존 검증 규칙과 23개 지표를 유지한다. GMV MAX, VOC, EUKA, 고객 메시지를 수집하거나 해당 제외 페이지를 열지 않는다. 사람이 작성하는 숫자·CSV·텍스트 입력은 이번 범위에 없다.
- 과거 실행의 값을 새 값으로 재사용하지 않는다. 실패 항목을 삭제하거나 0으로 채우지 않는다.
- 종료는 `npm.cmd run finish -- --run <run_id>`로 한다. 성공·미완성 모두 `outputs/YYYY-MM-DD-<run_id>.json`을 만든다. 이미 종료한 실행은 변경하지 않고 새 run을 시작한다.
- outputs JSON, .local 실행 기록, 로그인 정보와 증거를 Git에 올리지 않는다. 비밀번호·쿠키·토큰·고객 메시지를 파일에 기록하지 않는다.
- 사이트 업로드, 이메일 발송, 서버 반영, 예약 생성, 샘플 승인·거절, 광고나 계정 설정 변경은 하지 않는다. 사용자가 결과 JSON을 직접 전달한다.
- 코드 수정 요청이 별도로 없으면 수집 중 소스·profiles·.local/config.json을 변경하지 않는다.
