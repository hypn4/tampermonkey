# 치지직 유저스크립트

치지직(CHZZK) 라이브 시청 중 광고 차단 감지, 화질 제한, P2P 그리드 강제 설치 등의 불편을 해소하는 Tampermonkey 유저스크립트 모음입니다.

## 어떤 스크립트가 있나요?

| 스크립트 | 버전 | 설명 | 설치 |
| :--- | :---: | :--- | :---: |
| 광고 차단 감지 우회 | `v0.3.0` | 광고 차단기 사용 시 재생 중단·화질 강제 저하를 방지합니다 | [설치](https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-adblock-detect-bypass.user.js) |
| 라이브 자동 최고화질 | `v0.1.0` | HLS 매니페스트에서 최고 해상도만 남겨 항상 최고화질로 재생합니다 | [설치](https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-auto-highest-quality.user.js) |
| 그리드 없는 고화질 | `v0.2.0` | 그리드(P2P) 설치 없이 일반 CDN으로 고화질을 선택할 수 있습니다 | [설치](https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-no-grid.user.js) |
| 통나무 파워 자동 획득 | `v0.1.0` | 통나무 파워를 자동으로 획득하고 팝업 배너를 닫습니다 | [설치](https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-auto-log-power.user.js) |

## 왜 필요한가요?

치지직은 광고 차단기를 감지하면 재생을 중단하거나 화질을 강제로 낮추고, 고화질 시청에는 그리드 프로그램 설치를 요구합니다. 이 스크립트들은 브라우저 단에서 해당 제한을 우회하여 별도 프로그램 없이 쾌적한 시청 환경을 유지합니다.

## 어떻게 설치하나요?

1. 브라우저에 [Tampermonkey](https://www.tampermonkey.net/) 확장 프로그램을 설치합니다.
2. 위 표에서 원하는 스크립트의 **설치** 링크를 클릭하고 설치를 승인합니다.
3. 스크립트가 활성화되어 있는지 확인한 뒤 치지직 페이지를 새로고침합니다.

## 업데이트는 어떻게 되나요?

각 스크립트에 업데이트 URL이 포함되어 있어 Tampermonkey가 자동으로 업데이트합니다. 즉시 확인하려면 Tampermonkey 대시보드에서 **지금 업데이트 확인**을 클릭하세요.

## 주의할 점이 있나요?

치지직 웹사이트 구조가 변경되거나 다른 확장 프로그램과 충돌하면 스크립트가 정상 동작하지 않을 수 있습니다. 문제 발생 시 [이슈](https://github.com/hypn4/tampermonkey/issues)를 남겨 주세요.

## 라이선스

[MIT License](LICENSE)
