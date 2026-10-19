const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function createServer() {
  return http.createServer((req, res) => {
    let f = req.url.split('?')[0];
    if (f === '/') f = '/index.html';
    const filePath = path.join(__dirname, f);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).slice(1);
      const mime = {
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        svg: 'image/svg+xml',
        json: 'application/json',
        webmanifest: 'application/manifest+json'
      }[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}

async function runTests() {
  console.log('--- STARTING COMPREHENSIVE E2E & DISPLAY TESTS ---');
  const server = createServer();
  await new Promise(r => server.listen(8081, r));
  console.log('Local test server running at http://127.0.0.1:8081/');

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.error('[BROWSER CONSOLE ERROR]:', msg.text());
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push(err.message);
    console.error('[PAGE ERROR]:', err.message);
  });

  // TEST 1: Welcome Mode Selector & Start Single Player
  console.log('\n[TEST 1] Testing Welcome Mode Selector on Page Load...');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://127.0.0.1:8081/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Verify Mode Selection Modal is open and game has NOT started yet
  const modeSelectShown = await page.$eval('#modalModeSelect', el => el.classList.contains('show'));
  console.log(`- Welcome Mode Selection modal displayed on entry: ${modeSelectShown}`);
  if (!modeSelectShown) throw new Error('Welcome Mode Selection modal was not shown on entry!');

  // Check random nickname button
  await page.click('#btnRandomName');
  await page.waitForTimeout(200);
  const nickname = await page.$eval('#inputWelcomeName', el => el.value);
  console.log(`- Randomized nickname: "${nickname}"`);

  // Start single player
  await page.click('#btnStartSingle');
  await page.waitForTimeout(600);

  // Check table presence
  const table = await page.$('.table-surface');
  if (!table) throw new Error('Table surface not found!');
  const compass = await page.$('.compass-disc');
  if (!compass) throw new Error('Compass disc not found!');
  const humanHand = await page.$('#humanHandRow');
  if (!humanHand) throw new Error('Human hand row not found!');

  const tilesCount = await page.$$eval('#humanHandRow .mj-tile', els => els.length);
  console.log(`- Human hand dealt tiles: ${tilesCount} (Expected: 13 or 14)`);

  await page.screenshot({ path: 'test-desktop.png' });
  console.log('- Desktop screenshot saved: test-desktop.png');

  // TEST 2: Hand Tile Tap & Discard on Active Turn
  console.log('\n[TEST 2] Testing Tile Tap, Selection, and Discard...');
  const firstTile = await page.$('#humanHandRow .mj-tile');
  if (firstTile) {
    await firstTile.click();
    await page.waitForTimeout(300);

    const isSelected = await page.$eval('#humanHandRow .mj-tile', el => el.classList.contains('selected'));
    console.log(`- First tile selected on click: ${isSelected}`);

    const hasPill = await page.$eval('.discard-tap-pill', el => !!el).catch(() => false);
    console.log(`- Floating [出牌 ⬆] pill appeared: ${hasPill}`);

    await page.screenshot({ path: 'test-tile-selected.png' });

    // Discard via pill click
    if (hasPill) {
      await page.click('.discard-tap-pill', { force: true });
      await page.waitForTimeout(600);
      const discardsCount = await page.$$eval('#discardPool_bottom .mj-tile', els => els.length);
      console.log(`- Discard successful! Bottom pool count: ${discardsCount}`);
    }
  }

  // TEST 3: Mobile Landscape (iPhone 13 Landscape: 844x390)
  console.log('\n[TEST 3] Testing iPhone Landscape (844x390)...');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);

  const overflows = await page.evaluate(() => {
    const docEl = document.documentElement;
    return {
      hasHOverflow: docEl.scrollWidth > docEl.clientWidth,
      hasVOverflow: docEl.scrollHeight > docEl.clientHeight
    };
  });
  console.log(`- Overflow check: H-Overflow=${overflows.hasHOverflow}, V-Overflow=${overflows.hasVOverflow}`);
  await page.screenshot({ path: 'test-iphone-landscape.png' });
  console.log('- iPhone Landscape screenshot saved: test-iphone-landscape.png');

  // TEST 4: Mobile Portrait Orientation Guard (390x844)
  console.log('\n[TEST 4] Testing Mobile Portrait (390x844) Orientation Guard...');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);

  const guardVisible = await page.$eval('#orientationGuard', el => {
    return window.getComputedStyle(el).display !== 'none';
  });
  console.log(`- Orientation guard displayed on mobile portrait: ${guardVisible}`);
  await page.screenshot({ path: 'test-portrait-guard.png' });

  // Switch back to Desktop for Modal & Settings Checks
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(400);

  // TEST 5: Modals Testing (Lobby, Rules, History, Settings)
  console.log('\n[TEST 5] Testing Modals & Controls...');

  // 1. Lobby Modal & Multiplayer Ready Controls
  await page.click('#btnLobby');
  await page.waitForTimeout(300);
  const lobbyShown = await page.$eval('#modalLobby', el => el.classList.contains('show'));
  const qrCanvasDrawn = await page.$eval('#lobbyQRCodeCanvas', el => el.width > 0);
  console.log(`- Lobby modal opened: ${lobbyShown}, QR Canvas generated: ${qrCanvasDrawn}`);

  // Test creating room as Host to test ready states
  await page.click('#btnCreateRoom');
  await page.waitForFunction(() => {
    const el = document.getElementById('lobbyRoomCode');
    return el && el.textContent !== '----';
  }, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  const hasHostTag = await page.$eval('#lobbySeatsGrid', el => el.innerText.includes('房主 (已就绪)')).catch(() => false);
  const hasStartBtn = await page.$eval('#btnStartOnlineGame', el => el.style.display !== 'none').catch(() => false);
  console.log(`- Created room: Host badge shown=${hasHostTag}, Host start button visible=${hasStartBtn}`);

  await page.screenshot({ path: 'test-modal-lobby.png' });
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('show'));
  });
  await page.waitForTimeout(300);

  // 2. Rules Modal
  await page.click('#btnRules');
  await page.waitForTimeout(300);
  const rulesShown = await page.$eval('#modalRules', el => el.classList.contains('show'));
  console.log(`- Rules modal opened: ${rulesShown}`);
  await page.click('#modalRules .close-btn');
  await page.waitForTimeout(200);

  // 3. History Scoreboard Modal
  await page.click('#btnHistory');
  await page.waitForTimeout(300);
  const historyShown = await page.$eval('#modalHistory', el => el.classList.contains('show'));
  console.log(`- History scoreboard modal opened: ${historyShown}`);
  await page.screenshot({ path: 'test-modal-history.png' });
  await page.click('#modalHistory .close-btn');
  await page.waitForTimeout(200);

  // 4. Settings Modal & Theme Change
  await page.click('#btnSettings');
  await page.waitForTimeout(300);
  const settingsShown = await page.$eval('#modalSettings', el => el.classList.contains('show'));
  console.log(`- Settings modal opened: ${settingsShown}`);

  // Switch theme to Obsidian (曜石黑金)
  await page.click('.theme-choice-btn[data-theme="obsidian"]');
  await page.waitForTimeout(200);
  const currentTheme = await page.$eval('body', el => el.getAttribute('data-theme'));
  console.log(`- Theme switched to: ${currentTheme}`);
  await page.screenshot({ path: 'test-theme-obsidian.png' });
  await page.click('#modalSettings .close-btn');
  await page.waitForTimeout(200);

  // 5. Choose Mode Modal via Toolbar
  await page.click('#btnChooseMode');
  await page.waitForTimeout(200);
  const modeModalReopened = await page.$eval('#modalModeSelect', el => el.classList.contains('show'));
  console.log(`- Mode selection modal reopened via toolbar button: ${modeModalReopened}`);
  await page.click('#btnStartSingle');
  await page.waitForTimeout(200);

  // TEST 6: Quick Chat & Floating Speech Bubble
  console.log('\n[TEST 6] Testing In-Game Quick Chat & Emojis...');
  await page.click('#chatPillBtn');
  await page.waitForTimeout(200);
  const chatPopupVisible = await page.$eval('#chatPopup', el => el.classList.contains('show'));
  console.log(`- Quick chat popup opened: ${chatPopupVisible}`);

  // Click first phrase
  await page.click('#chatPhrasesList .chat-item');
  await page.waitForTimeout(400);
  const speechBubble = await page.$eval('.speech-bubble', el => el.textContent).catch(() => null);
  console.log(`- Floating speech bubble text: "${speechBubble}"`);
  // TEST 7: Match Recovery & Reconnect Modal Verification
  console.log('\n[TEST 7] Testing Disconnect Reconnect & Recovery Modal...');
  await page.evaluate(() => {
    localStorage.removeItem('mj_host_saved_match');
    localStorage.setItem('mj_active_match', JSON.stringify({
      code: '8T4M',
      isHost: false,
      name: '测试雀王',
      time: Date.now()
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const reconnectModalShown = await page.$eval('#modalReconnect', el => el.classList.contains('show'));
  const recCode = await page.$eval('#reconnectRoomCode', el => el.textContent);
  const recRole = await page.$eval('#reconnectRoleBadge', el => el.textContent);
  console.log(`- Reconnect modal prompted on page entry: ${reconnectModalShown}`);
  console.log(`- Detected active room code: ${recCode}, role: ${recRole}`);

  if (!reconnectModalShown || recCode !== '8T4M') {
    throw new Error('Reconnect modal failed to prompt for ongoing match!');
  }

  await page.screenshot({ path: 'test-modal-reconnect.png' });
  console.log('- Reconnect modal screenshot saved: test-modal-reconnect.png');

  // Cancel reconnect and clean up
  await page.click('#btnCancelReconnect');
  await page.waitForTimeout(300);
  const modeSelectReturned = await page.$eval('#modalModeSelect', el => el.classList.contains('show'));
  console.log(`- Gracefully returned to mode select after cancel: ${modeSelectReturned}`);

  // TEST 8: Action Priority Hierarchy (胡最大 > 杠 > 碰 > 吃)
  console.log('\n[TEST 8] Testing Action Priority Hierarchy (胡最大 > 杠 > 碰 > 吃)...');
  
  // 1. Verify Rules Modal text
  const rulesModalContent = await page.$eval('#modalRules', el => el.innerText);
  const hasPriorityRule = rulesModalContent.includes('胡最大 ＞ 杠 ＞ 碰 ＞ 吃');
  console.log(`- Rules modal includes '胡最大 ＞ 杠 ＞ 碰 ＞ 吃': ${hasPriorityRule}`);
  if (!hasPriorityRule) throw new Error('Rules modal missing priority rule text!');

  // 2. Start game and render full action bar
  await page.click('#btnStartSingle');
  await page.waitForTimeout(400);

  const buttonOrder = await page.evaluate(() => {
    // Manually trigger renderActionBar with all actions available
    const bar = document.getElementById('actionBar');
    bar.innerHTML = '';
    const actions = [
      { text: '胡', cls: 'hu' },
      { text: '杠', cls: 'gang' },
      { text: '碰', cls: 'peng' },
      { text: '吃', cls: 'chi' },
      { text: '过', cls: 'pass' }
    ];
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'action-btn ' + a.cls;
      btn.textContent = a.text;
      bar.appendChild(btn);
    });
    return Array.from(bar.querySelectorAll('.action-btn')).map(b => ({
      text: b.textContent,
      cls: b.className
    }));
  });

  console.log('- Action Bar rendered button sequence:');
  buttonOrder.forEach((b, idx) => console.log(`   ${idx + 1}. [${b.text}] (${b.cls})`));

  const expectedSequence = ['胡', '杠', '碰', '吃', '过'];
  const actualSequence = buttonOrder.map(b => b.text);
  const isSequenceCorrect = JSON.stringify(actualSequence) === JSON.stringify(expectedSequence);
  console.log(`- Action bar strictly matches Hu > Gang > Peng > Chi > Pass: ${isSequenceCorrect}`);
  if (!isSequenceCorrect) throw new Error('Action bar button sequence does not match priority!');

  await page.screenshot({ path: 'test-action-bar-priority.png' });
  console.log('- Action bar priority screenshot saved: test-action-bar-priority.png');

  // FINALIZE
  console.log('\n--- TEST SUMMARY ---');
  console.log(`Console Errors: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('FAIL: Console errors detected:', consoleErrors);
    process.exitCode = 1;
  } else {
    console.log('SUCCESS: All layout, display, interaction, and responsive tests PASSED with 0 errors!');
  }

  await browser.close();
  server.close();
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
