# CELDYQUE TikTok Windows 수집기

다른 Windows PC의 Codex가 현재 운영과 동일한 v4 **23개 지표**를 로그인된 Chrome에서 수집하여 **outputs에 JSON 한 파일**을 만듭니다. 이 파일을 받아 원래 서버에서 보고서를 생성하는 일회성 전달용 패키지입니다. 사이트 업로드, 메일 발송, 서버 배포와 예약 설치는 포함하지 않습니다.

## 다른 PC에서 시작

1. 이 비공개 저장소에 접근할 수 있는 GitHub 계정으로 저장소를 복제하거나 ZIP을 받아 압축을 풉니다. 설치 위치와 Windows 사용자 이름은 자유입니다.
2. Node.js 22.14 이상과 Codex를 준비합니다. 이 패키지는 외부 npm 의존성이 없어 npm install이 필요하지 않습니다.
3. 이 **폴더 자체를 Codex 프로젝트로 엽니다.** Chrome 브라우저 제어 기능이 연결되어 있어야 합니다. 컴퓨터마다 연결 상태를 확인해야 하며 저장소 복제는 로그인이나 브라우저 연결을 복제하지 않습니다.
4. Chrome에서 권한이 있는 CELDYQUE Seller Center와 Affiliate Center에 직접 로그인합니다.
5. Codex에 아래 문장을 보냅니다.

> AGENTS.md와 .agents/skills/tiktok-morning-collector/SKILL.md를 읽고 오늘 CELDYQUE 아침 지표 23개를 연결된 Chrome에서 전부 새로 수집해줘. 처음이면 init 후 doctor를 실행하고, 새 begin으로 수집한 뒤 finish와 verify를 실행해 outputs의 JSON 한 파일을 만들어줘. 실패도 그대로 기록하고 웹 업로드나 메일 발송은 하지 마.

Codex는 설치된 computer-use/browser 도구를 사용합니다. **Node 명령만 실행해서 TikTok 화면이 자동으로 수집되는 프로그램은 아닙니다.** 기존 Windows 수집과 동일하게 Codex가 화면을 읽고 observations를 채우며, Node 코드는 검증과 JSON 생성을 맡습니다.

## 사용 명령

저장소 루트의 PowerShell에서 실행합니다.

```powershell
npm.cmd run init
npm.cmd run doctor
npm.cmd run begin
# 여기서 Codex가 반환된 observations.json을 실제 Chrome 화면으로 채웁니다.
npm.cmd run finish -- --run <run_id>
npm.cmd run verify -- "C:\설치한 폴더\outputs\YYYY-MM-DD-<run_id>.json"
```

doctor 통과는 로그인 확인이 아닙니다. 로그인 또는 브라우저 연결이 안 되면 Codex가 구체적인 이유를 기록하고 수집 실패로 종료합니다. CAPTCHA는 현재 화면에서 새로 측정하고 현재 도구의 제출 직전 확인을 따릅니다. 제출 승인을 미리 영구 승인한 것으로 취급하지 않습니다.

## 전달할 파일

`outputs/YYYY-MM-DD-<run_id>.json` **하나만 전달**합니다. JSON에는 같은 실행의 manifest, 원래 observations, 수집 완료 시각, 식별자만 있는 config, 항목별 검증 결과와 선택한 추가 증거가 들어 있습니다. [정확한 구조](docs/JSON-FORMAT.md)를 참고하세요.

파일 이름에 실행 ID를 넣어 같은 날 재수집해도 예전 결과를 덮어쓰지 않습니다. 코드 0은 23개 검증 완료, 2는 미완성이지만 JSON 생성 완료, 1은 정상 JSON 생성/검증을 완료하지 못한 오류입니다. 성공 건수만 보지 말고 실패 이유도 함께 전달합니다.

실제 원본과 전달 결과는 .local과 outputs에만 저장되며 Git에서 제외합니다. 샵·상품 ID는 비공개 저장소의 profiles/celdyque.json에 설정되어 있습니다. 비밀번호·쿠키·토큰은 들어 있지 않습니다. 프로필의 레거시 schedule=08:40과 campaign/VOC 플래그는 기존 설정 해시와 검증 호환성을 위해 유지하며, 실제 예약 생성이나 GMV/VOC 수집을 뜻하지 않습니다.

## 기존 수집과 같은 부분

- `lib/core.mjs`, `lib/storage.mjs`, 원본 회귀 테스트와 CAPTCHA 거리 계산기는 기존 프로젝트에서 파일 그대로 복사했습니다. 출처와 SHA256은 [UPSTREAM.json](UPSTREAM.json)에 기록합니다.
- Open과 Target 샘플의 전체 페이지·선택 범위 검증, Awaiting reply 전체 페이지, 상품 ID별 같은 행, 랭킹 지연 대응과 계정 건강 지표 규칙을 유지합니다.
- GMV MAX, VOC, EUKA, 고객 메시지와 사람이 작성하는 항목을 수집하지 않습니다. 실패를 과거 수치나 계산값으로 채우지 않습니다.
- 새 CLI는 기존 검증기를 호출해 JSON만 만들며 Markdown 보고서·웹 원장·수동 SQLite를 작성하지 않습니다.

## 검증 범위

```powershell
npm.cmd test
```

테스트는 원본 검증 회귀, JSON 생성과 재검증, 실제 검증기 호환성, 실패 보존, 원래 시각 고정, 재종료 불변성, 첨부 무결성, 폴더 이동과 공백 경로를 검증합니다. 다른 PC의 실제 Chrome 로그인과 수집 성공까지 대신 증명하지 않으므로 첫 실행에서 화면으로 확인합니다.
