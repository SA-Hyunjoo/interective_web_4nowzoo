# GitHub Pages 배포

배포 주소: https://sa-hyunjoo.github.io/interective_web_4nowzoo/

## 처음 한 번 설정

1. GitHub 저장소 `SA-Hyunjoo/interective_web_4nowzoo`를 엽니다.
2. **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.
3. 변경 파일을 커밋하고 `main` 브랜치에 push합니다.

   ```sh
   git add .github/workflows/deploy-pages.yml vite.config.mjs src docs/github-pages.md
   git commit -m "Configure GitHub Pages deployment and asset paths"
   git push origin main
   ```

4. **Actions → Deploy to GitHub Pages**에서 작업이 성공했는지 확인합니다.
5. 위 배포 주소로 접속합니다. 동물의 숲 바로가기에는 `#animal-forest`를 붙입니다.

이미 최신 커밋을 push한 뒤 Pages를 활성화했다면 Actions에서 **Run workflow**로 다시 실행할 수 있습니다.
Actions가 차단된 저장소라면 Settings → Actions → General에서 이 워크플로의 GitHub 공식 Actions 실행을 허용하세요.
별도 서버, 배포 토큰, 인증서 업로드, Supabase 설정은 필요하지 않습니다.

## 이후 배포

`main`에 push할 때마다 Node.js 24에서 `npm ci` → `npm run build` → `dist` 업로드 → Pages 배포를 자동 실행합니다.
`dist`를 직접 커밋하거나 별도 `gh-pages` 브랜치를 만들 필요가 없습니다.
실패하면 Actions의 실패한 단계 로그를 확인하세요. TypeScript 검사 또는 빌드 실패 시 새 버전은 배포되지 않습니다.

## 경로와 로컬 개발

- `npm run build`의 기본 경로는 `/interective_web_4nowzoo/`입니다.
- 워크플로에서는 GitHub Pages 설정이 반환한 경로를 `PAGES_BASE_PATH`로 전달합니다. 저장소 이름 변경 또는 사용자 지정 도메인도 해당 설정을 따릅니다.
- 로컬에서 다른 경로로 빌드하려면 `PAGES_BASE_PATH=/ npm run build`처럼 지정할 수 있습니다.
- `npm run dev`는 기존 루트 경로와 mkcert HTTPS 설정을 유지합니다.
- 이미지·음원·MediaPipe 모델은 Vite의 `BASE_URL`을 사용합니다. CSS 이미지, 동적 import와 Worker 번들은 Vite가 경로를 변환합니다.
- 해시 기반 화면 전환을 유지하므로 게임 주소에서 새로고침해도 서버 라우팅 설정이 필요 없습니다.
- Pages는 HTTPS로 제공됩니다. 카메라 사용 시 브라우저와 운영체제에서 카메라 접근을 허용하세요. 개발용 CA를 설치할 필요는 없습니다.
- 로컬과 배포 사이트는 주소가 다르므로 브라우저에 저장된 촬영물과 설정은 공유되지 않습니다.

공식 안내: [Vite GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages), [GitHub Pages 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
