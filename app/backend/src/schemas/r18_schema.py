"""R18.dev schema constants (derived_* tables from weekly dumps).

Schema discovered from r18dotdev_dump SQL.gz (https://r18.dev/dumps).
"""

ACTRESS_TABLE = "derived_actress"
ACTRESS_ID_COL = "id"
ACTRESS_NAME_ROMAJI_COL = "name_romaji"
ACTRESS_NAME_KANJI_COL = "name_kanji"
ACTRESS_NAME_KANA_COL = "name_kana"
ACTRESS_IMAGE_URL_COL = "image_url"
DMM_ACTRESS_IMAGE_BASE = "https://pics.dmm.co.jp/mono/actjpgs/"

VIDEO_ACTRESS_TABLE = "derived_video_actress"
VIDEO_ACTRESS_ACTRESS_ID_COL = "actress_id"
VIDEO_ACTRESS_CONTENT_ID_COL = "content_id"
VIDEO_ACTRESS_RELEASE_DATE_COL = "release_date"
VIDEO_ACTRESS_ORDINALITY_COL = "ordinality"

VIDEO_TABLE = "derived_video"
VIDEO_CONTENT_ID_COL = "content_id"
VIDEO_DVD_ID_COL = "dvd_id"
VIDEO_TITLE_EN_COL = "title_en"
VIDEO_TITLE_JA_COL = "title_ja"
VIDEO_RELEASE_DATE_COL = "release_date"
VIDEO_JACKET_URL_COL = "jacket_full_url"
DMM_PICS_BASE = "https://pics.dmm.co.jp/"
