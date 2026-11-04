# GitHub Pages + 무료 관리 서버

독자 화면은 GitHub Pages, 관리실은 Cloudflare Workers, 발행 정보는 D1, PDF는 Workers KV에 보관합니다. R2 구독이나 결제 등록을 사용하지 않습니다. 공용 비밀번호는 서버에서만 검증하고 세션 쿠키는 HttpOnly로 발급합니다.

## 이번 계정에 준비한 항목

- D1: prism-times-db
- KV: prism-times-papers
- wrangler.json에 이 계정의 D1/KV 식별자를 연결했습니다. 비밀번호나 API 키는 포함하지 않습니다.
- 초기 화면은 예시 신문을 자동 게시하지 않습니다.

## 배포 순서

1. Cloudflare D1 Console에서 migrations의 SQL을 번호순으로 실행하거나 `npx wrangler d1 migrations apply DB --remote`를 실행합니다.
2. Cloudflare Git 연결에서 이 저장소를 선택하고 빌드 `npm run build`, 배포 `npx wrangler deploy`로 배포합니다.
3. 소유자가 `npm run password`를 실행해 관리자 비밀번호 해시를 서버 비밀 값 ADMIN_PASSWORD_HASH에 등록합니다. 비밀번호나 토큰을 저장소에 넣지 않습니다.
4. 배포된 실제 서버 주소를 GitHub 저장소 Actions 변수 PRISM_BACKEND_URL에 등록합니다.
5. GitHub Pages 사용이 가능한 공개 저장소(Free) 또는 지원 요금제의 비공개 저장소에서 Pages 소스를 GitHub Actions로 선택합니다. 저장소 공개 변경은 소유자 확인 후 진행합니다.
6. Pages 주소가 확정되면 Worker 변수 READER_URL을 해당 주소로 맞춥니다. 관리실에서 생성하는 QR과 '신문 보기'가 이 주소를 가리킵니다.
7. 관리실 /admin에서 한국어본을 등록·업로드·미리보기·게시하고 기본 신문으로 설정합니다. 원본 파일은 newspapers 폴더에 보존돼 있습니다.

## 기능과 제한

- PDF는 4MiB 조각으로 저장합니다. 95MiB 이하 PDF를 지원하며 모든 조각이 저장돼야 게시할 수 있습니다.
- 삭제는 휴지통 이동이며 PDF를 보존합니다. 복원하면 같은 QR 주소로 다시 볼 수 있습니다.
- Workers KV Free 저장 한도는 계정 전체 1GB입니다. 수정본·휴지통도 공간을 차지하므로 45MB 원본 기준 대략 20개보다 적은 여유 용량을 계획해야 합니다.
- 일일 읽기/쓰기 및 Worker 요청/CPU 한도가 있습니다. 한도 초과 시 작업이 실패할 수 있으며 무제한·영구 운영을 보장하지 않습니다.
- KV는 지역 간 전파에 시간이 걸릴 수 있습니다. 막 게시한 PDF가 다른 지역에서 바로 안 열리면 잠시 후 다시 시도합니다.
- 기존 R2용 apply-restore.mjs 및 prepare-launch.mjs의 외부 적용 절차는 이 KV 구성에 사용하지 않습니다. 최초 PDF는 관리실에서 업로드합니다. 일반 전체 백업 파일은 계속 내려받을 수 있습니다.

## 검증

빌드, QR/페이지/분할 저장 검사 14개를 통과했습니다. 별도 SQLite/KV 시험 어댑터에서 실제 한국어 PDF 45,009,065바이트의 업로드·SHA256 일치·부분 읽기·인증·CSRF·초안 비공개·게시·삭제·복원·QR·백업 목록을 확인했습니다. Windows의 Cloudflare 실행기가 시작되지 않아 원래 Miniflare 검사는 이 환경에서 실행되지 않았으며 실제 배포 후 서버·브라우저 검증이 남아 있습니다.

공식 한도: https://developers.cloudflare.com/kv/platform/pricing/
