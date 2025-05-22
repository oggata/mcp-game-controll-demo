import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({
    name: "game-charactor",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});


/**
 * Move character tool - Handles relative movement of the game character
 */
server.tool(
    "game-charactor-move-operation", 
    "ゲームキャラクターを操作する", 
    {
        x: z.number().describe("キャラクターが移動させるX座標"),
        z: z.number().describe("キャラクターが移動させるY座標")
    }, 
    async ({ x, z }) => {
        try {
            const response = await fetch(`http://localhost:3000/api/move`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ x, z })
            });
            
            const data = await response.json();
            
            return {
                content: [
                    { 
                        type: "text",
                        text: `Character moved successfully: x=${x}, z=${z}`
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);

/**
 * Fire missile tool - Fires a missile from the character's position
 */

server.tool(
    "fire-missile", 
    "ゲームキャラクターからミサイルを発射する", 
    {
        r: z.number().describe("ミサイルを発射する方向。値は度数法（0°〜360°）で表現　0°は北向き（Z軸正方向）　90°は東向き（X軸正方向）　180°は南向き（Z軸負方向）　270°は西向き（X軸負方向）")
    }, 
    async ({ r }) => {
        try {
            const response = await fetch(`http://localhost:3000/api/fire-missile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({r })
            });
            
            const data = await response.json();
            
            return {
                content: [
                    { 
                        type: "text",
                        text: `Missile fired successfully in direction ${r} radians)`
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);


server.tool(
    "vision", 
    "ゲームキャラクターの視界情報。どの方向に敵がいるかなどを知る", 
    {}, 
    async () => {
        try {
            const response = await fetch(`http://localhost:3000/api/vision`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            // JSON形式ではなくtext形式で返却する
            return {
                content: [
                    { 
                        type: "text",
                        text: JSON.stringify(data.visionInfo)
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to get vision info: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);

server.tool(
    "vision-relative", 
    "ゲームキャラクターの視界情報（相対座標）。プレイヤーからの相対的な敵の位置情報を取得する", 
    {}, 
    async () => {
        try {
            const response = await fetch(`http://localhost:3000/api/vision-relative`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            return {
                content: [
                    { 
                        type: "text",
                        text: JSON.stringify(data.relativeEnemyPositions)
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to get relative vision info: ${error instanceof Error ? error.message : String(error)}`
                    }
                ]
            };
        }
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
