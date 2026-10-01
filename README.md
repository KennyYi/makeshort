# makeshort

유튜브 영상의 시간 구간을 세로형 MP4 클립으로 만드는 로컬 웹 앱입니다.

## 실행

필요한 도구: Python 3.10 이상, Node.js, FFmpeg

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
npm install
npm run build
python3 app.py
```

브라우저에서 <http://127.0.0.1:8000> 을 열어 사용합니다. macOS에서는 `brew install ffmpeg` 로 FFmpeg를 설치할 수 있습니다.

## 화면 구성

- **세로 화면 채우기**: 9:16으로 확대하고 중앙 기준으로 좌우를 잘라 화면을 채웁니다.
- **전체 영상 담기**: 원본 비율을 유지해 가운데 배치하고, 남는 공간을 검은색으로 채웁니다.

클립을 만든 뒤 Remotion 미리보기 화면에서 텍스트 레이어를 추가하고, 타임라인 막대를 옮기거나 양 끝을 끌어 노출 시간과 위치를 정합니다. 문구, 폰트, 글자 크기, 색상, 애니메이션, 그림자·외곽선·배경 효과를 편집해 MP4로 내보낼 수 있습니다. 기존 MP4/MOV 파일도 불러와 편집할 수 있습니다.

출력은 1080 × 1920, 원본 프레임레이트의 H.264 MP4입니다. YouTube에서 만든 클립은 원본 프레임레이트를 유지해 움직임의 불규칙한 프레임 변환을 줄입니다. 처리 중 임시 폴더에만 저장되고 요청이 끝나면 삭제됩니다. 텍스트 합성은 Remotion CLI의 로컬 렌더링을 사용합니다.

## JSON 합성 API

앱을 실행한 상태에서 `POST http://127.0.0.1:8000/api/create` 로 JSON을 보내면, YouTube 영상에서 구간을 자르고 자막을 합성한 MP4를 한 번에 반환합니다. 요청의 `start`와 `end`는 원본 영상 기준이고, 자막의 `start`와 `end`는 잘라낸 클립 기준입니다.

`title`은 선택 항목입니다. 생략하거나 빈 문자열로 보내면 YouTube 영상 제목을 파일명으로 사용합니다. `mode`는 `fill` 또는 `fit`이며 생략하면 `fill`을 사용합니다.

```json
{
  "url": "https://www.youtube.com/watch?v=f5_wn8mexmM",
  "start": "00:01:23",
  "end": "00:01:35",
  "mode": "fit",
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
