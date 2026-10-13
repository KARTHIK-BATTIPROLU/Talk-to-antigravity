#!/usr/bin/env python3
"""
Audio Capture Engine for Windows / Cross-platform.
Captures 16kHz 16-bit mono PCM using sounddevice and streams to stdout.
"""

import sys
import os
import json
import base64
import math
import argparse
import threading

try:
    import numpy as np
except ImportError:
    np = None

def calculate_rms(data_bytes):
    """Calculates RMS volume level normalized roughly 0.0 - 1.0."""
    if not data_bytes or np is None:
        return 0.0
    samples = np.frombuffer(data_bytes, dtype=np.int16)
    if len(samples) == 0:
        return 0.0
    rms = np.sqrt(np.mean(samples.astype(np.float64) ** 2))
    normalized = min(1.0, float(rms) / 10000.0)
    return round(normalized, 3)

def main():
    parser = argparse.ArgumentParser(description="Real-time 16kHz PCM audio capture engine")
    parser.add_argument("--rate", type=int, default=16000, help="Sample rate (default: 16000)")
    parser.add_argument("--channels", type=int, default=1, help="Channels (default: 1)")
    parser.add_argument("--block-ms", type=int, default=100, help="Block duration in ms (default: 100)")
    parser.add_argument("--device", type=int, default=None, help="Input device index")
    parser.add_argument("--format", type=str, default="json", choices=["json", "raw"], help="Output format")
    args = parser.parse_args()

    # If windows binary mode needed for raw output
    if sys.platform == "win32" and hasattr(msvcrt := __import__("msvcrt"), "setmode"):
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)

    try:
        import sounddevice as sd
        import numpy as np
    except ImportError as e:
        sys.stderr.write(json.dumps({"type": "error", "message": f"Missing library: {e}"}) + "\n")
        sys.stderr.flush()
        sys.exit(1)

    blocksize = int(args.rate * (args.block_ms / 1000.0))
    is_paused = False
    is_muted = False
    running = True

    def stdin_listener():
        nonlocal is_paused, is_muted, running
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
                cmd = msg.get("command")
                if cmd == "stop":
                    running = False
                    break
                elif cmd == "pause":
                    is_paused = True
                elif cmd == "resume":
                    is_paused = False
                elif cmd == "mute":
                    is_muted = True
                elif cmd == "unmute":
                    is_muted = False
            except Exception:
                pass

    t = threading.Thread(target=stdin_listener, daemon=True)
    t.start()

    try:
        device_info = sd.query_devices(args.device, 'input')
        sys.stderr.write(json.dumps({
            "type": "ready",
            "device": device_info.get("name", "default"),
            "rate": args.rate,
            "channels": args.channels,
            "blocksize": blocksize
        }) + "\n")
        sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(json.dumps({"type": "error", "message": f"Device query error: {e}"}) + "\n")
        sys.stderr.flush()

    def audio_callback(indata, frames, time_info, status):
        if status:
            sys.stderr.write(json.dumps({"type": "status", "message": str(status)}) + "\n")
            sys.stderr.flush()
        if is_paused or not running:
            return

        pcm_data = indata.tobytes()
        if is_muted:
            pcm_data = b'\x00' * len(pcm_data)

        if args.format == "raw":
            sys.stdout.buffer.write(pcm_data)
            sys.stdout.buffer.flush()
        else:
            b64 = base64.b64encode(pcm_data).decode("ascii")
            rms = calculate_rms(pcm_data) if not is_muted else 0.0
            out_msg = json.dumps({"type": "pcm", "data": b64, "rms": rms}) + "\n"
            sys.stdout.write(out_msg)
            sys.stdout.flush()

    try:
        with sd.InputStream(
            samplerate=args.rate,
            channels=args.channels,
            dtype='int16',
            blocksize=blocksize,
            device=args.device,
            callback=audio_callback
        ):
            while running:
                sd.sleep(50)
    except Exception as e:
        sys.stderr.write(json.dumps({"type": "error", "message": str(e)}) + "\n")
        sys.stderr.flush()
        sys.exit(1)

if __name__ == "__main__":
    main()
