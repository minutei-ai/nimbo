use std::{cell::RefCell, collections::VecDeque, rc::Rc};

use rquickjs::{
    Coerced, Ctx, Exception, FromJs, Function, Object, Persistent, Value,
    atom::PredefinedAtom,
    function::{Rest, This},
    object::Property,
};
use serde::Serialize;

const MESSAGE_BYTES: usize = 4096;
const BUFFER_BYTES: usize = 65_536;
const MESSAGE_COUNT: usize = 100;
const ARGUMENT_COUNT: usize = 128;

/// Severity of a page-owned console record.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConsoleLevel {
    /// Diagnostic output.
    Debug,
    /// Error output; logging does not throw an exception.
    Error,
    /// Informational output.
    Info,
    /// Ordinary output.
    Log,
    /// Warning output.
    Warn,
    /// A false console assertion.
    Assert,
}

/// A bounded printable snapshot, without references to guest objects.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ConsoleMessage {
    /// The logging method that produced the record.
    pub level: ConsoleLevel,
    /// Printable text, capped at 4096 UTF-8 bytes.
    pub text: String,
}

#[derive(Clone)]
struct Formatter {
    string: Persistent<Function<'static>>,
    integer: Persistent<Function<'static>>,
    decimal: Persistent<Function<'static>>,
    well_formed: Persistent<Function<'static>>,
}

impl Formatter {
    fn new(ctx: &Ctx<'_>) -> rquickjs::Result<Self> {
        let globals = ctx.globals();
        let string: Function<'_> = globals.get("String")?;
        let prototype: Object<'_> = string.get("prototype")?;
        Ok(Self {
            string: Persistent::save(ctx, string),
            integer: Persistent::save(ctx, globals.get::<_, Function<'_>>("parseInt")?),
            decimal: Persistent::save(ctx, globals.get::<_, Function<'_>>("parseFloat")?),
            well_formed: Persistent::save(ctx, prototype.get::<_, Function<'_>>("toWellFormed")?),
        })
    }

    fn text<'js>(
        &self,
        ctx: &Ctx<'js>,
        value: rquickjs::String<'js>,
    ) -> rquickjs::Result<rquickjs::CString<'js>> {
        let text: rquickjs::String<'_> = self
            .well_formed
            .clone()
            .restore(ctx)?
            .call((This(value),))?;
        text.to_cstring()
    }

    fn string<'js>(&self, ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<String> {
        let string: rquickjs::String<'_> = self.string.clone().restore(ctx)?.call((value,))?;
        let text = self.text(ctx, string)?;
        Ok(text
            .as_str()
            .get(..text.as_str().floor_char_boundary(MESSAGE_BYTES))
            .unwrap_or_default()
            .to_owned())
    }

    fn inspect<'js>(&self, ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<String> {
        if value.is_function() {
            return Ok("[Function]".into());
        }
        if value.is_object() {
            return Ok("[Object]".into());
        }
        self.string(ctx, value)
    }

    fn substitution<'js>(
        &self,
        ctx: &Ctx<'js>,
        specifier: char,
        value: Value<'js>,
    ) -> rquickjs::Result<String> {
        match specifier {
            's' => self.string(ctx, value),
            'd' | 'i' | 'f' => {
                if value.is_symbol() {
                    return Ok("NaN".into());
                }
                let result: Value<'_> = if specifier == 'f' {
                    self.decimal.clone().restore(ctx)?.call((value,))?
                } else {
                    self.integer.clone().restore(ctx)?.call((value, 10))?
                };
                self.string(ctx, result)
            }
            'c' => Ok(String::new()),
            _ => self.inspect(ctx, value),
        }
    }

    fn format<'js>(&self, ctx: &Ctx<'js>, values: &[Value<'js>]) -> rquickjs::Result<String> {
        let mut text = String::new();
        let mut separated = false;
        let mut values = values.iter().peekable();
        if let Some(first) = values.peek().and_then(|value| value.as_string()) {
            let format = self.text(ctx, first.clone())?;
            if format.len() > BUFFER_BYTES {
                return Err(Exception::throw_message(
                    ctx,
                    "resource limit: console format bytes",
                ));
            }
            values.next();
            separated = true;
            let mut characters = format.as_str().chars().peekable();
            while let Some(character) = characters.next() {
                if character == '%' && values.peek().is_some() {
                    if characters.peek() == Some(&'%') {
                        characters.next();
                        append(&mut text, "%");
                        continue;
                    }
                    if let Some(specifier @ ('s' | 'd' | 'i' | 'f' | 'o' | 'O' | 'c')) =
                        characters.peek().copied()
                    {
                        characters.next();
                        if let Some(value) = values.next() {
                            append(
                                &mut text,
                                &self.substitution(ctx, specifier, value.clone())?,
                            );
                        }
                        continue;
                    }
                }
                append(&mut text, character.encode_utf8(&mut [0; 4]));
            }
        }
        for value in values {
            if separated {
                append(&mut text, " ");
            }
            append(&mut text, &self.inspect(ctx, value.clone())?);
            separated = true;
        }
        Ok(text)
    }
}

fn append(target: &mut String, text: &str) {
    let remaining = MESSAGE_BYTES.saturating_sub(target.len());
    target.push_str(
        text.get(..text.floor_char_boundary(remaining))
            .unwrap_or_default(),
    );
}

#[derive(Default)]
struct State {
    formatter: Option<Formatter>,
    messages: VecDeque<ConsoleMessage>,
    bytes: usize,
}

impl State {
    fn record(&mut self, level: ConsoleLevel, text: String) {
        while self.messages.len() >= MESSAGE_COUNT
            || self.bytes.saturating_add(text.len()) > BUFFER_BYTES
        {
            if let Some(message) = self.messages.pop_front() {
                self.bytes = self.bytes.saturating_sub(message.text.len());
            }
        }
        self.bytes = self.bytes.saturating_add(text.len());
        self.messages.push_back(ConsoleMessage { level, text });
    }
}

#[derive(Default)]
pub(crate) struct Console(Rc<RefCell<State>>);

impl Drop for Console {
    fn drop(&mut self) {
        self.0.borrow_mut().formatter = None;
    }
}

impl Console {
    pub(crate) fn messages(&self) -> Vec<ConsoleMessage> {
        self.0.borrow().messages.iter().cloned().collect()
    }

    pub(crate) fn install<'js>(&self, ctx: &Ctx<'js>) -> rquickjs::Result<()> {
        self.0.borrow_mut().formatter = Some(Formatter::new(ctx)?);
        let prototype = Object::new(ctx.clone())?;
        let console = Object::new_proto(ctx.clone(), Some(&prototype))?;
        console.prop(
            PredefinedAtom::SymbolToStringTag,
            Property::from("console").configurable(),
        )?;
        for (name, level) in [
            ("debug", ConsoleLevel::Debug),
            ("error", ConsoleLevel::Error),
            ("info", ConsoleLevel::Info),
            ("log", ConsoleLevel::Log),
            ("warn", ConsoleLevel::Warn),
            ("assert", ConsoleLevel::Assert),
        ] {
            let state = Rc::clone(&self.0);
            let function = Function::new(
                ctx.clone(),
                move |ctx: Ctx<'js>, values: Rest<Value<'js>>| log(&ctx, &state, level, values.0),
            )?
            .with_name(name)?;
            console.set(name, function)?;
        }
        let state = Rc::clone(&self.0);
        let clear = Function::new(ctx.clone(), move || {
            let mut state = state.borrow_mut();
            state.messages.clear();
            state.bytes = 0;
        })?
        .with_name("clear")?;
        console.set("clear", clear)?;
        ctx.globals()
            .prop("console", Property::from(console).writable().configurable())
    }
}

fn log<'js>(
    ctx: &Ctx<'js>,
    state: &Rc<RefCell<State>>,
    level: ConsoleLevel,
    mut values: Vec<Value<'js>>,
) -> rquickjs::Result<()> {
    if values.len() > ARGUMENT_COUNT {
        return Err(Exception::throw_message(
            ctx,
            "resource limit: console arguments",
        ));
    }
    let formatter = state
        .borrow()
        .formatter
        .clone()
        .ok_or_else(|| Exception::throw_message(ctx, "console is disposed"))?;
    if level == ConsoleLevel::Assert {
        if let Some(condition) = values.first() {
            if Coerced::<bool>::from_js(ctx, condition.clone())?.0 {
                return Ok(());
            }
            values.remove(0);
        }
        if values.first().is_some_and(Value::is_string) {
            let first = values
                .remove(0)
                .into_string()
                .ok_or_else(|| Exception::throw_type(ctx, "invalid assertion message"))?;
            let first = formatter.text(ctx, first)?;
            if first.len() > BUFFER_BYTES {
                return Err(Exception::throw_message(
                    ctx,
                    "resource limit: console format bytes",
                ));
            }
            values.insert(
                0,
                rquickjs::String::from_str(
                    ctx.clone(),
                    &format!("Assertion failed: {}", first.as_str()),
                )?
                .into_value(),
            );
        } else {
            values.insert(
                0,
                rquickjs::String::from_str(ctx.clone(), "Assertion failed")?.into_value(),
            );
        }
    }
    if values.is_empty() {
        return Ok(());
    }
    let text = formatter.format(ctx, &values)?;
    state.borrow_mut().record(level, text);
    Ok(())
}
