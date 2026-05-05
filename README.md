# ThunderExam

> 기출 문제·해설을 빠르게 풀고 답·해설을 즉시 확인 — **시험 전 일주일에 80점 달성** 목표

---

## 목차

1. [목적](#목적)
2. [폴더 구조](#폴더-구조)
3. [빠른 시작 (웹앱만)](#빠른-시작-웹앱만)
4. [풀 셋업 (파이프라인 포함)](#풀-셋업-파이프라인-포함)
5. [자주 쓰는 명령어](#자주-쓰는-명령어)
6. [절대 손대지 말 것](#절대-손대지-말-것)

---

## 목적

ThunderExam은 금융투자분석사(구 재무분석사) 기출 풀복원 PDF에서 OX·선택형 문제를 자동 추출하고, 브라우저 기반 퀴즈 앱으로 제공하는 로컬 도구입니다.

- **웹앱**: `github_pages/index.html` — 문제 풀기 / 답·해설 즉시 확인
- **파이프라인**: 새 PDF → JSON → 웹앱 데이터 자동 변환

---

## 폴더 구조

```
ThunderExam/
│
├── github_pages/          ★ 웹앱 정본 (이것만 열면 됨)
│   ├── index.html
│   ├── app.js
│   ├── quiz_engine.js
│   ├── progress.js
│   ├── pdf_paths.js
│   └── data/
│       ├── exam_A/        40·41회 기출 (locked — 재실행 금지)
│       ├── exam_B/        42·43회 기출 (locked — 재실행 금지)
│       ├── exam_C/        44회 기출 (운용 중)
│       └── manifest.json
│
├── pipeline/              새 시험 추가용 파이프라인
│   ├── run_pipeline.py    ← 메인 진입점
│   ├── switch_exam.py     시험 전환
│   ├── analyze_pdf.py     PDF 미리보기
│   └── steps/            단계별 모듈
│
├── phase4/                exam_A/B 생성에 쓰인 레거시 파이프라인 (참고용)
├── phase1/                공유 PDF 파서 (parser_v3.py)
├── phase1.5/              exam_B 데이터 시드
├── tools/                 보조 도구
│   ├── build_pdf_path_map.py
│   ├── verify_explanation_links.py
│   └── conflict_review.html
│
├── raw_pdfs/              원본 PDF (40~44회)
├── exams/                 파이프라인 작업 디렉터리 (각 시험 id/)
├── data/                  파이프라인 출력 미러 (github_pages/data/ 로 복사됨)
│
├── requirements.txt       Python 의존성
├── setup_check.py         환경 점검 스크립트
└── README.md              이 파일
```

---

## 빠른 시작 (웹앱만)

> Python·Tesseract 없이 브라우저만으로 충분합니다.

**방법 A — 로컬 파일 직접 열기 (가장 간단)**

```
github_pages/index.html 파일을 브라우저(Chrome/Edge)로 열기
```

단, 로컬 파일 CORS 제한으로 data/ 로딩이 막힐 수 있습니다. 그럴 경우 방법 B를 사용하세요.

**방법 B — 로컬 서버 실행**

```bash
cd ThunderExam/github_pages
python -m http.server 8000
# → 브라우저에서 http://localhost:8000 접속
```

**방법 C — GitHub Pages**

저장소를 GitHub에 push하고 `Settings → Pages → 소스: github_pages/` 로 설정하면 인터넷 어디서나 접속 가능합니다.

---

## 풀 셋업 (파이프라인 포함)

새 PDF를 처리하거나 파이프라인을 실행하려면 아래 환경이 필요합니다.

### 1. Python 설치

Python 3.10 이상을 권장합니다. [python.org](https://www.python.org/downloads/)

### 2. Python 패키지 설치

```bash
pip install -r requirements.txt
```

### 3. 외부 바이너리 설치 (Windows)

**Tesseract OCR**

1. [UB Mannheim 빌드](https://github.com/UB-Mannheim/tesseract/wiki) 에서 설치 파일 다운로드
2. 설치 중 "Additional language data" → Korean (kor) 체크
3. 설치 경로(예: `C:\Program Files\Tesseract-OCR`)를 시스템 PATH에 추가

**Poppler (pdftoppm)**

1. [poppler-windows releases](https://github.com/oschwartz10612/poppler-windows/releases) 에서 최신 zip 다운로드
2. 압축 해제 후 `bin/` 폴더를 시스템 PATH에 추가

### 4. 환경 점검

```bash
python setup_check.py
```

모든 항목에 ✓ 표시가 나오면 준비 완료입니다.

---

## 자주 쓰는 명령어

```bash
# 환경 점검
python setup_check.py

# 웹앱 로컬 서버 실행
cd github_pages
python -m http.server 8000

# 새 시험 파이프라인 실행 (exam_C 예시)
cd pipeline
python run_pipeline.py --exam exam_C

# PDF 구조 미리보기
cd pipeline
python analyze_pdf.py path/to/file.pdf

# 시험 전환 (활성 시험 변경)
cd pipeline
python switch_exam.py exam_C

# 해설 링크 검증
cd tools
python verify_explanation_links.py

# PDF 경로 맵 재생성
cd tools
python build_pdf_path_map.py
```

---

## 절대 손대지 말 것

아래 작업은 **데이터 파괴 또는 검증 무효화**로 이어지므로 절대 하지 마세요.

**① phase4/ 파이프라인 재실행 금지**

`phase4/batch_parse.py`, `rebuild_phase15.py` 등은 exam_A·B 데이터를 생성한 레거시 파이프라인입니다. 재실행하면 수동 검증된 27개 항목이 덮어씌워집니다. 참고용으로만 보세요.

**② github_pages/data/ 수기 편집 금지**

`data/exam_A/data.js`, `data/exam_B/data.js` 등의 파일은 파이프라인 출력물입니다. 직접 편집하면 파이프라인과 불일치가 발생합니다. 수정이 필요할 경우 `pipeline/steps/apply_text_overrides.py` 또는 `apply_calc_overrides.py`를 통해 패치하세요.

**③ github_pages/ 외 app/ 폴더 사용 금지**

`app/` 폴더는 구버전(deprecated)입니다. 웹앱 정본은 `github_pages/` 입니다.

**④ git push는 Windows에서 직접**

파이프라인 sandbox는 Git 인증이 없습니다. 커밋 준비 후 Windows 터미널에서 직접 `git push`하세요.

---

## 트러블슈팅

**문제: 브라우저에서 data/ 로딩 실패**

로컬 파일로 열 때 CORS 제한이 걸립니다. `python -m http.server 8000`으로 로컬 서버를 띄우세요.

**문제: setup_check.py에서 fitz import 실패**

```bash
pip install PyMuPDF
```

**문제: pdf2image 오류 "poppler not found"**

Poppler의 `bin/` 폴더가 PATH에 없습니다. 시스템 환경 변수에 추가 후 터미널 재시작.

**문제: tesseract not found**

Tesseract 설치 경로를 PATH에 추가. `where tesseract` 로 확인.
