// Strict input decoder. SEMANTICS.md §2: "The decoder MUST reject a BOM, invalid
// UTF-8, duplicate JSON object member names, unpaired Unicode surrogates, nesting
// deeper than 64 values and non-JSON numbers."
//
// The grammar (BOM, UTF-8, surrogates, numbers, trailing bytes) stays entirely
// serde_json's. A plain `serde_json::from_slice` into `Value` keeps the last of two
// equal member names and only stops recursion at 128 levels, so this seed adds the
// two missing refusals while building the very same `Value`:
// - a duplicate member name, at any level, compared after escapes are decoded;
// - a value deeper than `MAX_DEPTH`, the top-level value having depth 0, as the
//   reference evaluator's reader (`packages/policy-core-ref/src/strict-parser.ts`,
//   `parseValue(0)` and `depth > this.maxDepth`).
// The depth is counted here, never left to serde_json's recursion guard.

use serde::de::{DeserializeSeed, Deserializer, Error as _, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use std::fmt;

/// Deepest admitted value; the top-level value has depth 0.
pub const MAX_DEPTH: usize = 64;

/// Decodes one strict JSON text. Every refusal is the same opaque error: no parser
/// diagnostic crosses the component boundary (SEMANTICS.md §2).
pub fn decode(bytes: &[u8]) -> Result<Value, StrictDecodeError> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = StrictValue { depth: 0 }
        .deserialize(&mut deserializer)
        .map_err(|_| StrictDecodeError)?;
    deserializer.end().map_err(|_| StrictDecodeError)?;
    Ok(value)
}

/// The input is not a strict JSON text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StrictDecodeError;

struct StrictValue {
    depth: usize,
}

impl<'de> DeserializeSeed<'de> for StrictValue {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        // Checked before any descent, scalars included, as the reference reader.
        if self.depth > MAX_DEPTH {
            return Err(D::Error::custom("maximum depth exceeded"));
        }
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for StrictValue {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    // Same conversion as serde_json's own `Value` visitor.
    fn visit_f64<E>(self, value: f64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_str<E>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }

    fn visit_unit<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Value, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = sequence.next_element_seed(StrictValue {
            depth: self.depth + 1,
        })? {
            items.push(item);
        }
        Ok(Value::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut object: A) -> Result<Value, A::Error> {
        let mut members = Map::new();
        while let Some(name) = object.next_key::<String>()? {
            if members.contains_key(&name) {
                return Err(A::Error::custom("duplicate object member"));
            }
            let value = object.next_value_seed(StrictValue {
                depth: self.depth + 1,
            })?;
            members.insert(name, value);
        }
        Ok(Value::Object(members))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nested_arrays(levels: usize) -> String {
        format!("{}{}", "[".repeat(levels), "]".repeat(levels))
    }

    fn arrays_around_scalar(levels: usize) -> String {
        format!("{}0{}", "[".repeat(levels), "]".repeat(levels))
    }

    /// A JSON `\uXXXX` escape, built so the source holds no literal escape sequence.
    fn json_escape(hex: &str) -> String {
        format!("{}u{hex}", '\\')
    }

    fn nested_objects(levels: usize) -> String {
        format!(
            "{}{}",
            r#"{"a":"#.repeat(levels - 1) + "{}",
            "}".repeat(levels - 1)
        )
    }

    #[test]
    fn deepest_admitted_container_is_at_depth_64() {
        // 65 arrays: the outermost at depth 0, the innermost at depth 64.
        assert!(decode(nested_arrays(65).as_bytes()).is_ok());
        assert!(decode(nested_objects(65).as_bytes()).is_ok());
    }

    #[test]
    fn container_at_depth_65_is_refused() {
        assert_eq!(decode(nested_arrays(66).as_bytes()), Err(StrictDecodeError));
        assert_eq!(
            decode(nested_objects(66).as_bytes()),
            Err(StrictDecodeError)
        );
    }

    #[test]
    fn scalar_at_depth_64_is_admitted_and_at_depth_65_refused() {
        assert!(decode(arrays_around_scalar(64).as_bytes()).is_ok());
        assert_eq!(
            decode(arrays_around_scalar(65).as_bytes()),
            Err(StrictDecodeError)
        );
    }

    #[test]
    fn duplicate_member_is_refused_at_every_level() {
        // The last name is "a" written as an escape: names compare once decoded.
        let escaped_name = format!(r#"{{"a":1,"{}":2}}"#, json_escape("0061"));
        for input in [
            r#"{"a":1,"a":1}"#,
            r#"{"a":{"b":1,"b":2}}"#,
            r#"[{"b":1},{"c":1,"c":1}]"#,
            escaped_name.as_str(),
        ] {
            assert_eq!(decode(input.as_bytes()), Err(StrictDecodeError), "{input}");
        }
    }

    #[test]
    fn equal_names_in_distinct_objects_are_admitted() {
        assert!(decode(br#"{"a":{"a":1},"b":[{"a":1},{"a":2}]}"#).is_ok());
    }

    #[test]
    fn admitted_input_decodes_to_the_value_serde_json_builds() {
        // A surrogate pair, a fraction, -0 and the safe-integer bound, between whitespace.
        let pair = format!("{}{}", json_escape("D834"), json_escape("DD1E"));
        let input = format!(
            r#" {{"n":[0,-0,-1.25,0.000001,1e+20,9007199254740991],"s":"{pair}","t":true,"f":false,"z":null}} "#
        );
        let expected: Value =
            serde_json::from_slice(input.as_bytes()).expect("serde_json reads the control");
        assert_eq!(decode(input.as_bytes()), Ok(expected));
    }

    #[test]
    fn serde_json_grammar_refusals_are_kept() {
        for input in [
            &b"\xef\xbb\xbf{}"[..],
            b"{\"a\":\"\xff\"}",
            br#"{"a":"\ud800"}"#,
            br#"{"a":01}"#,
            br#"{"a":+1}"#,
            br#"{"a":NaN}"#,
            br#"{"a":1.}"#,
            br#"{"a":1e400}"#,
            br#"{"a":1}x"#,
            b"",
        ] {
            assert_eq!(decode(input), Err(StrictDecodeError), "{input:?}");
        }
    }
}
