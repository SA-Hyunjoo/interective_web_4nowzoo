# 로컬 네트워크 HTTPS

개발 서버 실행: `npm run dev`. 같은 네트워크의 다른 PC에서는 터미널에 표시된 Network URL로 접속합니다.
현재 주소는 `https://172.30.1.67:5173/`이며, 동물의 숲은 `https://172.30.1.67:5173/#animal-forest`입니다.
5173 포트가 사용 중이면 Vite가 선택한 실제 포트를 확인하세요. `npm run dev -- --port 5173 --strictPort`로 포트를 고정할 수 있습니다.

## 인증서

- mkcert로 localhost, 127.0.0.1, ::1 및 현재 외부 IPv4 주소를 포함해 생성했습니다.
- `.certs/dev-cert.pem`, `.certs/dev-key.pem`을 Vite HTTPS에 연결합니다. `.certs/ca/`는 이 프로젝트 전용 CA입니다.
- 인증서, CA, 비밀키, `.tools/`는 Git에서 제외되며 Vite 파일 제공도 차단합니다. public과 빌드 산출물에는 포함되지 않습니다.
- 이 PC의 최초 신뢰 등록: `npm run cert:trust`. 운영체제에서 관리자 비밀번호를 요구할 수 있습니다. 이 Mac은 현재 사용자 로그인 키체인에 이 프로젝트 CA를 HTTPS용으로 신뢰 등록했습니다. 다른 PC에서는 별도 신뢰 등록이 필요합니다.
- `npm run dev`는 실행 전에 인증서를 확인하고 IP 변경·만료·인증서 누락 시 자동 재생성합니다. 수동 재생성은 `npm run cert:generate`로 할 수 있습니다. 기존 CA가 유지되면 다른 PC의 신뢰 등록은 반복할 필요가 없습니다.
- 현재 Mac에는 공식 mkcert v1.4.4 실행 파일을 `.tools/mkcert`에 받았습니다. 새 체크아웃/다른 운영체제에서는 [mkcert 공식 설치 안내](https://github.com/FiloSottile/mkcert)에 따라 설치하고 `npm run cert:generate`를 실행하세요.

## 접속 PC의 인증서 경고 / 카메라 차단

1. **`.certs/ca/rootCA.pem`만** 신뢰하는 접속 PC에 전달하세요. `rootCA-key.pem`이나 `dev-key.pem`은 절대로 공유하지 않습니다.
2. Windows는 인증서 관리의 **신뢰할 수 있는 루트 인증 기관**, macOS는 키체인 접근에서 CA를 가져오고 **항상 신뢰**로 설정합니다. Firefox에서 계속 경고하면 브라우저 인증 기관 목록에도 CA를 등록합니다. 필요하면 rootCA.pem 사본의 확장자를 .crt로 변경합니다.
3. 브라우저를 다시 시작하고 인증서 경고 없는 HTTPS 주소로 접속한 뒤, 해당 사이트의 카메라·마이크 권한 및 운영체제의 브라우저 카메라 접근 권한을 허용합니다. 다른 앱이 카메라를 사용 중이면 종료하세요. 경고 화면을 단순히 우회하는 것만으로 카메라 사용이 보장되지 않습니다.
4. 연결 자체가 안 되면 같은 LAN/Wi-Fi인지, 공유기의 게스트 격리 설정, 이 Mac의 방화벽에서 Node 및 실제 개발 포트가 허용되는지 확인합니다.

HTTP와 HTTPS, localhost와 IP 주소는 서로 다른 브라우저 origin입니다. 기존 IndexedDB 촬영물과 localStorage 점수는 삭제하지 않지만 새 주소에서는 별도 저장 공간으로 표시됩니다.

빌드와 preview의 기존 동작은 유지됩니다. Playwright의 URL은 HTTPS로 맞추었으며 테스트 내부에서만 개발 인증서 검증을 생략합니다. 실제 브라우저의 신뢰 등록을 대신하지 않습니다.
