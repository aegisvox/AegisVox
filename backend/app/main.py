import json
import re
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.app.services.stt_service import STTService
from backend.app.services.llm_service import LLMService
from backend.app.services.tts_service import TTSService
from backend.app.services.skill_manager import SkillManager
from backend.app.services.agent_tools import AgentTools

app = FastAPI(title="GemmaLive Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize offline services
stt = STTService()
llm = LLMService()
tts = TTSService()

# Initialize Agent Skills
skill_manager = SkillManager(skills_dir="backend/skills")
agent_tools = AgentTools(skill_manager)

BASE_SYSTEM_PROMPT = "You are GemmaLive, an intelligent local voice assistant. Keep answers concise and direct."

def get_combined_prompt(user_query: str) -> str:
    """Combines system instructions, available skill capabilities, and the user prompt."""
    skills_context = skill_manager.get_system_prompt_injection()
    return f"{BASE_SYSTEM_PROMPT}\n{skills_context}\n\nUser Question: {user_query}"


@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("⚡ [WebSocket] Client Connected!")
    
    # Reload skills in case new SKILL.md files were added
    skill_manager.reload_skills()
    
    # 🎙️ Set default voice for this user session
    current_voice = "af_heart"
    
    try:
        while True:
            message = await websocket.receive()
            user_text = ""
            
            # --- 1. HANDLE TEXT & VOICE CONFIGURATION ---
            if message.get("text"):
                raw_text = message["text"].strip()
                
                try:
                    payload = json.loads(raw_text)
                    
                    # Voice Switch Command: {"type": "config", "voice": "bm_george"}
                    if payload.get("type") == "config" and payload.get("voice"):
                        current_voice = payload["voice"]
                        print(f"🗣️ [Voice Changed] Active voice switched to: {current_voice}")
                        continue
                        
                    # Text Prompt: {"type": "prompt", "text": "Hello!", "voice": "..."}
                    elif payload.get("type") == "prompt" and payload.get("text"):
                        user_text = payload["text"]
                        if payload.get("voice"):
                            current_voice = payload["voice"]
                            
                except json.JSONDecodeError:
                    user_text = raw_text
                
                print(f"⌨️ [Text Input] {user_text} | Active Voice: {current_voice}")
                
            # --- 2. HANDLE MICROPHONE AUDIO BYTES ---
            elif message.get("bytes"):
                audio_bytes = message["bytes"]
                user_text = stt.transcribe_bytes(audio_bytes)
                print(f"🎙️ [Voice Transcribed] {user_text}")
                await websocket.send_json({"type": "transcript", "text": user_text})
                
            if not user_text:
                continue
                
            # --- 3. GENERATE AI RESPONSE & INTERCEPT AGENT SKILLS ---
            print(f"🤖 [Gemma Answer Generated] Processing turn...")
            
            # A. First LLM Pass with skill instructions appended
            full_prompt = get_combined_prompt(user_text)
            raw_ai_reply = llm.generate_response(full_prompt)
            
            # B. Check if the LLM output a skill execution request
            tool_match = re.search(r'\{"tool_call":\s*"run_script".*?\}', raw_ai_reply, re.DOTALL)
            
            if tool_match:
                try:
                    tool_data = json.loads(tool_match.group(0))
                    skill_name = tool_data.get("skill")
                    script_name = tool_data.get("script")
                    script_params = tool_data.get("data", {})
                    
                    print(f"⚙️ [Executing Skill] Skill: '{skill_name}' | Script: '{script_name}'")
                    
                    # Execute the script via subprocess sandbox
                    success, script_output = agent_tools.run_script(
                        skill_name=skill_name,
                        script_name=script_name,
                        data=script_params
                    )
                    
                    print(f"📊 [Skill Result] {script_output}")
                    
                    # Second LLM Pass: Feed script outcome back to LLM to construct final answer
                    followup_prompt = (
                        f"The user asked: '{user_text}'.\n"
                        f"You executed skill '{skill_name}' and got result:\n{script_output}\n"
                        f"Summarize this answer in a conversational, spoken tone."
                    )
                    ai_reply = llm.generate_response(followup_prompt)

                except Exception as e:
                    print(f"⚠️ [Skill Execution Failed] {e}")
                    ai_reply = "I tried executing the requested skill, but encountered an error."
            else:
                ai_reply = raw_ai_reply

            # --- 4. STREAM SYNCHRONOUS TTS AUDIO & TEXT CHUNKS ---
            print(f"🗣️ [Streaming Sync Output] {ai_reply}")
            
            # Tell frontend to prepare an empty AI message bubble
            await websocket.send_json({"type": "response_start"})
            
            # Stream each sentence and its matching audio instantly
            for sentence_text, wav_bytes in tts.synthesize_stream(ai_reply, voice=current_voice):
                print(f"🗣️ [Streaming Chunk] {sentence_text}")
                
                # Send the text for this sentence first
                await websocket.send_json({
                    "type": "speech_chunk", 
                    "text": sentence_text
                })
                
                # Immediately send the audio bytes for this exact sentence
                await websocket.send_bytes(wav_bytes)
                
            # Tell frontend the AI has finished sending all chunks for this turn
            await websocket.send_json({"type": "response_end"})
            
    except WebSocketDisconnect:
        print("🛑 [WebSocket] Client Disconnected.")
    except Exception as e:
        print(f"⚠️ [WebSocket] Error during session: {e}")