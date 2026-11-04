# PRISM-TIMES 북뷰어와 공용 비밀번호 관리실

**현재 무료 구성은 [OPERATIONS-FREE.md](OPERATIONS-FREE.md)를 따르세요.** GitHub Pages 독자 화면 + Cloudflare Workers 관리 서버 + D1 발행 정보 + Workers KV PDF 저장으로 변경했습니다. R2 결제 등록을 사용하지 않습니다. 아래 R2 최초 배포·복구 절차는 이전 구성의 기록이며 새 KV 서버에 그대로 적용하지 마세요. 최초 PDF는 관리실에서 업로드합니다.

---

## 이전 R2 구성 기록

이 프로젝트는 사용자 또는 학교가 소유한 Cloudflare 계정에 직접 배포합니다. 실행 중에 ChatGPT 구독, OpenAI API, ChatGPT Sites 계정이 필요하지 않습니다. GitHub는 소스 보관과 인수인계에 사용합니다. GitHub Pages만으로 현재 서버 관리실을 실행하는 구성은 아닙니다.

북뷰어, 쪽별 QR, 비밀번호 관리실, PDF 업로드, 연도별 호 보관, 기본 신문 선택, 게시 전 미리보기, 수정본 게시와 복원, 휴지통, 전체 백업 기능을 포함합니다. 현재 서비스에서 사용하던 코드를 바탕으로 독립 실행 검증을 마쳤습니다. 이 ZIP을 받았다고 외부 서버로 이전이 완료되는 것은 아닙니다.

## 포함된 데이터
- 기존 영문 예시본 16쪽과 초기 시범호 PDF가 포함되어 있습니다.
- 현재 관리실에 이후 추가한 PDF, 초안, 수정본과 게시 상태는 라이브 서비스의 ‘전체 백업’으로 별도 가져와야 합니다. 백업을 압축 해제한 뒤 아래 복구 절차를 사용합니다.
- 비밀번호, 로그인 세션, API 토큰, 배포 계정 정보는 포함하지 않습니다.

## 계정 준비
1. 운영자가 소유한 GitHub 저장소를 만듭니다. 비공개로 시작해도 됩니다. `.gitignore`가 비밀 환경 변수와 로컬 복구 데이터를 제외하도록 되어 있습니다.
2. 운영자/학교 소유의 Cloudflare 계정을 준비합니다. 비밀번호를 공유하기보다는 후임 담당자를 계정 멤버로 추가하고 소유·관리 권한을 인수인계합니다.
3. Cloudflare에서 R2 서비스를 활성화합니다. 무료 사용량을 제공하는 사용량 기반 서비스이므로 결제 설정과 사용량을 직접 확인해야 합니다. 이 프로젝트는 유료 가입이나 결제를 자동으로 수행하지 않습니다.
4. 최종 QR 주소는 학교가 관리하는 도메인 또는 소유한 별도 도메인을 권합니다. 먼저 workers.dev 기본 주소에서 점검할 수 있습니다. 도메인 등록·갱신 비용은 별도입니다.

Cloudflare Workers 무료 요금제는 요청별 CPU 시간 제한이 있습니다. 로그인, PDF 업로드, 모든 쪽 QR ZIP 생성 등 실제 운영 환경에서 기능을 점검한 뒤 요금제를 결정하세요. 무료·무기한 운영을 보장하지 않습니다. 공식 유료 요금제는 현재 월 5달러부터이며, 사용량 초과와 다른 서비스 비용은 별도일 수 있습니다.

## 최초 배포 (개발 담당자용)
Node.js 22.13 이상이 필요합니다. Cloudflare 계정 로그인과 결제·서비스 신청은 계정 소유자가 직접 진행합니다.

```sh
npm install
npx wrangler login
npx wrangler d1 create prism-times-db
npx wrangler r2 bucket create prism-times-papers
```

`wrangler.example.json`을 `wrangler.json`으로 복사하고, `database_id`를 방금 생성된 실제 D1 데이터베이스 ID로 바꿉니다. 여러 Cloudflare 계정을 사용하는 경우 올바른 `account_id`도 지정합니다. 서버 이름, DB 이름, 버킷 이름을 바꾸면 관련 설정을 함께 맞춥니다. 이 설정 파일의 저장소 ID와 이름은 서비스 연결용 식별자입니다. API 토큰이나 비밀번호는 이 파일에 넣지 않고 Cloudflare의 비밀 값으로 관리합니다. GitHub 자동 배포를 사용할 때는 비밀 값이 없는 이 설정 파일을 저장소에 함께 보관합니다.

```sh
npm run build
npm test
npx wrangler d1 migrations apply DB --remote
npm run deploy
npm run password
```

`npm run password`는 터미널에서 직접 입력한 비밀번호를 해시로 바꿔 Cloudflare의 `ADMIN_PASSWORD_HASH` 비밀 값으로 등록합니다. 입력 비밀번호를 화면이나 코드에 남기지 않습니다. 배포 후 secret 등록을 완료해야 로그인할 수 있습니다. 이 명령은 최초 설정용입니다. 운영 중 변경은 관리실의 비밀번호 메뉴를 이용하세요. 기존 DB에 저장된 비밀번호 해시는 환경 변수보다 우선합니다.

현재 Sites에서 운영 중인 비밀번호와 같은 값을 유지하려면 소유자가 직접 그 값으로 설정하세요. 비밀번호와 클라우드 계정 토큰을 저장소나 채팅에 적지 마세요.

배포 완료 후 표시된 새 URL에서 `/admin`에 로그인하고, 뷰어·업로드·게시·기본 신문 변경·삭제·복원·QR 내려받기를 점검합니다. GitHub에서 자동 배포할 때는 Cloudflare의 Git 연결 또는 공식 배포 워크플로를 별도로 설정합니다.

## 현재 신문 데이터 이전
기존 사이트 관리실에서 **전체 백업**을 내려받아 압축을 해제합니다. `management-data.json`과 `reader/papers/…`가 함께 있어야 합니다. 아래 작업은 새로 만든 비어 있는 대상 저장소에 수행하는 것을 기준으로 합니다.

```sh
npm run restore:prepare -- /absolute/path/to/unpacked-backup
node scripts/apply-restore.mjs restore-output
```

이 단계는 로컬 복구 계획만 만들고 외부 서버를 변경하지 않습니다. PDF 존재 여부·크기·형식, 발행 호, 현재/대기 버전과 기본 신문 설정을 검사합니다. 생성된 `restore-output/upload-plan.json`, `data.sql`과 대상 Cloudflare 계정을 확인하세요.

```sh
node scripts/apply-restore.mjs restore-output --apply
```

검토한 계획대로 PDF를 새 계정의 R2에 먼저 저장하고, 모두 성공한 뒤 D1에 발행 정보와 게시 이력을 기록합니다. 버전 ID, 휴지통 상태, 기본 신문을 유지합니다. 인증 정보는 이전하지 않습니다. 파일 전송 중 실패하면 재실행할 수 있습니다. 외부 변경은 이 명령을 직접 실행할 때만 시작됩니다. 새 서버에서 최종 검증을 마칠 때까지 기존 사이트를 유지하세요.

## 해마다 업데이트
관리실에서 새 호 등록 → PDF 업로드 → 미리보기 → 게시합니다. ‘기본으로 열 신문’을 선택하면 일반 링크로 그 호가 열립니다. 이전 연도 QR에는 호 ID가 포함되어 있어 기본 신문을 바꿔도 이전 호가 열립니다. 이 작업에는 GPT 구독이나 GitHub 로그인도 필요하지 않습니다. 관리자 비밀번호로 진행합니다.

코드를 수정하거나 호스팅·도메인·요금을 관리할 때는 해당 GitHub/Cloudflare/도메인 계정 권한이 필요합니다. 관리실 비밀번호는 인프라 계정 권한을 대신하지 않습니다.

## QR 주소와 장기 운영
현재 `chatgpt.site` 주소의 QR이 새 서버로 자동 이전되지는 않습니다. 새 주소에서 QR을 다시 만들고 실제 인쇄 전에 테스트하세요. 소유 도메인과 호 ID/쪽수 경로를 유지하면 이후 호스팅을 바꾸더라도 같은 주소를 연결할 수 있습니다.

어느 호스팅도 영구 운영을 보장하지 않습니다. 계정 복구 수단과 도메인 갱신을 유지하고, 관리실 전체 백업을 별도 기기에도 보관하세요. GitHub에는 소스가 보관되며, R2/D1에 저장되는 신문 파일과 게시 설정은 전체 백업으로 따로 보관합니다.

## 검증과 빌드
`npm test`는 외부 서버 데이터를 변경하지 않는 독립된 workerd/D1/R2 테스트입니다. 관리자 인증, 업로드, 게시·복원, 휴지통, 기본 신문, PDF 부분 읽기, QR ZIP, 독립 Worker 라우팅과 데이터 복구를 검사합니다. `npm run build`는 작은 독립 Worker와 최신 소스 백업 ZIP을 생성합니다. 최초 예시 PDF는 정적 파일 크기 제한 이내이고, 관리실에 새로 올리는 PDF는 R2에 저장됩니다.

공식 문서
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

## 이번 한국어본 최초 등록

저장소의 `newspapers/2026 프리즘타임즈 영자신문(한국어본).pdf`가 최종 16쪽 한국어본입니다. 최초 등록 준비 후 R2로 옮깁니다.

1. 위 최초 배포 절차로 D1·R2·관리자 비밀번호를 설정합니다.
2. `node scripts/prepare-launch.mjs`를 실행합니다. 원본 PDF를 검사하고 로컬 등록 계획을 만듭니다.
3. `node scripts/apply-restore.mjs restore-output/launch`로 등록 계획을 확인합니다.
4. 대상 계정을 확인한 뒤 `node scripts/apply-restore.mjs restore-output/launch --apply`를 실행합니다.
5. `/?issue=2026-01&page=1` 및 `/?issue=2026-01&page=4`를 확인합니다. 한국어본을 기본 신문으로 설정하고 예시 신문은 휴지통 상태로 둡니다.

검증: 페이지 연결 검사 11개와 최초 한국어본 등록 SQL 검증을 통과했습니다. 이 컴퓨터에서는 의존성 설치의 폴더 접근 오류로 전체 서버 통합 검사를 재실행하지 못했습니다. Cloudflare 배포는 아직 완료되지 않았습니다.
