import json
import time
import sys
import websocket

CDP_URL = "ws://127.0.0.1:9222/devtools/page/31C0AB0CE2EA25A809BF984BD6B9C997"

class CDPClient:
    def __init__(self):
        self.ws = websocket.create_connection(CDP_URL)
        self.msg_id = 0

    def send(self, method, params=None):
        self.msg_id += 1
        msg = {"id": self.msg_id, "method": method}
        if params:
            msg["params"] = params
        self.ws.send(json.dumps(msg))
        while True:
            resp = json.loads(self.ws.recv())
            if resp.get("id") == self.msg_id:
                return resp

    def evaluate(self, expression):
        result = self.send("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        })
        if "result" in result and "result" in result["result"]:
            return result["result"]["result"].get("value")
        return result

    def screenshot(self, filename):
        result = self.send("Page.captureScreenshot", {"format": "png"})
        if "result" in result and "data" in result["result"]:
            import base64
            with open(filename, "wb") as f:
                f.write(base64.b64decode(result["result"]["data"]))
            return f"Saved to {filename}"
        return result

    def close(self):
        self.ws.close()

if __name__ == "__main__":
    client = CDPClient()
    try:
        cmd = sys.argv[1] if len(sys.argv) > 1 else "snapshot"

        if cmd == "click":
            selector = sys.argv[2]
            expr = f"""
            (function() {{
                const el = document.querySelector('{selector}');
                if (el) {{ el.click(); return 'clicked: ' + el.textContent; }}
                return 'not found: {selector}';
            }})()
            """
            print(client.evaluate(expr))

        elif cmd == "eval":
            expr = sys.argv[2]
            print(client.evaluate(expr))

        elif cmd == "screenshot":
            filename = sys.argv[2] if len(sys.argv) > 2 else "screenshot.png"
            print(client.screenshot(filename))

        elif cmd == "snapshot":
            expr = """
            (function() {
                const body = document.body;
                function describe(el, depth=0) {
                    if (depth > 4) return '';
                    let result = '';
                    const tag = el.tagName ? el.tagName.toLowerCase() : '#text';
                    const text = el.textContent ? el.textContent.trim().substring(0, 50) : '';
                    const cls = el.className ? '.' + (typeof el.className === 'string' ? el.className.split(' ').join('.') : '') : '';
                    const id = el.id ? '#' + el.id : '';
                    const role = el.getAttribute ? el.getAttribute('role') : '';
                    const ariaLabel = el.getAttribute ? el.getAttribute('aria-label') : '';
                    const visible = el.offsetParent !== null || el.style.display !== 'none';
                    if (visible || depth < 2) {
                        const info = [tag, id, cls, role ? `[role=${role}]` : '', ariaLabel ? `[aria-label=${ariaLabel}]` : '', text ? `="${text}"` : ''].filter(Boolean).join('');
                        result += '  '.repeat(depth) + info + '\\n';
                        if (el.children) {
                            for (const child of el.children) {
                                result += describe(child, depth + 1);
                            }
                        }
                    }
                    return result;
                }
                return describe(body);
            })()
            """
            print(client.evaluate(expr))

        elif cmd == "press":
            key = sys.argv[2]
            result = client.send("Input.dispatchKeyEvent", {
                "type": "keyDown",
                "key": key,
                "code": key,
                "windowsVirtualKeyCode": ord(key[0]) if len(key) == 1 else 0
            })
            result2 = client.send("Input.dispatchKeyEvent", {
                "type": "keyUp",
                "key": key,
                "code": key,
                "windowsVirtualKeyCode": ord(key[0]) if len(key) == 1 else 0
            })
            print(f"Pressed: {key}")

        elif cmd == "type":
            text = sys.argv[2]
            for char in text:
                client.send("Input.dispatchKeyEvent", {
                    "type": "keyDown",
                    "key": char,
                    "text": char
                })
                client.send("Input.dispatchKeyEvent", {
                    "type": "keyUp",
                    "key": char
                })
            print(f"Typed: {text}")

        else:
            print(f"Unknown command: {cmd}")

    finally:
        client.close()