# MakeShort

[한국어](README.ko.md)

MakeShort is a local web app for editing YouTube clips, images, captions, and voiceovers on a timeline, then exporting vertical MP4 videos. A YouTube source is optional. The app interface follows the browser language: Korean for Korean browser settings and English otherwise.

### Screenshots

These screenshots show the editor from top to bottom.

**1. Video source and AI voice** — Optionally add a YouTube segment, choose a voice, age range, delivery style, and speed, then select which script lines to generate.

![YouTube video input and AI voice settings](screenshot/screenshot_01.png)

**2. Remotion preview and layers** — Preview the portrait video and edit text, image, and voice layers.

![Remotion preview and text, image, and voice layers](screenshot/screenshot_02.png)

**3. Timeline and export** — Adjust layer timing and position, then download or publish the rendered video.

![Timeline for editing video and overlays](screenshot/screenshot_03.png)

### Run locally

Requirements: Python 3.10+, Node.js, and FFmpeg. On macOS, install FFmpeg with `brew install ffmpeg`.

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm install
npm run build
python app.py
```

Open <http://127.0.0.1:8000>.

### Edit and export

- Start with a blank 9:16 timeline and add text, images, MP4/MOV files, or an optional YouTube clip.
- Choose whether to fill the frame and crop the sides (`fill`), or fit the full video with black bars (`fit`).
- In the Remotion preview, edit caption text, timing, position, box size, font, color, animation, and effects. Drag captions to fine-tune their position, or choose a style preset.
- Generate AI voiceovers only for selected lines in a script. Choose a male or female voice, an age range, one of eight delivery styles, and a speaking speed; then edit voice clips on the timeline.
- Export H.264 MP4 at 1080 × 1920. YouTube clips retain the source frame rate.

### Qwen voice model

AI voice generation uses `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` on Apple Silicon with Python 3.12. The model is about 4.2 GB. After installation, voice generation runs locally.

The app searches for an existing environment in this order: `makeshort/.venv-qwen`, `../lecture_short_video_generator/.venv-qwen`, then system Python. If the model is already in the default Hugging Face cache, it will not be downloaded again. To select a Python executable directly, run `QWEN_TTS_PYTHON=/path/to/python python app.py`.

To create an environment and install the model:

```bash
python3.12 -m venv .venv-qwen
.venv-qwen/bin/python -m pip install --upgrade pip
.venv-qwen/bin/python -m pip install -r requirements-voice.txt
.venv-qwen/bin/python -c 'from huggingface_hub import snapshot_download; snapshot_download(repo_id="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")'
QWEN_TTS_PYTHON="$PWD/.venv-qwen/bin/python" python app.py
```

An internet connection is needed to download the packages and model. The default cache is `~/.cache/huggingface/hub`. If you use a different location, set the same `HF_HOME` or `HF_HUB_CACHE` for both downloading and running the app. Check model availability in the editor's **AI voice** panel.

### JSON video rendering API

Send a JSON request with a YouTube segment, captions, and optional voice lines to `POST http://127.0.0.1:8000/api/create`. The API generates the requested AI voiceover and renders an MP4 with Remotion. The local Qwen model must be installed to generate AI voiceovers.

Example: English narration about *Night of the Living Dead*: [request JSON](examples/night_of_the_living_dead.json) · [full video (MP4)](examples/night_of_the_living_dead_english_1h24.mp4). The preview below is a silent GIF of the first five seconds; click it to open the full video.

[![Five-second preview of the Night of the Living Dead English narration](examples/night_of_the_living_dead_preview.gif)](examples/night_of_the_living_dead_english_1h24.mp4)

Example request:

```json
{
  "url": "https://www.youtube.com/watch?v=f5_wn8mexmM",
  "start": "01:23", "end": "01:35", "title": "Performance Highlight",
  "mode": "fit", "include_audio": true,
  "source_volume": 0.8, "duck_source_during_voiceover": true,
  "captions": [{
    "text": "Highlight", "start": 0, "end": 8,
    "position": "bottom-center", "positionX": 50, "positionY": 88,
    "boxWidth": 84, "boxHeight": 10,
    "font": "do-hyeon", "fontSize": 72, "color": "#ffffff",
    "animation": "pop", "decoration": "outline"
  }],
  "voiceovers": [{
    "text": "Here is the highlight of the performance.",
    "start": 2.5, "gender": "female", "age_group": "young_adult", "tone": "narration",
    "language": "English",
    "speed": 1.0, "volume": 1.0
  }]
}
```

`start` and `end` are times in the source video. Caption and voiceover `start` values are seconds from the beginning of the clip. Include only the lines to read in `voiceovers`; their durations are calculated after generation. `language` can be `Korean` or `English` and defaults to Korean. `gender` can be `male` or `female`. `age_group` can be `child`, `teen`, `young_adult`, `middle_aged`, or `senior`; it defaults to `young_adult`. Age groups adjust the vocal impression but do not reproduce an exact age. `tone` can be `calm`, `playful`, `angry`, `whisper`, `bright`, `sad`, `confident`, or `narration`. `speed` ranges from 0.7 to 1.3, and track `volume` ranges from 0 to 1; both default to 1. The output duration is extended when needed to include the full voiceover. When `duck_source_during_voiceover` is `true`, the source audio is lowered to 20% of its configured volume while AI speech plays. `source_volume` defaults to 1, `include_audio` defaults to `true`, and `mode` can be `fill` or `fit`. If a caption's `end` is omitted, it remains visible through the end of the clip. If `title` is omitted, the YouTube title is used as the output filename. Position and text-box dimensions are percentages of the frame.

Font IDs: `noto`, `black-han`, `serif`, `do-hyeon`, `gowun-dodum`, `gowun-batang`, `nanum-gothic`, `system`. Animations: `none`, `fade`, `pop`, `typewriter`. Effects: `none`, `shadow`, `outline`, `box`. Do Hyeon, Gowun Dodum, Gowun Batang, and Nanum Gothic are available under the SIL Open Font License ([license information](https://github.com/google/fonts/tree/main/ofl)). System fonts are used if Google Fonts cannot be reached.

```bash
curl --fail --request POST http://127.0.0.1:8000/api/create \
  --header 'Content-Type: application/json' \
  --data-binary @request.json \
  --remote-header-name --remote-name
```

Requests are limited to 256 KB, clips to one hour, and captions to 120. Errors use the `{"error":"..."}` format.

### Publish to Shorts, Reels, and TikTok

Enter developer app credentials in **Account settings**, or add environment variables to `.env.local` in the project root and then connect your accounts. Environment variables are read at app startup and take precedence over values saved in the UI. Restart the app after changing them.

Example `.env.local` file (excluded from Git):

```dotenv
MAKESHORT_YOUTUBE_CLIENT_ID=your-google-oauth-client-id
MAKESHORT_YOUTUBE_CLIENT_SECRET=your-google-oauth-client-secret

MAKESHORT_INSTAGRAM_APP_ID=your-meta-app-id
MAKESHORT_INSTAGRAM_APP_SECRET=your-meta-app-secret

MAKESHORT_TIKTOK_CLIENT_KEY=your-tiktok-client-key
MAKESHORT_TIKTOK_CLIENT_SECRET=your-tiktok-client-secret
```

Each platform needs one app key pair. You can connect multiple accounts for the same platform. OAuth tokens for each account are stored in macOS Keychain; the account list and publishing groups are stored in `~/.makeshort/accounts.json`. If you do not use environment variables, save the app credentials in Account settings.

| Platform | App and account requirements | Callback URL |
| --- | --- | --- |
| YouTube Shorts | [Google Cloud](https://console.cloud.google.com/) · YouTube Data API v3 | `http://127.0.0.1:8000/oauth/youtube/callback` |
| Instagram Reels | [Meta for Developers](https://developers.facebook.com/) · Instagram Graph API and a Business/Creator account linked to a Facebook Page | `http://127.0.0.1:8000/oauth/instagram/callback` |
| TikTok | [TikTok for Developers](https://developers.tiktok.com/) · Login Kit and Content Posting API | `http://127.0.0.1:8000/oauth/tiktok/callback` |

Connect multiple accounts for a platform. In **Account settings → Publishing groups**, create a group and assign the account to use on each platform. Select the group in the publish dialog when you are ready to post. For example, a Music group can use YouTube A, Instagram A, and TikTok A, while a Movies group uses the B accounts. Disconnecting an account also removes it from its groups.

Platform app review and permission approval may be required. App secrets saved in Account settings and account tokens are stored in macOS Keychain; app keys in `.env.local` are read from that file. Account and group settings are stored in `~/.makeshort/accounts.json` with `0600` permissions. `.env.local` is excluded from Git but is a plaintext file, so keep it secure. After you review a post, YouTube uploads are private and TikTok uploads use `SELF_ONLY`. Instagram posts are public after publishing.
