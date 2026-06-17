use sha2::{Digest, Sha256};

pub fn hash_match_id(match_id: &str) -> String {
    format!("{:x}", Sha256::digest(match_id.as_bytes()))
}
