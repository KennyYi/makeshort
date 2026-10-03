# makeshort

유튜브 영상의 시간 구간을 세로형 MP4 클립으로 만드는 로컬 웹 앱입니다.

## 실행

필요한 도구: Python 3.10 이상, Node.js, FFmpeg. AI 음성 프리셋은 Apple Silicon Mac에서 로컬 Qwen3-TTS 모델을 사용합니다. Qwen 음성 환경과 모델이 이미 설치되어 있으면 자동으로 재사용합니다.

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm install
npm run build
python app.py
```

브라우저에서 <http://127.0.0.1:8000> 을 열어 사용합니다. macOS에서는 `brew install ffmpeg` 로 FFmpeg를 설치할 수 있습니다.

## Qwen TTS 음성 모델 설치

MakeShort는 `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` 모델로 한국어 음성을 생성합니다. Apple Silicon Mac과 Python 3.12 음성 환경이 필요합니다. 가중치는 약 4.2GB이며 한 번만 다운로드하면 됩니다. 앱은 모델을 로컬에서 불러오고, 첫 음성 생성 후에는 앱을 종료할 때까지 메모리에 유지합니다.

### 기존 Qwen 설치 재사용

기본 설정은 MakeShort의 `.venv-qwen`을 먼저 찾고, 이어서 같은 상위 폴더에 있는 `lecture_short_video_generator/.venv-qwen`을 찾습니다. Hugging Face 기본 캐시(`~/.cache/huggingface/hub`)에 모델도 있으면 추가 설치 없이 사용할 수 있습니다. 현재 상태는 편집 화면의 **AI 음성** 패널에서 확인할 수 있습니다.

자동 검색이 안 되면 MakeShort를 시작할 때 음성 Python 경로를 지정합니다.

```bash
QWEN_TTS_PYTHON="../lecture_short_video_generator/.venv-qwen/bin/python" python app.py
```

### 새 Python 환경과 모델 설치

기존 환경을 재사용할 수 없을 때만 별도 Python 3.12 환경을 만들고 다음을 실행합니다.

```bash
python3.12 -m venv .venv-qwen
.venv-qwen/bin/python -m pip install --upgrade pip
.venv-qwen/bin/python -m pip install -r requirements-voice.txt
.venv-qwen/bin/python -c 'from huggingface_hub import snapshot_download; print(snapshot_download(repo_id="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"))'
QWEN_TTS_PYTHON="$PWD/.venv-qwen/bin/python" python app.py
```

모델은 기본적으로 `~/.cache/huggingface/hub` 아래에 저장됩니다. 다른 위치를 쓰려면 앱을 시작할 때 `HF_HOME` 또는 `HF_HUB_CACHE`를 설정하고, 음성 환경 경로도 `QWEN_TTS_PYTHON`으로 지정합니다. 모델 설치와 Python 패키지 다운로드에는 인터넷 연결이 필요하지만, 설치가 끝난 뒤 음성 생성은 로컬에서 동작합니다.

## 화면 구성

- 앱을 열면 빈 9:16 타임라인이 바로 표시됩니다. 프로젝트 길이를 정하고 텍스트를 편집하거나, 이미지 파일을 타임라인 재생 위치에 추가해 원하는 구간에 보여줄 수 있습니다. 이미지 레이어는 타임라인에서 이동·길이 조절이 가능하고, 전체 이미지 맞춤 또는 화면 채우기를 선택할 수 있습니다. 기본 배경은 검은색입니다.
- **YouTube 영상 추가**는 선택 사항입니다. 링크와 시작·종료 시간을 입력해 배경 영상으로 추가할 수 있으며, 기존 텍스트와 이미지 레이어는 유지됩니다. 기존 MP4/MOV 영상도 불러올 수 있습니다.
- **세로 화면 채우기**: 9:16으로 확대하고 중앙 기준으로 좌우를 잘라 화면을 채웁니다.
- **전체 영상 담기**: 원본 비율을 유지해 가운데 배치하고, 남는 공간을 검은색으로 채웁니다.

Remotion 미리보기 화면에서 텍스트 레이어를 추가하고, 타임라인 막대를 옮기거나 양 끝을 끌어 노출 시간과 위치를 정합니다. 문구, 폰트, 글자 크기, 색상, 애니메이션, 그림자·외곽선·배경 효과를 편집해 MP4로 내보낼 수 있습니다.

**AI 음성** 버튼에서 대본을 문장으로 나눈 뒤 읽을 문장을 골라 한국어 음성을 만들 수 있습니다. 남성·여성 목소리와 차분함, 장난기, 화남, 속삭임, 밝음, 슬픔, 자신감, 내레이션 어투를 조합할 수 있고 읽기 속도도 조절할 수 있습니다. Qwen3-TTS 1.7B CustomVoice 모델을 Apple Silicon에서 로컬로 합성합니다. 기존 Qwen 환경과 Hugging Face 캐시를 사용하며, 모델은 앱이 켜져 있는 동안 메모리에 유지됩니다. 생성된 음성은 타임라인에서 위치를 옮기고 음량을 조절할 수 있고, 최종 MP4는 Remotion이 영상·이미지·자막·음성을 함께 합성합니다.

출력은 1080 × 1920, 원본 프레임레이트의 H.264 MP4입니다. YouTube에서 만든 클립은 원본 프레임레이트를 유지해 움직임의 불규칙한 프레임 변환을 줄입니다. 처리 중 임시 폴더에만 저장되고 요청이 끝나면 삭제됩니다. 영상·이미지·텍스트·음성 합성은 Remotion CLI의 로컬 렌더링을 사용합니다.

## JSON 합성 API

앱을 실행한 상태에서 `POST http://127.0.0.1:8000/api/create` 로 JSON을 보내면, YouTube 영상에서 구간을 자르고 자막을 합성한 MP4를 한 번에 반환합니다. 요청의 `start`와 `end`는 원본 영상 기준이고, 자막의 `start`와 `end`는 잘라낸 클립 기준입니다.

`title`은 선택 항목입니다. 생략하거나 빈 문자열로 보내면 YouTube 영상 제목을 파일명으로 사용합니다. `mode`는 `fill` 또는 `fit`이며 생략하면 `fill`을 사용합니다. `include_audio`는 YouTube 원본 오디오 포함 여부이며, 생략하면 `true`입니다.

```json
{
  "url": "https://www.youtube.com/watch?v=f5_wn8mexmM",
  "start": "00:01:23",
  "end": "00:01:35",
  "mode": "fit",
  "include_audio": false,
  "title": "TWICE 공연 하이라이트",
  "captions": [
    {
      "text": "The Feels",
      "start": 0,
      "position": "bottom-center",
      "positionX": 50,
      "positionY": 88,
      "boxWidth": 84,
      "boxHeight": 10,
      "font": "noto",
      "fontSize": 72,
      "color": "#ffffff",
      "animation": "fade",
      "decoration": "shadow"
    }
  ]
}
```

`id`를 생략하면 자막마다 자동으로 지정됩니다. 자막의 `start`와 `end`는 잘라낸 클립의 시작부터 센 초 단위 시간이며, `end`를 생략하면 해당 자막은 클립의 마지막 프레임까지 표시됩니다. 자막 스타일 기본값은 `font=noto`, `fontSize=72`, `color=#ffffff`, `position=bottom-center`, `boxWidth=84`, `boxHeight=10`, `animation=fade`, `decoration=shadow`입니다. 허용 폰트는 `noto`, `black-han`, `serif`, `system`; 애니메이션은 `none`, `fade`, `pop`, `typewriter`; 효과는 `none`, `shadow`, `outline`, `box`입니다. 위치는 `top-left`, `top-center`, `top-right`, `middle-left`, `middle-center`, `middle-right`, `bottom-left`, `bottom-center`, `bottom-right` 중에서 선택합니다. `positionX`와 `positionY`는 화면의 0~100% 좌표입니다.

요청 JSON을 `request.json`으로 저장한 뒤 다음처럼 MP4를 받습니다. 응답 파일명에는 `title` 또는 YouTube 제목이 사용됩니다.

```bash
curl --fail --request POST http://127.0.0.1:8000/api/create \
  --header 'Content-Type: application/json' \
  --data-binary @request.json \
  --remote-header-name --remote-name
```

오류 응답은 `{"error":"..."}` 형식의 JSON입니다. 입력 영상 링크가 공개되어 있어야 하며, 요청 JSON은 256KB 이하, 클립은 최대 1시간, 자막은 최대 120개까지 지원합니다.

## Shorts·Reels·TikTok 배포

자막 편집 화면의 **계정 설정**에서 개발자 앱 키를 저장하고 각 계정을 연결합니다. 완성 영상을 미리 본 뒤 **플랫폼 배포**를 누르면 연결한 플랫폼을 골라 한 번에 게시할 수 있습니다. 게시 결과는 플랫폼별로 따로 표시되며, 하나가 실패해도 다른 플랫폼 처리는 계속됩니다.

앱 키와 토큰은 이 Mac의 시스템 키체인에 저장합니다. 계정 이름과 선택한 Instagram Page 정보는 `~/.makeshort/accounts.json`에 권한 `0600`으로 저장합니다. 렌더 결과는 전송 중 임시 폴더에만 저장되고 게시 요청이 끝나면 삭제됩니다. 계정 정보는 Git 저장소에 기록하지 않습니다.

각 플랫폼은 MakeShort 앱 키가 아니라 사용자가 플랫폼 개발자 콘솔에서 만든 앱 자격 증명을 요구합니다.

- **YouTube Shorts**: [Google Cloud Console](https://console.cloud.google.com/)에서 YouTube Data API v3를 활성화하고 Web application OAuth 클라이언트를 만듭니다. Authorized redirect URI는 `http://127.0.0.1:8000/oauth/youtube/callback`입니다. OAuth 동의 화면을 테스트 모드로 쓸 경우 본인 Google 계정을 테스트 사용자로 등록합니다. MakeShort 출력은 세로 9:16입니다. YouTube는 세로 또는 정사각형이며 3분 이하인 새 영상을 Shorts로 분류합니다. 미검수 API 프로젝트에서 올린 영상은 비공개로 제한될 수 있습니다. [영상 업로드 API](https://developers.google.com/youtube/v3/guides/uploading_a_video), [Shorts 길이 기준](https://support.google.com/youtube/answer/15424877)
- **Instagram Reels**: [Meta for Developers](https://developers.facebook.com/)에서 Facebook Login과 Instagram Graph API를 포함한 앱을 만들고 redirect URI `http://127.0.0.1:8000/oauth/instagram/callback`을 등록합니다. 대상 Instagram은 Business 또는 Creator 계정이어야 하며 Facebook Page에 연결되어 있어야 합니다. 앱 개발 중에는 Instagram/Page 계정을 앱 역할 또는 테스트 계정으로 추가하고, 공개 배포에는 Meta 앱 검수와 `instagram_content_publish`, `instagram_basic`, `pages_show_list`, `pages_read_engagement` 권한이 필요할 수 있습니다. MakeShort는 Reels 컨테이너를 만든 뒤 MP4 파일을 Meta 업로드 서버로 직접 전송하고 게시 상태를 확인합니다. [Meta Reels 게시 API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- **TikTok**: [TikTok for Developers](https://developers.tiktok.com/)에서 앱에 Login Kit과 Content Posting API를 추가합니다. Desktop redirect URI `http://127.0.0.1:8000/oauth/tiktok/callback`을 등록하고 `user.info.basic`, `video.publish` 권한을 요청합니다. TikTok 앱 검수가 끝나지 않은 클라이언트는 게시물이 비공개로 제한될 수 있습니다. 게시 전에 계정의 허용 공개 범위와 동영상 길이를 불러옵니다. [Desktop OAuth](https://developers.tiktok.com/docs/en/login-kit-desktop), [Direct Post API](https://developers.tiktok.com/docs/en/content-posting-api-get-started)

앱 키를 편집 화면의 **계정 설정**에 입력하면 앱 Secret과 OAuth 토큰은 Python `keyring`을 통해 macOS 키체인에 저장됩니다. 설치할 때 `python3 -m pip install -r requirements.txt`를 실행해 주세요. 게시 화면은 확인 동작을 요구하며 YouTube는 비공개, TikTok은 계정에서 허용하는 `SELF_ONLY` 범위를 기본값으로 둡니다. Instagram은 게시가 완료되면 해당 계정에 바로 공개됩니다.
