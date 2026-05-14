#!/usr/bin/env python3
import re
import subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPERS_FILE = ROOT / "app" / "lib" / "supers.ts"
FONT_FILE = ROOT / "app" / "assets" / "fonts" / "SourceSans3-Black.ttf"
FFMPEG_BIN = ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg"
OUTPUT_DIR = ROOT / "reviews" / f"super1-examples-{date.today().isoformat()}"

FRAME_WIDTH = 1080
FRAME_HEIGHT = 1920
MAX_TEXT_WIDTH_RATIO = 0.76
INITIAL_FONT_RATIO = 0.172
MIN_FONT_SIZE = 92
MAX_FONT_SIZE = 212
LINE_STEP_RATIO = 1.06
VERTICAL_CENTER_RATIO = 0.63


def parse_examples():
    content = SUPERS_FILE.read_text(encoding="utf-8")
    pattern = re.compile(
        r'\{\s*product:\s*"([^"]+)",\s*rtbKey:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*line1:\s*"([^"]+)",\s*line2:\s*"([^"]+)",',
        re.S,
    )
    return [
        {
            "product": product,
            "rtb_key": rtb_key,
            "label": label,
            "line1": line1,
            "line2": line2,
        }
        for product, rtb_key, label, line1, line2 in pattern.findall(content)
    ]


def escape_drawtext(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", r"\'")
        .replace("%", r"\%")
    )


def measure_width(text: str, font_size: int) -> int:
    filter_graph = (
        "color=c=black@0.0:s=2400x240:d=0.04,"
        "format=rgba,"
        f"drawtext=fontfile='{escape_drawtext(str(FONT_FILE))}':"
        "expansion=none:"
        f"text='{escape_drawtext(text)}':"
        "fontcolor=white:"
        f"fontsize={font_size}:"
        "x=10:y=100,"
        "bbox"
    )
    result = subprocess.run(
        [
            str(FFMPEG_BIN),
            "-v",
            "info",
            "-f",
            "lavfi",
            "-i",
            filter_graph,
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    match = re.search(r"(?:\bcrop=(\d+):(\d+):\d+:\d+)|(?:\bw:(\d+)\b.*\bh:(\d+)\b)", result.stderr)
    return int(match.group(1) or match.group(3) or 0) if match else 0


def fit_font_size(line1: str, line2: str) -> int:
    max_width = max(460, round(FRAME_WIDTH * MAX_TEXT_WIDTH_RATIO))
    font_size = max(126, min(MAX_FONT_SIZE, round(FRAME_WIDTH * INITIAL_FONT_RATIO)))
    while font_size > MIN_FONT_SIZE:
        line1_width = measure_width(line1, font_size)
        line2_width = measure_width(line2, font_size)
        if max(line1_width, line2_width) <= max_width:
            return font_size
        font_size -= 2
    return MIN_FONT_SIZE


def render_preview(entry):
    font_size = fit_font_size(entry["line1"], entry["line2"])
    line_step = round(font_size * LINE_STEP_RATIO)
    block_height = font_size + line_step
    center_y = round(FRAME_HEIGHT * VERTICAL_CENTER_RATIO)
    line1_y = round(center_y - block_height / 2)
    line2_y = line1_y + line_step
    target = OUTPUT_DIR / f"{entry['product']}--{entry['rtb_key']}.png"
    filter_graph = ",".join(
        [
            f"drawtext=fontfile='{escape_drawtext(str(FONT_FILE))}':expansion=none:text='{escape_drawtext(entry['line1'])}':fontcolor=white:fontsize={font_size}:x=(w-text_w)/2:y={line1_y}",
            f"drawtext=fontfile='{escape_drawtext(str(FONT_FILE))}':expansion=none:text='{escape_drawtext(entry['line2'])}':fontcolor=white:fontsize={font_size}:x=(w-text_w)/2:y={line2_y}",
        ]
    )
    subprocess.run(
        [
            str(FFMPEG_BIN),
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black:s={FRAME_WIDTH}x{FRAME_HEIGHT}:d=0.1",
            "-vf",
            filter_graph,
            "-frames:v",
            "1",
            "-update",
            "1",
            str(target),
        ],
        check=True,
    )
    return target.name, font_size


def write_readme(entries, renders):
    lines = [
        "# Super1 Examples",
        "",
        f"- Generated: {date.today().isoformat()}",
        f"- Font: `{FONT_FILE}`",
        "- Style: centered stacked white uppercase on black background",
        "",
        "| Label | File | Font size |",
        "|---|---|---:|",
    ]
    for entry, (file_name, font_size) in zip(entries, renders):
        lines.append(f"| {entry['label']} | `{file_name}` | {font_size} |")
    (OUTPUT_DIR / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    if not FONT_FILE.exists():
        raise SystemExit(f"Font file missing: {FONT_FILE}")
    if not FFMPEG_BIN.exists():
        raise SystemExit(f"ffmpeg binary missing: {FFMPEG_BIN}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    entries = parse_examples()
    renders = [render_preview(entry) for entry in entries]
    write_readme(entries, renders)
    print(OUTPUT_DIR)


if __name__ == "__main__":
    main()
