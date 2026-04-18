#!/usr/bin/env python3
"""Convert a PDF file to Markdown using marker-pdf."""
import sys
from pathlib import Path

from marker.converters.pdf import PdfConverter
from marker.models import create_model_dict


def convert(input_path: str, output_path: str) -> None:
    converter = PdfConverter(artifact_dict=create_model_dict())
    rendered = converter(input_path)
    Path(output_path).write_text(rendered.markdown, encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.pdf> <output.md>", file=sys.stderr)
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
