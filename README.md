# mcp-game-controll-demo

このデモは、ゲームのキャラクターをMCPで操作するデモです。
プレイヤーキャラクターは上下左右に動くことができて、また、ミサイルを発射することができます。
MCPを用いて、敵にミサイルを着弾させるデモになります。

[![](https://img.youtube.com/vi/BVwZdBjdevg/0.jpg)](https://www.youtube.com/watch?v=BVwZdBjdevg)

# how to install

	//mcp server
	$ cd src
	$ npm install 

	//game server
	$ cd game-src 
	$ npm install 
	$ node server.js

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


# debug

	インスペクターを使って、MCPのデバッグを行います

	npx -y @modelcontextprotocol/inspector node ./build/index.js




