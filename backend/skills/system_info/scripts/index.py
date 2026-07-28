import sys
import json
import platform
import shutil
import os

def get_system_stats(target="all"):
    stats = {
        "platform": f"{platform.system()} {platform.release()} ({platform.architecture()[0]})",
        "python_version": platform.python_version()
    }

    # Disk Space (Standard Library)
    if target in ["all", "disk"]:
        total, used, free = shutil.disk_usage("/")
        stats["disk"] = {
            "total_gb": round(total / (1024**3), 2),
            "used_gb": round(used / (1024**3), 2),
            "free_gb": round(free / (1024**3), 2),
            "used_percent": round((used / total) * 100, 1)
        }

    # Attempt to load extended stats via psutil if installed
    try:
        import psutil

        if target in ["all", "cpu"]:
            stats["cpu"] = {
                "usage_percent": psutil.cpu_percent(interval=0.5),
                "cores_logical": psutil.cpu_count(logical=True),
                "cores_physical": psutil.cpu_count(logical=False)
            }

        if target in ["all", "memory"]:
            mem = psutil.virtual_memory()
            stats["memory"] = {
                "total_gb": round(mem.total / (1024**3), 2),
                "available_gb": round(mem.available / (1024**3), 2),
                "used_percent": mem.percent
            }

    except ImportError:
        # Fallback if psutil is not installed
        if target in ["all", "cpu"]:
            stats["cpu"] = {"usage_percent": "psutil not installed"}
        if target in ["all", "memory"]:
            stats["memory"] = {"status": "Install 'psutil' package for memory metrics"}

    return stats

def main():
    try:
        # Read JSON payload passed from AgentTools via sys.argv[1]
        raw_payload = sys.argv[1] if len(sys.argv) > 1 else '{}'
        params = json.loads(raw_payload)
        
        target = params.get("target", "all")
        result = get_system_stats(target)

        # Output JSON result to stdout for AgentTools to capture
        print(json.dumps({"success": True, "data": result}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()