//! Навигация Axenta: последние координаты объектов, сопоставленные по госномеру.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, anyhow};
use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
};

/// Axenta отдаёт состояние всех объектов одним списком — держим его недолго, чтобы
/// окна карты у нескольких диспетчеров не дёргали API на каждый запрос.
const CACHE_TTL: Duration = Duration::from_secs(20);
/// Общая карта запрашивает номер каждой машины из списка одним вызовом.
const MAX_PLATES: usize = 400;

pub struct Axenta {
    http: reqwest::Client,
    base: String,
    username: String,
    password: String,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    token: Option<String>,
    cache: Option<(Instant, Arc<Vec<Vehicle>>)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Vehicle {
    pub id: i64,
    pub name: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub speed: Option<f64>,
    pub course: Option<f64>,
    /// Время последней валидной геопозиции.
    pub position_time: Option<String>,
    /// Время последнего сообщения от трекера.
    pub message_time: Option<String>,
    pub moving: Option<bool>,
    pub ignition: Option<bool>,
    #[serde(skip)]
    plates: Vec<String>,
}

#[derive(Deserialize)]
struct LoginResponse {
    token: String,
}

#[derive(Deserialize)]
struct Page {
    results: Vec<RawObject>,
    next: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawObject {
    id: i64,
    name: String,
    is_motion: Option<bool>,
    is_ignition: Option<bool>,
    last_message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    t: Option<String>,
    tpos: Option<String>,
    pos: Option<RawPos>,
}

#[derive(Deserialize)]
struct RawPos {
    /// В документации x назван широтой, но фактически Axenta кладёт в x долготу.
    x: Option<f64>,
    y: Option<f64>,
    c: Option<f64>,
    s: Option<serde_json::Value>,
}

impl Axenta {
    pub fn from_env() -> Option<Self> {
        let username = std::env::var("AXENTA_USERNAME").ok().filter(|v| !v.is_empty())?;
        let password = std::env::var("AXENTA_PASSWORD").ok().filter(|v| !v.is_empty())?;
        let base = std::env::var("AXENTA_BASE_URL")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "https://axenta.cloud".into());
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .ok()?;
        Some(Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            username,
            password,
            inner: Mutex::new(Inner::default()),
        })
    }

    async fn login(&self) -> anyhow::Result<String> {
        let res = self
            .http
            .post(format!("{}/api/auth/login/", self.base))
            .json(&serde_json::json!({ "username": self.username, "password": self.password }))
            .send()
            .await
            .context("axenta login request")?;
        if !res.status().is_success() {
            return Err(anyhow!("axenta login failed: {}", res.status()));
        }
        Ok(res.json::<LoginResponse>().await.context("axenta login body")?.token)
    }

    async fn fetch_page(&self, token: &str, page: u32) -> anyhow::Result<Result<Page, reqwest::StatusCode>> {
        let res = self
            .http
            .get(format!("{}/api/objects/monitoring/", self.base))
            .query(&[("perPage", "1000"), ("page", &page.to_string())])
            .header("Authorization", format!("Token {token}"))
            .send()
            .await
            .context("axenta monitoring request")?;
        let status = res.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Ok(Err(status));
        }
        if !status.is_success() {
            return Err(anyhow!("axenta monitoring failed: {status}"));
        }
        Ok(Ok(res.json::<Page>().await.context("axenta monitoring body")?))
    }

    async fn fetch_all(&self, inner: &mut Inner) -> anyhow::Result<Vec<Vehicle>> {
        let mut out = Vec::new();
        let mut page = 1;
        let mut relogged = false;
        loop {
            let token = match &inner.token {
                Some(t) => t.clone(),
                None => {
                    let t = self.login().await?;
                    inner.token = Some(t.clone());
                    t
                }
            };
            match self.fetch_page(&token, page).await? {
                Ok(p) => {
                    out.extend(p.results.into_iter().map(Vehicle::from));
                    if p.next.is_none() || page >= 20 {
                        break;
                    }
                    page += 1;
                }
                // Токен протух — один раз входим заново.
                Err(_) if !relogged => {
                    inner.token = None;
                    relogged = true;
                }
                Err(status) => return Err(anyhow!("axenta rejected token: {status}")),
            }
        }
        Ok(out)
    }

    async fn vehicles(&self) -> anyhow::Result<Arc<Vec<Vehicle>>> {
        let mut inner = self.inner.lock().await;
        if let Some((at, list)) = &inner.cache {
            if at.elapsed() < CACHE_TTL {
                return Ok(list.clone());
            }
        }
        let list = Arc::new(self.fetch_all(&mut inner).await?);
        inner.cache = Some((Instant::now(), list.clone()));
        Ok(list)
    }
}

impl From<RawObject> for Vehicle {
    fn from(o: RawObject) -> Self {
        let msg = o.last_message;
        let pos = msg.as_ref().and_then(|m| m.pos.as_ref());
        let speed = pos.and_then(|p| match &p.s {
            Some(serde_json::Value::Number(n)) => n.as_f64(),
            Some(serde_json::Value::String(s)) => s.trim().parse().ok(),
            _ => None,
        });
        let valid = |v: &f64| v.is_finite() && *v != 0.0;
        let coords = pos.and_then(|p| p.y.filter(valid).zip(p.x.filter(valid)));
        Vehicle {
            id: o.id,
            plates: extract_plates(&o.name),
            name: o.name,
            lat: coords.map(|c| c.0),
            lon: coords.map(|c| c.1),
            speed,
            course: pos.and_then(|p| p.c),
            position_time: msg.as_ref().and_then(|m| m.tpos.clone()),
            message_time: msg.as_ref().and_then(|m| m.t.clone()),
            moving: o.is_motion,
            ignition: o.is_ignition,
        }
    }
}

/// Заглавные кириллические буквы и цифры; всё остальное становится пробелом.
/// Латинские буквы, похожие на кириллические, заменяются — в таблице и в навигации их путают.
fn normalize(s: &str) -> Vec<char> {
    let mut out: Vec<char> = Vec::with_capacity(s.len());
    for c in s.chars() {
        let c = c.to_uppercase().next().unwrap_or(c);
        let c = match c {
            'A' => 'А',
            'B' => 'В',
            'E' => 'Е',
            'K' => 'К',
            'M' => 'М',
            'H' => 'Н',
            'O' => 'О',
            'P' => 'Р',
            'C' => 'С',
            'T' => 'Т',
            'Y' => 'У',
            'X' => 'Х',
            other => other,
        };
        if c.is_ascii_digit() || ('А'..='Я').contains(&c) || c == 'Ё' {
            out.push(c);
        } else if out.last() != Some(&' ') {
            out.push(' ');
        }
    }
    out
}

const PLATE_LETTERS: &str = "АВЕКМНОРСТУХ";

/// Читает номер по шаблону: L — буква номера, D — цифра, R — регион из 2–3 цифр.
/// Между группами допускается один пробел. Возвращает номер без пробелов и длину прочитанного.
fn read_plate(chars: &[char], pattern: &str) -> Option<(String, usize)> {
    let mut i = 0;
    let mut out = String::new();
    let mut prev: Option<char> = None;
    for kind in pattern.chars() {
        if prev.is_some_and(|p| p != kind) && chars.get(i) == Some(&' ') {
            i += 1;
        }
        match kind {
            'L' => {
                let c = *chars.get(i)?;
                if !PLATE_LETTERS.contains(c) {
                    return None;
                }
                out.push(c);
                i += 1;
            }
            'D' => {
                let c = *chars.get(i)?;
                if !c.is_ascii_digit() {
                    return None;
                }
                out.push(c);
                i += 1;
            }
            _ => {
                let run = chars[i..].iter().take_while(|c| c.is_ascii_digit()).count();
                if !(2..=3).contains(&run) {
                    return None;
                }
                out.extend(&chars[i..i + run]);
                i += run;
            }
        }
        prev = Some(kind);
    }
    Some((out, i))
}

/// Ищет в тексте российские номера: тягач «А123ВС147» и прицеп «АХ1234 47».
/// Текст вокруг номера (марка, фамилия водителя) не мешает поиску.
pub fn extract_plates(text: &str) -> Vec<String> {
    let chars = normalize(text);
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        // Номер не может начинаться в середине слова: «МЕРСМ167…» не должен дать «СМ…».
        let boundary = i == 0 || !PLATE_LETTERS.contains(chars[i - 1]) || chars[i - 1] == ' ';
        let found = boundary
            .then(|| read_plate(&chars[i..], "LDDDLLR").or_else(|| read_plate(&chars[i..], "LLDDDDR")))
            .flatten();
        match found {
            Some((plate, len)) => {
                out.push(plate);
                i += len;
            }
            None => i += 1,
        }
    }
    out
}

#[derive(Deserialize)]
pub struct LocateQuery {
    /// Номера через запятую, как они записаны в таблице.
    plates: String,
}

#[derive(Serialize)]
pub struct Located {
    /// Номер в том виде, в каком его прислал клиент.
    query: String,
    plate: Option<String>,
    vehicle: Option<Vehicle>,
}

pub async fn locate(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Query(q): Query<LocateQuery>,
) -> AppResult<Json<Vec<Located>>> {
    let Some(axenta) = state.axenta.as_ref() else {
        return Err(AppError::BadRequest("навигация Axenta не настроена".into()));
    };
    let queries: Vec<&str> = q
        .plates
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .take(MAX_PLATES)
        .collect();
    if queries.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let vehicles = axenta.vehicles().await.map_err(|e| {
        tracing::warn!(error = ?e, "axenta unavailable");
        AppError::Unavailable("навигация Axenta сейчас недоступна".into())
    })?;
    let mut by_plate: HashMap<&str, &Vehicle> = HashMap::new();
    for v in vehicles.iter() {
        for p in &v.plates {
            by_plate.entry(p.as_str()).or_insert(v);
        }
    }

    let out = queries
        .into_iter()
        .map(|query| {
            let plate = extract_plates(query).into_iter().next();
            let vehicle = plate.as_deref().and_then(|p| by_plate.get(p)).map(|v| (*v).clone());
            Located { query: query.to_string(), plate, vehicle }
        })
        .collect();
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::extract_plates;

    #[test]
    fn finds_tractor_and_trailer_plates() {
        assert_eq!(extract_plates("DONGFENG Е853РН147"), vec!["Е853РН147"]);
        assert_eq!(extract_plates("Мерс М167КК147"), vec!["М167КК147"]);
        assert_eq!(extract_plates("М167KК147 (Филипенко)"), vec!["М167КК147"]);
        assert_eq!(extract_plates("М 808 ЕЕ 147 (JAC 6t)"), vec!["М808ЕЕ147"]);
        assert_eq!(extract_plates("Е727АН 147"), vec!["Е727АН147"]);
        assert_eq!(extract_plates("ВВ7481 47 (40п)"), vec!["ВВ748147"]);
        assert_eq!(extract_plates("ВК5081 47(38 пал)"), vec!["ВК508147"]);
        assert_eq!(extract_plates("АХ2829 47 Прицеп"), vec!["АХ282947"]);
        assert_eq!(extract_plates("ВВ1877  47 Прицеп 16м"), vec!["ВВ187747"]);
        assert!(extract_plates("1877.0").is_empty());
    }
}
