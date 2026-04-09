# OY 옵션 가져오기 (Chrome 확장)

올리브영 상품 페이지에서 `/goods/api/v1/option`을 같은 도메인으로 호출한 뒤, 열어둔 스마트스토어 업로드 앱(`window.opener`)으로 `postMessage`합니다.

## 설치

1. Chrome에서 `chrome://extensions` 열기  
2. **개발자 모드** 켜기  
3. **압축해제된 확장 프로그램을 로드합니다** 클릭  
4. 이 폴더(`oy-options`) 선택  

`icon.png`는 최소 크기 플레이스홀더입니다. 원하면 48×48 PNG로 교체하세요.

## 사용

1. [oy-smartstore](https://oy-smartstore.vercel.app)에서 옵션 상품을 대기열에 넣을 때 모달이 뜨면 **올리브영에서 자동 가져오기** 클릭  
2. 팝업으로 올리브영 상세가 열리면 확장의 `content.js`가 `autoFetch=true`일 때 API를 호출하고 결과를 보냅니다  
3. 확장이 없으면 모달의 **콘솔 스크립트**를 올리브영 탭 F12에 붙여넣어 옵션명을 복사한 뒤, 아래 입력란에 붙여넣기  

로컬 개발 시 `manifest.json`의 `externally_connectable`에 사용 중인 origin을 추가할 수 있습니다.
