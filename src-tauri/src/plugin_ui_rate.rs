use crate::plugin_ui_protocol::PLUGIN_UI_LIMITS;
use std::{
    collections::{BTreeMap, VecDeque},
    time::{Duration, Instant},
};

#[derive(Default)]
pub(crate) struct PluginUiRateBudget(BTreeMap<String, VecDeque<Instant>>);

impl PluginUiRateBudget {
    pub(crate) fn admit(&mut self, plugin_id: &str, now: Instant) -> bool {
        self.0.retain(|_, calls| {
            while calls
                .front()
                .is_some_and(|time| now.duration_since(*time) >= Duration::from_secs(60))
            {
                calls.pop_front();
            }
            !calls.is_empty()
        });
        let calls = self.0.entry(plugin_id.to_owned()).or_default();
        if calls.len() >= PLUGIN_UI_LIMITS.reductions_per_minute
            || calls
                .iter()
                .rev()
                .take_while(|time| now.duration_since(**time) < Duration::from_secs(1))
                .count()
                >= PLUGIN_UI_LIMITS.reductions_per_second
        {
            return false;
        }
        calls.push_back(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rolling_limits_include_internal_calls_and_survive_view_or_package_version_changes() {
        let mut budget = PluginUiRateBudget::default();
        let now = Instant::now();
        for second in 0..30 {
            for _ in 0..20 {
                assert!(budget.admit("plugin", now + Duration::from_secs(second)));
            }
            assert!(!budget.admit("plugin", now + Duration::from_secs(second)));
        }
        assert!(!budget.admit("plugin", now + Duration::from_secs(59)));
        assert!(budget.admit("other", now + Duration::from_secs(59)));
        assert!(budget.admit("plugin", now + Duration::from_secs(60)));
        assert_eq!(budget.0["plugin"].len(), 581);
    }
}
