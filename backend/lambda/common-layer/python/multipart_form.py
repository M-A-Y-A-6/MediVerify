"""
Minimal multipart/form-data parser.

API Gateway (REST API) delivers the raw multipart body to Lambda (base64
encoded when binaryMediaTypes includes multipart/form-data). We only need
to pull out a single uploaded file, so a small hand-rolled parser avoids
pulling in extra Lambda layers/dependencies for something Python's stdlib
doesn't do out of the box.
"""
import re
from typing import Optional, Tuple

FILENAME_RE = re.compile(rb'filename="([^"]*)"')
NAME_RE = re.compile(rb'name="([^"]*)"')


def extract_file(body: bytes, content_type: str) -> Tuple[Optional[str], Optional[bytes]]:
    """
    Returns (filename, file_bytes) for the first file field found in a
    multipart/form-data body, or (None, None) if none is present.
    """
    if not content_type or "boundary=" not in content_type:
        return None, None

    boundary = content_type.split("boundary=")[-1].strip().strip('"').encode()
    delimiter = b"--" + boundary

    for raw_part in body.split(delimiter):
        part = raw_part.strip(b"\r\n")
        if not part or part in (b"--", b""):
            continue
        if b"Content-Disposition" not in part:
            continue

        header, sep, content = part.partition(b"\r\n\r\n")
        if not sep:
            continue

        filename_match = FILENAME_RE.search(header)
        if not filename_match:
            # This is a regular form field, not a file part; skip it.
            continue

        filename = filename_match.group(1).decode(errors="replace") or "upload.png"
        # Strip the trailing CRLF that precedes the next boundary marker.
        file_bytes = content[:-2] if content.endswith(b"\r\n") else content
        return filename, file_bytes

    return None, None


def extract_field(body: bytes, content_type: str, field_name: str) -> Optional[str]:
    """Extract a plain text field (non-file) from a multipart body, if present."""
    if not content_type or "boundary=" not in content_type:
        return None

    boundary = content_type.split("boundary=")[-1].strip().strip('"').encode()
    delimiter = b"--" + boundary

    for raw_part in body.split(delimiter):
        part = raw_part.strip(b"\r\n")
        if not part or b"Content-Disposition" not in part:
            continue
        header, sep, content = part.partition(b"\r\n\r\n")
        if not sep:
            continue
        name_match = NAME_RE.search(header)
        if name_match and name_match.group(1).decode() == field_name and b"filename=" not in header:
            value = content[:-2] if content.endswith(b"\r\n") else content
            return value.decode(errors="replace")

    return None
