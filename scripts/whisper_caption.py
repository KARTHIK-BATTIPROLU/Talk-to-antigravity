import sys
import os
os.environ["KMP_DUPLICATE_LIB_OK"]="TRUE"
import json
import base64
import collections
import webrtcvad
import numpy as np
from faster_whisper import WhisperModel
from concurrent.futures import ThreadPoolExecutor

def main():
    model = WhisperModel(model_size_or_path="base", device="cpu", compute_type="int8")
    vad = webrtcvad.Vad(3)
    
    executor = ThreadPoolExecutor(max_workers=1)
    
    sample_rate = 16000
    frame_duration_ms = 30
    frame_size = int(sample_rate * (frame_duration_ms / 1000.0) * 2) # 16-bit = 2 bytes per sample
    
    buffer = bytearray()
    speech_buffer = bytearray()
    
    is_speaking = False
    silence_frames = 0
    max_silence_frames = int(400 / frame_duration_ms) # 400ms silence
    
    def transcribe(pcm_bytes):
        if len(pcm_bytes) == 0:
            return
        
        audio_data = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = model.transcribe(
            audio_data, 
            beam_size=1, 
            language="en", 
            vad_filter=True, 
            vad_parameters={"min_silence_duration_ms": 400}
        )
        
        text = " ".join([segment.text for segment in segments]).strip()
        if text:
            sys.stdout.write(json.dumps({"type": "caption", "text": text, "is_final": True}) + "\n")
            sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
            
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
            
        if msg.get("command") == "interrupt":
            speech_buffer.clear()
            buffer.clear()
            is_speaking = False
            silence_frames = 0
            continue
            
        if msg.get("type") == "pcm":
            data = base64.b64decode(msg["data"])
            buffer.extend(data)
            
            while len(buffer) >= frame_size:
                frame = buffer[:frame_size]
                buffer = buffer[frame_size:]
                
                is_speech = vad.is_speech(frame, sample_rate)
                
                if is_speech:
                    is_speaking = True
                    silence_frames = 0
                    speech_buffer.extend(frame)
                else:
                    if is_speaking:
                        silence_frames += 1
                        speech_buffer.extend(frame)
                        
                        if silence_frames >= max_silence_frames:
                            is_speaking = False
                            executor.submit(transcribe, bytes(speech_buffer))
                            speech_buffer.clear()
                            silence_frames = 0
                    else:
                        pass # discard silence before speech

if __name__ == "__main__":
    main()
