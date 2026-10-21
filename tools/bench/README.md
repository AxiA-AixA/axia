# Axia 측정 도구 (Test 3 + Test 4)

한 번 실행하면 두 테스트에 필요한 숫자가 같이 나와요.

- **Test 3**: 같은 이미지에 같은 태그·분야·그룹 이름이 나오는지 (3회 반복, 자유 태그 vs 태그 목록)
- **Test 4**: 장당 걸린 시간, 실제 입력·출력 토큰 → 실제 비용

80장 × 3회 × 2방식 = **480건**이라 Test 4의 "300장 기준 측정"도 같이 끝나요.

## 0. 준비물

1. `~/Downloads/axia-test3/` 폴더에 이미지 80장 (하위 폴더 `영상`, `AI이미지`, `3D`, `그래픽`, `편집디자인`, `사진`, `UIUX`, `공간전시`에 10장씩)
2. AI 모델 API 키 하나 이상

| 회사 | 키 받는 곳 | 추천 모델 (저가) | 300건 예상 비용 |
|---|---|---|---|
| Anthropic | console.anthropic.com → API Keys | `claude-haiku-5-5` | 약 $0.07 |
| Google | aistudio.google.com → Get API key | `gemini-2.5-flash-lite` | 약 $0.08 |
| OpenAI | platform.openai.com → API keys | 콘솔에서 모델 이름 확인 | 약 $0.07~0.14 |

비용은 배치 할인 없는 일반 요금 기준 대략값이에요. 처음엔 한 회사만 해도 충분해요.

**API 키는 비밀번호와 같아요.** 채팅이나 문서에 붙여넣지 말고, 아래처럼 터미널에서만 쓰세요.

## 1. 점검 (API 호출 없음)

터미널을 열고:

```
cd ~/Downloads/axia-bench
python3 bench.py --dry-run
```

`폴더별 장수: {'3D': 10, 'AI이미지': 10, ...}` 처럼 나오면 준비 완료. 경고가 나오면 폴더 이름을 고쳐 주세요.

## 2. 시험 실행 (5장만)

```
ANTHROPIC_API_KEY=여기에키 python3 bench.py --provider anthropic --model claude-haiku-5-5 --limit 5 --runs 1 --mode free
```

에러 없이 끝나면 본 실행으로.

## 3. 본 실행

```
ANTHROPIC_API_KEY=여기에키 python3 bench.py --provider anthropic --model claude-haiku-5-5
```

다른 회사도 해보려면:

```
GEMINI_API_KEY=여기에키 python3 bench.py --provider gemini --model gemini-2.5-flash-lite
OPENAI_API_KEY=여기에키 python3 bench.py --provider openai --model 모델이름
```

몇 분 걸려요. 끝나면 `results/` 폴더에 결과 파일이 생기고, 화면에 평균 시간·토큰·분야 정확도 요약이 나와요.

## 4. 끝나면

Claude에게 "측정 끝났어"라고만 말해 주세요. `results/` 폴더를 읽어서

- 3회 분석 간 태그 일치율, 분야 정확도, 태그 쏠림 (Test 3)
- 실측 토큰으로 다시 계산한 장당 비용, 처리 속도 (Test 4)

를 계산하고, 태그 검토 페이지를 만들어 드려요.

## 중복률 측정 (Test 4, 따로)

하람 님과 부근 님이 각자 확장 프로그램 결과 페이지에서 **JSON 내보내기**로 받은 파일 두 개가 있으면:

```
pip3 install pillow imagehash
python3 dup.py 하람.json 부근.json
```

썸네일 주소가 만료되기 전(수집 직후)에 돌려야 이미지 비교까지 돼요.

## 옵션

| 옵션 | 뜻 | 기본값 |
|---|---|---|
| `--runs` | 같은 이미지를 몇 번 반복 분석할지 | 3 |
| `--mode` | `free` 자유 태그 / `list` 태그 목록 / `both` 둘 다 | both |
| `--size` | AI에 보낼 이미지 긴 변 (px). Gemini는 384로 하면 토큰이 1/4 | 512 |
| `--workers` | 동시에 보낼 요청 수 | 4 |
| `--limit` | 앞에서 N장만 | 전체 |

태그 목록 방식에서 쓰는 목록은 `tags.txt`에 있어요(97개). 팀에서 고쳐도 돼요.
