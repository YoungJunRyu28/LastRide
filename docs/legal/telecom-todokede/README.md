# 電気通信事業の届出（回線非設置）: LastRide groups

Prepared 2026-11-06 from the 総務省's own pages: 「電気通信事業参入マニュアル［追補版］」 (revised 2023-01-30) and 「届出書類（届出電気通信事業）のダウンロード（国内法人等向け）」. The official forms and filled-in examples are in this folder.

**Don't fill the forms in here.** The forms in this folder are the blank official ones. Copy them to `~/Documents/LastRide-private/電気通信事業届出/` and fill them in (and save the PDFs) there: filled forms hold your home address and phone, and must never be committed. `.gitignore` blocks the finished PDFs and Word lock files as a safety net.

## Why LastRide needs it

- Groups pass a member's leave time and 「〇〇さんが出発」 alerts to specific invited people through our server: 他人の通信の媒介 in a closed group.
- Manual p.31: 「主たるサービスが利用者間のメッセージの媒介ではなく、サービスの一部として利用者間のメッセージの媒介を行う機能を提供している場合も、登録又は届出が必要」, and closed chats between specific users 「登録又は届出が必要」.
- We earn from it (group creation is Premium), so it is 営む (p.15). We install no network lines, so it is a 届出, not a 登録 (p.8).
- **When:** 事業開始前 (before release). Not filing is subject to penalties (p.10).

## What to submit

| # | Document | File here |
|---|---|---|
| 1 | 電気通信事業届出書 (様式第8) | `様式第8_電気通信事業届出書.docx` (example: `記載例_様式第8_回線非設置.pdf`) |
| 2 | ネットワーク構成図 (様式第3) | `様式第3_ネットワーク構成図.docx`: paste `様式第3_ネットワーク構成図_図.png` into it (example: `記載例_様式第3_4_インターネット関連サービス.pdf` p.1) |
| 3 | 提供する電気通信役務 (様式第4) | `様式第4_提供する電気通信役務.docx` (example: same PDF p.2–3; guide: `記載要領_様式第4.pdf`) |
| 4 | 住民票の写し (original, not a photocopy) | from the ward office, or a convenience store with your マイナンバーカード |

No fee. No company documents (those are for corporations).

## 様式第8: what to write

| Field | Write |
|---|---|
| 提出年月日 | the date you submit (和暦 or 西暦) |
| 住所 (+ふりがな) | exactly as on your 住民票 |
| 氏名 (+ふりがな) | ロバーツ ニコラスナガイ, as on your 住民票, with ふりがな |
| 法人番号, 担当部署 | leave empty (individual) |
| 1 電話番号及び電子メールアドレス | **both** are required or it's rejected: your phone and lastrideapp@gmail.com (or support@lastride.jp) |
| 2 外国法人等 | leave empty |
| 3(1) 提供区域 | 全国 |
| 3(2)–(4), 4, 5 | leave empty (記載不要 for 回線非設置) |
| 6 事業開始予定年月日 | the planned release date, on or after the submission date |

## 様式第4: what to mark

Item **31 インターネット関連サービス（ＩＰ電話を除く。）** → 「○（クローズドチャット）」. The official example marks it 「○（電子メール、クローズドチャット、マッチングサイト）」, so we list only クローズドチャット.

## How to submit

- **Online:** e-Gov 電子申請 「電気通信事業の届出」: https://shinsei.e-gov.go.jp/recept/procedure/lists/procedureInformation?gtaTetCd=145181GA00001 (an e-Gov account; the 住民票 is attached as instructed there).
- **By post** to 〒102-8795 東京都千代田区九段南1丁目2番1号 九段第3合同庁舎 関東総合通信局 電気通信事業課 (it covers Kanagawa and Tokyo; the bureau goes by the address on your 住民票). The documents are 信書: send by **post** (郵便), not 宅配便 or メール便. Include a **stamped, self-addressed return envelope**, since they send back a 通知書.
- **Questions:** 関東総合通信局 電気通信事業課, 回線非設置届出: 03-6238-1675 (manual p.37).

## Is my name or address published?

No. The 総務省's 届出電気通信事業者一覧 lists filed operators (届出番号, bureau, name, 法人番号), but **individuals are not listed**: the 総務省's own 電気通信事業者実態調査票 says 「なお、個人の届出者は掲載しておりません」 (checked 2026-11-06, https://www.soumu.go.jp/main_content/000910612.docx). The home address on the form (it must match the 住民票) stays with the bureau.

## After filing

- Keep the 通知書 / 届出番号.
- Changes of name, address, phone or email: 様式第6 (after the change). Changes to service area or facilities: 様式第9 (before the change).
- Already met: 通信の秘密 (leave times only delivered, not used otherwise); 外部送信 disclosure (privacy policy lists every external transmission).
- The 総合通信局 may send an annual 電気通信事業者実態調査 (survey) to complete.
