# 수집 관측값과 전달용 JSON

`begin`이 만든 observations.json에는 23개 항목이 모두 들어 있다. 키·단위·basis·출처와 실행 식별자를 유지한다. 새 화면을 확인한 성공 항목에만 다음을 기록한다.

- `status: "ok"`, `reason: ""`, 화면 원문 `raw_value`, 그 원문의 숫자 `value`
- `identity`, `shop_id`, 정확한 `url`, 타임존이 있는 ISO `collected_at`
- 지연 경고를 확인한 뒤의 `source_delayed: false`
- 개별 확인한 `checks.loaded/identity/unique/filters/complete`
- 지표 라벨·값·필요한 상품 ID/기간이 포함된 짧은 `evidence`
- 상품은 `entity_id`; 업데이트 필수 지표는 화면의 `source_updated_at`
- 랭킹은 `rank_category`, `rank_by`, `rank_window`; 변화는 부호 있는 값과 `direction`, `direction_evidence`
- 샘플은 `collaboration_filter`, `selection_unit_verified`, `count_stable`, `all_pages_checked`, 모든 `pages` 증거
- 리뷰는 `displayed_total`, `count_stable`, 페이지별 고유 리뷰 ID 또는 Order ID/Product ID/리뷰 날짜의 최소 조합

샘플과 리뷰의 페이지별 필수 필드는 collection.md를 따른다. 고객 메시지·리뷰 본문·사용자 이름을 복사하지 않는다. 미수집 항목은 기본 status=error를 유지하고 reason을 구체화한다.

`finish`는 로컬 보고서나 이전 날짜 원장을 만들지 않는다. manifest와 observations를 검증하고 원래 완료 시각을 고정해 전달 JSON을 생성한다. `verify`는 JSON 안의 원본을 같은 검증기로 재검증한다. 다른 PC의 .local이나 원장은 없어도 된다.

이미 finish한 실행의 observations를 바꾸면 재종료를 거부한다. 수집을 다시 해야 하면 새 begin으로 시작한다. 동일 파일 검증이나 동일 입력 재종료는 원래 완료 시각과 JSON을 보존한다.
