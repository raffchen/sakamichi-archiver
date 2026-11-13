# Message (Sony Music) API Reference

Reverse-engineered API used by the web apps at `message.nogizaka46.com` and
`message.sakurazaka46.com` (the fan-message service; also used by the native
apps). All access is over HTTPS with Bearer-JWT auth.

Documented behaviors verified empirically against live traffic (see
`tools/api-capture.py` + `logs/api/`).

## Sites

| Site | Web origin | API base | `X-Talk-App-ID` |
|---|---|---|---|
| Nogizaka46 | `https://message.nogizaka46.com` | `https://api.message.nogizaka46.com/v2` | `jp.co.sonymusic.communication.nogizaka 2.5` |
| Sakurazaka46 | `https://message.sakurazaka46.com` | `https://api.message.sakurazaka46.com/v2` | `jp.co.sonymusic.communication.sakurazaka 2.5` |

The API shape is identical across sites; only the domains and app IDs differ.

## Authentication

- **JWT Bearer token** in the `Authorization` header (~132 chars,
  `Authorization: Bearer eyJhbGciOiJIUzI1NiIs...`). Short TTL — the app
  refreshes it periodically via `POST /v2/update_token`.
- Login is OAuth via **LINE** (`access.line.me/oauth2/...`); the JWT is issued
  after consent and stored encrypted in the browser (`FlutterSecureStorage`,
  localStorage).

### Required headers

```
Authorization: Bearer <jwt>
Accept: application/json
Content-Type: application/json
X-Talk-App-ID: jp.co.sonymusic.communication.<nogizaka|sakurazaka> 2.5
X-Talk-App-Platform: web
User-Agent: <browser UA>
Referer: https://message.<site>.com/
```

Omitting `X-Talk-App-ID` / `X-Talk-App-Platform` yields
`400 {"code":"api_major_version","message":"APIのメジャーバージョンが正しくありません"}`.

Note the app ID contains a **space** before the version (`...nogizaka 2.5`).

CORS: the browser performs an `OPTIONS` preflight for every API call
(`Access-Control-Request-Headers: authorization,content-type,x-talk-app-id,x-talk-app-platform`).

## Endpoints

### `GET /groups?organization_id=1`

All subscribed members ("groups") for the organization.

```json
[
  {
    "id": 47, "organization_id": 1, "state": "open",
    "name": "池田 瑛紗",
    "thumbnail": "https://djznowbmqickg.cloudfront.net/public/groups/thumbnails/47-....jfif",
    "is_letter_destination": true,
    "groups": [47, 71], "updated_at": "..."
  }
]
```

### `GET /groups/{id}/timeline`

The main sync endpoint. Query params:

| Param | Values | Meaning |
|---|---|---|
| `count` | int, **max 200** (400 above) | page size |
| `order` | `desc` \| `asc` | sort by timestamp |
| `updated_from` | ISO 8601 UTC | cursor: messages with `updated_at >= <ts>` (**inclusive**) |
| `clear_unread` | `true` | marks the group as read (server-side state) |
| `translation_lang` | `en` | server-side translations |

Proven usages:

- **Newest page**: `?count=200&order=desc&clear_unread=true`
- **Forward sync** (what the app does on open, incrementally):
  `?updated_from=<last synced ts>&count=200&order=asc`
- **Full-history walk** (used by `--full-history`): start with a timestamp
  before the subscription date and page forward:
  ```
  ?count=200&order=asc&updated_from=2026-07-01T00:00:00Z   # page 1 (oldest)
  ?count=200&order=asc&updated_from=<last updated_at>      # next page
  ...                                                       # until empty/caught up
  ```
  The cursor is inclusive → the first item of each page repeats the last item
  of the previous page; deduplicate by message `id`.
  `count` above 200 returns HTTP 400. Unknown params (`updated_to`, `before`,
  `before_id`, ...) are silently ignored.

Response:

```json
{
  "queried_at": "2026-11-12T...",
  "messages": [ ... ],
  "letters": [],
  "comments": []
}
```

### `GET /groups/{id}/past_messages`

**Not history pagination.** Takes no meaningful params (`translation_lang`
only) and returns a **fixed window: the messages from the day the subscription
activated** — i.e. the "previous day preview" you can see right after
subscribing. Verified: every captured response (4 nogizaka members, 1
sakurazaka member) contained only messages published on the subscription day
(`2026-11-10` / `2026-07-12` respectively), and repeated calls return
byte-identical pages. It does not advance or paginate.

**Consequence:** to archive the whole history, walk `timeline` with the
`updated_from` cursor (above) starting from the subscription date.

### `GET /groups/{id}/members`

Member(s) attached to the group: display name, thumbnails, birthday, groups.

The group ID and member ID are **not always equal** (e.g. group `61` → member
`58` on nogizaka, group `82` → member `137` on sakurazaka); messages carry
`member_id`, the Talk/home listing uses group IDs.

Image fields on each member entry:

| Field | Path | Meaning |
|---|---|---|
| `thumbnail` | `/public/members/thumbnails/<member-id>-<upload-ts>.<ext>` | the member's **chosen profile picture** (the avatar shown next to chat messages) |
| `phone_image` | `/public/members/phone-images/...` | phone-wallpaper variant (not present on every member entry) |

Both are public CDN URLs — no signing, no expiry — and the upload timestamp
in the filename changes when the member updates the picture, so saving by
basename naturally accumulates a history.

### `GET /members/{id}`

Single member profile.

### Image semantics: filename timestamps ≠ "in use since"

**Verified with side-by-side UI screenshots (Nov 2026):** the timestamp in a
cdn filename is the **upload** time of that image asset, *not* the time it was
put into use:

- 山川 宇衣's chosen profile picture (`137-20251026-061308.jpg`, a casual
  selfie uploaded 2025-10-26) was **still her active chat avatar over a year
  later** (2026-11-12). The API's `thumbnail` field points at whatever the
  member currently selected — regardless of how old the underlying file is.
- A newer upload being present does **not** imply it is in use: her
  `phone_image` (`...-061309.jpg`, uploaded one minute after the selfie) was
  *also* still selected, and at some earlier point the home-page thumbnail was
  byte-identical to it (same MD5 served under both a `groups/thumbnails/82-...`
  and a `members/phone-images/137-...` URL).
- The home/Talk grid behaves the opposite way: its image tracks the **latest
  single release** (server-controlled), not any member choice.

So the two image systems are independent:

| Where shown | Image source | Controlled by |
|---|---|---|
| Chat avatars (talk thread) | `members.thumbnail` | the member's selection (can be any age) |
| Home/Talk grid | `groups.thumbnail` | the latest single release (server-managed) |

Consequence for archiving: saving whatever the API currently points at, keyed
by filename, is the correct approach — the archive reflects the true "in use"
state at sync time, and old files remain as history when the member or the
server switches to a new image.

### Group entry image fields (`GET /groups?organization_id=1`)

Each group entry carries the images shown on the **home/Talk page** — the
"current single" uniform portraits, refreshed with every single release:

| Field | Path | Meaning |
|---|---|---|
| `thumbnail` | `/public/groups/thumbnails/<group-id>-<upload-ts>.<ext>` | uniform portrait shown on the home page — changes per single release (observed dates cluster on the release day, e.g. `2026-10-27`) |
| `phone_image` | `/public/groups/phone-images/...` | phone-wallpaper variant of the same shoot |

Public CDN, no signing, no expiry. Older entries (e.g. `...-20230130-....jfif`)
remain valid URLs, so the folder history builds automatically when saving by
basename. Note one CDN quirk: at least one file (the 櫻坂46 org logo,
`33-...png`) has a `.png` extension but JPEG content.

### `GET /organizations/{id}/...`, app configs

`/public/app_configs/files/...` and `/public/organization-main-menus/icons/...`
supply the UI chrome (logos, tab icons) — not member-specific.

### Others observed (not needed for archiving)

`/v2/account`, `/v2/profile`, `/v2/update_token` (POST), `/v2/organizations`,
`/v2/organizations/{id}/configs|menu`, `/v2/announcements`,
`/v2/fan-organization-news`, `/v2/products`, `/v2/products/{id}/subscription_count`,
`/v2/receipts`, `/v2/seal-settings`, `/v2/tags`, `/v2/tutorials`, `/v2/api-updates`,
`/v2/app_configs`, `/v2/blog-members`.

## Message object schema

```json
{
  "id": 180106,
  "group_id": 47,
  "member_id": 47,
  "state": "published",
  "type": "picture",
  "text": "おやすみ🪞",
  "publish_type": "normal",
  "file": "https://djznowbmqickg.cloudfront.net/private/messages/files/180106-20261112-115603.jpg?Expires=...&Signature=...&Key-Pair-Id=...",
  "thumbnail": "https://djznowbmqickg.cloudfront.net/private/messages/thumbnails/180106-....jpg?...",
  "thumbnail_width": 1080,
  "thumbnail_height": 1440,
  "is_silent": false,
  "is_favorite": false,
  "published_at": "2026-11-12T11:57:38Z",
  "updated_at": "2026-11-12T11:57:38Z"
}
```

| Field | Notes |
|---|---|
| `type` | `text`, `picture`, `video`, `voice`. Audio messages are typed **`voice`** (not `audio`). Media types carry `file` (+ `thumbnail` for video/picture). `text` may also be present on media messages (the caption). |
| `file` | CloudFront **signed URL** — see below |
| `published_at` / `updated_at` | UTC ISO 8601. `updated_at` drives the `updated_from` cursor (edits bump it) |
| `text` | `%%%` is the app's placeholder for the subscriber's display name |
| `is_silent` | push notification suppression |
| `state` | `published` observed |

## Media URLs

Two CDN path classes exist:

| Class | Path prefix | Signing |
|---|---|---|
| **Private** (message media) | `/private/messages/files|thumbnails/...` | CloudFront signed: `?Expires=<unix>&Signature=<urlsafe-b64>&Key-Pair-Id=<kf-id>` |
| **Public** (profile/single/UI images) | `/public/members/...`, `/public/groups/...`, `/public/app_configs/...`, `/public/organization-main-menus/...` | none — plain URLs, no expiry |

### Private (signed)

```
https://djznowbmqickg.cloudfront.net/private/messages/files/<id>-<upload-ts>.<ext>
    ?Expires=<unix>&Signature=<urlsafe-b64>&Key-Pair-Id=<kf-id>
```

- Signature covers the exact path; **any** modification (including reordering
  query params or truncation) → `403`.
- `Expires` ≈ 10–15 minutes after the API response — download immediately, or
  re-sync the page to get fresh signatures.
- Requiring `Key-Pair-Id` means a cookie-based or query-signed access: dropping
  the params yields the XML error
  `{"<Error><Code>MissingKey</Code>..."}` with HTTP 200 (!), so always check
  content type / magic bytes, not just the status code.
- No auth headers needed for the download itself — the URL is self-contained.
- Extensions observed: `.jpg`, `.mp4` (video), `.m4a` (voice).

## Quirks & gotchas

1. **HTTP 200 with error bodies** — CloudFront signed-URL failures return 200
   + XML. Validate content type / magic bytes.
2. **Inclusive cursor** — `updated_from` is `>=`; dedupe by `id` across pages.
3. **`updated_at` vs `published_at`** — sorting/filtering by `updated_at` is
   what the server does; edited messages can appear "newer".
4. **count cap = 200**.
5. **past_messages is a preview, not a paginator** (see above).
6. **JWT is short-lived** — capture a fresh one from the app's own requests
   (e.g. via CDP, as `grab-media.py` does) if API calls start returning 401.
7. **App ID must match the site** — using the nogizaka app ID against the
   sakurazaka API may fail; keep them paired.
8. **Group ID ≠ member ID** — the Talk/home listing and the media-list URL use
   group IDs; messages and `/groups/{id}/members` use member IDs (they differ
   for some members, e.g. group 61 → member 58, group 82 → member 137).
9. **File extensions can lie** — the CDN serves at least one `.png` file with
   JPEG content (the 櫻坂46 org logo). Trust magic bytes over extensions when
   validating.
