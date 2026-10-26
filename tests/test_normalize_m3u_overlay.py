import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("overlay", Path(__file__).parents[1] / "scripts/normalize-m3u-overlay.py")
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.original = "https://source.example/live.m3u8"
        self.target = "https://media.example/normalize/play/demo/" + "a" * 40 + "/master.m3u8"

    def test_preserves_metadata_comments_other_urls_and_newlines(self):
        source = '#EXTM3U\r\n#EXTINF:-1 tvg-id="x" group-title="News",Sample\r\n' + self.original + '\r\n#EXTINF:-1,Other\r\nhttps://other.example/live.m3u8\r\n'
        result = overlay.overlay(source, {self.original: self.target})
        self.assertEqual(result, source.replace(self.original, self.target))

    def test_missing_or_duplicate_source_fails_closed(self):
        for source in ["#EXTM3U\n", self.original + "\n" + self.original + "\n"]:
            with self.assertRaises(ValueError):
                overlay.overlay(source, {self.original: self.target})

    def test_rejects_general_proxy_or_insecure_destination(self):
        for target in [self.target.replace("https:", "http:"), "https://media.example/proxy", self.target + "?admin=secret"]:
            with self.assertRaises(ValueError):
                overlay.overlay(self.original, {self.original: target})


if __name__ == "__main__":
    unittest.main()
