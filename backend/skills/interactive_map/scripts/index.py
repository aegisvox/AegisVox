import sys
import json
from urllib.parse import quote


def main():
    try:
        raw_payload = sys.argv[1] if len(sys.argv) > 1 else '{}'
        params = json.loads(raw_payload)
        location = params.get("location", "")

        if not location:
            print(json.dumps({"success": False, "error": "No location provided."}))
            return

        encoded_location = quote(location)
        html = f"""
        <div class="rounded-[20px] border border-cyan-400/20 bg-slate-900/90 text-slate-100">
          <iframe
            src="https://www.google.com/maps?q={encoded_location}&output=embed"
            class="h-[220px] w-full rounded-[16px] border-0"
            loading="lazy"
            allowfullscreen
          ></iframe>
        </div>
        """
        print(json.dumps({
            "success": True,
            "mode": "bubble",
            "placement": "center",
            "html": html,
            "data": {
                "location": location,
                "map_url": f"https://www.google.com/maps?q={encoded_location}&output=embed"
            }
        }))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()
