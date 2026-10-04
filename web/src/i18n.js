const browserLanguage = typeof navigator === "undefined"
  ? "ko"
  : (navigator.languages?.[0] || navigator.language || "en").toLowerCase();
const korean = browserLanguage.startsWith("ko");

const english = {
  "makeshort — 타임라인 영상 편집기": "makeshort — Timeline Video Editor",
  "makeshort 홈": "makeshort home",
  "타임라인 영상 편집기": "Timeline video editor",
  "필요한 장면을, 더 짧고 선명하게.": "The moments you need, shorter and clearer.",
  "위 왼쪽": "Top left", "위 가운데": "Top center", "위 오른쪽": "Top right",
  "중간 왼쪽": "Middle left", "중간 가운데": "Middle center", "중간 오른쪽": "Middle right",
  "아래 왼쪽": "Bottom left", "아래 가운데": "Bottom center", "아래 오른쪽": "Bottom right",
  "새로운 텍스트": "New text", "기본": "Classic", "가나다": "Abc", "임팩트": "Impact", "강조!": "Bold!",
  "깔끔한 자막": "Clean captions", "자막": "Caption", "민트 포인트": "Mint accent", "포인트": "Accent",
  "남성": "Male", "여성": "Female", "어린이": "Child", "청소년": "Teen", "청년": "Young adult", "중년": "Middle-aged", "노인": "Senior",
  "차분함": "Calm", "부드럽고 안정적으로": "Soft and steady", "장난기": "Playful", "가볍고 생기 있게": "Light and lively",
  "화남": "Angry", "단호하고 강하게": "Firm and forceful", "속삭임": "Whisper", "작고 가까운 목소리로": "Soft and intimate",
  "밝고 활기참": "Bright", "경쾌하고 환하게": "Cheerful and upbeat", "슬픔": "Sad", "차분하고 먹먹하게": "Quiet and wistful",
  "자신감": "Confident", "또렷하고 확신 있게": "Clear and assured", "내레이션": "Narration", "발음을 살려 전달력 있게": "Clear, expressive delivery",
  "클립보드에 복사하지 못했습니다.": "Could not copy to the clipboard.", "클립": "Clip",
  "이미지 레이어는 프로젝트당 최대 50개까지 추가할 수 있습니다.": "A project can contain up to 50 image layers.",
  "JPG, PNG 또는 WebP 이미지를 선택해 주세요.": "Choose a JPG, PNG, or WebP image.",
  "이미지를 업로드하지 못했습니다.": "Could not upload the image.", "이미지를 추가하지 못했습니다.": "Could not add the image.",
  "이미지 저장 서버에 연결할 수 없습니다. MakeShort 앱을 다시 실행한 뒤 시도해 주세요.": "Could not connect to the image storage server. Restart MakeShort and try again.",
  "음성으로 만들 문장을 먼저 선택해 주세요.": "Select at least one sentence to turn into speech.",
  "말투 프리셋 음성 생성은 Apple Silicon Mac에서 사용할 수 있습니다.": "Preset voice generation requires an Apple Silicon Mac.",
  "로컬 Qwen3-TTS 환경이나 모델 캐시를 찾지 못했습니다. requirements-voice.txt로 Python 3.12 음성 환경을 준비해 주세요.": "Could not find the local Qwen3-TTS environment or model cache. Set up the Python 3.12 voice environment with requirements-voice.txt.",
  "AI 음성 레이어는 프로젝트당 최대 50개까지 만들 수 있습니다.": "A project can contain up to 50 AI voice layers.",
  "AI 음성을 생성하지 못했습니다.": "Could not generate AI speech.", "생성된 음성이 1시간 프로젝트 한도를 넘습니다.": "The generated speech exceeds the one-hour project limit.",
  "AI 음성 생성에 실패했습니다.": "AI speech generation failed.",
  "유튜브 시작·종료 시간을 확인해 주세요. 초 또는 MM:SS 형식으로 입력할 수 있습니다.": "Check the YouTube start and end times. Enter seconds or MM:SS.",
  "YouTube 클립": "YouTube clip", "유튜브 영상을 가져오지 못했습니다.": "Could not fetch the YouTube video.", "유튜브 클립을 추가하지 못했습니다.": "Could not add the YouTube clip.",
  "영상 길이를 확인할 수 없습니다.": "Could not determine the video duration.", "이 영상 파일을 열 수 없습니다.": "Could not open this video file.",
  "자막 JSON을 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.": "Could not copy caption JSON. Check the browser's clipboard permission.",
  "먼저 YouTube 영상, 이미지, 텍스트 또는 AI 음성을 추가해 주세요.": "Add a YouTube video, image, text, or AI voice first.",
  "Remotion 합성에 실패했습니다.": "Remotion rendering failed.", "합성에 실패했습니다.": "Rendering failed.",
  "영상과 텍스트 편집": "Edit video and text", "영상 클립 포함": "Video clip included", "빈 세로 화면 프로젝트": "Blank portrait project",
  "길이": "Duration", "초": "sec", "＋ YouTube 영상": "＋ YouTube video", "＋ 이미지": "＋ Image", "영상 파일": "Video file",
  "영상 제거": "Remove video", "AI 음성": "AI voice", "＋ 텍스트 추가": "＋ Add text", "YouTube 영상 추가": "Add YouTube video",
  "닫기": "Close", "YouTube 링크": "YouTube URL", "시작 시간": "Start time", "종료 시간": "End time", "세로 화면": "Portrait layout",
  "화면 채우기 · 좌우 자르기": "Fill frame · crop sides", "전체 영상 · 검은 여백": "Fit video · black bars",
  "YouTube 원본 소리 포함": "Include YouTube audio", "가져오는 중…": "Fetching…", "영상 추가": "Add video",
  "AI 음성 생성": "AI speech generation", "대본에서 읽을 문장 선택": "Choose lines to read", "전체 대본을 입력한 뒤, 음성으로 만들 문장만 골라 주세요.": "Enter the full script, then choose which lines to turn into speech.",
  "로컬 모델 준비됨": "Local model ready", "로컬 모델 사용 가능": "Local model available", "Apple Silicon 필요": "Apple Silicon required", "모델 설치 필요": "Model installation required", "모델 확인 중…": "Checking model…",
  "Qwen3-TTS 오픈 모델이 선택한 목소리·연령대·어투에 맞춰 한국어 음성을 만듭니다. 연령대는 음성 인상에 반영되며 모델 특성상 정확한 나이를 재현하지는 않습니다. 음성은 Apple Silicon에서 로컬로 합성됩니다.": "The Qwen3-TTS open model generates Korean speech using the selected voice, age impression, and delivery style. Age adjusts the vocal impression; it does not reproduce an exact age. Speech is generated locally on Apple Silicon.",
  "목소리 성별": "Voice gender", "연령대": "Age range", "음성 연령대": "Voice age range", "어투": "Delivery style", "음성 어투": "Voice style", "읽기 속도": "Speaking speed",
  "전체 대본": "Full script", "읽을 문장과 읽지 않을 문장을 포함해 대본을 입력하세요.": "Enter the full script, including lines to read and skip.", "문장으로 나누기": "Split into sentences",
  "음성으로 만들 문장": "Lines to generate", "모두 선택": "Select all", "모두 해제": "Clear selection", "생성됨": "Generated",
  "선택 {count}개 · 선택한 문장만 각각 음성 클립으로 만듭니다.": "{count} selected · Each selected line becomes a separate voice clip.", "음성 생성 중…": "Generating speech…", "선택 문장 음성 생성": "Generate selected lines",
  "저장할 영상 제목": "Output video title", "YouTube 영상은 선택 사항입니다. 입력한 제목이 MP4 파일명으로 저장됩니다.": "YouTube video is optional. This title is used as the MP4 filename.",
  "영상 미리보기": "Video preview", "✦ 이미지와 텍스트를 원하는 시점에 추가하고, 결과를 바로 확인할 수 있어요.": "✦ Add images and text at any point and preview the result instantly.",
  "원본 영상 소리": "Original video audio", "원본 영상 소리 음량": "Original video volume", "AI 음성과 겹쳐 재생되는 원본 사운드의 음량": "Volume of the original audio under AI speech",
  "AI 음성 재생 중 원본 소리 자동 낮춤": "Lower original audio during AI speech", "음성 구간에서 원본 음량의 20%": "Reduce original audio to 20% during speech",
  "영상 레이어 설정": "Video layer settings", "텍스트 레이어": "Text layers", "텍스트, 시간, 스타일을 captions JSON으로 복사": "Copy text, timing, and style as captions JSON",
  "복사 완료": "Copied", "JSON 복사": "Copy JSON", "＋ 추가": "＋ Add", "첫 텍스트를 추가하세요": "Add your first text layer",
  "시작·종료 시간을 정하고 스타일을 편집할 수 있어요.": "Set its start and end times, then customize its style.", "텍스트 내용": "Text content", "삭제": "Delete", "스타일 프리셋": "Style presets",
  "크기 · 색상 · 효과": "Size · color · effects", "노출 시간": "Duration", "위치 기준점": "Position", "화면에서 드래그 가능": "Drag on preview", "텍스트 위치": "Text position",
  "폰트": "Font", "도현체": "Do Hyeon", "고운돋움": "Gowun Dodum", "고운바탕": "Gowun Batang", "나눔고딕": "Nanum Gothic", "시스템 고딕": "System Sans",
  "크기": "Size", "텍스트박스 크기": "Text box size", "화면 비율": "Screen ratio", "너비": "Width", "높이": "Height", "애니메이션": "Animation",
  "없음": "None", "페이드 인·아웃": "Fade in/out", "팝업": "Pop", "타자 효과": "Typewriter", "텍스트 효과": "Text effect", "그림자": "Shadow", "검은 외곽선": "Black outline", "반투명 배경": "Translucent background", "글자 색상": "Text color",
  "이미지 레이어": "Image layers", "이미지를 원하는 시점에 추가하세요": "Add an image at any point", "타임라인 재생 위치부터 기본 3초 동안 표시됩니다.": "The image appears for 3 seconds from the playhead by default.",
  "이미지 설정": "Image settings", "선택한 이미지": "Selected image", "화면 맞춤": "Image fit", "전체 이미지 · 검은 여백": "Fit image · black bars", "화면 채우기 · 가장자리 자르기": "Fill frame · crop edges",
  "음성 레이어": "Voice layers", "＋ 대본": "＋ Script", "선택한 문장으로 음성을 만드세요": "Generate speech from selected lines", "생성한 음성은 타임라인에 자동 배치됩니다.": "Generated speech is placed on the timeline automatically.",
  "AI 음성 클립": "AI voice clip", "음량": "Volume", "영상, 이미지, 텍스트 타임라인": "Video, image, and text timeline", "타임라인": "Timeline", "영상/배경": "Video/background", "이미지": "Image", "텍스트": "Text", "음성": "Voice", "시간": "Time",
  "영상": "Video", "배경": "Background", "검은 배경 · 9:16": "Black background · 9:16", "이미지 {index}": "Image {index}", "텍스트 {index}": "Text {index}",
  "텍스트를 추가하면 여기에 표시됩니다.": "Text layers will appear here.", "영상·이미지·텍스트 막대는 길이와 위치를 조절하고, AI 음성 막대는 타임라인에서 시작 위치를 옮길 수 있습니다.": "Resize and move video, image, and text clips. Drag voice clips to change their start time.",
  "Remotion으로 합성 중입니다. 클립 길이에 따라 시간이 걸릴 수 있어요.": "Rendering with Remotion. This may take a while depending on clip length.", "저장 완료: {filename}": "Saved: {filename}",
  "영상·이미지·텍스트·음성 합성이 끝나면 {filename} 파일로 저장합니다.": "The rendered video will be saved as {filename}.", "완성본 다시 받기": "Download again", "합성 중…": "Rendering…", "영상 합성 및 다운로드": "Render and download",
  "모든 사람": "Everyone", "맞팔 친구": "Friends", "팔로워": "Followers", "나만 보기": "Only me",
  "요청에 실패했습니다.": "The request failed.", "계정을 연결했습니다.": "Account connected.", "계정 연결에 실패했습니다.": "Could not connect account.", "계정 미설정": "No account assigned",
  "앱 키를 macOS 키체인에 저장했습니다.": "App credentials saved to macOS Keychain.", "인증 창이 열리지 않았습니다. 브라우저에서 팝업을 허용해 주세요.": "The sign-in window did not open. Allow pop-ups in your browser.",
  "{label} 계정 {count}개를 사용할 수 있습니다.": "{count} {label} account(s) available.", "{label} 계정 연결을 해제했습니다.": "Disconnected {label} account.",
  "계정 그룹을 저장했습니다.": "Account group saved.", "계정 그룹을 삭제했습니다.": "Account group deleted.", "TikTok 게시 설정을 가져오지 못했습니다: {message}": "Could not load TikTok posting settings: {message}",
  "선택한 그룹에 계정을 연결한 플랫폼을 하나 이상 선택해 주세요.": "Select at least one platform with an account assigned in this group.", "{count} posts published": "{count} posts published", "{count} processing": "{count} processing", "{count} failed": "{count} failed",
  "계정 설정": "Account settings", "{count}개": "{count} accounts", "플랫폼 배포": "Publish", "배포 계정 연결": "Connect publishing accounts",
  "앱 자격 증명과 OAuth 토큰은 이 컴퓨터에 저장됩니다. 토큰과 Secret은 시스템 키체인에, 계정 이름과 선택 정보는 {path}에 보관합니다.": "App credentials and OAuth tokens are stored on this computer. Tokens and secrets are kept in the system Keychain; account names and group settings are stored in {path}.",
  "macOS 키체인을 사용할 수 없습니다. Python requirements를 설치하고 키체인 잠금 상태를 확인해 주세요.": "macOS Keychain is unavailable. Install the Python requirements and check whether Keychain is locked.", "연결됨": "Connected", "미연결": "Not connected", "앱 설정 방법": "App setup",
  "저장됨 · 변경할 때만 입력": "Saved · enter only to change", "개발자 콘솔에서 발급": "Get this from the developer console", "키체인에 안전하게 저장": "Stored securely in Keychain",
  "저장 중…": "Saving…", "앱 키 저장": "Save app credentials", "다른 계정 추가": "Add another account", "계정 연결": "Connect account", "연결됨 · 그룹에 추가할 수 있음": "Connected · available for groups", "다시 연결 필요": "Reconnect required", "연결 해제": "Disconnect",
  "배포 그룹": "Publishing groups", "영상마다 어느 플랫폼 계정으로 올릴지 묶어 둡니다.": "Choose which platform accounts to use for each type of video.", "그룹 추가": "Add group", "계정을 하나 이상 연결한 뒤 그룹을 만들어 주세요.": "Connect at least one account, then create a group.",
  "계정이 지정되지 않음": "No accounts assigned", "수정": "Edit", "그룹 이름": "Group name", "예: 음악 계정": "e.g. Music", "사용 안 함": "Not used", "그룹 저장": "Save group", "취소": "Cancel",
  "게시물은 플랫폼으로 직접 업로드됩니다. 연결된 계정의 공개 권한은 게시 화면에서 확인하세요.": "Videos are uploaded directly to each platform. Review each account's visibility settings before posting.",
  "영상 확인 후 배포": "Review and publish", "완성된 {duration}초 영상 · {size}. 최종 출력물을 확인한 뒤 선택한 계정에 게시하세요.": "Finished video · {duration}s · {size}. Review it, then publish to the selected accounts.",
  "게시할 최종 영상 미리보기": "Final video preview", "현재 로컬 업로드는 영상당 1GB까지 지원합니다. 영상 길이나 출력 크기를 줄여 다시 합성해 주세요.": "Local publishing supports videos up to 1 GB. Shorten the video or reduce its output size and render again.",
  "배포 계정 그룹": "Publishing group", "그룹 없음 · 계정 설정에서 추가": "No groups · add one in Account settings", "먼저 계정 설정에서 배포 그룹을 만들고, 플랫폼별 계정을 지정해 주세요.": "Create a publishing group in Account settings and assign accounts to it first.",
  "배포 플랫폼": "Publishing platforms", "이 그룹에 연결된 계정 없음": "No account assigned in this group", "YouTube 제목": "YouTube title", "YouTube 설명": "YouTube description", "공개 범위": "Visibility", "선택 사항": "Optional",
  "비공개": "Private", "일부 공개": "Unlisted", "공개": "Public", "YouTube는 세로 또는 정사각형 영상, 3분 이하를 Shorts로 분류합니다. 미검수 API 프로젝트는 업로드가 비공개로 제한될 수 있습니다.": "YouTube classifies portrait or square videos up to 3 minutes as Shorts. Uploads from unverified API projects may be restricted to private.",
  "Instagram Reels 캡션": "Instagram Reels caption", "프로필 피드에도 공유": "Also share to profile feed", "TikTok 캡션": "TikTok caption", "댓글 끄기": "Turn off comments", "듀엣 끄기": "Turn off Duet", "이어붙이기 끄기": "Turn off Stitch",
  "AI 생성 콘텐츠로 표시": "Mark as AI-generated", "브랜드 협찬 콘텐츠": "Branded content", "내 비즈니스 홍보 콘텐츠": "Promotional content for my business", "이 계정의 최대 영상 길이: {duration}초": "Maximum video length for this account: {duration}s",
  "TikTok 앱에서 이어서 게시해 주세요": "Continue posting in the TikTok app", "플랫폼에서 처리 중입니다": "Processing on platform", "게시물 열기 ↗": "Open post ↗", "게시 완료 · {id}": "Published · {id}",
  "게시가 시작되면 각 플랫폼에서 처리하며, 일부 실패가 있어도 나머지 플랫폼 게시 결과는 유지됩니다.": "Each platform processes its post independently, so one failure does not affect the others.", "플랫폼에 업로드 중…": "Uploading to platforms…", "선택한 계정에 게시": "Publish to selected accounts",
  "프로젝트 길이(초)": "Project duration (seconds)", "목소리": "Voice", "글자": "characters",
  "새 프로젝트": "New project", "모델 확인 중": "Checking model…", "텍스트 스타일 프리셋": "Text style presets",
  "이미지와 텍스트를 원하는 시점에 추가하고, 결과를 바로 확인할 수 있어요.": "Add images and text at any point and preview the result instantly.",
  "Do Hyeon · 도현체": "Do Hyeon", "Gowun Dodum · 고운돋움": "Gowun Dodum", "Gowun Batang · 고운바탕": "Gowun Batang", "Nanum Gothic · 나눔고딕": "Nanum Gothic",
  "타임라인 편집기": "Timeline editor", "선택 동영상 소스": "Optional video source", "로컬 오픈 모델": "Local open model", "Remotion 미리보기": "Remotion preview", "AI 음성 트랙": "AI voice track", "시간 편집": "Edit timing", "로컬 계정": "Local accounts", "검토 및 배포": "Review and publish",
  "로컬 MakeShort 화면에서만 음성 설정을 확인할 수 있습니다.": "Voice settings are available only from the local MakeShort app.",
  "로컬 MakeShort 화면에서만 미디어 작업을 요청할 수 있습니다.": "Media operations are available only from the local MakeShort app.",
  "로컬 MakeShort 화면에서만 음성 기능을 사용할 수 있습니다.": "Voice features are available only from the local MakeShort app.",
  "로컬 MakeShort 화면에서만 계정 작업을 요청할 수 있습니다.": "Account operations are available only from the local MakeShort app.",
  "요청한 주소를 찾을 수 없습니다.": "The requested address could not be found.", "요청 내용을 확인해 주세요.": "Check the request.", "요청 내용이 너무 큽니다.": "The request is too large.",
  "영상을 가져오지 못했습니다. 공개 영상인지, 링크가 정확한지 확인해 주세요.": "Could not fetch the video. Check that it is public and the link is correct.",
  "클립을 만드는 중 문제가 생겼습니다. 서버 로그를 확인해 주세요.": "There was a problem creating the clip. Check the server log.", "클립을 합성하는 중 문제가 생겼습니다. 서버 로그를 확인해 주세요.": "There was a problem rendering the clip. Check the server log.",
  "올바른 JSON 요청이 아닙니다.": "The request is not valid JSON.", "요청 본문은 JSON 객체여야 합니다.": "The request body must be a JSON object.",
  "읽을 문장은 1~20,000자여야 합니다.": "The selected text must be between 1 and 20,000 characters.", "남성 또는 여성 음성을 선택해 주세요.": "Choose a male or female voice.", "음성 연령대를 선택해 주세요.": "Choose a voice age range.", "음성 어투 프리셋을 선택해 주세요.": "Choose a voice style preset.", "한국어 또는 영어 음성을 선택해 주세요.": "Choose Korean or English speech.", "읽기 속도는 0.7~1.3 범위에서 선택해 주세요.": "Choose a speaking speed from 0.7 to 1.3.",
  "생성된 음성을 편집기에 추가하지 못했습니다.": "Could not add the generated speech to the editor.", "영상 파일 크기를 확인해 주세요.": "Check the video file size.", "영상 파일은 비어 있거나 1GB를 초과할 수 없습니다.": "The video file must be non-empty and no larger than 1 GB.", "게시물 설정이 없거나 너무 큽니다.": "Post settings are missing or too large.",
  "프로젝트 미디어 삭제 요청을 확인해 주세요.": "Check the project media deletion request.", "프로젝트 미디어 ID를 확인해 주세요.": "Check the project media ID.", "프로젝트 미디어를 찾을 수 없습니다.": "Could not find the project media.",
  "게시 중 예상하지 못한 오류가 발생했습니다. 앱 로그를 확인해 주세요.": "An unexpected error occurred while publishing. Check the app log.", "{label} 계정이 선택된 그룹에 없습니다.": "No {label} account is assigned to the selected group.",
  "로컬 토큰 정보를 읽지 못했습니다. 플랫폼 계정을 다시 연결해 주세요.": "Could not read local token data. Reconnect the platform account.", "계정 암호 보관 기능이 없습니다. requirements.txt의 패키지를 설치해 주세요.": "Credential storage is unavailable. Install the packages in requirements.txt.",
  "시스템 키체인을 사용할 수 없습니다. macOS 키체인을 확인해 주세요.": "System Keychain is unavailable. Check macOS Keychain.", "지원하지 않는 플랫폼입니다.": "This platform is not supported.", "플랫폼 앱 ID 또는 Client Key를 입력해 주세요.": "Enter the platform App ID or Client Key.", "플랫폼 앱 Secret을 입력해 주세요.": "Enter the platform App Secret.",
  "그룹 이름은 1~60자여야 합니다.": "Group names must contain 1 to 60 characters.", "그룹 계정 설정을 확인해 주세요.": "Check the group account settings.", "계정 그룹은 최대 50개까지 만들 수 있습니다.": "You can create up to 50 account groups.",
  "인증 요청이 만료되었거나 state가 일치하지 않습니다. 앱에서 다시 연결해 주세요.": "The authorization request expired or its state did not match. Reconnect in the app.",
  "인증한 Google 계정에서 YouTube 채널을 찾지 못했습니다.": "No YouTube channel was found for the authorized Google account.", "Meta에서 사용자 액세스 토큰을 받지 못했습니다.": "Meta did not return a user access token.",
  "연결 가능한 Instagram 프로 계정을 찾지 못했습니다. Instagram Business/Creator 계정이 Facebook Page에 연결되어 있고, 요청한 Meta 권한이 승인되었는지 확인해 주세요.": "No connectable Instagram professional account was found. Check that an Instagram Business or Creator account is linked to a Facebook Page and that the requested Meta permissions were approved.",
  "TikTok 계정 ID를 확인하지 못했습니다. 권한을 확인한 뒤 다시 연결해 주세요.": "Could not verify the TikTok account ID. Check permissions and reconnect.",
  "배포 요청 JSON을 확인해 주세요.": "Check the publishing request JSON.", "배포할 플랫폼을 하나 이상 선택해 주세요.": "Select at least one platform to publish to.", "게시물 설정을 확인해 주세요.": "Check the post settings.", "배포할 계정 그룹을 찾지 못했습니다. 그룹을 다시 선택해 주세요.": "Could not find the publishing group. Select the group again.", "배포 파일은 플랫폼 공통 제한인 1GB 이하여야 합니다.": "The file must be no larger than the shared 1 GB platform limit.",
  "배포할 MP4 영상 정보를 읽지 못했습니다.": "Could not read the MP4 video information.", "배포할 영상의 해상도와 길이를 확인해 주세요.": "Check the video's resolution and duration.", "YouTube Shorts는 세로 또는 정사각형 영상이며 3분 이하여야 합니다.": "YouTube Shorts videos must be portrait or square and no longer than 3 minutes.",
  "YouTube 제목은 1~100자여야 합니다.": "YouTube titles must contain 1 to 100 characters.", "YouTube 설명은 5,000자 이하여야 합니다.": "YouTube descriptions must be no longer than 5,000 characters.", "YouTube 공개 범위를 확인해 주세요.": "Check the YouTube visibility setting.",
  "Instagram Reels 영상 길이는 3초~15분이어야 합니다.": "Instagram Reels videos must be 3 seconds to 15 minutes long.", "Instagram 캡션은 2,200자 이하여야 합니다.": "Instagram captions must be no longer than 2,200 characters.", "TikTok 캡션은 UTF-16 기준 2,200자 이하여야 합니다.": "TikTok captions must be no longer than 2,200 UTF-16 characters.",
  "JPG, PNG 또는 WebP 이미지 파일을 선택해 주세요.": "Choose a JPG, PNG, or WebP image.", "이미지는 파일당 25MB 이하로 선택해 주세요.": "Each image must be no larger than 25 MB.", "이미지를 임시 저장하지 못했습니다.": "Could not temporarily save the image.",
  "Google Cloud에서 YouTube Data API v3를 켜고 Web application OAuth 클라이언트를 만드세요. Authorized redirect URI를 아래 주소로 등록하고, OAuth 동의 화면의 테스트 사용자에 본인 계정을 추가하세요.": "Enable YouTube Data API v3 in Google Cloud and create a Web application OAuth client. Add the redirect URI below, then add your account as a test user on the OAuth consent screen.",
  "Meta 개발자 앱에 Facebook Login과 Instagram Graph API를 추가하세요. Instagram Business 또는 Creator 계정이 Facebook Page에 연결되어 있어야 합니다. 앱 검수 전에는 앱 역할이 있는 계정만 연결할 수 있습니다.": "Add Facebook Login and Instagram Graph API to your Meta developer app. An Instagram Business or Creator account must be linked to a Facebook Page. Before app review, only accounts with an app role can connect.",
  "TikTok for Developers 앱에 Login Kit와 Content Posting API를 추가하고, Desktop redirect URI를 등록하세요. video.publish 권한 승인과 앱 검수가 필요합니다. 검수 전 게시물은 비공개로 제한될 수 있습니다.": "Add Login Kit and Content Posting API to your TikTok for Developers app, then register the Desktop redirect URI. The video.publish permission and app review are required. Posts may be limited to private before review.",
  "{count}개 게시 완료": "{count} published", "{count}개 처리 중": "{count} processing", "{count}개 실패": "{count} failed",
  "/ 20,000자": "/ 20,000 characters", "{count}개 계정 연결": "{count} accounts connected", "개 계정 연결": "accounts connected",
  "Qwen3-TTS 오픈 모델이 선택한 목소리와 어투에 맞춰 한국어 음성을 만듭니다. 음성은 Apple Silicon에서 로컬로 합성되며, 이미 설치된 모델 캐시를 재사용합니다.": "The Qwen3-TTS open model generates Korean speech in the selected voice and delivery style. Speech is generated locally on Apple Silicon and reuses the installed model cache.",
};

export const locale = korean ? "ko" : "en";

const interpolate = (template, values) => template.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? `{${key}}`));

const translateDynamicMessage = (source) => {
  for (const [template, translated] of Object.entries(english)) {
    const parts = template.split(/(\{\w+\})/g);
    if (!parts.some((part) => /^\{\w+\}$/.test(part))) continue;
    const pattern = parts.map((part) => /^\{(\w+)\}$/.test(part)
      ? "(.*?)"
      : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
    const match = source.match(new RegExp(`^${pattern}$`));
    if (!match) continue;
    const values = {};
    let groupIndex = 1;
    for (const part of parts) {
      const placeholder = part.match(/^\{(\w+)\}$/);
      if (placeholder) values[placeholder[1]] = match[groupIndex++];
    }
    return interpolate(translated, values);
  }
  return source;
};

export const t = (source, values = {}) => {
  const translated = korean ? source : (english[source] || translateDynamicMessage(source));
  return interpolate(translated, values);
};

export const applyDocumentLocale = () => {
  document.documentElement.lang = locale;
  document.title = t("makeshort — 타임라인 영상 편집기");
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
};
