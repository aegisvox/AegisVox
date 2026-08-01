import sys
import subprocess
import uvicorn

def get_npm_command() -> str:
    return "npm.cmd" if sys.platform.startswith("win") else "npm"

def main():
    print("=" * 64)
    print("   🌟 GEMMALIVE: HYBRID CLOUD & LOCAL AI LAUNCHER 🌟")
    print("=" * 64)

    npm_cmd = get_npm_command()
    print("🚀 [Master Controller] Spawning Next.js frontend on 0.0.0.0:3000...")
    next_process = subprocess.Popen([npm_cmd, "run", "dev"])

    try:
        print("⚡ [Master Controller] Starting Python Backend on 0.0.0.0:8000...")
        uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)

    except KeyboardInterrupt:
        print("\n🛑 [Master Controller] Interrupt signal caught. Shutting down...")

    finally:
        print("🧹 [Master Controller] Terminating Next.js server...")
        next_process.terminate()
        next_process.wait()
        print("✅ [Master Controller] All servers offline. Goodbye!")

if __name__ == "__main__":
    main()
