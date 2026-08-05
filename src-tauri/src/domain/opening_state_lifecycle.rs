use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetOpeningStateOnboardingChoiceRequest {
    pub(crate) choice: String,
}

impl SetOpeningStateOnboardingChoiceRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        match self.choice.trim().to_ascii_uppercase().as_str() {
            "DEFERRED" | "DECLINED" => Ok(()),
            _ => Err("choice must be DEFERRED or DECLINED".to_string()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpeningStateOnboardingStatusResult {
    pub(crate) status: String,
    pub(crate) enabled: bool,
    pub(crate) has_approved_package: bool,
    pub(crate) show_deferred_access: bool,
    #[serde(default)]
    pub(crate) is_replay: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_explicit_optional_setup_choices() {
        assert!(SetOpeningStateOnboardingChoiceRequest {
            choice: "DEFERRED".into(),
        }
        .validate()
        .is_ok());
        assert!(SetOpeningStateOnboardingChoiceRequest {
            choice: "DECLINED".into(),
        }
        .validate()
        .is_ok());
        assert!(SetOpeningStateOnboardingChoiceRequest {
            choice: "COMPLETED".into(),
        }
        .validate()
        .is_err());
    }
}
