# data/raw/

공공데이터 원본 CSV 파일을 이 폴더에 넣어주세요.

## 착한가격업소 CSV 파일명

```
행정안전부_착한가격업소 현황_20250930.csv
```

## 임포트 방법

```bash
# scripts/ 폴더에서 실행
cd scripts
node import-csv.js
```

## 주의사항

- 이 폴더의 CSV 파일은 `.gitignore`에 의해 Git에 커밋되지 않습니다. (용량 크고 개인정보 포함 가능)
- 필요한 환경변수: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `KAKAO_REST_KEY`
