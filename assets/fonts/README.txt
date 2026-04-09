이 폴더에 .ttf / .otf 를 두고, 역할은 fonts.json 에서 나눕니다.

fonts.json
- thumbnail.file + thumbnail.family → 썸네일(canvas) 전용
- subtitle.file(참고용) + subtitle.family → 본편 ASS 자막의 Fontname (libass가 fontsdir에서 매칭)

.env 로 덮어쓰기 (선택)
- THUMBNAIL_FONT_FILE=BebasNeue-Regular.ttf
- THUMBNAIL_FONT_FAMILY=Bebas Neue
- SUBTITLE_FONT_NAME=Oswald   ← 있으면 fonts.json subtitle.family 보다 우선

TTF 안의 실제 패밀리 이름은 OS/폰트마다 다를 수 있어요. 자막이 안 나오면 Aegisub 등으로 폰트명을 확인하세요.
