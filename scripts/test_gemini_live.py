#!/usr/bin/env python3
"""
Test Gemini 2.0 / 2.5 Multimodal Live WebSocket connection.
Sends setup frame, verifies setupComplete, and performs a live interaction test.
"""

import sys
import os
import json
import asyncio
import websockets

API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = os.environ.get("GEMINI_MODEL", "models/gemini-2.5-flash-native-audio-latest")
ENDPOINT = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={API_KEY}"

async def test_live_session():
    print(f"Connecting to Gemini Live WebSocket: {ENDPOINT[:75]}...")
    try:
        async with websockets.connect(ENDPOINT) as ws:
            print("Connected! Sending setup frame...")

            setup_payload = {
                "setup": {
                    "model": MODEL,
                    "generationConfig": {
                        "responseModalities": ["AUDIO"],
                        "speechConfig": {
                            "voiceConfig": {
                                "prebuiltVoiceConfig": {
                                    "voiceName": "Puck"
                                }
                            }
                        }
                    },
                    "systemInstruction": {
                        "parts": [
                            {
                                "text": "You are Antigravity Voice Assistant. Respond concisely in spoken words."
                            }
                        ]
                    },
                    "tools": [
                        {
                            "functionDeclarations": [
                                {
                                    "name": "read_file",
                                    "description": "Read file contents",
                                    "parameters": {
                                        "type": "object",
                                        "properties": {
                                            "path": {"type": "string"}
                                        },
                                        "required": ["path"]
                                    }
                                }
                            ]
                        }
                    ]
                }
            }

            await ws.send(json.dumps(setup_payload))
            resp = await asyncio.wait_for(ws.recv(), timeout=10.0)
            data = json.loads(resp)
            print("Setup response:", data)

            if "setupComplete" in data:
                print(">>> Gemini Multimodal Live Setup Successful! <<<")

            # Send a prompt turn
            print("Sending text prompt: 'Hello Gemini, confirm voice pair programming link.'")
            turn_payload = {
                "clientContent": {
                    "turns": [
                        {
                            "role": "user",
                            "parts": [{"text": "Hello Gemini, confirm voice pair programming link."}]
                        }
                    ],
                    "turnComplete": True
                }
            }
            await ws.send(json.dumps(turn_payload))

            # Receive model turns
            print("Waiting for model response turns...")
            total_audio_bytes = 0
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=10.0)
                msg_data = json.loads(msg)
                server_content = msg_data.get("serverContent", {})

                if "modelTurn" in server_content:
                    for part in server_content["modelTurn"].get("parts", []):
                        if "text" in part:
                            print(f"[Model Text]: {part['text']}")
                        if "inlineData" in part:
                            chunk_len = len(part["inlineData"].get("data", ""))
                            total_audio_bytes += chunk_len
                            print(f"[Model Audio Chunk]: {chunk_len} b64 chars")

                if server_content.get("turnComplete"):
                    print(f"Turn complete! Total received audio b64 length: {total_audio_bytes}")
                    break

            print("Gemini Live Bidirectional Streaming Test Succeeded!")
            return True
    except Exception as e:
        print(f"Error during Gemini Live Test: {type(e).__name__}: {e}")
        return False

if __name__ == "__main__":
    success = asyncio.run(test_live_session())
    sys.exit(0 if success else 1)
