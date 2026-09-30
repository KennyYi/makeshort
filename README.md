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
