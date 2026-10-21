# Axia

내가 모아 둔 레퍼런스(인스타 저장함, 핀터레스트 보드 등)를 한곳으로 가져와 AI 태그로 정리하는 도구.

| 폴더 | 내용 | 실행 |
|---|---|---|
| `prototype/` | Axia 시제품: 보관함 앱 + Chrome 확장 "Axia로 보내기" + 그래프 보기 | `cd prototype && python3 app.py` → http://localhost:8770 |
| `tag-lab/` | Test 3 작업대: AI 태그 시험·사람 검토·태그 규칙(Court) 다듬기 | `cd tag-lab && python3 lab.py` → http://localhost:8765 |
| `tools/bench/` | Test 3·4 측정 스크립트 (토큰·시간·중복률) | 각 README 참고 |

- 추가 설치 없이 Python 3만 있으면 돼요 (Pillow가 있으면 이미지 축소에 사용). Windows는 `python`.
- 확장 프로그램 설치: `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → `prototype/extension` (아이콘은 앱을 한 번 켜면 자동 생성).
- **API 키와 개인 보관함(`axia_data/`, `lab_data/`)은 .gitignore로 제외돼 있어요. 키를 코드에 직접 쓰지 마세요.**
- Tag Lab에서 확정한 규칙: `tag-lab/lab_data/court/court_vN.json` → `prototype/axia_data/court.json` 으로 복사.
