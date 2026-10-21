"""태깅 엔진은 prototype/axia_tagger.py 한 곳에만 있어요. 여기는 그걸 불러다 쓰기만 해요.
엔진을 고칠 땈 prototype/axia_tagger.py 를 고치면 Tag Lab과 시제품에 같이 반영돼요."""
import importlib.util, sys
from pathlib import Path

_core = Path(__file__).resolve().parent.parent / "prototype" / "axia_tagger.py"
sys.path.append(str(_core.parent))  # 가짜 AI(mock_model)도 prototype 폴더 것을 써요
_spec = importlib.util.spec_from_file_location("axia_core", _core)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
globals().update({k: v for k, v in vars(_mod).items() if not k.startswith("__")})
