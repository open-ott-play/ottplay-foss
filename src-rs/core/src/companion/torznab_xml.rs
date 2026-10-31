//! Bounded Torznab XML decoding. No DTD, external entities, or response text is executed.
use quick_xml::{events::Event, Reader};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Default)]
struct Node {
    name: String,
    attrs: HashMap<String, String>,
    text: String,
    children: Vec<Node>,
}
impl Node {
    fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|node| node.name == name)
    }
    fn value(&self, name: &str) -> Option<&str> {
        self.attrs.get(name).map(String::as_str)
    }
}
fn document(bytes: &[u8]) -> Result<Node, &'static str> {
    let text = std::str::from_utf8(bytes).map_err(|_| "torznab_invalid_xml")?;
    let mut reader = Reader::from_str(text);
    let mut stack: Vec<Node> = Vec::new();
    let mut root = None;
    let mut nodes = 0usize;
    loop {
        let event = reader.read_event().map_err(|_| "torznab_invalid_xml")?;
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(element) | Event::Empty(element) => {
                nodes += 1;
                if nodes > 16000 || stack.len() >= 16 || (stack.is_empty() && root.is_some()) {
                    return Err("torznab_xml_limit");
                }
                let mut node = Node {
                    name: String::from_utf8(element.local_name().as_ref().to_vec())
                        .map_err(|_| "torznab_invalid_xml")?,
                    ..Node::default()
                };
                for attr in element.attributes() {
                    let attr = attr.map_err(|_| "torznab_invalid_xml")?;
                    if node.attrs.len() >= 32 {
                        return Err("torznab_xml_limit");
                    }
                    let key = std::str::from_utf8(attr.key.local_name().as_ref())
                        .map_err(|_| "torznab_invalid_xml")?
                        .to_owned();
                    let value = attr
                        .decoded_and_normalized_value(
                            quick_xml::XmlVersion::Implicit1_0,
                            element.decoder(),
                        )
                        .map_err(|_| "torznab_invalid_xml")?
                        .into_owned();
                    if value.len() > 16384 || node.attrs.insert(key, value).is_some() {
                        return Err("torznab_xml_limit");
                    }
                }
                if empty {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(node);
                    } else {
                        root = Some(node);
                    }
                } else {
                    stack.push(node);
                }
            }
            Event::End(_) => {
                let node = stack.pop().ok_or("torznab_invalid_xml")?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(node);
                } else {
                    root = Some(node);
                }
            }
            Event::Text(value) => append(
                &mut stack,
                &value.decode().map_err(|_| "torznab_invalid_xml")?,
            )?,
            Event::CData(value) => append(
                &mut stack,
                &value.decode().map_err(|_| "torznab_invalid_xml")?,
            )?,
            Event::GeneralRef(value) => {
                let value = if let Some(character) = value
                    .resolve_char_ref()
                    .map_err(|_| "torznab_invalid_xml")?
                {
                    character.to_string()
                } else {
                    quick_xml::escape::resolve_predefined_entity(
                        &value.decode().map_err(|_| "torznab_invalid_xml")?,
                    )
                    .ok_or("torznab_invalid_xml")?
                    .to_owned()
                };
                append(&mut stack, &value)?;
            }
            Event::DocType(_) => return Err("torznab_invalid_xml"),
            Event::Eof => {
                if !stack.is_empty() {
                    return Err("torznab_invalid_xml");
                }
                let root = root.ok_or("torznab_invalid_xml")?;
                if root.name == "error" {
                    return Err("torznab_api_error");
                }
                return Ok(root);
            }
            _ => {}
        }
    }
}
fn append(stack: &mut [Node], text: &str) -> Result<(), &'static str> {
    if let Some(node) = stack.last_mut() {
        if node.text.len() + text.len() > 16384 {
            return Err("torznab_xml_limit");
        }
        node.text.push_str(text);
    } else if !text.trim().is_empty() {
        return Err("torznab_invalid_xml");
    }
    Ok(())
}
fn number(value: Option<&str>) -> Option<u64> {
    let value = value?.trim();
    if value.is_empty() || !value.bytes().all(|v| v.is_ascii_digit()) {
        return None;
    }
    value.parse().ok().filter(|v| *v <= 9_007_199_254_740_991)
}
fn label(value: &str, maximum: usize) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.len() <= maximum && !value.chars().any(char::is_control))
        .then(|| value.to_owned())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Category {
    pub id: u64,
    pub name: String,
    pub parent_id: Option<u64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Caps {
    pub search_available: bool,
    pub categories: Vec<Category>,
    pub max_limit: usize,
}
pub(super) fn caps(bytes: &[u8]) -> Result<Caps, &'static str> {
    let root = document(bytes)?;
    if root.name != "caps" {
        return Err("torznab_invalid_xml");
    }
    let search_available = root
        .child("searching")
        .and_then(|n| n.child("search"))
        .and_then(|n| n.value("available"))
        .is_some_and(|v| matches!(v, "yes" | "true" | "1"));
    let max_limit = number(root.child("limits").and_then(|n| n.value("max")))
        .unwrap_or(100)
        .clamp(1, 100) as usize;
    let mut categories = Vec::new();
    if let Some(parent) = root.child("categories") {
        for node in &parent.children {
            if node.name != "category" {
                continue;
            }
            let Some(id) = number(node.value("id")).filter(|id| *id > 0) else {
                continue;
            };
            add_category(&mut categories, node, None)?;
            for child in &node.children {
                if child.name == "subcat" {
                    add_category(&mut categories, child, Some(id))?;
                }
            }
        }
    }
    Ok(Caps {
        search_available,
        categories,
        max_limit,
    })
}
fn add_category(
    out: &mut Vec<Category>,
    node: &Node,
    parent_id: Option<u64>,
) -> Result<(), &'static str> {
    let (Some(id), Some(name)) = (
        number(node.value("id")).filter(|id| *id > 0),
        node.value("name").and_then(|v| label(v, 128)),
    ) else {
        return Ok(());
    };
    if out.len() >= 512 {
        return Err("torznab_xml_limit");
    }
    if !out.iter().any(|category| category.id == id) {
        out.push(Category {
            id,
            name,
            parent_id,
        });
    }
    Ok(())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Item {
    pub result_ref: String,
    pub title: String,
    pub size: Option<u64>,
    pub seeders: Option<u64>,
    pub published_at: Option<String>,
    pub category_ids: Vec<u64>,
    pub languages: Vec<String>,
    #[serde(skip)]
    pub link: String,
}
pub(super) struct Page {
    pub items: Vec<Item>,
    pub total: Option<u64>,
    pub offset: Option<u64>,
    pub count: usize,
}
pub(super) fn page(bytes: &[u8], limit: usize) -> Result<Page, &'static str> {
    let root = document(bytes)?;
    if root.name != "rss" {
        return Err("torznab_invalid_xml");
    }
    let channel = root.child("channel").ok_or("torznab_invalid_xml")?;
    let response = channel.child("response");
    let total = response.and_then(|n| number(n.value("total")));
    let offset = response.and_then(|n| number(n.value("offset")));
    let mut items = Vec::new();
    let mut count = 0;
    for node in &channel.children {
        if node.name != "item" {
            continue;
        }
        count += 1;
        if count > 1000 {
            return Err("torznab_xml_limit");
        }
        if count > limit {
            continue;
        }
        let Some(title) = node.child("title").and_then(|n| label(&n.text, 1024)) else {
            continue;
        };
        let attributes: Vec<_> = node.children.iter().filter(|n| n.name == "attr").collect();
        let attr = |name: &str| {
            attributes
                .iter()
                .find(|n| n.value("name") == Some(name))
                .and_then(|n| n.value("value"))
        };
        let enclosure = node
            .children
            .iter()
            .find(|n| n.name == "enclosure" && n.value("type") == Some("application/x-bittorrent"));
        let link = enclosure
            .and_then(|n| n.value("url"))
            .or_else(|| {
                node.child("link")
                    .map(|n| n.text.trim())
                    .filter(|v| !v.is_empty())
            })
            .or_else(|| attr("magneturl"));
        let Some(link) = link.and_then(|v| label(v, 16384)) else {
            continue;
        };
        let mut category_ids = Vec::new();
        let mut languages = Vec::new();
        for attribute in attributes
            .iter()
            .filter(|n| n.value("name") == Some("category"))
        {
            if let Some(id) = number(attribute.value("value")).filter(|id| *id > 0) {
                if category_ids.len() < 32 && !category_ids.contains(&id) {
                    category_ids.push(id);
                }
            }
        }
        for attribute in attributes
            .iter()
            .filter(|n| matches!(n.value("name"), Some("language" | "languages")))
        {
            for language in attribute.value("value").unwrap_or("").split(',') {
                if let Some(language) = label(language, 32)
                    .filter(|v| v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
                {
                    if languages.len() < 16 && !languages.contains(&language) {
                        languages.push(language);
                    }
                }
            }
        }
        let published_at = node
            .child("pubDate")
            .and_then(|n| chrono::DateTime::parse_from_rfc2822(n.text.trim()).ok())
            .map(|d| d.to_rfc3339())
            .filter(|s| s.len() <= 64);
        items.push(Item {
            result_ref: String::new(),
            title,
            size: number(attr("size"))
                .or_else(|| number(enclosure.and_then(|n| n.value("length")))),
            seeders: number(attr("seeders")),
            published_at,
            category_ids,
            languages,
            link,
        });
    }
    Ok(Page {
        items,
        total,
        offset,
        count: count.min(limit),
    })
}
