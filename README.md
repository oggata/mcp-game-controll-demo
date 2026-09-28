# mcp-game-controll-demo

このデモは、ゲームのキャラクターをMCPで操作するデモです。
プレイヤーキャラクターは上下左右に動くことができて、また、ミサイルを発射することができます。
MCPを用いて、敵にミサイルを着弾させるデモになります。

[![](https://img.youtube.com/vi/TJ5QTz-fWFI/0.jpg)](https://www.youtube.com/watch?v=TJ5QTz-fWFI)

[![](https://img.youtube.com/vi/HyEOUvATil0/0.jpg)](https://www.youtube.com/watch?v=HyEOUvATil0)

[![](https://img.youtube.com/vi/aSVuqsMoi28/0.jpg)](https://www.youtube.com/watch?v=aSVuqsMoi28)


# how to install

	//mcp server
	$ cd src
	$ npm install 

	//game server
	$ cd game-src 
	$ npm install 
	$ node server.js

# install mcp

	{
		"mcpServers": {
			"mcp-game-controll-demo": {
			"command": "/.nodebrew/current/bin/node",
			"args": [
				"index.js"
			]
			}
		}
	}

# api manual

　1.gameにアクセス
	http://localhost:3000

　2.curlでapiを実行

	//現在位置から、指定した方向に移動する 例 x方向に２動く
	$ curl -X POST http://localhost:3000/api/move -H "Content-Type: application/json" -d '{"x":1,"z":0}'

	//現在位置から、指定した方向に移動する 例 x方向に２動く
	$ curl -X POST http://localhost:3000/api/move-relative -H "Content-Type: application/json" -d '{"x":2,"z":0}'

	//現在位置から、rの方向にミサイルを発射する 例 90度、x軸正方向にミサイルを発射する
	$ curl -X POST http://localhost:3000/api/fire-missile -H "Content-Type: application/json" -d '{ "r": 90}'

	0度：北向き（Z軸正方向）
	90度：東向き（X軸正方向）
	180度：南向き（Z軸負方向）
	270度：西向き（X軸負方向）

	//現在の位置から敵の場所を索敵する
	$ curl -X GET "http://localhost:3000/api/vision?clientId=client_hr9xpjutp" | jq


# Jev で自動操作する (server-jev.js)

[TypeSafe AI の Jev](https://docs.typesafe.ai/api) に自機・敵戦車の状態を渡し、
「上・下・左・右・発射」のどれを行うかを選ばせて、敵を殲滅するまで自動で戦わせます。
server.js と同じ API を持つので、MCP (index.js) からの操作もそのまま使えます。

	$ cd game-src
	$ cp .env.example .env    // .env の TYPESAFE_API_KEY にキーを書く
	$ npm run start:jev
	// ブラウザで http://localhost:3000 を開くと自動で開始します（ポートは 3000 固定）

仕組み

	1. ブラウザが自機の位置・車体の回転角を WebSocket で 100ms ごとに報告
	   （index.html は変更せず、配信時にスクリプトを差し込み）
	2. サーバーが Jev の POST /v1/systemone に以下を送信
	   state   : 自機 (x, z, rotation)、各敵の (dx, dz, 距離, 方位, 射程内か)
	   target  : choice - 次に狙う敵
	   action  : choice - up / down / left / right / fire
	3. 移動なら JEV_STEP だけ動き、fire なら狙った敵へ発射（照準は発射時の位置と回転角で計算）
	   射程 (JEV_FIRE_RANGE) 外の敵には撃てないので、Jev は近づく必要があります

環境変数

	TYPESAFE_API_KEY  Jev の API キー（必須）
	JEV_MODEL         default: jev-latest
	JEV_AUTOSTART     "0" で自動開始しない
	JEV_STEP          1 回の移動量 (default: 3)
	JEV_FIRE_RANGE    射程 (default: 15)
	JEV_TICK_MS       意思決定の間隔 (default: 500)
	JEV_MAX_STEPS     最大ステップ数 (default: 300)

追加 API

	$ curl http://localhost:3000/api/state                 // 自機と敵の状態
	$ curl http://localhost:3000/api/agent                 // Jev の直近の判断と確率・ログ
	$ curl -X POST http://localhost:3000/api/agent/start
	$ curl -X POST http://localhost:3000/api/agent/stop
	$ curl -X POST http://localhost:3000/api/reset         // 敵を初期配置に戻す

# debug

	インスペクターを使って、MCPのデバッグを行います

	npx -y @modelcontextprotocol/inspector node ./build/index.js




