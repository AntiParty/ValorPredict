use std::{fs, path::PathBuf};

use regex::Regex;
use reqwest::{Client, StatusCode};
use serde_json::Value;

use crate::{models::ValorantGameMode, riot_lockfile::Lockfile};

pub const CLIENT_PLATFORM: &str = "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";
pub const CLIENT_VERSION_FALLBACK: &str = match option_env!("RIOT_CLIENT_VERSION_FALLBACK") {
    Some(value) => value,
    None => "",
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegionShard {
    pub region: String,
    pub shard: String,
}

#[derive(Clone)]
pub struct RiotSessionContext {
    pub puuid: String,
    pub access_token: String,
    pub entitlement_token: String,
    pub region_shard: RegionShard,
    pub client_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiotMatchSignal {
    pub match_id: String,
    pub game_mode: ValorantGameMode,
}

pub struct RiotLocalClient {
    lockfile: Lockfile,
    local_client: Client,
    glz_client: Client,
}

impl RiotLocalClient {
    pub fn new(lockfile: Lockfile) -> Result<Self, String> {
        let local_client = Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(4))
            .build()
            .map_err(|_| "Could not initialize the Riot loopback client.".to_string())?;
        let glz_client = Client::builder()
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .map_err(|_| "Could not initialize the Riot state client.".to_string())?;
        Ok(Self {
            lockfile,
            local_client,
            glz_client,
        })
    }

    pub async fn session_context(&self) -> Result<RiotSessionContext, String> {
        let entitlements = self.local_json("/entitlements/v1/token").await?;
        let access_token = string_field(&entitlements, &["accessToken", "access_token"])
            .ok_or_else(|| "Riot access token was not present locally.".to_string())?;
        let entitlement_token = string_field(&entitlements, &["token", "entitlements_token"])
            .ok_or_else(|| "Riot entitlement token was not present locally.".to_string())?;
        let puuid = string_field(&entitlements, &["subject", "puuid"])
            .ok_or_else(|| "Riot player identifier was not present locally.".to_string())?;

        let region_json = self.local_json("/riotclient/region-locale").await.ok();
        let session_json = self
            .local_json("/product-session/v1/external-sessions")
            .await
            .ok();
        let log = read_shooter_game_log().unwrap_or_default();
        let region_shard = region_json
            .as_ref()
            .and_then(parse_region_json)
            .or_else(|| {
                parse_region_shard_from_log(&log)
                    .map(|(region, shard)| RegionShard { region, shard })
            })
            .unwrap_or(RegionShard {
                region: "unknown".into(),
                shard: "unknown".into(),
            });
        let client_version = session_json
            .as_ref()
            .and_then(extract_client_version)
            .or_else(|| parse_client_version_from_log(&log))
            .or_else(|| {
                (!CLIENT_VERSION_FALLBACK.is_empty()).then(|| CLIENT_VERSION_FALLBACK.into())
            })
            .ok_or_else(|| "Valorant client version could not be detected.".to_string())?;

        Ok(RiotSessionContext {
            puuid,
            access_token,
            entitlement_token,
            region_shard,
            client_version,
        })
    }

    pub async fn get_pregame_match(
        &self,
        context: &RiotSessionContext,
    ) -> Result<Option<RiotMatchSignal>, String> {
        self.glz_match("pregame/v1/players", "pregame/v1/matches", context)
            .await
    }

    pub async fn get_current_game_match(
        &self,
        context: &RiotSessionContext,
    ) -> Result<Option<RiotMatchSignal>, String> {
        self.glz_match("core-game/v1/players", "core-game/v1/matches", context)
            .await
    }

    /// Read the finished-match details for `match_id` and report whether the
    /// local player's team won. Returns `Ok(None)` when the match isn't
    /// available yet (still finalizing) so the caller can retry on a later poll.
    pub async fn get_match_result(
        &self,
        match_id: &str,
        context: &RiotSessionContext,
    ) -> Result<Option<bool>, String> {
        if context.region_shard.shard == "unknown" {
            return Err("Riot shard is unavailable.".into());
        }
        let url = format!(
            "https://pd.{}.a.pvp.net/match-details/v1/matches/{}",
            context.region_shard.shard, match_id
        );
        let response = self
            .glz_client
            .get(url)
            .header("X-Riot-ClientPlatform", CLIENT_PLATFORM)
            .header("X-Riot-ClientVersion", &context.client_version)
            .header("X-Riot-Entitlements-JWT", &context.entitlement_token)
            .bearer_auth(&context.access_token)
            .send()
            .await
            .map_err(|_| "Read-only Riot match-details request failed.".to_string())?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ) {
            return Err("Riot local authorization expired; the session will be re-read.".into());
        }
        if !response.status().is_success() {
            return Err(format!(
                "Riot match-details endpoint returned {}.",
                response.status()
            ));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Riot match-details endpoint returned invalid JSON.".to_string())?;
        Ok(determine_match_won(&value, &context.puuid))
    }

    async fn local_json(&self, path: &str) -> Result<Value, String> {
        let response = self
            .local_client
            .get(format!("{}{}", self.lockfile.local_base_url(), path))
            .basic_auth("riot", Some(&self.lockfile.password))
            .send()
            .await
            .map_err(|_| format!("Riot loopback request failed for {path}."))?;
        if !response.status().is_success() {
            return Err(format!(
                "Riot loopback endpoint {path} returned {}.",
                response.status()
            ));
        }
        response
            .json()
            .await
            .map_err(|_| format!("Riot loopback endpoint {path} returned invalid JSON."))
    }

    async fn glz_match(
        &self,
        resource: &str,
        match_resource: &str,
        context: &RiotSessionContext,
    ) -> Result<Option<RiotMatchSignal>, String> {
        let Some(player) = self
            .glz_json(&format!("{resource}/{}", context.puuid), context)
            .await?
        else {
            return Ok(None);
        };
        let Some(match_id) = extract_match_id(&player) else {
            return Ok(None);
        };
        let game_mode = match self
            .glz_json(&format!("{match_resource}/{match_id}"), context)
            .await?
        {
            Some(details) => normalize_game_mode(&details),
            None => ValorantGameMode::Unknown,
        };
        Ok(Some(RiotMatchSignal {
            match_id,
            game_mode,
        }))
    }

    async fn glz_json(
        &self,
        resource: &str,
        context: &RiotSessionContext,
    ) -> Result<Option<Value>, String> {
        if context.region_shard.region == "unknown" || context.region_shard.shard == "unknown" {
            return Err("Riot region and shard are unavailable.".into());
        }
        let url = format!(
            "https://glz-{}-1.{}.a.pvp.net/{}",
            context.region_shard.region, context.region_shard.shard, resource
        );
        let response = self
            .glz_client
            .get(url)
            .header("X-Riot-ClientPlatform", CLIENT_PLATFORM)
            .header("X-Riot-ClientVersion", &context.client_version)
            .header("X-Riot-Entitlements-JWT", &context.entitlement_token)
            .bearer_auth(&context.access_token)
            .send()
            .await
            .map_err(|_| "Read-only Riot match-state request failed.".to_string())?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ) {
            return Err("Riot local authorization expired; the session will be re-read.".into());
        }
        if !response.status().is_success() {
            return Err(format!(
                "Riot match-state endpoint returned {}.",
                response.status()
            ));
        }
        let value = response
            .json()
            .await
            .map_err(|_| "Riot match-state endpoint returned invalid JSON.".to_string())?;
        Ok(Some(value))
    }
}

pub fn extract_match_id(value: &Value) -> Option<String> {
    string_field(value, &["MatchID", "matchId", "match_id"])
}

pub fn normalize_game_mode(value: &Value) -> ValorantGameMode {
    let queue = recursive_string_field(value, &["QueueID", "queueID", "queueId"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    // The pregame endpoint exposes `ProvisioningFlowID`, while the live
    // core-game endpoint uses `ProvisioningFlow` (no "ID") — accept both so
    // custom games are recognized in-match, not just at agent select.
    let provisioning = recursive_string_field(
        value,
        &[
            "ProvisioningFlowID",
            "provisioningFlowID",
            "provisioningFlowId",
            "ProvisioningFlow",
            "provisioningFlow",
        ],
    )
    .unwrap_or_default()
    .to_ascii_lowercase();
    let competitive = queue == "competitive";
    let custom = provisioning == "customgame";

    match (competitive, custom) {
        (true, false) => ValorantGameMode::Competitive,
        (false, true) => ValorantGameMode::Custom,
        _ => ValorantGameMode::Unknown,
    }
}

/// Given a match-details document and the local player's puuid, return whether
/// that player's team won, or `None` if it can't be determined from the data.
pub fn determine_match_won(details: &Value, puuid: &str) -> Option<bool> {
    let players = details.get("players").and_then(Value::as_array)?;
    let my_team = players.iter().find_map(|player| {
        let subject = string_field(player, &["subject", "Subject"])?;
        if subject == puuid {
            string_field(player, &["teamId", "TeamID", "teamID"])
        } else {
            None
        }
    })?;
    let teams = details.get("teams").and_then(Value::as_array)?;
    teams.iter().find_map(|team| {
        let team_id = string_field(team, &["teamId", "TeamID", "teamID"])?;
        if team_id.eq_ignore_ascii_case(&my_team) {
            team.get("won")
                .or_else(|| team.get("Won"))
                .and_then(Value::as_bool)
        } else {
            None
        }
    })
}

pub fn parse_region_shard_from_log(contents: &str) -> Option<(String, String)> {
    let regex = Regex::new(r"https://glz-([a-z0-9-]+)-1\.([a-z0-9-]+)\.a\.pvp\.net").ok()?;
    let captures = regex.captures(contents)?;
    Some((
        captures.get(1)?.as_str().into(),
        captures.get(2)?.as_str().into(),
    ))
}

fn parse_region_json(value: &Value) -> Option<RegionShard> {
    let region = string_field(value, &["region", "Region"])?;
    let shard = string_field(value, &["shard", "Shard"]).unwrap_or_else(|| region.clone());
    Some(RegionShard { region, shard })
}

fn extract_client_version(value: &Value) -> Option<String> {
    recursive_string_field(value, &["version", "productVersion", "clientVersion"])
}

fn parse_client_version_from_log(contents: &str) -> Option<String> {
    let regex = Regex::new(r"release-\d+\.\d+(?:\.\d+)?(?:-\w+)?").ok()?;
    regex.find(contents).map(|value| value.as_str().into())
}

fn string_field(value: &Value, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        value
            .get(name)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    })
}

fn recursive_string_field(value: &Value, names: &[&str]) -> Option<String> {
    if let Some(value) = string_field(value, names) {
        return Some(value);
    }
    match value {
        Value::Array(values) => values
            .iter()
            .find_map(|value| recursive_string_field(value, names)),
        Value::Object(values) => values
            .values()
            .find_map(|value| recursive_string_field(value, names)),
        _ => None,
    }
}

fn shooter_game_log_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| {
        base.join("VALORANT")
            .join("Saved")
            .join("Logs")
            .join("ShooterGame.log")
    })
}

fn read_shooter_game_log() -> Option<String> {
    fs::read_to_string(shooter_game_log_path()?).ok()
}
