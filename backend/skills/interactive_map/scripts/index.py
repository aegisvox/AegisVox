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
        print(json.dumps({
            "success": True,
            "data": {
                "location": location,
                "map_url": f"https://www.google.com/maps?q={encoded_location}&output=embed"
            }
        }))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()
