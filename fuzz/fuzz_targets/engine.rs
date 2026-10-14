#![no_main]
#![forbid(unsafe_code)]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    nimbo_engine::fuzzing::exercise(data);
});
