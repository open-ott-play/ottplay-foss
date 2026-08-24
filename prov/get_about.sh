#!/usr/bin/env bash
# fetch_index.sh: get helper HTML for every prov.js folder
while IFS= read -r prov; do
    dir=$(dirname "$prov")
    base=$(basename "$dir")
    url="https://ottp.eu.org/prov/${base}/about.html"
    echo "Fetching $url → $dir/about.html"
    wget -q "$url" -O "$dir/about.html" || echo "Failed $url"
done < <(find . -type f -name 'prov.js' -print)
