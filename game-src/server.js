const http = require('http');
const WebSocket = require('ws');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();

// CORSとJSONボディパーサーを有効化
app.use(cors());
app.use(bodyParser.json());

// HTTPサーバーの作成
const server = http.createServer(app);

// WebSocketサーバーの作成
const wss = new WebSocket.Server({ server });

// 接続中のクライアントを保持
const clients = new Set();

// クライアントの現在位置を保持するマップ
const clientPositions = new Map();

// 敵の位置情報を保持する配列
// 敵の位置情報を保持する配列 - IDを追加
const enemyPositions = [
  { id: 1, x:  20, z: 20 },
  { id: 2, x: -15, z: 15 },
  { id: 3, x: 10, z: -12 },
  { id: 4, x: 14, z: -10 },
  { id: 5, x: -10, z: 7 },
  { id: 6, x: -30, z: -15 },
  { id: 7, x: 3, z: 6 }
];


// WebSocket接続のハンドリング
wss.on('connection', (ws) => {
  console.log('クライアントが接続しました');
  clients.add(ws);
  
  // 初期位置を設定
  clientPositions.set(ws, { x: 0, z: 0 });

  // メッセージ受信時の処理
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // クライアント登録メッセージの処理
      if (data.type === 'register' && data.clientId) {
        ws.id = data.clientId;
        console.log(`クライアントが登録されました: ${ws.id}`);
        
        // 登録完了メッセージを送信
        ws.send(JSON.stringify({
          type: 'registered',
          clientId: ws.id
        }));
        
        // 現在の敵の位置情報を送信
        ws.send(JSON.stringify({
          type: 'enemies',
          enemies: enemyPositions
        }));
      }
    } catch (error) {
      console.error('メッセージの処理中にエラーが発生しました:', error);
    }
  });

  // 接続が閉じられたときの処理
  ws.on('close', () => {
    console.log('クライアントが切断しました');
    clients.delete(ws);
    clientPositions.delete(ws);
  });

  // エラーハンドリング
  ws.on('error', (error) => {
    console.error('WebSocketエラー:', error);
    clients.delete(ws);
    clientPositions.delete(ws);
  });
});

// プレイヤーを移動させるAPI（絶対位置）
app.post('/api/move', (req, res) => {
  const { x, z } = req.body;
  
  if (x === undefined || z === undefined) {
    return res.status(400).json({ error: 'x and z coordinates are required' });
  }

  const parsedX = parseFloat(x);
  const parsedZ = parseFloat(z);

  // すべてのクライアントにメッセージを送信
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // クライアントの位置を更新
      clientPositions.set(client, { x: parsedX, z: parsedZ });
      
      client.send(JSON.stringify({
        type: 'move',
        absolute: true,
        x: parsedX,
        z: parsedZ
      }));
    }
  });

  res.json({ success: true, message: 'Move command sent', x: parsedX, z: parsedZ });
});

// プレイヤーを相対的に移動させるAPI
app.post('/api/move-relative', (req, res) => {
  const { x, z } = req.body;
  
  if (x === undefined || z === undefined) {
    return res.status(400).json({ error: 'x and z coordinates are required' });
  }

  const parsedX = parseFloat(x);
  const parsedZ = parseFloat(z);

  // すべてのクライアントにメッセージを送信
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // クライアントの現在位置を取得
      const currentPosition = clientPositions.get(client) || { x: 0, z: 0 };
      
      // 位置を更新
      const newPosition = {
        x: currentPosition.x + parsedX,
        z: currentPosition.z + parsedZ
      };
      
      // 新しい位置を保存
      clientPositions.set(client, newPosition);
      
      client.send(JSON.stringify({
        type: 'move',
        absolute: false,
        x: parsedX,
        z: parsedZ
      }));
    }
  });

  res.json({ success: true, message: 'Relative move command sent', x: parsedX, z: parsedZ });
});

// 現在の接続クライアント数を返すAPI
app.get('/api/status', (req, res) => {
  res.json({
    clients: clients.size,
    status: 'running'
  });
});

// ミサイル発射API - クライアントの現在位置から発射
app.post('/api/fire-missile', (req, res) => {
  const { r } = req.body;
  
  if (r === undefined) {
    return res.status(400).json({ error: 'Direction (r) is required' });
  }

  const direction = parseFloat(r);

  // すべてのクライアントにミサイル発射メッセージを送信
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // クライアントの現在位置を取得
      const position = clientPositions.get(client) || { x: 0, z: 0 };
      
      client.send(JSON.stringify({
        type: 'fire-missile',
        x: position.x,
        z: position.z,
        direction: direction
      }));
      console.log(`ミサイル発射しました: 位置(${position.x}, ${position.z})、方向: ${direction}`);
    }
  });

  res.json({ success: true, message: 'Missile fired', direction });
});

// 視界情報API
app.get('/api/vision', (req, res) => {
  // クライアントの位置情報を取得
  const clientId = req.query.clientId;
  let playerPosition = { x: 0, z: 0 };
  
  // クライアントIDが指定されている場合、そのクライアントの位置を取得
  if (clientId) {
    // WebSocketクライアントを探す
    for (const client of clients) {
      if (client.id === clientId) {
        playerPosition = clientPositions.get(client) || { x: 0, z: 0 };
        break;
      }
    }
  }
  
  // 敵の方向と距離を計算
  const visionInfo = enemyPositions.map(enemy => {
    // プレイヤーから見た敵への相対ベクトルを計算
    const dx = enemy.x - playerPosition.x;
    const dz = enemy.z - playerPosition.z;
    
    // 距離を計算
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    // 方向を計算（度数法）
    const direction = Math.atan2(dx, dz) * (180 / Math.PI);
    
    // 相対座標を返す（プレイヤーからの相対位置）
    return { 
      relativeX: dx,  // プレイヤーからの相対X座標
      relativeZ: dz,  // プレイヤーからの相対Z座標
      absoluteX: enemy.x,  // 絶対X座標（元の位置）
      absoluteZ: enemy.z,  // 絶対Z座標（元の位置）
      distance,  // プレイヤーからの距離
      direction  // プレイヤーからの方向（度数法）
    };
  });
  
  res.json({ 
    success: true, 
    playerPosition,
    visionInfo 
  });
});

// 視界情報API（相対座標版）
app.get('/api/vision-relative', (req, res) => {
  // クライアントの位置情報を取得
  const clientId = req.query.clientId;
  let playerPosition = { x: 0, z: 0 };
  
  // クライアントIDが指定されている場合、そのクライアントの位置を取得
  if (clientId) {
    // WebSocketクライアントを探す
    for (const client of clients) {
      if (client.id === clientId) {
        playerPosition = clientPositions.get(client) || { x: 0, z: 0 };
        break;
      }
    }
  }
  
  // 敵の相対位置情報を計算
  const relativeEnemyPositions = enemyPositions.map(enemy => {
    // プレイヤーから見た敵への相対ベクトルを計算
    const relativeX = enemy.x - playerPosition.x;
    const relativeZ = enemy.z - playerPosition.z;
    
    return {
      id: enemy.id,
      relativeX,
      relativeZ,
      distance: Math.sqrt(relativeX * relativeX + relativeZ * relativeZ),
      direction: Math.atan2(relativeX, relativeZ) * (180 / Math.PI)
    };
  });
  
  res.json({
    success: true,
    playerPosition,
    relativeEnemyPositions
  });
});

// 敵の位置情報を取得するAPI
app.get('/api/enemies', (req, res) => {
  res.json({ 
    success: true, 
    enemies: enemyPositions 
  });
});

// 敵の位置情報を更新するAPI
app.post('/api/enemies', (req, res) => {
  const { enemies } = req.body;
  
  if (!Array.isArray(enemies)) {
    return res.status(400).json({ error: 'enemies must be an array' });
  }
  
  // 敵の位置情報を更新
  enemyPositions.length = 0; // 配列をクリア
  enemies.forEach(enemy => {
    if (enemy.x !== undefined && enemy.z !== undefined) {
      enemyPositions.push({ 
        x: parseFloat(enemy.x), 
        z: parseFloat(enemy.z) 
      });
    }
  });
  
  res.json({ 
    success: true, 
    enemies: enemyPositions 
  });
});


// 敵を削除するAPI - インデックスではなくIDを使用
app.delete('/api/enemies/:id', (req, res) => {
  const id = parseInt(req.params.id);
  
  const index = enemyPositions.findIndex(enemy => enemy.id === id);
  if (index === -1) {
    return res.status(400).json({ error: 'Invalid enemy ID' });
  }
  
  // 指定されたIDの敵を削除
  const removedEnemy = enemyPositions.splice(index, 1)[0];
  
  // すべてのクライアントに敵の削除を通知 - IDを使用
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'enemy-removed',
        id: id
      }));
    }
  });
  
  res.json({ 
    success: true, 
    message: `Enemy with ID ${id} removed`,
    enemies: enemyPositions
  });
});

// 静的ファイルの提供
app.use(express.static('.'));

// サーバー起動
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
});