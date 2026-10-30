//! Gemini LLM 연동(통화/음성 녹음 스크립트화).

mod client;
mod transcription;

pub(crate) use client::*;
pub(crate) use transcription::*;
