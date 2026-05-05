#!/usr/bin/env python3
"""
ThunderExam 환경 점검 스크립트
실행: python setup_check.py

새 PC 또는 새 환경 세팅 후 이 스크립트를 먼저 실행해 모든 의존성이
올바르게 설치되었는지 확인하세요.
"""

import sys
import shutil
import subprocess

OK    = "✓"
FAIL  = "✗"
WARN  = "!"

errors   = []
warnings = []


def check(label: str, ok: bool, fix: str = ""):
    if ok:
        print(f"  {OK}  {label}")
    else:
        print(f"  {FAIL}  {label}")
        if fix:
            print(f"       → {fix}")
        errors.append(label)


def warn(label: str, msg: str = ""):
    print(f"  {WARN}  {label}")
    if msg:
        print(f"       → {msg}")
    warnings.append(label)


# ── Python 버전 ──────────────────────────────────────────
print("\n[1] Python 버전")
major, minor = sys.version_info[:2]
check(
    f"Python {major}.{minor} (3.10+ 권장, 현재: {sys.version.split()[0]})",
    major == 3 and minor >= 10,
    "https://www.python.org/downloads/ 에서 3.10 이상 설치"
)

# ── Python 패키지 ─────────────────────────────────────────
print("\n[2] Python 패키지")

def pkg(name: str, import_as: str = "", min_ver: str = ""):
    mod = import_as or name
    try:
        m = __import__(mod)
        ver = getattr(m, "__version__", None)
        if ver is None:
            # 일부 패키지는 importlib.metadata로 버전 확인
            try:
                import importlib.metadata
                ver = importlib.metadata.version(name)
            except Exception:
                ver = "?"
        label = f"{name} {ver}"
        if min_ver and ver != "?":
            from packaging.version import Version
            ok = Version(ver) >= Version(min_ver)
        else:
            ok = True
        check(label, ok, f"pip install {name}>={min_ver}" if min_ver else f"pip install {name}")
    except ImportError:
        check(f"{name} (없음)", False, f"pip install {name}")

pkg("PyMuPDF",             "fitz",         "1.23.0")
pkg("rapidfuzz",           "rapidfuzz",    "3.0.0")
pkg("pdf2image",           "pdf2image",    "1.16.0")
pkg("opencv-python",       "cv2",          "4.8.0")
pkg("Pillow",              "PIL",          "10.0.0")
pkg("numpy",               "numpy",        "1.24.0")
pkg("PyYAML",              "yaml",         "6.0.0")

# ── 외부 바이너리 ─────────────────────────────────────────
print("\n[3] 외부 바이너리")

# Tesseract
tess = shutil.which("tesseract")
if tess:
    try:
        result = subprocess.run(
            ["tesseract", "--version"],
            capture_output=True, text=True, timeout=5
        )
        ver_line = (result.stdout or result.stderr).splitlines()[0]
        check(f"Tesseract — {ver_line}  ({tess})", True)
    except Exception:
        check(f"Tesseract 발견 ({tess})", True)
else:
    check(
        "Tesseract (없음 또는 PATH 미등록)",
        False,
        "Windows: https://github.com/UB-Mannheim/tesseract/wiki 에서 설치 후 PATH 추가\n"
        "       한국어 pack(kor.traineddata)도 함께 설치 권장"
    )

# Poppler (pdftoppm)
pdftoppm = shutil.which("pdftoppm")
if pdftoppm:
    try:
        result = subprocess.run(
            ["pdftoppm", "-v"],
            capture_output=True, text=True, timeout=5
        )
        ver_line = (result.stderr or result.stdout).splitlines()[0]
        check(f"Poppler/pdftoppm — {ver_line}  ({pdftoppm})", True)
    except Exception:
        check(f"Poppler/pdftoppm 발견 ({pdftoppm})", True)
else:
    check(
        "Poppler/pdftoppm (없음 또는 PATH 미등록)",
        False,
        "Windows: https://github.com/oschwartz10612/poppler-windows/releases 에서\n"
        "       zip 압축 해제 후 bin/ 폴더를 PATH에 추가"
    )

# ── pdf2image ↔ Poppler 연동 테스트 ──────────────────────
print("\n[4] 연동 테스트")
try:
    from pdf2image.exceptions import PDFInfoNotInstalledError
    # pdftoppm 실제 호출 없이 import만 확인
    check("pdf2image import 성공", True)
except Exception as e:
    check(f"pdf2image import 실패: {e}", False, "pip install pdf2image")

try:
    import fitz
    check("PyMuPDF (fitz) import 성공", True)
except ImportError:
    check("PyMuPDF (fitz) import 실패", False, "pip install PyMuPDF")

try:
    import cv2
    import numpy as np
    # 간단한 OpenCV 연산 테스트
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    check("OpenCV + NumPy 연산 성공", True)
except Exception as e:
    check(f"OpenCV 연산 실패: {e}", False, "pip install opencv-python numpy")

# ── 결과 요약 ─────────────────────────────────────────────
print("\n" + "=" * 50)
if not errors:
    print(f"  {OK}  모든 점검 통과! ThunderExam 파이프라인 실행 가능합니다.")
else:
    print(f"  {FAIL}  {len(errors)}개 항목 실패:")
    for e in errors:
        pr