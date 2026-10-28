"""Pure source contracts for the hidden WK harness; no Rust/native execution."""
import json
from pathlib import Path
import re
import unittest

SOURCE = (Path(__file__).parent.parent / 'src-tauri/examples/favorites_storage_smoke.rs').read_text()


class NativeHarnessSourceTests(unittest.TestCase):
    def test_actual_rust_href_literal_policy(self):
        body = SOURCE.split('fn fixture_href(href: &str) -> bool {', 1)[1].split('\n    }', 1)[0].strip()
        match = re.fullmatch(r'matches!\(href, ("[^"\n]+"(?: \| "[^"\n]+")*)\)', body)
        self.assertIsNotNone(match, 'The Rust predicate must remain an exact literal match')
        allowed = {json.loads(item) for item in match.group(1).split(' | ')}
        self.assertEqual(allowed, {'tauri://localhost', 'tauri://localhost/index.html'})
        for value in ['tauri://localhost', 'tauri://localhost/index.html']:
            self.assertIn(value, allowed)
        for value in ['tauri://localhost/', 'tauri://localhost/index.html?x', 'tauri://localhost#x',
                      'tauri://user@localhost', 'tauri://localhost:80', 'tauri://other',
                      'tauri://localhost/foreign.html', 'http://localhost', 'null',
                      'tauri://localhost\n', 'tauri://LOCALHOST']:
            self.assertNotIn(value, allowed)

    def test_native_identity_stays_exact_and_each_view_pins_match(self):
        self.assertIn('value["origin"] == "tauri://localhost"', SOURCE)
        self.assertIn('value["href"].as_str().is_some_and(fixture_href)', SOURCE)
        loop = SOURCE.split('for label in LABELS {', 1)[1].split('let writer =', 1)[0]
        self.assertIn('evaluate(&view, "window.nativeSourcePins").await? == module_pins', loop)
        self.assertIn('"window.nativeSourcePins"', SOURCE)

    def test_cleanup_waits_for_actual_destroyed_then_main_loop(self):
        cleanup = SOURCE.split('async fn cleanup(', 1)[1].split('pub fn run()', 1)[0]
        order = ['view.destroy()', 'while DESTROYED.load', 'main_loop_release(app, deadline).await?',
                 'app.get_webview_window(label).is_none()', 'removeDataStoreForIdentifier_completionHandler']
        positions = [cleanup.index(value) for value in order]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('matches!(event, tauri::WindowEvent::Destroyed)', SOURCE)
        self.assertIn('DESTROYED.fetch_or(own_window_mask(window.label())', SOURCE)
        self.assertIn('CREATED.fetch_or(own_window_mask(label)', SOURCE)
        self.assertIn('CREATED.fetch_or(own_window_mask("reloaded")', SOURCE)

    def test_store_retries_share_deadline_and_exact_intent_uuid(self):
        cleanup = SOURCE.split('async fn cleanup(', 1)[1].split('pub fn run()', 1)[0]
        self.assertEqual(cleanup.count('Instant::now() + Duration::from_secs('), 1)
        self.assertIn('let deadline = Instant::now() + Duration::from_secs(30)', cleanup)
        self.assertIn('for slot in ["slot1", "slot2", "slot3", "slot4"]', cleanup)
        self.assertLess(cleanup.index('let identifier ='), cleanup.index('for attempt in 1..=40'))
        self.assertIn('data_store_identifier(&output.join(slot))', cleanup)
        self.assertIn('NSUUID::from_bytes(identifier)', cleanup)
        self.assertIn('timeout_at(tokio::time::Instant::from_std(deadline), receiver)', cleanup)
        self.assertIn('require(removed,', cleanup)
        self.assertIn('error.localizedDescription(), error.domain(), error.code()', cleanup)
        self.assertIn('"own_uuid_removal_attempts":attempts', cleanup)
        self.assertNotIn('allDataStoreIdentifiers', cleanup)
        self.assertNotIn('defaultDataStore', cleanup)

    def test_watchdog_and_failure_result_are_preserved(self):
        self.assertIn('tokio::time::sleep(Duration::from_secs(90)).await; handle.exit(1)', SOURCE)
        self.assertIn('if result.is_ok() && cleaned.is_ok() { 0 } else { 1 }', SOURCE)
        self.assertIn('report["own_named_stores_cleaned"] = json!(cleaned.is_ok())', SOURCE)
        self.assertIn('report["cleanup_error"] = json!(error)', SOURCE)


if __name__ == '__main__':
    unittest.main(verbosity=2)
