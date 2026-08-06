import json
import sys
import subprocess
import urllib.request
import uvicorn

LATEST_VERSION_TAG = "alpha-0.0.0.2"

def get_npm_command() -> str:
    return "npm.cmd" if sys.platform.startswith("win") else "npm"

def get_latest_release_tag() -> str | None:
    url = "https://api.github.com/repos/aegisvox/AegisVox/releases/latest"
    headers = {"User-Agent": "AegisVoxLauncher/1.0"}

    try:
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status != 200:
                return None
            data = json.loads(response.read().decode("utf-8"))
            return data.get("tag_name")
    except Exception:
        return None

def main():
    print("=" * 64)
    print("   🌟 GEMMALIVE: HYBRID CLOUD & LOCAL AI LAUNCHER 🌟")
    print("=" * 64)

    latest_tag = get_latest_release_tag()
    if latest_tag:
        if latest_tag == LATEST_VERSION_TAG:
            print(f"✅ Local version tag ({LATEST_VERSION_TAG}) matches latest release.")
        else:
            print(f"⚠️  Local version tag ({LATEST_VERSION_TAG}) does not match latest release ({latest_tag}).")
    else:
        print("⚠️  Unable to fetch latest release tag from GitHub.")

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
