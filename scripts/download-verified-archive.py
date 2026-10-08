#!/usr/bin/env python3
"""Download a bounded public archive and verify it before it can be installed."""

import argparse
import hashlib
from pathlib import Path
import re
import urllib.parse
import urllib.request


class HTTPSRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise ValueError("Archive redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_archive(url):
    opener = urllib.request.build_opener(HTTPSRedirectHandler())
    return opener.open(url, timeout=60)


def download(url, output, size, sha512):
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("Archive URL must use HTTPS")
    if size <= 0 or not re.fullmatch(r"[0-9a-f]{128}", sha512):
        raise ValueError("Invalid archive size or SHA-512")
    output = Path(output)
    created = False
    try:
        with output.open("xb") as target:
            created = True
            digest = hashlib.sha512()
            total = 0
            with open_archive(url) as source:
                if urllib.parse.urlsplit(source.geturl()).scheme != "https":
                    raise ValueError("Archive redirect must use HTTPS")
                while chunk := source.read(65536):
                    total += len(chunk)
                    if total > size:
                        raise ValueError("Archive exceeds the pinned size")
                    digest.update(chunk)
                    target.write(chunk)
            if total != size or digest.hexdigest() != sha512:
                raise ValueError("Archive size or SHA-512 differs from the pinned package")
    except BaseException:
        if created:
            output.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("output")
    parser.add_argument("size", type=int)
    parser.add_argument("sha512")
    args = parser.parse_args()
    download(args.url, args.output, args.size, args.sha512)


if __name__ == "__main__":
    main()
