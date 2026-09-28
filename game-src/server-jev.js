// Jev (TypeSafe AI) で戦車を自律操作するゲームサーバー
//
// server.js と同じ API / WebSocket プロトコルを提供しつつ、サーバー内の
// エージェントループが Jev に「状態」と「型付きの質問」を投げ、返ってきた
// 選択（上・下・左・右・発射）をゲームに送って敵戦車を殲滅する。
//
//   TYPESAFE_API_KEY=xxxx node server-jev.js
//
// 環境変数:
//   TYPESAFE_API_KEY  Jev の API キー（必須）
//   JEV_API_URL       Jev のエンドポイント (default: https://api.typesafe.ai/v1/systemone)
//   JEV_MODEL         モデル名 (default: jev-latest)
//   JEV_AUTOSTART     "0" でブラウザ接続時の自動開始を無効化 (default: 有効)
//   JEV_STEP          1 回の移動量 (default: 3)
//   JEV_FIRE_RANGE    射程距離。これより遠い敵には撃てない (default: 15)
//   JEV_TICK_MS       意思決定の間隔 (default: 500)
//   JEV_MAX_STEPS     1 ゲームあたりの最大意思決定回数 (default: 300)
//   PORT              (default: 3000)

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

// game-src/.env があれば環境変数として読み込む（シェルで設定した値が優先）
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const JEV_API_URL = process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone';
const JEV_API_KEY = process.env.TYPESAFE_API_KEY;
const JEV_MODEL = process.env.JEV_MODEL || 'jev-latest';
const AUTOSTART = process.env.JEV_AUTOSTART !== '0';
const STEP = parseFloat(process.env.JEV_STEP || '3');
const FIRE_RANGE = parseFloat(process.env.JEV_FIRE_RANGE || '15');
const TICK_MS = parseInt(process.env.JEV_TICK_MS || '500', 10);
const MAX_STEPS = parseInt(process.env.JEV_MAX_STEPS || '300', 10);
// 発射後、着弾を待つ間はその敵を再度狙わない時間
const MISSILE_COOLDOWN_MS = 4000;
// 移動完了を待つ最大時間
const MOVE_TIMEOUT_MS = 6000;

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Set();

const INITIAL_ENEMIES = [
  { id: 1, x: 20, z: 20 },
  { id: 2, x: -15, z: 15 },
  { id: 3, x: 10, z: -12 },
  { id: 4, x: 14, z: -10 },
  { id: 5, x: -10, z: 7 },
  { id: 6, x: -30, z: -15 },
  { id: 7, x: 3, z: 6 }
];
let enemyPositions = INITIAL_ENEMIES.map(e => ({ ...e }));

// ブラウザから報告される自機の実際の状態（位置・車体の向き）
// rotation は度数法。0° = +Z 方向、90° = +X 方向（ミサイルの方向と同じ座標系）
const player = { x: 0, z: 0, rotation: 0, isMoving: false, updatedAt: 0 };
// 複数タブが開いていると報告が混ざるので、最後に登録したクライアントの状態だけを使う
let controlledClient = null;

// 上下左右は画面（初期カメラ）から見た方向。カメラは +Z 側から -Z 方向を見ている
const MOVES = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 }
};

function broadcast(message) {
  const payload = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function normalizeAngle(deg) {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

// 自機から見た敵の情報
function describeEnemy(enemy) {
  const dx = enemy.x - player.x;
  const dz = enemy.z - player.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const bearing = Math.atan2(dx, dz) * (180 / Math.PI);
  return {
    id: enemy.id,
    x: round(enemy.x),
    z: round(enemy.z),
    dx: round(dx),
    dz: round(dz),
    distance: round(distance),
    bearing: round(bearing),
    // 車体の向きから見た相対角度
    bearingFromHull: round(normalizeAngle(bearing - player.rotation)),
    inFireRange: distance <= FIRE_RANGE
  };
}

// ---------------------------------------------------------------------------
// 自機の操作
// ---------------------------------------------------------------------------

function sendMove(dirName) {
  const d = MOVES[dirName];
  const dx = d.x * STEP;
  const dz = d.z * STEP;
  // 報告が届くまでの間も一貫するよう、サーバー側でも目標位置を先に反映しておく
  player.x += dx;
  player.z += dz;
  player.isMoving = true;
  player.updatedAt = Date.now();
  broadcast({ type: 'move', absolute: false, x: dx, z: dz });
}

// 指定した敵に向けて発射する。index.html の createMissile は direction に
// 車体の回転を足して弾の向きを決めるが、旋回中はサーバーが知る回転角が古くなる。
// そのため敵の座標だけを送り、ブラウザ側（差し込みスクリプト）が発射する瞬間の
// 位置と回転角で狙いを計算する
function fireAt(enemy) {
  const info = describeEnemy(enemy);
  broadcast({ type: 'fire-at', targetX: enemy.x, targetZ: enemy.z });
  return info;
}

// ---------------------------------------------------------------------------
// Jev
// ---------------------------------------------------------------------------

async function askJev(state, questions) {
  const res = await fetch(JEV_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${JEV_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: JEV_MODEL, state, questions })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const error = new Error(`Jev API error ${res.status}: ${text}`);
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  return data.answers;
}

function buildQuestions(enemies, targetable) {
  const targetCriteria = {};
  targetable.forEach((e) => {
    targetCriteria[`enemy_${e.id}`] =
      `Enemy tank ${e.id}: ${e.distance} units away (dx=${e.dx}, dz=${e.dz})` +
      (e.inFireRange ? ', inside fire range' : ', outside fire range');
  });

  return {
    target: {
      type: 'choice',
      instructions:
        'You control the player tank. Which enemy tank should be attacked next? ' +
        'Prefer the closest enemy, especially one already inside fire range.',
      criteria: targetCriteria
    },
    action: {
      type: 'choice',
      instructions:
        'Choose the single best next action for the player tank to destroy the chosen target. ' +
        `Moving changes the position by ${STEP} units. Firing only works when the target is within ` +
        `${FIRE_RANGE} units (inFireRange=true); the shell is aimed automatically at the target. ` +
        'If the target is out of range, move toward it: use the axis where |dx| or |dz| is larger.',
      criteria: {
        up: 'Move up on screen (z decreases). Useful when target dz is negative.',
        down: 'Move down on screen (z increases). Useful when target dz is positive.',
        left: 'Move left on screen (x decreases). Useful when target dx is negative.',
        right: 'Move right on screen (x increases). Useful when target dx is positive.',
        fire: 'Fire a shell at the target. Only when the target is inside fire range.'
      }
    }
  };
}

// ---------------------------------------------------------------------------
// エージェントループ
// ---------------------------------------------------------------------------

const agent = {
  running: false,
  steps: 0,
  lastDecision: null,
  lastError: null,
  log: [],
  // enemyId -> 発射時刻
  inFlight: new Map()
};

function agentLog(entry) {
  const record = { time: new Date().toISOString(), ...entry };
  agent.log.push(record);
  if (agent.log.length > 50) agent.log.shift();
  console.log('[jev]', JSON.stringify(entry));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntilStopped() {
  const start = Date.now();
  // 移動命令直後はブラウザからの報告がまだ古いので少し待つ
  await sleep(300);
  while (player.isMoving && Date.now() - start < MOVE_TIMEOUT_MS) {
    await sleep(100);
  }
}

async function agentTick() {
  const now = Date.now();
  for (const [id, firedAt] of agent.inFlight) {
    if (now - firedAt > MISSILE_COOLDOWN_MS) agent.inFlight.delete(id);
  }

  const enemies = enemyPositions.map(describeEnemy);
  // 弾が飛んでいる最中の敵は、着弾を待つ間は狙わない
  const targetable = enemies.filter(e => !agent.inFlight.has(e.id));
  if (targetable.length === 0) return;

  const state = {
    game: 'Top-down tank battle. Destroy every enemy tank.',
    coordinateSystem:
      'x grows to the right of the screen, z grows toward the bottom of the screen. ' +
      'Angles are degrees: 0 = +z, 90 = +x.',
    player: {
      x: round(player.x),
      z: round(player.z),
      rotation: round(player.rotation)
    },
    fireRange: FIRE_RANGE,
    moveStep: STEP,
    enemiesRemaining: enemies.length,
    enemies,
    missilesInFlightTowardEnemyIds: [...agent.inFlight.keys()]
  };

  const answers = await askJev(state, buildQuestions(enemies, targetable));
  const targetId = parseInt(String(answers.target.choice).replace('enemy_', ''), 10);
  const target = targetable.find(e => e.id === targetId) || targetable[0];
  let action = answers.action.choice;

  agent.steps++;
  agent.lastDecision = {
    target: target.id,
    targetProbabilities: answers.target.probabilities,
    action,
    actionProbabilities: answers.action.probabilities,
    confidence: answers.action.confidence
  };

  if (action === 'fire') {
    if (!target.inFireRange) {
      agentLog({ step: agent.steps, target: target.id, action, result: 'out of range', distance: target.distance });
      return;
    }
    const enemy = enemyPositions.find(e => e.id === target.id);
    const shot = fireAt(enemy);
    agent.inFlight.set(target.id, Date.now());
    agentLog({ step: agent.steps, target: target.id, action, direction: shot.bearing, confidence: answers.action.confidence });
    return;
  }

  if (MOVES[action]) {
    sendMove(action);
    agentLog({ step: agent.steps, target: target.id, action, player: { x: round(player.x), z: round(player.z) }, confidence: answers.action.confidence });
    await waitUntilStopped();
    return;
  }

  agentLog({ step: agent.steps, error: `unknown action: ${action}` });
}

async function runAgent() {
  if (agent.running) return;
  if (!JEV_API_KEY) {
    agent.lastError = 'TYPESAFE_API_KEY が設定されていません';
    console.error(`[jev] ${agent.lastError}`);
    return;
  }
  agent.running = true;
  agent.steps = 0;
  agent.lastError = null;
  agent.inFlight.clear();
  console.log('[jev] エージェントを開始します');

  let backoff = 1000;
  while (agent.running) {
    if (enemyPositions.length === 0) {
      console.log(`[jev] 敵を殲滅しました！ (${agent.steps} steps)`);
      broadcast({ type: 'jev-cleared', steps: agent.steps });
      break;
    }
    if (agent.steps >= MAX_STEPS) {
      console.log(`[jev] 最大ステップ数 (${MAX_STEPS}) に達したため停止します`);
      break;
    }
    if (clients.size === 0) {
      console.log('[jev] ブラウザが接続されていないため停止します');
      break;
    }
    try {
      await agentTick();
      backoff = 1000;
      await sleep(TICK_MS);
    } catch (error) {
      agent.lastError = error.message;
      console.error('[jev]', error.message);
      if (error.status === 401 || error.status === 422) break;
      // 429 / 529 / ネットワークエラーは指数バックオフで再試行
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30000);
    }
  }
  agent.running = false;
}

function resetGame() {
  enemyPositions = INITIAL_ENEMIES.map(e => ({ ...e }));
  agent.inFlight.clear();
  broadcast({ type: 'enemies', enemies: enemyPositions });
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

wss.on('connection', (ws) => {
  console.log('クライアントが接続しました');
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'register' && data.clientId) {
        ws.id = data.clientId;
        console.log(`クライアントが登録されました: ${ws.id}`);
        ws.send(JSON.stringify({ type: 'registered', clientId: ws.id }));
        ws.send(JSON.stringify({ type: 'enemies', enemies: enemyPositions }));
        controlledClient = ws;
        agent.inFlight.clear();
        if (AUTOSTART) setTimeout(runAgent, 1500);
      } else if (data.type === 'player-state' && ws === controlledClient) {
        player.x = data.x;
        player.z = data.z;
        player.rotation = data.rotation;
        player.isMoving = data.isMoving;
        player.updatedAt = Date.now();
      }
    } catch (error) {
      console.error('メッセージの処理中にエラーが発生しました:', error);
    }
  });

  ws.on('close', () => {
    console.log('クライアントが切断しました');
    clients.delete(ws);
    if (ws === controlledClient) controlledClient = null;
  });

  ws.on('error', (error) => {
    console.error('WebSocketエラー:', error);
    clients.delete(ws);
  });
});

// ---------------------------------------------------------------------------
// HTTP API（server.js 互換 + Jev エージェント用）
// ---------------------------------------------------------------------------

app.post('/api/move', (req, res) => {
  const { x, z } = req.body;
  if (x === undefined || z === undefined) {
    return res.status(400).json({ error: 'x and z coordinates are required' });
  }
  const parsedX = parseFloat(x);
  const parsedZ = parseFloat(z);
  broadcast({ type: 'move', absolute: true, x: parsedX, z: parsedZ });
  res.json({ success: true, message: 'Move command sent', x: parsedX, z: parsedZ });
});

app.post('/api/move-relative', (req, res) => {
  const { x, z } = req.body;
  if (x === undefined || z === undefined) {
    return res.status(400).json({ error: 'x and z coordinates are required' });
  }
  const parsedX = parseFloat(x);
  const parsedZ = parseFloat(z);
  broadcast({ type: 'move', absolute: false, x: parsedX, z: parsedZ });
  res.json({ success: true, message: 'Relative move command sent', x: parsedX, z: parsedZ });
});

app.get('/api/status', (req, res) => {
  res.json({ clients: clients.size, status: 'running' });
});

app.post('/api/fire-missile', (req, res) => {
  const { r } = req.body;
  if (r === undefined) {
    return res.status(400).json({ error: 'Direction (r) is required' });
  }
  const direction = parseFloat(r);
  broadcast({ type: 'fire-missile', x: player.x, z: player.z, direction });
  res.json({ success: true, message: 'Missile fired', direction });
});

app.get('/api/vision', (req, res) => {
  const visionInfo = enemyPositions.map((enemy) => {
    const e = describeEnemy(enemy);
    return {
      relativeX: e.dx,
      relativeZ: e.dz,
      absoluteX: enemy.x,
      absoluteZ: enemy.z,
      distance: e.distance,
      direction: e.bearing
    };
  });
  res.json({ success: true, playerPosition: { x: player.x, z: player.z }, visionInfo });
});

app.get('/api/vision-relative', (req, res) => {
  const relativeEnemyPositions = enemyPositions.map((enemy) => {
    const e = describeEnemy(enemy);
    return { id: e.id, relativeX: e.dx, relativeZ: e.dz, distance: e.distance, direction: e.bearing };
  });
  res.json({ success: true, playerPosition: { x: player.x, z: player.z }, relativeEnemyPositions });
});

app.get('/api/enemies', (req, res) => {
  res.json({ success: true, enemies: enemyPositions });
});

app.post('/api/enemies', (req, res) => {
  const { enemies } = req.body;
  if (!Array.isArray(enemies)) {
    return res.status(400).json({ error: 'enemies must be an array' });
  }
  enemyPositions = enemies
    .filter(e => e.x !== undefined && e.z !== undefined)
    .map((e, i) => ({ id: e.id !== undefined ? parseInt(e.id, 10) : i + 1, x: parseFloat(e.x), z: parseFloat(e.z) }));
  broadcast({ type: 'enemies', enemies: enemyPositions });
  res.json({ success: true, enemies: enemyPositions });
});

// 着弾時にブラウザから呼ばれる
app.delete('/api/enemies/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const index = enemyPositions.findIndex(enemy => enemy.id === id);
  if (index === -1) {
    return res.status(400).json({ error: 'Invalid enemy ID' });
  }
  enemyPositions.splice(index, 1);
  agent.inFlight.delete(id);
  agentLog({ destroyed: id, remaining: enemyPositions.length });
  broadcast({ type: 'enemy-removed', id });
  res.json({ success: true, message: `Enemy with ID ${id} removed`, enemies: enemyPositions });
});

// 自機の状態（位置・回転角）と敵の情報
app.get('/api/state', (req, res) => {
  res.json({
    success: true,
    player: { x: round(player.x), z: round(player.z), rotation: round(player.rotation), isMoving: player.isMoving },
    enemies: enemyPositions.map(describeEnemy),
    fireRange: FIRE_RANGE
  });
});

app.get('/api/agent', (req, res) => {
  res.json({
    running: agent.running,
    steps: agent.steps,
    enemiesRemaining: enemyPositions.length,
    lastDecision: agent.lastDecision,
    lastError: agent.lastError,
    log: agent.log
  });
});

app.post('/api/agent/start', (req, res) => {
  if (!JEV_API_KEY) {
    return res.status(400).json({ error: 'TYPESAFE_API_KEY is not set' });
  }
  runAgent();
  res.json({ success: true, running: true });
});

app.post('/api/agent/stop', (req, res) => {
  agent.running = false;
  res.json({ success: true, running: false });
});

// 敵を初期配置に戻す
app.post('/api/reset', (req, res) => {
  resetGame();
  res.json({ success: true, enemies: enemyPositions });
});

// ---------------------------------------------------------------------------
// 静的ファイル
// ---------------------------------------------------------------------------

// index.html には手を入れず、自機の位置・回転角の報告と 'fire-at' の処理を行う
// スクリプトを配信時に差し込む
const PLAYER_STATE_REPORTER = `
<script>
  (function () {
    var hooked = null;
    setInterval(function () {
      if (typeof socket === 'undefined' || !socket || socket.readyState !== WebSocket.OPEN) return;
      // 再接続で socket が作り直されたらリスナーを付け直す
      if (hooked !== socket) {
        hooked = socket;
        socket.addEventListener('message', function (event) {
          var data = JSON.parse(event.data);
          if (data.type !== 'fire-at') return;
          var p = gameState.player.position;
          var bearing = Math.atan2(data.targetX - p.x, data.targetZ - p.z) * 180 / Math.PI;
          createMissile(p.x, p.z, bearing - player.rotation.y * 180 / Math.PI);
        });
      }
      socket.send(JSON.stringify({
        type: 'player-state',
        x: gameState.player.position.x,
        z: gameState.player.position.z,
        rotation: player.rotation.y * 180 / Math.PI,
        isMoving: gameState.player.isMovingToTarget
      }));
    }, 100);
  })();
</script>
`;

function serveIndex(req, res) {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  res.type('html').send(html.replace('</body>', `${PLAYER_STATE_REPORTER}</body>`));
}
app.get('/', serveIndex);
app.get('/index.html', serveIndex);
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
  console.log(`[jev] model=${JEV_MODEL} step=${STEP} fireRange=${FIRE_RANGE} autostart=${AUTOSTART}`);
  if (!JEV_API_KEY) console.warn('[jev] TYPESAFE_API_KEY が未設定です。エージェントは起動しません');
});
