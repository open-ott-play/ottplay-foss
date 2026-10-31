# Local Torznab API, schema 1

All routes are below the existing private `/companion/:token/v1` endpoint.
Configuration is an operator API. Credentials and source addresses are never
returned by these routes or exported with player profiles.

- `GET /torrent/sources`: `{schema:1,sources:[{id,label}]}`.
- `POST /torrent/sources`: `{id,label,endpoint,apiKey}`; response
  `{schema:1,source:{id,label}}`. Upsert; changed endpoint/key invalidates that
  source's previous result and stable references. Label-only changes preserve them.
- `DELETE /torrent/sources/:id`: `{schema:1,removed:true}`.
- `GET /torrent/sources/:id/caps`: `{schema:1,sourceId,searchAvailable,categories:[{id,name,parentId}],maxLimit}`.
- `POST /torrent/search`: `{sourceId,query,categoryIds:[],offset:0,limit:100}`;
  response `{schema:1,sourceId,items:[{resultRef,title,size,seeders,publishedAt,categoryIds,languages}],nextOffset,total}`.
- `POST /torrent/prepare`: `{sourceId,resultRef}`; response
  `{schema:1,sourceId,sourceRef}`. Fetches metadata, not media content.
- `POST /sessions`: existing `{source,fileIndex?}` or
  `{sourceId,sourceRef,fileIndex?}`, exclusively. Subsequent session APIs are unchanged.

Source IDs match `^[a-z][a-z0-9-]{0,63}$`. Both reference kinds match
`^[0-9a-f]{32}$`. Player persistence uses exactly
`ottplay-local-torrent:SOURCEID/SOURCEREF` without query, fragment, or encoding.

Maximum UTF-8 byte lengths: label 128, endpoint 4096, API key 2048, query 512,
title 1024, category name 128, language 32, publication timestamp 64.
Control characters are rejected. Language values contain ASCII letters, digits
or hyphens. Publication timestamps are RFC3339 strings, normalized from RSS
pubDate, or null. Unknown metadata is null, not invented.

At most 8 sources, 100 items per page, 512 categories, 32 category IDs per item,
16 languages per item. Numeric metadata is an integer between zero and
9007199254740991; category IDs and non-null parent IDs are positive.
`size`, `seeders`, `publishedAt`, `parentId`, `total`, `nextOffset` are nullable.
Input offset is 0..1000000, limit is 1..100, categoryIds has at most 16 entries
and must refer to advertised categories. maxLimit is 1..100. nextOffset is at
most 1000000. Clients request further pages explicitly.

The companion keeps at most 512 transient result handles for 15 minutes.
Repeated results reuse their handle while retained. Stable references survive
restart, deduplicate exact original metainfo/full magnet per source generation,
and are capped at 128 references and 64 MiB. There is no silent stable eviction.
Private state is `COMPANION_ROOT/torznab-private/state.json`; payload files and
the owner lock are in the same private directory, separate from the piece cache.

Only explicitly configured loopback/private-IP origins are used. DNS answers
are checked and pinned per request; ambient proxies and HTTP redirects are
disabled. Download links must use the source's origin. An explicit redirect
to a valid magnet is retained in full without forwarding credentials. Original
torrent bytes are retained unchanged. This does not extend the engine's
private-tracker support or add ratio/seeding policies.

Errors have `{schema:1,error:CODE}`. Codes from these routes are:
`invalid_request`, `unauthorized`, `service_stopped`, `torznab_invalid_source`,
`torznab_local_only`, `torznab_invalid_link`, `torznab_invalid_query`,
`torznab_invalid_category`, `torznab_search_unavailable`, `torznab_source_missing`,
`torznab_source_changed`, `torznab_reference_missing`, `torznab_busy`,
`torznab_cancelled`, `torznab_timeout`, `torznab_network_error`,
`torznab_http_error`, `torznab_response_limit`, `torznab_invalid_xml`,
`torznab_xml_limit`, `torznab_api_error`, `torznab_invalid_page`,
`torznab_store_unavailable`, `torznab_store_busy`, `torznab_store_limit`,
`torznab_source_limit`, and existing metadata admission codes `invalid_source`,
`invalid_tracker`, `file_selection_required`, `metadata_limit`,
`invalid_metadata`, `tracker_limit`.

At most two remote operations run concurrently. Each remote operation has a
15-second total deadline including cold caps, DNS and response reads. Caps responses are
limited to 256 KiB, search to 2 MiB, metainfo to 1 MiB. Changing/removing a source
or shutting down cancels its pending requests; late results cannot publish handles.

## Local player acceptance fixture

`companion::torznab_fixture::serve_local_video_fixture` is an ignored test, not
a production endpoint. Supply a synthetic MP4 of at most 16 MiB. For example,
generate six seconds of test pattern and tone with a local FFmpeg installation:

```sh
ffmpeg -f lavfi -i testsrc2=duration=6:size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=6 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart /tmp/ott-local-fixture.mp4
OTT_TORZNAB_FIXTURE_VIDEO=/tmp/ott-local-fixture.mp4 OTT_TORZNAB_FIXTURE_SECONDS=600 cargo test -p ottplay-core --lib companion::torznab_fixture::serve_local_video_fixture -- --ignored --exact --nocapture
```

The test prints its loopback Torznab endpoint, static fixture API key and bounded
lifetime (maximum 1800 seconds). Configure that endpoint as a separate source
with ID `local-fixture` through the authenticated operator API. Search, prepare,
and play the one synthetic result. Remove this source after acceptance.

The fixture includes a loopback HTTP tracker and a loopback-only seeder. Its
torrent is private and has only this tracker, so production clients do not need
test hooks or external discovery. The seeder disables DHT, trackers, and LAN
discovery. No public tracker, indexer or copyrighted clip is needed. To run
alongside a native build, compile this test once and invoke the emitted test
binary directly with the same test name/arguments and environment variables.
