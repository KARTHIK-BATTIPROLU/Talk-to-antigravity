import asyncio
import websockets
import json

import os

API_KEY = os.environ.get("GEMINI_API_KEY", "")
ENDPOINT = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={API_KEY}"

async def test_tool():
    async with websockets.connect(ENDPOINT) as ws:
        setup = {
            "setup": {
                "model": "models/gemini-2.5-flash-native-audio-latest",
                "tools": [{
                    "functionDeclarations": [{
                        "name": "read_file",
                        "description": "Read file contents",
                        "parameters": {
                            "type": "object",
                            "properties": {"path": {"type": "string"}},
                            "required": ["path"]
                        }
                    }]
                }]
            }
        }
        await ws.send(json.dumps(setup))
        resp = await ws.recv()
        print("Setup resp:", resp)

        req = {
            "clientContent": {
                "turns": [{
                    "role": "user",
                    "parts": [{"text": "Please invoke the read_file function on path 'package.json'."}]
                }],
                "turnComplete": True
            }
        }
        await ws.send(json.dumps(req))

        call_id = None
        while True:
            msg = json.loads(await ws.recv())
            print("Recv:", json.dumps(msg)[:200])
            if "toolCall" in msg:
                calls = msg["toolCall"]["functionCalls"]
                print("Tool call received:", calls)
                call_id = calls[0]["id"]
                break
            if "serverContent" in msg and msg["serverContent"].get("turnComplete"):
                break

        if call_id:
            tool_resp = {
                "toolResponse": {
                    "functionResponses": [{
                        "id": call_id,
                        "response": {"output": {"content": "name: talking-to-antigravity"}}
                    }]
                }
            }
            print("Sending tool response:", tool_resp)
            await ws.send(json.dumps(tool_resp))

            # Read response after tool
            while True:
                msg = json.loads(await ws.recv())
                print("After tool msg:", json.dumps(msg)[:200])
                if "serverContent" in msg and msg["serverContent"].get("turnComplete"):
                    print("Turn completed successfully after tool response!")
                    break

asyncio.run(test_tool())
