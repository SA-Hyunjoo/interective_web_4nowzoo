import './style.css'
import { setupCaptureController } from './capture-controller'
import type { ClawGameController } from './claw-game'
import type { FruitGameController } from './fruit-game'
import type { BrainGameController } from './brain-game'
import type { LemonadeGameController } from './lemonade-game'
import type { SamplerGameController } from './sampler-game'
import type { WaterTouchGameController } from './water-touch-game'
import type { BalloonGameController } from './balloon-game'
import type { ChainsawController } from './chainsaw-game'
import type { ShampooController } from './shampoo-game'
import type { DoodleFaceController } from './doodleface-game'
import type { AnimalForestController } from './animal-forest'

const WORDS = [
  '구름', '바람', '노을', '마음', '여유', '하늘', '산책', '별빛', '파도', '여름',
  '겨울', '봄날', '가을', '햇살', '달빛', '숲길', '바다', '소풍', '학교', '연필',
  '공책', '우산', '나무', '꽃잎', '새벽', '오후', '미소', '행복', '여행', '꿈결',
  '고양이', '토끼', '친구', '사랑', '음악', '그림', '이야기', '무지개', '운동장', '추억',
  'BREEZE', 'CLOUD', 'DREAM', 'LIGHT', 'NIGHT', 'OCEAN', 'SMILE', 'SPACE', 'STORY', 'WONDER',
  'APPLE', 'SCHOOL', 'PENCIL', 'RAINBOW', 'SUNSET', 'GARDEN', 'FRIEND', 'HAPPY', 'MUSIC', 'TRAVEL',
  'SPRING', 'SUMMER', 'AUTUMN', 'WINTER', 'MORNING', 'EVENING', 'FLOWER', 'FOREST', 'STARRY', 'PLAYGROUND',
  'COOKIE', 'CAMERA', 'LETTER', 'PLANET', 'PURPLE', 'ORANGE', 'BRIGHT', 'MAGIC', 'CANDY', 'BALLOON',
]

const SCHOOL_SUPPLIES = ['✏️', '📚', '📐', '📏', '🖍️', '✂️', '📓', '🖊️', '🧮', '🎒']

const GRAVITY = 250
const PLAYER_WIDTH = 117
const PLAYER_HEIGHT = 237

interface FallingGlyph {
  element: HTMLDivElement
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  angularVelocity: number
  size: number
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <nav class="game-nav" aria-label="게임 선택">
    <div class="game-hub-brand">
      <span class="hub-dot" aria-hidden="true"></span>
      <span>PLAYROOM</span>
    </div>
    <div class="game-tabs" role="tablist" aria-label="보관된 게임">
      <button class="game-tab active" type="button" role="tab" aria-selected="true" data-game="typing">
        <span>01</span> 타이핑게임
      </button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="claw">
        <span>02</span> 인형뽑기 게임
      </button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="fruit">
        <span>03</span> 과일 자르기
      </button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="brain">
        <span>04</span> 브레인 배틀
      </button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="sampler">
        <span>05</span> 샘플러
      </button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="lemonade">
        <span>06</span> Lemonade
      </button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="water-touch">
        <span>07</span> WaterTouch
      </button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="balloon">
        <span>08</span> Balloon
      </button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="chainsaw"><span>09</span> chainsaw man</button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="shampoo"><span>10</span> Shampoo</button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="doodleface"><span>11</span> DoodleFace</button>
      <button class="game-tab" type="button" role="tab" aria-selected="false" data-game="animal-forest"><span>12</span> 동물의 숲</button>
    </div>
    <span class="archive-note">GAME ARCHIVE</span>
  </nav>

  <section id="typingGameView" class="game-view" data-view="typing">
  <main class="game-shell">
    <header class="topbar">
      <div class="brand" aria-label="Letterfall">
        <span class="brand-mark" aria-hidden="true">A</span>
        <span>LETTERFALL</span>
      </div>
      <div class="status-group" aria-live="polite">
        <div class="status-item">
          <span class="status-label">떨어뜨린 단어</span>
          <strong id="score">00</strong>
        </div>
        <div class="status-divider"></div>
        <div class="status-item" title="바닥까지 지나간 학용품과 명중한 학용품 중 명중 비율">
          <span class="status-label">승률</span>
          <strong id="winRate">0%</strong>
        </div>
        <div class="status-divider"></div>
        <div class="status-item">
          <span class="status-label">진행 시간</span>
          <strong id="gameTime">00:00</strong>
        </div>
        <div class="status-divider"></div>
        <div class="status-item align-right state-item">
          <span class="status-label">상태</span>
          <strong id="gameStatus" class="status-safe">RUNNING</strong>
        </div>
      </div>
    </header>

    <section id="arena" class="arena" aria-label="타이핑 낙하 게임 영역">
      <div class="sky-glow sky-glow-one"></div>
      <div class="sky-glow sky-glow-two"></div>
      <div class="grain"></div>

      <section id="promptPanel" class="prompt-panel" aria-labelledby="promptLabel">
        <p id="promptLabel" class="eyebrow">TYPE FAST · CATCH HER</p>
        <div id="targetWord" class="target-word" aria-live="polite"></div>
        <div id="compositionPreview" class="composition-preview" aria-live="polite"></div>
        <label class="input-wrap" for="typingInput">
          <span class="sr-only">화면에 보이는 단어를 입력하세요</span>
          <input
            id="typingInput"
            class="typing-input"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            aria-describedby="typingHint"
          />
        </label>
        <p id="typingHint" class="typing-hint">단어를 완성해 캐릭터 머리 위로 글자를 떨어뜨리세요</p>
      </section>

      <div id="player" class="player" aria-label="떨어지는 글자를 피해 자동으로 도망가는 여자 캐릭터">
        <span class="look-line" aria-hidden="true"></span>
        <span class="sprite-window" aria-hidden="true">
          <img class="sprite-sheet" src="/girl-run-sprite-v2.png" alt="" />
        </span>
        <span class="player-shadow" aria-hidden="true"></span>
      </div>

      <div class="floor" aria-hidden="true">
        <span class="floor-label">CHASE ZONE</span>
      </div>

      <section id="gameOver" class="game-over" aria-labelledby="gameOverTitle" hidden>
        <div class="game-over-card">
          <p class="eyebrow danger">TARGET CAUGHT</p>
          <h1 id="gameOverTitle">잡았다!</h1>
          <p><strong id="finalTime">00:00</strong> 만에 <strong id="finalScore">0</strong>개의 단어로 캐릭터를 잡았습니다.</p>
          <button id="restartButton" type="button">다시 도전 <span aria-hidden="true">↗</span></button>
        </div>
      </section>
    </section>

    <footer class="footer-note">
      <span><i class="legend-dot typed-dot"></i> 입력 완료</span>
      <span><i class="legend-dot current-dot"></i> 현재 입력</span>
      <span class="footer-tip">단어를 빠르게 입력해 도망가는 캐릭터를 잡으세요</span>
    </footer>
  </main>
  </section>

  <section id="clawGameView" class="game-view" data-view="claw" hidden>
    <main class="claw-game-shell">
      <header class="claw-hud">
        <div>
          <p class="claw-kicker">3D CLAW MACHINE</p>
          <h1>인형뽑기</h1>
        </div>
        <div class="claw-controls" aria-label="조작 방법">
          <div class="key-cluster" aria-hidden="true">
            <kbd>↑</kbd>
            <span><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></span>
          </div>
          <p><strong>방향키</strong> 집게 이동<br><strong>SPACE</strong> 인형 잡기</p>
        </div>
        <div class="claw-actions">
          <button id="prizesButton" class="prizes-button" type="button" aria-controls="prizeDrawer" aria-expanded="false">
            PRIZES <span id="prizeCount">0</span>
          </button>
          <div class="claw-status-panel" aria-live="polite">
            <span>현재 상태</span>
            <strong id="clawStatus">MOVE THE CLAW</strong>
          </div>
        </div>
      </header>

      <section id="clawStage" class="claw-stage" aria-label="3차원 인형뽑기 게임">
        <canvas id="clawCanvas" aria-label="드래그하여 회전할 수 있는 3차원 인형뽑기 기계"></canvas>
        <div class="drag-guide"><span aria-hidden="true">↔</span> 드래그해서 기계를 돌려보세요</div>
        <div class="live-keys" aria-label="현재 누른 조작 키">
          <div class="live-arrow-keys">
            <kbd data-control-key="ArrowUp">↑</kbd>
            <span>
              <kbd data-control-key="ArrowLeft">←</kbd>
              <kbd data-control-key="ArrowDown">↓</kbd>
              <kbd data-control-key="ArrowRight">→</kbd>
            </span>
          </div>
          <kbd class="space-key" data-control-key="Space">SPACE</kbd>
        </div>
        <div id="prizeCelebration" class="prize-celebration" hidden>
          <div class="confetti" aria-hidden="true"></div>
          <p>YOU GOT IT!</p>
          <strong>인형을 뽑았어요!</strong>
        </div>

        <aside id="prizeDrawer" class="prize-drawer" aria-labelledby="prizeDrawerTitle" hidden>
          <header>
            <div>
              <p>MY COLLECTION</p>
              <h2 id="prizeDrawerTitle">뽑은 인형</h2>
            </div>
            <button id="closePrizeDrawer" type="button" aria-label="뽑은 인형 목록 닫기">×</button>
          </header>
          <div class="prize-drawer-body">
            <div id="prizeList" class="prize-list">
              <p class="empty-prizes">아직 뽑은 인형이 없어요.<br>첫 번째 인형을 뽑아보세요!</p>
            </div>
            <div class="prize-viewer">
              <canvas id="prizeViewerCanvas" aria-label="선택한 인형 3D 회전 보기"></canvas>
              <p id="selectedPrizeName">인형을 선택하세요</p>
              <span>자동으로 천천히 회전합니다</span>
            </div>
          </div>
        </aside>
      </section>
    </main>
  </section>

  <section id="fruitGameView" class="game-view" data-view="fruit" hidden>
    <main class="fruit-game-shell">
      <header class="fruit-hud">
        <div class="fruit-title">
          <p>RUB · SLICE · SPLASH</p>
          <h1>과일 자르기</h1>
        </div>
        <div class="fruit-scoreboard" aria-live="polite">
          <div><span>SCORE</span><strong id="fruitScore">000</strong></div>
          <div><span>COMBO</span><strong id="fruitCombo">×1</strong></div>
          <div><span>TIME</span><strong id="fruitTime">00:00</strong></div>
        </div>
        <div class="fruit-actions">
          <div class="fruit-lives" aria-label="남은 기회">
            <span>CHANCES</span>
            <strong id="fruitLives">● ● ●</strong>
          </div>
          <button id="fruitRecordsButton" class="fruit-records-button" type="button" aria-controls="fruitScoreDrawer" aria-expanded="false">
            SCORE BOARD
          </button>
        </div>
      </header>

      <section id="fruitStage" class="fruit-stage" aria-label="문질러서 과일을 자르는 3D 게임">
        <canvas id="fruitCanvas" aria-label="마우스나 손가락으로 3D 과일 위를 문질러 자르세요"></canvas>
        <div class="fruit-corner-tip">
          <span aria-hidden="true">↗</span>
          누른 채로 빠르게 문질러 자르기
        </div>

        <aside id="fruitScoreDrawer" class="fruit-score-drawer" aria-labelledby="fruitScoreDrawerTitle" hidden>
          <header>
            <div>
              <p>LOCAL TOP 5</p>
              <h2 id="fruitScoreDrawerTitle">스코어 기록판</h2>
            </div>
            <button id="closeFruitScoreDrawer" type="button" aria-label="스코어 기록판 닫기">×</button>
          </header>
          <div class="fruit-record-best">
            <span>BEST SCORE</span>
            <strong id="fruitRecordBest">000</strong>
          </div>
          <ol id="fruitRecordList" class="fruit-record-list"></ol>
          <p class="fruit-record-note">이 브라우저에 자동으로 저장됩니다.</p>
        </aside>

        <section id="fruitIntro" class="fruit-overlay" aria-labelledby="fruitIntroTitle">
          <div class="fruit-overlay-card">
            <p>READY TO SPLASH?</p>
            <h2 id="fruitIntroTitle">슥슥 문질러<br>과일을 잘라요!</h2>
            <span>마우스 또는 손가락을 누른 채 과일을 가로질러 보세요.</span>
            <button id="fruitStartButton" type="button">게임 시작 <b aria-hidden="true">↗</b></button>
          </div>
        </section>

        <section id="fruitGameOver" class="fruit-overlay" aria-labelledby="fruitGameOverTitle" hidden>
          <div class="fruit-overlay-card gameover">
            <p>JUICY FINISH!</p>
            <h2 id="fruitGameOverTitle"><strong id="fruitFinalScore">0</strong>점</h2>
            <span>최고 콤보 <b id="fruitBestCombo">×1</b></span>
            <form id="fruitScoreForm" class="fruit-score-form">
              <label for="fruitPlayerName">기록에 남길 이름</label>
              <div>
                <input id="fruitPlayerName" type="text" maxlength="10" autocomplete="nickname" placeholder="이름을 입력하세요" required />
                <button id="fruitSaveScoreButton" type="submit">기록 저장</button>
              </div>
            </form>
            <p id="fruitScoreSaved" class="fruit-score-saved" hidden>기록판에 저장했어요!</p>
            <button id="fruitRestartButton" type="button" hidden>다시 자르기 <b aria-hidden="true">↗</b></button>
          </div>
        </section>
      </section>
    </main>
  </section>

  <section id="brainGameView" class="game-view" data-view="brain" hidden>
    <main class="brain-shell">
      <header class="brain-hud">
        <div class="brain-logo">
          <span>OFFICE BRAINS</span>
          <strong>브레인 배틀</strong>
        </div>
        <div class="brain-scoreboard" aria-label="브레인 배틀 점수판">
          <div><span>PLAYER SCORE</span><strong id="brainPlayerScore">0000</strong></div>
          <div class="brain-versus">VS</div>
          <div><span>CPU SCORE</span><strong id="brainCpuScore">0000</strong></div>
          <div class="brain-combo"><span>COMBO</span><strong id="brainCombo">×0</strong></div>
        </div>
        <div id="brainRoundStatus" class="brain-round-status" aria-live="polite">빈 머리를 지켜라!</div>
      </header>
      <section class="brain-stage">
        <canvas id="brainCanvas" aria-label="뇌를 던져 싸우는 2.5D 캔버스 게임"></canvas>
        <div class="brain-rules-card">
          <strong>HOW TO PLAY</strong>
          <span><kbd>←</kbd><kbd>→</kbd> 이동</span>
          <span><kbd>↑</kbd> 점프</span>
          <span><kbd>SPACE</kbd> 뇌 던지기</span>
        </div>
        <div class="brain-touch-controls" aria-label="모바일 조작 버튼">
          <div>
            <button type="button" data-brain-control="ArrowLeft" aria-label="왼쪽 이동">←</button>
            <button type="button" data-brain-control="ArrowRight" aria-label="오른쪽 이동">→</button>
            <button type="button" data-brain-control="ArrowUp" aria-label="점프">↑</button>
          </div>
          <button class="brain-throw-button" type="button" data-brain-control="Space">THROW!</button>
        </div>
        <div id="brainGameOver" class="brain-game-over" hidden>
          <div class="brain-result-card">
            <span>BRAIN IN!</span>
            <h2 id="brainResultTitle">PLAYER WIN!</h2>
            <p id="brainResultCopy">상대의 빈 머리에 지식을 강제로 넣었습니다.</p>
            <button id="brainRestart" type="button">다시 싸우기</button>
          </div>
        </div>
      </section>
    </main>
  </section>

  <section id="samplerGameView" class="game-view" data-view="sampler" hidden>
    <main class="sampler-shell">
      <header class="sampler-hud">
        <div class="sampler-title">
          <p>KEYBOARD SAMPLE STATION</p>
          <h1>샘플러</h1>
        </div>
        <div id="samplerStatus" class="sampler-status" aria-live="polite">
          <i></i><span>QWE · ASD · ZXC 키를 누르는 동안 사운드가 재생됩니다</span>
        </div>
        <div class="sampler-header-actions">
          <button id="samplingModeButton" class="sampling-mode-button" type="button">
            <span>MIC</span> 샘플링
          </button>
          <button id="performanceRecordButton" class="performance-record-button" type="button">
            <span class="record-dot"></span> 녹음 <kbd>SPACE</kbd>
          </button>
        </div>
      </header>

      <section class="sampler-workspace">
        <div class="sampler-instrument">
          <section class="sample-editor" aria-label="선택한 사운드 편집">
            <div class="editor-selection">
              <span>EDITING PAD</span>
              <strong id="editingPadKey">Q</strong>
              <small>패드를 길게 눌러 선택</small>
            </div>
            <div class="editor-control">
              <span>PITCH</span>
              <div><button type="button" data-edit="pitch-down" aria-label="피치 낮추기">−</button><strong id="pitchValue">0 st</strong><button type="button" data-edit="pitch-up" aria-label="피치 높이기">＋</button></div>
            </div>
            <div class="editor-control">
              <span>SPEED</span>
              <div><button type="button" data-edit="speed-down" aria-label="속도 낮추기">−</button><strong id="speedValue">1.0×</strong><button type="button" data-edit="speed-up" aria-label="속도 높이기">＋</button></div>
            </div>
          </section>

          <div class="sampler-pad-grid" aria-label="9개 샘플 패드">
            <button class="sampler-pad" type="button" data-pad-key="q" style="--pad-color:#ff7891"><span>BUILT-IN</span><strong>Q</strong><small>KICK</small></button>
            <button class="sampler-pad" type="button" data-pad-key="w" style="--pad-color:#ffac63"><span>BUILT-IN</span><strong>W</strong><small>SNARE</small></button>
            <button class="sampler-pad" type="button" data-pad-key="e" style="--pad-color:#ffdb68"><span>BUILT-IN</span><strong>E</strong><small>HI-HAT</small></button>
            <button class="sampler-pad" type="button" data-pad-key="a" style="--pad-color:#8bd897"><span>BUILT-IN</span><strong>A</strong><small>BASS</small></button>
            <button class="sampler-pad" type="button" data-pad-key="s" style="--pad-color:#61d2c7"><span>BUILT-IN</span><strong>S</strong><small>CHORD</small></button>
            <button class="sampler-pad" type="button" data-pad-key="d" style="--pad-color:#63bce8"><span>BUILT-IN</span><strong>D</strong><small>PLUCK</small></button>
            <button class="sampler-pad" type="button" data-pad-key="z" style="--pad-color:#9c9bef"><span>BUILT-IN</span><strong>Z</strong><small>CLAP</small></button>
            <button class="sampler-pad" type="button" data-pad-key="x" style="--pad-color:#c88de5"><span>BUILT-IN</span><strong>X</strong><small>TOM</small></button>
            <button class="sampler-pad" type="button" data-pad-key="c" style="--pad-color:#ed83bd"><span>BUILT-IN</span><strong>C</strong><small>BELL</small></button>
          </div>
          <p class="sampler-tip">누르는 동안만 재생 · 여러 키 동시 입력 · 길게 눌러 사운드 편집</p>
        </div>

        <aside class="loop-panel" aria-labelledby="loopPanelTitle">
          <header>
            <div><p>PERFORMANCE LOOPS</p><h2 id="loopPanelTitle">녹음본</h2></div>
            <button id="newLoopButton" type="button"><span>＋</span> 새 녹음</button>
          </header>
          <div id="recordingMeter" class="recording-meter" hidden><i></i><span>RECORDING</span><strong id="recordingTime">00:00.0</strong></div>
          <div id="loopList" class="loop-list"></div>
          <footer>
            <kbd>SPACE</kbd>
            <span>녹음 시작 / 완료<br>선택한 녹음본에 레이어 추가</span>
          </footer>
        </aside>
      </section>
    </main>
  </section>

  <section id="lemonadeGameView" class="game-view" data-view="lemonade" hidden>
    <main class="lemonade-shell">
      <video id="lemonadeVideo" autoplay muted playsinline aria-label="Lemonade 카메라 화면"></video>
      <canvas id="lemonadeCanvas" aria-label="레몬을 짜서 레모네이드를 만드는 화면"></canvas>
    </main>
  </section>

  <section id="waterTouchGameView" class="game-view" data-view="water-touch" hidden>
    <main class="water-touch-shell">
      <video id="waterTouchVideo" autoplay muted playsinline aria-label="WaterTouch 카메라 원본"></video>
      <canvas id="waterTouchCanvas" aria-label="손가락으로 물결을 만드는 카메라 화면"></canvas>
      <canvas id="waterTouchOverlay" aria-hidden="true"></canvas>

      <section id="waterTouchPermission" class="water-touch-permission" hidden>
        <div>
          <span aria-hidden="true">≈</span>
          <h2>카메라가 필요해요</h2>
          <p id="waterTouchPermissionCopy">카메라 접근을 허용하면 손끝이 닿는 곳마다 물결이 퍼집니다.</p>
          <button id="waterTouchRetry" type="button">카메라 시작</button>
        </div>
      </section>
    </main>
  </section>

  <section id="balloonGameView" class="game-view" data-view="balloon" hidden>
    <main class="balloon-shell">
      <video id="balloonVideo" autoplay muted playsinline aria-label="Balloon 카메라 원본"></video>
      <canvas id="balloonCanvas" aria-label="손가락으로 풍선을 터뜨리고 끈을 잡는 카메라 게임"></canvas>
      <div class="balloon-capture-tools" aria-label="Balloon 촬영 도구">
        <button id="balloonPhotoButton" type="button" aria-label="사진 촬영"><span aria-hidden="true">●</span> PHOTO</button>
        <button id="balloonVideoButton" type="button" aria-label="MP4 영상 녹화"><i aria-hidden="true"></i> VIDEO</button>
        <button id="balloonGalleryButton" type="button" aria-controls="balloonGallery" aria-expanded="false" aria-label="촬영 보관함 열기">ARCHIVE <b id="balloonArchiveCount">0</b></button>
      </div>
      <p id="balloonCaptureStatus" class="balloon-capture-status" aria-live="polite" hidden></p>
      <aside id="balloonGallery" class="balloon-gallery" aria-label="Balloon 촬영 보관함" hidden>
        <header><div><span>YOUR CAPTURES</span><h2>보관함</h2></div><button id="balloonGalleryClose" type="button" aria-label="보관함 닫기">×</button></header>
        <div id="balloonGalleryList" class="balloon-gallery-list"></div>
      </aside>
      <section id="balloonPermission" class="balloon-permission" hidden>
        <div>
          <span aria-hidden="true">◯</span>
          <h2>카메라가 필요해요</h2>
          <p id="balloonPermissionCopy">카메라를 허용하면 풍선을 터뜨리고 끈을 잡을 수 있어요.</p>
          <button id="balloonRetry" type="button">카메라 시작</button>
        </div>
      </section>
    </main>
  </section>

  <section id="chainsawView" class="game-view" data-view="chainsaw" hidden>
    <canvas id="chainsawCanvas" aria-label="머리 위 고리를 핀치로 당겨 전기톱으로 변신하세요"></canvas>
    <video id="chainsawVideo" muted playsinline hidden></video>
    <button id="chainsawStart" type="button">chainsaw man · 카메라와 사운드 시작</button>
    <p id="chainsawHint" role="status">머리 위 고리를 엄지·검지로 잡고 아래로 당기세요</p>
  </section>

  <section id="shampooView" class="game-view" data-view="shampoo" hidden>
    <main class="shampoo-shell">
      <video id="shampooVideo" autoplay muted playsinline aria-label="Shampoo 카메라 원본"></video>
      <canvas id="shampooCanvas" aria-label="HumanSeg 거품 인터랙션"></canvas>
      <header class="shampoo-hud">
        <div class="shampoo-brand"><span aria-hidden="true">○</span><strong>SHAMPOO</strong><small>FOAM STUDIO</small></div>
        <p id="shampooDetail">SELFIE HUMANSEG · BOOTING</p>
      </header>
      <p id="shampooHint" class="shampoo-hint" role="status">카메라를 준비하는 중이에요</p>
    </main>
  </section>

  <section id="doodlefaceView" class="game-view" data-view="doodleface" hidden></section>
  <section id="animalForestView" class="game-view" data-view="animal-forest" hidden></section>

  <div class="global-capture-control" aria-live="polite" data-html2canvas-ignore="true">
    <div class="global-capture-tools">
      <button id="globalCaptureButton" class="global-capture-button" type="button" aria-label="사진 촬영"><span aria-hidden="true">●</span> PHOTO</button>
      <button id="globalVideoButton" class="global-video-button" type="button" aria-label="MP4 영상 녹화"><i aria-hidden="true"></i> VIDEO</button>
      <button id="globalArchiveButton" class="global-archive-button" type="button" aria-controls="globalCaptureGallery" aria-expanded="false">ARCHIVE <b id="globalArchiveCount">0</b></button>
    </div>
    <p id="globalCaptureStatus" class="global-capture-status" hidden></p>
  </div>
  <aside id="globalCaptureGallery" class="global-capture-gallery" aria-label="촬영 보관함" data-html2canvas-ignore="true" hidden>
    <header><div><span>YOUR CAPTURES</span><h2>보관함</h2></div><button id="globalGalleryClose" type="button" aria-label="보관함 닫기">×</button></header>
    <div id="globalGalleryList" class="global-gallery-list"></div>
  </aside>
`

const arena = document.querySelector<HTMLElement>('#arena')!
const input = document.querySelector<HTMLInputElement>('#typingInput')!
const targetWordElement = document.querySelector<HTMLDivElement>('#targetWord')!
const compositionPreview = document.querySelector<HTMLDivElement>('#compositionPreview')!
const promptPanel = document.querySelector<HTMLElement>('#promptPanel')!
const playerElement = document.querySelector<HTMLDivElement>('#player')!
const scoreElement = document.querySelector<HTMLElement>('#score')!
const winRateElement = document.querySelector<HTMLElement>('#winRate')!
const gameTimeElement = document.querySelector<HTMLElement>('#gameTime')!
const gameStatusElement = document.querySelector<HTMLElement>('#gameStatus')!
const gameOverElement = document.querySelector<HTMLElement>('#gameOver')!
const finalScoreElement = document.querySelector<HTMLElement>('#finalScore')!
const finalTimeElement = document.querySelector<HTMLElement>('#finalTime')!
const restartButton = document.querySelector<HTMLButtonElement>('#restartButton')!
const spriteSheetElement = document.querySelector<HTMLImageElement>('.sprite-sheet')!

let currentWord = ''
let acceptedInput = ''
let compositionText = ''
let isComposing = false
let isPlaying = true
let score = 0
let playerX = 0
let playerMoveDirection = Math.random() < 0.5 ? -1 : 1
let lastWord = ''
let lastFrameTime = performance.now()
let wanderTargetX = 0
let nextWanderAt = 0
let resolvedSupplies = 0
let successfulHits = 0
let roundStartedAt = performance.now()
let lastDisplayedSecond = -1
const glyphs: FallingGlyph[] = []

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function updateTimer(timestamp: number): void {
  const elapsed = timestamp - roundStartedAt
  const displayedSecond = Math.floor(elapsed / 1000)
  if (displayedSecond === lastDisplayedSecond) return
  lastDisplayedSecond = displayedSecond
  gameTimeElement.textContent = formatTime(elapsed)
}

function updateWinRate(): void {
  const percentage = resolvedSupplies === 0 ? 0 : Math.round((successfulHits / resolvedSupplies) * 100)
  winRateElement.textContent = `${percentage}%`
}

function prepareTransparentSprite(): void {
  if (spriteSheetElement.dataset.cutout === 'ready' || spriteSheetElement.naturalWidth === 0) return

  const canvas = document.createElement('canvas')
  canvas.width = spriteSheetElement.naturalWidth
  canvas.height = spriteSheetElement.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return

  context.drawImage(spriteSheetElement, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixelCount = canvas.width * canvas.height
  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let queueStart = 0
  let queueEnd = 0

  const isBackground = (pixelIndex: number): boolean => {
    const offset = pixelIndex * 4
    const red = image.data[offset]
    const green = image.data[offset + 1]
    const blue = image.data[offset + 2]
    return Math.min(red, green, blue) > 224 && Math.max(red, green, blue) - Math.min(red, green, blue) < 15
  }

  const enqueue = (pixelIndex: number): void => {
    if (visited[pixelIndex] || !isBackground(pixelIndex)) return
    visited[pixelIndex] = 1
    queue[queueEnd] = pixelIndex
    queueEnd += 1
  }

  for (let x = 0; x < canvas.width; x += 1) {
    enqueue(x)
    enqueue((canvas.height - 1) * canvas.width + x)
  }
  for (let y = 0; y < canvas.height; y += 1) {
    enqueue(y * canvas.width)
    enqueue(y * canvas.width + canvas.width - 1)
  }

  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart]
    queueStart += 1
    const x = pixelIndex % canvas.width
    const y = Math.floor(pixelIndex / canvas.width)
    image.data[pixelIndex * 4 + 3] = 0

    if (x > 0) enqueue(pixelIndex - 1)
    if (x < canvas.width - 1) enqueue(pixelIndex + 1)
    if (y > 0) enqueue(pixelIndex - canvas.width)
    if (y < canvas.height - 1) enqueue(pixelIndex + canvas.width)
  }

  context.putImageData(image, 0, 0)
  canvas.toBlob((blob) => {
    if (!blob) return
    spriteSheetElement.dataset.cutout = 'ready'
    spriteSheetElement.src = URL.createObjectURL(blob)
    spriteSheetElement.classList.add('cutout-ready')
  }, 'image/png')
}

if (spriteSheetElement.complete) prepareTransparentSprite()
else spriteSheetElement.addEventListener('load', prepareTransparentSprite, { once: true })

function pickWord(): string {
  const choices = WORDS.filter((word) => word !== lastWord)
  const next = choices[Math.floor(Math.random() * choices.length)]
  lastWord = next
  return next
}

function startNextWord(): void {
  currentWord = pickWord()
  acceptedInput = ''
  compositionText = ''
  input.value = ''
  renderPrompt()
}

function renderPrompt(): void {
  const targetCharacters = Array.from(currentWord)
  const typedCharacters = Array.from(acceptedInput)

  targetWordElement.innerHTML = targetCharacters
    .map((character, index) => {
      const className = index < typedCharacters.length
        ? index === typedCharacters.length - 1 && !isComposing
          ? 'letter typed current'
          : 'letter typed'
        : 'letter'
      return `<span class="${className}">${character}</span>`
    })
    .join('')

  if (isComposing && compositionText) {
    compositionPreview.innerHTML = `<span>조합 중</span><strong>${compositionText}</strong>`
    compositionPreview.classList.add('visible')
  } else {
    compositionPreview.innerHTML = ''
    compositionPreview.classList.remove('visible')
  }
}

function showMistake(): void {
  promptPanel.classList.remove('mistake')
  void promptPanel.offsetWidth
  promptPanel.classList.add('mistake')
}

function validateInput(): void {
  if (!isPlaying || isComposing) return

  const candidate = /^[A-Z]+$/.test(currentWord) ? input.value.toUpperCase() : input.value
  input.value = candidate
  if (!currentWord.startsWith(candidate)) {
    input.value = acceptedInput
    showMistake()
    return
  }

  acceptedInput = candidate
  renderPrompt()

  if (candidate === currentWord) completeWord()
}

function completeWord(): void {
  spawnWord(currentWord)
  score += 1
  scoreElement.textContent = score.toString().padStart(2, '0')
  startNextWord()
}

function spawnWord(word: string): void {
  const characters = Array.from(word)
  const size = arena.clientWidth < 600 ? 42 : 52
  const spacing = size * 0.76
  const groupWidth = (characters.length - 1) * spacing + size
  const margin = 18
  const maxStart = Math.max(margin, arena.clientWidth - groupWidth - margin)
  const playerCenter = playerX + (playerElement.offsetWidth || PLAYER_WIDTH) / 2
  const aimedStart = playerCenter - groupWidth / 2 + (Math.random() - 0.5) * 70
  const startX = Math.max(margin, Math.min(maxStart, aimedStart))

  characters.forEach((_, index) => {
    const element = document.createElement('div')
    element.className = 'falling-letter school-supply'
    element.textContent = SCHOOL_SUPPLIES[Math.floor(Math.random() * SCHOOL_SUPPLIES.length)]
    element.setAttribute('aria-hidden', 'true')
    arena.append(element)

    glyphs.push({
      element,
      x: startX + index * spacing,
      y: -size - index * 7,
      vx: (Math.random() - 0.5) * 30,
      vy: 8 + Math.random() * 22,
      angle: (Math.random() - 0.5) * 18,
      angularVelocity: (Math.random() - 0.5) * 150,
      size,
    })
  })
}

function predictImpactX(glyph: FallingGlyph, playerY: number): { x: number; seconds: number } | null {
  const distance = playerY - glyph.y
  if (distance < 0) return null

  const discriminant = glyph.vy * glyph.vy + 2 * GRAVITY * distance
  const seconds = (-glyph.vy + Math.sqrt(discriminant)) / GRAVITY
  if (seconds < 0 || seconds > 3.2) return null

  return {
    x: Math.max(0, Math.min(arena.clientWidth - glyph.size, glyph.x + glyph.vx * seconds)),
    seconds,
  }
}

function chooseEscapePosition(playerY: number): { destination: number; isDodging: boolean } {
  const playerWidth = playerElement.offsetWidth || PLAYER_WIDTH
  const maxX = Math.max(0, arena.clientWidth - playerWidth)
  const threats = glyphs
    .map((glyph) => ({ glyph, impact: predictImpactX(glyph, playerY) }))
    .filter((item): item is { glyph: FallingGlyph; impact: { x: number; seconds: number } } => item.impact !== null)

  if (threats.length === 0) {
    const now = performance.now()
    if (now >= nextWanderAt || Math.abs(wanderTargetX - playerX) < 14) {
      const isOnLeft = playerX + playerWidth / 2 < arena.clientWidth / 2
      wanderTargetX = isOnLeft
        ? maxX * (0.58 + Math.random() * 0.4)
        : maxX * (0.02 + Math.random() * 0.4)
      nextWanderAt = now + 260 + Math.random() * 310
    }

    return { destination: wanderTargetX, isDodging: false }
  }

  let safestX = playerX
  let lowestRisk = Number.POSITIVE_INFINITY

  for (let candidate = 0; candidate <= maxX; candidate += 10) {
    const candidateCenter = candidate + playerWidth / 2
    let risk = Math.abs(candidate - playerX) * 0.006

    threats.forEach(({ glyph, impact }) => {
      const impactCenter = impact.x + glyph.size / 2
      const distance = Math.abs(candidateCenter - impactCenter)
      const dangerRadius = (playerWidth + glyph.size) * 0.78
      if (distance < dangerRadius) {
        const proximity = 1 - distance / dangerRadius
        risk += proximity * proximity * (760 / (impact.seconds + 0.08))
      }
    })

    if (risk < lowestRisk) {
      lowestRisk = risk
      safestX = candidate
    }
  }

  return { destination: safestX, isDodging: true }
}

function movePlayer(deltaSeconds: number): void {
  const playerWidth = playerElement.offsetWidth || PLAYER_WIDTH
  const playerHeight = playerElement.offsetHeight || PLAYER_HEIGHT
  const playerY = arena.clientHeight - playerHeight - 34
  const escape = chooseEscapePosition(playerY)
  const distance = escape.destination - playerX
  if (Math.abs(distance) > 7) playerMoveDirection = Math.sign(distance)
  if (playerX <= 1) playerMoveDirection = 1
  if (playerX >= arena.clientWidth - playerWidth - 1) playerMoveDirection = -1
  const maxMovement = (escape.isDodging ? 520 : 380) * deltaSeconds

  playerX += playerMoveDirection * maxMovement
  playerX = Math.max(0, Math.min(arena.clientWidth - playerWidth, playerX))

  playerElement.classList.add('moving')
  playerElement.classList.toggle('moving-left', playerMoveDirection < 0)
  playerElement.classList.toggle('moving-right', playerMoveDirection > 0)
  playerElement.style.transform = `translate3d(${playerX}px, 0, 0)`
  gameStatusElement.textContent = escape.isDodging ? 'DODGING' : 'RUNNING'
}

function isColliding(glyph: FallingGlyph): boolean {
  const playerWidth = playerElement.offsetWidth || PLAYER_WIDTH
  const playerHeight = playerElement.offsetHeight || PLAYER_HEIGHT
  const playerTop = arena.clientHeight - playerHeight - 34
  const playerLeft = playerX + 38
  const playerRight = playerX + playerWidth - 38
  const playerBottom = playerTop + playerHeight - 30
  const inset = glyph.size * 0.28

  return (
    glyph.x + glyph.size - inset > playerLeft &&
    glyph.x + inset < playerRight &&
    glyph.y + glyph.size - inset > playerTop + 28 &&
    glyph.y + inset < playerBottom
  )
}

function endGame(hitGlyph: FallingGlyph): void {
  isPlaying = false
  resolvedSupplies += 1
  successfulHits += 1
  updateWinRate()
  input.disabled = true
  hitGlyph.element.classList.add('hit')
  playerElement.classList.add('hit')
  gameStatusElement.textContent = 'CAUGHT!'
  gameStatusElement.className = 'status-danger'
  finalScoreElement.textContent = String(score)
  finalTimeElement.textContent = formatTime(performance.now() - roundStartedAt)
  gameOverElement.hidden = false
  restartButton.focus()
}

function updatePhysics(deltaSeconds: number): void {
  const arenaWidth = arena.clientWidth
  const arenaHeight = arena.clientHeight

  for (let index = glyphs.length - 1; index >= 0; index -= 1) {
    const glyph = glyphs[index]
    glyph.vy += GRAVITY * deltaSeconds
    glyph.x += glyph.vx * deltaSeconds
    glyph.y += glyph.vy * deltaSeconds
    glyph.angle += glyph.angularVelocity * deltaSeconds

    if (glyph.x <= 0 || glyph.x + glyph.size >= arenaWidth) {
      glyph.x = Math.max(0, Math.min(arenaWidth - glyph.size, glyph.x))
      glyph.vx *= -0.7
      glyph.angularVelocity *= -0.85
    }

    glyph.element.style.width = `${glyph.size}px`
    glyph.element.style.height = `${glyph.size}px`
    glyph.element.style.fontSize = `${glyph.size * 0.82}px`
    glyph.element.style.transform = `translate3d(${glyph.x}px, ${glyph.y}px, 0) rotate(${glyph.angle}deg)`

    if (isPlaying && isColliding(glyph)) endGame(glyph)

    if (glyph.y > arenaHeight + glyph.size) {
      if (isPlaying) {
        resolvedSupplies += 1
        updateWinRate()
      }
      glyph.element.remove()
      glyphs.splice(index, 1)
    }
  }
}

function gameLoop(timestamp: number): void {
  const deltaSeconds = Math.min((timestamp - lastFrameTime) / 1000, 0.035)
  lastFrameTime = timestamp

  if (!document.hidden && !typingGameView.hidden && isPlaying) {
    movePlayer(deltaSeconds)
    updateTimer(timestamp)
    updatePhysics(deltaSeconds)
  }
  requestAnimationFrame(gameLoop)
}

function restartGame(): void {
  glyphs.forEach((glyph) => glyph.element.remove())
  glyphs.length = 0
  score = 0
  scoreElement.textContent = '00'
  gameStatusElement.textContent = 'RUNNING'
  gameStatusElement.className = 'status-safe'
  playerElement.classList.remove('hit')
  gameOverElement.hidden = true
  input.disabled = false
  isPlaying = true
  playerMoveDirection = Math.random() < 0.5 ? -1 : 1
  nextWanderAt = 0
  roundStartedAt = performance.now()
  lastDisplayedSecond = -1
  gameTimeElement.textContent = '00:00'
  playerX = Math.max(0, (arena.clientWidth - (playerElement.offsetWidth || PLAYER_WIDTH)) / 2)
  startNextWord()
  input.focus()
}

input.addEventListener('compositionstart', () => {
  isComposing = true
  compositionText = ''
  renderPrompt()
})

input.addEventListener('compositionupdate', (event) => {
  compositionText = event.data
  renderPrompt()
})

input.addEventListener('compositionend', () => {
  isComposing = false
  compositionText = ''
  validateInput()
})

input.addEventListener('input', () => {
  if (!isComposing) validateInput()
})

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') event.preventDefault()
})

arena.addEventListener('pointerdown', (event) => {
  const target = event.target as HTMLElement
  if (isPlaying && !target.closest('button')) input.focus()
})

restartButton.addEventListener('click', restartGame)

window.addEventListener('resize', () => {
  playerX = Math.max(0, Math.min(arena.clientWidth - (playerElement.offsetWidth || PLAYER_WIDTH), playerX))
})

playerX = Math.max(0, (arena.clientWidth - (playerElement.offsetWidth || PLAYER_WIDTH)) / 2)
startNextWord()
input.focus()
requestAnimationFrame(gameLoop)

const typingGameView = document.querySelector<HTMLElement>('#typingGameView')!
const clawGameView = document.querySelector<HTMLElement>('#clawGameView')!
const fruitGameView = document.querySelector<HTMLElement>('#fruitGameView')!
const brainGameView = document.querySelector<HTMLElement>('#brainGameView')!
const samplerGameView = document.querySelector<HTMLElement>('#samplerGameView')!
const lemonadeGameView = document.querySelector<HTMLElement>('#lemonadeGameView')!
const waterTouchGameView = document.querySelector<HTMLElement>('#waterTouchGameView')!
const balloonGameView = document.querySelector<HTMLElement>('#balloonGameView')!
const gameTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.game-tab'))
let clawGame: ClawGameController | null = null
let clawGameLoading: Promise<ClawGameController> | null = null
let fruitGame: FruitGameController | null = null
let fruitGameLoading: Promise<FruitGameController> | null = null
let brainGame: BrainGameController | null = null
let brainGameLoading: Promise<BrainGameController> | null = null
let lemonadeGame: LemonadeGameController | null = null
let lemonadeGameLoading: Promise<LemonadeGameController> | null = null
let samplerGame: SamplerGameController | null = null
let samplerGameLoading: Promise<SamplerGameController> | null = null
let waterTouchGame: WaterTouchGameController | null = null
let waterTouchGameLoading: Promise<WaterTouchGameController> | null = null
let balloonGame: BalloonGameController | null = null
let balloonGameLoading: Promise<BalloonGameController> | null = null

function ensureClawGame(): Promise<ClawGameController> {
  if (clawGame) return Promise.resolve(clawGame)
  if (clawGameLoading) return clawGameLoading

  clawGameLoading = import('./claw-game').then(({ setupClawGame }) => {
    clawGame = setupClawGame(clawGameView, () => !clawGameView.hidden)
    return clawGame
  })
  return clawGameLoading
}

function ensureFruitGame(): Promise<FruitGameController> {
  if (fruitGame) return Promise.resolve(fruitGame)
  if (fruitGameLoading) return fruitGameLoading

  fruitGameLoading = import('./fruit-game').then(({ setupFruitGame }) => {
    fruitGame = setupFruitGame(fruitGameView, () => !fruitGameView.hidden)
    return fruitGame
  })
  return fruitGameLoading
}

function ensureSamplerGame(): Promise<SamplerGameController> {
  if (samplerGame) return Promise.resolve(samplerGame)
  if (samplerGameLoading) return samplerGameLoading

  samplerGameLoading = import('./sampler-game').then(({ setupSamplerGame }) => {
    samplerGame = setupSamplerGame(samplerGameView, () => !samplerGameView.hidden)
    return samplerGame
  })
  return samplerGameLoading
}

function ensureBrainGame(): Promise<BrainGameController> {
  if (brainGame) return Promise.resolve(brainGame)
  if (brainGameLoading) return brainGameLoading

  brainGameLoading = import('./brain-game').then(({ setupBrainGame }) => {
    brainGame = setupBrainGame(brainGameView, () => !brainGameView.hidden)
    return brainGame
  })
  return brainGameLoading
}

function ensureLemonadeGame(): Promise<LemonadeGameController> {
  if (lemonadeGame) return Promise.resolve(lemonadeGame)
  if (lemonadeGameLoading) return lemonadeGameLoading

  lemonadeGameLoading = import('./lemonade-game').then(({ setupLemonadeGame }) => {
    lemonadeGame = setupLemonadeGame(lemonadeGameView, () => !lemonadeGameView.hidden)
    return lemonadeGame
  })
  return lemonadeGameLoading
}

function ensureWaterTouchGame(): Promise<WaterTouchGameController> {
  if (waterTouchGame) return Promise.resolve(waterTouchGame)
  if (waterTouchGameLoading) return waterTouchGameLoading

  waterTouchGameLoading = import('./water-touch-game').then(({ setupWaterTouchGame }) => {
    waterTouchGame = setupWaterTouchGame(waterTouchGameView, () => !waterTouchGameView.hidden)
    return waterTouchGame
  })
  return waterTouchGameLoading
}

function ensureBalloonGame(): Promise<BalloonGameController> {
  if (balloonGame) return Promise.resolve(balloonGame)
  if (balloonGameLoading) return balloonGameLoading

  balloonGameLoading = import('./balloon-game').then(({ setupBalloonGame }) => {
    balloonGame = setupBalloonGame(balloonGameView, () => !balloonGameView.hidden)
    return balloonGame
  })
  return balloonGameLoading
}

const chainsawView = document.querySelector<HTMLElement>('#chainsawView')!
let chainsawLoading: Promise<ChainsawController> | null = null
function ensureChainsaw(): Promise<ChainsawController> {
  return chainsawLoading ??= import('./chainsaw-game').then(({ setupChainsaw }) => setupChainsaw(chainsawView, () => !chainsawView.hidden))
}
const shampooView = document.querySelector<HTMLElement>('#shampooView')!
let shampooGame: ShampooController | null = null
let shampooGameLoading: Promise<ShampooController> | null = null
function ensureShampooGame(): Promise<ShampooController> {
  if (shampooGame) return Promise.resolve(shampooGame)
  if (shampooGameLoading) return shampooGameLoading
  shampooGameLoading = import('./shampoo-game').then(({ setupShampooGame }) => {
    shampooGame = setupShampooGame(shampooView, () => !shampooView.hidden)
    return shampooGame
  })
  return shampooGameLoading
}
const doodlefaceView = document.querySelector<HTMLElement>('#doodlefaceView')!
let doodlefaceGame: DoodleFaceController | null = null
let doodlefaceRevision = 0

const animalForestView = document.querySelector<HTMLElement>('#animalForestView')!
let animalForest: AnimalForestController | null = null
let animalForestRevision = 0

type GameId = 'animal-forest' | 'doodleface' | 'typing' | 'claw' | 'fruit' | 'brain' | 'sampler' | 'lemonade' | 'water-touch' | 'balloon' | 'chainsaw' | 'shampoo'

function gameFromHash(): GameId {
  if (location.hash === '#animal-forest') return 'animal-forest'
  if (location.hash === '#doodleface') return 'doodleface'
  if (location.hash === '#shampoo') return 'shampoo'
  if (location.hash === '#chainsaw') return 'chainsaw'
  if (location.hash === '#claw') return 'claw'
  if (location.hash === '#fruit') return 'fruit'
  if (location.hash === '#brain') return 'brain'
  if (location.hash === '#sampler') return 'sampler'
  if (location.hash === '#lemonade') return 'lemonade'
  if (location.hash === '#water-touch') return 'water-touch'
  if (location.hash === '#balloon') return 'balloon'
  return 'typing'
}

function showGame(game: GameId, updateHash = true): void {
  const showTyping = game === 'typing'
  const showClaw = game === 'claw'
  const showFruit = game === 'fruit'
  const showBrain = game === 'brain'
  const showLemonade = game === 'lemonade'
  const showWaterTouch = game === 'water-touch'
  const showBalloon = game === 'balloon'
  typingGameView.hidden = !showTyping
  clawGameView.hidden = !showClaw
  fruitGameView.hidden = !showFruit
  brainGameView.hidden = !showBrain
  samplerGameView.hidden = game !== 'sampler'
  lemonadeGameView.hidden = !showLemonade
  waterTouchGameView.hidden = !showWaterTouch
  balloonGameView.hidden = !showBalloon
  chainsawView.hidden = game !== 'chainsaw'
  shampooView.hidden = game !== 'shampoo'
  animalForestView.hidden = game !== 'animal-forest'
  const forestRevision = ++animalForestRevision
  if (game !== 'animal-forest') { animalForest?.dispose(); animalForest = null }
  doodlefaceView.hidden = game !== 'doodleface'
  const doodleRevision = ++doodlefaceRevision
  if (game !== 'doodleface') { doodlefaceGame?.dispose(); doodlefaceGame = null }

  gameTabs.forEach((tab) => {
    const isActive = tab.dataset.game === game
    tab.classList.toggle('active', isActive)
    tab.setAttribute('aria-selected', String(isActive))
    if (isActive) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })

  if (game === 'animal-forest') {
    input.blur()
    void import('./animal-forest').then(({ setupAnimalForest }) => {
      if (forestRevision !== animalForestRevision || animalForestView.hidden) return
      animalForest ??= setupAnimalForest(animalForestView)
      animalForest.resize()
    }).catch(error => { console.error(error); animalForestView.textContent = '숲을 불러오지 못했어요. WebGL을 사용할 수 있는 브라우저에서 다시 열어 주세요.' })
  } else if (game === 'doodleface') {
    input.blur()
    void import('./doodleface-game').then(({ setupDoodleFace }) => {
      if (doodleRevision !== doodlefaceRevision || doodlefaceView.hidden) return
      doodlefaceGame ??= setupDoodleFace(doodlefaceView)
      doodlefaceGame.resize()
    }).catch(() => { doodlefaceView.textContent = 'DoodleFace를 불러오지 못했어요. 메뉴를 다시 선택해 주세요.' })
  } else if (game === 'chainsaw') {
    input.blur()
    void ensureChainsaw().then((controller) => requestAnimationFrame(controller.resize))
  } else if (game === 'shampoo') {
    input.blur()
    void ensureShampooGame().then((controller) => requestAnimationFrame(controller.resize))
  } else if (showTyping) {
    input.focus()
  } else if (showClaw) {
    input.blur()
    void ensureClawGame().then((game) => requestAnimationFrame(game.resize))
  } else if (showFruit) {
    input.blur()
    void ensureFruitGame().then((game) => requestAnimationFrame(game.resize))
  } else if (showBrain) {
    input.blur()
    void ensureBrainGame().then((game) => requestAnimationFrame(game.resize))
  } else if (showLemonade) {
    input.blur()
    void ensureLemonadeGame().then((game) => requestAnimationFrame(game.resize))
  } else if (showWaterTouch) {
    input.blur()
    void ensureWaterTouchGame().then((game) => requestAnimationFrame(game.resize))
  } else if (showBalloon) {
    input.blur()
    void ensureBalloonGame().then((game) => requestAnimationFrame(game.resize))
  } else {
    input.blur()
    void ensureSamplerGame().then((game) => requestAnimationFrame(game.resize))
  }

  if (updateHash) history.replaceState(null, '', `#${game}`)
}

gameTabs.forEach((tab) => {
  tab.addEventListener('click', () => showGame((tab.dataset.game ?? 'typing') as GameId))
})

window.addEventListener('hashchange', () => {
  showGame(gameFromHash(), false)
})

showGame(gameFromHash(), false)
setupCaptureController(document.querySelector<HTMLElement>('#app')!)
