# Demo recordings with video-use

The local editing integration uses
[browser-use/video-use](https://github.com/browser-use/video-use/tree/9575612f066aa517354790a645fd90f9f95a743b),
installed as the Codex `video-use` skill. It is available on the next Codex turn.
The player runtime and published player bundle do not include this editing tool.

## Record a useful scenario

Use the public demo provider and a clean profile. Suggested short recordings:

- First launch → Try demo → switch a channel → return to the guide.
- Find a programme in EPG → open programme details → return to playback.
- Open Remote control settings and explain the connection using dummy values.

Store recordings under `.local-artifacts/demo-video/`, which is ignored by Git.
Never put real provider URLs, access codes or account settings into a public demo.

```sh
python3 scripts/demo_video.py doctor
python3 scripts/demo_video.py prepare .local-artifacts/demo-video/screen.mp4
# Ask the video-use skill to edit this recording for the selected scenario.
# Review .local-artifacts/demo-video/edit/edl.json before rendering.
python3 scripts/demo_video.py render .local-artifacts/demo-video/edit/edl.json
python3 scripts/demo_video.py render .local-artifacts/demo-video/edit/edl.json --final
```

Preparation creates a full-length cut list and session notes without modifying
the source. All outputs remain in the source folder's `edit/` directory. Existing
outputs require `--overwrite`; preparation never replaces an existing session.
Rendering is local. Nothing is published or added to a release automatically.

Speech transcription is optional and needs `ELEVENLABS_API_KEY` in the environment
or the skill's private `.env` file. It sends audio to ElevenLabs and can incur
provider charges. Local cuts and rendering work without this key. Do not paste
keys into tracked project files. The wrapper never initiates transcription.

## Reproduce the installation

The current machine has the skill and Python runtime in
`~/.codex/skills/video-use`. On another machine, clone the upstream repo into a
dedicated directory, check out commit
`9575612f066aa517354790a645fd90f9f95a743b`, install its Python dependencies with
`uv sync --python 3.12`, and install FFmpeg. Write that commit ID to
`UPSTREAM_REVISION` inside the checkout and set `VIDEO_USE_HOME` to its path.
Register its `SKILL.md` with the agent; keep `helpers/` beside it. Do not silently
update the pinned revision; review helper changes first.
