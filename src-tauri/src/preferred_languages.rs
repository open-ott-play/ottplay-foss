//! Supply the full native preference list before the shared HTML bootstrap.
//! WebKit deliberately exposes only its first language through navigator.languages.

pub fn initialization_script() -> String {
    script_for(&preferred_languages())
}

fn script_for(languages: &[String]) -> String {
    let json = serde_json::to_string(languages).unwrap_or_else(|_| "[]".into());
    format!("window.__ottPreferredLanguages={json};")
}

#[cfg(not(all(unix, not(target_vendor = "apple"))))]
fn preferred_languages() -> Vec<String> {
    sys_locale::get_locales().collect()
}

#[cfg(all(unix, not(target_vendor = "apple")))]
fn preferred_languages() -> Vec<String> {
    // sys-locale drops POSIX script modifiers. Preserve them so sr@latin cannot
    // select our Cyrillic catalog, and use the same environment preference order.
    posix_languages(
        ["LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"]
            .map(|key| std::env::var(key).unwrap_or_default()),
    )
}

#[cfg(any(test, all(unix, not(target_vendor = "apple"))))]
fn posix_languages(values: [String; 4]) -> Vec<String> {
    let mut languages = Vec::new();
    for (index, value) in values.iter().enumerate() {
        for entry in value.splitn(if index == 0 { usize::MAX } else { 1 }, ':') {
            if let Some(language) = posix_language(entry) {
                if !languages
                    .iter()
                    .any(|existing: &String| existing.eq_ignore_ascii_case(&language))
                {
                    languages.push(language);
                }
            }
        }
    }
    languages
}

#[cfg(any(test, all(unix, not(target_vendor = "apple"))))]
fn posix_language(value: &str) -> Option<String> {
    let (base, modifier) = value.trim().split_once('@').unwrap_or((value.trim(), ""));
    let tag = base.split('.').next()?.replace('_', "-");
    if tag.is_empty() || tag == "C" || tag == "POSIX" {
        return None;
    }
    let script = match modifier.to_ascii_lowercase().as_str() {
        "" | "euro" => return Some(tag),
        "latin" => "Latn",
        "cyrillic" => "Cyrl",
        "arabic" => "Arab",
        "devanagari" => "Deva",
        "gurmukhi" => "Guru",
        // An unknown modifier may select an unsupported writing system.
        _ => return None,
    };
    let mut parts: Vec<&str> = tag.split('-').collect();
    if parts.get(1).is_some_and(|part| part.len() == 4) {
        if !parts[1].eq_ignore_ascii_case(script) {
            return None;
        }
    } else {
        parts.insert(1, script);
    }
    Some(parts.join("-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_preserves_order_and_escapes_values() {
        let values = vec!["zz-ZZ".into(), "ru-RU".into(), "x-\"\\\n".into()];
        let script = script_for(&values);
        let json = script
            .strip_prefix("window.__ottPreferredLanguages=")
            .unwrap()
            .strip_suffix(';')
            .unwrap();
        assert_eq!(serde_json::from_str::<Vec<String>>(json).unwrap(), values);
        assert_eq!(script_for(&[]), "window.__ottPreferredLanguages=[];");
    }

    #[test]
    fn linux_preferences_preserve_scripts_and_order() {
        assert_eq!(
            posix_languages([
                "sr_RS.UTF-8@latin:ru_RU:ru-RU:pa_PK@arabic".into(),
                "zh_TW.UTF-8".into(),
                "ru_RU.UTF-8".into(),
                "en_US.UTF-8".into(),
            ]),
            ["sr-Latn-RS", "ru-RU", "pa-Arab-PK", "zh-TW", "en-US"]
        );
        assert_eq!(
            posix_language("sr_Cyrl_RS@cyrillic"),
            Some("sr-Cyrl-RS".into())
        );
        assert_eq!(posix_language("sr_Cyrl_RS@latin"), None);
        assert_eq!(posix_language("sr_RS@unknown"), None);
        assert_eq!(posix_language("C.UTF-8"), None);
        assert_eq!(posix_language("POSIX"), None);
    }
}
