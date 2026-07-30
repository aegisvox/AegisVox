import json
import os
import re
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.app.services.permission_manager import PermissionManager
from backend.app.services.stt_service import STTService
from backend.app.services.llm_service import LLMService
from backend.app.services.tts_service import TTSService
from backend.app.services.skill_manager import SkillManager
from backend.app.services.agent_tools import AgentTools
from backend.app.services.tool_call_parser import extract_tool_call

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
permission_manager = PermissionManager(
    config_path=os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", ".aegisvox")
    )
)

BASE_SYSTEM_PROMPT = "You are GemmaLive, an intelligent local voice assistant. Keep answers concise and direct."

def get_combined_prompt(user_query: str) -> str:
    """Combines system instructions, available skill capabilities, and the user prompt."""
    skills_context = skill_manager.get_system_prompt_injection()
    return f"{BASE_SYSTEM_PROMPT}\n{skills_context}\n\nUser Question: {user_query}"


async def stream_assistant_reply(websocket: WebSocket, ai_reply: str, voice: str) -> None:
    await websocket.send_json({"type": "response_start"})

    for sentence_text, wav_bytes in tts.synthesize_stream(ai_reply, voice=voice):
        await websocket.send_json({"type": "speech_chunk", "text": sentence_text})
        await websocket.send_bytes(wav_bytes)

    await websocket.send_json({"type": "response_end"})


async def execute_skill_request(
    websocket: WebSocket,
    *,
    user_text: str,
    skill_name: str,
    script_name: str,
    script_params: dict,
    voice: str,
) -> tuple[Optional[str], bool]:
    skill = skill_manager.skills.get(skill_name)
    if skill:
        for permission in skill.permissions:
            permission_details = skill.permission_definitions.get(permission, {})
            requires_authorization = bool(permission_details.get("authorizationRequired", False))
            if not requires_authorization:
                continue

            token = script_params.pop("grant_token", None)
            stored_token = permission_manager.get_grant_token(skill_name, permission)
            if not token and stored_token:
                token = stored_token

            if not permission_manager.is_permission_granted(skill_name, permission, token or ""):
                await websocket.send_json({
                    "type": "permission_required",
                    "skill": skill_name,
                    "permission": permission,
                    "message": permission_details.get(
                        "authorizationMessage",
                        f"{skill_name} needs permission to continue."
                    ),
                })
                return None, True

    print(f"⚙️ [Executing Skill] Skill: '{skill_name}' | Script: '{script_name}'")
    await websocket.send_json({
        "type": "skill_start",
        "name": skill_name,
        "description": f"Opening {skill_name.replace('-', ' ')} view..."
    })

    success, script_output = agent_tools.run_script(
        skill_name=skill_name,
        script_name=script_name,
        data=script_params
    )

    if not success:
        print(f"⚠️ [Skill Execution Failed] {script_output}")
        await websocket.send_json({
            "type": "skill_end",
            "name": skill_name,
            "output": json.dumps({"success": False, "error": script_output})
        })
        return f"I tried to run the requested skill, but it failed: {script_output}", False

    print(f"📊 [Skill Result] {script_output}")
    await websocket.send_json({
        "type": "skill_end",
        "name": skill_name,
        "output": script_output
    })

    followup_prompt = (
        f"The user asked: '{user_text}'.\n"
        f"You executed skill '{skill_name}' and got result:\n{script_output}\n"
        f"Summarize this answer in a conversational, spoken tone."
    )
    ai_reply = llm.generate_response(followup_prompt)
    return ai_reply, False


@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("⚡ [WebSocket] Client Connected!")
    
    # Reload skills in case new SKILL.md files were added
    skill_manager.reload_skills()
    
    # 🎙️ Set default voice for this user session
    current_voice = "af_heart"
    pending_skill_request: Optional[dict] = None
    
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

                    elif payload.get("type") == "get_device_code":
                        await websocket.send_json({
                            "type": "device_code",
                            "code": permission_manager.get_device_verification_code()
                        })
                        continue

                    elif payload.get("type") == "grant_permission":
                        skill_name = payload.get("skill")
                        permission = payload.get("permission")
                        verification_code = payload.get("verification_code")
                        if not skill_name or not permission or not verification_code:
                            continue

                        token = permission_manager.grant_permission(skill_name, permission, verification_code)
                        if token:
                            await websocket.send_json({
                                "type": "permission_granted",
                                "skill": skill_name,
                                "permission": permission,
                                "grant_token": token
                            })
                            if pending_skill_request is not None:
                                request = pending_skill_request
                                pending_skill_request = None
                                ai_reply, permission_required = await execute_skill_request(
                                    websocket,
                                    user_text=request["user_text"],
                                    skill_name=request["skill_name"],
                                    script_name=request["script_name"],
                                    script_params=request["script_params"],
                                    voice=current_voice,
                                )
                                if permission_required:
                                    continue
                                if ai_reply is not None:
                                    await stream_assistant_reply(websocket, ai_reply, current_voice)
                                continue
                        else:
                            await websocket.send_json({
                                "type": "permission_denied",
                                "skill": skill_name,
                                "permission": permission
                            })
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
            tool_data = extract_tool_call(raw_ai_reply)
            
            if tool_data:
                try:
                    skill_name = tool_data.get("skill")
                    script_name = tool_data.get("script")
                    script_params = dict(tool_data.get("data", {}) or {})

                    pending_skill_request = {
                        "user_text": user_text,
                        "skill_name": skill_name,
                        "script_name": script_name,
                        "script_params": script_params,
                    }
                    ai_reply, permission_required = await execute_skill_request(
                        websocket,
                        user_text=user_text,
                        skill_name=skill_name,
                        script_name=script_name,
                        script_params=script_params,
                        voice=current_voice,
                    )
                    if permission_required:
                        continue

                except Exception as e:
                    print(f"⚠️ [Skill Execution Failed] {e}")
                    ai_reply = "I tried executing the requested skill, but encountered an error."
            else:
                ai_reply = raw_ai_reply

            # --- 4. STREAM SYNCHRONOUS TTS AUDIO & TEXT CHUNKS ---
            print(f"🗣️ [Streaming Sync Output] {ai_reply}")
            await stream_assistant_reply(websocket, ai_reply, current_voice)
            
    except WebSocketDisconnect:
        print("🛑 [WebSocket] Client Disconnected.")
    except Exception as e:
        print(f"⚠️ [WebSocket] Error during session: {e}")