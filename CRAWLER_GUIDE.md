# Hướng dẫn Crawler — Thu thập dữ liệu, Vận hành & Cách dùng

Tài liệu cho service `global-market-crawler`: crawler thu thập dữ liệu thị trường từ các nguồn bên thứ ba và ghi vào MongoDB. Frontend/API chỉ đọc từ MongoDB, không gọi trực tiếp nguồn ngoài.

---

## 1. Kiến trúc & luồng dữ liệu

```
Nguồn dữ liệu (TradingView, TradingEconomics, vang.today, Phú Quý, open.er-api.com)
        │
        ▼
Providers (src/providers/*)          ← fetch + parse từng nguồn
        │
        ▼
Ingestion pipeline (src/crawl/*)     ← chuẩn hóa, gom payload theo module
        │
        ▼
MongoDB (src/db/mongo.ts)            ← upsert document + snapshot + history,
                                       ghi ingestion_jobs, refresh search index
```

- **Universe động**: không có danh sách asset cứng trong code. Danh sách stocks/crypto/commodities/brand vàng được phát hiện (discover) trực tiếp từ nguồn ở mỗi lần crawl.
- **Mỗi lần crawl là một job**: được ghi vào collection `ingestion_jobs` với trạng thái `success` / `partial_success` / `failed` kèm số instrument xử lý và thông báo lỗi — dùng để giám sát.

## 2. Các module & nguồn dữ liệu

| Module | Nguồn | Collections |
|---|---|---|
| Stocks | TradingView equity scanner (list); TradingView symbol page (detail — phase riêng) | `stocks`, `stock_snapshots`, `stock_price_history` |
| Crypto | TradingView coin scanner (list); TradingView coin page (detail — phase riêng) | `cryptos`, `crypto_snapshots`, `crypto_price_history` |
| Commodities | TradingEconomics (list + detail) | `commodities`, `commodity_snapshots`, `commodity_price_history` |
| Vietnam Gold (vàng + bạc) | vang.today (brand vàng, giá, lịch sử); Phú Quý (giá bạc); open.er-api.com (tỷ giá USD/VND) | `vietnam_gold_brands`, `vietnam_gold_snapshots`, `vietnam_gold_price_history`, `raw_vietnam_gold_prices` |
| Dùng chung | — | `market_news`, `market_insights`, `search_index_cache`, `ingestion_jobs` |

Lưu ý module Vietnam Gold chứa cả **vàng và bạc**, phân biệt bằng field `metal_type: "gold" | "silver"`.

### List phase vs Detail phase

Stocks và Crypto được tách làm 2 phase độc lập:

- **List phase** (`crawl:stocks`, `crawl:crypto`): lấy danh sách + giá + snapshot từ scanner. Nhanh, chạy thường xuyên theo cron.
- **Detail phase** (`crawl:stocks:detail`, `crawl:crypto:detail`): đọc lại collection trong DB, fetch trang chi tiết từng symbol (description, CEO, ISIN, website, whitepaper…) và cập nhật document. Chậm (fetch từng trang), chỉ chạy khi cần làm giàu dữ liệu. **Phase này không nằm trong cron** — chạy tay khi muốn.
- Document đã enrich có `detail_enriched_at` và mặc định sẽ bị bỏ qua ở lần detail sau; đặt `STOCK_DETAIL_FORCE=1` để enrich lại toàn bộ.

## 3. Cài đặt

```bash
cd global-market-crawler
pnpm install
cp .env.example .env   # rồi điền MONGO_URI
```

## 4. Cách dùng — chạy tay

### Crawl ghi vào MongoDB

```bash
pnpm run crawl                          # tất cả module
pnpm run crawl -- --market=stock        # chỉ stocks (list)
pnpm run crawl -- --market=crypto
pnpm run crawl -- --market=commodity
pnpm run crawl -- --market=vietnam_gold
pnpm run crawl -- --market=crypto,commodity   # nhiều module

# hoặc script riêng từng module:
pnpm run crawl:stocks
pnpm run crawl:crypto
pnpm run crawl:commodities
pnpm run crawl:vietnam-gold
```

### Dry-run (không ghi DB, xuất JSON ra `outputs/`)

```bash
pnpm run crawl:dry
pnpm run crawl:stocks:dry
pnpm run crawl:crypto:dry
pnpm run crawl:commodities:dry
pnpm run crawl:vietnam-gold:dry
```

Dùng dry-run để kiểm tra nguồn/parser trước khi chạy thật.

### Detail phase (chạy tay khi cần)

```bash
pnpm run crawl:stocks:detail
pnpm run crawl:crypto:detail
```

## 5. Vận hành tự động — Cron scheduler

### Lịch crawl

File `src/scheduler.ts` là process chạy nền dùng `node-cron`, spawn các script crawl theo lịch:

| Job | Lịch mặc định | Ghi chú |
|---|---|---|
| stocks | mỗi 12 giờ (`0 */12 * * *` — 00:00 và 12:00) | chỉ crawl list, **không** crawl stock detail |
| crypto, commodities, vietnam-gold | mỗi 1 giờ (`0 * * * *`) | chạy **tuần tự** để tránh dồn tải nguồn/DB |

Cơ chế an toàn:

- **Chống chồng lấp**: nếu lượt crawl trước của một job chưa xong khi tới lịch mới, lượt mới bị bỏ qua (có log).
- Mỗi job chạy trong **child process riêng** — một module lỗi không ảnh hưởng scheduler và module khác.
- Log có timestamp, thời lượng và exit code từng job.

Đổi lịch qua env (không cần sửa code):

```bash
STOCKS_CRON_SCHEDULE="0 */6 * * *"   # ví dụ: stocks mỗi 6h
HOURLY_CRON_SCHEDULE="*/30 * * * *"  # ví dụ: các module khác mỗi 30 phút
```

### Chạy scheduler trực tiếp

```bash
pnpm run cron                              # chạy theo lịch
pnpm run cron:now                          # crawl tất cả ngay khi khởi động, rồi theo lịch
npx tsx src/scheduler.ts --run-now=crypto  # crawl ngay 1 job cụ thể, rồi theo lịch
```

Chạy kiểu này phụ thuộc terminal — đóng terminal là dừng. Để chạy bền dùng pm2 (bên dưới).

### Chạy bền với pm2 (khuyên dùng)

Repo có sẵn `ecosystem.config.cjs`:

```bash
npm install -g pm2          # cài 1 lần
pm2 start ecosystem.config.cjs   # khởi động job "crawler-cron"
pm2 save                    # lưu danh sách process để resurrect
```

pm2 tự restart scheduler nếu crash. Lệnh thường dùng:

```bash
pm2 list                    # xem trạng thái
pm2 logs crawler-cron       # xem log realtime
pm2 logs crawler-cron --nostream --lines 100   # xem 100 dòng log gần nhất
pm2 restart crawler-cron
pm2 stop crawler-cron
```

### Tự khởi động cùng máy (macOS)

Có 2 cách, chọn một:

1. **LaunchAgent** (không cần sudo — đang dùng trên máy dev): file `~/Library/LaunchAgents/com.globalmarket.pm2-resurrect.plist` tự chạy `pm2 resurrect` khi đăng nhập, khôi phục mọi process đã `pm2 save`. Đăng ký bằng:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.globalmarket.pm2-resurrect.plist
```

2. **pm2 startup** (cần sudo): chạy `pm2 startup` và copy/paste lệnh sudo nó in ra.

Lưu ý: máy ngủ (sleep) thì cron không bắn — lượt đó bị bỏ qua, job chạy lại ở mốc lịch kế tiếp khi máy thức. Cần crawl 24/7 thật sự thì deploy crawler + pm2 lên server/VPS.

## 6. Cấu hình env quan trọng

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MONGO_URI` | (bắt buộc) | Connection string MongoDB |
| `MONGO_DB_NAME` | `global_market` | Tên database |
| `STOCK_DISCOVERY_LIMIT` | `5` | Số stocks tối đa; `all`/`0` = toàn bộ universe scanner |
| `TRADINGVIEW_MARKETS` | `america` | Vùng equity scanner; `all` = toàn cầu (~40k mã, chậm) |
| `CRYPTO_DISCOVERY_LIMIT` | (trống) | Số coin tối đa; trống/`all`/`0` = full list |
| `COMMODITY_DISCOVERY_LIMIT` | `5` | Số commodities tối đa; trống/`all`/`0` = full list |
| `VIETNAM_GOLD_DISCOVERY_LIMIT` | `10` | Số brand vàng tối đa |
| `STOCK_PERSIST_BATCH_SIZE` | `1000` | Flush rows vào Mongo mỗi N dòng (list phase) |
| `STOCK_DETAIL_BATCH_SIZE` | `1000` | Batch bulkWrite ở detail phase |
| `STOCK_DETAIL_FORCE` | `0` | `1` = enrich lại cả mã đã có `detail_enriched_at` |
| `STOCKS_CRON_SCHEDULE` | `0 */12 * * *` | Lịch cron cho stocks |
| `HOURLY_CRON_SCHEDULE` | `0 * * * *` | Lịch cron cho crypto/commodities/vietnam-gold |
| `REQUEST_TIMEOUT_MS` | `15000` | Timeout mỗi request |
| `USER_AGENT` | `veriq-markets-crawler/1.0` | User-Agent khi fetch |

## 7. Giám sát & xử lý sự cố

- **Lịch sử các lần crawl**: collection `ingestion_jobs` — mỗi job có `status`, `items_processed`, `error_message`, thời gian bắt đầu/kết thúc. Job `partial_success` nghĩa là crawl xong nhưng có issue ở một số asset (xem `error_message`).
- **Log scheduler**: `pm2 logs crawler-cron` (file log tại `~/.pm2/logs/crawler-cron-out.log` và `crawler-cron-error.log`).
- **Kiểm tra nguồn bị hỏng**: chạy dry-run module nghi ngờ (`pnpm run crawl:vietnam-gold:dry`) và xem JSON trong `outputs/`.
- **Crawl bị bỏ qua liên tục** (log "lần chạy trước chưa kết thúc"): job chạy lâu hơn chu kỳ cron — thường gặp với crypto khi `CRYPTO_DISCOVERY_LIMIT` để trống (full list). Giảm limit hoặc giãn lịch.
- **Sau khi crawl xong dữ liệu mới không hiện trên web**: kiểm tra API server (`global-market-api`) — API đọc trực tiếp MongoDB nên thường chỉ cần refresh; nếu sửa code API thì phải rebuild + restart.
