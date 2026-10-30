# Xtream media metadata

Movies, series and episodes retain descriptions and posters already returned by
the shared Xtream parser. Descriptions use the existing sanitized media details
renderer; artwork uses the existing thumbnail path. Opening details adds no
catalogue requests.

Episode posters follow the parser's fallback to the current series poster. A
missing episode description stays empty. The refreshed series description also
reaches the parser's parent record. Metadata is not synthesized or fetched from
another service, and descriptions and artwork URLs stay out of saved media
requests.

`node tests/test_xtream_media.cjs` exercises the shipped core bundle, all three
media types, sanitized details, parent metadata, absent fields and persistence.
