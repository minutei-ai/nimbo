use rquickjs::{Ctx, Exception, Function};
use serde_json::json;
use url::{Url, quirks};

const INPUT_LIMIT: usize = 65_536;

pub(crate) fn base(input: Option<&str>, fallback: &str) -> Option<Url> {
    let fallback = Url::parse(fallback).ok()?;
    Some(
        input
            .and_then(|input| fallback.join(input).ok())
            .filter(|url| !matches!(url.scheme(), "data" | "javascript"))
            .unwrap_or(fallback),
    )
}

fn get(property: &str, input: Option<&str>, base: &str) -> String {
    let parsed = input.and_then(|input| {
        Url::options()
            .base_url(Url::parse(base).ok().as_ref())
            .parse(input)
            .ok()
    });
    let Some(url) = parsed else {
        return match property {
            "href" => input.unwrap_or_default().to_owned(),
            "protocol" => ":".to_owned(),
            _ => String::new(),
        };
    };
    match property {
        "href" => url.as_str().to_owned(),
        "origin" => quirks::origin(&url),
        "protocol" => quirks::protocol(&url).to_owned(),
        "username" => quirks::username(&url).to_owned(),
        "password" => quirks::password(&url).to_owned(),
        "host" => quirks::host(&url).to_owned(),
        "hostname" => quirks::hostname(&url).to_owned(),
        "port" => quirks::port(&url).to_owned(),
        "pathname" => quirks::pathname(&url).to_owned(),
        "search" => quirks::search(&url).to_owned(),
        "hash" => quirks::hash(&url).to_owned(),
        _ => String::new(),
    }
}

fn set(property: &str, input: Option<&str>, base: &str, value: &str) -> Option<String> {
    let base = Url::parse(base).ok();
    let mut url = Url::options().base_url(base.as_ref()).parse(input?).ok()?;
    if matches!(property, "username" | "password" | "port")
        && (!url.has_host() || url.host_str() == Some("") || url.scheme() == "file")
    {
        return None;
    }
    if matches!(property, "host" | "hostname" | "pathname") && url.cannot_be_a_base() {
        return None;
    }
    // Component parser failures preserve the URL. HTML still serializes it back
    // to href, except for the early-return guards above.
    match property {
        "protocol" => {
            let _result = quirks::set_protocol(&mut url, value);
        }
        "username" => {
            let _result = quirks::set_username(&mut url, value);
        }
        "password" => {
            let _result = quirks::set_password(&mut url, value);
        }
        "host" => {
            let _result = quirks::set_host(&mut url, value);
        }
        "hostname" => {
            let _result = quirks::set_hostname(&mut url, value);
        }
        "port" => {
            let _result = quirks::set_port(&mut url, value);
        }
        "pathname" => quirks::set_pathname(&mut url, value),
        "search" => quirks::set_search(&mut url, value),
        "hash" => quirks::set_hash(&mut url, value),
        _ => return None,
    }
    Some(url.to_string())
}

fn parse(input: Option<&str>, fallback: &str) -> Option<String> {
    let base = if fallback.is_empty() {
        None
    } else {
        Some(Url::parse(fallback).ok()?)
    };
    Url::options()
        .base_url(base.as_ref())
        .parse(input?)
        .ok()
        .map(|url| url.to_string())
}

fn query(operation: &str, input: &str) -> crate::Result<serde_json::Value> {
    if operation == "queryParse" {
        Ok(json!(
            url::form_urlencoded::parse(input.as_bytes())
                .into_owned()
                .collect::<Vec<_>>()
        ))
    } else {
        let pairs: Vec<(String, String)> = serde_json::from_str(input)?;
        let result = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(pairs)
            .finish();
        if result.len() > INPUT_LIMIT {
            return Err(crate::Error::Limit("URL query output"));
        }
        Ok(json!(result))
    }
}

pub(crate) fn install(ctx: &Ctx<'_>) -> rquickjs::Result<()> {
    ctx.globals().set(
        "nimboLink",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'_>,
             operation: String,
             property: String,
             input: Option<String>,
             fallback: String,
             value: String| {
                if input
                    .as_ref()
                    .is_some_and(|input| input.len() > INPUT_LIMIT)
                    || fallback.len() > INPUT_LIMIT
                    || value.len() > INPUT_LIMIT
                {
                    return Err(Exception::throw_message(&ctx, "URL input limit"));
                }
                let result = match operation.as_str() {
                    "parse" => json!(parse(input.as_deref(), &fallback)),
                    "queryParse" | "querySerialize" => {
                        query(&operation, input.as_deref().unwrap_or_default())
                            .map_err(|error| Exception::throw_message(&ctx, &error.to_string()))?
                    }
                    "base" => json!(base(input.as_deref(), &fallback).map(|url| url.to_string())),
                    "get" => json!(get(&property, input.as_deref(), &fallback)),
                    "set" => json!(set(&property, input.as_deref(), &fallback, &value)),
                    _ => return Err(Exception::throw_type(&ctx, "unknown URL operation")),
                };
                serde_json::to_string(&result)
                    .map_err(|_error| Exception::throw_message(&ctx, "URL result serialization"))
            },
        )?,
    )?;
    Ok(())
}
