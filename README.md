# Tampermonkey Userscripts

치지직(CHZZK) 웹 플레이어 편의성 개선을 위한 Tampermonkey 유저스크립트 모음입니다.

---

## 스크립트 목록 및 설치

Tampermonkey 확장 프로그램이 설치된 브라우저에서 아래 **설치** 링크를 클릭하면 즉시 설치 화면이 표시됩니다.

| 스크립트 | 버전 | 설명 | 설치 |
| :--- | :---: | :--- | :---: |
| **치지직 광고 차단 감지 우회**<br>`chzzk-adblock-detect-bypass` | `v0.3.0` | 광고 편성 게이트(seoraksan) 비활성화 및 광고 차단 탐지 프로브 무력화 (`AD_NOT_DISPLAYED` 재생 중단 및 `dab:true` 360p 저하 방지) | [설치](https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-adblock-detect-bypass.user.js) |
| **치지직 라이브 자동 최고화질**<br>`chzzk-auto-highest-quality` | `v0.1.0` | HLS 마스터 매니페스트를 가로채 최고 해상도 variant만 유지하여 항상 최고화질로 고정 | [설치](https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-auto-highest-quality.user.js) |
| **치지직 통나무 파워 자동 획득**<br>`chzzk-auto-log-power` | `v0.1.0` | 이벤트 훅 기반 무폴링 통나무 파워 claim 자동 획득 및 팝업 배너 자동 닫기 | [설치](https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-auto-log-power.user.js) |

---

## 자동 업데이트 안내

모든 스크립트에는 `@updateURL`과 `@downloadURL`이 포함되어 있습니다.
- 저장소에 새로운 버전이 push되면 Tampermonkey가 주기적으로 이를 감지하여 자동 업데이트합니다.
- Tampermonkey 대시보드에서 **지금 업데이트 확인**을 눌러 수동으로 즉시 최신 버전을 적용할 수도 있습니다.

---

## 라이선스

[MIT License](LICENSE)
