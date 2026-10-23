"""Render real CLI help as an SVG. Run from the repository root:

node bin/llm-bridge.mjs --help | python scripts/make-demo.py

The pipeline keeps process execution in the shell. This script reads stdout only;
it does not launch providers, inspect configuration, or make network requests.
"""

import argparse
import sys
from html import escape
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="Fail if docs/demo.svg needs regeneration."
    )
    args = parser.parse_args()
    if sys.stdin.isatty():
        raise SystemExit("Pipe CLI help into this script; see its module docstring.")
    # The CLI banner contains Unicode. Shells may transcode a pipeline to ASCII;
    # omit that banner so the SVG remains identical across Windows and POSIX.
    captured = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    lines = captured.replace("\r\n", "\n").splitlines()
    if (
        not lines
        or not lines[0].startswith("llm-bridge ")
        or "Usage:" not in lines
        or "Options:" not in lines
    ):
        raise SystemExit("Expected real output from node bin/llm-bridge.mjs --help.")
    start = lines.index("Usage:")
    excerpt = lines[start : start + 21]
    command = "$ node bin/llm-bridge.mjs --help"
    transcript = [command, "", *excerpt]
    width = 1056
    height = 112 + len(transcript) * 24
    rows = []
    for index, line in enumerate(transcript):
        color = "#7ee787" if index == 0 else "#e6edf3"
        if line in ("Usage:", "Options:"):
            color = "#79c0ff"
        rows.append(
            f'    <text x="28" y="{86 + index * 24}" fill="{color}">'
            f"{escape(line)}</text>"
        )
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title description">
  <title id="title">llm-bridge CLI help</title>
  <desc id="description">Real CLI output: usage and the first options from node bin/llm-bridge.mjs --help. The help banner and remaining options are omitted. No model is called.</desc>
  <rect x="1" y="1" width="{width - 2}" height="{height - 2}" rx="16" fill="#0d1117" stroke="#30363d" stroke-width="2"/>
  <path d="M17 2 H{width - 17} Q{width - 2} 2 {width - 2} 17 V48 H2 V17 Q2 2 17 2" fill="#161b22"/>
  <circle cx="26" cy="25" r="6" fill="#ff5f57"/>
  <circle cx="48" cy="25" r="6" fill="#febc2e"/>
  <circle cx="70" cy="25" r="6" fill="#28c840"/>
  <text x="{width // 2}" y="30" text-anchor="middle" fill="#b1bac4" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="13">llm-bridge / terminal</text>
  <g font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="16" xml:space="preserve">
{chr(10).join(rows)}
  </g>
  <text x="28" y="{height - 22}" fill="#b1bac4" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="12">CLI help excerpt / no model calls / zero runtime dependencies</text>
</svg>
'''
    target = Path(__file__).resolve().parents[1] / "docs" / "demo.svg"
    if args.check:
        if not target.exists() or target.read_bytes() != svg.encode("utf-8"):
            raise SystemExit("docs/demo.svg is stale; regenerate it with the documented command.")
        print("docs/demo.svg matches real CLI help (23 terminal lines).")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(svg, encoding="utf-8", newline="\n")
    print("Wrote docs/demo.svg from real CLI help (23 terminal lines).")


if __name__ == "__main__":
    main()
